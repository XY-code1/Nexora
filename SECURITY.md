# Security Policy

NEXORA is a local-first application. Your Vault stays on your machine unless you explicitly configure a private Git remote, and no cloud service is involved by default. This policy covers the framework code in this repository — it does not cover the contents of your personal Vault, which you own and operate.

## Supported Versions

| Version | Supported |
| --- | --- |
| 1.0.x | Yes |
| < 1.0.0 | No |

Security fixes are applied to the latest release. There are no long-term support branches.

## Reporting a Vulnerability

Please report vulnerabilities privately. Do not open a public issue for anything that could put users at risk.

- Preferred: [GitHub private vulnerability reporting](https://github.com/XY-code1/Nexora/security/advisories/new).
- Include: affected version, a description of the issue, and a minimal reproduction or proof of concept.
- Do not include Vault contents, credentials, tokens, or any personal data.

Reports are acknowledged within 7 days. We will coordinate a fix and a disclosure timeline with you before anything is published.

## Security Model

The framework is designed so that a single mistake cannot silently expose private data:

- The local API binds to `127.0.0.1` only; `0.0.0.0` is never used.
- Every request except the health check requires a short-lived bearer token, passed once through the URL fragment and kept only in page memory.
- Trusted-host checking restricts requests to loopback hosts.
- The Vault is the single source of truth and is addressed by record ID, never by client-supplied file paths.
- All writes go through the Core with inter-process locks and SHA-256 revision checks; conflicting edits return `409 REVISION_CONFLICT` instead of overwriting.
- Writes are atomic (temporary file plus `os.replace`), with transaction journals for crash recovery.
- Lifecycle changes are audited in a tamper-evident record; client credentials are stored only as hashes.
- Commits fail closed when a sensitive file is detected.
- The MCP gateway is read-only for formal records: clients can propose candidates, but they cannot confirm, delete, or publish.

## Out of Scope

- Attacks that already require arbitrary code execution or administrative access on your machine. NEXORA runs with your privileges and cannot defend against them.
- The contents of your personal Vault, including how you configure your private remote.
- Third-party MCP clients, AI providers, or editors you choose to connect.
- Denial of service against your own local instance.

## Notes for Researchers

- Test with a synthetic Vault only. Never ask a reporter for real personal data.
- The Windows launcher stores its bearer token in memory and removes it from the URL after bootstrap; runtime state lives under `%LOCALAPPDATA%`.
- See [PRIVACY.md](docs/PRIVACY.md) and [SECURITY_CENTER.md](docs/SECURITY_CENTER.md) for the full data and permission model.
