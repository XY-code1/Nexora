"""Local Human 3.0 reflection drafts and explicit confirmation lifecycle."""

from __future__ import annotations

import re
import uuid
from datetime import date
from pathlib import Path
from typing import Any

from . import profile

DISCLAIMER = "Human 3.0 仅用于自我反思，不是医学或心理诊断。"
DIMENSIONS = (
    {"key": "mind", "title": "心智与认知", "prompt": "最近哪些事实改变了你的看法？当前最大的认知冲突是什么？"},
    {"key": "body", "title": "身体与精力", "prompt": "最近的睡眠、活动和精力有哪些可以被具体观察的变化？"},
    {"key": "spirit", "title": "意义、关系与价值观", "prompt": "最近什么事情让你感到有意义？哪些关系或责任最重要？"},
    {"key": "vocation", "title": "工作、技能与创造", "prompt": "你正在解决什么问题？近期有哪些真实产出、阻碍或学习证据？"},
)
DIMENSION_KEYS = {item["key"] for item in DIMENSIONS}
EVIDENCE_STATES = {"sufficient", "limited", "insufficient"}


def _check_text(value: str, limit: int, label: str, *, required: bool = True) -> str:
    value = value.strip()
    if required and not value:
        raise SystemExit(f"{label}不能为空。")
    if len(value) > limit:
        raise SystemExit(f"{label}过长（>{limit}字符）。")
    if re.search(r"(?m)^#{2,3}", value):
        raise SystemExit(f"{label}不能包含二级或三级Markdown标题。")
    profile.assert_no_secret(value)
    return value


def _subsection(section: str, heading: str) -> str:
    match = re.search(rf"(?ims)^###[ \t]*{re.escape(heading)}[ \t]*\n(.*?)(?=\n###[ \t]|\Z)", section)
    return match.group(1).strip() if match else ""


def _section(body: str, heading: str) -> str:
    match = re.search(rf"(?ims)^##[ \t]*{re.escape(heading)}[ \t]*\n(.*?)(?=\n##[ \t]|\Z)", body)
    return match.group(1).strip() if match else ""


def _empty_answers() -> dict[str, dict[str, Any]]:
    return {item["key"]: {"reflection": "", "evidence": "", "evidenceState": "insufficient", "score": None} for item in DIMENSIONS}


def _parse_body(body: str) -> tuple[dict[str, dict[str, Any]], str, str]:
    answers = _empty_answers()
    for item in DIMENSIONS:
        section = _section(body, item["title"])
        score_text = _subsection(section, "自评分")
        answers[item["key"]] = {
            "reflection": _subsection(section, "反思"),
            "evidence": _subsection(section, "依据"),
            "evidenceState": _subsection(section, "信息状态") or "insufficient",
            "score": float(score_text) if re.fullmatch(r"(?:10|[0-9])(?:\.\d+)?", score_text) else None,
        }
    return answers, _section(body, "摘要"), _section(body, "未来30天行动计划")


def _body(answers: dict[str, dict[str, Any]], summary: str = "", plan: str = "") -> str:
    parts = [f"# Human 3.0 月度复盘\n\n> {DISCLAIMER}"]
    for item in DIMENSIONS:
        answer = answers[item["key"]]
        score = "" if answer["score"] is None else str(answer["score"])
        parts.append(
            f"## {item['title']}\n\n### 反思\n\n{answer['reflection']}\n\n"
            f"### 依据\n\n{answer['evidence']}\n\n### 信息状态\n\n{answer['evidenceState']}\n\n### 自评分\n\n{score}"
        )
    parts.extend((f"## 摘要\n\n{summary}", f"## 未来30天行动计划\n\n{plan}"))
    return "\n\n".join(parts)


def _draft_path(root: Path, session_id: str) -> Path:
    if not re.fullmatch(r"h3-[0-9]{8}-[a-f0-9]{8}", session_id):
        raise SystemExit("复盘ID无效。")
    path = root / "40 Reviews" / "Human3" / "Answers" / f"{session_id}.md"
    if not path.is_file():
        raise SystemExit(f"未找到复盘草稿：{session_id}")
    return profile.safe_vault_file(root, path)


def session_view(root: Path, path: Path) -> dict[str, Any]:
    path = profile.safe_vault_file(root, path)
    metadata, body = profile.parse_record(path.read_text(encoding="utf-8"))
    if metadata.get("assessment") != "human3" or metadata.get("status") != "draft":
        raise SystemExit("Human 3.0草稿元数据无效。")
    answers, summary, plan = _parse_body(body)
    dimensions = []
    for item in DIMENSIONS:
        answer = answers[item["key"]]
        dimensions.append({**item, **answer, "answered": bool(answer["reflection"] and answer["score"] is not None)})
    return {
        "id": metadata["id"], "date": metadata["date"], "status": "draft",
        "dimensions": dimensions, "summary": summary, "plan": plan,
        "readyToConfirm": all(item["answered"] for item in dimensions) and bool(summary and plan),
        "revision": profile.revision(path), "disclaimer": DISCLAIMER,
    }


def current_session(root: Path) -> dict[str, Any] | None:
    drafts = sorted((root / "40 Reviews" / "Human3" / "Answers").glob("h3-*.md"), reverse=True)
    return session_view(root, drafts[0]) if drafts else None


