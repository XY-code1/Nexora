# Project Status

Last verified: 2026-11-17（Asia/Shanghai）
Code baseline: `main@85ea0fe` · Public release: `v1.0.4` · Active candidate: `fix/windows-private-acl`.

## Current phase

NEXORA has completed its principal local-first product loops and is in **Release Hardening**. Memory lifecycle, profile, monthly reflection, Human 3.0/Growth, Security Center, MCP, AI Connections, provider authorization, backup/recovery, private GitHub connection, Windows launcher and installer automation all have real implementations and automated coverage.

It is not yet classified as a fully validated stable release. Remaining release gates are real NTFS ACL and multi-user evidence, clean-VM install/upgrade/uninstall/recovery, local Playwright download-root-cause reproduction, and a real MCP host compatibility baseline. See `RELEASE_READINESS_CHECKLIST.md`.

## Capability status

- **Implemented:** Vault create/validate/register/restart-switch, resident external-edit monitoring, memory lifecycle, profile, conversational onboarding, monthly reflection, Human 3.0, Growth, Security Center, AI Connections, provider authorization, import, managed backups, Git history/restore, GitHub Device Flow/private verification, Windows launcher and installer build/smoke automation.
- **Partial or deliberately limited:** Obsidian is an optional file editor rather than a required plugin; MCP currently exposes Tools but not Resources/Prompts; provider support is limited to the implemented adapters; scheduled backup is not implemented.
- **Release-hardening work:** Windows private-ACL remediation is implemented with local synthetic evidence and pending packaged CI/dual-user acceptance; clean-VM installer acceptance, local Playwright environment validation, real MCP client matrix, and final release documentation remain open.

## Current automated evidence

- Python: all 30 `tests/test_*.py` scripts passed during the 2026-11-17 takeover audit.
- Frontend unit: 28/28 tests passed; TypeScript and production build passed.
- Lint: exit 0 with one existing unused-variable warning in `apps/web/e2e/accessibility.spec.ts:4`.
- Ruff, release privacy gate and `pip-audit`: passed; no known Python dependency vulnerability was reported.
- MCP protocol/security, security lifecycle, provider target binding, backup, GitHub and launcher tests passed.
- GitHub CI after PR closure: smoke, Windows clean, Playwright E2E and Windows installer smoke all passed on the merged changes.
- Local Playwright: the earlier Chromium download attempt timed out before tests started. CI success does not close the local download-root-cause task.
- Candidate Win32 protected-DACL unit test: local synthetic Windows run passed; packaged CI and real multi-user validation are pending.
- Clean Windows VM manual installer acceptance: not yet performed; candidate CI now covers restart, upgrade, data retention, uninstall and reinstall.

## GitHub status

- PRs #47, #48, #52 and #53 were reviewed, rerun where necessary, passed CI and were merged.
- Dependency PR #43 and provider authorization PR #55 also passed CI and were merged.
- Open pull requests at this verification point: **0**.
- `main` is protected and requires pull requests.

## Documentation authority

This file is the current capability-status authority. Historical Phase, planning and acceptance documents preserve their original context; their historical “not implemented” or “complete” statements must not override current code and current evidence. The FastAPI source currently defines 103 `/api/v1` routes, and `LOCAL_API.md` was checked against that inventory during R4.

## Workspace note

The Release Hardening planning and R4 documentation closure change only project documentation; they do not modify product code or user data. Their Git publication state is determined by the repository history rather than this status snapshot.
