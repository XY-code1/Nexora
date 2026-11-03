"""Local-first monthly reflections with explicit confirmation and revision control."""

from __future__ import annotations

import json
import re
import uuid
from datetime import date
from pathlib import Path
from typing import Any, Callable

from . import profile

DIMENSIONS = {
    "mind": "MIND — 认知与思维",
    "body": "BODY — 身体与精力",
    "spirit": "SPIRIT — 意义与关系",
    "vocation": "VOCATION — 工作与创造",
}
BASE = Path("40 Reviews") / "Monthly"
DATA_RE = re.compile(r"(?s)<!-- monthly-reflection-data\n(.*?)\n-->")


def _text(value: str, limit: int, label: str, required: bool = False) -> str:
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
        "dimensions": {key: "" for key in DIMENSIONS},
        "events": [],
        "summary": "",
        "summarySource": "",
        "goals": [],
    }


def _body(data: dict[str, Any]) -> str:
    readable = ["# 月度复盘"]
    for key, title in DIMENSIONS.items():
        readable.append(f"## {title}\n\n{data['dimensions'].get(key, '')}")
    readable.append(f"## 复盘摘要\n\n{data.get('summary', '')}")
    readable.append("## 重要事件\n\n" + "\n".join(f"- {item['date']} · {item['title']}" for item in data.get("events", [])))
    readable.append("## 下月目标\n\n" + "\n".join(f"- [{ 'x' if item.get('completed') else ' ' }] {item['title']}" for item in data.get("goals", [])))
    payload = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "\n\n".join(readable) + f"\n\n<!-- monthly-reflection-data\n{payload}\n-->"


def _data(body: str) -> dict[str, Any]:
    match = DATA_RE.search(body)
    if not match:
        raise SystemExit("月度复盘数据结构无效。")
    try:
        value = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise SystemExit("月度复盘数据结构无效。") from exc
    if not isinstance(value, dict) or set(value.get("dimensions", {})) != set(DIMENSIONS):
        raise SystemExit("月度复盘维度结构无效。")
    return value


def _find(root: Path, reflection_id: str) -> Path:
    if not re.fullmatch(r"mr-\d{4}-\d{2}-[a-f0-9]{8}", reflection_id):
        raise SystemExit("月度复盘ID无效。")
    for folder in ("Drafts", "History"):
        path = root / BASE / folder / f"{reflection_id}.md"
        if path.is_file():
            return profile.safe_vault_file(root, path)
    raise SystemExit(f"未找到月度复盘：{reflection_id}")


def reflection_view(root: Path, path: Path) -> dict[str, Any]:
    path = profile.safe_vault_file(root, path)
    metadata, body = profile.parse_record(path.read_text(encoding="utf-8"))
    if metadata.get("record_type") != "monthly-reflection" or metadata.get("status") not in {"draft", "confirmed"}:
        raise SystemExit("月度复盘元数据无效。")
    data = _data(body)
    completed = sum(bool(data["dimensions"].get(key, "").strip()) for key in DIMENSIONS)
    return {
        "id": metadata["id"], "month": metadata["month"], "status": metadata["status"],
        "dimensions": data["dimensions"], "events": data.get("events", []),
        "summary": data.get("summary", ""), "summarySource": data.get("summarySource", ""),
        "goals": data.get("goals", []), "completedDimensions": completed,
        "readyToConfirm": completed == 4 and bool(data.get("summary", "")),
        "revision": profile.revision(path), "updated": metadata.get("updated", ""),
    }


def overview(root: Path) -> dict[str, Any]:
    items = []
    for folder in ("Drafts", "History"):
        for path in (root / BASE / folder).glob("mr-*.md"):
            items.append(reflection_view(root, path))
    items.sort(key=lambda item: (item["month"], item["updated"]), reverse=True)
    return {"currentMonth": date.today().strftime("%Y-%m"), "reflections": items}


@profile.locked_write
def create(path: str, month: str) -> Path:
    root = profile.vault(path)
    if not re.fullmatch(r"\d{4}-(?:0[1-9]|1[0-2])", month):
        raise SystemExit("月份格式无效。")
    for folder in ("Drafts", "History"):
        for candidate in (root / BASE / folder).glob("mr-*.md"):
            metadata, _ = profile.parse_record(candidate.read_text(encoding="utf-8"))
            if metadata.get("month") == month:
                raise SystemExit("该月份的复盘已存在。")
    reflection_id = f"mr-{month}-{uuid.uuid4().hex[:8]}"
    destination = root / BASE / "Drafts" / f"{reflection_id}.md"
    metadata = {"record_type": "monthly-reflection", "id": reflection_id, "month": month, "status": "draft", "visibility": "private", "ai_access": "local-only", "created": profile.now(), "updated": profile.now()}
    profile.atomic_write(destination, profile.serialize_record(metadata, _body(_empty(month))))
    return destination


