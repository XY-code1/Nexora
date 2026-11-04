import tempfile
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from core import profile
from core import growth
from core import monthly_reflection


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "vault"
        profile.init(str(root))

        # --- P8.2 dimension_overview aggregation ---
        empty = growth.dimension_overview(root)
        assert len(empty["dimensions"]) == 4
        assert all(item["monthlyText"] == "" and item["score"] is None for item in empty["dimensions"])

        data = monthly_reflection._empty("2026-11")
        data["dimensions"] = {key: f"{key}-text" for key in monthly_reflection.DIMENSIONS}
        data["summary"] = "月度摘要"
        data["summarySource"] = "user-edited"
        monthly_meta = {"record_type": "monthly-reflection", "id": "mr-2026-11-00000001", "month": "2026-11", "status": "confirmed", "visibility": "private", "ai_access": "local-only", "created": "2026-11-01T00:00:00+00:00", "updated": "2026-11-01T00:00:00+00:00"}
        profile.atomic_write(root / monthly_reflection.BASE / "History" / "mr-2026-11-00000001.md", profile.serialize_record(monthly_meta, monthly_reflection._body(data)))

        human3_meta = {"assessment": "human3", "id": "h3-20261101-00000001", "date": "2026-11-01", "status": "confirmed", "visibility": "private", "ai_access": "summary-only", "mind": "7", "body": "6", "spirit": "8", "vocation": "7.5"}
        profile.atomic_write(root / "40 Reviews" / "Human3" / "History" / "h3-20261101-00000001.md", profile.serialize_record(human3_meta, "## 摘要\n\n本月保持稳定。\n"))

        overview = growth.dimension_overview(root)
        mind = next(item for item in overview["dimensions"] if item["key"] == "mind")
        assert mind["monthlyText"] == "mind-text" and mind["score"] == 7.0
        assert mind["areas"] == ["认知变化", "学习经历", "思维方式", "知识积累"]
        assert mind["assessmentSummary"] == "本月保持稳定。"
        assert overview["dimensions"][3]["key"] == "vocation" and overview["dimensions"][3]["score"] == 7.5

        # --- P8.3 growth assessment lifecycle ---
        draft = growth.create(str(root), "2026-11")
        view = growth.assessment_view(root, draft)
        assert view["status"] == "draft" and view["completedDimensions"] == 0 and view["readyToConfirm"] is False
        aid = view["id"]

        rev = view["revision"]
        for dim in ("mind", "body", "spirit", "vocation"):
            draft = growth.save_dimension(str(root), aid, dim, f"{dim}当前", f"{dim}证据", f"{dim}困难", f"{dim}方向", rev)
            rev = growth.assessment_view(root, draft)["revision"]

        try:
            growth.save_level(str(root), aid, "9.9", rev)
            raise AssertionError("invalid level should fail")
        except SystemExit as exc:
            assert "参考层级" in str(exc)
        draft = growth.save_level(str(root), aid, "2.0", rev)
        rev = growth.assessment_view(root, draft)["revision"]

        view = growth.assessment_view(root, draft)
        assert view["completedDimensions"] == 4 and view["readyToConfirm"] is True and view["level"] == "2.0"

        history = growth.confirm(str(root), aid, rev)
        view = growth.assessment_view(root, history)
        assert view["status"] == "confirmed"

        draft2 = growth.save_dimension(str(root), aid, "mind", "更新后的当前", "", "", "", view["revision"])
        view2 = growth.assessment_view(root, draft2)
        assert view2["status"] == "draft"

        growth.delete(str(root), aid)
        for folder in ("Drafts", "History"):
            assert not (root / growth.BASE / folder / f"{aid}.md").exists()
        assert (root / growth.BASE / "Archived" / f"{aid}.md").exists()

        ov = growth.overview(root)
        assert all(item["id"] != aid for item in ov["assessments"])

        # --- P8.4 growth timeline ---
        draft3 = growth.create(str(root), "2026-10")
        view3 = growth.assessment_view(root, draft3)
        aid3 = view3["id"]
        rev3 = view3["revision"]
        for dim in ("mind", "body", "spirit", "vocation"):
            draft3 = growth.save_dimension(str(root), aid3, dim, f"{dim}-oct", "", "", "", rev3)
            rev3 = growth.assessment_view(root, draft3)["revision"]
        growth.confirm(str(root), aid3, rev3)

        timeline = growth.growth_timeline(root)
        months = [point["month"] for point in timeline["months"]]
        assert months == ["2026-10", "2026-11"], months

        oct_point = next(point for point in timeline["months"] if point["month"] == "2026-10")
        assert oct_point["assessment"]["id"] == aid3
        assert oct_point["assessment"]["dimensions"]["mind"]["current"] == "mind-oct"
        assert oct_point["monthly"] is None and oct_point["human3"] is None

        nov_point = next(point for point in timeline["months"] if point["month"] == "2026-11")
        assert nov_point["assessment"] is None
        assert nov_point["monthly"] is not None and nov_point["human3"] is not None
        assert nov_point["human3"]["scores"]["mind"] == 7.0

        filtered = growth.growth_timeline(root, month="2026-10")
        assert [point["month"] for point in filtered["months"]] == ["2026-10"]

        # historical snapshot preserved: the October assessment keeps its original text
        assert oct_point["assessment"]["dimensions"]["vocation"]["current"] == "vocation-oct"

        # --- P8.5 cross-dimension associations ---
        assert growth.list_associations(root) == []

        assoc1 = growth.add_association(str(root), "mind", "", "body", "", "correlation", "")
        assert assoc1["relationType"] == "correlation"

        try:
            growth.add_association(str(root), "body", "", "vocation", "", "causation", "")
            raise AssertionError("causation without note should fail")
        except SystemExit as exc:
            assert "因果关联" in str(exc)

        assoc2 = growth.add_association(str(root), "spirit", "event-abc12345", "vocation", "", "causation", "关系变化推动了工作产出")
        assert assoc2["relationType"] == "causation" and assoc2["fromEventId"] == "event-abc12345"

        try:
            growth.add_association(str(root), "not-a-dim", "", "body", "", "correlation", "")
            raise AssertionError("invalid dimension should fail")
        except SystemExit as exc:
            assert "维度无效" in str(exc)
        try:
            growth.add_association(str(root), "mind", "", "body", "", "unknown", "")
            raise AssertionError("invalid type should fail")
        except SystemExit as exc:
            assert "类型无效" in str(exc)
        try:
            growth.add_association(str(root), "mind", "bad-event", "body", "", "correlation", "")
            raise AssertionError("invalid event id should fail")
        except SystemExit as exc:
            assert "事件ID" in str(exc)

        listed = growth.list_associations(root)
        assert len(listed) == 2
        assert {item["id"] for item in listed} == {assoc1["id"], assoc2["id"]}

        growth.delete_association(str(root), assoc1["id"])
        listed = growth.list_associations(root)
        assert len(listed) == 1 and listed[0]["id"] == assoc2["id"]

        # --- P8.6 goals & action plan ---
        assert growth.list_goals(root) == []

        goal1 = growth.add_goal(str(root), "long-term", "建立长期健康习惯", "每天记录", "high", "2027-12-31", "")
        assert goal1["horizon"] == "long-term" and goal1["completed"] is False
        goal2 = growth.add_goal(str(root), "quarterly", "季度目标", "行动", "medium", "", goal1["id"])
        assert goal2["previousGoalId"] == goal1["id"]
        goal3 = growth.add_goal(str(root), "monthly", "本月目标", "", "low", "2026-11-30", "")

        try:
            growth.add_goal(str(root), "yearly", "x", "", "low", "", "")
            raise AssertionError("invalid horizon should fail")
        except SystemExit as exc:
            assert "目标层级" in str(exc)
        try:
            growth.add_goal(str(root), "monthly", "x", "", "urgent", "", "")
            raise AssertionError("invalid priority should fail")
        except SystemExit as exc:
            assert "优先级" in str(exc)
        try:
            growth.add_goal(str(root), "monthly", "x", "", "low", "2026-13-01", "")
            raise AssertionError("invalid due should fail")
        except SystemExit as exc:
            assert "截止日期" in str(exc)
        try:
            growth.add_goal(str(root), "monthly", "x", "", "low", "", "bad-goal")
            raise AssertionError("invalid previous id should fail")
        except SystemExit as exc:
            assert "关联历史目标" in str(exc)

        updated = growth.update_goal(str(root), goal3["id"], title="本月目标", action="推进", priority="low", due="2026-11-30", completed=True, previous_goal_id="")
        assert updated["completed"] is True

        long_term = growth.list_goals(root, horizon="long-term")
        assert len(long_term) == 1 and long_term[0]["id"] == goal1["id"]
        monthly = growth.list_goals(root, horizon="monthly")
        assert len(monthly) == 1 and monthly[0]["completed"] is True

        growth.delete_goal(str(root), goal2["id"])
        assert all(item["id"] != goal2["id"] for item in growth.list_goals(root))
        assert len(growth.list_goals(root)) == 2

    print("growth dimensions, assessment, timeline, associations, and goals tests passed")


if __name__ == "__main__":
    main()
