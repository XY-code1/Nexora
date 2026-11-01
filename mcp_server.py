#!/usr/bin/env python3
"""Local MCP gateway exposing a private vault without giving agents raw write access."""

from __future__ import annotations

import os
import re
import io
from contextlib import redirect_stdout
from pathlib import Path

from mcp.server.mcpserver import MCPServer

import profile as profile_cli


def get_vault() -> Path:
    value = os.environ.get("PROFILE_VAULT")
    if not value:
        raise RuntimeError("请设置 PROFILE_VAULT 为私人Obsidian Vault路径。")
    root = Path(value).expanduser().resolve()
    missing = [name for name in profile_cli.REQUIRED if not (root / name).is_file()]
    if missing:
        raise RuntimeError(f"私人档案结构不完整：{', '.join(missing)}")
    return root


def readable(file: Path) -> bool:
    text = file.read_text(encoding="utf-8")
    return "ai_access: denied" not in text and "ai_access: local-only" not in text


server = MCPServer(
    "personal-ai-profile",
    instructions=(
        "这是用户控制的私人档案。只按当前任务读取最少信息。"
        "写入只能创建候选项，禁止声称候选项已被用户确认。"
    ),
)


@server.tool(description="读取用户确认的稳定档案摘要。")
def get_profile() -> str:
    return (get_vault() / "10 Profile" / "Profile.md").read_text(encoding="utf-8")[:6000]


@server.tool(description="读取当前目标、活跃项目和下一步。")
def get_current_context() -> str:
    return (get_vault() / "00 Dashboard" / "Current Context.md").read_text(encoding="utf-8")[:6000]


@server.tool(description="在允许AI读取的已确认记忆中搜索。")
def search_memory(query: str, limit: int = 8) -> list[dict[str, str]]:
    root = get_vault() / "30 Memory" / "Confirmed"
    terms = [term.lower() for term in re.findall(r"\w+", query) if term.strip()]
    results: list[tuple[int, Path, str]] = []
    for file in root.glob("*.md"):
        if not readable(file):
            continue
        text = file.read_text(encoding="utf-8")
        score = sum(text.lower().count(term) for term in terms)
        if score:
            results.append((score, file, text[:1500]))
    results.sort(key=lambda item: (-item[0], item[1].name))
    return [{"file": file.name, "content": text} for _, file, text in results[: max(1, min(limit, 20))]]


@server.tool(description="列出活跃项目文件；不读取被标记为禁止AI访问的内容。")
def list_projects() -> list[dict[str, str]]:
    root = get_vault() / "20 Projects" / "Active"
    return [
        {"file": str(file.relative_to(root)), "content": file.read_text(encoding="utf-8")[:2000]}
        for file in root.rglob("*.md") if readable(file)
    ]


@server.tool(description="提出一条候选记忆。它只进入Inbox，必须由用户另行确认。")
def propose_memory(content: str) -> str:
    if not content.strip():
        raise ValueError("候选记忆不能为空。")
    with redirect_stdout(io.StringIO()):
        profile_cli.remember(str(get_vault()), content.strip())
    return "候选记忆已进入30 Memory/Inbox；它尚未成为长期记忆，请让用户在Obsidian中审核。"


@server.tool(description="列出等待用户在Obsidian中审核的候选记忆。")
def list_pending() -> list[dict[str, str]]:
    root = get_vault() / "30 Memory" / "Inbox"
    return [
        {"file": file.name, "content": file.read_text(encoding="utf-8")[:2000]}
        for file in sorted(root.glob("*.md"))
    ]


@server.tool(description="读取最近一次Human3复盘；只用于反思，不作为诊断。")
def get_human3_summary() -> str:
    files = sorted((get_vault() / "40 Reviews" / "Human3" / "History").glob("*.md"), reverse=True)
    return files[0].read_text(encoding="utf-8")[:5000] if files else "暂无已确认的Human3复盘。"


if __name__ == "__main__":
    server.run("stdio")

