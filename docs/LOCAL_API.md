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
GET    /api/v1/memories?status=candidate|confirmed|rejected|archived
GET    /api/v1/memories/{id}
POST   /api/v1/memories/candidates
PATCH  /api/v1/memories/{id}
POST   /api/v1/memories/{id}/confirm
POST   /api/v1/memories/{id}/reject
POST   /api/v1/memories/{id}/forget
POST   /api/v1/memories/{id}/supersede
```

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

## Phase 2 非目标

- React 界面、Cookie 会话和 CSRF。
- 单实例 Launcher、浏览器自动打开和优雅关闭。
- Windows 安装包与桌面外壳。
- 对外网络访问。
