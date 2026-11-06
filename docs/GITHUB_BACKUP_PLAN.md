# GitHub Private Backup Plan

> 2026-11-06 实施状态：G1 与预配置仓库的 G2/G4 操作入口已完成。Web 可查看状态并显式执行 commit、fast-forward-only pull 和 push。G3（GitHub Device Flow、创建并验证 private 远程）仍主动延期，应用不保存 GitHub token，也不会自动初始化或联网。

## 1. 当前真实状态

### 已实现

- `core/sync.py` 只对私人 Vault 自己的 Git 仓库执行命令。
- 支持 status、commit、fetch、fast-forward-only pull、push。
- 有未提交修改时拒绝 pull/push；分叉时拒绝自动合并。
- Vault 与公共框架仓库互相包含时拒绝运行。
- 本地 bare remote 合成测试覆盖正常同步、脏状态、远端领先和分叉。

### 部分实现

- `profile.py` 暴露 CLI 命令，但 FastAPI 和 Web 没有 Git 操作入口。
- 任意 Git remote 都可使用；并非真正的 GitHub 集成。
- 版本历史存在于 Git，但产品没有浏览、比较或按提交恢复能力。

### 未实现

- GitHub 登录或 Device Flow。
- 创建私人仓库、验证仓库可见性、设置 remote/upstream。
- Web 端变更预览、选择提交、同步进度、冲突说明。
- 凭据安全存储、撤销、轮换和审计。
- 定时备份、保留策略、网络失败恢复。

### 存在风险

- `git add -A` 会提交所有未被 `.gitignore` 排除的 Vault 文件。
- 不验证远程是 private；用户可能误配 public remote。
- subprocess 错误文本可能包含远程 URL；若 URL 含凭据，必须在进入日志/UI 前脱敏。
- Git 历史永久保留被提交过的敏感内容，后续删除工作区文件并不能清除历史。

## 2. 产品边界

GitHub 是用户主动启用的**可选备份和版本层**，不是事实源，不参与正常读写，也不自动覆盖本地 Vault。

```text
Local Markdown Vault (source of truth)
       │ explicit preview + confirmation
       ▼
Local private Git repository
       │ explicit push/pull
       ▼
User-selected GitHub private repository
```

## 3. 推荐实施阶段

### G1 只读诊断

- API 返回 Git 是否可用、repo 状态、branch、ahead/behind、dirty/unmerged。
- remote URL 必须脱敏，只返回 host、owner/repo 和 URL 类型。
- 不执行网络操作。

### G2 本地版本

- Web 展示变更文件清单和敏感扫描结果。
- 用户编辑 commit message 后明确确认。
- 默认排除 runtime、locks、transactions、`.env`、key/pem 和本机 registry。
- commit 前创建 managed backup；扫描命中时 fail closed。

### G3 GitHub 私人仓库接入

- 优先 GitHub Device Flow 或系统 credential manager，不在 Vault/前端/localStorage 保存 token。
- 创建或选择仓库后必须调用 GitHub API 验证 `private: true`。
- 写入 remote 前显示 owner/repo 和隐私状态。
- 凭据 scope 最小化；只授权目标仓库。

### G4 同步与恢复

- pull 仅 fast-forward；分叉进入人工恢复向导。
- push 前 fetch 并复检 behind。
- 支持查看提交列表和文件 diff；从历史恢复应先生成 managed safety backup。
- 不自动 force push，不自动 rebase，不自动解决 Markdown 冲突。

## 4. API 建议

```text
GET  /api/v1/git/status
GET  /api/v1/git/changes
POST /api/v1/git/initialize
POST /api/v1/git/commit       {message, expected_vault_revision, confirmation}
POST /api/v1/git/pull         {expected_head, confirmation}
POST /api/v1/git/push         {expected_head, confirmation}
GET  /api/v1/git/history
POST /api/v1/git/restore      {commit, expected_vault_revision, confirmation}
POST /api/v1/github/connect   -> device flow metadata only
POST /api/v1/github/repository -> selected private repo
DELETE /api/v1/github/connection
```

所有 mutation 走 Vault operation lock、Bearer session、expected revision 和安全审计。API 不返回 token、完整 credential URL 或私人 Vault 路径。

## 5. 数据模型建议

本机应用数据目录保存：

```json
{
  "vault_id": "vault_random",
  "provider": "github",
  "repository": "owner/name",
  "visibility_verified": "private",
  "remote_name": "origin",
  "last_verified_at": "ISO-8601"
}
```

凭据只进入 OS credential manager，配置记录不含 token。Vault 内只保留可公开审计的 sync metadata，不保留账户 email、token 或完整本机路径。

## 6. 测试与发布门禁

- 保留本地 bare remote 测试，新增 GitHub API mock，不在 CI 使用真实私人账户。
- public remote、未知 visibility、SSH/HTTPS credential URL 泄漏必须拒绝。
- commit 前敏感扫描、`.gitignore` 缺失、untracked secret、large file、锁冲突。
- 网络中断、认证过期、non-fast-forward、分叉和冲突均不得改变工作区。
- A/B Vault 不能复用 repo 配置或凭据绑定。
- 日志、API、截图中不出现 token、完整路径或带凭据 remote URL。

## 7. 验收标准

- 未主动配置时无任何网络请求。
- 只能向已验证的私人仓库 push。
- 每次 commit/pull/push 都有预览和用户确认。
- Git 失败不影响本地事实源。
- 从 Git 历史恢复前存在已验证的本地安全备份。
