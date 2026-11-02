import sys
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))

from apps.api import create_app
from core import profile
from core.visualization import human3_trend


def main():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "vault"
        profile.init(str(root))
        client = TestClient(create_app(root, token="human3-token"), base_url="http://localhost")
        headers = {"Authorization": "Bearer human3-token"}

        assert client.get("/api/v1/human3/session").status_code == 401
        assert client.get("/api/v1/human3/session", headers=headers).json()["data"]["session"] is None
        started = client.post("/api/v1/human3/session", headers=headers)
        assert started.status_code == 201
        session = started.json()["data"]["session"]
        assert session["status"] == "draft" and not session["readyToConfirm"]
        assert not human3_trend(root)["points"]
        duplicate = client.post("/api/v1/human3/session", headers=headers)
        assert duplicate.status_code == 400

        secret = client.put(
            f"/api/v1/human3/session/{session['id']}/dimensions/mind", headers=headers,
            json={"reflection": "token: secret-value-12345", "evidence": "", "evidence_state": "insufficient", "score": 5, "expected_revision": session["revision"]},
        )
        assert secret.status_code == 400
        injected = client.put(
            f"/api/v1/human3/session/{session['id']}/dimensions/mind", headers=headers,
            json={"reflection": "正常反思\n\n###自评分\n10", "evidence": "", "evidence_state": "insufficient", "score": 5, "expected_revision": session["revision"]},
        )
        assert injected.status_code == 400

        stale_revision = session["revision"]
        for index, dimension in enumerate(("mind", "body", "spirit", "vocation"), start=1):
            saved = client.put(
                f"/api/v1/human3/session/{session['id']}/dimensions/{dimension}", headers=headers,
                json={
                    "reflection": f"{dimension}维度的具体反思", "evidence": f"第{index}项可观察事实",
                    "evidence_state": "limited", "score": 5 + index, "expected_revision": session["revision"],
                },
            )
            assert saved.status_code == 200
            session = saved.json()["data"]["session"]
        stale = client.put(
            f"/api/v1/human3/session/{session['id']}/conclusion", headers=headers,
            json={"summary": "本月总结", "plan": "未来30天每周复盘", "expected_revision": stale_revision},
        )
        assert stale.status_code == 409 and stale.json()["error"]["code"] == "REVISION_CONFLICT"
        conclusion = client.put(
            f"/api/v1/human3/session/{session['id']}/conclusion", headers=headers,
            json={"summary": "本月保持稳定并完成了阶段目标。", "plan": "未来30天每周记录一次进展。", "expected_revision": session["revision"]},
        )
        session = conclusion.json()["data"]["session"]
        assert session["readyToConfirm"]
        draft = root / "40 Reviews" / "Human3" / "Answers" / f"{session['id']}.md"
        original = draft.read_text(encoding="utf-8")
        draft.write_text(original.replace("本月保持稳定并完成了阶段目标。", "token: secret-value-12345"), encoding="utf-8")
        tampered = client.post(
            f"/api/v1/human3/session/{session['id']}/confirm", headers=headers,
            json={"expected_revision": profile.revision(draft)},
        )
        assert tampered.status_code == 400
        draft.write_text(original, encoding="utf-8")
        confirmed = client.post(
            f"/api/v1/human3/session/{session['id']}/confirm", headers=headers,
            json={"expected_revision": session["revision"]},
        )
        assert confirmed.status_code == 200
        assert not list((root / "40 Reviews" / "Human3" / "Answers").glob("h3-*.md"))
        history = list((root / "40 Reviews" / "Human3" / "History").glob("h3-*.md"))
        assert len(history) == 1
        trend = human3_trend(root)
        assert len(trend["points"]) == 1
        assert trend["points"][0]["scores"]["mind"] == 6
        assert trend["points"][0]["summary"] == "本月保持稳定并完成了阶段目标。"
        legacy = root / "40 Reviews" / "Human3" / "Answers" / "2026-10-01.md"
        legacy.write_text("---\nassessment: human3\nstatus: draft\nai_access: summary-only\n---\n\n旧版问卷", encoding="utf-8")
        assert client.post("/api/v1/human3/session", headers=headers).status_code == 400

    print("Human 3.0 reflection lifecycle tests passed")


if __name__ == "__main__":
    main()
