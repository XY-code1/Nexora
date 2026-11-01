#!/usr/bin/env python3
"""Local MCP gateway exposing a private vault without giving agents raw write access.

Permission model (ai_access frontmatter):
  allowed       → full content (truncated) may be returned
  summary-only  → only a short summary may be returned
  local-only    → treated as denied for this stdio MCP (no reliable local/cloud signal)
  denied        → nothing is returned

High-risk operations (confirm / delete / edit profile / connect sources) are
intentionally not exposed. propose_memory only writes candidates to Inbox and
runs secret scanning before write.
"""

from __future__ import annotations

import io
import os
import re
from contextlib import redirect_stdout
from pathlib import Path
from typing import Literal

from mcp.server.mcpserver import MCPServer

import profile as profile_cli

AccessLevel = Literal["allowed", "summary-only", "local-only", "denied"]

# Default when frontmatter is missing or invalid. Prefer conservative in future.
DEFAULT_ACCESS: AccessLevel = "allowed"


def get_vault() -> Path:
    value = os.environ.get("PROFILE_VAULT")
    if not value:
        raise RuntimeError("请设置 PROFILE_VAULT 为私人Obsidian Vault路径。")
    root = Path(value).expanduser().resolve()
    missing = [name for name in profile_cli.REQUIRED if not (root / name).is_file()]
    if missing:
        raise RuntimeError(f"私人档案结构不完整：{', '.join(missing)}")
    return root


def parse_frontmatter(text: str) -> dict[str, str]:
    """Parse only the YAML-like frontmatter at the start of a Markdown file."""
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    meta: dict[str, str] = {}
    for line in text[3:end].splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, value = line.partition(":")
        meta[key.strip()] = value.strip()
    return meta


def get_access_level(text: str) -> AccessLevel:
    meta = parse_frontmatter(text)
    level = meta.get("ai_access", DEFAULT_ACCESS).lower().strip()
    if level in ("allowed", "summary-only", "local-only", "denied"):
        return level  # type: ignore[return-value]
    return DEFAULT_ACCESS


def extract_summary(text: str, max_chars: int = 800) -> str:
    """Prefer an explicit ## Summary / ## 摘要 section; otherwise first body lines."""
    for pattern in (
        r"(?is)^##\s*Summary\s*\n(.+?)(?=\n##\s|\Z)",
        r"(?is)^##\s*摘要\s*\n(.+?)(?=\n##\s|\Z)",
    ):
        m = re.search(pattern, text)
        if m:
            body = m.group(1).strip()
            if body:
                return body[:max_chars]

    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            text = text[end + 4 :].lstrip("\n")
    lines = text.splitlines()
    if lines and lines[0].startswith("#"):
        lines = lines[1:]
    body = "\n".join(lines).strip()
    return body[:max_chars] if body else "（无可用摘要）"


def apply_access(text: str, full_limit: int = 6000, summary_limit: int = 800) -> str:
    """Return content according to ai_access, or a denial message."""
    level = get_access_level(text)
    if level == "denied":
        return "（该内容被标记为 ai_access: denied，禁止读取）"
    if level == "local-only":
        return "（该内容被标记为 ai_access: local-only，当前 MCP 不返回正文）"
    if level == "summary-only":
        return extract_summary(text, max_chars=summary_limit)
    return text[:full_limit]


def is_readable_for_search(text: str) -> bool:
    """denied and local-only are never returned by search/list tools."""
    return get_access_level(text) in ("allowed", "summary-only")


server = MCPServer(
    "personal-ai-profile",
    instructions=(
        "这是用户控制的私人档案。只按当前任务读取最少信息。"
        "严格遵守每条记忆的 ai_access 等级：denied/local-only 不返回，"
        "summary-only 只返回摘要。"
        "写入只能创建候选项（propose_memory），禁止声称候选项已被用户确认。"
        "确认、删除、修改 Profile、公开内容等高风险操作不在本 MCP 中提供。"
    ),
)


@server.tool(
    description=(
        "读取用户确认的稳定档案。尊重 ai_access："
        "denied/local-only 不返回正文，summary-only 只返回摘要。"
    )
)
def get_profile() -> str:
    path = get_vault() / "10 Profile" / "Profile.md"
    text = path.read_text(encoding="utf-8")
    return apply_access(text, full_limit=6000, summary_limit=1200)


