# 打开本地网站 — 命令清单

以下命令均已在沙箱中实测通过。PowerShell 中执行。

## 准备：确认项目路径

```powershell
cd "<REPO>"
```

## 方案 A（推荐）— 一条命令，自动开浏览器

```powershell
python launcher.py --vault "C:\你的\Vault路径"
```

- 会自动选端口、生成本次令牌、把令牌通过 URL fragment 交给页面并立即从地址栏抹掉、自动打开浏览器。
- `apps\web\dist` 已存在且是最新构建（11月5日 14:39），所以**不需要 npm、不需要 Node.js**。
- 首次使用若还没有 Vault，先执行下一节创建。

不想自动开浏览器就加 `--no-browser`，然后手动打开它打印的地址。

## 方案 B — 双击运行（静默）

直接双击项目根目录的 `start-review.vbs`。

注意：它用 `pythonw.exe` 静默运行，**出错时屏幕上没有任何提示**。如果双击后没反应，改用方案 A 或运行 `start-review.cmd`（会显示错误并暂停）。

## 方案 C — 开发者模式（改前端代码时用）

两个 PowerShell 窗口。

窗口一，启动 API：

```powershell
cd "<REPO>"
python -m apps.api.main --vault "C:\你的\Vault路径"
```

它会打印：

```text
Local API: http://127.0.0.1:8765  Bearer token: <一串令牌>
```

**把这个令牌留着**，下一步要用。

窗口二，启动前端：

```powershell
cd "<REPO>\apps\web"
npm run dev
```

浏览器打开 **http://localhost:5173** ，在页面上的「本地启动令牌」输入框里填窗口一打印的令牌，点连接。

vite 会把 `/api` 自动代理到 `http://127.0.0.1:8765`，所以不需要额外配置。

## 第一次使用：创建并初始化私人 Vault

```powershell
cd "<REPO>"
python profile.py init "C:\你的\Vault路径"
python profile.py validate "C:\你的\Vault路径"
```

第二条会输出「验证通过：结构完整，未发现已知秘密模式或重复记忆ID」。

建议把 Vault 放在**仓库之外**的目录，例如 `D:\PersonalAIProfile\my-ai-profile`，避免和代码混在一起。

Vault 位置的三种指定方式（launcher 依次查找）：

1. 命令行 `--vault "路径"`（最明确，推荐）
2. 环境变量 `PROFILE_VAULT`
3. 仓库同级的 `my-ai-profile` 目录

## 排查

```powershell
# 1. 一键诊断（会打印 8 项检查结果）
.\diagnose.cmd

# 2. 看上次的启动错误
Get-Content "$env:LOCALAPPDATA\PersonalAIProfile\launcher-error.log"

# 3. 确认服务是否活着
Invoke-RestMethod http://127.0.0.1:8765/api/v1/health

# 4. 检查端口占用
netstat -ano | Select-String ":8765"
```

## 页面地址

服务起来后，浏览器地址栏形如：

```text
http://127.0.0.1:8765/#token=<本次令牌>&view=overview
```

页面读取令牌后会立刻把地址栏清干净（令牌只留在页面内存里，不写浏览器存储）。

页面内的 hash 路由：`#overview` `#review` `#profile` `#timeline` `#privacy` `#security` `#connections`。
