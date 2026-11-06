# Product UX Roadmap

> 2026-11-06 更新：P1–P7 最小产品闭环已完成。下方“当前 UX 状态”是实施前基线；最新状态见第 3 节实施结果与 `PRODUCT_ARCHITECTURE.md`。

## 1. 产品导航模型

Web 是主产品，Obsidian、GitHub 和 MCP 是可选能力。首次体验不应要求用户理解 Python、Git 或 Obsidian。

```text
首次启动
  -> 创建或选择 Vault
  -> 本地隐私说明
  -> 对话式建档
  -> Memory Review
  -> Personal Profile

日常使用
  -> Overview 推荐下一步
  -> 复盘 / 审核 / 档案

可选设置
  -> Obsidian 打开同一 Vault
  -> GitHub 私人备份
  -> MCP AI Connections
```

## 2. 当前 UX 状态

| 体验 | 状态 | 说明 |
|---|---|---|
| Web 主业务 | **已实现** | 核心页面和真实 API 已可用 |
| Windows 启动 | **已实现** | 单实例、本地 token、浏览器打开、关闭服务 |
| Vault 首次创建/选择 | **部分实现** | launcher 文件夹选择，不在 Web 内 |
| 当前 Vault 身份 | **未实现** | UI 只显示“Vault 已就绪”，无法区分 A/B Vault |
| Vault 切换 | **未实现** | 无 Web 流程；第二次 launcher 可能复用旧实例 |
| Obsidian 协作 | **部分实现** | 可编辑同一目录，但无外部变更提示 |
| 本地备份恢复 | **已实现** | Web 有验证、确认和恢复闭环 |
| GitHub 备份 | **部分实现** | CLI-only，无产品向导 |
| MCP 接入 | **已实现/部分实现** | 授权与命令模板已完成，宿主配置仍需用户操作 |

## 3. P1-P7 路线图

实施结果：P1–P7 均已完成验收范围；P3 采用按需 revision 检测，P5 限定为用户预配置的私人 Git 仓库，不包含 GitHub OAuth/Device Flow。

### P1 Vault Identity 与启动状态

- Topbar 显示 Vault display name、短 ID、schema 和外部变更状态。
- 错误状态区分：未选择、无效、需迁移、恢复中、已打开。
- 不显示完整文件路径。

**验收**：截图和 API 都能证明当前操作的是哪个 Vault，且不泄漏路径。

### P2 Web 首次引导与安全切换

- 首次页面提供“创建新 Vault / 选择已有 Vault”。
- 选择后先 validate，再明确显示影响。
- 切换采用关闭并重启；未保存草稿、运行中备份和 MCP 连接必须提示。

**验收**：A -> B 后旧 token 和旧页面请求失败；B 不显示 A 的任何统计或内容。

### P3 外部编辑协作

- 设置页提供“用 Obsidian 打开”但明确其为可选编辑器。
- 外部变化时显示非阻塞提示；表单有草稿时升级为冲突对话框。
- 提供重新加载和比较，不提供自动 merge。

**验收**：合成外部写入可被检测，Web 不静默覆盖。

### P4 数据访问一致性

- 将 API/MCP/legacy 只读扫描收口到 Core repository。
- 统一 Loading、Stale、Conflict、Blocked 和 Recovery 状态。
- legacy `review_app.py` 仅保留兼容入口，不发展新功能。

**验收**：同一文件在 Web、MCP、CLI 得到一致的访问裁剪和 revision。

### P5 GitHub Private Backup

- 设置页加入只读诊断、变更预览、私有仓库验证和显式同步。
- 默认关闭自动网络访问。
- 分叉时提供说明和导出诊断，不自动解决。

**验收**：没有授权就没有网络；public remote 无法启用；失败不改变 Vault。

### P6 MCP Vault 绑定体验

- AI Connections 显示目标 Vault short ID、client scope 和最近访问。
- 生成 host 配置前核对 Vault identity。
- Vault 切换后将旧 host 标记为“需要重启”，不静默迁移权限。

**验收**：MCP 与 Web vault_id 不同则 fail closed，并记录不含正文的审计事件。

### P7 多 Vault 与恢复中心

- Vault registry、最近使用、移除引用、磁盘/备份健康度。
- 提供“忘记此 Vault”但绝不删除真实目录。
- 统一 managed backup、Git 历史和 schema migration 的恢复入口。

**验收**：多 Vault 全量 E2E、崩溃恢复、Windows 安装包和升级回归通过。

## 4. 页面与交互原则

- Overview 只推荐一个真实下一步，不伪造完成度。
- Vault mutation、恢复、Git push、客户端授权都需要明确确认。
- “已保存”必须说明保存到本地草稿、候选记忆还是正式记录。
- 外部修改状态优先于成功 toast；冲突不能被自动刷新掩盖。
- Obsidian 和 GitHub 都放在 Integrations/Backup，不放在首次必经路径。
- 移动端允许查看和轻量编辑；Vault 目录选择、Git 冲突恢复可提示转到桌面端。

## 5. 测试矩阵

| 场景 | 单元/集成 | E2E |
|---|---|---|
| 新建/选择/打开 Vault | Core + API | Windows launcher + Web |
| A/B Vault 切换 | API session/token | 内容、统计、审计零串漏 |
| Obsidian 外部编辑 | watcher + revision | 有/无 Web 草稿两种路径 |
| 备份/恢复/迁移 | 哈希、journal、rollback | 中断与恢复后刷新 |
| GitHub | Git core + API mock | 私有仓库向导与失败恢复 |
| MCP | stdio + scope + vault_id | Web/MCP 同 Vault 与错配拒绝 |
| 安装包 | release gate | 干净 Windows 安装、升级、卸载 |

## 6. 当前不应提前做

- 不做热切换 Vault。
- 不做自动 Git commit/push/pull。
- 不做 Markdown 三方自动合并。
- 不把 Obsidian 变成运行依赖。
- 不把 Vault 内容复制到云端数据库。
- 不因接入 MCP 而扩大 AI 权限或绕过 Memory Review。
