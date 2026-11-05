import tempfile
from pathlib import Path
import sys

from fastapi.testclient import TestClient

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))

from apps.api import create_app
from core import profile


def main() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        vault = Path(temporary) / "vault"
        profile.init(str(vault))
        api = TestClient(create_app(vault, token="session"), base_url="http://localhost")
        headers = {"Authorization": "Bearer session"}
        payload = {"name": "Claude Desktop", "scopes": ["profile:read"]}
        assert api.post("/api/v1/security/clients/register", json=payload).status_code == 401
        registered = api.post("/api/v1/security/clients/register", headers=headers, json=payload)
        assert registered.status_code == 201
        client = registered.json()["data"]
        assert client["authorization"] == "pending_authorization"
        assert "credential" not in registered.json()["data"]
        assert client["authorization"] == "pending_authorization"
        assert client["activity"] == "never_connected"
        assert "tokenHash" not in client

        authorized = api.post(f"/api/v1/security/clients/{client['id']}/authorize", headers=headers)
        assert authorized.status_code == 200 and authorized.json()["data"]["credential"]
        reissued = api.post(f"/api/v1/security/clients/{client['id']}/reissue", headers=headers)
        assert reissued.status_code == 200
        assert reissued.json()["data"]["credential"] != authorized.json()["data"]["credential"]
        revoked = api.post(f"/api/v1/security/clients/{client['id']}/revoke", headers=headers)
        assert revoked.json()["data"]["authorization"] == "revoked"
        deleted = api.delete(f"/api/v1/security/clients/{client['id']}", headers=headers)
        assert deleted.json()["data"]["authorization"] == "deleted"
    print("AI Connections API lifecycle tests passed")


if __name__ == "__main__":
    main()
