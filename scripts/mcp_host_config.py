#!/usr/bin/env python3
"""Generate a host-ready stdio MCP configuration without editing host settings."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))
from core.vault_identity import ensure_identity

SERVER = ROOT / "mcp_server.py"
HOST_WRAPPERS = {"claude-desktop": "mcpServers", "cursor": "mcpServers", "vscode": "servers"}


def build_server_config(
    vault: Path,
    client_id: str,
    token: str,
    *,
    python_executable: Path | None = None,
    server_script: Path = SERVER,
    host: str = "claude-desktop",
) -> dict[str, Any]:
    vault = vault.expanduser().resolve()
    python_executable = (python_executable or Path(sys.executable)).resolve()
    server_script = server_script.resolve()
    if host not in HOST_WRAPPERS:
        raise ValueError(f"不支持的 MCP Host：{host}")
    if not vault.is_dir():
        raise ValueError("Vault 目录不存在。")
    if not python_executable.is_file() or not server_script.is_file():
        raise ValueError("Python 或 MCP Server 绝对路径无效。")
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", client_id):
        raise ValueError("客户端 ID 无效。")
    if not token.strip():
        raise ValueError("客户端 Token 不能为空。")
    vault_id = ensure_identity(vault)["vault_id"]
    entry: dict[str, Any] = {
        "command": str(python_executable),
        "args": [str(server_script)],
        "env": {
            "PROFILE_VAULT": str(vault),
            "PROFILE_AGENT_ID": client_id,
            "PROFILE_CLIENT_TOKEN": token,
            "PROFILE_VAULT_ID": vault_id,
            "PYTHONUTF8": "1",
        },
    }
    if host == "vscode":
        entry["type"] = "stdio"
    return entry


def build_host_config(host: str, name: str, **values: Any) -> dict[str, Any]:
    if host not in HOST_WRAPPERS:
        raise ValueError(f"不支持的 MCP Host：{host}")
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", name):
        raise ValueError("Host 中的 Server 名称无效。")
    return {HOST_WRAPPERS[host]: {name: build_server_config(host=host, **values)}}


def write_new_config(output: Path, config: dict[str, Any]) -> Path:
    output = output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        with output.open("x", encoding="utf-8") as handle:
            json.dump(config, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
    except FileExistsError as exc:
        raise ValueError("输出文件已存在；为避免覆盖 Host 配置，请更换路径。") from exc
    try:
        output.chmod(0o600)
    except OSError:
        pass
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="生成 NEXORA 的本地 MCP Host 配置。")
    parser.add_argument("--host", choices=sorted(HOST_WRAPPERS), default="claude-desktop")
    parser.add_argument("--vault", type=Path, required=True)
    parser.add_argument("--client-id", required=True)
    parser.add_argument("--name", default="personal-ai-profile")
    parser.add_argument("--python", type=Path, default=Path(sys.executable))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    token = os.environ.get("PROFILE_CLIENT_TOKEN", "")
    config = build_host_config(
        args.host, args.name, vault=args.vault, client_id=args.client_id,
        token=token, python_executable=args.python,
    )
    try:
        output = write_new_config(args.output, config)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    print(f"已生成：{output}")
    print("该文件含一次性客户端凭据，请仅保存在本机私有位置。")


if __name__ == "__main__":
    main()
