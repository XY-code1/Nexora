"""Human 3.0 growth system: canonical four dimensions, read-only aggregation, and growth assessment storage."""

from __future__ import annotations

import json
import re
import uuid
from datetime import date
from pathlib import Path
from typing import Any, Callable

from . import profile
from .access import extract_summary
from filelock import FileLock

DISCLAIMER = "Human 3.0 仅用于自我反思，不是医学或心理诊断。成长数据只来自已授权记录或用户主动填写。"
LEVEL_HINT = "Level 1.0/2.0/3.0 仅为用户自选标签，不是临床验证的心理测量工具，也不由系统自动定级。"

GROWTH_DIMENSIONS = (
    {"key": "mind", "title": "MIND", "subtitle": "认知与思维", "areas": ["认知变化", "学习经历", "思维方式", "知识积累"]},
    {"key": "body", "title": "BODY", "subtitle": "身体与精力", "areas": ["身体状态", "精力与习惯", "运动与休息"]},
    {"key": "spirit", "title": "SPIRIT", "subtitle": "意义与关系", "areas": ["关系变化", "意义与价值观", "重要经历"]},
    {"key": "vocation", "title": "VOCATION", "subtitle": "工作与创造", "areas": ["项目进展", "职业发展", "创造成果", "工作与学习目标"]},
)
GROWTH_DIMENSION_KEYS = {item["key"] for item in GROWTH_DIMENSIONS}
LEVELS = ("1.0", "2.0", "3.0")
BASE = Path("40 Reviews") / "Growth"
ASSOCIATIONS_FILE = BASE / "associations.jsonl"
GOALS_FILE = BASE / "goals.jsonl"
GOAL_HORIZONS = ("long-term", "quarterly", "monthly")
GOAL_PRIORITIES = ("low", "medium", "high")
DATA_RE = re.compile(r"(?s)<!-- growth-assessment-data\n(.*?)\n-->")


def _latest_confirmed_monthly(root: Path) -> dict[str, Any] | None:
    from . import monthly_reflection
    for item in monthly_reflection.overview(root)["reflections"]:
        if item["status"] == "confirmed":
            return item
    return None


def _latest_confirmed_human3(root: Path) -> dict[str, Any] | None:
    history = root / "40 Reviews" / "Human3" / "History"
    for path in sorted(history.glob("*.md"), reverse=True):
        text = profile.safe_vault_file(root, path).read_text(encoding="utf-8")
        metadata, body = profile.parse_record(text)
        if metadata.get("status") != "confirmed":
            continue
        scores: dict[str, float] = {}
        for key in GROWTH_DIMENSION_KEYS:
            value = metadata.get(key, "")
            if re.fullmatch(r"(?:10|[0-9])(?:\.\d+)?", value):
                scores[key] = float(value)
        return {"date": metadata.get("date", path.stem), "scores": scores, "summary": extract_summary(body)}
    return None


def dimension_overview(root: Path) -> dict[str, Any]:
    """Read-only per-dimension aggregation over confirmed records."""
    monthly = _latest_confirmed_monthly(root)
    assessment = _latest_confirmed_human3(root)
    dimensions: list[dict[str, Any]] = []
    for item in GROWTH_DIMENSIONS:
        key = item["key"]
        dimensions.append({
            "key": key, "title": item["title"], "subtitle": item["subtitle"], "areas": item["areas"],
            "month": monthly["month"] if monthly else "",
            "monthlyText": monthly["dimensions"].get(key, "") if monthly else "",
            "score": assessment["scores"].get(key) if assessment else None,
            "assessmentDate": assessment["date"] if assessment else "",
            "assessmentSummary": assessment["summary"] if assessment else "",
        })
    return {"disclaimer": DISCLAIMER, "dimensions": dimensions}


def _text(value: str, limit: int, label: str, *, required: bool = False) -> str:
    value = value.strip()
    if required and not value:
        raise SystemExit(f"{label}不能为空。")
    if len(value) > limit:
        raise SystemExit(f"{label}过长（>{limit}字符）。")
    if "<!--" in value or "-->" in value:
        raise SystemExit(f"{label}包含不允许的Markdown注释标记。")
    profile.assert_no_secret(value)
    return value


def _empty(month: str) -> dict[str, Any]:
    return {
        "month": month,
        "level": "",
        "dimensions": {key: {"current": "", "evidence": "", "challenges": "", "direction": ""} for key in GROWTH_DIMENSION_KEYS},
    }