@server.tool(
    description=(
        "读取当前目标、活跃项目和下一步。尊重 ai_access："
        "denied/local-only 不返回正文，summary-only 只返回摘要。"
    )
)
def get_current_context() -> str:
    path = get_vault() / "00 Dashboard" / "Current Context.md"
    text = path.read_text(encoding="utf-8")
    return apply_access(text, full_limit=6000, summary_limit=1200)


@server.tool(
    description=(
        "在允许 AI 读取的已确认记忆中搜索。"
        "跳过 ai_access 为 denied 或 local-only 的条目；"
        "summary-only 的条目只返回摘要。"
    )
)
def search_memory(query: str, limit: int = 8) -> list[dict[str, str]]:
    root = get_vault() / "30 Memory" / "Confirmed"
    terms = [term.lower() for term in re.findall(r"\w+", query) if term.strip()]
    results: list[tuple[int, Path, str]] = []
    for file in root.glob("*.md"):
        text = file.read_text(encoding="utf-8")
        if not is_readable_for_search(text):
            continue
        score = sum(text.lower().count(term) for term in terms) if terms else 1
        if score:
            level = get_access_level(text)
            if level == "summary-only":
                content = extract_summary(text, max_chars=600)
            else:
                content = text[:1500]
            results.append((score, file, content))
    results.sort(key=lambda item: (-item[0], item[1].name))
    limit = max(1, min(limit, 20))
    return [{"file": file.name, "content": content} for _, file, content in results[:limit]]


@server.tool(
    description=(
        "列出活跃项目文件。跳过 ai_access 为 denied 或 local-only 的内容；"
        "summary-only 只返回摘要。"
    )
)
def list_projects() -> list[dict[str, str]]:
    root = get_vault() / "20 Projects" / "Active"
    out: list[dict[str, str]] = []
    for file in root.rglob("*.md"):
        text = file.read_text(encoding="utf-8")
        if not is_readable_for_search(text):
            continue
        level = get_access_level(text)
        if level == "summary-only":
            content = extract_summary(text, max_chars=600)
        else:
            content = text[:2000]
        out.append({"file": str(file.relative_to(root)), "content": content})
    return out


@server.tool(
    description=(
        "提出一条候选记忆。仅写入 30 Memory/Inbox，状态为 candidate，"
        "必须由用户另行确认后才会成为长期记忆。"
        "内容会先经过秘密扫描；疑似密码/Token/私钥等将被拒绝写入。"
    )
)
def propose_memory(content: str) -> str:
    content = content.strip()
    if not content:
        raise ValueError("候选记忆不能为空。")
    if len(content) > 4000:
        raise ValueError("候选记忆过长（>4000 字符），请提炼为事实陈述后再提交。")

    for label, pattern in profile_cli.SECRET_PATTERNS.items():
        if pattern.search(content):
            raise ValueError(
                f"候选记忆疑似包含敏感信息（{label}），已拒绝写入。"
                "请脱敏后再试。"
            )

    with redirect_stdout(io.StringIO()):
        profile_cli.remember(str(get_vault()), content)
    return (
        "候选记忆已进入 30 Memory/Inbox；它尚未成为长期记忆，"
        "请让用户在 Obsidian 中审核确认。"
    )


@server.tool(
    description=(
        "列出等待用户在 Obsidian 中审核的候选记忆。"
        "这些内容仍是 candidate，模型不得当作已确认事实使用。"
    )
)
def list_pending() -> list[dict[str, str]]:
    root = get_vault() / "30 Memory" / "Inbox"
    return [
        {"file": file.name, "content": file.read_text(encoding="utf-8")[:2000]}
        for file in sorted(root.glob("*.md"))
    ]


@server.tool(
    description=(
        "读取最近一次已确认的 Human3 复盘摘要；仅用于反思，不作为诊断。"
        "尊重 ai_access：denied/local-only 不返回，summary-only 只返回摘要。"
    )
)
def get_human3_summary() -> str:
    history = get_vault() / "40 Reviews" / "Human3" / "History"
    files = sorted(history.glob("*.md"), reverse=True)
    if not files:
        return "暂无已确认的 Human3 复盘。"
    text = files[0].read_text(encoding="utf-8")
    return apply_access(text, full_limit=5000, summary_limit=1200)


if __name__ == "__main__":
    server.run("stdio")
