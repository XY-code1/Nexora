# 本地 API

> 端点清单由 `apps/api/main.py` 的路由装饰器生成，共 104 个（含 SPA 回退）。
> 权威能力状态见 [`PROJECT_STATUS.md`](PROJECT_STATUS.md)。

## 运行边界

- 入口：`python -m apps.api.main --vault <PRIVATE_VAULT>`
- 仅监听 `127.0.0.1`，不提供局域网或公网绑定参数。
- 除健康检查外，所有端点要求 `Authorization: Bearer <启动令牌>`。
- 启动令牌每次运行随机生成；`launcher.py` 负责安全传递会话，直接命令行启动时 `POST /api/v1/shutdown` 返回 `503 SHUTDOWN_UNAVAILABLE`。
- API 只接受记忆 ID，不接受客户端文件路径。

## 接口

### 会话 / 运行时

```text
GET    /api/v1/health
GET    /api/v1/capabilities
GET    /api/v1/overview
POST   /api/v1/initialized
POST   /api/v1/shutdown
```

### Vault 生命周期

```text
GET    /api/v1/vault
GET    /api/v1/vault/events
GET    /api/v1/vaults
POST   /api/v1/vaults/validate
POST   /api/v1/vaults/create
POST   /api/v1/vaults/connect
POST   /api/v1/vault/switch
GET    /api/v1/vaults/default-path
POST   /api/v1/vaults/browse
DELETE /api/v1/vaults/{vault_id}
```

`DELETE` 只把 Vault 从登记中移除，绝不删除磁盘文件。完整生命周期见 [`VAULT_LIFECYCLE_PLAN.md`](VAULT_LIFECYCLE_PLAN.md)。

### 备份 / 恢复

```text
GET    /api/v1/backups
POST   /api/v1/backups
GET    /api/v1/backups/{backup_id}/verify
POST   /api/v1/backups/{backup_id}/restore
```

备份为 Vault 之外的 managed 快照，带文件哈希与 HMAC 绑定；保留策略为 20 份 / 500 MB。

### Git 同步

```text
GET    /api/v1/git/status
GET    /api/v1/git/history
GET    /api/v1/git/changes
POST   /api/v1/git/commit
POST   /api/v1/git/pull
POST   /api/v1/git/push
POST   /api/v1/git/restore
```

提交前做敏感文件扫描（命中则 fail closed），并先创建 managed 安全备份；`restore` 只回退工作区、不移动 HEAD。完整边界见 [`SYNC_AND_PUBLISH.md`](SYNC_AND_PUBLISH.md) 与 [`GITHUB_BACKUP_PLAN.md`](GITHUB_BACKUP_PLAN.md)。

### GitHub 备份

```text
GET    /api/v1/github/status
POST   /api/v1/github/client-id
POST   /api/v1/github/device-code
POST   /api/v1/github/device-poll
GET    /api/v1/github/repositories
POST   /api/v1/github/verify
POST   /api/v1/github/create
POST   /api/v1/github/connect
DELETE /api/v1/github/connection
```

授权走 Device Flow；token 只保留在 API 进程内存中，公开仓库在写入 remote 之前就会被拒绝。

### 记忆

```text
GET    /api/v1/memories?status=candidate|confirmed|rejected|archived
GET    /api/v1/memory-stats
GET    /api/v1/memories/{record_id}
POST   /api/v1/memories/candidates
PATCH  /api/v1/memories/{record_id}
POST   /api/v1/memories/{record_id}/confirm
POST   /api/v1/memories/{record_id}/reject
POST   /api/v1/memories/{record_id}/forget
POST   /api/v1/memories/{record_id}/supersede
```

生命周期见 [`MEMORY_LIFECYCLE.md`](MEMORY_LIFECYCLE.md)。

### 导入

```text
POST   /api/v1/imports/preview
POST   /api/v1/imports
```

导入只创建 candidate，绝不自动确认。

### 可视化

```text
GET    /api/v1/visualization/profile
GET    /api/v1/visualization/timeline
GET    /api/v1/visualization/privacy
GET    /api/v1/visualization/human3
GET    /api/v1/visualization/monthly
```

均为只读，并执行 [`VISUALIZATION_PRIVACY.md`](VISUALIZATION_PRIVACY.md) 定义的最小披露规则。

### 引导 / Human 3.0 / 月度复盘

