"""Deterministic, consent-based onboarding that only creates candidate memories."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from . import profile

TOPICS = (
    {"key": "identity", "title": "称呼与基本偏好", "prompt": "我应该怎么称呼你？你常用什么语言和时区？只回答你愿意长期保存的部分。"},
    {"key": "communication", "title": "沟通方式", "prompt": "你希望 AI 如何组织回答？例如先给结论、详细程度，以及希望避免的表达方式。"},
    {"key": "goals", "title": "长期目标", "prompt": "未来半年到一年，你最希望持续推进的一到三个目标是什么？"},
    {"key": "current_focus", "title": "当前关注", "prompt": "你现在主要在推进哪些项目、学习方向或生活事项？"},
    {"key": "boundaries", "title": "隐私与协作边界", "prompt": "哪些信息不应被 AI 记住、推断或跨工具分享？不要填写密码、Token、证件或银行卡信息。"},
)
TOPIC_KEYS = {item["key"] for item in TOPICS}


def _profile_known(root: Path) -> set[str]:
    text = profile.safe_vault_file(root, root / "10 Profile" / "Profile.md").read_text(encoding="utf-8")
    _, body = profile.parse_record(text)
    known = set()
    if re.search(r"(?mi)^-[ \t]*Preferred name:[ \t]*\S+", body):
        known.add("identity")
    for heading, key in (("Stable preferences", "communication"), ("Long-term goals", "goals")):
        match = re.search(rf"(?ims)^##\s*{re.escape(heading)}\s*\n(.+?)(?=\n##\s|\Z)", body)
        if match and any(line[2:].strip() for line in match.group(1).splitlines() if line.startswith("- ")):
            known.add(key)
    active = root / "20 Projects" / "Active"
    if any(active.glob("*.md")):
        known.add("current_focus")
    return known


def onboarding_state(root: Path) -> dict[str, Any]:
    statuses = {key: "available" for key in TOPIC_KEYS}
    for key in _profile_known(root):
        statuses[key] = "confirmed"
    for folder, status in (("Confirmed", "confirmed"), ("Inbox", "pending")):
        for path in (root / profile.MEMORY_ROOT / folder).glob("*.md"):
            path = profile.safe_vault_file(root, path)
            metadata, _ = profile.read_record(path)
            subject = metadata.get("subject", "")
            if subject.startswith("onboarding-"):
                key = subject.removeprefix("onboarding-")
                if key in statuses and (status == "confirmed" or statuses[key] == "available"):
                    statuses[key] = status
    topics = [{**topic, "status": statuses[topic["key"]]} for topic in TOPICS]
    next_topic = next((topic["key"] for topic in topics if topic["status"] == "available"), None)
    return {
        "topics": topics,
        "nextTopic": next_topic,
        "completed": next_topic is None,
        "notice": "回答只会保存为候选记忆，必须由你在记忆审核中确认后才成为长期事实。",
    }


def propose_answer(root: Path, topic: str, content: str) -> Path:
    if topic not in TOPIC_KEYS:
        raise SystemExit("引导主题无效。")
    from .vault_management import vault_operation_lock
    with vault_operation_lock(root):
        state = onboarding_state(root)
        current = next(item for item in state["topics"] if item["key"] == topic)
        if current["status"] != "available":
            raise SystemExit("该主题已有待审核或已确认内容。")
        return profile.remember(str(root), content, "local-onboarding", "onboarding", f"onboarding-{topic}")
