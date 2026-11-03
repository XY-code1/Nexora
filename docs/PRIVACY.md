# Privacy

- Private仓库不等于密码保险箱。
- 不保存密码、Token、验证码、API Key、私钥、证件或银行卡资料。
- `ai_access: denied`：禁止模型读取。
- `ai_access: local-only`：只允许本地模型读取。
- `ai_access: summary-only`：只发送人工确认后的摘要。
- `ai_access: allowed`：可按任务发送给配置的模型。
- 如果秘密曾被提交，应立即轮换秘密并清理Git历史。
- 每个 MCP 客户端使用独立的一次性凭据；Vault 只保存哈希，撤销后下一次调用立即失效。
- Security Center 管理 API 只接受本地启动器 Bearer 会话；MCP 客户端凭据不能调用管理 API。
- 安全审计只记录事件元数据与哈希链，不记录记忆正文、Token、凭据或私人 Vault 绝对路径。
- `denied` 与 `local-only` 对 stdio MCP 始终不可见；`summary-only` 只返回人工确认摘要。

