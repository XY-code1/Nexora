"""Vault-local client authorization and tamper-evident security auditing."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from filelock import FileLock

from . import profile

KNOWN_SCOPES = {
    "profile:read", "context:read", "memory:search", "memory:propose",
    "memory:pending", "project:read", "assessment:read",
}
AUTHORIZATION_STATES = ("pending_authorization", "authorized", "revoked", "deleted")
RECENT_WINDOW_SECONDS = 300
SECURITY_ROOT = Path("90 System") / "Security"
CLIENTS_FILE = SECURITY_ROOT / "clients.json"
AUDIT_FILE = Path("90 System") / "Audit" / "security.jsonl"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _issue_token() -> str:
    return secrets.token_urlsafe(32)


def _validate_client_id(value: str) -> str:
    value = value.strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", value):
        raise SystemExit("客户端ID无效。")
    return value


def _validate_scopes(values: list[str] | set[str]) -> list[str]:
    scopes = sorted(set(values))
    unknown = set(scopes) - KNOWN_SCOPES
    if unknown:
        raise SystemExit(f"存在未知权限Scope：{', '.join(sorted(unknown))}")
    return scopes


def _registry(root: Path) -> dict[str, Any]:
    path = root / CLIENTS_FILE
    if not path.is_file():
        return {"version": 1, "clients": []}
    path = profile.safe_vault_file(root, path)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError("客户端授权注册表损坏；已停止授权。") from exc
    if not isinstance(value.get("clients"), list):
        raise RuntimeError("客户端授权注册表格式无效；已停止授权。")
    for item in value["clients"]:
        if "authorization" not in item:
            item["authorization"] = "authorized" if item.get("status") == "active" else "revoked"
    return value


def _registry_lock(root: Path) -> FileLock:
    (root / SECURITY_ROOT).mkdir(parents=True, exist_ok=True)
    return FileLock(root / SECURITY_ROOT / "registry.lock", timeout=10)


def _write_registry(root: Path, value: dict[str, Any]) -> None:
    profile.atomic_write(root / CLIENTS_FILE, json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n")


@contextmanager
def _registry_audit_transaction(root: Path):
    """Keep a registry mutation and its audit event rollback-consistent."""
    registry_path, audit_path = root / CLIENTS_FILE, root / AUDIT_FILE
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    with _registry_lock(root), FileLock(root / AUDIT_FILE.parent / "security-audit.lock", timeout=10):
        rollback = {
            registry_path: registry_path.read_text(encoding="utf-8") if registry_path.exists() else None,
            audit_path: audit_path.read_text(encoding="utf-8") if audit_path.exists() else None,
        }
        journal, transaction = profile.begin_transaction(root, rollback)
        try:
            yield _registry(root), lambda **values: _append_event_unlocked(root, **values)
            profile.commit_transaction(journal, transaction)
        except BaseException:
            profile.recover_transactions(root)
            raise


def _activity_state(item: dict[str, Any]) -> str:
    if item.get("error"):
        return "error"
    last = item.get("lastAccessAt", "")
    if last:
        try:
            delta = (datetime.now(timezone.utc) - datetime.fromisoformat(last)).total_seconds()
            return "recently_active" if 0 <= delta < RECENT_WINDOW_SECONDS else "inactive"
        except ValueError:
            return "inactive"
    return "never_connected"


def _client_view(item: dict[str, Any]) -> dict[str, Any]:
    authorization = item.get("authorization", "authorized")
    activity = _activity_state(item)
    legacy_status = "active" if authorization == "authorized" else "revoked"
    legacy_connection = "recent" if activity == "recently_active" else "inactive"
    return {
        "id": item["id"], "name": item["name"],
        "authorization": authorization, "activity": activity,
        "status": legacy_status, "connectionStatus": legacy_connection,
        "scopes": item.get("scopes", []),
        "registeredAt": item.get("registeredAt", ""),
        "authorizedAt": item.get("authorizedAt", ""),
        "lastAccessAt": item.get("lastAccessAt", ""),
        "revokedAt": item.get("revokedAt", ""),
        "deletedAt": item.get("deletedAt", ""),
    }


def _find_client(registry: dict[str, Any], client_id: str) -> dict[str, Any] | None:
    return next((item for item in registry["clients"] if item["id"] == client_id), None)


def register_client(root: Path, name: str, scopes: list[str]) -> dict[str, Any]:
    """注册客户端，状态 pending_authorization，不签发 token。"""
    name = profile.clean_meta(name, 80)
    if not name:
        raise SystemExit("客户端名称不能为空。")
    scopes = _validate_scopes(scopes)
    if not scopes:
        raise SystemExit("至少选择一个权限Scope。")
    client_id = f"client-{uuid.uuid4().hex[:12]}"
    item = {
        "id": client_id, "name": name, "authorization": "pending_authorization",
        "scopes": scopes, "tokenHash": "", "registeredAt": _now(),
        "authorizedAt": "", "lastAccessAt": "", "revokedAt": "", "deletedAt": "",
    }
    with _registry_audit_transaction(root) as (registry, emit):
        existing = next((value for value in registry["clients"] if value["name"] == name and value["authorization"] != "deleted"), None)
        if existing:
            raise SystemExit("同名客户端已存在。")
        registry["clients"].append(item)
        _write_registry(root, registry)
        emit(client_id="local-user", event_type="client.registered", resource_type="client", scope="client:manage", result="allowed", reason_code="USER_REGISTERED", details={"targetClientId": client_id, "scopes": scopes})
    return _client_view(item)


def authorize_client(root: Path, client_id: str) -> tuple[dict[str, Any], str]:
    """对 pending 客户端授权，签发一次性 token。

    只允许 pending_authorization -> authorized；已授权客户端必须用 reissue_token
    更换 Token；revoked/deleted 是终态，不能重新授权（需重新注册）。
    """
    client_id = _validate_client_id(client_id)
    token = _issue_token()
    with _registry_audit_transaction(root) as (registry, emit):
        item = _find_client(registry, client_id)
        if not item:
            raise SystemExit("未找到客户端。")
        if item["authorization"] == "revoked":
            raise SystemExit("已撤销的客户端不能重新授权，请重新注册。")
        if item["authorization"] == "deleted":
            raise SystemExit("已删除的客户端不能重新授权，请重新注册。")
        if item["authorization"] == "authorized":
            raise SystemExit("已授权客户端请使用 reissue 更换 Token。")
        item["authorization"] = "authorized"
        item["tokenHash"] = _hash_token(token)
        item["authorizedAt"] = _now()
        _write_registry(root, registry)
        emit(client_id="local-user", event_type="client.authorized", resource_type="client", scope="client:manage", result="allowed", reason_code="USER_AUTHORIZED", details={"targetClientId": client_id})
    return _client_view(item), token


def reissue_token(root: Path, client_id: str) -> tuple[dict[str, Any], str]:
    """重新签发 token，旧 token 立即失效。"""
    client_id = _validate_client_id(client_id)
    token = _issue_token()
    with _registry_audit_transaction(root) as (registry, emit):
        item = _find_client(registry, client_id)
        if not item:
            raise SystemExit("未找到客户端。")
        if item["authorization"] != "authorized":
            raise SystemExit("只有已授权客户端可以重新签发。")
        item["tokenHash"] = _hash_token(token)
        item["authorizedAt"] = _now()
        _write_registry(root, registry)
        emit(client_id="local-user", event_type="client.token_reissued", resource_type="client", scope="client:manage", result="allowed", reason_code="USER_REISSUED_TOKEN", details={"targetClientId": client_id})
    return _client_view(item), token


def create_client(root: Path, name: str, scopes: list[str]) -> tuple[dict[str, Any], str]:
    """便捷方法：注册并授权一步完成（向后兼容）。"""
    view = register_client(root, name, scopes)
    return authorize_client(root, view["id"])


def list_clients(root: Path) -> list[dict[str, Any]]:
    with _registry_lock(root):
        return [_client_view(item) for item in _registry(root)["clients"]]


def update_scopes(root: Path, client_id: str, scopes: list[str]) -> dict[str, Any]:
    client_id = _validate_client_id(client_id)
    scopes = _validate_scopes(scopes)
    if not scopes:
        raise SystemExit("至少保留一个权限Scope。")
    with _registry_audit_transaction(root) as (registry, emit):
        item = _find_client(registry, client_id)
        if not item:
            raise SystemExit("未找到客户端。")
        if item["authorization"] != "authorized":
            raise SystemExit("只有已授权客户端可以修改权限。")
        item["scopes"] = scopes
        _write_registry(root, registry)
        emit(client_id="local-user", event_type="client.scopes_updated", resource_type="client", scope="client:manage", result="allowed", reason_code="USER_UPDATED_SCOPES", details={"targetClientId": client_id, "scopes": scopes})
    return _client_view(item)


def revoke_client(root: Path, client_id: str) -> dict[str, Any]:
    client_id = _validate_client_id(client_id)
    with _registry_audit_transaction(root) as (registry, emit):
        item = _find_client(registry, client_id)
        if not item:
            raise SystemExit("未找到客户端。")
        if item["authorization"] == "deleted":
            raise SystemExit("已删除的客户端不能撤销。")
        item["authorization"] = "revoked"
        item["tokenHash"] = ""
        item["revokedAt"] = _now()
        _write_registry(root, registry)
        emit(client_id="local-user", event_type="client.revoked", resource_type="client", scope="client:manage", result="allowed", reason_code="USER_REVOKED", details={"targetClientId": client_id})
    return _client_view(item)


def delete_client(root: Path, client_id: str) -> dict[str, Any]:
    """逻辑删除客户端；不删除历史审计证据。"""
    client_id = _validate_client_id(client_id)
    with _registry_audit_transaction(root) as (registry, emit):
        item = _find_client(registry, client_id)
        if not item:
            raise SystemExit("未找到客户端。")
        item["authorization"] = "deleted"
        item["tokenHash"] = ""
        item["deletedAt"] = _now()
        _write_registry(root, registry)
        emit(client_id="local-user", event_type="client.deleted", resource_type="client", scope="client:manage", result="allowed", reason_code="USER_DELETED", details={"targetClientId": client_id})
    return _client_view(item)


def _canonical_hash(record: dict[str, Any]) -> str:
    payload = {key: value for key, value in record.items() if key != "hash"}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def verify_audit(root: Path) -> dict[str, Any]:
    path = root / AUDIT_FILE
    if not path.is_file():
        return {"status": "missing", "events": 0, "lastHash": ""}
    path = profile.safe_vault_file(root, path)
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


def _append_event_unlocked(root: Path, *, client_id: str, event_type: str, resource_type: str, scope: str, result: str, reason_code: str, correlation_id: str | None = None, details: dict[str, Any] | None = None) -> dict[str, Any]:
    if result not in {"allowed", "denied"}:
        raise RuntimeError("审计结果无效。")
    safe_details = details or {}
    forbidden = {"token", "password", "secret", "apiKey", "content", "body", "vaultPath"}
    if forbidden.intersection(safe_details):
        raise RuntimeError("审计详情包含禁止字段。")
    folder = root / AUDIT_FILE.parent
    folder.mkdir(parents=True, exist_ok=True)
    integrity = verify_audit(root)
    if integrity["status"] == "invalid":
        raise RuntimeError("安全审计链完整性失败；已停止受保护操作。")
    record = {
        "eventId": f"evt-{uuid.uuid4().hex}", "timestamp": _now(), "clientId": profile.clean_meta(client_id, 64) or "unknown",
        "eventType": profile.clean_meta(event_type, 80), "resourceType": profile.clean_meta(resource_type, 80),
        "scope": profile.clean_meta(scope, 80), "result": result, "reasonCode": profile.clean_meta(reason_code, 80),
        "correlationId": correlation_id or f"corr-{uuid.uuid4().hex}", "details": safe_details,
        "prevHash": integrity.get("lastHash", ""),
    }
    record["hash"] = _canonical_hash(record)
    with (root / AUDIT_FILE).open("ab") as handle:
        handle.write((json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8"))
        handle.flush()
        os.fsync(handle.fileno())
    return record


def append_event(root: Path, **values: Any) -> dict[str, Any]:
    folder = root / AUDIT_FILE.parent
    folder.mkdir(parents=True, exist_ok=True)
    with FileLock(folder / "security-audit.lock", timeout=10):
        return _append_event_unlocked(root, **values)


def authorize(root: Path, client_id: str, token: str, scope: str, *, event_type: str, resource_type: str) -> dict[str, Any]:
    correlation = f"corr-{uuid.uuid4().hex}"
    reason = "UNKNOWN_CLIENT"
    denied_emitted = False
    item: dict[str, Any] | None = None
    if scope not in KNOWN_SCOPES:
        reason = "UNKNOWN_SCOPE"
    else:
        try:
            client_id = _validate_client_id(client_id)
        except SystemExit:
            client_id = "invalid-client"
        with _registry_audit_transaction(root) as (registry, emit):
            item = _find_client(registry, client_id)
            if item and item["authorization"] == "revoked":
                reason = "CLIENT_REVOKED"
            elif item and item["authorization"] == "deleted":
                reason = "CLIENT_DELETED"
            elif item and item["authorization"] == "pending_authorization":
                reason = "CLIENT_NOT_AUTHORIZED"
            elif item and not hmac.compare_digest(item.get("tokenHash", ""), _hash_token(token)):
                reason = "INVALID_CREDENTIAL"
            elif item and scope not in item["scopes"]:
                reason = "SCOPE_NOT_GRANTED"
            elif item:
                item["lastAccessAt"] = _now()
                item["error"] = ""
                _write_registry(root, registry)
                emit(client_id=client_id, event_type=event_type, resource_type=resource_type, scope=scope, result="allowed", reason_code="GRANT_VALID", correlation_id=correlation)
                return _client_view(item)
            if item and item.get("authorization") == "authorized" and reason in {"INVALID_CREDENTIAL", "SCOPE_NOT_GRANTED"}:
                item["error"] = reason
                _write_registry(root, registry)
                emit(client_id=client_id, event_type=event_type, resource_type=resource_type, scope=scope, result="denied", reason_code=reason, correlation_id=correlation)
                denied_emitted = True
    if not denied_emitted:
        append_event(root, client_id=client_id or "unknown", event_type=event_type, resource_type=resource_type, scope=scope, result="denied", reason_code=reason, correlation_id=correlation)
    raise PermissionError(f"客户端访问被拒绝：{reason}")


def query_events(root: Path, *, client_id: str = "", event_type: str = "", resource_type: str = "", result: str = "", since: str = "", until: str = "", page: int = 1, page_size: int = 25) -> dict[str, Any]:
    integrity = verify_audit(root)
    if integrity["status"] == "invalid":
        return {"items": [], "page": page, "pageSize": page_size, "total": 0, "integrity": integrity}
    path = root / AUDIT_FILE
    records = []
    if path.is_file():
        for line in profile.safe_vault_file(root, path).read_text(encoding="utf-8").splitlines():
            record = json.loads(line)
            if client_id and record["clientId"] != client_id: continue
            if event_type and record["eventType"] != event_type: continue
            if resource_type and record["resourceType"] != resource_type: continue
            if result and record["result"] != result: continue
            if since and record["timestamp"] < since: continue
            if until and record["timestamp"] > until: continue
            records.append({key: value for key, value in record.items() if key not in {"hash", "prevHash"}})
    records.reverse()
    page = max(1, page); page_size = max(1, min(page_size, 100)); start = (page - 1) * page_size
    return {"items": records[start:start + page_size], "page": page, "pageSize": page_size, "total": len(records), "integrity": integrity}


def diagnostics(root: Path) -> dict[str, Any]:
    integrity = verify_audit(root)
    clients = list_clients(root)
    return {
        "localService": "ok", "vault": "ready", "mcp": "configured" if clients else "not-configured",
        "authorizedClients": sum(item["authorization"] == "authorized" for item in clients),
        "recentDenied": query_events(root, result="denied", page_size=100)["total"],
        "audit": integrity,
    }
