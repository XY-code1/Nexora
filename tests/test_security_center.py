import json
import sys
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))

from apps.api import create_app
from core import profile, security


def main():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "vault"
        profile.init(str(root))
        api = TestClient(create_app(root, token="security-center-token"), base_url="http://localhost")
        headers = {"Authorization": "Bearer security-center-token"}

        protected = [
            ("GET", "/api/v1/security/overview", None), ("GET", "/api/v1/security/clients", None),
            ("POST", "/api/v1/security/clients", {"name": "x", "scopes": ["profile:read"]}),
            ("GET", "/api/v1/security/audit-events", None),
        ]
        for method, url, body in protected:
            assert api.request(method, url, json=body).status_code == 401

        initial = api.get("/api/v1/security/overview", headers=headers).json()["data"]
        assert initial["diagnostics"]["audit"]["status"] == "missing"
        assert initial["diagnostics"]["mcp"] == "not-configured"
        assert "memory:confirm" not in initial["scopes"]

        created = api.post("/api/v1/security/clients", headers=headers, json={"name": "Synthetic Local Client", "scopes": ["profile:read"]})
        assert created.status_code == 201
        payload = created.json()["data"]
        client = payload["client"]
        credential = payload["credential"]
        assert credential and "credential" not in json.dumps((root / security.CLIENTS_FILE).read_text(encoding="utf-8"))
        registry_text = (root / security.CLIENTS_FILE).read_text(encoding="utf-8")
        assert credential not in registry_text and "tokenHash" in registry_text

        security.authorize(root, client["id"], credential, "profile:read", event_type="profile.read", resource_type="profile")
        try:
            security.authorize(root, client["id"], "wrong-credential", "profile:read", event_type="profile.read", resource_type="profile")
            raise AssertionError("invalid credential was allowed")
        except PermissionError:
            pass
        try:
            security.authorize(root, client["id"], credential, "memory:search", event_type="memory.search", resource_type="memory")
            raise AssertionError("missing scope was allowed")
        except PermissionError:
            pass
        events = api.get("/api/v1/security/audit-events?result=denied", headers=headers).json()["data"]
        assert {item["reasonCode"] for item in events["items"]} == {"INVALID_CREDENTIAL", "SCOPE_NOT_GRANTED"}

        updated = api.put(f"/api/v1/security/clients/{client['id']}/scopes", headers=headers, json={"scopes": ["profile:read", "memory:search"]})
        assert updated.status_code == 200 and "memory:search" in updated.json()["data"]["scopes"]
        security.authorize(root, client["id"], credential, "memory:search", event_type="memory.search", resource_type="memory")

        candidate = profile.remember(str(root), "真实生命周期审计候选", source_agent="local-api", memory_type="note", subject="security-audit")
        revision = profile.revision(candidate)
        profile.confirm(str(root), candidate.name, revision)
        lifecycle = api.get("/api/v1/security/audit-events?resource_type=memory&page_size=100", headers=headers).json()["data"]
        event_types = {item["eventType"] for item in lifecycle["items"]}
        assert {"memory.candidate_created", "memory.confirmed", "memory.search"} <= event_types

        page = api.get("/api/v1/security/audit-events?page=1&page_size=2", headers=headers).json()["data"]
        assert len(page["items"]) == 2 and page["total"] >= 6
        second = api.get("/api/v1/security/audit-events?page=2&page_size=2", headers=headers).json()["data"]
        assert second["items"] and second["items"][0]["eventId"] != page["items"][0]["eventId"]
        filtered = api.get(f"/api/v1/security/audit-events?client_id={client['id']}&event_type=profile.read&result=allowed", headers=headers).json()["data"]
        assert filtered["total"] == 1

        revoked = api.post(f"/api/v1/security/clients/{client['id']}/revoke", headers=headers)
        assert revoked.json()["data"]["authorization"] == "revoked"
        try:
            security.authorize(root, client["id"], credential, "profile:read", event_type="profile.read", resource_type="profile")
            raise AssertionError("revoked client was allowed")
        except PermissionError:
            pass
        denied = api.get(f"/api/v1/security/audit-events?client_id={client['id']}&result=denied", headers=headers).json()["data"]
        assert {item["reasonCode"] for item in denied["items"]} >= {"SCOPE_NOT_GRANTED", "CLIENT_REVOKED"}

        audit_text = (root / security.AUDIT_FILE).read_text(encoding="utf-8")
        assert credential not in audit_text and "真实生命周期审计候选" not in audit_text
        assert security.verify_audit(root)["status"] == "verified"

        # Tampering is visible and subsequent protected authorization fails closed.
        lines = audit_text.splitlines()
        record = json.loads(lines[0])
        record["reasonCode"] = "TAMPERED"
        lines[0] = json.dumps(record, ensure_ascii=False)
        (root / security.AUDIT_FILE).write_text("\n".join(lines) + "\n", encoding="utf-8")
        assert security.verify_audit(root)["status"] == "invalid"
        try:
            security.authorize(root, client["id"], credential, "profile:read", event_type="profile.read", resource_type="profile")
            raise AssertionError("tampered audit allowed protected operation")
        except (PermissionError, RuntimeError):
            pass

    print("security center identity, permission, audit, revocation, and integrity tests passed")


if __name__ == "__main__":
    main()
