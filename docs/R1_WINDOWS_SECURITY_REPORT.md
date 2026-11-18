# R1 Windows Security Validation Report

状态：**REMEDIATION IMPLEMENTED / CI PENDING — 原始验收 FAIL，候选修复待干净 Windows 复验**
执行时间：2026-11-17（Asia/Shanghai）
代码基线：`docs/r4-release-hardening@4f6770e`
范围：仅 R1；未执行 R2–R5；未修改产品代码；未 commit、push 或 merge。

## 1. 测试环境

| 项目 | 实际值 |
|---|---|
| OS | `WindowsProductName=Windows 10 Home China`，`OsBuildNumber=26200`，64-bit（按 `Get-ComputerInfo` 原样记录） |
| 主机 | Workgroup，本地主机名已脱敏 |
| Python | 3.13.0 |
| 当前身份 | `<CURRENT_USER>`，SID `<CURRENT_USER_SID>`（公开报告已脱敏） |
| Token 完整性 | Medium Mandatory Level；`Administrators` 为 deny-only，进程未提升，但账户不是纯标准用户 |
| 真实本地用户 | `zy`、`xy`、`CodexSandboxOffline`、`CodexSandboxOnline`（另有禁用内置账户） |
| 合成测试根 | `%LOCALAPPDATA%\Nexora-R1-20261117T111726Z` |
| 默认 Vault 语义样本 | `%USERPROFILE%\Nexora-R1-Synthetic-20261117T111726Z\vault` |
| 原始证据 | 合成测试根下 `evidence/r1-results.json`、launcher stdout/stderr、`icacls`/`Get-Acl` 输出 |

所有纳入结论的业务数据均为本轮创建的合成数据。执行中发生一次边界偏差：无效路径探测触发 Windows 目录选择器，launcher 随后打开了一个无关既有路径并运行约 15 秒。没有人工查看、输出或收集该路径的文件内容，也没有调用写 API，但 launcher 初始化/监视逻辑可能读取了元数据或计算内容哈希；该次结果全部排除，进程已经终止。由于未对该无关路径做进一步检查，不能独立证明初始化流程没有写入 identity。后续错误日志检查改用仓库内现有 `template` 目录触发隔离拒绝，未再调用目录选择器。

## 2. 代码确认的实际路径与创建方式

| 对象 | 实际路径/方式 | 代码依据 |
|---|---|---|
| Runtime directory | `%LOCALAPPDATA%\PersonalAIProfile`；可由隐藏参数 `--runtime-dir` 覆盖 | `launcher.py:32-36`, `launcher.py:148` |
| Runtime token | 明文位于 `runtime.json`，字段包含 PID、port、token、Vault 路径和启动时间 | `launcher.py:126-134` |
| Launcher lock | Runtime directory 下 `launcher.lock`，由 `filelock.FileLock` 创建 | `launcher.py:150-151` |
| Launcher error log | Runtime directory 下 `launcher-error.log` | `launcher.py:213-215` |
| 本机配置 | `%LOCALAPPDATA%\PersonalAIProfile\vaults.json`；Provider/GitHub 配置也位于同一 app-data root | `core/vault_identity.py:24-27,44-59`, `core/provider_auth.py:57-62`, `core/github.py:205-217` |
| 默认 Vault | `%USERPROFILE%\Nexora\vault` | `core/vault_identity.py:72-75` |
| Vault identity | `<Vault>\90 System\vault.json` | `core/vault_identity.py:17,29-41` |
| MCP client registry | `<Vault>\90 System\Security\clients.json`；只保存 token hash | `core/security.py:27-29,81-82` |
| Security audit | `<Vault>\90 System\Audit\security.jsonl` | `core/security.py:29,296-310` |
| Atomic temp files | 与目标文件同目录的 `NamedTemporaryFile(delete=False)`，随后 `os.replace` | `core/profile.py:146-151` |
| Backup directory | `%LOCALAPPDATA%\PersonalAIProfile\backups` | `core/vault_management.py:61-64` |
| Backup binding key | `%LOCALAPPDATA%\PersonalAIProfile\binding.key` | `core/vault_management.py:79-92` |

