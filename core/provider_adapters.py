"""Provider adapters: turn an approved payload into a real model call.

Design constraints:
- nothing is sent unless the user configures a provider, authorizes its scope,
  previews the payload and approves the call;
- API keys live only in API process memory and never enter the Vault or disk;
- every call is audited;
- adapter failures are returned as structured errors and never propagate, so a
  failing provider cannot affect the local profile.
"""

from __future__ import annotations

import contextlib
import json
import time
import urllib.request
from typing import Any, Callable

from . import provider_auth

DEFAULT_TIMEOUT = 30.0

KNOWN_PROVIDERS: dict[str, str] = {
    "local-openai": "OpenAI-compatible local endpoint",
    "ollama": "Ollama local server",
    "openai": "OpenAI API",
    "anthropic": "Anthropic API",
    "custom": "Custom OpenAI-compatible endpoint",
}

DEFAULT_BASE_URLS: dict[str, str] = {
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com/v1",
}

_CONFIGS: dict[str, dict[str, Any]] = {}
_ADAPTERS: dict[str, Callable[[dict[str, Any], str], dict[str, Any]]] = {}


class AdapterError(RuntimeError):
    pass


def register_adapter(name: str, adapter: Callable[[dict[str, Any], str], dict[str, Any]]) -> None:
    _ADAPTERS[name] = adapter


def known_providers() -> dict[str, str]:
    return dict(KNOWN_PROVIDERS)


def default_base_url(provider: str) -> str:
    return DEFAULT_BASE_URLS.get(provider, "")


def configured_providers() -> list[dict[str, Any]]:
    return [config_view(name) for name in sorted(_CONFIGS)]


def config_view(provider: str) -> dict[str, Any]:
    config = _CONFIGS.get(provider)
    if not config:
        raise AdapterError(f"Provider 未配置：{provider}")
    return {
        "provider": provider,
        "baseUrl": config["base_url"],
        "model": config["model"],
        "hasApiKey": bool(config["api_key"]),
        "timeout": config["timeout"],
    }


def configure(provider: str, *, base_url: str = "", model: str = "", api_key: str = "", timeout: float = DEFAULT_TIMEOUT) -> dict[str, Any]:
    if provider not in KNOWN_PROVIDERS:
        raise AdapterError(f"未知 Provider：{provider}")
    clean_base = (base_url or default_base_url(provider)).strip().rstrip("/")
    if not clean_base or "://" not in clean_base:
        raise AdapterError("base_url 必须是完整的 http(s) URL。")
    if not (model or "").strip():
        raise AdapterError("model 不能为空。")
    _CONFIGS[provider] = {
        "base_url": clean_base,
        "model": model.strip(),
        "api_key": api_key,
        "timeout": max(1.0, min(float(timeout), 120.0)),
    }
    return config_view(provider)


def remove_config(provider: str) -> dict[str, Any]:
    existed = _CONFIGS.pop(provider, None) is not None
    return {"provider": provider, "removed": existed}


def _post_json(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), method="POST")
    request.add_header("Content-Type", "application/json")
    for key, value in headers.items():
        request.add_header(key, value)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _openai_compatible(config: dict[str, Any], prompt: str) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {config['api_key']}"} if config.get("api_key") else {}
    response = _post_json(f"{config['base_url']}/chat/completions", {
        "model": config["model"],
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "stream": False,
    }, headers, config["timeout"])
    return {"text": response["choices"][0]["message"]["content"], "model": response.get("model", config["model"]), "usage": response.get("usage", {})}


def _ollama(config: dict[str, Any], prompt: str) -> dict[str, Any]:
    response = _post_json(f"{config['base_url']}/api/chat", {
        "model": config["model"],
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
    }, {}, config["timeout"])
    return {
        "text": response["message"]["content"],
        "model": response.get("model", config["model"]),
        "usage": {"prompt_tokens": response.get("prompt_eval_count", 0), "completion_tokens": response.get("eval_count", 0)},
    }


def _anthropic(config: dict[str, Any], prompt: str) -> dict[str, Any]:
    headers = {"x-api-key": config["api_key"], "anthropic-version": "2023-06-01"}
    response = _post_json(f"{config['base_url']}/messages", {
        "model": config["model"],
        "max_tokens": 512,
        "messages": [{"role": "user", "content": prompt}],
    }, headers, config["timeout"])
    return {"text": response["content"][0]["text"], "model": response.get("model", config["model"]), "usage": response.get("usage", {})}


register_adapter("local-openai", _openai_compatible)
register_adapter("custom", _openai_compatible)
register_adapter("openai", _openai_compatible)
register_adapter("ollama", _ollama)
register_adapter("anthropic", _anthropic)


def call(provider: str, request_id: str) -> dict[str, Any]:
    """Send an approved payload to the configured provider. Never raises."""
    started = time.monotonic()
    try:
        config = _CONFIGS.get(provider)
        if not config:
            raise AdapterError(f"Provider 未配置：{provider}")
        approved = provider_auth.approved_payload(request_id)
        prompt = provider_auth.build_prompt(approved["scope"], approved["payload"])
        result = _ADAPTERS[provider](config, prompt)
        provider_auth.audit_call(request_id, provider, approved["scope"], "ok", result.get("model", ""), int(result.get("usage", {}).get("total_tokens", 0)))
        return {"ok": True, "text": result["text"], "model": result["model"], "usage": result["usage"], "latencyMs": int((time.monotonic() - started) * 1000)}
    except Exception as exc:  # noqa: BLE001 - a failing provider must never break the app
        with contextlib.suppress(Exception):
            provider_auth.audit_call(request_id, provider, "", "error", "", 0, reason=str(exc))
        return {"ok": False, "error": str(exc)[:300], "latencyMs": int((time.monotonic() - started) * 1000)}
