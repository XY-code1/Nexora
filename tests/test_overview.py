import sys
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))

from apps.api import create_app
from core import profile


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "vault"
        profile.init(str(root))
        client = TestClient(create_app(root, token="overview-token"), base_url="http://localhost")
        headers = {"Authorization": "Bearer overview-token"}

        assert client.get("/api/v1/overview").status_code == 401

        data = client.get("/api/v1/overview", headers=headers).json()["data"]
        assert data["vault"] == "ready"
        assert set(data["memory"]) == {"candidateMemories", "pendingReview", "confirmedMemories"}
        assert data["memory"]["confirmedMemories"] == 0 and data["pending"] == 0
        assert data["clients"]["total"] == 0 and data["clients"]["active"] == []
        assert data["recentAccess"] == []
        assert data["growth"]["latestMonth"] is None
        assert "profile" in data and "access" in data["profile"]

    print("overview endpoint tests passed")


if __name__ == "__main__":
    main()
