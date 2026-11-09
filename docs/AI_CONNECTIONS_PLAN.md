# AI Connections — 实施计划

> 状态：C1–C6 全部完成。C4 已通过真实 stdio Host 链路验证，C5 已通过原子性、并发和故障注入测试，C6 已完成 UI 与真实生命周期 E2E。
>
> **当前状态以 [`PROJECT_STATUS.md`](PROJECT_STATUS.md) 为准。**

## C1 架构审计结论

当前 MCP Gateway 采用本地 stdio，7 个 Tool（`mcp.server.mcpserver.MCPServer` 2.3.0），无 Resource/Prompt。认证走 `core/security.py` 的 `authorize`（env `PROFILE_AGENT_ID` + `PROFILE_CLIENT_TOKEN` → 校验身份 + 凭证哈希 + scope + 状态），客户端注册表 `clients.json` + 防篡改审计链 `security.jsonl`。客户端管理 API 已有 create / update_scopes / revoke / audit 查询。

已实现的 MCP Tool：get_profile、get_current_context、search_memory、list_projects、propose_memory、list_pending、get_human3_summary（对应 7 个 scope：profile:read、context:read、memory:search、memory:propose、memory:pending、project:read、assessment:read）。

尚未实现：客户端逻辑删除、Token 重新签发、细粒度 scope（monthly/growth/privacy 均无）、7 态客户端状态、Resource/Prompt、Claude Desktop 真实端到端验证、接入向导 UI。

> **2026-11-09 更新**：客户端逻辑删除、Token 重新签发、7 态客户端状态、接入向导 UI、真实 Host 链路验证均已在 C2–C6 完成。
> 仍未实现的是**有意保留的非目标**：细粒度 scope（Growth 数据保持 local-only，不新增 growth/monthly/privacy scope）与 MCP Resource/Prompt。

## 正式确定的隐私策略（2026-11-04）

1. **Growth Data 保持 local-only**：不通过 MCP 暴露，不新增 growth scope，不改变 Phase 8 隐私边界。
2. **Candidate Memory 严格禁止 MCP 读取**：list_pending 保留但只返回非敏感统计（不返回正文/摘要/可识别内容）。只有 Confirmed Memories 可按已授权 scope 读取。
3. **连接状态分离两个维度**：
   - Authorization State：`pending_authorization` / `authorized` / `revoked` / `deleted`（逻辑删除）。
   - Activity State：`never_connected` / `recently_active` / `inactive` / `error`（error 仅在明确错误证据时）。
   - 用 `lastAccessAt` 记录最近成功访问，不伪造实时在线状态，不引入心跳。

## C2 — 客户端连接生命周期（已完成）

### 已确认的设计决策

1. **revoked 是终态**：不允许直接重新授权；如需重新连接，注册新的 `client_id` 和凭证，保留旧客户端审计记录。
2. **authorize 与 reissue 职责分离**：`authorize_client` 只负责 `pending_authorization → authorized`；已 `authorized` 的客户端必须用 `reissue_token` 更换 Token。
3. **Registry 与 Audit 非原子问题**：暂不在 C2 重构，列入 C5 安全加固。
4. **list_pending 候选内容隔离**：归属 C3。

### 实现内容

- 客户端注册（`register_client`，pending_authorization，无 token）
- 授权（`authorize_client`，pending → authorized，签发一次性 token）
- Token 重新签发（`reissue_token`，旧 token 立即失效）
- 客户端逻辑删除（`delete_client`，deleted，保留审计）
- 客户端状态查询（`authorization` + `activity` 双维度）
- 多客户端独立管理（重名注册拒绝；deleted 后可重新注册同名、生成独立 client_id）

安全要求：Token 用 `secrets.token_urlsafe(32)`；只存 SHA-256 哈希；重签发/撤销/删除后旧 token 立即失效；审计链不可删；不在日志记录 token 明文；状态变更服务端验证。

### C2 时记录的安全限制

- **Registry / Audit 原子性**：已在 C5 使用文件事务和统一锁顺序解决。
- **activity `error` 证据**：已在 C5 仅根据 `INVALID_CREDENTIAL` / `SCOPE_NOT_GRANTED` 的真实拒绝事件设置；下次成功访问后清除。
- **兼容字段冗余**：新 UI 只使用 `authorization`/`activity`；`status`/`connectionStatus` 继续作为兼容字段返回，避免破坏已有客户端，后续只能通过版本化 API 移除。

## C3 — 权限与候选记忆隔离（已完成）

- Growth Data 保持 local-only，monthly / growth / privacy 不向 MCP 开放。
- `list_pending` 仅返回总数和按类型计数，不返回候选记忆正文、摘要、来源或文件名。

## C4 — 本地 Host 真实接入（已完成）

- 新增 Claude Desktop / Cursor / VS Code 的 Host 配置生成器。
- 强制绝对 Python、Server 和 Vault 路径，避免 Host 工作目录不同导致失败。
- Token 仅从环境变量读取；生成器拒绝覆盖已有配置。
- 真实 stdio 验证覆盖 initialize、tools/list 和受权 Tool 调用。
- 当前机器未安装 Claude Desktop，因此未篡改用户 Host 配置；已验证的子进程命令与 Host 实际使用的 stdio 命令相同。

## C5 — 原子性与失败恢复（已完成）

- Registry 变更、`lastAccessAt` 更新和 Audit 事件共用事务；审计写入失败时回滚全部变更。
- 统一锁顺序覆盖并发注册和并发访问，审计哈希链保持完整。
- 错误状态只由明确的认证/权限拒绝事件触发，不伪造在线或异常状态。
- 故障注入覆盖注册回滚、Scope 回滚、无残留 Transaction journal 和恢复后继续授权。

## C6 — AI Connections UI 与接入向导（已完成）

- 独立 `#/ai-connections` 页面和可用导航入口。
- 支持待授权注册、明确授权、一次性 Token、重签、撤销和逻辑删除。
- 客户端状态已迁移到 `authorization` / `activity`；旧 `status` / `connectionStatus` 仅保留为只读兼容字段。
- Claude Desktop / Cursor / VS Code 接入向导仅生成不含私密数据的命令模板，不在前端返回真实 Vault 路径。
- 全部操作调用 FastAPI 和 Core，没有前端假交互，不改变 MCP 权限和记忆确认边界。
