"""Explicit per-call authorization for external AI providers.

This module is deliberately inert: it never opens a network connection and
never sends Vault content anywhere. It records what the user has authorized
for a provider, builds a minimized preview of what a call *would* send, and
keeps an append-only, hash-chained audit trail of every decision.

Default state: no provider is authorized, so every call is denied. Nothing
here is wired into the memory lifecycle, so local-first behaviour is
unchanged until a provider integration opts in.
"""

from __future__ import annotations

import contextlib
import hashlib
import hmac
import json
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from filelock import FileLock

from . import profile
from .vault_identity import app_data_root

REGISTRY_FILE = "providers.json"
AUDIT_FILE = "provider-audit.jsonl"

# Scope -> the only fields that may leave the device for that scope.
KNOWN_SCOPES: dict[str, tuple[str, ...]] = {
    "reflection:summary": ("dimension", "summary"),
    "profile:summary": ("summary",),
    "memory:search": ("query",),
}

_PENDING: dict[str, dict[str, Any]] = {}
_PENDING_LOCK = threading.Lock()
_APPROVED_TTL_SECONDS = 600.0
_APPROVED: dict[str, dict[str, Any]] = {}
_APPROVED_LOCK = threading.Lock()


class ProviderAuthError(RuntimeError):
    """Raised when an authorization or a call decision is not allowed."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _registry_path() -> Path:
    return app_data_root() / REGISTRY_FILE


def _audit_path() -> Path:
    return app_data_root() / AUDIT_FILE


def _canonical_hash(record: dict[str, Any]) -> str:
    payload = {key: value for key, value in record.items() if key not in {"hash", "prevHash"}}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def list_providers() -> list[dict[str, Any]]:
    try:
        data = json.loads(_registry_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    items = data.get("providers") if isinstance(data, dict) else None
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def _save_providers(items: list[dict[str, Any]]) -> None:
    path = _registry_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with FileLock(str(path) + ".lock", timeout=10):
        path.write_text(json.dumps({"providers": items}, ensure_ascii=False, indent=2), encoding="utf-8")
    with contextlib.suppress(OSError):
        os.chmod(path, 0o600)


def authorize_provider(provider: str, scopes: list[str]) -> dict[str, Any]:
    name = profile.clean_meta(provider, 64)
    if not name:
        raise ProviderAuthError("Provider 名称不能为空。")
    unknown = [scope for scope in scopes if scope not in KNOWN_SCOPES]
    if unknown:
        raise ProviderAuthError(f"未知 Scope：{', '.join(unknown)}")
    stamp = _now()
    items = [item for item in list_providers() if item.get("provider") != name]
    record = {"provider": name, "enabled": True, "scopes": list(dict.fromkeys(scopes)), "createdAt": stamp, "updatedAt": stamp}
    items.insert(0, record)
    _save_providers(items)
    return record


def revoke_provider(provider: str) -> dict[str, Any]:
    name = profile.clean_meta(provider, 64)
    current = list_providers()
    items = [item for item in current if item.get("provider") != name]
    if len(items) == len(current):
        raise ProviderAuthError(f"未找到 Provider：{name}")
    _save_providers(items)
    return {"provider": name, "revoked": True}


def _authorization(provider: str, scope: str) -> dict[str, Any]:
    name = profile.clean_meta(provider, 64)
    for item in list_providers():
        if item.get("provider") == name and item.get("enabled") is True:
            if scope in item.get("scopes", []):
                return item
            raise ProviderAuthError(f"Provider「{name}」未授权 Scope：{scope}")
    raise ProviderAuthError(f"Provider「{name}」不存在或未启用。")


def prepare_call(provider: str, scope: str, context: dict[str, Any]) -> dict[str, Any]:
    """Build a minimized preview. Nothing is sent and nothing enters the Vault."""
    if scope not in KNOWN_SCOPES:
        raise ProviderAuthError(f"未知 Scope：{scope}")
    _authorization(provider, scope)
    if not isinstance(context, dict):
        raise ProviderAuthError("调用内容必须是对象。")
    allowed = KNOWN_SCOPES[scope]
    preview = {key: context[key] for key in allowed if key in context}
    dropped = sorted(key for key in context if key not in allowed)
    record = {
        "requestId": f"req-{uuid.uuid4().hex}",
        "provider": profile.clean_meta(provider, 64),
        "scope": scope,
        "preview": preview,
        "droppedFields": dropped,
        "preparedAt": _now(),
        "status": "pending",
    }
    with _PENDING_LOCK:
        _PENDING[record["requestId"]] = record
    return dict(record)


def pending_calls() -> list[dict[str, Any]]:
    with _PENDING_LOCK:
        return [dict(item) for item in _PENDING.values()]


def decide_call(request_id: str, action: str, reason: str = "") -> dict[str, Any]:
    """Record an approve/deny decision; only an approval returns the payload."""
    if action not in {"approve", "deny"}:
        raise ProviderAuthError("决策必须是 approve 或 deny。")
    with _PENDING_LOCK:
        record = _PENDING.pop(request_id, None)
    if record is None:
        raise ProviderAuthError("未找到待确认的调用，或它已被处理。")
    approved = action == "approve"
    _append_audit({
        "requestId": record["requestId"],
        "provider": record["provider"],
        "scope": record["scope"],
        "eventType": "provider.call",
        "result": "allowed" if approved else "denied",
        "reasonCode": profile.clean_meta(reason, 80) or ("APPROVED" if approved else "DENIED"),
        "fieldCount": len(record["preview"]),
        "droppedFields": record["droppedFields"],
    })
    if approved:
        with _APPROVED_LOCK:
            _APPROVED[record["requestId"]] = {
                "provider": record["provider"],
                "scope": record["scope"],
                "payload": record["preview"],
                "approvedAt": _now(),
                "expiresAt": time.monotonic() + _APPROVED_TTL_SECONDS,
            }
    return {
        "requestId": record["requestId"],
        "provider": record["provider"],
        "scope": record["scope"],
        "decision": "approved" if approved else "denied",
        "payload": record["preview"] if approved else {},
        "droppedFields": record["droppedFields"],
        "decidedAt": _now(),
    }


def approved_payload(request_id: str) -> dict[str, Any]:
    """Return the approved payload once; an approval is single-use."""
    with _APPROVED_LOCK:
        record = _APPROVED.pop(request_id, None)
        if not record:
            raise ProviderAuthError("该调用未批准，或批准已过期。")
        if time.monotonic() > record["expiresAt"]:
            raise ProviderAuthError("批准已过期，请重新预览并批准。")
        return {"provider": record["provider"], "scope": record["scope"], "payload": record["payload"]}


SCOPE_SYSTEM_PROMPTS = {
    "reflection:summary": "你是一个本地反思助手。请基于用户提供的信息，用简洁的中文给出回应，不要编造未提供的事实。",
    "profile:summary": "你是一个本地档案助手。请基于用户提供的信息，用简洁的中文给出回应，不要编造未提供的事实。",
    "memory:search": "你是一个本地记忆助手。请仅基于用户提供的信息回答，不要编造。",
}


def build_prompt(scope: str, payload: dict[str, Any]) -> str:
    system = SCOPE_SYSTEM_PROMPTS.get(scope, "你是一个本地助手。请仅基于用户提供的信息回答，不要编造。")
    body = "\n".join(f"{key}: {value}" for key, value in payload.items())
    return f"{system}\n\n{body}"


def audit_call(request_id: str, provider: str, scope: str, status: str, model: str = "", tokens: int = 0, reason: str = "") -> dict[str, Any]:
    """Record a provider call attempt (success or failure) in the audit log."""
    return _append_audit({
        "requestId": request_id,
        "provider": provider,
        "scope": scope,
        "eventType": "provider.call",
        "result": "allowed" if status == "ok" else "denied",
        "reasonCode": profile.clean_meta(reason, 80) or ("CALL_OK" if status == "ok" else "CALL_FAILED"),
        "fieldCount": 0,
        "droppedFields": [],
        "model": model,
        "tokens": tokens,
    })


def verify_audit() -> dict[str, Any]:
    path = _audit_path()
    if not path.is_file():
        return {"status": "missing", "events": 0, "lastHash": ""}
    previous = ""
    count = 0
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            return {"status": "invalid", "events": count, "line": number, "lastHash": previous}
        if record.get("prevHash", "") != previous or not hmac.compare_digest(str(record.get("hash", "")), _canonical_hash(record)):
            return {"status": "invalid", "events": count, "line": number, "lastHash": previous}
        previous = record["hash"]
        count += 1
    return {"status": "verified", "events": count, "lastHash": previous}


def _append_audit(entry: dict[str, Any]) -> dict[str, Any]:
    path = _audit_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with FileLock(str(path) + ".lock", timeout=10):
        integrity = verify_audit()
        record = {
            "eventId": f"evt-{uuid.uuid4().hex}",
            "timestamp": _now(),
            "eventType": profile.clean_meta(str(entry.get("eventType", "")), 80),
            "resourceType": "provider_call",
            "scope": profile.clean_meta(str(entry.get("scope", "")), 80),
            "result": entry.get("result", "denied"),
            "reasonCode": profile.clean_meta(str(entry.get("reasonCode", "")), 80),
            "correlationId": str(entry.get("requestId", "")),
            "details": {
                "provider": profile.clean_meta(str(entry.get("provider", "")), 64),
                "fieldCount": int(entry.get("fieldCount", 0)),
                "droppedFields": [profile.clean_meta(str(item), 64) for item in entry.get("droppedFields", [])],
                "model": profile.clean_meta(str(entry.get("model", "")), 64),
                "tokens": int(entry.get("tokens", 0)),
            },
            "prevHash": integrity["lastHash"],
        }
        record["hash"] = _canonical_hash(record)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
    return record


def audit_log() -> dict[str, Any]:
    path = _audit_path()
    if not path.is_file():
        return {"integrity": verify_audit(), "items": []}
    items: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            items.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return {"integrity": verify_audit(), "items": list(reversed(items))[:100]}
