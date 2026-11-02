import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))

from apps.api import create_app
from core import profile
from core.onboarding import onboarding_state, propose_answer


def main():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "vault"
        profile.init(str(root))
        initial = onboarding_state(root)
        assert initial["nextTopic"] == "identity" and not initial["completed"]
        assert all(topic["status"] == "available" for topic in initial["topics"])

        candidate = propose_answer(root, "identity", "请称呼我为小明，使用简体中文。")
        metadata, body = profile.read_record(candidate)
        assert metadata["status"] == "candidate"
        assert metadata["subject"] == "onboarding-identity"
        assert metadata["source_agent"] == "local-onboarding"
        assert "小明" in body
        state = onboarding_state(root)
        assert state["topics"][0]["status"] == "pending" and state["nextTopic"] == "communication"

        try:
            propose_answer(root, "identity", "重复回答")
            raise AssertionError("duplicate onboarding topic should fail")
        except SystemExit as exc:
            assert "已有" in str(exc)

        client = TestClient(create_app(root, token="onboarding-token"), base_url="http://localhost")
        headers = {"Authorization": "Bearer onboarding-token"}
        assert client.get("/api/v1/onboarding").status_code == 401
        denied = client.post("/api/v1/onboarding/responses", headers=headers, json={
            "topic": "communication", "content": "先给结论", "consent": False,
        })
        assert denied.status_code == 400 and denied.json()["error"]["code"] == "CONSENT_REQUIRED"
        secret = client.post("/api/v1/onboarding/responses", headers=headers, json={
            "topic": "communication", "content": "token: secret-value-12345", "consent": True,
        })
        assert secret.status_code == 400
        saved = client.post("/api/v1/onboarding/responses", headers=headers, json={
            "topic": "communication", "content": "回答先给结论，再补充原因。", "consent": True,
        })
        assert saved.status_code == 201
        assert saved.json()["data"]["state"]["nextTopic"] == "goals"
        assert not (root / "90 System" / "onboarding-chat.md").exists()

        def propose_goal(value: str) -> str:
            try:
                propose_answer(root, "goals", value)
                return "created"
            except SystemExit:
                return "blocked"

        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(propose_goal, ("完成项目A", "完成项目B"))) == ["blocked", "created"]

    print("conversation onboarding tests passed")


if __name__ == "__main__":
    main()
