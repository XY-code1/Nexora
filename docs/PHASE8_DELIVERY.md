# Phase 8 — Human 3.0 交付物回顾

> 状态：全部子阶段（P8.1–P8.7）已完成并进入 `main`；2026-11-04 专项验收通过。本文档汇总整个 Phase 8 的交付物。

## 1. 概述

Phase 8 把 Personal AI Profile 从「个人记忆管理系统」升级为「长期个人成长分析系统」，通过四个维度（MIND / BODY / SPIRIT / VOCATION）记录、观察、分析和规划长期变化。核心原则：用户是自身成长的最终判断者，AI 只辅助整理分析，所有分析有真实数据依据，不自动诊断、不贴标签、不虚构成长分数。

## 2. 子阶段交付

| 子阶段 | 内容 | 交付物 |
|---|---|---|
| P8.1 | 架构与数据建模 | `docs/PHASE8_ARCHITECTURE.md`（已确认） |
| P8.2 | 四维分类 + 只读聚合 | `core/growth.py` 的 `GROWTH_DIMENSIONS` + `dimension_overview` |
| P8.3 | 成长自评 | `core/growth.py` 的 assessment 存储与生命周期 |
| P8.4 | 成长时间线 | `core/growth.py` 的 `growth_timeline` |
| P8.5 | 跨维关联分析 | `core/growth.py` 的 associations 存储 |
| P8.6 | 目标与行动计划 | `core/growth.py` 的 goals 存储 |
| P8.7 | Dashboard | `GrowthDashboard.tsx` + 前端接线 + 样式 |

## 3. 数据模型

- **四维统一分类** `GROWTH_DIMENSIONS`：mind/body/spirit/vocation，各含标题、副标题、内容领域（areas）。复用 human3 与 monthly_reflection 的两套四维，不新建第三套维度模型。
- **成长自评** `40 Reviews/Growth/{Drafts,History,Archived}`，record_type `growth-assessment`，id `ga-YYYY-MM-xxxxxxxx`。正文 JSON：`{month, level, dimensions: {mind/body/spirit/vocation: {current, evidence, challenges, direction}}}`。Level 1.0/2.0/3.0 仅用户自选标签。编辑已确认记录回退 draft；确认要求四维 current 全非空；删除归档。
- **跨维关联** `40 Reviews/Growth/associations.jsonl`：`{id, fromDimension, fromEventId, toDimension, toEventId, relationType(correlation|causation), note, createdAt}`。causation 必须用户显式提供说明，无证据不推断因果。
- **成长目标** `40 Reviews/Growth/goals.jsonl`：复用 Phase 6 goal 字段 + `horizon(long-term|quarterly|monthly)`，`previousGoalId` 支撑历史目标回顾。
- **复用现有模型**：human3（四维评分）、monthly_reflection（四维文本/事件/目标）、memory（确认记忆）、revision/事务/atomic_write/文件锁。

## 4. API 端点（全部 Bearer 认证、loopback、只读或经 Core 写）

- `GET /api/v1/growth/dimensions` — 四维聚合
- `GET /api/v1/growth/assessments` — 自评列表
- `POST /api/v1/growth/assessments` — 创建自评
- `PUT /api/v1/growth/assessments/{id}/dimensions/{dimension}` — 保存某维
- `PUT /api/v1/growth/assessments/{id}/level` — 保存自选层级
- `POST /api/v1/growth/assessments/{id}/confirm` — 确认
- `DELETE /api/v1/growth/assessments/{id}` — 归档删除
- `GET /api/v1/growth/timeline?month=` — 成长时间线
- `GET /api/v1/growth/associations` — 关联列表
- `POST /api/v1/growth/associations` — 添加关联
- `DELETE /api/v1/growth/associations/{id}` — 删除关联
- `GET /api/v1/growth/goals?horizon=` — 目标列表
- `POST /api/v1/growth/goals` — 添加目标
- `PUT /api/v1/growth/goals/{id}` — 更新目标（含完成状态）
- `DELETE /api/v1/growth/goals/{id}` — 删除目标

## 5. 文件清单

新增：

- `core/growth.py`
- `docs/PHASE8_ARCHITECTURE.md`
- `tests/test_growth.py`
- `apps/web/src/GrowthDashboard.tsx`

修改：

- `apps/api/main.py`（import + input models + 15 个端点）
- `apps/web/src/api.ts`（14 个方法 + 类型）
- `apps/web/src/App.tsx`（导航「成长仪表盘」+ 渲染 + View 类型）
- `apps/web/src/App.css`（全息风格 + 移动端媒体查询）
- `apps/web/src/App.test.tsx`（GrowthDashboard 冒烟测试）
- `design-qa.md`（P8.7 说明）

## 6. 测试

- 后端 `tests/test_growth.py`：四维聚合、自评生命周期（创建/填写/Level/确认/编辑回退/归档删除）、时间线（合并/排序/过滤/快照保留）、跨维关联（correlation/causation/校验）、目标（CRUD/horizon/previousGoalId），全通过。
- 后端全量回归：19/19 Python 测试脚本通过。
- 前端：13/13 Vitest、lint、typecheck/build 与 8/8 Playwright E2E 通过。

## 7. 已知限制

- 不提供自动成长诊断、自动 Level 或推断成长分数；这是产品边界。
- `1d62750`（月度趋势聚合）保留作为 P8.4 前置。
- 专项验收截图位于 `artifacts/phase8-acceptance/`。