关键事实：`launcher.py`、Provider 配置和 GitHub 配置虽然调用 `os.chmod(path, 0o600)`，但代码没有设置 Windows DACL。实际 NTFS 权限仍由父目录继承决定。

## 3. ACL 检查结果

### 3.1 默认 Runtime/AppData 继承 — FAIL

在当前真实 `%LOCALAPPDATA%` 上，`Get-Acl`/`icacls` 显示：

```text
<REDACTED_HOST>\CodexSandboxUsers:(I)(OI)(CI)(RX)
NT AUTHORITY\SYSTEM:(I)(OI)(CI)(F)
BUILTIN\Administrators:(I)(OI)(CI)(F)
<CURRENT_USER>:(I)(OI)(CI)(F)
```

`CodexSandboxUsers` 的实际成员包括两个不同的真实 Windows 用户：`CodexSandboxOffline` 和 `CodexSandboxOnline`。该组的 `RX` 被以下合成对象实际继承：

- `runtime.json` 和 `launcher.lock`
- 强制终止后遗留的 `runtime.json`
- `launcher-error.log`
- `vaults.json`
- `binding.key`
- managed backup 目录、快照和 `backup.json`
- 放在该继承树下的合成 Vault、`clients.json` 和安全审计日志

没有发现 `Everyone`、`BUILTIN\Users` 或 `Authenticated Users` 的 Full Control；但额外真实用户组具有读取权限，已经违反“敏感数据仅预期用户/System/Administrators 可读”的 R1 判据。

### 3.2 默认 Vault 位置语义 — PASS

在 `%USERPROFILE%\Nexora-R1-Synthetic-20261117T111726Z\vault` 创建的合成 Vault 及其 `90 System\vault.json`、同目录临时文件实际 ACL 均为：

```text
NT AUTHORITY\SYSTEM:(I)(F)
BUILTIN\Administrators:(I)(F)
<CURRENT_USER>:(I)(F)
```

Owner 为 `<CURRENT_USER>`，没有额外 `Everyone`、`Users`、`Authenticated Users` 或 `CodexSandboxUsers` ACE。结论仅适用于该默认位置继承链；用户选择其他 Vault 路径时，NEXORA 当前不会收紧原目录 ACL。

### 3.3 Owner — PASS（已检查对象）

本轮创建并成功查询的 runtime、log、app-data、backup、默认路径 Vault 对象 Owner 均为 `<CURRENT_USER>`。系统和 Administrators 保留 Full Control。

## 4. Token 安全检查

| 检查 | 状态 | 结果 |
|---|---|---|
| 错误管理 token | PASS | 对 `/api/v1/vault` 返回 HTTP 401 |
| Vault 切换后旧 token | PASS | 切换请求 200；runtime token 已轮换；旧 token 返回 401；新 token 返回 200 |
| 正常退出清理 | PASS | shutdown 请求 200，launcher exit 0，`runtime.json` 和 `launcher.lock` 均删除 |
| MCP token 持久化 | PASS | API 创建合成客户端返回一次性 credential；`clients.json` 只保存 hash，未把明文 credential 写入 Vault |
| Runtime token ACL | **FAIL** | `runtime.json` 保存明文管理 token，但实际继承 `CodexSandboxUsers:(RX)`；`chmod(0600)` 未消除该 ACE |
| 强制终止后的 token | **FAIL** | 强制终止后 `runtime.json` 和 lock 均遗留；旧 token 在重启后失效，但遗留文件在重启前仍继承额外组读取权限 |

## 5. 普通用户运行结果

| 检查 | 状态 | 结果 |
|---|---|---|
| 当前未提升 Medium-integrity token 启动 | PASS | health 200；可创建合成客户端和 backup；可正常关闭 |
| 纯标准本地用户安装/启动 | BLOCKED | 当前执行身份属于本地 Administrators（虽未提升）；没有可用于自动登录 `xy` 的凭据，不能把当前结果冒充标准用户验收 |

## 6. 双用户隔离结果

