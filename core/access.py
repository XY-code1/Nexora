"""Single source of truth for AI read-access policy."""

from __future__ import annotations

import re
from typing import Literal

from .profile import parse_record

AccessLevel = Literal["allowed", "summary-only", "local-only", "denied"]
DEFAULT_ACCESS: AccessLevel = "denied"


def get_access_level(text: str) -> AccessLevel:
    metadata, _ = parse_record(text)
    level = metadata.get("ai_access", DEFAULT_ACCESS).lower().strip()
    if level in ("allowed", "summary-only", "local-only", "denied"):
        return level  # type: ignore[return-value]
    return DEFAULT_ACCESS


def extract_summary(text: str, max_chars: int = 800) -> str:
    """Return an explicit summary only; never infer one from private text."""
    for pattern in (
        r"(?ims)^##\s*Summary\s*\n(.+?)(?=\n##\s|\Z)",
        r"(?ims)^##\s*摘要\s*\n(.+?)(?=\n##\s|\Z)",
    ):
        match = re.search(pattern, text)
        if match and match.group(1).strip():
            return match.group(1).strip()[:max_chars]
    return "（该记录没有显式摘要，正文未返回）"


def apply_access(text: str, full_limit: int = 6000, summary_limit: int = 800) -> str:
    level = get_access_level(text)
    if level == "denied":
        return "（该内容被标记为 ai_access: denied，禁止读取）"
    if level == "local-only":
        return "（该内容被标记为 ai_access: local-only，当前 MCP 不返回正文）"
    if level == "summary-only":
        return extract_summary(text, max_chars=summary_limit)
    return text[:full_limit]


def is_readable_for_search(text: str) -> bool:
    return get_access_level(text) in ("allowed", "summary-only")