def _validated_final(session_id: str, metadata: dict[str, str], body: str) -> tuple[dict[str, dict[str, Any]], str, str, str]:
    if (
        metadata.get("assessment") != "human3" or metadata.get("id") != session_id
        or metadata.get("status") != "draft" or metadata.get("visibility") != "private"
        or metadata.get("ai_access") != "summary-only" or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", metadata.get("date", ""))
    ):
        raise SystemExit("Human 3.0草稿元数据无效。")
    profile.assert_no_secret(body)
    answers, summary, plan = _parse_body(body)
    for item in DIMENSIONS:
        answer = answers[item["key"]]
        if answer["evidenceState"] not in EVIDENCE_STATES or answer["score"] is None or not 0 <= answer["score"] <= 10:
            raise SystemExit("Human 3.0草稿包含无效的信息状态或评分。")
        _check_text(answer["reflection"], 2000, "反思")
        _check_text(answer["evidence"], 1200, "依据", required=answer["evidenceState"] != "insufficient")
    summary = _check_text(summary, 1600, "复盘摘要")
    plan = _check_text(plan, 1600, "30天行动计划")
    canonical = _body(answers, summary, plan)
    if body.strip() != canonical.strip():
        raise SystemExit("Human 3.0草稿结构已被修改，请通过本地界面重新保存后再确认。")
    return answers, summary, plan, canonical


@profile.locked_write
def start_session(path: str) -> Path:
    root = profile.vault(path)
    if current_session(root):
        raise SystemExit("已有进行中的Human 3.0复盘。")
    if any((root / "40 Reviews" / "Human3" / "Answers").glob("*.md")):
        raise SystemExit("检测到旧版Human 3.0草稿；请先在Obsidian中处理后再开始新版复盘。")
    session_id = f"h3-{date.today().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8]}"
    destination = root / "40 Reviews" / "Human3" / "Answers" / f"{session_id}.md"
    metadata = {
        "assessment": "human3", "id": session_id, "date": date.today().isoformat(), "status": "draft",
        "visibility": "private", "ai_access": "summary-only", "created": profile.now(), "updated": profile.now(),
    }
    profile.atomic_write(destination, profile.serialize_record(metadata, _body(_empty_answers())))
    return destination


@profile.locked_write
def save_dimension(path: str, session_id: str, dimension: str, reflection: str, evidence: str, evidence_state: str, score: float, expected_revision: str) -> Path:
    root = profile.vault(path)
    source = _draft_path(root, session_id)
    profile.require_revision(source, expected_revision)
    if dimension not in DIMENSION_KEYS or evidence_state not in EVIDENCE_STATES or not 0 <= score <= 10:
        raise SystemExit("复盘维度、信息状态或评分无效。")
    reflection = _check_text(reflection, 2000, "反思")
    evidence = _check_text(evidence, 1200, "依据", required=evidence_state != "insufficient")
    metadata, body = profile.parse_record(source.read_text(encoding="utf-8"))
    answers, summary, plan = _parse_body(body)
    answers[dimension] = {"reflection": reflection, "evidence": evidence, "evidenceState": evidence_state, "score": score}
    metadata["updated"] = profile.now()
    profile.atomic_write(source, profile.serialize_record(metadata, _body(answers, summary, plan)))
    return source


@profile.locked_write
def save_conclusion(path: str, session_id: str, summary: str, plan: str, expected_revision: str) -> Path:
    root = profile.vault(path)
    source = _draft_path(root, session_id)
    profile.require_revision(source, expected_revision)
    summary = _check_text(summary, 1600, "复盘摘要")
    plan = _check_text(plan, 1600, "30天行动计划")
    metadata, body = profile.parse_record(source.read_text(encoding="utf-8"))
    answers, _, _ = _parse_body(body)
    metadata["updated"] = profile.now()
    profile.atomic_write(source, profile.serialize_record(metadata, _body(answers, summary, plan)))
    return source


@profile.locked_write
def confirm_session(path: str, session_id: str, expected_revision: str) -> Path:
    root = profile.vault(path)
    source = _draft_path(root, session_id)
    profile.require_revision(source, expected_revision)
    metadata, body = profile.parse_record(source.read_text(encoding="utf-8"))
    answers, _, _, body = _validated_final(session_id, metadata, body)
    metadata = {
        "assessment": "human3", "id": session_id, "date": metadata["date"], "status": "confirmed",
        "visibility": "private", "ai_access": "summary-only", "created": metadata.get("created", ""),
        "updated": profile.now(), "confirmed_at": profile.now(),
    }
    for key, answer in answers.items():
        metadata[key] = str(answer["score"])
    destination = root / "40 Reviews" / "Human3" / "History" / f"{session_id}.md"
    if destination.exists():
        raise SystemExit("同名Human 3.0历史记录已存在。")
    journal, transaction = profile.begin_transaction(root, {source: source.read_text(encoding="utf-8"), destination: None})
    try:
        profile.atomic_write(destination, profile.serialize_record(metadata, body))
        source.unlink()
        profile.commit_transaction(journal, transaction)
    except BaseException:
        profile.recover_transactions(root)
        raise
    return destination
