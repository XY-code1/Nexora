# Privacy

- Private仓库不等于密码保险箱。
- 不保存密码、Token、验证码、API Key、私钥、证件或银行卡资料。
- `ai_access: denied`：禁止模型读取。
- `ai_access: local-only`：只允许本地模型读取。
- `ai_access: summary-only`：只发送人工确认后的摘要。
- `ai_access: allowed`：可按任务发送给配置的模型。
- 如果秘密曾被提交，应立即轮换秘密并清理Git历史。