def _mutate(root: Path, reflection_id: str, expected_revision: str, change: Callable[[dict[str, Any]], None]) -> Path:
    source = _find(root, reflection_id)
    profile.require_revision(source, expected_revision)
    metadata, body = profile.parse_record(source.read_text(encoding="utf-8"))
    data = _data(body)
    change(data)
    profile.assert_no_secret(json.dumps(data, ensure_ascii=False))
    metadata["updated"] = profile.now()
    # Editing confirmed history requires a new explicit confirmation.
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
def save_dimension(path: str, reflection_id: str, dimension: str, content: str, expected_revision: str) -> Path:
    root = profile.vault(path)
    if dimension not in DIMENSIONS:
        raise SystemExit("复盘维度无效。")
    content = _text(content, 5000, "维度内容")
    return _mutate(root, reflection_id, expected_revision, lambda data: data["dimensions"].__setitem__(dimension, content))


@profile.locked_write
def add_event(path: str, reflection_id: str, event: dict[str, str], expected_revision: str) -> Path:
    root = profile.vault(path)
    clean = {
        "id": f"event-{uuid.uuid4().hex[:8]}", "title": _text(event.get("title", ""), 120, "事件标题", True),
        "date": event.get("date", ""), "dimension": event.get("dimension", ""),
        "description": _text(event.get("description", ""), 1200, "事件描述"),
        "feeling": _text(event.get("feeling", ""), 500, "个人感受"),
        "project": _text(event.get("project", ""), 120, "关联项目"),
    }
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", clean["date"]) or clean["dimension"] not in DIMENSIONS:
        raise SystemExit("事件日期或所属维度无效。")
    try:
        date.fromisoformat(clean["date"])
    except ValueError as exc:
        raise SystemExit("事件日期无效。") from exc
    def change(data: dict[str, Any]) -> None:
        if not clean["date"].startswith(f"{data['month']}-"):
            raise SystemExit("重要事件必须属于当前复盘月份。")
        data["events"].append(clean)
    return _mutate(root, reflection_id, expected_revision, change)


@profile.locked_write
def delete_event(path: str, reflection_id: str, event_id: str, expected_revision: str) -> Path:
    root = profile.vault(path)
    def change(data: dict[str, Any]) -> None:
        before = len(data["events"])
        data["events"] = [item for item in data["events"] if item.get("id") != event_id]
        if len(data["events"]) == before:
            raise SystemExit("未找到重要事件。")
    return _mutate(root, reflection_id, expected_revision, change)


@profile.locked_write
def save_goals(path: str, reflection_id: str, goals: list[dict[str, Any]], expected_revision: str) -> Path:
    root = profile.vault(path)
    if len(goals) > 30:
        raise SystemExit("目标数量过多。")
    clean = []
    for item in goals:
        priority = item.get("priority", "medium")
        if priority not in {"low", "medium", "high"}:
            raise SystemExit("目标优先级无效。")
        due = str(item.get("due", ""))
        if due and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", due):
            raise SystemExit("目标日期无效。")
        if due:
            try:
                date.fromisoformat(due)
            except ValueError as exc:
                raise SystemExit("目标日期无效。") from exc
        clean.append({"id": str(item.get("id") or f"goal-{uuid.uuid4().hex[:8]}"), "title": _text(str(item.get("title", "")), 160, "目标", True), "action": _text(str(item.get("action", "")), 500, "具体行动"), "priority": priority, "due": due, "completed": bool(item.get("completed", False)), "previousGoalId": _text(str(item.get("previousGoalId", "")), 80, "关联目标")})
    return _mutate(root, reflection_id, expected_revision, lambda data: data.__setitem__("goals", clean))


@profile.locked_write
def generate_summary(path: str, reflection_id: str, expected_revision: str) -> Path:
    """Build an extractive local draft; no content leaves the Vault."""
    root = profile.vault(path)
    def change(data: dict[str, Any]) -> None:
        sources = [(DIMENSIONS[key].split(" — ", 1)[0], data["dimensions"].get(key, "").strip()) for key in DIMENSIONS]
        present = [(label, text) for label, text in sources if text]
        if not present:
            raise SystemExit("请先填写至少一个维度，再生成摘要草稿。")
        excerpts: list[str] = []
        for label, text in present:
            first = re.split(r"[。！？\n]", text, maxsplit=1)[0][:180]
            excerpts.append(f"{label}：{first}")
        data["summary"] = "；".join(excerpts) + "。"
        data["summarySource"] = "local-extractive"
    return _mutate(root, reflection_id, expected_revision, change)


@profile.locked_write
def save_summary(path: str, reflection_id: str, summary: str, expected_revision: str) -> Path:
    root = profile.vault(path)
    summary = _text(summary, 2400, "复盘摘要", True)
    return _mutate(root, reflection_id, expected_revision, lambda data: data.update({"summary": summary, "summarySource": "user-edited"}))


@profile.locked_write
def confirm(path: str, reflection_id: str, expected_revision: str) -> Path:
    root = profile.vault(path)
    source = _find(root, reflection_id)
    profile.require_revision(source, expected_revision)
    metadata, body = profile.parse_record(source.read_text(encoding="utf-8"))
    data = _data(body)
    if metadata.get("status") != "draft" or not all(data["dimensions"].get(key, "").strip() for key in DIMENSIONS) or not data.get("summary", "").strip():
        raise SystemExit("四个维度和可编辑摘要完成后才能确认正式复盘。")
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
