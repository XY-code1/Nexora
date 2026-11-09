# Personal AI Profile 产品架构审计

审计日期：2026-11-05；P1–P7 实施复核：2026-11-06  
定位：**Your Personal Intelligence Layer**  
范围：只读代码审计与临时合成 Vault 验证；未读取私人 Vault，未修改业务代码。

> **实施更新（2026-11-06）**：审计后的 P1–P7 最小闭环已经落地。Vault 现有随机稳定 identity、本机 registry、Web 创建/校验/重启切换、外部修改 revision 检测、统一只读 repository 边界、Git 操作面板、MCP identity 握手和多 Vault/launcher/发布门禁测试。下文“当前状态”保留审计时基线，最终验收状态以本文末《P1–P7 实施结果》为准。

> **2026-11-09 更新**：下文各「未实现 / 部分实现」条目为审计时基线。GitHub Device Flow、private 仓库创建与验证、连接向导、Git 历史浏览与恢复、备份保留策略、变更预览与敏感扫描、常驻外部修改检测均已落地。**当前状态以 [`PROJECT_STATUS.md`](PROJECT_STATUS.md) 为准。**

## P1–P7 实施结果

| 阶段 | 状态 | 已交付 |
|---|---|---|
| P1 Vault Identity 与行为契约 | **已实现** | `90 System/vault.json` 使用随机 128-bit ID；API 不返回路径；最近 Vault 路径只保存在本机应用数据目录 |
| P2 Web 创建、选择及重启式切换 | **已实现** | 校验、创建、登记、切换 API 与 Web 控件；切换关闭旧服务、删除旧 runtime、签发新 token |
| P3 Obsidian 外部修改检测 | **已实现（轮询式）** | 基于全 Vault content revision 检测外部变化；不自动覆盖或合并；正式写入继续执行 revision 检查 |
| P4 API/MCP/Legacy 访问收口 | **已实现** | 新增 `core.repository` 安全只读边界，API、MCP 和 legacy review 列表读取复用路径约束 |
| P5 GitHub Private Backup 向导 | **已实现（预配置仓库）** | Web 显示 Git 状态并提供显式确认的 commit/pull/push；分叉、脏状态、非 fast-forward fail closed |
| P6 MCP Vault 身份握手 | **已实现** | host 配置写入 `PROFILE_VAULT_ID`；不匹配时 MCP 拒绝启动访问；提供非敏感 identity 工具 |
| P7 多 Vault、恢复和安装包验收 | **已实现** | 临时 A/B Vault 隔离、真实 launcher 重启切换、旧 token 更换、备份恢复与 release gate 纳入回归 |

当前主动限制：P3 不常驻文件 watcher，而是在状态读取时计算 revision；P5 不代管 GitHub 凭据、不创建远程仓库，也不替用户证明远程为 private。这样避免把 token 写入 Vault 或应用存储。远程私有性仍必须由用户在 GitHub 中确认。

## 1. 状态定义

- **已实现**：仓库中存在可运行实现和对应验证。
- **部分实现**：已有底层能力，但缺少 Web 产品闭环、统一入口或关键保护。
- **未实现**：目标能力不存在。
- **存在风险**：已实现但仍有明确安全、一致性或产品风险。

## 2. 当前真实架构

```text
React + TypeScript Web
  │ Bearer session / JSON API
  ▼
FastAPI local service (127.0.0.1)
  │ vault root fixed at process startup
  ▼
Core domain + access + security
  │ atomic writes / revision / locks / transaction journals
  ▼
Local Markdown Vault  ←──────── Obsidian or another editor
  │
  ├── Managed local backups (outside Vault, HMAC-bound)
  ├── Optional private Git repository (CLI-only sync)
  └── MCP stdio gateway (separate process, same PROFILE_VAULT)
```

事实源是 Vault 中的 Markdown、JSON/JSONL 系统记录；React 状态、API 响应、备份和 Git 历史均不是事实源。

