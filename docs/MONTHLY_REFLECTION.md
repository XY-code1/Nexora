# Monthly Reflection data model

Phase 6 uses an independent local-first record instead of reusing Human 3.0 assessments or memory records.

## Storage

```text
40 Reviews/Monthly/
  Drafts/mr-YYYY-MM-XXXXXXXX.md
  History/mr-YYYY-MM-XXXXXXXX.md
```

Each Markdown record contains readable sections plus a canonical JSON payload inside a private document comment. Frontmatter records:

- `record_type: monthly-reflection`
- `id`
- `month`
- `status: draft | confirmed`
- `visibility: private`
- `ai_access: local-only`
- creation/update/confirmation timestamps

The payload stores four dimension texts, important events, the editable summary, summary provenance, and next-month goals. Every mutation is atomic, locked, secret-scanned, and revision-checked.

## Confirmation and history

- New reflections begin as `draft`.
- Four dimensions plus an editable summary are required before confirmation.
- Confirmation moves the record transactionally from `Drafts` to `History`.
- Editing a confirmed historical record moves it back to `Drafts`; it must be explicitly confirmed again.
- No numeric growth score is generated.

## Summary assistant

No external AI provider exists in V0.1. The `summary-draft` endpoint is therefore a deterministic, local extractive helper:

1. It reads only the four persisted user-authored dimension texts.
2. It extracts the first factual fragment from each non-empty dimension.
3. It marks provenance as `local-extractive`.
4. The user can edit the draft; saving changes provenance to `user-edited`.
5. The record cannot become formal without explicit confirmation.

No reflection content is sent to a cloud service. A future provider integration must add a separate opt-in authorization flow and must not silently replace this local path.

## Save behavior

Dimension text, events, goals, and summary edits use explicit manual-save actions. This is intentional: the browser does not silently persist unfinished reflection text and cannot mark a reflection formal without confirmation. Unsaved text can be lost when the user switches sections or leaves the page; a future UI may add a leave warning, but that warning must not perform an implicit write.

## Phase boundary

The stored record already includes the fields needed for later time-based queries: month, four named dimensions, confirmation status, events, goals, goal completion, and timestamps. Cross-month Human 3.0 aggregation, comparisons, and growth visualization belong to Phase 8 and are not performed in Phase 6. No growth score is inferred from a monthly reflection.

## Known limitations and roadmap

### Known limitations

- The summary helper is local and extractive rather than model-generated. This is the accepted Local-first Phase 6 behavior, not a missing core function.
- Editing uses explicit manual save. There is currently no unsaved-change navigation warning.

### Future roadmap

- A separate AI Provider module may add optional model-assisted summaries. It must require per-request authorization, show the exact outbound-content preview, minimize transmitted data, and retain a local audit record.
- Phase 8 may aggregate confirmed monthly records for Human 3.0 time-series comparison using the existing query fields.
- A future UX pass may add an unsaved-change leave warning without silently writing draft or formal content.

### Blocking issues

None identified for Phase 6 acceptance. Creation, persistence, history retrieval/editing, event and goal mutation, local summary drafting/editing, revision conflicts, and explicit confirmation are covered by passing automated tests.

## API

- `GET /api/v1/monthly-reflections`
- `POST /api/v1/monthly-reflections`
- `GET /api/v1/monthly-reflections/{id}`
- `PUT /api/v1/monthly-reflections/{id}/dimensions/{dimension}`
- `POST /api/v1/monthly-reflections/{id}/events`
- `DELETE /api/v1/monthly-reflections/{id}/events/{eventId}`
- `PUT /api/v1/monthly-reflections/{id}/goals`
- `POST /api/v1/monthly-reflections/{id}/summary-draft`
- `PUT /api/v1/monthly-reflections/{id}/summary`
- `POST /api/v1/monthly-reflections/{id}/confirm`

All endpoints require the local bearer session. Mutations require the current SHA-256 revision.