def _body(data: dict[str, Any]) -> str:
    readable = ["# 成长自评", f"> {DISCLAIMER}"]
    for item in GROWTH_DIMENSIONS:
        dimension = data["dimensions"].get(item["key"], {})
        readable.append(f"## {item['title']} — {item['subtitle']}")
        readable.append(f"### 当前状态\n\n{dimension.get('current', '')}")
        readable.append(f"### 成长证据\n\n{dimension.get('evidence', '')}")
        readable.append(f"### 困难与挑战\n\n{dimension.get('challenges', '')}")
        readable.append(f"### 未来方向\n\n{dimension.get('direction', '')}")
    readable.append(f"## 参考层级（自选）\n\n{data.get('level', '') or '未选择'}\n\n> {LEVEL_HINT}")
    payload = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "\n\n".join(readable) + f"\n\n<!-- growth-assessment-data\n{payload}\n-->"


def _data(body: str) -> dict[str, Any]:
    match = DATA_RE.search(body)
    if not match:
        raise SystemExit("成长自评数据结构无效。")
    try:
        value = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise SystemExit("成长自评数据结构无效。") from exc
    if not isinstance(value, dict) or set(value.get("dimensions", {})) != GROWTH_DIMENSION_KEYS:
        raise SystemExit("成长自评维度结构无效。")
    return value


def _find(root: Path, assessment_id: str) -> Path:
    if not re.fullmatch(r"ga-\d{4}-\d{2}-[a-f0-9]{8}", assessment_id):
        raise SystemExit("成长自评ID无效。")
    for folder in ("Drafts", "History"):
        path = root / BASE / folder / f"{assessment_id}.md"
        if path.is_file():
            return profile.safe_vault_file(root, path)
    raise SystemExit(f"未找到成长自评：{assessment_id}")


def assessment_view(root: Path, path: Path) -> dict[str, Any]:
    path = profile.safe_vault_file(root, path)
    metadata, body = profile.parse_record(path.read_text(encoding="utf-8"))
    if metadata.get("record_type") != "growth-assessment" or metadata.get("status") not in {"draft", "confirmed"}:
        raise SystemExit("成长自评元数据无效。")
    data = _data(body)
    completed = sum(bool(data["dimensions"].get(key, {}).get("current", "").strip()) for key in GROWTH_DIMENSION_KEYS)
    return {
        "id": metadata["id"], "month": metadata["month"], "status": metadata["status"],
        "level": data.get("level", ""), "dimensions": data["dimensions"],
        "completedDimensions": completed,
        "readyToConfirm": completed == 4,
        "revision": profile.revision(path), "updated": metadata.get("updated", ""),
    }


def overview(root: Path) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for folder in ("Drafts", "History"):
        for path in (root / BASE / folder).glob("ga-*.md"):
            items.append(assessment_view(root, path))
    items.sort(key=lambda item: (item["month"], item["updated"]), reverse=True)
    return {"currentMonth": date.today().strftime("%Y-%m"), "assessments": items}


@profile.locked_write
def create(path: str, month: str) -> Path:
    root = profile.vault(path)
    if not re.fullmatch(r"\d{4}-(?:0[1-9]|1[0-2])", month):
        raise SystemExit("月份格式无效。")
    for folder in ("Drafts", "History"):
        for candidate in (root / BASE / folder).glob("ga-*.md"):
            metadata, _ = profile.parse_record(candidate.read_text(encoding="utf-8"))
            if metadata.get("month") == month:
                raise SystemExit("该月份的成长自评已存在。")
    assessment_id = f"ga-{month}-{uuid.uuid4().hex[:8]}"
    destination = root / BASE / "Drafts" / f"{assessment_id}.md"
    metadata = {"record_type": "growth-assessment", "assessment": "growth", "id": assessment_id, "month": month, "status": "draft", "visibility": "private", "ai_access": "local-only", "created": profile.now(), "updated": profile.now()}
    profile.atomic_write(destination, profile.serialize_record(metadata, _body(_empty(month))))
    return destination


