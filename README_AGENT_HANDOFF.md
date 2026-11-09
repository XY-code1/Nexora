# Personal AI Profile — Agent 交接说明

> 交接基线：`main`（Phase 9完成）
> 仓库：<https://github.com/XY-code1/personal-ai-profile>
> 更新日期：2026-11-02
> 当前阶段：Phase 0–9已完成；下一阶段为Phase 10。

## 1. 项目目标

把 Personal AI Profile 建设成一个：

- 开源优先；
- Local-first；
- Model-agnostic；
- Privacy-first；
- 用户完全控制本地数据；
- 可在不同 AI 之间共享经过授权的个人上下文；
- 后续可扩展为 Windows 桌面产品。

私人 Markdown/Obsidian Vault 是唯一数据事实源。公共仓库只能包含程序、空模板、测试合成数据和文档，不能包含任何真实私人档案。

## 2. 当前技术架构

```text
profile.py CLI ------------------\
review_app.py 本地旧审核界面 -----\
apps/api FastAPI -------------------> core/profile.py ---> Private Markdown Vault
mcp_server.py MCP stdio ----------/          |
                                      core/access.py
                                      AI访问策略
```

### 目录职责

```text
apps/api/                    FastAPI本地API
apps/web/                    React + TypeScript + Vite审核界面
core/profile.py              领域逻辑、Vault存储、文件锁、事务恢复
core/access.py               ai_access唯一权威实现
mcp_server.py                最小权限MCP适配器
profile.py                   兼容CLI，不放领域逻辑
review_app.py                迁移期旧审核界面
template/                    公共空Vault模板
docs/                        架构、隐私、生命周期和API文档
tests/                       合成临时Vault测试
```

不要重新把业务逻辑写回`profile.py`、`mcp_server.py`、`review_app.py`或未来React组件。

## 3. 已完成

### Phase 0 — 行为冻结

- 已建立[`docs/BEHAVIOR_CONTRACT.md`](docs/BEHAVIOR_CONTRACT.md)。
- 已冻结CLI、MCP、记忆生命周期、目录状态和`ai_access`行为。
- 已明确公共仓库与私人Vault边界。

### Phase 1 — Core抽取

- 档案和记忆逻辑已迁移到`core/profile.py`。
- AI读取策略已集中到`core/access.py`。
- `profile.py`保留原命令和Python导入兼容性。
- MCP与旧审核界面已改为调用Core。
- MCP中重复的frontmatter/权限实现已删除。

### Phase 2 — 本地API与一致性

- FastAPI版本化接口：`/api/v1`。
- 服务入口：`python -m apps.api.main --vault <PRIVATE_VAULT>`。
- 只监听`127.0.0.1`。
- 健康检查以外均要求Bearer启动令牌。
- Trusted Host仅允许`127.0.0.1`与`localhost`。
- API只接受记忆ID，不接受客户端文件路径。
- SHA-256 revision乐观并发控制。
- 过期修改返回`409 REVISION_CONFLICT`。
- Vault级跨进程文件锁，CLI、MCP、旧UI和API共用。
- confirm、reject、forget、supersede具有事务日志和异常恢复。
- 统一成功、错误和参数校验响应。
- Lock、Transaction与Audit运行时目录不会进入私人Git历史。

接口清单与响应格式见[`docs/LOCAL_API.md`](docs/LOCAL_API.md)。

### Phase 3 — React审核界面

- 已完成列表、编辑、确认、拒绝、拒绝原因和409冲突处理。
- 已增加确认步骤、断开连接、错误令牌重试和静态SPA托管。
- Vitest组件测试和Playwright真实浏览器闭环均已建立。

### Phase 4 — Windows本地运行闭环

- `launcher.py`提供单实例、自动端口、健康等待、浏览器启动与运行时清理。
- 启动令牌通过URL fragment一次传递，页面立即清除URL并只在内存保留。
- 已增加鉴权`POST /api/v1/shutdown`和正常退出。
- `start-review.cmd` / `start-review.vbs`已切换到新Launcher。
- 已增加启动、复用现有实例、健康检查、关闭和清理的集成测试。

