# Phase 7 — Security Center

Security Center is the trusted, loopback-only control plane for MCP client access. Its API uses the launcher Bearer session; AI clients never receive that session token.

## Client authorization

Each client is created locally with a display name and the minimum required scopes. Creation returns a random credential exactly once. The Vault registry at `90 System/Security/clients.json` stores only its SHA-256 hash. Revocation and scope changes take effect on the next MCP call because authorization reads the registry for every request.

MCP configuration uses the issued identity and credential:

```json
{
  "env": {
    "PROFILE_VAULT": "ABSOLUTE_PATH_TO_PRIVATE_VAULT",
    "PROFILE_AGENT_ID": "client-...",
    "PROFILE_CLIENT_TOKEN": "one-time-issued-credential"
  }
}
```

`PROFILE_SCOPES` is not an authority. Scopes are granted only through the local Security Center. The canonical set is `profile:read`, `context:read`, `memory:search`, `memory:propose`, `memory:pending`, `project:read`, and `assessment:read`. There is deliberately no memory-confirm, delete, publish, or arbitrary file scope.

## Audit trail

Security decisions and memory lifecycle transitions are appended to `90 System/Audit/security.jsonl`. Each record includes event/client/resource/result/reason/correlation metadata plus `prevHash` and `hash`. Serialized append, flush, `fsync`, and a SHA-256 chain make truncation or alteration detectable. Invalid integrity fails protected authorization and lifecycle writes closed; a missing file is reported separately from a valid empty log.

Audit details reject secret/body/content/path fields. Client credentials, API session tokens, memory bodies, and absolute Vault paths must never enter the audit log or API response. Filters and pagination are performed locally.

## Trust boundaries

- Security management endpoints always require the local launcher Bearer token.
- MCP authenticates with a separate per-client credential and checks the durable scope registry.
- Record-level `ai_access` remains enforced by Core after client authorization. `denied` and `local-only` records are never returned through stdio MCP; `summary-only` returns only a confirmed summary.
- MCP can create candidates but cannot confirm them. Formal memory transitions remain local user actions.
- The Security Center makes no outbound request and does not discover or name clients that the user has not explicitly authorized.

## Recovery note

If audit integrity is invalid, preserve the file for investigation and restore from a verified local backup. Do not delete the log merely to make diagnostics green. Rotating or replacing a client credential is done by revoking that client and issuing a new authorization.
