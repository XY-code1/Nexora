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
import stat
from contextlib import redirect_stdout
from functools import wraps
from pathlib import Path
from mcp.server.mcpserver import MCPServer

from core import profile as profile_cli
from core.access import apply_access, extract_summary, get_access_level, is_readable_for_search
from core import security
from core.vault_management import assert_vault_isolated, recover_vault_swap, require_current_schema, vault_operation_lock

MAX_FILE_CHARS = 12_000
MAX_LIST_ITEMS = 50
MAX_RESPONSE_CHARS = 20_000
KNOWN_SCOPES = security.KNOWN_SCOPES


def get_vault() -> Path:
    value = os.environ.get("PROFILE_VAULT")
    if not value:
        raise RuntimeError("请设置 PROFILE_VAULT 为私人Obsidian Vault路径。")
    root = Path(value).expanduser().resolve()
    with vault_operation_lock(root):
        recover_vault_swap(root)
    missing = [name for name in profile_cli.REQUIRED if not (root / name).is_file()]
    if missing:
        raise RuntimeError(f"私人档案结构不完整：{', '.join(missing)}")
    assert_vault_isolated(root)
    require_current_schema(root)
    return root


def agent_id() -> str:
    value = os.environ.get("PROFILE_AGENT_ID", "").strip()
    return value if re.fullmatch(r"[A-Za-z0-9._-]{1,64}", value) else "invalid-client"


def client_token() -> str:
    return os.environ.get("PROFILE_CLIENT_TOKEN", "").strip()


def require_scope(scope: str, event_type: str, resource_type: str) -> None:
    security.authorize(get_vault(), agent_id(), client_token(), scope, event_type=event_type, resource_type=resource_type)


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


def vault_locked(function):
    @wraps(function)
    def wrapper(*args, **kwargs):
        with profile_cli.vault_lock(get_vault()):
            return function(*args, **kwargs)
    return wrapper


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
@vault_locked
def get_profile() -> str:
    require_scope("profile:read", "profile.read", "profile")
    root = get_vault()
    text = read_limited(root, root / "10 Profile" / "Profile.md")
    result = apply_access(text, full_limit=6000, summary_limit=1200)
    return result


@server.tool(
    description=(
        "读取当前目标、活跃项目和下一步。尊重 ai_access："
        "denied/local-only 不返回正文，summary-only 只返回摘要。"
    )
)
@vault_locked
def get_current_context() -> str:
    require_scope("context:read", "context.read", "context")
    root = get_vault()
    text = read_limited(root, root / "00 Dashboard" / "Current Context.md")
    result = apply_access(text, full_limit=6000, summary_limit=1200)
    return result


@server.tool(
    description=(
        "在允许 AI 读取的已确认记忆中搜索。"
        "跳过 ai_access 为 denied 或 local-only 的条目；"
        "summary-only 的条目只返回摘要。"
    )
)
@vault_locked
def search_memory(query: str, limit: int = 8) -> list[dict[str, str]]:
    require_scope("memory:search", "memory.search", "memory")
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
    return output


@server.tool(
    description=(
        "列出活跃项目文件。跳过 ai_access 为 denied 或 local-only 的内容；"
        "summary-only 只返回摘要。"
    )
)
@vault_locked
def list_projects() -> list[dict[str, str]]:
    require_scope("project:read", "project.list", "project")
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
    return out


@server.tool(
    description=(
        "提出一条候选记忆。仅写入 30 Memory/Inbox，状态为 candidate，"
        "必须由用户另行确认后才会成为长期记忆。"
        "内容会先经过秘密扫描；疑似密码/Token/私钥等将被拒绝写入。"
    )
)
def propose_memory(content: str, memory_type: str = "note", subject: str = "") -> str:
    require_scope("memory:propose", "memory.propose", "memory")
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
        profile_cli.remember(
            str(get_vault()), content, source_agent=identity,
            memory_type=memory_type[:64], subject=subject[:200],
        )
    return (
        "候选记忆已进入 30 Memory/Inbox；它尚未成为长期记忆，"
        "请让用户在 Obsidian 中审核确认。"
    )


@server.tool(
    description=(
        "返回等待用户审核的候选记忆的统计信息。"
        "只返回非敏感统计（总数和按类型计数），不返回候选的正文、摘要、来源或文件名。"
        "候选记忆只有经用户确认后才会成为长期记忆。"
    )
)
@vault_locked
def list_pending() -> dict[str, object]:
    require_scope("memory:pending", "memory.pending_list", "memory")
    vault = get_vault()
    root = vault / "30 Memory" / "Inbox"
    by_type: dict[str, int] = {}
    total = 0
    for file in sorted(root.glob("*.md")):
        metadata, _ = profile_cli.parse_record(read_limited(vault, file))
        kind = metadata.get("type", "note")
        by_type[kind] = by_type.get(kind, 0) + 1
        total += 1
    return {"totalPending": total, "byType": by_type}


@server.tool(
    description=(
        "读取最近一次已确认的 Human3 复盘摘要；仅用于反思，不作为诊断。"
        "尊重 ai_access：denied/local-only 不返回，summary-only 只返回摘要。"
    )
)
@vault_locked
def get_human3_summary() -> str:
    require_scope("assessment:read", "assessment.read", "assessment")
    vault = get_vault()
    history = vault / "40 Reviews" / "Human3" / "History"
    confirmed = []
    for file in sorted(history.glob("*.md"), reverse=True)[:MAX_LIST_ITEMS]:
        text = read_limited(vault, file)
        metadata, _ = profile_cli.parse_record(text)
        if metadata.get("status") == "confirmed":
            confirmed.append(text)
    if not confirmed:
        return "暂无已确认的 Human3 复盘。"
    result = apply_access(confirmed[0], full_limit=5000, summary_limit=1200)
    return result


if __name__ == "__main__":
    server.run("stdio")
