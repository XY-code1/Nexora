# Phase 8 — Human 3.0 架构与数据建模分析报告（P8.1）

> 状态：待人工确认。本报告只做分析，不包含代码提交；确认后再进入 P8.2。

## 1. 现有架构审查

代码按职责分层，边界清晰（本地优先、写入走 Core 的锁/revision/事务）：

| 模块 | 职责 | 数据位置 |
|---|---|---|
| core/profile.py | 记忆领域逻辑、Vault 存储、文件锁、revision、事务恢复 | `30 Memory/{Inbox,Confirmed,Rejected,Archived}` |
| core/access.py | ai_access 策略（denied/local-only/summary-only/allowed） | - |
| core/human3.py | Human 3.0 复盘生命周期（四维自评 + 0-10 评分） | `40 Reviews/Human3/{Answers,History}` |
| core/monthly_reflection.py | 月度复盘（四维文本 + 事件 + 目标） | `40 Reviews/Monthly/{Drafts,History}` |
| core/onboarding.py | 对话式引导 | 引导主题与候选 |
| core/security.py | 客户端授权注册表 + 防篡改审计链 | `90 System/Security` + `90 System/Audit` |
| core/visualization.py | 只读视图（profile/timeline/privacy/human3/monthly） | - |
| core/vault_management.py | 隔离/迁移/备份/公开导出 | - |
| core/sync.py | 跨设备 Git 同步 | - |

## 2. 现有数据模型清单（Phase 8 应复用，禁止重复建）

### 2.1 记忆（core/profile.py）
metadata：`id, type, status, subject, source_agent, created, updated, visibility, ai_access, tags, fingerprint`。正文为确认/候选记忆内容。状态机 candidate→confirmed/rejected/forgotten/superseded。

### 2.2 Human 3.0 复盘（core/human3.py）
- 四维键 `mind/body/spirit/vocation`，每维 `{reflection 反思, evidence 依据, evidenceState 信息状态, score 自评分 0-10}`。
- 摘要 + 未来30天计划。
- 状态 draft → confirmed（`Answers` → `History`）；确认时把各维 score 写入 frontmatter（`mind/body/spirit/vocation` 键）。
- `ai_access: summary-only`（MCP 可读摘要）。

### 2.3 月度复盘（core/monthly_reflection.py）
- 四维键同 `mind/body/spirit/vocation`，但为**纯文本**（无评分）。
- 事件 `events`：`{id, date, dimension, title, description, feeling, project}`。
- 目标 `goals`：`{id, title, action, priority, due, completed, previousGoalId}`。
- 摘要；状态 draft → confirmed；`ai_access: local-only`。

### 2.4 关键观察
1. **四维分类已存在两处**（human3 与 monthly_reflection），键相同、结构/标题不同。Phase 8 不应再造第三套维度模型，应**聚合这两处**。
2. **目标模型已存在**（monthly_reflection.goals），P8.6 直接复用，不建第二套。
3. **历史快照已存在**（各 History 目录，append-only + confirmed + revision）。
4. **来源关联已具备基础**（memory.source_agent、event.date/dimension、Phase 7 审计链）。
5. **数据版本管理已具备**（profile.revision + require_revision + transaction + atomic_write）。

## 3. Human 3.0 数据模型设计

### 3.1 原则
- 只读聚合层优先，最小化新增存储。
- 复用四维键作为统一分类，不新建。
- 复用月度目标模型（P8.6）。
- 新增存储仅限两处：成长自评（P8.3）、跨维关联（P8.5）。

### 3.2 新增存储（最小化）

**A. 成长自评（P8.3）** — 新 record_type `growth-assessment`，建议放 `40 Reviews/Growth/{Drafts,History}`：
- metadata：`assessment: growth, id: ga-YYYY-MM-xxxxxxxx, month, status(draft|confirmed), visibility: private, ai_access: local-only, created, updated, confirmed_at`
- 正文（四维，每维）：`current`（当前状态描述）、`evidence`（成长证据，可记录来源 id）、`challenges`（困难与挑战）、`direction`（未来发展方向）
- 参考框架：Human 3.0 Level 1.0/2.0/3.0 仅作**用户自选标签**（可选字段），系统**不自动定级**。
- 版本：复用 revision + 事务；编辑已确认记录回退 draft（沿用 monthly_reflection 模式）。

**B. 跨维关联（P8.5）** — 用户主动添加的关联说明，建议独立文件 `40 Reviews/Growth/associations.jsonl`：
- 字段：`id, fromDimension/fromEventId, toDimension/toEventId, relationType(correlation|causation|user_noted), note, confirmedAt`
- 默认 `correlation`；`causation` 必须用户显式确认；无证据不推断因果。

### 3.3 派生视图（不新增存储）
- 四维聚合（P8.2/P8.4）：读 human3 History + monthly History + 已确认记忆，按月聚合。
- 成长时间线（P8.4）：按 month 排序，展示四维历史、重要事件、评估对比，附来源证据。
- Dashboard（P8.7）：上述派生数据的可视化。

## 4. API 设计（草案）
- `GET /api/v1/growth/overview` —— 成长概览（聚合派生）
- `GET /api/v1/growth/timeline?month=` —— 成长时间线
- `GET/POST/PUT /api/v1/growth/assessments` —— 自评读写（含 revision 乐观并发）
- `GET/POST/DELETE /api/v1/growth/associations` —— 跨维关联
- 复用现有 `/api/v1/visualization/*` 与 `/api/v1/monthly-reflections/*`

## 5. 前端设计（P8.7）
新增六个视图：Growth Overview / Four Dimensions / Growth Assessment / Evolution Timeline / Cross-Dimension Map / Goals & Actions。复用现有 Sidebar/Topbar/Design Tokens（Deep Space / Midnight Navy / Electric Blue / Cyan / Violet / Holographic）。桌面优先、移动适配。

## 6. 测试计划
覆盖：四维读取、来源追溯、自评创建/修改/撤销、历史快照、月份查询、跨维关联、目标创建/更新、删除、权限拒绝、local-only 限制、空状态、历史完整性；跑 npm test/lint/build/e2e + Python 套件。

## 7. 需人工确认的关键决策
1. **成长自评存放位置**：建议独立 `40 Reviews/Growth/`；是否同意？
2. **跨维关联存储**：独立 `associations.jsonl` vs 嵌入自评记录；建议独立文件，是否同意？
3. **Level 参考框架**：本阶段只做用户自选标签（不定级），还是先不做？
4. **MCP 暴露**：建议 growth 数据一律 local-only、不新增 MCP scope；是否同意？
5. **已误提交的 `1d62750`**（月度趋势聚合视图）：保留作为 P8.4 的前置、还是先回滚？

确认以上后，再进入 P8.2 四维开发。
