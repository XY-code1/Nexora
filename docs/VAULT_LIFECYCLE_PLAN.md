# Vault Lifecycle Plan

> 2026-11-06 实施状态：P1–P7 最小闭环完成。切换采用安全重启而非热切换；外部变更采用 content revision 按需检测而非常驻 watcher。以下矩阵保留最初规划基线，实施结果见 `PRODUCT_ARCHITECTURE.md`。

## 1. 当前能力矩阵

| 生命周期 | 状态 | 当前实现 | 风险/缺口 |
|---|---|---|---|
| 初始化 | **已实现** | 模板复制到空目录，拒绝非空目标 | Web 无引导；错误恢复主要依赖 launcher 提示 |
| 选择 | **部分实现** | CLI 参数、环境变量、默认目录、Tk 文件夹选择 | 选择发生在 Web 之前，缺少最近列表和明确当前 Vault 身份 |
| 打开 | **已实现** | schema、隔离、swap recovery 校验后创建 API | runtime 文件包含路径；Windows ACL 未专项验证 |
| 使用 | **已实现** | Core 原子写、文件锁、revision、事务日志 | 外部编辑器不遵守锁 |
| 外部修改 | **部分实现** | 下一次读取可见；旧 revision 写入冲突 | 无 watcher、无实时提示、无 merge |
| 备份 | **已实现** | Vault 外 managed backup、文件哈希、HMAC 绑定 | 备份保留策略与磁盘配额未实现 |
| 恢复 | **已实现** | 确认短语、安全快照、目录交换、崩溃恢复 | 恢复后其他长期运行进程不会收到 Vault revision 变化通知 |
| 迁移 | **已实现** | 显式 migration、迁移前备份、失败回滚 | 仅 schema v1，缺少真实跨版本历史样本 |
| 切换 | **未实现** | 只能关闭服务后用另一 `--vault` 启动 | 单实例会复用旧服务，误以为已切换的风险 |
| 删除/忘记 Vault | **未实现** | 无产品入口 | 不应由应用递归删除 Vault；只允许从 registry 移除 |

## 2. 建议生命周期状态机

```text
UNCONFIGURED
  ├─ validate existing ─> READY_TO_OPEN
  └─ create new ────────> READY_TO_OPEN

READY_TO_OPEN ─> OPENING ─> ACTIVE
                         ├─ schema old -> MIGRATION_REQUIRED
                         ├─ invalid -> BLOCKED
                         └─ recovery journal -> RECOVERING -> ACTIVE

ACTIVE ─ external change -> STALE -> REFRESHED/CONFLICT
ACTIVE ─ switch request  -> STOPPING -> CLOSED -> OPENING(other vault)
ACTIVE ─ restore         -> BACKING_UP -> RESTORING -> ACTIVE
```

首版切换必须是进程重启，不做热切换。这样可以一次性失效旧 Bearer token、AbortController、缓存、文件锁、MCP 状态引用和 Web 页面状态。

## 3. Vault Identity

新增非敏感系统元数据：

```yaml
vault_id: vault_<random 128-bit id>
display_name: My Personal AI Profile
schema_version: 1
created_at: 2026-11-05T00:00:00Z
```

- `vault_id` 不从路径、用户名或内容计算。
- registry 的路径只保存在本机应用数据目录。
- Web 只显示 display name 与 `vault_id` 的短指纹，不显示完整路径。
- 备份、MCP client registry、审计事件增加 `vault_id` 关联；迁移期兼容旧 Vault。

## 4. 外部修改检测

### 最小方案

1. 服务启动时计算 Vault content revision。
2. 使用平台 watcher 监听受管理目录；watcher 只发出“可能变化”信号。
3. debounce 后重新计算受影响文件 revision。
4. Web 通过 SSE 或短轮询收到 `external_change`。
5. 有未保存表单时不自动刷新，展示“外部已修改：比较 / 放弃本地草稿 / 重新载入”。
6. 所有正式写入继续要求 expected revision。

### 不做的事情

- 不自动合并 Markdown 正文。
- 不把 Obsidian 识别为更高优先级写入者。
- 不因 watcher 事件自动确认、迁移或提交 Git。

## 5. 切换安全流程

1. Web 请求切换，服务检查正在进行的 mutation、restore、backup。
2. 展示旧 Vault 的脏状态、未备份状态和 MCP 连接数量。
3. 用户明确确认。
4. 关闭旧服务，删除旧 runtime token。
5. launcher 校验新 Vault：路径隔离、link/reparse、schema、必需文件。
6. 启动新服务并签发新 token。
7. Web 以新 session 打开并验证 `vault_id`。
8. MCP 保持原配置但标记“不匹配/需重启”，不得静默改绑。

## 6. 测试计划

- 创建空 Vault、选择已有 Vault、拒绝非空无效目录。
- 同一 Vault 重启保持 `vault_id`；复制 Vault 后按产品决策生成或保留 identity 的测试。
- A/B Vault 并行数据、客户端、审计、备份完全隔离。
- 切换后旧 token、旧 API client、旧 revision 全部拒绝。
- Obsidian 合成写入触发 stale；无草稿自动刷新，有草稿要求用户决策。
- 外部非原子保存、临时文件、rename-save、删除与恢复。
- restore 中断、launcher 中断、journal 损坏、磁盘空间不足。
- Windows junction/symlink/reparse point 逃逸拒绝。

## 7. 验收标准

- 当前 Vault 身份始终可见但不泄漏完整路径。
- 用户不能在“以为切换成功”时继续操作旧 Vault。
- 切换后所有旧授权上下文失效。
- 外部编辑不会被 Web 静默覆盖。
- 任一失败路径都不删除原 Vault，并留下可解释的恢复状态。
