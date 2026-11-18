# R2 Windows Installer Validation Report

状态：**REMEDIATION IMPLEMENTED / CI PENDING — 已补候选包自动验收，等待干净 Windows runner**
执行时间：2026-11-17（Asia/Shanghai）
范围：仅 R2；未开始 R3/R5；未修改产品代码；未 commit、push 或 merge。

## 已执行证据

1. 检查 Git 工作区，没有覆盖未提交的 `docs/R1_WINDOWS_SECURITY_REPORT.md`。
2. 正常关闭上一阶段遗留的 User A 合成测试 launcher。
3. 检查本机 VM 能力：没有 `Get-VM`、Windows Sandbox、VMware 或 VirtualBox 可用控制面；Docker 是 Linux/WSL2，不能作为 Windows installer 验收环境。
4. 核对 GitHub-hosted `windows-latest` 自动证据：
   - main commit `85ea0fe` 的 run `44039863590` 为 success；
   - PR #56 的两次 `windows-installer-smoke` 均通过；
   - smoke 实际执行 PyInstaller/Inno Setup 构建、静默安装、启动、health、管理 token、认证关闭和静默卸载。
5. 下载公开 `v1.0.4` 安装包和 `SHA256SUMS.txt` 到隔离证据目录：
   - `%LOCALAPPDATA%\Nexora-R2-20261117T113609Z`
   - 大小：18,046,698 bytes
   - SHA-256：`ce17464d9a8b660d265f866bcf36609b2134bdd8df89ee8cd5558ff55f20993a`
   - 与发布清单及 GitHub asset digest 一致：PASS
   - Authenticode：`NotSigned`，Signer 为空：FAIL
6. 本地执行：
   - `python tests/test_release_packaging.py`：PASS
   - `python scripts/check_release.py`：PASS
7. 候选 CI 首次执行发现公开 `v1.0.4` 的 packaged GUI 启动失败：`Unable to configure formatter 'default'`。根因是该版本以无控制台 PyInstaller GUI 运行，却保留 Uvicorn 默认日志 formatter；后续代码已使用 `log_config=None`，但公开产物本身不可回写修复。

## 尚未执行

- 干净 Windows VM 的安装向导、UAC/SmartScreen 和首次引导。
- 真实普通用户的安装、启动、升级、卸载。
- 首次启动后再次启动、Vault identity 和数据保留。
- `v1.0.4` 到候选版的覆盖升级。
- 「应用和功能」卸载以及卸载后的 Vault/配置保留。
- 重装恢复。
- 安装中断、磁盘不足、文件占用和损坏安装包恢复。
- 修复 R1 ACL 后的安装态 ACL 复验。

## 阻塞原因

1. 当前主机没有可操作的干净 Windows VM/快照。
2. 当前工作区缺少 PyInstaller、Inno Setup；候选包只能由干净 Windows CI 构建。
3. R1 ACL 门禁仍为 FAIL；即使安装流程通过，也不能宣布稳定版 ready。
4. 发布 `v1.0.4` 安装包未签名，需要决定稳定版签名要求并补充签名证书流水线证据。

## 下一次真实 VM 执行所需输入

- 一台可回滚快照的干净 Windows 11 VM，普通本地用户，无 Python/Node。
- 已核验 SHA-256 的 `v1.0.4` 安装包。
- 修复 R1 ACL 后构建的候选安装包及 SHA-256/签名状态。
- SmartScreen/Defender/网络状态记录权限。
- 允许保存安装日志、进程清单、ACL 和脱敏截图的证据目录。

## 验收结论

R2 当前不能通过。现有自动 smoke 只证明“安装包能在 GitHub 新建 Windows runner 上静默安装、启动、接受管理 token、关闭和卸载”；它没有证明升级、用户数据保留、异常恢复、普通用户体验或安装态 ACL。完整状态见 `INSTALLER_ACCEPTANCE.md`。

## 候选自动验收扩展

`fix/windows-private-acl` 增加以下干净 Windows runner 检查，推送前状态为 `PENDING CI`：

1. 打包态 Runtime/AppData protected DACL 及允许 SID 清单。
2. 同一安装再次启动，Vault identity 保持不变，runtime token 轮换，旧 token 返回 401。
3. 卸载后外部合成 Vault 保留。
4. 下载并校验公开 `v1.0.4` 安装包 SHA-256。
5. `v1.0.4` 覆盖安装到内部候选 `1.0.4.1`，验证合成数据与 Vault identity 保留。
6. 卸载候选、重新安装候选、重新连接原合成 Vault并再次验证数据。

公开 `v1.0.4` packaged GUI 已被实测为无法启动，因此自动升级用例不会伪造“基线运行成功”：它使用与 `v1.0.4` 完全相同的 Vault template 建立合成数据，先安装真实 `v1.0.4`，再覆盖安装候选并验证数据、identity、token 轮换、卸载和重装。`v1.0.4` 启动失败单独保留为发布缺陷证据。

这些自动检查可解决升级/重启/卸载/重装的可重复证据缺口；安装向导、SmartScreen 和真正标准用户交互仍需人工 VM 验收。
