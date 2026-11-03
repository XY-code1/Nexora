# V0.1 本地 API

## 运行边界

- 入口：`python -m apps.api.main --vault <PRIVATE_VAULT>`
- 仅监听 `127.0.0.1`，不提供局域网或公网绑定参数。
- 除健康检查外，所有端点要求 `Authorization: Bearer <启动令牌>`。
- 启动令牌每次运行随机生成；当前命令行入口仅供开发，Phase 4 Launcher 将负责安全传递会话。
- API 只接受记忆 ID，不接受客户端文件路径。

## 接口

```text
GET    /api/v1/health
GET    /api/v1/capabilities
GET    /api/v1/visualization/profile
GET    /api/v1/visualization/timeline
GET    /api/v1/visualization/privacy
GET    /api/v1/visualization/human3
GET    /api/v1/security/overview
GET    /api/v1/security/clients
POST   /api/v1/security/clients
PUT    /api/v1/security/clients/{id}/scopes
POST   /api/v1/security/clients/{id}/revoke
GET    /api/v1/security/audit-events
GET    /api/v1/onboarding
POST   /api/v1/onboarding/responses
GET    /api/v1/human3/session
POST   /api/v1/human3/session
PUT    /api/v1/human3/session/{id}/dimensions/{dimension}
PUT    /api/v1/human3/session/{id}/conclusion
POST   /api/v1/human3/session/{id}/confirm
GET    /api/v1/memories?status=candidate|confirmed|rejected|archived
GET    /api/v1/memories/{id}
POST   /api/v1/memories/candidates
PATCH  /api/v1/memories/{id}
POST   /api/v1/memories/{id}/confirm
POST   /api/v1/memories/{id}/reject
POST   /api/v1/memories/{id}/forget
POST   /api/v1/memories/{id}/supersede
POST   /api/v1/shutdown
```

Security Center 端点全部要求启动器 Bearer 会话。客户端凭据只在授权响应中显示一次；过滤、分页、哈希链与撤销语义见 [`SECURITY_CENTER.md`](SECURITY_CENTER.md)。

可视化端点均为只读，并执行[`VISUALIZATION_PRIVACY.md`](VISUALIZATION_PRIVACY.md)定义的最小披露规则。

引导响应必须包含`consent: true`，并且只会创建candidate。完整边界见[`CONVERSATIONAL_ONBOARDING.md`](CONVERSATIONAL_ONBOARDING.md)。

Human 3.0草稿使用revision控制，只有显式确认后才移动到History。完整生命周期见[`HUMAN3_LIFECYCLE.md`](HUMAN3_LIFECYCLE.md)。

修改请求必须提交上一次读取到的`expected_revision`。记录已变化时返回`409 REVISION_CONFLICT`，不会覆盖其他进程的更新。

## 一致性

- `core.profile.vault_lock`使用 Vault 级跨进程文件锁。
- CLI、MCP、本地审核 UI 和 API 共用同一个锁。
- 单文件写入仍使用临时文件和`os.replace`。
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

## Launcher集成

`launcher.py`启动API时会注册优雅关闭回调，此时`POST /api/v1/shutdown`可用。直接通过`python -m apps.api.main`启动时，该端点返回`503 SHUTDOWN_UNAVAILABLE`。

## Phase 2 非目标

- React 界面、Cookie 会话和 CSRF。
- Windows 安装包与桌面外壳。
- 对外网络访问。
