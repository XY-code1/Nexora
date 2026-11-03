"""Vault-local client authorization and tamper-evident security auditing."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from filelock import FileLock

from . import profile

KNOWN_SCOPES = {
    "profile:read", "context:read", "memory:search", "memory:propose",
    "memory:pending", "project:read", "assessment:read",
}
SECURITY_ROOT = Path("90 System") / "Security"
CLIENTS_FILE = SECURITY_ROOT / "clients.json"
AUDIT_FILE = Path("90 System") / "Audit" / "security.jsonl"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


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
    if value.get("version") != 1 or not isinstance(value.get("clients"), list):
        raise RuntimeError("客户端授权注册表格式无效；已停止授权。")
    return value


def _registry_lock(root: Path) -> FileLock:
    (root / SECURITY_ROOT).mkdir(parents=True, exist_ok=True)
    return FileLock(root / SECURITY_ROOT / "registry.lock", timeout=10)


def _write_registry(root: Path, value: dict[str, Any]) -> None:
    profile.atomic_write(root / CLIENTS_FILE, json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n")


def _client_view(value: dict[str, Any]) -> dict[str, Any]:
    last = value.get("lastAccessAt", "")
    recent = False
    if last:
        try:
            recent = (datetime.now(timezone.utc) - datetime.fromisoformat(last)).total_seconds() < 300
        except ValueError:
            pass
    return {
        "id": value["id"], "name": value["name"], "status": value["status"],
        "connectionStatus": "recent" if recent and value["status"] == "active" else "inactive",
        "scopes": value["scopes"], "authorizedAt": value["authorizedAt"],
        "lastAccessAt": last, "revokedAt": value.get("revokedAt", ""),
    }


def create_client(root: Path, name: str, scopes: list[str]) -> tuple[dict[str, Any], str]:
    name = profile.clean_meta(name, 80)
    if not name:
        raise SystemExit("客户端名称不能为空。")
    scopes = _validate_scopes(scopes)
    if not scopes:
        raise SystemExit("至少选择一个权限Scope。")
    token = secrets.token_urlsafe(32)
    client_id = f"client-{uuid.uuid4().hex[:12]}"
    with _registry_lock(root):
        registry = _registry(root)
        item = {"id": client_id, "name": name, "status": "active", "scopes": scopes, "tokenHash": _hash_token(token), "authorizedAt": _now(), "lastAccessAt": "", "revokedAt": ""}
        registry["clients"].append(item)
        _write_registry(root, registry)
    append_event(root, client_id="local-user", event_type="client.authorized", resource_type="client", scope="client:manage", result="allowed", reason_code="USER_AUTHORIZED", details={"targetClientId": client_id, "scopes": scopes})
    return _client_view(item), token


def list_clients(root: Path) -> list[dict[str, Any]]:
    with _registry_lock(root):
        return [_client_view(item) for item in _registry(root)["clients"]]


def update_scopes(root: Path, client_id: str, scopes: list[str]) -> dict[str, Any]:
    client_id = _validate_client_id(client_id)
    scopes = _validate_scopes(scopes)
    if not scopes:
        raise SystemExit("至少保留一个权限Scope。")
    with _registry_lock(root):
        registry = _registry(root)
        item = next((value for value in registry["clients"] if value["id"] == client_id), None)
        if not item:
            raise SystemExit("未找到授权客户端。")
        if item["status"] != "active":
            raise SystemExit("已撤销的客户端不能修改权限。")
        item["scopes"] = scopes
        _write_registry(root, registry)
    append_event(root, client_id="local-user", event_type="client.scopes_updated", resource_type="client", scope="client:manage", result="allowed", reason_code="USER_UPDATED_SCOPES", details={"targetClientId": client_id, "scopes": scopes})
    return _client_view(item)


def revoke_client(root: Path, client_id: str) -> dict[str, Any]:
    client_id = _validate_client_id(client_id)
    with _registry_lock(root):
        registry = _registry(root)
        item = next((value for value in registry["clients"] if value["id"] == client_id), None)
        if not item:
            raise SystemExit("未找到授权客户端。")
        item["status"] = "revoked"
        item["revokedAt"] = _now()
        _write_registry(root, registry)
    append_event(root, client_id="local-user", event_type="client.revoked", resource_type="client", scope="client:manage", result="allowed", reason_code="USER_REVOKED", details={"targetClientId": client_id})
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


def append_event(root: Path, *, client_id: str, event_type: str, resource_type: str, scope: str, result: str, reason_code: str, correlation_id: str | None = None, details: dict[str, Any] | None = None) -> dict[str, Any]:
    if result not in {"allowed", "denied"}:
        raise RuntimeError("审计结果无效。")
    safe_details = details or {}
    forbidden = {"token", "password", "secret", "apiKey", "content", "body", "vaultPath"}
    if forbidden.intersection(safe_details):
        raise RuntimeError("审计详情包含禁止字段。")
    folder = root / AUDIT_FILE.parent
    folder.mkdir(parents=True, exist_ok=True)
    with FileLock(folder / "security-audit.lock", timeout=10):
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


def authorize(root: Path, client_id: str, token: str, scope: str, *, event_type: str, resource_type: str) -> dict[str, Any]:
    correlation = f"corr-{uuid.uuid4().hex}"
    reason = "UNKNOWN_CLIENT"
    item: dict[str, Any] | None = None
    if scope not in KNOWN_SCOPES:
        reason = "UNKNOWN_SCOPE"
    else:
        try:
            client_id = _validate_client_id(client_id)
        except SystemExit:
            client_id = "invalid-client"
        with _registry_lock(root):
            registry = _registry(root)
            item = next((value for value in registry["clients"] if value["id"] == client_id), None)
            if item and item["status"] == "revoked":
                reason = "CLIENT_REVOKED"
            elif item and not hmac.compare_digest(item["tokenHash"], _hash_token(token)):
                reason = "INVALID_CREDENTIAL"
            elif item and scope not in item["scopes"]:
                reason = "SCOPE_NOT_GRANTED"
            elif item:
                item["lastAccessAt"] = _now()
                _write_registry(root, registry)
                append_event(root, client_id=client_id, event_type=event_type, resource_type=resource_type, scope=scope, result="allowed", reason_code="GRANT_VALID", correlation_id=correlation)
                return _client_view(item)
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
        "authorizedClients": sum(item["status"] == "active" for item in clients),
        "recentDenied": query_events(root, result="denied", page_size=100)["total"],
        "audit": integrity,
    }
