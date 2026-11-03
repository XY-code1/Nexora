# Phase 7 — Initial architecture gap analysis

This analysis was completed before Phase 7 implementation. It describes the repository at commit `66f8c3d`.

## Existing controls

- The local FastAPI service requires an in-memory Bearer launch token and binds to loopback.
- MCP requires a syntactically valid `PROFILE_AGENT_ID` and a comma-separated `PROFILE_SCOPES` environment value.
- The existing MCP scope set is: `profile:read`, `context:read`, `memory:search`, `memory:propose`, `memory:pending`, `project:read`, and `assessment:read`.
- MCP exposes no confirm, reject, forget, supersede, Profile-edit, or publish tool.
- Record-level `ai_access` is enforced by shared Core access helpers; `denied` and `local-only` bodies are not returned through MCP.
- MCP appends minimal JSON lines to `90 System/Audit/mcp.jsonl`.
- Memory lifecycle mutations use Core locks, revision checks, atomic writes, and transactions where multiple files are involved.
- The current Privacy Audit UI displays local metadata counts and aggregate MCP event names.

## Missing capabilities

### Client identity and authorization

- `PROFILE_AGENT_ID` is a caller-supplied label, not a cryptographically authenticated identity.
- Environment scopes are caller supplied and are not grants stored by a human-controlled authority.
- No authorization timestamp, last-access timestamp, connection state, revocation, or client history exists.
- A revoked identity cannot be prevented from restarting with the same environment values.

### Permission enforcement

- Scope checks exist only inside MCP and are not backed by a durable grant registry.
- There is no server-side permission-management API.
- There is no one-time client credential issuance or hashed credential storage.
- Existing scopes should remain canonical to avoid introducing a duplicate permission vocabulary.

### Audit infrastructure

- Existing records do not have event IDs, correlation IDs, resource types, results, reason codes, or integrity chaining.
- The JSONL file is append-oriented but has no tamper-evident hash chain and no serialized append lock.
- Successful events are commonly written after the protected operation; audit failure can therefore occur after a side effect.
- Denials other than missing scope are not consistently recorded.
- Lifecycle transitions performed outside MCP are not represented in the MCP audit file.

### Query and UI

- No event pagination, client/time/type/result filtering, detail view, or integrity status exists.
- Aggregate counts cannot distinguish a missing audit file from a verified zero-event log.
- The UI has no real client list, grants, revoke action, last-access time, or diagnostics.
- Current green service/Vault labels indicate connection only; MCP and audit health are not actively verified.

## Phase 7 implementation direction

1. Keep the existing MCP scopes as the single canonical scope model.
2. Add a Vault-local authorization registry with random client credentials stored only as hashes.
3. Require MCP client ID plus credential; do not trust environment scopes as authorization.
4. Add a tamper-evident append audit log with a serialized writer, event/correlation IDs, reason codes, and redacted metadata only.
5. Record an allowed/denied authorization decision before protected MCP work; an audit write failure fails closed.
6. Record existing Core memory lifecycle transitions without changing their semantics.
7. Add authenticated local APIs for client grant/revoke, event queries, lifecycle queries, and diagnostics.
8. Replace aggregate-only Privacy Audit UI with a real Security Center using those APIs.

## Non-goals

- No AI client may receive memory-confirmation authority.
- No private content, access token, API key, password, or Vault root path is stored in audit events.
- Phase 7 does not access a real private Vault; all validation uses temporary synthetic Vaults.
- Phase 7 does not begin Human 3.0 aggregation or Phase 8 work.
