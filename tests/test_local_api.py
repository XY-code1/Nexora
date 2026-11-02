import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))

from apps.api import create_app
from core import profile


def main():
    with tempfile.TemporaryDirectory() as tmp:
        vault = Path(tmp) / "vault"
        profile.init(str(vault))
        web_dist = Path(tmp) / "web-dist"
        (web_dist / "assets").mkdir(parents=True)
        (web_dist / "index.html").write_text("<h1>review app</h1>", encoding="utf-8")
        (web_dist / "assets" / "app.js").write_text("console.log('review')", encoding="utf-8")
        app = create_app(vault, token="test-token", web_dist=web_dist)
        client = TestClient(app, base_url="http://localhost")
        headers = {"Authorization": "Bearer test-token"}

        assert client.get("/api/v1/health").status_code == 200
        assert "review app" in client.get("/").text
        assert "review app" in client.get("/client-route").text
        assert "console.log" in client.get("/assets/app.js").text
        assert client.get("/%2e%2e/secret.txt").status_code == 200
        assert client.get("/api/v1/memories").status_code == 401
        assert client.get("/api/v1/health", headers={"Host": "evil.example"}).status_code == 400
        invalid = client.post("/api/v1/memories/candidates", headers=headers, json={"content": ""})
        assert invalid.status_code == 422 and invalid.json()["error"]["code"] == "VALIDATION_ERROR"

        created = client.post(
            "/api/v1/memories/candidates",
            headers=headers,
            json={"content": "回答先给结论", "memory_type": "preference", "subject": "answer-style"},
        )
        assert created.status_code == 201
        memory = created.json()["data"]
        revision = memory["revision"]

        edited = client.patch(
            f"/api/v1/memories/{memory['id']}",
            headers=headers,
            json={"content": "回答先给结论，再说明原因", "expected_revision": revision},
        )
        assert edited.status_code == 200
        current_revision = edited.json()["data"]["revision"]

        stale = client.patch(
            f"/api/v1/memories/{memory['id']}",
            headers=headers,
            json={"content": "覆盖其他修改", "expected_revision": revision},
        )
        assert stale.status_code == 409
        assert stale.json()["error"]["code"] == "REVISION_CONFLICT"

        confirmed = client.post(
            f"/api/v1/memories/{memory['id']}/confirm",
            headers=headers,
            json={"expected_revision": current_revision},
        )
        assert confirmed.status_code == 200

        confirmed_view = client.get(f"/api/v1/memories/{memory['id']}", headers=headers).json()["data"]
        superseded = client.post(
            f"/api/v1/memories/{memory['id']}/supersede",
            headers=headers,
            json={"expected_revision": confirmed_view["revision"], "content": "默认简洁回答"},
        )
        assert superseded.status_code == 200
        replacement = client.get(
            "/api/v1/memories?status=confirmed", headers=headers,
        ).json()["data"][0]
        forgotten = client.post(
            f"/api/v1/memories/{replacement['id']}/forget",
            headers=headers,
            json={"expected_revision": replacement["revision"], "reason": "user-request"},
        )
        assert forgotten.status_code == 200

        second = client.post(
            "/api/v1/memories/candidates", headers=headers, json={"content": "临时信息"},
        ).json()["data"]
        rejected = client.post(
            f"/api/v1/memories/{second['id']}/reject",
            headers=headers,
            json={"expected_revision": second["revision"], "reason": "temporary"},
        )
        assert rejected.status_code == 200

        candidate = profile.remember(str(vault), "并发候选")
        candidate_revision = profile.revision(candidate)

        def edit(value: str) -> str:
            try:
                profile.edit_candidate(str(vault), candidate.name, value, candidate_revision)
                return "ok"
            except SystemExit:
                return "conflict"

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(edit, ("并发修改A", "并发修改B")))
        assert sorted(outcomes) == ["conflict", "ok"]

        rollback_source = vault / "30 Memory" / "Inbox" / "rollback.md"
        rollback_source.write_text("original", encoding="utf-8")
        rollback_destination = vault / "30 Memory" / "Confirmed" / "rollback.md"
        journal, _ = profile.begin_transaction(vault, {
            rollback_source: "original", rollback_destination: None,
        })
        rollback_source.unlink()
        rollback_destination.write_text("partial", encoding="utf-8")
        profile.recover_transactions(vault)
        assert rollback_source.read_text(encoding="utf-8") == "original"
        assert not rollback_destination.exists() and not journal.exists()

    print("local API and consistency tests passed")


if __name__ == "__main__":
    main()
