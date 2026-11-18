# NEXORA Architecture

审计基线：`main@8862bd5`（2026-11-17 复核）。本图只画当前代码存在的路径。

```text
React 19 + TypeScript + Vite (primary UI)
       │ loopback JSON + in-memory bearer token
       ▼
FastAPI apps/api/main.py ─────────── Windows launcher.py / packaged static SPA
       │
       ├── core/profile.py              memory lifecycle, locks, revisions, transactions
       ├── core/{onboarding,human3,monthly_reflection,growth}.py
       ├── core/{security,access}.py     client scopes, access policy, audit chain
       ├── core/{vault_identity,vault_management,repository}.py
       ├── core/{sync,github}.py         local Git + optional private GitHub setup
       └── core/{provider_auth,provider_adapters}.py
                    │ explicit preview/decision
                    └── optional OpenAI-compatible / Anthropic HTTP provider
       │
       ▼
Private Markdown Vault (fact source; Markdown + local JSON/JSONL system records)
       ▲                         │
       │ optional editor         ├── managed backups outside Vault
   Obsidian/Markdown editor      └── optional private Git repository
       ▲
MCP stdio gateway mcp_server.py ── scoped token + PROFILE_VAULT_ID handshake
```

## 模块职责与真实状态

- **Frontend — 已实现**：Overview、首次引导、Memory Review、Profile/Timeline、Monthly Reflection、Growth、Security Center、AI Connections、Provider Authorization、备份恢复、GitHub 备份、导入。
- **FastAPI — 已实现**：仅 loopback；健康检查以外的产品 API 受 bearer session 保护；托管生产 SPA；使用单一启动 Vault。
- **Core — 已实现**：领域逻辑、原子写、锁、revision、事务恢复、路径约束集中于 `core/`。
- **Markdown Vault — 已实现**：核心事实源；包含 Markdown 业务记录及 `90 System` 下的身份、安全/审计元数据。
- **Memory Lifecycle — 已实现**：candidate→confirmed/rejected，forget/supersede，人工确认、冲突检测和事务恢复。
- **Profile — 已实现**：由本地确认数据与 Profile Markdown 驱动；访问策略裁剪后展示。
- **Monthly Reflection — 已实现**：四维、事件、目标、可编辑本地抽取摘要、确认与历史；无离页未保存提醒。
- **Human 3.0 / Growth — 已实现**：复盘、四维自评、用户自选 Level、时间线、关联、目标；保持 local-only，不经 MCP 暴露。
- **MCP Gateway — 已实现但刻意最小化**：7 个 tools、7 个 scopes、Vault identity 绑定；没有 Resources/Prompts。
- **Security Center — 已实现**：客户端生命周期、hash-only token、scope、撤销/删除、哈希链审计、完整性失败关闭。
- **AI Connections — 已实现**：客户端注册/授权/重签/撤销/删除及 Host 配置向导；当前仓库没有真实 Claude Desktop 安装环境验收证据。
- **Windows Launcher — 已实现**：单实例、动态端口、一次性 fragment token、健康等待、关闭清理；敏感 runtime/app-data 文件使用仅限当前用户、SYSTEM 和 Administrators 的 protected DACL；安装器由 PyInstaller + Inno Setup 构建。
- **Backup & Recovery — 已实现（手动）**：managed backup、校验、保留/配额、恢复安全备份、Git 历史恢复；定时自动备份未实现。
- **Obsidian Integration — 部分实现**：模板含 `.obsidian`，外部编辑通过 VaultMonitor 检测；没有专用 Obsidian 插件，也不应成为强依赖。
- **AI Provider Architecture — 已实现可选连接器**：授权记录、精确 outbound preview、逐次 decision、审计和 OpenAI-compatible/Anthropic adapter；不是通用插件生态。

## 信任边界

1. Browser→FastAPI：bearer token 只保存在内存并从 URL fragment 清除。
2. FastAPI/Core→Vault：所有正式写入经过路径约束、锁、revision 与原子/事务操作。
3. MCP→Vault：客户端 token、scope、`ai_access` 和 Vault identity 四重约束。
4. Provider→Internet：仅用户批准的请求 payload 可离开本机。
5. Public repo↔Private Vault：必须物理隔离；发布/提交前执行敏感文件扫描与 release gate。