## 4. 现有API

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
POST   /api/v1/shutdown
```

修改操作必须提交最近读取到的`expected_revision`。

## 5. 不得破坏的安全边界

1. 不读取、复制、提交或推送真实私人Vault。
2. 所有测试使用`tempfile.TemporaryDirectory()`和合成数据。
3. MCP只能读取授权信息和提出candidate，不能确认、拒绝、遗忘、替代、修改Profile或公开发布。
4. 缺失或非法`ai_access`必须默认拒绝。
5. `denied`和`local-only`不得通过MCP搜索或列表返回。
6. `summary-only`只能返回显式`摘要/Summary`，不能由私密正文自动生成摘要。
7. 本地HTTP服务不得监听`0.0.0.0`。
8. 不把Bearer token、密码、API Key或私人路径编译进前端资源。
9. 修改必须经过Core的文件锁和revision校验，不能让前端直接操作文件。
10. 不删除`review_app.py`，直到React界面达到功能等价并经过一个兼容周期。

## 6. 测试与验证

安装：

```powershell
pip install --require-hashes -r requirements.lock.txt
```

完整测试：

```powershell
python tests/test_smoke.py
python tests/test_mcp_security.py
python tests/test_mcp_protocol.py
python tests/test_memory_lifecycle.py
python tests/test_review_app.py
python tests/test_core_contract.py
python tests/test_local_api.py
python tests/test_visualization.py
python tests/test_onboarding.py
python tests/test_human3.py
python tests/test_vault_management.py
python tests/test_release_gate.py
python tests/test_launcher.py
python scripts/check_release.py
python -m compileall -q .
python -m pip check
git diff --check
```

当前这些检查以及GitHub Actions均通过。GitHub Actions第三方Action已按commit SHA固定。

## 7. 尚未完成

> 本节是 2026-11-02 的历史快照。下面列出的条目当时均未完成，**现已全部交付**。
> 当前状态请以 [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) 为准，不要依据本节判断进度。

历史清单（均已完成，保留用于对照）：

- ~~Windows安装、升级、卸载和离线打包。~~
- ~~可视化备份与恢复向导。~~
- ~~可视化Profile、记忆时间线、隐私审计和Human 3.0趋势。~~
- ~~对话式首次引导、渐进信息收集和月度复盘。~~
- ~~Git跨设备同步和冲突处理。~~
- ~~公开内容脱敏预览和发布工作流。~~
- ~~代码签名与正式Release流程。~~

仍未完成（详见 `docs/PROJECT_STATUS.md`）：

- 提交前自动创建 managed backup。
- 定时 / 自动本地备份。
- Git pull/push 的网络失败重试。
- Windows runtime 文件的 ACL 语义验证。

## 8. 已完成：Phase 7

### 目标

在不扩大AI读取权限的前提下，增加本地可视化Profile、记忆时间线、隐私审计和Human 3.0趋势。

### 最小范围

1. 只读API返回最小化Profile摘要、记忆时间线和审计汇总。
2. React增加Profile、Timeline、Privacy和Human 3.0四个本地页面。
3. 默认不展示私密正文，敏感展开需要明确用户操作。
4. 所有统计在本地Core/API中生成，不增加云端分析。
5. 增加组件、API、权限负测试和至少一条E2E可视化流程。

### 暂时不要做

- Electron或Tauri；
- 云账户与远程API；
- Redux等大型状态管理；
- WebSocket；
- 向量数据库；
- Git同步；
- 自动采集用户信息；
- 完整自主Agent。

### Phase 7验收标准

- 可视化数据只来自当前私人Vault，无外部网络请求。
- 默认视图不泄露`denied`、`local-only`或未确认正文。
- Timeline能正确表示记忆状态和生命周期时间。
- Human 3.0明确标记为自我反思，不作为诊断。
- 所有既有测试继续通过。

### 当前实现

- `core/visualization.py`集中生成权限裁剪后的四类只读视图。
- API新增`/api/v1/visualization/profile|timeline|privacy|human3`。
- React新增个人档案、时间线、隐私审计和Human 3.0页面。
- 时间线摘要默认折叠；未确认、`denied`和`local-only`不返回预览。
- 已增加Python权限负测试、React组件测试和Playwright可视化流程。
- 完整隐私规则见`docs/VISUALIZATION_PRIVACY.md`。

安全与隐私复审未发现阻断问题。

## 9. Phase 8实现

- `core/onboarding.py`定义五个固定引导主题和状态识别。
- API新增`GET /api/v1/onboarding`与`POST /api/v1/onboarding/responses`。
- React新增本地对话式引导页、进度、跳过和候选提交。
- 只保存用户明确提交的candidate，不保存原始对话、草稿或跳过记录。
- 输入经过秘密扫描；引导不能确认记忆或直接修改Profile。
- Python、React和Playwright均覆盖引导闭环。

Phase 8安全与隐私审计未发现阻断问题。下一阶段为Phase 9：Human 3.0对话式复盘闭环。

## 10. Phase 9实现

- `core/human3.py`实现四维草稿、revision更新和事务化确认。
- API新增Human 3.0 session、维度、总结及确认端点。
- React新增月度复盘对话、信息状态、自评分、摘要和30天计划。
- 草稿不进入趋势或MCP；确认后才移动到History。
- 评分由用户填写，信息不足允许明确标记，系统不推断或诊断。
- Python、React和Playwright覆盖完整确认闭环。
- 详细边界见`docs/HUMAN3_LIFECYCLE.md`。

Phase 9安全与隐私审计未发现阻断问题。下一阶段为Phase 10：跨设备同步、冲突处理与公开发布工作流。

## 11. 推荐实施顺序

```text
1. 读取README、docs/BEHAVIOR_CONTRACT.md、docs/LOCAL_API.md
2. 运行全部现有测试并确认基线
3. 阅读`docs/CONVERSATIONAL_ONBOARDING.md`
4. 定义Human 3.0复盘草稿与确认边界
5. 复用candidate与审核闭环，不直接写正式评估
6. 增加API、组件、权限负测试与E2E
7. 运行Python、前端、Launcher与E2E完整门禁
8. 更新README和可视化文档，等待用户确认后提交
```

## 12. 交接给其他Agent的启动提示词

可将以下内容连同仓库地址直接发给下一位Agent：

```text
你接手的是 https://github.com/XY-code1/personal-ai-profile ，基线为main分支。

