# V0.1 行为契约

本文件冻结 Core 抽取前已经存在的外部行为。Phase 1 只改变代码依赖，不改变数据或用户操作。

## 数据事实源

- 私人 Vault 中的 Markdown 文件是唯一事实源。
- 公共仓库的 `template/` 只用于初始化，不保存真实用户数据。
- 记忆目录与状态必须匹配：`Inbox` 为 `candidate/disputed`，`Confirmed` 为 `confirmed`，`Rejected` 为 `rejected`，`Archived` 为 `forgotten/superseded`。
- 记录必须包含唯一 `id` 和合法 `status`；写入采用同目录临时文件加 `os.replace`。

## 兼容入口

| 入口 | 保持的行为 |
|---|---|
| `profile.py` | 原命令、参数、输出与退出状态不变；作为 `core.profile` 的兼容 CLI |
| `review_app.py` | 继续调用相同生命周期函数，只绑定 loopback |
| `mcp_server.py` | tool 名称与返回形态不变，只读/提议边界不变 |

## 记忆生命周期

```text
candidate -> confirmed -> forgotten
    |            |
    |            +-> superseded
    +-> disputed -> candidate/rejected
    +-> rejected
```

- AI 只能提出 candidate；确认、拒绝、遗忘和替代由可信本地入口执行。
- 相同 fingerprint 的确认请求被拒绝。
- 同 `subject` 和 `type` 的不同内容进入 `disputed`。
- 拒绝和遗忘保留记录，不做无痕删除。

## AI 访问矩阵

| `ai_access` | MCP 读取 | 搜索/列表 |
|---|---|---|
| `allowed` | 截断后的正文 | 可见 |
| `summary-only` | 仅显式 `摘要/Summary` 段 | 可见，但仅摘要 |
| `local-only` | 拒绝正文 | 不可见 |
| `denied`、缺失或非法值 | 默认拒绝 | 不可见 |

MCP 还必须同时满足已授权的 `PROFILE_AGENT_ID`、有效 `PROFILE_CLIENT_TOKEN` 和 Vault 本地注册表中的所需 scope。环境变量 `PROFILE_SCOPES` 不再被信任。MCP 不提供 confirm、reject、forget、supersede、Profile 修改或公开发布工具。

## 信任边界

- `core/`：领域、Vault 文件操作和访问策略的权威实现，不依赖 HTTP 或 MCP。
- `profile.py`：本地 CLI 兼容适配器。
- `review_app.py`：可信本地审核适配器。
- `mcp_server.py`：不可信模型调用的最小权限适配器。
- 测试只使用临时合成 Vault，不读取私人 Vault。

## Phase 1 非目标

- 不增加 React、FastAPI、数据库、同步、迁移或桌面打包。
- 不改变现有 Markdown schema、目录、命令或 MCP tool。
- 不解决跨进程锁和多文件事务；它们进入 Phase 2。
- 不移动或读取私人 Vault。

## 回归门禁

1. 原四组测试继续通过。
2. CLI 冒烟流程继续通过。
3. MCP 和 Core 对每种 `ai_access` 给出相同结果。
4. `profile.py` 保留原有 Python 导入表面，现有调用方无需修改。
