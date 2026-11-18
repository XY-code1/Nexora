# Known Issues

## 发布阻断/高优先级

1. **Windows ACL 候选修复待最终验收**：候选分支已使用 Win32 protected DACL 保护 runtime、token 元数据、本机配置、备份和日志，本地合成 ACL 测试通过；仍需干净 Windows runner、普通用户及真实双用户隔离证据后才能关闭。
2. **本地 E2E 环境仍未复验**：早期 Playwright Chromium 下载从 0% 多次 30 秒超时；GitHub CI 的完整 E2E 已通过，但本机下载根因仍需 R3 取证。
3. **干净 VM 人工安装验收未完成**：候选 CI 已加入全新安装、重启、升级、卸载、数据保留和重装自动验收；安装向导、SmartScreen、普通用户和异常恢复仍需 R2 的真实 VM 证据。
4. **上游 `picomatch` 高危公告暂无修复版本**：2026-11-17 更新的 `GHSA-fc5q-39xc-vjpf` 将 `picomatch <=4.0.7` 标记为受影响且 patched versions 为 None；它由 Vite/Vitest 的开发工具链传递引入，导致 `npm audit --audit-level=high` 发布门禁失败。不得通过降低 audit 阈值关闭，需等待上游修复版或采用经审计的固定补丁。
5. **公开 `v1.0.4` Windows GUI 包无法启动**：R2 在真实 GitHub Windows runner 复现 `Unable to configure formatter 'default'`；该包是无控制台 GUI，但 Uvicorn 默认 formatter 依赖标准流。当前源码已通过 `log_config=None` 修复，候选包 smoke 通过；公开旧产物必须作为已知发布缺陷保留，不能宣称基线可正常运行。

## 产品与 UX

6. **月度复盘无未保存离页提醒**：显式保存是正确边界，但未提交文本可能在导航/切月时丢失。依据：`docs/PHASE6_ACCEPTANCE.md`。
7. **自动本地备份未实现**：managed backup 是手动/操作触发；没有调度。
8. **AI Host 实机兼容证据有限**：stdio 协议子进程已测；历史 C4 明确测试机未安装 Claude Desktop。
9. **Obsidian integration 仅文件级**：无专用插件；这是可接受的产品决策，但“Obsidian 集成”不应被描述为完整插件体验。

## 工程与文档债务

10. **阶段命名仍有历史歧义**：旧 handoff 把 Phase 7/8 指向可视化/引导，后续验收把 Phase 7/8 指向 Security/Growth；历史文档已指向 `PROJECT_STATUS.md`，但阅读时仍需保留其时间语境。
11. **Frontend lint warning**：`apps/web/e2e/accessibility.spec.ts:4` 的 `shots` 未使用。
12. **Frontend bundle warning**：production 主 JS 534.37 kB，超过 Vite 500 kB warning 阈值；应以真实启动性能决定是否分包。
13. **MCP 只有 Tools**：没有 Resources/Prompts；当前是明确非目标，不应宣称完整 MCP surface。
14. **审计链无外部锚定**：本地可发现篡改并 fail closed，但无法独立证明删除全部本地状态前的历史；Local-first V0.1 的刻意限制。