先阅读：
- README_AGENT_HANDOFF.md
- docs/BEHAVIOR_CONTRACT.md
- docs/LOCAL_API.md
- docs/ARCHITECTURE.md

先运行全部现有测试，确认基线后再开发Phase 10：跨设备同步、冲突处理与公开发布工作流。

必须遵守：
1. 不访问、复制或提交任何真实私人Vault。
2. Markdown Vault仍是唯一事实源。
3. 所有文件操作和权限规则必须经过Core。
4. MCP权限边界不得扩大。
5. FastAPI只能监听loopback。
6. 不删除旧review_app.py，直到React功能等价。
7. 不引入Electron/Tauri、云服务、数据库、Redux或WebSocket。
8. 开发完成后运行Python、前端、E2E和git diff检查。
9. 先给出改动和验证结果，等待确认后再提交推送。

Phase 10必须延续Vault隔离、用户确认、最小披露和冲突不覆盖边界。
```

## 13. 提交规则

- 先检查`git status`，不要覆盖其他未提交工作。
- 一个阶段使用一个聚焦提交，不混入私人数据或无关格式化。
- 提交前运行完整门禁。
- 未经用户明确要求，不提交、不推送、不创建Release。
- 若API或行为发生变化，同步更新行为契约、API文档和测试。
