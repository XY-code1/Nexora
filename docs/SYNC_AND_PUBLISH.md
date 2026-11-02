# Phase 10 — 跨设备同步与公开发布

## 跨设备同步

私人 Vault 用 Git 作为跨设备同步通道。同步工具只操作私人 Vault 自己的 Git 仓库，绝不触碰公共框架仓库（`assert_vault_isolated` 强制两者相互独立）。

### 前置条件

- Vault 已 `git init`，并配置了私有远程（GitHub Private Repository）。
- Vault 的 `.gitignore` 会排除运行时目录（Locks、Transactions、备份等）。

### 命令

```powershell
python profile.py sync-status PATH           # 只读诊断：分支、远端、领先/落后、脏状态、未解决的合并冲突
python profile.py sync-commit PATH -m "..."  # 暂存并提交 Vault 全部改动
python profile.py sync-pull PATH             # fast-forward 拉取；分叉时拒绝
python profile.py sync-push PATH             # 推送；落后或有未提交改动时拒绝
```

### 安全模型

- 有未提交改动时拒绝 pull/push，避免覆盖本地未提交工作。
- pull 只做 fast-forward，绝不自动 merge，避免掩盖冲突。
- 本地与远端分叉时拒绝并提示手动 `git pull` 解决；`sync-status` 会列出未解决的合并冲突（UU/AA/DD 等）。
- 所有同步操作共享 Vault 文件锁，与 CLI、MCP、API 和审核界面互斥。

## 公开发布

公开内容必须逐文件显式标记 `visibility: public`，经脱敏预览与敏感扫描后才能导出到独立 staging 目录。

### 命令

```powershell
python profile.py export-preview PATH FILE...        # 干跑：可发布性、脱敏预览、泄露拦截报告
python profile.py export-public PATH STAGING FILE... # 确认后真正导出（含泄露拦截）
```

### 边界

- 只有 `visibility: public` 的 Markdown 文件可导出；其它一律拦截。
- 敏感扫描复用 `SECRET_PATTERNS`（私钥、GitHub token、通用密钥），命中即拦截。
- `export-preview` 会把命中的敏感片段替换为 `[已脱敏:标签]`，避免预览输出泄密。
- staging 不能位于 Vault 或公共框架仓库内；导出带 ownership marker、原子交换和异常恢复。
