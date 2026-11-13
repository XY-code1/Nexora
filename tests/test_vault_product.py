from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))

from apps.api import create_app
from core import profile, vault_identity

with tempfile.TemporaryDirectory() as temporary:
    base = Path(temporary)
    vault_identity.app_data_root = lambda: base / "app-data"
    first = base / "first"
    second = base / "second"
    profile.init(str(first))
    profile.init(str(second))
    first_id = vault_identity.ensure_identity(first)["vault_id"]
    second_id = vault_identity.ensure_identity(second)["vault_id"]
    assert first_id != second_id
    vault_identity.register_vault(second)

    api = TestClient(create_app(first, token="session"), base_url="http://localhost")
    headers = {"Authorization": "Bearer session"}
    status = api.get("/api/v1/vault", headers=headers).json()["data"]
    assert status["vaultId"] == first_id and status["externalChange"] is False
    assert len(api.get("/api/v1/vaults", headers=headers).json()["data"]) == 2

    profile_file = first / "10 Profile" / "Profile.md"
    profile_file.write_text(profile_file.read_text(encoding="utf-8") + "\nexternal edit\n", encoding="utf-8")
    assert api.get("/api/v1/vault", headers=headers).json()["data"]["externalChange"] is True

    validated = api.post("/api/v1/vaults/validate", headers=headers, json={"path": str(second)})
    assert validated.status_code == 200 and validated.json()["data"]["vaultId"] == second_id
    assert api.post("/api/v1/vault/switch", headers=headers, json={"path": str(second)}).status_code == 409

    created = base / "created"
    response = api.post("/api/v1/vaults/create", headers=headers, json={"path": str(created)})
    assert response.status_code == 201 and (created / "90 System" / "vault.json").is_file()

    git = api.get("/api/v1/git/status", headers=headers).json()["data"]
    assert git["configured"] is False

    os.environ["PROFILE_VAULT"] = str(first)
    os.environ["PROFILE_VAULT_ID"] = second_id
    import mcp_server
    try:
        mcp_server.get_vault()
        raise AssertionError("MCP accepted a mismatched Vault identity")
    except RuntimeError as exc:
        assert "identity" in str(exc)
    finally:
        os.environ.pop("PROFILE_VAULT", None)
        os.environ.pop("PROFILE_VAULT_ID", None)

print("vault identity, registry, external-change, API, and MCP handshake tests passed")
