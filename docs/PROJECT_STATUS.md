# Project Status

> **This file is the authoritative, current status of the project.**
>
> Historical planning documents keep their original wording for audit purposes:
> `docs/PHASE*_PLAN.md`, `docs/PRODUCT_UX_ROADMAP.md`, `docs/GITHUB_BACKUP_PLAN.md`,
> `docs/AI_CONNECTIONS_PLAN.md`, `docs/PRODUCT_ARCHITECTURE.md`, `README_AGENT_HANDOFF.md`.
> **Where they disagree with this file, this file wins.** Do not infer progress from their
> “未实现 / 部分实现 / 尚未完成” sections without checking here first.

Last updated: 2026-11-09 · Repository: `XY-code1/Nexora`

## 1. Delivery status

All five README Roadmap items are delivered.

| Roadmap | Status | Delivered by |
|---|---|---|
| 1. Refine first-run setup and Vault selection | **Done** | First-run wizard, registered-Vault quick connect, `vaultHints` |
| 2. Add safer GitHub private-repository setup and privacy verification | **Done** | GitHub Device Flow, private verification, connection wizard |
| 3. Improve backup history browsing and guided recovery | **Done** | 4-step recovery wizard, backup history filter/search/sort |
| 4. Add explicit model-provider authorization | **Done** | `core/provider_auth.py` (per-scope, per-call, audit) |
| 5. Provide user-controlled import tools | **Done** | Markdown/JSON import wizard |

## 2. Feature matrix

| Capability | Status | Notes |
|---|---|---|
| Vault lifecycle (create / validate / connect / restart-switch) | Done | |
| First-run wizard + registered Vault list | Done | |
| External edit detection | **Done** | Resident `VaultMonitor` watcher, `/api/v1/vault/events`, non-blocking conflict banner |
| Managed local backups (create / verify / restore) | Done | |
| Backup retention + disk quota | **Done** | 20 copies / 500 MB per Vault, pruned when a backup is created |
| Version history (local backups + Git commits) | **Done** | Unified timeline |
| Git history browsing | **Done** | `GET /api/v1/git/history` |
| Git history restore | **Done** | `POST /api/v1/git/restore`; managed safety backup first, HEAD unchanged |
| Git change preview + sensitive-file scan | **Done** | `GET /api/v1/git/changes`; commits fail closed on a hit |
| GitHub Device Flow | **Done** | Token lives only in API process memory |
| GitHub private-repository verification | **Done** | Public repositories are refused before the remote is written |
| GitHub private-repository creation | **Done** | `POST /api/v1/github/create` |
| GitHub connection wizard | **Done** | “GitHub 备份” page |
| Memory import (Markdown / JSON) | Done | Candidates only, never auto-confirmed |
| AI Provider authorization module | Done | No network access; inert until a provider opts in |
| MCP host connection | Done | |
| Windows launcher + installer | Done | |

## 3. Deliberate non-goals (still not planned)

- No default cloud collection or cloud-hosted profile.
- No silent memory confirmation.
- No automatic psychological labels.
- No unrestricted AI file access.
- No screen / keyboard / microphone / browsing-history capture.
- Growth data stays local-only (no growth scope over MCP).

## 4. Known remaining gaps

- `sync_commit` does not create a managed backup before committing.
- No scheduled / automatic local backup.
- No network-failure retry for Git pull/push.
- Windows ACL semantics for the runtime file are unverified (`chmod 0600` is attempted).

## 5. How to update this file

When a capability changes state, update this file in the same PR. Planning documents may keep
their historical wording, but add a one-line pointer to this file when they are edited.
