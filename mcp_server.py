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
import json
import os
import re
import stat
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from mcp.server.mcpserver import MCPServer

import profile as profile_cli

AccessLevel = Literal["allowed", "summary-only", "local-only", "denied"]

DEFAULT_ACCESS: AccessLevel = "denied"
MAX_FILE_CHARS = 12_000
MAX_LIST_ITEMS = 50
MAX_RESPONSE_CHARS = 20_000
KNOWN_SCOPES = {
    "profile:read", "context:read", "memory:search", "memory:propose",
    "memory:pending", "project:read", "assessment:read",
}


def get_vault() -> Path:
    value = os.environ.get("PROFILE_VAULT")
    if not value:
        raise RuntimeError("请设置 PROFILE_VAULT 为私人Obsidian Vault路径。")
    root = Path(value).expanduser().resolve()
    missing = [name for name in profile_cli.REQUIRED if not (root / name).is_file()]
    if missing:
        raise RuntimeError(f"私人档案结构不完整：{', '.join(missing)}")
    return root


def agent_id() -> str:
    value = os.environ.get("PROFILE_AGENT_ID", "").strip()
    if not value or not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", value):
        raise PermissionError("PROFILE_AGENT_ID 缺失或无效；拒绝访问私人档案。")
    return value


def scopes() -> set[str]:
    values = {item.strip() for item in os.environ.get("PROFILE_SCOPES", "").split(",") if item.strip()}
    unknown = values - KNOWN_SCOPES
    if unknown:
        raise PermissionError(f"存在未知权限Scope：{', '.join(sorted(unknown))}")
    return values


def require_scope(scope: str) -> None:
    identity = agent_id()
    if scope not in scopes():
        audit("scope_denied", {"agent": identity, "scope": scope})
        raise PermissionError(f"Agent {identity} 没有 {scope} 权限。")


