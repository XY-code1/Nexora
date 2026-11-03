import tempfile
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))

from apps.api import create_app
from core import profile
from core.visualization import human3_trend, privacy_audit, profile_overview, timeline


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

        client = TestClient(create_app(root, token="visual-token"), base_url="http://localhost")
        headers = {"Authorization": "Bearer visual-token"}
        assert client.get("/api/v1/visualization/profile").status_code == 401
        for endpoint in ("profile", "timeline", "privacy", "human3"):
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
