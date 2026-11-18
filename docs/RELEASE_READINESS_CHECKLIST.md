# Release Readiness Checklist

状态：**Not ready — R1/R2 remediation candidate pending CI and manual acceptance**
判定规则：只有当前候选提交、真实环境和可追溯证据才能勾选；历史报告不能自动继承为通过。

## 发布前必须完成（P0）

- [ ] R1：runtime/token/temp/log 的真实 NTFS ACL 验证。
- [ ] R1：普通用户运行、双 Windows 用户隔离、Vault A/B 切换。
- [ ] R1：Launcher 正常关闭、异常终止、重启恢复与敏感残留检查。
- [ ] R2：干净 VM 全新安装和首次启动。
- [ ] R2：Web/API、合成 Vault、关闭及再次启动。
- [ ] R2：v1.0.4→候选版本升级且用户数据保留。
- [ ] R2：卸载、重装、异常安装恢复。
- [ ] R2：安装包 SHA-256、签名状态和 release artifact 一致性。
- [ ] R3：本机 Chromium 下载超时根因有证据；匹配版本浏览器可重复安装/复用。
- [ ] R3：完整 Playwright E2E 无跳过、无弱化断言地通过。
- [x] R4：#47、#48、#52、#53 已检查、CI 通过并合并。
- [x] R4：`PROJECT_STATUS.md`、API、阶段文档与当前证据一致。
- [ ] R5：MCP 授权、scope、token、Vault identity、撤销/重签协议矩阵通过。
- [ ] R5：至少对公开文档承诺支持的真实 MCP Host 完成实机验证，或明确降级支持声明。
- [ ] 无未接受的 P0/P1 数据泄露、权限绕过、安装破坏或恢复失败。

## 可推迟到 NEXORA v1.1

- [ ] 定时/自动本地备份产品化（前提：手动及操作前备份可靠）。
- [ ] 月度复盘未保存离页提醒。
- [ ] Overview 信息架构和新用户下一步引导优化。
- [ ] Obsidian 与 Web 更深协同/专用插件。
- [ ] MCP 向导 UX、更多 Host 版本与 Resources/Prompts 评估。
- [ ] 前端 bundle 分包（除非性能基线证明阻断）。
- [ ] 更广泛 Provider 插件生态。
- [ ] 完整用户文档重构、诊断包与长期支持策略。

## 当前已知门禁缺口

1. Windows ACL 候选修复已有本地合成证据，但打包态 CI、普通用户和真实双用户隔离尚未完成。
2. 干净 VM 的升级、卸载、异常安装恢复没有证据。
3. 本机 Playwright 下载超时原因未定位；CI 通过不能替代本机调查。
4. 真实 Claude Desktop、Codex、Cursor、VS Code MCP 验证未执行。

## 最终发布判定

当前结论：**NEXORA 尚未达到“经真实环境验证的可靠稳定版”门禁。**

可靠稳定版之前必须完成 R1、R2、R3、R4 文档收口及 R5 的最低公开支持矩阵。NEXORA v1.1 — Stable User Experience 可承接体验、协同、自动化和文档增强，但不得用 v1.1 规划替代当前安全、安装、升级、E2E 与恢复门禁。