def _mutate(root: Path, assessment_id: str, expected_revision: str, change: Callable[[dict[str, Any]], None]) -> Path:
    source = _find(root, assessment_id)
    profile.require_revision(source, expected_revision)
    metadata, body = profile.parse_record(source.read_text(encoding="utf-8"))
    data = _data(body)
    change(data)
    profile.assert_no_secret(json.dumps(data, ensure_ascii=False))
    metadata["updated"] = profile.now()
    if metadata["status"] == "confirmed":
        metadata["status"] = "draft"
        metadata.pop("confirmed_at", None)
        destination = root / BASE / "Drafts" / source.name
        journal, transaction = profile.begin_transaction(root, {source: source.read_text(encoding="utf-8"), destination: None})
        try:
            profile.atomic_write(destination, profile.serialize_record(metadata, _body(data)))
            source.unlink()
            profile.commit_transaction(journal, transaction)
        except BaseException:
            profile.recover_transactions(root)
            raise
        return destination
    profile.atomic_write(source, profile.serialize_record(metadata, _body(data)))
    return source


@profile.locked_write
def save_dimension(path: str, assessment_id: str, dimension: str, current: str, evidence: str, challenges: str, direction: str, expected_revision: str) -> Path:
    root = profile.vault(path)
    if dimension not in GROWTH_DIMENSION_KEYS:
        raise SystemExit("成长自评维度无效。")
    current = _text(current, 5000, "当前状态")
    evidence = _text(evidence, 5000, "成长证据")
    challenges = _text(challenges, 5000, "困难与挑战")
    direction = _text(direction, 5000, "未来方向")
    def change(data: dict[str, Any]) -> None:
        data["dimensions"][dimension] = {"current": current, "evidence": evidence, "challenges": challenges, "direction": direction}
    return _mutate(root, assessment_id, expected_revision, change)


@profile.locked_write
def save_level(path: str, assessment_id: str, level: str, expected_revision: str) -> Path:
    root = profile.vault(path)
    level = level.strip()
    if level and level not in LEVELS:
        raise SystemExit("参考层级无效，只允许 1.0 / 2.0 / 3.0 或留空。")
    return _mutate(root, assessment_id, expected_revision, lambda data: data.__setitem__("level", level))


@profile.locked_write
def confirm(path: str, assessment_id: str, expected_revision: str) -> Path:
    root = profile.vault(path)
    source = _find(root, assessment_id)
    profile.require_revision(source, expected_revision)
    metadata, body = profile.parse_record(source.read_text(encoding="utf-8"))
    data = _data(body)
    if metadata.get("status") != "draft" or not all(data["dimensions"].get(key, {}).get("current", "").strip() for key in GROWTH_DIMENSION_KEYS):
        raise SystemExit("四个维度的当前状态都填写后才能确认。")
    metadata.update({"status": "confirmed", "updated": profile.now(), "confirmed_at": profile.now()})
    destination = root / BASE / "History" / source.name
    journal, transaction = profile.begin_transaction(root, {source: source.read_text(encoding="utf-8"), destination: None})
    try:
        profile.atomic_write(destination, profile.serialize_record(metadata, _body(data)))
        source.unlink()
        profile.commit_transaction(journal, transaction)
    except BaseException:
        profile.recover_transactions(root)
        raise
    return destination


@profile.locked_write
def delete(path: str, assessment_id: str) -> Path:
    root = profile.vault(path)
    source = _find(root, assessment_id)
    archived = root / BASE / "Archived" / source.name
    metadata, body = profile.parse_record(source.read_text(encoding="utf-8"))
    metadata.update({"status": "archived", "updated": profile.now()})
    journal, transaction = profile.begin_transaction(root, {source: source.read_text(encoding="utf-8"), archived: None})
    try:
        profile.atomic_write(archived, profile.serialize_record(metadata, body))
        source.unlink()
        profile.commit_transaction(journal, transaction)
    except BaseException:
        profile.recover_transactions(root)
        raise
    return archived


