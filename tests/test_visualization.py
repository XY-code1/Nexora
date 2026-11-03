import tempfile
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))

from apps.api import create_app
from core import profile
from core import monthly_reflection
from core.visualization import human3_trend, monthly_trend, privacy_audit, profile_overview, timeline


def write_memory(root: Path, folder: str, name: str, *, status: str, access: str, summary: str) -> None:
    metadata = {
        "id": f"mem-20261102-{name}", "type": "note", "subject": name, "status": status,
        "created": "2026-11-02T10:00:00+00:00", "updated": "2026-11-02T11:00:00+00:00",
        "visibility": "private", "ai_access": access, "source_agent": "synthetic-test",
    }
    (root / "30 Memory" / folder / f"{name}.md").write_text(
        profile.serialize_record(metadata, f"# Memory\n\n## 摘要\n\n{summary}\n\n## 私密正文\n\n不得默认返回"), encoding="utf-8",
    )


def main():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "vault"
        profile.init(str(root))
        initial = profile_overview(root)
        assert initial["sections"] == [] and initial["hasConfirmedMemories"] is False
        write_memory(root, "Confirmed", "allowed", status="confirmed", access="summary-only", summary="可见摘要")
        write_memory(root, "Confirmed", "private", status="confirmed", access="local-only", summary="不可见摘要")
        write_memory(root, "Inbox", "candidate", status="candidate", access="allowed", summary="未确认摘要")

        rows = timeline(root)
        assert next(row for row in rows if row["subject"] == "allowed")["preview"] == "可见摘要"
        assert not next(row for row in rows if row["id"] == "mem-20261102-private")["previewAvailable"]
        protected = [row for row in rows if not row["previewAvailable"]]
        assert all(not row["subject"] and row["sourceAgent"] == "protected" and row["type"] == "protected" for row in protected)
        assert "不可见摘要" not in str(rows) and "未确认摘要" not in str(rows) and "不得默认返回" not in str(rows)

        forged = root / "30 Memory" / "Inbox" / "forged.md"
        forged.write_text(profile.serialize_record({
            "id": "mem-20261102-forged", "type": "敏感类型字段", "subject": "敏感主题", "status": "confirmed",
            "created": "2026-11-02T10:00:00+00:00", "updated": "2026-11-02T11:00:00+00:00",
            "ai_access": "allowed", "source_agent": "sensitive-agent",
        }, "## 摘要\n\n伪造确认摘要"), encoding="utf-8")
        forged_view = next(row for row in timeline(root) if row["id"] == "mem-20261102-forged")
        assert not forged_view["previewAvailable"] and not forged_view["subject"]
        assert "伪造确认摘要" not in str(forged_view) and "sensitive-agent" not in str(forged_view) and "敏感类型字段" not in str(forged_view)

        audit = privacy_audit(root)
        assert audit["totalMemories"] == 4 and audit["byAccess"]["local-only"] == 1
        overview = profile_overview(root)
        assert overview["sections"] == []  # Untouched template is an honest empty profile.
        assert overview["hasConfirmedMemories"] is True
        assert "未确认摘要" not in str(overview) and "不可见摘要" not in str(overview)

        human = root / "40 Reviews" / "Human3" / "History" / "2026-11.md"
        human.write_text(
            "---\nstatus: confirmed\ndate: 2026-11-01\nai_access: summary-only\nmind: 7\nbody: 6.5\nspirit: 8\nvocation: 7.5\n---\n\n## 摘要\n\n本月保持稳定。\n\n## 私密正文\n\n不返回\n",
            encoding="utf-8",
        )
        trend = human3_trend(root)
        assert trend["points"][0]["scores"]["body"] == 6.5
        assert trend["points"][0]["summary"] == "本月保持稳定。"

        def write_reflection(month: str, *, confirmed: bool, goals: list[dict]) -> None:
            data = monthly_reflection._empty(month)
            data["dimensions"] = {key: f"{key}-{month}" for key in monthly_reflection.DIMENSIONS}
            data["summary"] = f"{month} 摘要"
            data["summarySource"] = "user-edited"
            data["goals"] = goals
            folder = "History" if confirmed else "Drafts"
            meta = {"record_type": "monthly-reflection", "id": f"mr-{month}-00000001", "month": month, "status": "confirmed" if confirmed else "draft", "visibility": "private", "ai_access": "local-only", "created": f"{month}-01T00:00:00+00:00", "updated": f"{month}-01T00:00:00+00:00"}
            profile.atomic_write(root / monthly_reflection.BASE / folder / f"mr-{month}-00000001.md", profile.serialize_record(meta, monthly_reflection._body(data)))

        goals = [
            {"id": "goal-1", "title": "读一本书", "action": "", "priority": "medium", "due": "", "completed": True, "previousGoalId": ""},
            {"id": "goal-2", "title": "跑步", "action": "", "priority": "high", "due": "", "completed": False, "previousGoalId": ""},
        ]
        write_reflection("2026-10", confirmed=True, goals=goals)
        write_reflection("2026-11", confirmed=True, goals=[])
        write_reflection("2026-12", confirmed=False, goals=[])  # draft is excluded

        trend = monthly_trend(root)
        assert [point["month"] for point in trend["points"]] == ["2026-10", "2026-11"]
        assert trend["points"][0]["goalTotal"] == 2 and trend["points"][0]["goalCompleted"] == 1
        assert trend["points"][0]["eventCount"] == 0 and trend["points"][0]["completedDimensions"] == 4
        assert trend["points"][1]["summary"] == "2026-11 摘要"
        assert len(trend["dimensions"]) == 4 and trend["dimensions"][0]["key"] == "mind"
        for point in trend["points"]:
            assert "score" not in point and "growthScore" not in point

        client = TestClient(create_app(root, token="visual-token"), base_url="http://localhost")
        headers = {"Authorization": "Bearer visual-token"}
        assert client.get("/api/v1/visualization/profile").status_code == 401
        for endpoint in ("profile", "timeline", "privacy", "human3", "monthly"):
            response = client.get(f"/api/v1/visualization/{endpoint}", headers=headers)
            assert response.status_code == 200 and "data" in response.json()

        profile_file = root / "10 Profile" / "Profile.md"
        profile_file.write_text(profile_file.read_text(encoding="utf-8").replace("ai_access: allowed", "ai_access: denied"), encoding="utf-8")
        protected = client.get("/api/v1/visualization/profile", headers=headers).json()["data"]
        assert protected == {"access": "denied", "sections": [], "protected": True, "hasConfirmedMemories": False}

        profile_file.write_text(profile_file.read_text(encoding="utf-8").replace("ai_access: denied", "ai_access: local-only"), encoding="utf-8")
        protected = client.get("/api/v1/visualization/profile", headers=headers).json()["data"]
        assert protected == {"access": "local-only", "sections": [], "protected": True, "hasConfirmedMemories": False}

    print("visualization privacy tests passed")


if __name__ == "__main__":
    main()
