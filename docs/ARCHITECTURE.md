# Architecture

```text
Local CLI (profile.py) --------\
Local Review UI (review_app.py) -\
Local HTTP API (apps/api) --------> core.profile / core.access ---> Private Obsidian Vault
AI Clients -> MCP adapter -------/             |
                                      Markdown is source of truth
```

`profile.py`是兼容CLI；领域、文件存储和生命周期位于`core.profile`，AI访问策略位于`core.access`。MCP和本地审核界面都是适配器，不各自实现领域规则。

## 信任边界

1. Public仓库只有代码、空模板和虚构示例。
2. Private仓库是个人事实的唯一可信源。
3. 新记忆先进入`30 Memory/Inbox/`，确认后才能进入`30 Memory/Confirmed/`。
4. 模型输入必须经过任务级选择；模型输出只是草稿。
5. 公开发布必须通过独立导出目录和人工确认，不能直接合并私人Git历史。
6. 不同AI共享已确认事实，不共享完整会话状态。
7. MCP只允许创建候选记忆；确认、删除、发布保留给可信本地界面。

## 后续扩展

当前MCP使用stdio；审核界面和版本化HTTP API仅监听loopback。所有入口共享Vault文件锁，API使用启动令牌、内容revision和事务恢复。Phase 3再接入React界面，Phase 4负责单实例Launcher和优雅关闭。远程接入以后再评估HTTPS和OAuth。

