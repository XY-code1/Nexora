<div align="center">

# NEXORA（知序）

### Your Intelligence. Your Data. Your Control.

**An open-source, local-first Personal Intelligence Platform for confirmed memory, reflection, knowledge and permission-controlled AI access.**

[![CI](https://github.com/XY-code1/personal-ai-profile/actions/workflows/test.yml/badge.svg)](https://github.com/XY-code1/personal-ai-profile/actions/workflows/test.yml)
[![GitHub Release](https://img.shields.io/github/v/release/XY-code1/personal-ai-profile?display_name=tag&sort=semver)](https://github.com/XY-code1/personal-ai-profile/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-27BFFF.svg)](LICENSE)
[![Local First](https://img.shields.io/badge/architecture-local--first-20D9E8.svg)](#architecture)
[![MCP](https://img.shields.io/badge/MCP-permission--controlled-936BFF.svg)](#mcp-gateway)

[English](#overview) · [中文](#中文概览) · [Quick Start](#quick-start) · [Security](#privacy-and-security) · [Documentation](#documentation)

<img src="apps/web/public/brand/nexora-logo.svg" alt="NEXORA — Personal Intelligence Platform" width="720" />

</div>

---

## Overview

NEXORA（知序）, formerly developed under the project name Personal AI Profile, creates a user-owned intelligence layer that can be shared across Codex, Claude, Cursor, and other MCP-compatible AI clients.

Your private data remains in a local Markdown Vault. AI clients may read only what you explicitly authorize. They can propose candidate memories, but they cannot silently convert a conversation into permanent memory.

```text
Conversation
    ↓
Candidate memory
    ↓
Human review: confirm / edit / reject
    ↓
Confirmed local memory
    ↓
Minimum authorized context for an AI client
```

### Why it exists

Personal context is fragmented across AI products:

- every assistant needs the same background and preferences;
- decisions, goals, and project context do not carry across tools;
- platform memory is difficult to inspect, correct, or migrate;
- copying entire conversations creates unnecessary privacy exposure;
- maintaining a large profile form by hand feels like work.

NEXORA separates the **experience of conversation** from the **authority of memory**.

## Product

### First-run experience

Setup happens before the daily workspace:

1. Create or connect a private Vault.
2. Choose Web-only use or optional Obsidian editing.
3. Complete a lightweight local conversation.
4. Explicitly submit selected answers as candidate memories.
5. Review candidates before anything enters the formal profile.

Conversational onboarding is intentionally not duplicated in the permanent workspace navigation.

### Daily workspace

| Surface | Purpose |
| --- | --- |
| **Overview** | Profile status, recent memory activity, recommended next action, AI authorization, and Vault health |
| **Memory Review** | Inspect, edit, confirm, or reject candidate memories |
| **Personal Profile** | View confirmed and currently permitted long-term information |
| **Monthly Reflection** | Local-first Mind, Body, Spirit, and Vocation reflection |
| **Human 3.0 / Growth** | User-authored self-assessment, goals, associations, and timeline |
| **Privacy Audit** | Client permissions, access events, denials, and lifecycle evidence |
| **Backup & Recovery** | Verified snapshots, safe restore, Vault switching, and optional Git operations |
| **AI Connections** | Register, authorize, rotate, revoke, and configure individual AI clients |

Human 3.0 is a reflection framework. It does not provide medical or psychological diagnosis.

## Core principles

1. **User-owned data** — portable Markdown instead of a vendor-locked profile.
2. **Local-first** — the Vault remains the single source of truth.
3. **Human confirmation** — unconfirmed content never becomes formal memory.
4. **Minimum disclosure** — each client receives only task-relevant context.
5. **Explicit permissions** — every AI client has its own identity, credential, and scopes.
6. **No raw-chat archive by default** — submitted candidate facts are stored, not complete conversations.
7. **Traceable lifecycle** — memories can be reviewed, edited, rejected, superseded, archived, and traced.
8. **Fail closed** — unsafe paths, invalid credentials, mismatched Vault identities, and denied access are rejected.

## Architecture

```text
React + TypeScript + Vite Web
              │
              │ authenticated JSON API on 127.0.0.1
              ▼
        FastAPI Local Service
              │
              ▼
Core / Domain / Security / Storage
              │
              ▼
      Local Markdown Vault
       ├── optional Obsidian editing
       ├── verified local backups
       ├── optional private Git history
       └── permission-controlled MCP Gateway
                    │
                    └── Codex / Claude / Cursor / other clients
```

### Components

- **Web workspace** — primary user interface.
- **Markdown Vault** — single source of truth.
- **Python Core** — lifecycle, storage, revision, locking, backup, and security rules.
- **FastAPI local service** — authenticated loopback API for the Web UI.
- **MCP Gateway** — bounded, permission-controlled AI access.
- **Obsidian** — optional editor for the same Vault; never a requirement.
- **Git/GitHub** — optional private backup configured by the user.

The public framework repository contains code, templates, schemas, and documentation. A personal Vault must live outside this repository and must never share its public Git history.

## Vault model

```text
my-ai-profile/
├─ 00 Dashboard/
├─ 10 Profile/
│  └─ Profile.md
├─ 20 Projects/
│  ├─ Active/
│  └─ Archived/
├─ 30 Memory/
│  ├─ Inbox/
│  ├─ Confirmed/
│  ├─ Rejected/
│  └─ Archived/
├─ 40 Reviews/
├─ 90 System/
│  └─ vault.json
├─ AGENTS.md
└─ profile.config.yml
```

Each Vault receives a random stable identity. The Web service and MCP Gateway can verify that they use the same Vault without exposing its private path in the interface.

### Memory lifecycle

```text
candidate → confirmed
candidate → rejected
confirmed → superseded / archived
```

### AI access levels

| Level | Meaning |
| --- | --- |
| `allowed` | Full permitted content |
| `summary-only` | Confirmed summary only |
| `local-only` | Local processing only; never returned through MCP |
| `denied` | No model access |

Example record:

```yaml
---
id: mem-20261107-001
type: preference
status: confirmed
created: 2026-11-07
source: conversation
visibility: private
ai_access: summary-only
confidence: explicit
---
```

## MCP Gateway

The local stdio gateway exposes bounded tools:

```text
get_vault_identity
get_profile
get_current_context
search_memory
list_projects
propose_memory
list_pending
get_human3_summary
```

MCP clients cannot confirm memories, delete formal records, publish content, or write arbitrary Vault files.

Each client is created in **AI Connections / Security Center** and receives an independent credential with minimal scopes. Generated host configuration includes the expected Vault identity; a mismatch fails closed.

```json
{
  "mcpServers": {
    "personal-profile": {
      "command": "python",
      "args": ["ABSOLUTE_PATH_TO_FRAMEWORK/mcp_server.py"],
      "env": {
        "PROFILE_VAULT": "ABSOLUTE_PATH_TO_PRIVATE_VAULT",
        "PROFILE_VAULT_ID": "vault_random_identity",
        "PROFILE_AGENT_ID": "client-issued-by-security-center",
        "PROFILE_CLIENT_TOKEN": "one-time-issued-credential"
      }
    }
  }
}
```

See [MCP host connection](docs/MCP_HOST_CONNECTION.md) and [Security Center](docs/SECURITY_CENTER.md).

## Privacy and security

### Automated operations

The system may:

- read permitted profile summaries;
- search confirmed and authorized memories;
- detect duplicate or conflicting candidates;
- propose candidate memories;
- generate local reflection drafts;
- create and verify local backups;
- build minimum task-specific context.

### Human confirmation required

- confirming formal long-term memory;
- changing stable profile facts;
- destructive lifecycle actions;
- confirming a formal reflection;
- authorizing a client or changing its scopes;
- sending private content to an external model;
- publishing or exporting personal information.

### Never store

- passwords, tokens, OTPs, API keys, private keys, or cookies;
- identity documents or payment-card data;
- unredacted third-party private information;
- conversations the user did not choose to preserve.

> A private Git repository is not a password vault. Removing a secret from the working tree does not remove it from Git history.

Security foundations include loopback-only serving, bearer sessions, trusted-host checks, path isolation, SHA-256 revisions, inter-process locks, transaction journals, secret scanning, hashed client credentials, immediate revocation, and tamper-evident audit records.

## Current status

### Available

- [x] React + TypeScript + Vite local Web workspace
- [x] FastAPI versioned local API
- [x] Shared Python Core for CLI, API, MCP, and compatibility UI
- [x] Candidate creation, review, editing, confirmation, and rejection
- [x] Confirmed profile, timeline, and privacy-safe visualization
- [x] Monthly Reflection and Human 3.0 local workflows
- [x] Security Center and AI Connections lifecycle
- [x] MCP stdio gateway with per-client authorization
- [x] Stable Vault identity and multi-Vault isolation
- [x] Web Vault creation, validation, and restart-based switching
- [x] External-change revision detection for Obsidian and other editors
- [x] Verified backup, safety snapshot, and transactional restore
- [x] Conservative Git commit, pull, and push for a preconfigured private repository
- [x] Windows single-instance launcher and installer pipeline
- [x] Python, frontend, protocol, security, release-gate, and E2E tests

### Known limitations

- GitHub OAuth/Device Flow and automatic private-repository creation are not implemented.
- The user must verify that a configured GitHub remote is private.
- External editor changes are detected by content revision; there is no permanent filesystem watcher.
- The project does not capture screens, keyboard input, microphone data, or full browsing history.
- No cloud account or cloud-hosted personal profile service is included.

## Quick Start

### Windows

Use the installer from [GitHub Releases](https://github.com/XY-code1/personal-ai-profile/releases) when available, or run:

```text
start-review.vbs
```

The launcher selects a local port, creates a short-lived session, opens the browser, and binds only to `127.0.0.1`.

### Developer setup

Requirements:

- Python 3.12+
- Node.js 24+
- Git

```powershell
git clone https://github.com/XY-code1/personal-ai-profile.git
cd personal-ai-profile

python -m pip install -r requirements.txt

# Create a private Vault outside the framework repository
python profile.py init ..\my-ai-profile
python profile.py validate ..\my-ai-profile

# Build the Web UI
cd apps\web
npm ci
npm run build
cd ..\..

# Start the integrated local product
python launcher.py --vault ..\my-ai-profile
```

Split frontend/backend development:

```powershell
# Terminal 1
python -m apps.api.main --vault ..\my-ai-profile --show-token

# Terminal 2
cd apps\web
npm run dev
```

The API hides its management bearer token from startup logs by default. The split frontend/backend development example opts in with `--show-token` so the token can be entered in the local UI; use that flag only in a trusted local terminal. The bearer token remains in page memory and is removed from the URL after bootstrap. It is not stored in `localStorage` or bundled assets.

## Testing

```powershell
# Python regression and release gate
Get-ChildItem tests\test_*.py | ForEach-Object { python $_.FullName }
python scripts\check_release.py

# Frontend verification
cd apps\web
npm run typecheck
npm test
npm run lint
npm run build
npm run e2e
```

Tests use temporary synthetic Vaults. They must never read or copy a real private Vault.

## Documentation

| Topic | Document |
| --- | --- |
| Brand guidelines | [BRAND_GUIDELINES.md](docs/brand/BRAND_GUIDELINES.md) |
| Logo specification | [LOGO_SPECIFICATION.md](docs/brand/LOGO_SPECIFICATION.md) |
| Brand assets | [BRAND_ASSET_CATALOG.md](docs/brand/BRAND_ASSET_CATALOG.md) |
| Product identity | [PRODUCT_IDENTITY.md](docs/brand/PRODUCT_IDENTITY.md) |
| Product architecture | [PRODUCT_ARCHITECTURE.md](docs/PRODUCT_ARCHITECTURE.md) |
| Vault lifecycle | [VAULT_LIFECYCLE_PLAN.md](docs/VAULT_LIFECYCLE_PLAN.md) |
| Local API | [LOCAL_API.md](docs/LOCAL_API.md) |
| Memory lifecycle | [MEMORY_LIFECYCLE.md](docs/MEMORY_LIFECYCLE.md) |
| Privacy model | [PRIVACY.md](docs/PRIVACY.md) |
| Security Center | [SECURITY_CENTER.md](docs/SECURITY_CENTER.md) |
| MCP clients | [MCP_HOST_CONNECTION.md](docs/MCP_HOST_CONNECTION.md) |
| Backup and recovery | [PHASE9_BACKUP_RECOVERY.md](docs/PHASE9_BACKUP_RECOVERY.md) |
| GitHub backup | [GITHUB_BACKUP_PLAN.md](docs/GITHUB_BACKUP_PLAN.md) |
| Windows launcher | [WINDOWS_LAUNCHER.md](docs/WINDOWS_LAUNCHER.md) |
| Windows installer | [WINDOWS_INSTALLER.md](docs/WINDOWS_INSTALLER.md) |
| Release gates | [RELEASE_GATES.md](docs/RELEASE_GATES.md) |

## Roadmap

1. Complete the NEXORA identity migration across release and community assets.
2. Add GitHub Device Flow and verified private-repository provisioning without storing credentials in the Vault.
3. Expand explicitly authorized model-provider connectors without weakening local-first defaults.
4. Continue accessibility, localization and Windows packaging validation.

The project will not add silent memory confirmation, automatic psychological labels, unrestricted AI file access, or default cloud collection.

---

## 中文概览

NEXORA（知序）是一个**开源、本地优先、模型无关、由用户控制**的个人智能平台。项目原开发名称为 Personal AI Profile，现有仓库地址和兼容标识暂时保持不变。

它不会让 AI 自动保存所有聊天，而是建立一条清晰的记忆边界：

```text
自然对话
→ 用户明确提交
→ 生成候选记忆
→ 用户审核、修改或拒绝
→ 已确认内容进入私人 Vault
→ 获得授权的 AI 按最小范围读取
```

### 核心特点

- Web 是主要使用界面，Obsidian 是可选编辑器。
- Markdown Vault 是唯一事实数据源，可以迁移、备份和审计。
- 首次对话建档发生在进入工作台之前，不会在侧边栏重复出现。
- 未经用户确认的内容不会进入正式个人档案。
- 每个 AI 客户端必须独立授权，并使用最小权限 Scope。
- `local-only` 和 `denied` 内容不会通过 MCP 返回。
- GitHub 只作为用户主动配置的私人备份，不是事实数据源。
- 项目不会默认保存完整聊天，也不会监控屏幕、键盘、麦克风或完整浏览记录。
- Human 3.0 仅用于个人反思，不提供医学或心理诊断。

### 公开框架与私人数据

```text
Public Framework Repository   程序、模板、Schema 和文档
Private Personal Vault        用户的真实档案、记忆和复盘
Optional Public Export        经过选择、脱敏和人工确认的公开内容
```

公共仓库与私人 Vault 必须完全分离，不能共享 Git 历史。密码、Token、验证码、API Key、私钥、证件和银行卡信息不应写入 Vault。

### 中文快速开始

```powershell
git clone https://github.com/XY-code1/personal-ai-profile.git
cd personal-ai-profile
python -m pip install -r requirements.txt

# 在框架仓库之外创建私人 Vault
python profile.py init ..\my-ai-profile
python profile.py validate ..\my-ai-profile

cd apps\web
npm ci
npm run build
cd ..\..

python launcher.py --vault ..\my-ai-profile
```

更多中文技术说明请查看 [`docs/`](docs/) 目录。

## Contributing

Contributions are welcome. Please preserve the project boundaries:

- do not include real personal data in issues, fixtures, screenshots, or commits;
- use temporary synthetic Vaults in tests;
- do not bypass Core lifecycle or permission checks for UI convenience;
- do not add silent memory confirmation;
- keep private Vault paths, credentials, and content out of logs and public artifacts.

## License

[MIT](LICENSE)