def growth_timeline(root: Path, month: str | None = None) -> dict[str, Any]:
    """Read-only cross-month growth timeline over confirmed records.

    Merges three sources by month without mutating anything, and never
    overwrites historical snapshots (each record is append-only under its
    History directory).
    """
    from . import monthly_reflection

    assessments: dict[str, dict[str, Any]] = {}
    for item in overview(root)["assessments"]:
        if item["status"] == "confirmed":
            assessments[item["month"]] = item

    monthly: dict[str, dict[str, Any]] = {}
    for item in monthly_reflection.overview(root)["reflections"]:
        if item["status"] == "confirmed":
            monthly[item["month"]] = item

    human3: dict[str, dict[str, Any]] = {}
    history = root / "40 Reviews" / "Human3" / "History"
    for path in sorted(history.glob("*.md")):
        text = profile.safe_vault_file(root, path).read_text(encoding="utf-8")
        metadata, body = profile.parse_record(text)
        if metadata.get("status") != "confirmed":
            continue
        month_key = metadata.get("date", "")[:7]
        scores: dict[str, float] = {}
        for key in GROWTH_DIMENSION_KEYS:
            value = metadata.get(key, "")
            if re.fullmatch(r"(?:10|[0-9])(?:\.\d+)?", value):
                scores[key] = float(value)
        human3[month_key] = {"id": metadata.get("id", path.stem), "date": metadata.get("date", ""), "scores": scores, "summary": extract_summary(body)}

    months = sorted(set(assessments) | set(monthly) | set(human3))
    if month:
        months = [item for item in months if item == month]

    points: list[dict[str, Any]] = []
    for item in months:
        points.append({
            "month": item,
            "assessment": assessments.get(item),
            "human3": human3.get(item),
            "monthly": monthly.get(item),
        })
    return {"disclaimer": DISCLAIMER, "months": points}


def _associations_lock(root: Path) -> FileLock:
    (root / BASE).mkdir(parents=True, exist_ok=True)
    return FileLock(root / BASE / "associations.lock", timeout=10)


def _load_associations(root: Path) -> list[dict[str, Any]]:
    path = root / ASSOCIATIONS_FILE
    if not path.is_file():
        return []
    path = profile.safe_vault_file(root, path)
    records: list[dict[str, Any]] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError as exc:
            raise SystemExit(f"跨维关联数据损坏（第{number}行）。") from exc
    return records


