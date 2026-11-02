from __future__ import annotations

import asyncio
import os
import shutil
import sys
import tempfile
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).parents[1]


async def exercise(vault: Path) -> None:
    env = os.environ.copy()
    env.update({
        "PROFILE_VAULT": str(vault),
        "PROFILE_AGENT_ID": "protocol-test",
        "PROFILE_SCOPES": "profile:read,context:read,memory:search,memory:propose,memory:pending,project:read,assessment:read",
    })
    parameters = StdioServerParameters(
        command=sys.executable,
        args=[str(ROOT / "mcp_server.py")],
        cwd=ROOT,
        env=env,
        encoding="utf-8",
        encoding_error_handler="replace",
    )
    with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as errlog:
      async with stdio_client(parameters, errlog=errlog) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            await session.initialize()
            tools = await session.list_tools()
            names = {tool.name for tool in tools.tools}
            assert {"get_profile", "propose_memory", "list_pending", "search_memory"} <= names

            proposed = await session.call_tool("propose_memory", {
                "content": "MCP protocol round-trip synthetic preference",
                "memory_type": "preference",
                "subject": "protocol-test",
            })
            assert not proposed.is_error, proposed
            pending = await session.call_tool("list_pending", {})
            assert not pending.is_error, pending
            assert "MCP protocol round-trip synthetic preference" in str(pending.content)

            rejected = await session.call_tool("propose_memory", {
                "content": "api_key: abcdefghijklmnop",
            })
            assert rejected.is_error, rejected


async def denied_scope(vault: Path) -> None:
    env = os.environ.copy()
    env.update({
        "PROFILE_VAULT": str(vault),
        "PROFILE_AGENT_ID": "limited-agent",
        "PROFILE_SCOPES": "profile:read",
    })
    parameters = StdioServerParameters(command=sys.executable, args=[str(ROOT / "mcp_server.py")], cwd=ROOT, env=env)
    with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as errlog:
      async with stdio_client(parameters, errlog=errlog) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            await session.initialize()
            result = await session.call_tool("list_pending", {})
            assert result.is_error, result


def main() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        vault = Path(temporary) / "vault"
        shutil.copytree(ROOT / "template", vault)
        asyncio.run(exercise(vault))
        asyncio.run(denied_scope(vault))
    print("real MCP stdio protocol tests passed")


if __name__ == "__main__":
    main()
