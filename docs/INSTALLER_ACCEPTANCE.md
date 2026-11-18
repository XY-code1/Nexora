# Windows Installer Acceptance

状态：**PENDING CI — ACL、重启、升级、卸载和重装自动验收已加入候选分支**
数据边界：仅使用临时合成 Vault，不使用真实用户 Vault。

## 测试环境记录

- 自动环境：GitHub-hosted `windows-latest`，run `44039863590`，commit `85ea0fe`；每个 job 使用新的托管 VM。
- 自动 smoke：`windows-installer-smoke` 成功；构建、静默安装、启动、health、管理 token、认证关闭、静默卸载均完成。
- 本地环境：没有 Hyper-V PowerShell 模块、Windows Sandbox/VMware/VirtualBox 控制面；不能冒充干净 VM。
- 本地构建依赖：缺少 PyInstaller 和 Inno Setup，因此没有生成当前候选安装包。
- 公开安装包：GitHub Release `v1.0.4`，2026-11-04 发布。
- 安装包 SHA-256：`ce17464d9a8b660d265f866bcf36609b2134bdd8df89ee8cd5558ff55f20993a`，与 `SHA256SUMS.txt` 和 GitHub asset digest 一致。
- Authenticode：`NotSigned`；Signer 为空。
- 人工 VM/快照 ID、普通用户 SID、SmartScreen/杀毒状态：待记录。

## 验收用例

| ID | 任务 | 验证命令/证据 | 预期 | 状态 | 人工验收 |
|---|---|---|---|---|---|
| I-01 | 全新安装 | CI run `44039863590`; installer smoke | 静默自定义目录安装成功；非管理员/UI 路径待验 | BLOCKED | 是 |
| I-02 | 首次启动 | CI 进程、runtime、health | 打包程序启动并 health=ok；浏览器/首次引导待验 | BLOCKED | 是 |
| I-03 | 创建合成 Vault | CI 使用全新空合成 Vault | Launcher 能初始化并提供 API；schema/UI 未单独断言 | BLOCKED | 是 |
| I-04 | Web/API | CI health、管理 token 请求 | loopback health 与正确 token 成功；错误 token/核心页面未覆盖 | BLOCKED | 否 |
| I-05 | 正常关闭 | CI shutdown API、15 秒上限 | 认证关闭成功且进程在上限内退出 | PASS | 否 |
| I-06 | 再次启动 | 新进程、新 token、原 Vault identity | 候选自动测试已加入，等待 CI | PENDING CI | 否 |
| I-07 | 升级安装 | v1.0.4→内部候选 1.0.4.1 | 候选自动测试已加入，等待 CI | PENDING CI | 是 |
| I-08 | 卸载 | CI `unins000.exe /VERYSILENT` | 安装目录已移除；应用和功能及用户数据保留待人工验 | BLOCKED | 是 |
| I-09 | 重装恢复 | 重装后选择原合成 Vault | 候选自动测试已加入，等待 CI | PENDING CI | 否 |
| I-10 | 异常安装恢复 | 中断/磁盘不足/文件占用/损坏包 | 明确失败，不留可误启动半安装状态 | NOT TESTED | 是 |
| I-11 | 普通用户权限 | `whoami /groups`; 启动/升级/卸载 | 不依赖管理员写权限 | NOT TESTED | 是 |
| I-12 | ACL | Win32 DACL test + installer smoke | 候选修复本地合成测试通过，等待 CI | PENDING CI | 否 |
| I-13 | Release artifact | SHA-256、Authenticode | hash 与发布清单一致；签名策略有明确结论 | FAIL | 是 |

## 标准命令

```powershell
Get-FileHash .\NEXORA-Setup-<version>.exe -Algorithm SHA256
Get-AuthenticodeSignature .\NEXORA-Setup-<version>.exe | Format-List *
Get-Process | Where-Object ProcessName -Match 'nexora|personal-ai-profile'
Invoke-RestMethod http://127.0.0.1:<port>/api/v1/health
Get-Acl <runtime-or-app-data-path> | Format-List
icacls <runtime-or-app-data-path>
```

构建参考：`./scripts/build_windows.ps1 -Version <version>`；自动 smoke：`./tests/windows_installer_smoke.ps1 -Version <version>`。自动 smoke 不能替代 I-01、I-07、I-08、I-10 的人工观察。

## 失败记录

每项失败记录：时间、VM snapshot、命令、原始退出码/日志、残留进程/文件、是否可重现、影响数据、建议修复位置。没有记录即不得改为通过。

当前失败/阻塞：

1. R1 已证明 Runtime/AppData/backup ACL 未满足最小权限，I-12 失败。
2. `v1.0.4` 公开安装包哈希正确但没有 Authenticode 签名，I-13 失败；需要发布负责人明确“稳定版必须签名”的门禁。
3. 没有可用的本地干净 Windows VM，无法执行首次 UI、SmartScreen、升级、应用和功能卸载、重装和异常恢复。
4. 没有当前候选安装包；只有 `v1.0.4` 基线，无法执行 I-07。

## 验收结论

当前：**BLOCKED / NOT READY**。托管 Windows VM 的基础 installer smoke 是有效自动证据，但不足以通过完整 R2。必须提供可恢复快照的干净 Windows VM、普通用户会话、`v1.0.4` 与修复 ACL 后的候选安装包，再执行 I-01–I-13；未执行项不得转为通过。