## 3. 组件与数据关系

| 组件 | 当前职责 | 真实状态 | 结论 |
|---|---|---|---|
| Web | 记忆审核、档案、复盘、成长、安全、备份、AI 连接 | **已实现** | 可不依赖 Obsidian 使用主要业务能力，但不能在 Web 内创建、选择或切换 Vault |
| FastAPI | 本地认证、版本化 API、静态前端、服务关闭 | **已实现** | 只绑定启动时传入的单个 Vault |
| Core | Markdown 生命周期、访问策略、revision、锁、事务、备份、Git 同步 | **已实现** | 适配器统一经 `core.repository` 只读边界 |
| Vault | 唯一事实源 | **已实现** | schema v1；目录结构固定；禁止与公共框架仓库互相包含 |
| Obsidian | 可选外部编辑器 | **已实现** | 可编辑同一目录；常驻 watcher 检测外部修改并提示冲突，但不自动合并 |
| GitHub | 私人备份和版本历史 | **已实现** | Device Flow、private 仓库创建与验证、连接向导、Git 历史浏览与恢复 |
| MCP | AI 受控读取与候选写入 | **已实现** | stdio、客户端 token、scope、审计链；必须独立配置同一绝对 Vault 路径 |

## 4. 审计结论

### 4.1 Vault 初始化、创建、选择、切换

- **已实现**：`core.profile.init()` 从模板初始化空目录；launcher 对不存在或空目录自动初始化。
- **部分实现**：launcher 支持 `--vault`、`PROFILE_VAULT`、默认目录和系统文件夹选择器。
- **已实现**：Web 内的 Vault 首次引导、最近 Vault 列表、创建/校验/切换 API。
- **存在风险**：launcher 单实例锁是应用级而非 Vault 级；第二次用不同 `--vault` 启动时会复用已运行实例，不能完成切换，也不会提示当前实际 Vault。

### 4.2 Web 脱离 Obsidian

- **已实现**：Web 可完成候选创建、审核、档案查看、月度复盘、成长记录、安全授权、备份恢复。
- **部分实现**：首次选择 Vault 仍由 launcher/Tk 完成；基础 Profile 的任意 Markdown 编辑能力不完整。
- **结论**：业务使用基本独立，产品启动与通用文档编辑尚未完全独立。

### 4.3 Markdown 读写统一性

- **已实现**：主要写操作经 Core，使用路径约束、原子写、revision 和锁。
- **已实现**：API、MCP 与 legacy `review_app.py` 均通过 `core.repository` 只读边界读取。
- **存在风险**：统一规则依赖开发纪律，而不是单一 Storage Port；新增适配器可能绕开一致性处理。

### 4.4 外部修改、revision、锁和冲突

- **已实现**：记录 SHA-256 revision；写 API 要求 expected revision；Vault restore 使用全 Vault content revision；进程间 FileLock；多文件生命周期事务有 journal 恢复。
- **部分实现**：Obsidian 修改会在下一次读取或写入时被看见，旧 revision 写入会被拒绝。
- **已实现**：常驻 Vault watcher、外部变更事件（`/api/v1/vault/events`）与 Web 非阻塞冲突提示均已落地。三方合并不提供（有意）。
- **存在风险**：Obsidian 不遵守应用锁。读取恰逢外部非原子保存时，可能看到短暂不完整内容；用户在 Web 上只会在提交时得到冲突。

### 4.5 GitHub 与版本管理

- **已实现**：Git 状态、全量提交、fetch、fast-forward-only pull、push；脏状态和分叉拒绝；测试使用本地 bare remote。
- **已实现**：GitHub Device Flow、仓库创建、远程私有性校验、连接向导、Web 历史浏览与恢复均已落地。
- **存在风险**：`sync_commit` 执行 `git add -A`，安全性依赖 Vault `.gitignore` 和用户仓库配置；代码不验证远程是否为 GitHub 私有仓库。

### 4.6 MCP 与同一 Vault

