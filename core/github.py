"""GitHub private-repository onboarding.

Design constraints (docs/GITHUB_BACKUP_PLAN.md):
- the access token lives only in API process memory, never in the Vault, the
  browser, localStorage or on disk;
- a repository must be verified ``private: true`` before it is set as the
  remote;
- the Git remote is configured without embedded credentials, so push/pull
  authentication relies on the user's existing git credential helper.

The HTTP layer is injectable so the whole flow can be tested without real
credentials or network access.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from filelock import FileLock

from . import profile
from .vault_identity import app_data_root

GITHUB_DEVICE_URL = "https://github.com/login/device/code"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_API = "https://api.github.com"
DEVICE_SCOPE = "repo"
CONNECTION_FILE = "github-connection.json"


class GitHubError(RuntimeError):
    pass


_session: dict[str, str] = {}
_device: dict[str, Any] = {}
_client_id = ""
_request: Any = None


def configure_client_id(client_id: str) -> None:
    global _client_id
    _client_id = profile.clean_meta(client_id, 200)


def client_id() -> str:
    return _client_id


def set_transport(request: Any) -> None:
    """Inject the HTTP layer (tests)."""
    global _request
    _request = request


def _default_request(method: str, url: str, *, data: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> dict[str, Any]:
    request = urllib.request.Request(url, method=method)
    request.add_header("Accept", "application/json")
    body = None
    if data is not None:
        if url.startswith("https://github.com/login/"):
            body = urllib.parse.urlencode(data).encode("utf-8")
            request.add_header("Content-Type", "application/x-www-form-urlencoded")
        else:
            body = json.dumps(data).encode("utf-8")
            request.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    with urllib.request.urlopen(request, body, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def _call(method: str, url: str, *, data: dict[str, Any] | None = None, token: str | None = None) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        return (_request or _default_request)(method, url, data=data, headers=headers)
    except Exception as exc:  # noqa: BLE001 - normalise every transport failure
        raise GitHubError(f"GitHub 请求失败：{exc}") from None


def _require_client_id() -> str:
    if not _client_id:
        raise GitHubError("尚未配置 GitHub OAuth App Client ID。请先在设置中填写。")
    return _client_id


def start_device_flow() -> dict[str, Any]:
    """Ask GitHub for a device code; the user then visits the verification URI."""
    response = _call("POST", GITHUB_DEVICE_URL, data={"client_id": _require_client_id(), "scope": DEVICE_SCOPE})
    for key in ("device_code", "user_code", "verification_uri", "expires_in", "interval"):
        if key not in response:
            raise GitHubError(f"GitHub Device Flow 响应缺少字段：{key}")
    _device.clear()
    _device.update({key: response[key] for key in ("device_code", "expires_in", "interval")})
    return {
        "userCode": response["user_code"],
        "verificationUri": response["verification_uri"],
        "expiresIn": int(response["expires_in"]),
        "interval": int(response.get("interval", 5)),
    }


def poll_device_flow() -> dict[str, Any]:
    """Poll once. Returns pending / authorized / expired; never returns the token."""
    device_code = _device.get("device_code")
    if not device_code:
        raise GitHubError("没有进行中的 Device Flow。")
    response = _call("POST", GITHUB_TOKEN_URL, data={
        "client_id": _require_client_id(),
        "device_code": device_code,
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
    })
    error = response.get("error")
    if error == "authorization_pending":
        return {"status": "pending"}
    if error == "slow_down":
        return {"status": "slow_down"}
    if error == "expired_token":
        _device.clear()
        return {"status": "expired"}
    token = response.get("access_token")
    if not token:
        raise GitHubError(f"Device Flow 失败：{error or '未返回 token'}")
    _session.clear()
    _session["token"] = token
    _device.clear()
    return {"status": "authorized"}


def _token() -> str:
    token = _session.get("token")
    if not token:
        raise GitHubError("尚未完成 GitHub 授权。请先运行 Device Flow。")
    return token


def list_repositories() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    page = 1
    while page <= 5:
        response = _call("GET", f"{GITHUB_API}/user/repos?per_page=100&page={page}&affiliation=owner", token=_token())
        if not isinstance(response, list) or not response:
            break
        for item in response:
            items.append({
                "name": item.get("name", ""),
                "fullName": item.get("full_name", ""),
                "private": bool(item.get("private")),
                "permissions": item.get("permissions", {}),
            })
        page += 1
    return items


def verify_repository(full_name: str) -> dict[str, Any]:
    """Fetch the repository and report whether GitHub says it is private."""
    name = profile.clean_meta(full_name, 200)
    if "/" not in name:
        raise GitHubError("仓库名称必须是 owner/repo。")
    response = _call("GET", f"{GITHUB_API}/repos/{name}", token=_token())
    return {
        "fullName": response.get("full_name", name),
        "private": bool(response.get("private")),
        "defaultBranch": response.get("default_branch", ""),
        "permissions": response.get("permissions", {}),
    }


def create_repository(name: str, *, private: bool = True) -> dict[str, Any]:
    """Explicitly create a repository. Private is the only supported default."""
    repository = profile.clean_meta(name, 100)
    if not repository:
        raise GitHubError("仓库名称不能为空。")
    response = _call("POST", f"{GITHUB_API}/user/repos", data={"name": repository, "private": private, "auto_init": False}, token=_token())
    return {"fullName": response.get("full_name", repository), "private": bool(response.get("private", private)), "created": True}


def connection_path() -> Path:
    return app_data_root() / CONNECTION_FILE


def connection() -> dict[str, Any]:
    try:
        data = json.loads(connection_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"connected": False}
    return {**data, "connected": bool(data.get("repository"))}


def _save_connection(record: dict[str, Any]) -> None:
    path = connection_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with FileLock(str(path) + ".lock", timeout=10):
        path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        import os
        os.chmod(path, 0o600)
    except OSError:
        pass


def connect(vault: str, full_name: str, remote_name: str = "origin") -> dict[str, Any]:
    """Verify the repository is private, then configure the remote without credentials."""
    from . import sync

    verified = verify_repository(full_name)
    if not verified["private"]:
        raise GitHubError("GitHub 返回该仓库为 public；已拒绝写入 remote。")
    name = profile.clean_meta(remote_name, 64) or "origin"
    if not profile.clean_meta(name, 64):
        raise GitHubError("remote 名称无效。")
    url = f"https://github.com/{verified['fullName']}.git"
    result = sync.configure_remote(vault, url, name)
    record = {
        "provider": "github",
        "repository": verified["fullName"],
        "visibilityVerified": "private",
        "remoteName": name,
        "remoteHost": result["host"],
        "lastVerifiedAt": _now(),
    }
    _save_connection(record)
    return {**record, "sessionActive": session_active()}


def disconnect(vault: str) -> dict[str, Any]:
    from . import sync

    sync.remove_remote(vault)
    _session.clear()
    _device.clear()
    try:
        connection_path().unlink(missing_ok=True)
    except OSError:
        pass
    return {"connected": False}


def session_active() -> bool:
    return bool(_session.get("token"))


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="seconds")