def audit(event: str, details: dict[str, str]) -> None:
    root = get_vault()
    folder = root / "90 System" / "Audit"
    folder.mkdir(parents=True, exist_ok=True)
    record = {"time": datetime.now(timezone.utc).isoformat(), "event": event, **details}
    with (folder / "mcp.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def safe_path(root: Path, candidate: Path) -> Path:
    root = root.resolve(strict=True)
    resolved = candidate.resolve(strict=True)
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise PermissionError("文件路径逃逸出私人Vault，已拒绝访问。") from exc
    current = candidate
    while True:
        info = current.lstat()
        attrs = getattr(info, "st_file_attributes", 0)
        if current.is_symlink() or attrs & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
            raise PermissionError("不允许通过符号链接或重解析点读取档案。")
        if current.resolve() == root:
            break
        current = current.parent
    return resolved


def read_limited(root: Path, candidate: Path, limit: int = MAX_FILE_CHARS) -> str:
    path = safe_path(root, candidate)
    with path.open("r", encoding="utf-8") as handle:
        text = handle.read(limit + 1)
    if len(text) > limit:
        raise ValueError(f"档案文件超过单文件读取上限（{limit}字符）。")
    return text


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
    """Return only an explicit Summary section; never derive one from private body text."""
    for pattern in (
        r"(?ims)^##\s*Summary\s*\n(.+?)(?=\n##\s|\Z)",
        r"(?ims)^##\s*摘要\s*\n(.+?)(?=\n##\s|\Z)",
    ):
        m = re.search(pattern, text)
        if m:
            body = m.group(1).strip()
            if body:
                return body[:max_chars]

    return "（该记录没有显式摘要，正文未返回）"


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
    require_scope("profile:read")
    root = get_vault()
    text = read_limited(root, root / "10 Profile" / "Profile.md")
    result = apply_access(text, full_limit=6000, summary_limit=1200)
    audit("profile_read", {"agent": agent_id()})
    return result


@server.tool(
    description=(
        "读取当前目标、活跃项目和下一步。尊重 ai_access："
        "denied/local-only 不返回正文，summary-only 只返回摘要。"
    )
)
def get_current_context() -> str:
    require_scope("context:read")
    root = get_vault()
    text = read_limited(root, root / "00 Dashboard" / "Current Context.md")
    result = apply_access(text, full_limit=6000, summary_limit=1200)
    audit("context_read", {"agent": agent_id()})
    return result


@server.tool(
    description=(
        "在允许 AI 读取的已确认记忆中搜索。"
        "跳过 ai_access 为 denied 或 local-only 的条目；"
        "summary-only 的条目只返回摘要。"
    )
)
def search_memory(query: str, limit: int = 8) -> list[dict[str, str]]:
    require_scope("memory:search")
    vault = get_vault()
    root = vault / "30 Memory" / "Confirmed"
    terms = [term.lower() for term in re.findall(r"\w+", query) if term.strip()]
    results: list[tuple[int, Path, str]] = []
    for file in sorted(root.glob("*.md"))[:MAX_LIST_ITEMS]:
        text = read_limited(vault, file)
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
    output = [{"file": file.name, "content": content} for _, file, content in results[:limit]]
    audit("memory_searched", {"agent": agent_id(), "results": str(len(output))})
    return output


@server.tool(
    description=(
        "列出活跃项目文件。跳过 ai_access 为 denied 或 local-only 的内容；"
        "summary-only 只返回摘要。"
    )
)
def list_projects() -> list[dict[str, str]]:
    require_scope("project:read")
    vault = get_vault()
    root = vault / "20 Projects" / "Active"
    out: list[dict[str, str]] = []
    total = 0
    for file in sorted(root.rglob("*.md"))[:MAX_LIST_ITEMS]:
        text = read_limited(vault, file)
        if not is_readable_for_search(text):
            continue
        level = get_access_level(text)
        if level == "summary-only":
            content = extract_summary(text, max_chars=600)
        else:
            content = text[:2000]
        total += len(content)
        if total > MAX_RESPONSE_CHARS:
            break
        out.append({"file": str(file.relative_to(root)), "content": content})
    audit("projects_listed", {"agent": agent_id(), "results": str(len(out))})
    return out


@server.tool(
    description=(
        "提出一条候选记忆。仅写入 30 Memory/Inbox，状态为 candidate，"
        "必须由用户另行确认后才会成为长期记忆。"
        "内容会先经过秘密扫描；疑似密码/Token/私钥等将被拒绝写入。"
    )
)
def propose_memory(content: str) -> str:
    require_scope("memory:propose")
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

    identity = agent_id()
    with redirect_stdout(io.StringIO()):
        profile_cli.remember(str(get_vault()), content, source_agent=identity)
    audit("memory_proposed", {"agent": identity, "chars": str(len(content))})
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
    require_scope("memory:pending")
    vault = get_vault()
    root = vault / "30 Memory" / "Inbox"
    out: list[dict[str, str]] = []
    total = 0
    for file in sorted(root.glob("*.md"))[:MAX_LIST_ITEMS]:
        text = read_limited(vault, file)
        if not is_readable_for_search(text):
            continue
        content = apply_access(text, full_limit=1500, summary_limit=600)
        total += len(content)
        if total > MAX_RESPONSE_CHARS:
            break
        out.append({"file": file.name, "content": content})
    audit("pending_listed", {"agent": agent_id(), "results": str(len(out))})
    return out


@server.tool(
    description=(
        "读取最近一次已确认的 Human3 复盘摘要；仅用于反思，不作为诊断。"
        "尊重 ai_access：denied/local-only 不返回，summary-only 只返回摘要。"
    )
)
def get_human3_summary() -> str:
    require_scope("assessment:read")
    vault = get_vault()
    history = vault / "40 Reviews" / "Human3" / "History"
    files = sorted(history.glob("*.md"), reverse=True)[:MAX_LIST_ITEMS]
    if not files:
        audit("human3_read", {"agent": agent_id(), "results": "0"})
        return "暂无已确认的 Human3 复盘。"
    text = read_limited(vault, files[0])
    result = apply_access(text, full_limit=5000, summary_limit=1200)
    audit("human3_read", {"agent": agent_id(), "results": "1"})
    return result


if __name__ == "__main__":
    server.run("stdio")
