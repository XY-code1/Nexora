# Architecture

```text
AI Clients -> local MCP Gateway -> Private Obsidian Vault -> GitHub Private
                              \-> task-scoped context
```

## 信任边界

1. Public仓库只有代码、空模板和虚构示例。
2. Private仓库是个人事实的唯一可信源。
3. 新记忆先进入`memory/inbox/`，确认后才能进入`confirmed/`。
4. 模型输入必须经过任务级选择；模型输出只是草稿。
5. 公开发布必须通过独立导出目录和人工确认，不能直接合并私人Git历史。
6. 不同AI共享已确认事实，不共享完整会话状态。
7. MCP只允许创建候选记忆；确认、删除、发布保留给可信本地界面。

## 后续扩展

本地使用MCP stdio，不开放公网端口。远程接入以后再采用HTTPS、OAuth、分客户端scope和审计日志。

