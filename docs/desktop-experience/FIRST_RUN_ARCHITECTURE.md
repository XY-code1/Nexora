# NEXORA First-run Experience Architecture

## Audit baseline

The previous first-run flow was a single component mounted after the Workspace session had already opened. It reused one large page, briefly allowed the Workspace shell to render while first-run state was loading, and ended before a dedicated candidate review step. The underlying Vault, onboarding-topic, candidate, and initialization APIs already existed and remain authoritative.

## Product boundary

NEXORA now has two mutually exclusive presentation roots:

```text
token gate
  -> resolve Vault initialization state
     -> OnboardingRouter -> OnboardingLayout (uninitialized)
     -> Workspace shell                         (initialized)
```

`OnboardingLayout` never mounts the Workspace sidebar, top bar, Overview, or daily-use navigation. Completion persists the existing initialization marker before the Workspace is mounted.

## Route and component map

| Route | Step component | Real capability |
| --- | --- | --- |
| `#/onboarding/welcome` | `WelcomeStep` | Product promise only |
| `#/onboarding/vault` | `VaultStep` | Vault status, registry, default path, create, validate, switch, forget |
| `#/onboarding/import` | shared `ImportFlow` | File read, Markdown/JSON parsing, preview, duplicate/error states, candidate creation, optional skip |
| `#/onboarding/choice` | `DataChoiceStep` | Vault, Obsidian, local snapshot, GitHub private backup, AI client and Provider boundaries; local preferences only |
| `#/onboarding/conversation` | `ConversationStep` | Existing onboarding topics and candidate creation |
| `#/onboarding/review` | `MemoryReviewStep` | Existing edit / confirm / reject lifecycle |
| `#/onboarding/complete` | `CompleteStep` | Existing initialization marker, then Workspace handoff |

The implementation is split under `apps/web/src/onboarding/` into router, layout, state, and step components. `FirstRunWizard.tsx` is retained as a compatibility boundary for `App.tsx`.

## State and recovery

Only the current step, selected topic, and optional integration preferences are stored in local storage. Unsubmitted personal answers are intentionally not persisted. Saved candidates remain in the Vault and are loaded again at Review. Finishing clears the onboarding draft keys but does not delete the Vault or memories.

The application resolves the initialization snapshot before mounting either experience, preventing an Overview flash for new users. If optional classification endpoints are unavailable, the existing Workspace behavior remains available instead of trapping an established user.

## Safety invariants

- Connecting an existing Vault validates it before switching.
- Creating a Vault uses the existing create endpoint and never overwrites by UI convention.
- Obsidian, GitHub backup, providers, and MCP remain optional.
- Import uses the same API-backed flow as the Workspace Import page and may be skipped without creating data.
- Imported items and conversational answers both enter the shared candidate queue.
- Conversational answers create candidates only.
- Candidate confirmation and rejection use the existing revision-aware APIs.
- Pending candidates may remain when entering the Workspace and are reported as pending.
- Vault Schema, API contracts, MCP permissions, Windows ACL, and installer code are unchanged.

## Responsive acceptance

| Width | Expected behavior |
| --- | --- |
| 1440 px | Centered Welcome; focused Import; two-column data-choice composition |
| 1024 px | Full-screen layout without Workspace chrome; compact but unchanged hierarchy |
| 390 px | Single-column steps, full-width primary action, stacked Review and completion summaries, no horizontal overflow |

All motion is decorative and disabled by `prefers-reduced-motion`.

## Verification matrix

- New Vault: Welcome -> create -> import or skip -> choices -> conversation -> unified review -> completion.
- Existing Vault: Welcome -> validate/connect or recent Vault -> continue without migration.
- Resume: stored step/topic restored; unsubmitted answer absent.
- Review: edit, confirm, reject, and continue with pending candidates.
- Completion: initialization marker succeeds before Workspace handoff.
- Regression: initialized Vault enters Workspace directly.