- **已实现**：MCP 通过 `PROFILE_VAULT` 绑定 Vault，调用相同 schema、隔离、锁和安全授权；AI 只能提出候选，不能确认。
- **已实现**：MCP 与 Web 通过 `vault_id` 握手；错配时 fail closed 并记录审计事件。
- **存在风险**：配置错误时，Web 与 MCP 可分别绑定不同 Vault；未来 Web 切换 Vault 后，已运行 MCP 不会自动切换。

### 4.7 多 Vault 隔离与泄漏面

- **已实现**：每个 API/MCP 进程固定 root；安全注册表和审计日志位于各 Vault；managed backup 使用本机密钥和 Vault 路径 HMAC 绑定；跨 Vault 恢复被拒绝；公共框架与私人 Vault 必须完全分离。
- **部分实现**：本机 runtime 文件记录当前 Vault 绝对路径与 session token；尝试 chmod 0600，但 Windows ACL 语义未被明确验证。
- **已实现**：稳定 `vault_id`、Vault registry、切换前后 session 失效、多 Vault E2E。

## 5. 主要差距与优先级

| 优先级 | 差距 | 建议 |
|---|---|---|
| P0 | 当前没有已发现的数据损坏阻塞项 | 保持现有确认、revision、锁和隔离门禁 |
| P1 | 缺少 Vault identity 与 Web 生命周期 | 引入非敏感 `vault_id`、Vault registry 和状态 API |
| P1 | 切换无法保证所有会话/进程同步 | 切换采用“停止旧服务并重新启动”，首版不做热切换 |
| P1 | 外部编辑无检测与提示 | 增加 watcher + content revision 事件，不自动覆盖 |
| P2 | GitHub 仅 CLI 且不验证私有远程 | 建立显式配置、预览、授权和审计流程 |
| P2 | MCP/Web 可能绑定不同 Vault | 接入握手返回 `vault_id`，仅显示标识而非路径 |
| P2 | 适配器仍有直接文件扫描 | 建立只读 Repository/Storage 门面并逐步收口 |

## 6. 建议的 API 与数据模型

首版只新增，不破坏现有 API：

```text
GET  /api/v1/vault                 -> vault_id, display_name, schema, revision, external_change
GET  /api/v1/vaults               -> 本机 registry 中的非敏感元数据
POST /api/v1/vaults/validate      -> 校验用户选择的目录
POST /api/v1/vaults/create        -> 创建新 Vault（高风险确认）
POST /api/v1/runtime/restart      -> 使用选定 vault_id 重启；不在进程内热切换
GET  /api/v1/vault/events         -> SSE/轮询外部变更事件
GET  /api/v1/git/status           -> 本地 Git 状态和已脱敏 remote 信息
POST /api/v1/git/commit|pull|push -> 明确预览和确认后执行
```

建议本机 registry 只保存 `vault_id`、显示名、规范化路径、最近打开时间；不得进入公共仓库或 Vault 公开导出。`vault_id` 应随机生成并写入 Vault 系统元数据，不能由绝对路径直接泄漏推导。

## 7. P1-P7 开发顺序

1. **P1 Vault Identity 与行为契约**：稳定 `vault_id`、registry、API 契约、威胁模型。
2. **P2 Vault 创建/选择/重启闭环**：Web 引导 + launcher restart；不做热切换。
3. **P3 外部修改检测**：watcher、revision 事件、刷新/冲突提示。
4. **P4 存储访问收口**：将 API/MCP/legacy 读取统一到 Core repository。
5. **P5 GitHub 私人备份向导**：配置、私有性验证、变更预览、commit/pull/push。
6. **P6 MCP Vault 身份握手**：host 配置校验、旧连接失效、审计关联。
7. **P7 多 Vault 与灾难恢复验收**：隔离矩阵、切换、崩溃恢复、安装包全回归。

详细生命周期、GitHub 方案和 UX 顺序见同目录其他三份文档。
