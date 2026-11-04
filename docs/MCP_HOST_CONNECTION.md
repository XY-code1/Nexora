# AI Connections C4：本地 MCP Host 接入

Personal AI Profile 通过本地 `stdio` 连接 Claude Desktop、Claude Code、Cursor 或 VS Code。Host 只能使用用户已授权的 Scope；`denied` / `local-only` 数据、候选记忆正文和 Growth Data 不会暴露。

## 前置条件

1. 在本地审核界面注册客户端、选择最小 Scope 并授权。
2. 立即保存只显示一次的 `client_id` 和 Token。
3. 不要把 Token、真实 Vault 路径或生成的配置提交到 Git。

## 生成配置

Token 从环境变量读取，不放进命令行参数：

```powershell
$env:PROFILE_CLIENT_TOKEN = "<ONE_TIME_TOKEN>"
python scripts/mcp_host_config.py `
  --host claude-desktop `
  --vault "C:\absolute\path\to\private-vault" `
  --client-id "client-xxxxxxxxxxxx" `
  --output "$env:TEMP\personal-ai-profile.claude.json"
Remove-Item Env:PROFILE_CLIENT_TOKEN
```

生成器只创建新文件，绝不覆盖 Host 现有配置。将输出中 `mcpServers.personal-ai-profile` 合并到 Claude Desktop 的 `%APPDATA%\Claude\claude_desktop_config.json`，然后完全退出并重启 Claude Desktop。

Cursor 使用 `--host cursor`；VS Code 使用 `--host vscode`。所有路径都会生成为绝对路径，避免 Host 在不同工作目录启动失败。

## 验证

```powershell
python tests/test_mcp_host_config.py
python tests/test_mcp_protocol.py
```

`test_mcp_host_config.py` 使用临时合成 Vault 和临时凭据，按生成配置启动真实 stdio 子进程，完成 MCP initialize、tools/list 和受权 Tool 调用。

Claude Desktop 日志位于 `%APPDATA%\Claude\logs`。当 Host 不显示 Tool 时，先检查 Python 和 `mcp_server.py` 是否为绝对路径，并确认 Host 已完全重启。

## 凭据边界

- Host 配置必然需要本地 Token；应把配置文件视为私密数据。
- Token 重签、撤销或删除客户端后，旧 Token 立即失效。
- MCP Tool 不提供正式记忆确认、删除、修改 Profile 或修改权限的能力。
