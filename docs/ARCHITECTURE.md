# Architecture

```text
Public Framework -> local CLI -> Private Vault
                               -> task-scoped context -> optional model
```

## 信任边界

1. Public仓库只有代码、空模板和虚构示例。
2. Private仓库是个人事实的唯一可信源。
3. 新记忆先进入`memory/inbox/`，确认后才能进入`confirmed/`。
4. 模型输入必须经过任务级选择；模型输出只是草稿。
5. 公开发布必须通过独立导出目录和人工确认，不能直接合并私人Git历史。

## 后续扩展

模型适配器和Agent适配器应位于公开框架，但不得拥有默认写入权。首版故意不包含常驻Agent、向量数据库或自动发布。

