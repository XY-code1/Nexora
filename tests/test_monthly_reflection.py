import sys
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))

from apps.api import create_app
from core import profile


def main():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "vault"
        profile.init(str(root))
        client = TestClient(create_app(root, token="monthly-token"), base_url="http://localhost")
        headers = {"Authorization": "Bearer monthly-token"}
        assert client.get("/api/v1/monthly-reflections").status_code == 401
        protected = [
            ("POST", "/api/v1/monthly-reflections", {"month": "2026-11"}),
            ("GET", "/api/v1/monthly-reflections/mr-2026-11-1234abcd", None),
            ("PUT", "/api/v1/monthly-reflections/mr-2026-11-1234abcd/dimensions/mind", {"content": "x", "expected_revision": "a" * 64}),
            ("POST", "/api/v1/monthly-reflections/mr-2026-11-1234abcd/events", {"title": "x", "date": "2026-11-03", "dimension": "mind", "expected_revision": "a" * 64}),
            ("DELETE", "/api/v1/monthly-reflections/mr-2026-11-1234abcd/events/event-1234?expected_revision=" + "a" * 64, None),
            ("PUT", "/api/v1/monthly-reflections/mr-2026-11-1234abcd/goals", {"goals": [], "expected_revision": "a" * 64}),
            ("POST", "/api/v1/monthly-reflections/mr-2026-11-1234abcd/summary-draft", {"expected_revision": "a" * 64}),
            ("PUT", "/api/v1/monthly-reflections/mr-2026-11-1234abcd/summary", {"summary": "x", "expected_revision": "a" * 64}),
            ("POST", "/api/v1/monthly-reflections/mr-2026-11-1234abcd/confirm", {"expected_revision": "a" * 64}),
        ]
        for method, url, payload in protected:
            assert client.request(method, url, json=payload).status_code == 401, f"missing Bearer guard: {method} {url}"
        empty = client.get("/api/v1/monthly-reflections", headers=headers).json()["data"]
        assert empty["reflections"] == []

        created = client.post("/api/v1/monthly-reflections", headers=headers, json={"month": "2026-11"})
        assert created.status_code == 201
        item = created.json()["data"]
        assert item["status"] == "draft" and item["completedDimensions"] == 0
        assert client.post("/api/v1/monthly-reflections", headers=headers, json={"month": "2026-11"}).status_code == 409

        stale = item["revision"]
        for dimension in ("mind", "body", "spirit", "vocation"):
            saved = client.put(
                f"/api/v1/monthly-reflections/{item['id']}/dimensions/{dimension}", headers=headers,
                json={"content": f"{dimension} 的真实月度记录。", "expected_revision": item["revision"]},
            )
            assert saved.status_code == 200
            item = saved.json()["data"]
        conflict = client.put(
            f"/api/v1/monthly-reflections/{item['id']}/dimensions/mind", headers=headers,
            json={"content": "冲突修改", "expected_revision": stale},
        )
        assert conflict.status_code == 409

        invalid_calendar = client.post(
            f"/api/v1/monthly-reflections/{item['id']}/events", headers=headers,
            json={"title": "无效日期", "date": "2026-11-31", "dimension": "mind", "expected_revision": item["revision"]},
        )
        assert invalid_calendar.status_code == 400
        wrong_month = client.post(
            f"/api/v1/monthly-reflections/{item['id']}/events", headers=headers,
            json={"title": "错误月份", "date": "2026-10-03", "dimension": "mind", "expected_revision": item["revision"]},
        )
        assert wrong_month.status_code == 400

        added = client.post(
            f"/api/v1/monthly-reflections/{item['id']}/events", headers=headers,
            json={"title": "发布本地版本", "date": "2026-11-03", "dimension": "vocation", "description": "完成阶段功能", "feeling": "踏实", "project": "Personal AI Profile", "expected_revision": item["revision"]},
        )
        item = added.json()["data"]
        assert len(item["events"]) == 1
        deleted = client.delete(f"/api/v1/monthly-reflections/{item['id']}/events/{item['events'][0]['id']}?expected_revision={item['revision']}", headers=headers)
        item = deleted.json()["data"]
        assert item["events"] == []

        goals = [{"id": "goal-1", "title": "完成下一阶段", "action": "每周推进", "priority": "high", "due": "2026-12-20", "completed": False, "previousGoalId": ""}]
        item = client.put(f"/api/v1/monthly-reflections/{item['id']}/goals", headers=headers, json={"goals": goals, "expected_revision": item["revision"]}).json()["data"]
        assert item["goals"][0]["priority"] == "high"
        goals[0].update({"title": "完成并复核下一阶段", "completed": True})
        item = client.put(f"/api/v1/monthly-reflections/{item['id']}/goals", headers=headers, json={"goals": goals, "expected_revision": item["revision"]}).json()["data"]
        assert item["goals"][0]["title"] == "完成并复核下一阶段" and item["goals"][0]["completed"] is True
        item = client.put(f"/api/v1/monthly-reflections/{item['id']}/goals", headers=headers, json={"goals": [], "expected_revision": item["revision"]}).json()["data"]
        assert item["goals"] == []

        # Local extractive summary uses only persisted user text and no provider/network call.
        item = client.post(f"/api/v1/monthly-reflections/{item['id']}/summary-draft", headers=headers, json={"expected_revision": item["revision"]}).json()["data"]
        assert item["summarySource"] == "local-extractive" and "mind 的真实月度记录" in item["summary"]
        assert all(f"{dimension} 的真实月度记录" in item["summary"] for dimension in ("mind", "body", "spirit", "vocation"))
        assert "诊断" not in item["summary"] and "评分" not in item["summary"]
        item = client.put(f"/api/v1/monthly-reflections/{item['id']}/summary", headers=headers, json={"summary": "这是我编辑并认可的月度总结。", "expected_revision": item["revision"]}).json()["data"]
        assert item["summarySource"] == "user-edited" and item["readyToConfirm"]
        confirmed = client.post(f"/api/v1/monthly-reflections/{item['id']}/confirm", headers=headers, json={"expected_revision": item["revision"]})
        assert confirmed.status_code == 200 and confirmed.json()["data"]["status"] == "confirmed"

        # Refresh/history query restores persisted content.
        overview = client.get("/api/v1/monthly-reflections", headers=headers).json()["data"]
        assert overview["reflections"][0]["summary"] == "这是我编辑并认可的月度总结。"
        assert (root / "40 Reviews" / "Monthly" / "History" / f"{item['id']}.md").is_file()

        # Editing history returns it to draft and requires explicit confirmation again.
        history = overview["reflections"][0]
        revised = client.put(f"/api/v1/monthly-reflections/{item['id']}/dimensions/mind", headers=headers, json={"content": "历史内容由用户修改。", "expected_revision": history["revision"]}).json()["data"]
        assert revised["status"] == "draft"
        assert (root / "40 Reviews" / "Monthly" / "Drafts" / f"{item['id']}.md").is_file()
        assert not (root / "40 Reviews" / "Monthly" / "History" / f"{item['id']}.md").exists()

    print("monthly reflection lifecycle tests passed")


if __name__ == "__main__":
    main()