| 检查 | 状态 | 结果 |
|---|---|---|
| User A→User B 实际进程读取尝试 | BLOCKED | 已确认多个真实本地用户存在，但没有第二用户登录会话/凭据；未使用模拟身份代替 |
| Runtime/AppData ACL 授权面 | **FAIL** | 实际 DACL 向包含其他真实 Windows 用户的 `CodexSandboxUsers` 授予 RX |
| 默认 Vault ACL 授权面 | PASS | 默认 `%USERPROFILE%` 继承样本只允许 owner、SYSTEM、Administrators |
| 任意用户选定 Vault | NOT TESTED | ACL 完全取决于用户选择目录；产品代码不重写 Vault 根 DACL |

因此“双用户实际读取”仍未验收，但无需等待该阻塞项即可确认当前 Runtime/AppData DACL 不满足最小权限目标。

## 7. Vault 切换结果 — PASS

1. Launcher 以合成 Vault A 启动，health 返回 200。
2. 调用 `/api/v1/vault/switch` 切换到合成 Vault B，返回 200。
3. 新 `runtime.json` 中 token 与旧 token 不同。
4. 旧 token 请求新进程返回 401；新 token 返回 200。

这证明当前 launcher 切换路径会轮换管理 token。它不替代 R5 的 MCP Vault identity 测试。

## 8. 异常退出结果

| 检查 | 状态 | 结果 |
|---|---|---|
| 强制终止留下 runtime/lock | **FAIL** | 两个文件均遗留；runtime 包含旧明文 token 和 Vault 路径 |
| 再次启动恢复 | PASS | Launcher 能重新获得锁、覆盖 runtime、轮换 token；旧 token 401，新 token 200 |
| 遗留文件 ACL | **FAIL** | 遗留 runtime 仍继承 `CodexSandboxUsers:(RX)` |
| 临时文件 | PARTIAL FAIL | 默认 Vault 继承样本仅 owner/System/Admin；LocalAppData 继承树下的临时文件则继承额外组 RX。未捕获极短生命周期的真实 `atomic_write` 临时名，使用同目录创建语义探针验证继承 |
| 日志文件 | **FAIL** | 安全触发生成的 `launcher-error.log` Owner 正确，但继承 `CodexSandboxUsers:(RX)`；正常运行没有持久化产品 access log |

异常退出后旧 token 因服务已停止而不能立即调用；重启后会失效。主要风险是遗留文件泄露 Vault 路径，以及同一运行期间/恢复前的明文 token 暴露面。

## 9. 安全问题列表

### R1-01 — Runtime 明文 token 没有显式 Windows DACL（High，发布阻断）

- **实际位置**：`%LOCALAPPDATA%\PersonalAIProfile\runtime.json`
- **实际结果**：合成默认语义对象继承 `CodexSandboxUsers:(RX)`；该组包含其他真实用户。
- **预期**：仅当前用户、SYSTEM、Administrators 可读；不得依赖环境父目录恰好安全。
- **复现**：在带额外 LocalAppData 继承 ACE 的 Windows 用户下启动 launcher，运行 `Get-Acl`/`icacls runtime.json`。
- **根因**：`launcher.py:126-134` 仅写文件后执行 `os.chmod(0o600)`，没有应用 Windows DACL。

### R1-02 — Backup、binding key 和 Vault registry 没有显式 Windows DACL（High，发布阻断）

- **实际位置**：`%LOCALAPPDATA%\PersonalAIProfile\backups`、`binding.key`、`vaults.json`。
- **影响**：backup 是 Vault 数据副本；`vaults.json` 暴露本地 Vault 路径；binding key 应保持机密。
- **实际结果**：全部继承额外用户组 RX。
- **根因**：目录/文件创建依赖继承，未建立 private app-data root。

### R1-03 — Launcher error log 没有显式 Windows DACL（Medium）

- **实际位置**：`%LOCALAPPDATA%\PersonalAIProfile\launcher-error.log`
- **实际结果**：Owner 正确，但继承额外用户组 RX。
- **影响**：错误文本可能包含 Vault 路径或系统诊断信息。

### R1-04 — 异常终止保留 runtime 和 lock（Medium；与 R1-01 组合后升高）