```text
GET    /api/v1/onboarding
POST   /api/v1/onboarding/responses

GET    /api/v1/human3/session
POST   /api/v1/human3/session
PUT    /api/v1/human3/session/{session_id}/dimensions/{dimension}
PUT    /api/v1/human3/session/{session_id}/conclusion
POST   /api/v1/human3/session/{session_id}/confirm

GET    /api/v1/monthly-reflections
GET    /api/v1/monthly-reflections/{reflection_id}
POST   /api/v1/monthly-reflections
PUT    /api/v1/monthly-reflections/{reflection_id}/dimensions/{dimension}
POST   /api/v1/monthly-reflections/{reflection_id}/events
DELETE /api/v1/monthly-reflections/{reflection_id}/events/{event_id}
PUT    /api/v1/monthly-reflections/{reflection_id}/goals
POST   /api/v1/monthly-reflections/{reflection_id}/summary-draft
PUT    /api/v1/monthly-reflections/{reflection_id}/summary
POST   /api/v1/monthly-reflections/{reflection_id}/confirm
```

引导响应必须包含 `consent: true`，并且只会创建 candidate（见 [`CONVERSATIONAL_ONBOARDING.md`](CONVERSATIONAL_ONBOARDING.md)）。Human 3.0 与月度复盘都用 revision 控制，只有显式确认后才进入 History（见 [`HUMAN3_LIFECYCLE.md`](HUMAN3_LIFECYCLE.md)、[`MONTHLY_REFLECTION.md`](MONTHLY_REFLECTION.md)）。

### 成长

```text
GET    /api/v1/growth/dimensions
GET    /api/v1/growth/timeline
GET    /api/v1/growth/assessments
POST   /api/v1/growth/assessments
PUT    /api/v1/growth/assessments/{assessment_id}/dimensions/{dimension}
PUT    /api/v1/growth/assessments/{assessment_id}/level
POST   /api/v1/growth/assessments/{assessment_id}/confirm
DELETE /api/v1/growth/assessments/{assessment_id}
GET    /api/v1/growth/associations
POST   /api/v1/growth/associations
DELETE /api/v1/growth/associations/{association_id}
GET    /api/v1/growth/goals
POST   /api/v1/growth/goals
PUT    /api/v1/growth/goals/{goal_id}
DELETE /api/v1/growth/goals/{goal_id}
```

成长数据保持 local-only，不通过 MCP 暴露。自评与关联必须由用户填写，系统不推断分数。

### 安全中心 / AI 连接

```text
GET    /api/v1/security/overview
GET    /api/v1/security/clients
POST   /api/v1/security/clients
POST   /api/v1/security/clients/register
PUT    /api/v1/security/clients/{client_id}/scopes
POST   /api/v1/security/clients/{client_id}/revoke
POST   /api/v1/security/clients/{client_id}/authorize
POST   /api/v1/security/clients/{client_id}/reissue
DELETE /api/v1/security/clients/{client_id}
GET    /api/v1/security/audit-events
```

客户端凭据只在授权响应中显示一次；过滤、分页、哈希链与撤销语义见 [`SECURITY_CENTER.md`](SECURITY_CENTER.md)。

### Provider 连接器

```text
GET    /api/v1/providers
POST   /api/v1/providers
DELETE /api/v1/providers/{provider}
GET    /api/v1/providers/adapters
POST   /api/v1/providers/configure
DELETE /api/v1/providers/{provider}/config
POST   /api/v1/providers/preview
POST   /api/v1/providers/calls
POST   /api/v1/providers/call
GET    /api/v1/providers/audit
```

Key 只保留在 API 进程内存中；调用需要逐次批准（一次性、10 分钟过期），失败不会影响本地档案，全部留审计。

### SPA 回退

```text
GET    /{path:path}
```

托管 `apps/web/dist` 的静态资源；未匹配 API 路由时回退到 `index.html`。

## 一致性

- `core.profile.vault_lock` 使用 Vault 级跨进程文件锁。
- CLI、MCP、本地审核 UI 和 API 共用同一个锁。
- 单文件写入仍使用临时文件和 `os.replace`。
- confirm、reject、forget、supersede 使用事务日志；异常退出留下的 pending 日志会在下一次加锁时自动回滚。
- committed 日志只用于确认操作已完成，下一次恢复会清理而不回滚。

## 响应

成功：

```json
{"data": {}, "meta": {"requestId": "...", "revision": "..."}}
```

错误：

```json
{"error": {"code": "REVISION_CONFLICT", "message": "...", "details": {}}, "requestId": "..."}
```

修改请求必须提交上一次读取到的 `expected_revision`。记录已变化时返回 `409 REVISION_CONFLICT`，不会覆盖其他进程的更新。

## Launcher 集成

`launcher.py` 启动 API 时会注册优雅关闭回调，此时 `POST /api/v1/shutdown` 可用。直接通过 `python -m apps.api.main` 启动时，该端点返回 `503 SHUTDOWN_UNAVAILABLE`。

## 非目标

- React 界面、Cookie 会话和 CSRF。
- 对外网络访问（GitHub / Provider 端点除外，且均由用户显式授权）。
- 云端账户与托管档案服务。
