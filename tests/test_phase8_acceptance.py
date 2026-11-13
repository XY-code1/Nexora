"""Phase 8 HTTP, persistence, concurrency, and privacy acceptance checks."""

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
        api = TestClient(create_app(root, token="phase8-token"), base_url="http://localhost")
        headers = {"Authorization": "Bearer phase8-token"}

        protected = [
            ("GET", "/api/v1/growth/dimensions", None),
            ("GET", "/api/v1/growth/assessments", None),
            ("POST", "/api/v1/growth/assessments", {"month": "2026-11"}),
            ("GET", "/api/v1/growth/timeline", None),
            ("GET", "/api/v1/growth/associations", None),
            ("GET", "/api/v1/growth/goals", None),
            ("PUT", "/api/v1/growth/assessments/ga-2026-11-aaaaaaaa/dimensions/mind", {"current": "x", "expected_revision": "0" * 64}),
            ("PUT", "/api/v1/growth/assessments/ga-2026-11-aaaaaaaa/level", {"level": "2.0", "expected_revision": "0" * 64}),
            ("POST", "/api/v1/growth/assessments/ga-2026-11-aaaaaaaa/confirm", {"expected_revision": "0" * 64}),
            ("DELETE", f"/api/v1/growth/assessments/ga-2026-11-aaaaaaaa?expected_revision={'0' * 64}", None),
            ("POST", "/api/v1/growth/associations", {"from_dimension": "mind", "to_dimension": "body", "relation_type": "correlation"}),
            ("DELETE", f"/api/v1/growth/associations/assoc-aaaaaaaa?expected_revision={'0' * 64}", None),
            ("POST", "/api/v1/growth/goals", {"horizon": "monthly", "title": "x", "priority": "low"}),
            ("PUT", "/api/v1/growth/goals/goal-aaaaaaaa", {"title": "x", "priority": "low", "expected_revision": "0" * 64}),
            ("DELETE", f"/api/v1/growth/goals/goal-aaaaaaaa?expected_revision={'0' * 64}", None),
        ]
        for method, url, body in protected:
            assert api.request(method, url, json=body).status_code == 401, (method, url)

        created = api.post("/api/v1/growth/assessments", headers=headers, json={"month": "2026-11"})
        assert created.status_code == 201
        assessment = created.json()["data"]
        original_revision = assessment["revision"]

        for dimension in ("mind", "body", "spirit", "vocation"):
            response = api.put(
                f"/api/v1/growth/assessments/{assessment['id']}/dimensions/{dimension}",
                headers=headers,
                json={
                    "current": f"{dimension} 用户输入",
                    "evidence": f"{dimension} 用户证据",
                    "challenges": "用户记录的挑战",
                    "direction": "用户选择的方向",
                    "expected_revision": assessment["revision"],
                },
            )
            assert response.status_code == 200
            assessment = response.json()["data"]

        stale = api.put(
            f"/api/v1/growth/assessments/{assessment['id']}/level",
            headers=headers,
            json={"level": "2.0", "expected_revision": original_revision},
        )
        assert stale.status_code == 409 and stale.json()["error"]["code"] == "REVISION_CONFLICT"

        level = api.put(
            f"/api/v1/growth/assessments/{assessment['id']}/level",
            headers=headers,
            json={"level": "2.0", "expected_revision": assessment["revision"]},
        )
        assessment = level.json()["data"]
        confirmed = api.post(
            f"/api/v1/growth/assessments/{assessment['id']}/confirm",
            headers=headers,
            json={"expected_revision": assessment["revision"]},
        )
        assert confirmed.status_code == 200
        assessment = confirmed.json()["data"]

        # A fresh HTTP read proves persistence beyond React state.
        reread = api.get("/api/v1/growth/assessments", headers=headers).json()["data"]["assessments"]
        stored = next(item for item in reread if item["id"] == assessment["id"])
        assert stored["status"] == "confirmed" and stored["dimensions"]["mind"]["current"] == "mind 用户输入"
        assert not any(key.lower() in {"growthscore", "automaticscore", "inferredscore"} for key in stored)

        timeline = api.get("/api/v1/growth/timeline", headers=headers).json()["data"]
        assert timeline["months"][0]["assessment"]["id"] == assessment["id"]

        association = api.post(
            "/api/v1/growth/associations",
            headers=headers,
            json={"from_dimension": "mind", "from_event_id": "", "to_dimension": "vocation", "to_event_id": "", "relation_type": "correlation", "note": "用户主动记录的关联"},
        ).json()["data"]
        stale_assoc = api.delete(f"/api/v1/growth/associations/{association['id']}?expected_revision={'0' * 64}", headers=headers)
        assert stale_assoc.status_code == 409
        assert api.get("/api/v1/growth/associations", headers=headers).json()["data"][0]["note"] == "用户主动记录的关联"

        goal = api.post(
            "/api/v1/growth/goals",
            headers=headers,
            json={"horizon": "monthly", "title": "用户创建的目标", "action": "用户选择的行动", "priority": "high", "due": "2026-11-30", "previous_goal_id": ""},
        ).json()["data"]
        update_body = {"title": goal["title"], "action": goal["action"], "priority": goal["priority"], "due": goal["due"], "completed": True, "previous_goal_id": "", "expected_revision": "0" * 64}
        assert api.put(f"/api/v1/growth/goals/{goal['id']}", headers=headers, json=update_body).status_code == 409
        update_body["expected_revision"] = goal["revision"]
        updated = api.put(f"/api/v1/growth/goals/{goal['id']}", headers=headers, json=update_body)
        assert updated.status_code == 200 and updated.json()["data"]["completed"] is True
        assert api.get("/api/v1/growth/goals", headers=headers).json()["data"][0]["title"] == "用户创建的目标"

        # All persisted Phase 8 records stay private/local-only and no API response leaks a path.
        assessment_file = root / "40 Reviews" / "Growth" / "History" / f"{assessment['id']}.md"
        metadata, _ = profile.read_record(assessment_file)
        assert metadata["visibility"] == "private" and metadata["ai_access"] == "local-only"
        combined = str(reread) + str(timeline) + str(association) + str(updated.json())
        assert str(root) not in combined and "growthScore" not in combined

    print("Phase 8 API, persistence, revision, and privacy acceptance tests passed")


if __name__ == "__main__":
    main()