- **实际结果**：强制终止后两个文件都存在；后续启动能够恢复并轮换 token。
- **影响**：遗留 runtime 暴露 Vault 路径和旧 token；若 ACL 过宽，扩大本地信息泄露。
- **说明**：进程被强杀时无法保证 finally cleanup，不能只靠退出钩子解决。

### R1-05 — 选定 Vault 的 ACL 不受产品控制（Medium，需产品决策）

- 默认 `%USERPROFILE%\Nexora\vault` 样本权限安全。
- 用户选择共享目录、可移动盘或权限宽松目录时，当前代码不会检测或警告额外读取主体。
- 不建议自动改写用户现有 Vault ACL；应在连接前审计并明确提示/阻止高风险权限。

## 10. 修复建议（本轮未实施）

1. **建立 Windows 私有目录 helper**：创建 `%LOCALAPPDATA%\PersonalAIProfile` 后，用 Windows ACL API/受控 `icacls` 等价实现关闭继承并仅授予当前用户、SYSTEM、Administrators；所有 runtime/config/backup/log 统一复用。
2. **原子写入前保护目录，而非逐文件补救**：目录 DACL 正确后，临时文件和 replace 结果自然继承；仍应验证 replace 后 DACL。
3. **Runtime 写入使用安全创建**：先在已加固目录内独占创建临时文件，写入、flush、replace，再验证最终 DACL；Windows 不应把 `chmod(0600)` 作为安全控制。
4. **异常启动先处理 stale runtime**：在持有 launcher lock 后，验证记录 PID/health；对 stale metadata 进行安全覆盖，并记录恢复事件。旧 token 必须始终轮换。
5. **日志最小化和脱敏**：错误日志不得包含 token；Vault 路径应尽可能脱敏；日志继承同一 private root DACL。
6. **Vault ACL 只审计不擅改**：新建默认 Vault 时应用私有 ACL；连接已有 Vault 时检查宽松 ACE，并让用户决定迁移/修复，避免静默修改私人目录权限。
7. **增加真实双用户验收脚本**：由 User A 创建并运行，User B 分别尝试读取 runtime、backup、binding key、registry 和 Vault；保存每条命令的 exit code 与 `Access is denied` 证据。

## 11. 最终验收结论

**R1 当前结论：FAIL，不可通过 Release Readiness 门禁。**

已通过：当前未提升进程启动、API 鉴权负例、Vault 切换 token 轮换、正常关闭清理、异常退出后的重新启动与旧 token 拒绝、默认 `%USERPROFILE%` Vault 继承样本。

失败：Runtime token、backup、binding key、registry、error log 和 LocalAppData 继承树没有显式私有 Windows DACL；真实环境中额外用户组获得 RX。强制终止还会留下包含旧 token/Vault 路径的 runtime metadata。

阻塞：纯标准用户运行和真实 User A/User B 访问尝试没有第二用户登录凭据，必须由人工在双用户 Windows 环境完成，不能以 ACL 推理冒充执行结果。

发布前必须先修复 R1-01/R1-02，补充 Windows ACL 自动测试，再完成真实双用户复验。R1 验收通过前不应开始 R2。

## 12. 候选修复（本报告之后）

分支 `fix/windows-private-acl` 已加入候选修复，但本节不改写上面的原始失败证据：

- `core/windows_security.py` 使用 Win32 `SetFileSecurityW` 一次性应用 protected DACL，不再采用“先删除继承、再授权”的多步骤方案。
- DACL 仅允许当前用户、`SYSTEM`、`Administrators` Full Control。
- Runtime directory、`runtime.json`、error log、app-data root、backup root、binding key、Vault registry、Provider/GitHub 配置进入统一保护路径。
- `tests/test_windows_acl.py` 在合成目录先注入 `Everyone` 权限，再验证修复后只剩三个预期 SID。
- Windows installer smoke 增加打包态 runtime/app-data ACL、重启、token 轮换和卸载后 Vault 保留检查。
- 本地全部 Python 测试、Ruff、release packaging/privacy gate 和前端 typecheck/unit/lint/build 已执行；干净 Windows runner 仍需在推送后确认。

候选修复没有自动更改用户选择的既有 Vault 根权限。对额外读取主体进行检查并向用户提示仍是后续建议控制，当前代码尚未实现该提示。
