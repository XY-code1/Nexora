# Contributing to NEXORA

Thanks for taking the time to contribute. NEXORA is local-first and privacy-first: the rules below exist so that a change cannot accidentally weaken those guarantees.

## Development setup

Requirements: Python 3.12+, Node.js 24+, Git.

```bash
git clone https://github.com/XY-code1/Nexora.git
cd Nexora
python -m pip install -r requirements.txt

# Build the web workspace
cd apps/web
npm ci
npm run build
cd ../..

# Create a private Vault outside the repository
python profile.py init ../my-ai-profile
python profile.py validate ../my-ai-profile

# Run the product
python launcher.py --vault ../my-ai-profile
```

## Running checks

Run these before opening a pull request.

```bash
# Python regression suite and release gate
for t in tests/test_*.py; do python "$t"; done
python scripts/check_release.py
python -m compileall -q .

# Web workspace
cd apps/web
npm run typecheck
npm test
npm run lint
npm run build
npm run e2e
```

Tests use temporary synthetic Vaults. They must never read or copy a real private Vault.

## Pull requests

1. Branch from the latest `origin/main`.
2. Keep each pull request focused on one concern. Do not mix in unrelated formatting or private data.
3. Update the behaviour contract, API docs, and tests whenever behaviour changes.
4. Update [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) in the same pull request when a capability changes state.
5. Do not commit, push, or open a release on someone else's behalf without explicit instruction.

Commit messages follow conventional prefixes: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`. Write the subject in the imperative and explain the *why* in the body when it is not obvious.

## Boundaries you must not cross

These are safety properties, not style preferences. A change that breaks them will not be merged.

1. Never read, copy, commit, or push a real private Vault. The Markdown Vault remains the only source of truth.
2. All file operations and permission decisions must go through the Core. Do not write business logic into `profile.py`, `mcp_server.py`, `review_app.py`, or React components.
3. The MCP gateway stays read-only for formal records. It may propose candidates; it must never confirm, delete, supersede, or publish.
4. Missing or invalid `ai_access` must default to deny. `denied` and `local-only` records must never be returned through MCP.
5. `summary-only` may return only an explicit summary field, never a summary generated from private body text.
6. The local HTTP service must never listen on `0.0.0.0`.
7. Do not embed bearer tokens, passwords, API keys, or private paths in frontend assets.
8. Writes must keep going through the Core file locks and revision checks; the frontend must not touch Vault files directly.
9. Do not delete `review_app.py` until the React workspace is feature-equivalent through a compatibility period.
10. Do not introduce Electron/Tauri, cloud accounts, a database, Redux, or WebSocket without a separate design discussion.

## Reporting issues

Use a bug report or feature request template. For security issues, follow [SECURITY.md](SECURITY.md) — do not open a public issue.