def _rewrite_associations(root: Path, records: list[dict[str, Any]]) -> None:
    path = root / ASSOCIATIONS_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        for record in records:
            handle.write((json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8"))


def list_associations(root: Path) -> list[dict[str, Any]]:
    with _associations_lock(root):
        return _load_associations(root)


@profile.locked_write
def add_association(path: str, from_dimension: str, from_event_id: str, to_dimension: str, to_event_id: str, relation_type: str, note: str) -> dict[str, Any]:
    root = profile.vault(path)
    if from_dimension not in GROWTH_DIMENSION_KEYS or to_dimension not in GROWTH_DIMENSION_KEYS:
        raise SystemExit("跨维关联维度无效。")
    if relation_type not in {"correlation", "causation"}:
        raise SystemExit("关联类型无效，只允许 correlation 或 causation。")
    from_event_id = _text(from_event_id, 80, "起点事件ID")
    to_event_id = _text(to_event_id, 80, "终点事件ID")
    if from_event_id and not re.fullmatch(r"event-[a-f0-9]{8}", from_event_id):
        raise SystemExit("起点事件ID无效。")
    if to_event_id and not re.fullmatch(r"event-[a-f0-9]{8}", to_event_id):
        raise SystemExit("终点事件ID无效。")
    note = _text(note, 1200, "关联说明")
    if relation_type == "causation" and not note:
        raise SystemExit("因果关联必须提供说明作为依据，否则请使用 correlation。")
    record = {
        "id": f"assoc-{uuid.uuid4().hex[:8]}",
        "fromDimension": from_dimension,
        "fromEventId": from_event_id,
        "toDimension": to_dimension,
        "toEventId": to_event_id,
        "relationType": relation_type,
        "note": note,
        "createdAt": profile.now(),
    }
    with _associations_lock(root):
        records = _load_associations(root)
        records.append(record)
        _rewrite_associations(root, records)
    return record


@profile.locked_write
def delete_association(path: str, association_id: str) -> str:
    root = profile.vault(path)
    if not re.fullmatch(r"assoc-[a-f0-9]{8}", association_id):
        raise SystemExit("关联ID无效。")
    with _associations_lock(root):
        records = _load_associations(root)
        before = len(records)
        records = [record for record in records if record.get("id") != association_id]
        if len(records) == before:
            raise SystemExit("未找到跨维关联。")
        _rewrite_associations(root, records)
    return association_id


def _goals_lock(root: Path) -> FileLock:
    (root / BASE).mkdir(parents=True, exist_ok=True)
    return FileLock(root / BASE / "goals.lock", timeout=10)


def _load_goals(root: Path) -> list[dict[str, Any]]:
    path = root / GOALS_FILE
    if not path.is_file():
        return []
    path = profile.safe_vault_file(root, path)
    records: list[dict[str, Any]] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError as exc:
            raise SystemExit(f"成长目标数据损坏（第{number}行）。") from exc
    return records


def _rewrite_goals(root: Path, records: list[dict[str, Any]]) -> None:
    path = root / GOALS_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        for record in records:
            handle.write((json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8"))


def list_goals(root: Path, horizon: str | None = None) -> list[dict[str, Any]]:
    with _goals_lock(root):
        records = _load_goals(root)
    if horizon:
        if horizon not in GOAL_HORIZONS:
            raise SystemExit("目标层级无效。")
        records = [record for record in records if record.get("horizon") == horizon]
    records.sort(key=lambda record: (record.get("horizon", ""), record.get("due", "") or "9999", record.get("createdAt", "")))
    return records


@profile.locked_write
def add_goal(path: str, horizon: str, title: str, action: str, priority: str, due: str, previous_goal_id: str) -> dict[str, Any]:
    root = profile.vault(path)
    if horizon not in GOAL_HORIZONS:
        raise SystemExit("目标层级无效，只允许 long-term / quarterly / monthly。")
    if priority not in GOAL_PRIORITIES:
        raise SystemExit("目标优先级无效。")
    title = _text(title, 160, "目标", required=True)
    action = _text(action, 500, "具体行动")
    due = _text(due, 10, "截止日期")
    if due:
        try:
            date.fromisoformat(due)
        except ValueError as exc:
            raise SystemExit("截止日期无效。") from exc
    previous_goal_id = _text(previous_goal_id, 80, "关联历史目标")
    if previous_goal_id and not re.fullmatch(r"goal-[a-f0-9]{8}", previous_goal_id):
        raise SystemExit("关联历史目标ID无效。")
    record = {
        "id": f"goal-{uuid.uuid4().hex[:8]}",
        "horizon": horizon,
        "title": title,
        "action": action,
        "priority": priority,
        "due": due,
        "completed": False,
        "previousGoalId": previous_goal_id,
        "createdAt": profile.now(),
        "updatedAt": profile.now(),
    }
    with _goals_lock(root):
        records = _load_goals(root)
        records.append(record)
        _rewrite_goals(root, records)
    return record


@profile.locked_write
def update_goal(path: str, goal_id: str, *, title: str, action: str, priority: str, due: str, completed: bool, previous_goal_id: str) -> dict[str, Any]:
    root = profile.vault(path)
    if not re.fullmatch(r"goal-[a-f0-9]{8}", goal_id):
        raise SystemExit("目标ID无效。")
    if priority not in GOAL_PRIORITIES:
        raise SystemExit("目标优先级无效。")
    title = _text(title, 160, "目标", required=True)
    action = _text(action, 500, "具体行动")
    due = _text(due, 10, "截止日期")
    if due:
        try:
            date.fromisoformat(due)
        except ValueError as exc:
            raise SystemExit("截止日期无效。") from exc
    previous_goal_id = _text(previous_goal_id, 80, "关联历史目标")
    if previous_goal_id and not re.fullmatch(r"goal-[a-f0-9]{8}", previous_goal_id):
        raise SystemExit("关联历史目标ID无效。")
    with _goals_lock(root):
        records = _load_goals(root)
        target = next((record for record in records if record.get("id") == goal_id), None)
        if not target:
            raise SystemExit("未找到成长目标。")
        target.update({"title": title, "action": action, "priority": priority, "due": due, "completed": bool(completed), "previousGoalId": previous_goal_id, "updatedAt": profile.now()})
        _rewrite_goals(root, records)
        return target


@profile.locked_write
def delete_goal(path: str, goal_id: str) -> str:
    root = profile.vault(path)
    if not re.fullmatch(r"goal-[a-f0-9]{8}", goal_id):
        raise SystemExit("目标ID无效。")
    with _goals_lock(root):
        records = _load_goals(root)
        before = len(records)
        records = [record for record in records if record.get("id") != goal_id]
        if len(records) == before:
            raise SystemExit("未找到成长目标。")
        _rewrite_goals(root, records)
    return goal_id
