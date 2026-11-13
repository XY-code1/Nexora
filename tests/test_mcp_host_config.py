from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))

from core import security
from scripts.mcp_host_config import build_host_config, write_new_config


async def verify_generated_config(config: dict[str, object]) -> None:
    entry = config["mcpServers"]["personal-ai-profile"]  # type: ignore[index]
    env = os.environ.copy()
    env.update(entry["env"])  # type: ignore[arg-type,index]
    parameters = StdioServerParameters(
        command=entry["command"], args=entry["args"], env=env,  # type: ignore[arg-type,index]
        encoding="utf-8", encoding_error_handler="replace",
    )
    async with stdio_client(parameters) as (reader, writer), ClientSession(reader, writer) as session:
        await session.initialize()
        names = {tool.name for tool in (await session.list_tools()).tools}
        assert {"get_profile", "search_memory", "propose_memory", "list_pending"} <= names
        result = await session.call_tool("get_profile", {})
        assert not result.is_error


def main() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        vault = Path(temporary) / "vault"
        shutil.copytree(ROOT / "template", vault)
        client, token = security.create_client(vault, "Host Config Test", ["profile:read"])
        config = build_host_config(
            "claude-desktop", "personal-ai-profile",
            vault=vault, client_id=client["id"], token=token,
        )
        encoded = json.dumps(config)
        entry = config["mcpServers"]["personal-ai-profile"]
        assert entry["env"]["PROFILE_VAULT"] == str(vault.resolve())
        assert entry["env"]["PROFILE_VAULT_ID"].startswith("vault_")
        assert entry["args"] == [str((ROOT / "mcp_server.py").resolve())]
        assert "PROFILE_CLIENT_TOKEN" in encoded
        output = Path(temporary) / "host.json"
        write_new_config(output, config)
        assert json.loads(output.read_text(encoding="utf-8")) == config
        try:
            write_new_config(output, config)
            raise AssertionError("existing host config was overwritten")
        except ValueError:
            pass
        asyncio.run(verify_generated_config(config))

        vscode = build_host_config(
            "vscode", "personal-ai-profile",
            vault=vault, client_id=client["id"], token=token,
        )
        assert vscode["servers"]["personal-ai-profile"]["type"] == "stdio"
    print("MCP host config and real stdio round-trip passed")


if __name__ == "__main__":
    main()
