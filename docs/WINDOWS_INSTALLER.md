# Windows 安装包与正式发布

## 安装包

PyInstaller 把后端和内置的 React 前端打包成无需 Python/Node 的 `personal-ai-profile.exe`，再由 Inno Setup 封装为带安装、升级和卸载的 `setup.exe`。

- 安装位置：`%LOCALAPPDATA%\Programs\Personal AI Profile`（per-user，无需管理员权限）。
- 首次运行：Launcher 发现目标目录为空时，会从内置模板初始化一个私人 Vault。
- 升级：同一 AppId，覆盖安装即可保留配置。
- 卸载：标准「应用和功能」卸载入口。

### 本地构建（Windows）

```powershell
cd apps/web
npm run build
cd ..\..

python -m pip install -r requirements.txt pyinstaller
python -m PyInstaller --clean --noconfirm packaging\windows\personal-ai-profile.spec

iscc /DMyAppVersion=1.0.0 packaging\windows\installer.iss
```

或直接运行编排脚本：

```powershell
./scripts/build_windows.ps1 -Version 1.0.0
```

## 代码签名

签名是条件性的：仅当 CI 配置了以下两个 secret 时才签名，否则产出未签名包并在构建日志中标注。

- `WINDOWS_SIGNING_CERT`：PFX 证书的 Base64 编码。
- `WINDOWS_SIGNING_CERT_PASSWORD`：PFX 密码。

构建脚本用 signtool（SHA256 + 时间戳）分别对 app exe 和 setup.exe 签名。

## 正式发布

打 tag 触发 `.github/workflows/release.yml`：

```powershell
git tag v1.0.0
git push origin v1.0.0
```

工作流会在 `windows-latest` 上：构建前端 → PyInstaller → Inno Setup → 条件签名 → 运行发布隐私门禁 → 生成 checksums → 创建 GitHub Release 并上传 `setup.exe` 和 `SHA256SUMS.txt`。

也可以通过 Actions 页面的 workflow_dispatch 手动触发并指定版本号。

## 边界

- 安装包只含程序与空模板，绝不包含任何私人 Vault 内容。
- 发布前 `scripts/check_release.py` 扫描跟踪文件与构建产物，阻止凭据、私钥和用户绝对路径进入发布物。
- MCP server 与 CLI 仍是开发者工具（从源码以 Python 运行），暂不进入安装包。
