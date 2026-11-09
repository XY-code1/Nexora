# NEXORA（知序）Brand Guidelines

Version B1 · 2026-11-09

## 1. Brand Overview

**NEXORA（知序）** is the public, open-source identity of the Personal AI Profile project. It is a **Personal Intelligence Platform** built around one promise: **Your Intelligence. Your Data. Your Control.**

NEXORA is a local-first personal intelligence platform that connects personal memory, identity, knowledge, and AI tools while keeping users in control of their data.

## 2. Brand Positioning

NEXORA is the personal intelligence layer between a user-owned knowledge base and the AI tools the user chooses to authorize. It is not a cloud profile broker, an autonomous surveillance agent, or a replacement for user judgment.

## 3. Brand Mission

Make personal context useful across AI tools without surrendering ownership, privacy, or the right to confirm what becomes long-term memory.

## 4. Brand Vision

Every person can maintain a durable, portable and understandable intelligence layer that improves digital tools while remaining under human control.

## 5. Brand Values

- **Ownership** — local data remains user-controlled.
- **Clarity** — permissions, lifecycle state and consequences are visible.
- **Agency** — automation proposes; people decide.
- **Portability** — open formats and model-agnostic interfaces avoid lock-in.
- **Integrity** — the product never invents personal facts or claims access it does not have.
- **Restraint** — technology should reduce cognitive load, not demand attention.

## 6. Brand Personality

Precise, calm, intelligent, protective and forward-looking. NEXORA is advanced without being theatrical, private without being secretive, and confident without pretending certainty.

## 7. Brand Voice & Tone

- Use direct, specific language: “Review 3 candidate memories,” not “Unlock your potential.”
- State boundaries before asking for sensitive actions.
- Prefer verbs that reflect reality: review, authorize, save locally, revoke, restore.
- Never imply that an AI knows the user better than the user knows themselves.
- Error messages explain impact and recovery; success messages name what changed.
- English is the primary open-source language; Chinese is a first-class localized language.

## 8. Logo Usage

The **Intelligence Core** combines a faceted owned core with two controlled connection orbits. Use the full logo for project headers, documentation and public presentation. Use the symbol for app chrome, avatars and square placements. Use the simplified favicon below 24 px. Use the monochrome symbol where color reproduction is limited.

Do not redraw, rotate, crop, stretch or add unapproved glow. See [LOGO_SPECIFICATION.md](./LOGO_SPECIFICATION.md).

## 9. Color System

| Token | Hex | Primary role |
|---|---:|---|
| Deep Space | `#07111F` | primary dark ground |
| Midnight Navy | `#0C1728` | navigation and elevated surfaces |
| Panel Blue | `#13243A` | product panels |
| Electric Cyan | `#12D9F5` | primary brand/action signal |
| Neon Violet | `#906BFF` | secondary intelligence/accent signal |
| Signal Green | `#30D6A0` | verified/success state |
| Ice White | `#EAF3FF` | primary text on dark |
| Slate | `#8499B4` | secondary text |

Color is semantic before decorative. Cyan must not replace green for verified outcomes, and violet must not communicate destructive or error states. Glows may reinforce focus at low opacity; they must never carry meaning alone.

## 10. Typography

- **Space Grotesk** — display headings and public brand moments.
- **Inter** — Latin product UI and long-form copy.
- **Noto Sans SC** — Chinese UI and documentation fallback.
- **JetBrains Mono** — identifiers, revisions, scopes and technical metadata.

Use system fallbacks when fonts are not installed. No brand asset depends on downloading a font at runtime.

## 11. Iconography

Use outlined, geometric icons with consistent optical weight and rounded joins. Icons support labels rather than replacing them for critical actions. The Intelligence Core symbol is a brand mark, not a generic action icon.

## 12. UI Visual Language

- Layer Deep Space, Midnight Navy and Panel Blue instead of adding borders everywhere.
- Reserve cyan for primary action, active focus and controlled connectivity.
- Use violet sparingly for intelligence relationships and secondary emphasis.
- Prefer precise 1 px borders, 8–20 px radii and restrained depth.
- Holographic effects are accents; readable data and current tasks remain dominant.
- Motion communicates state changes and respects `prefers-reduced-motion`.

## 13. Accessibility

- Maintain WCAG 2.2 AA contrast for text and controls.
- Do not place Slate small text on Panel Blue without checking size and contrast.
- Focus indicators use a high-contrast cyan outline with at least 2 px visible area.
- Never use color as the only state indicator; pair it with text or an icon.
- Logo alternative text should be “NEXORA” or “NEXORA Intelligence Core,” not a visual description, unless the design itself is being discussed.
- Minimum touch target: 44 × 44 px.

## 14. Do & Don't

**Do**

- Preserve clear space around the mark.
- Use supplied SVG files without destructive editing.
- Use factual, permission-aware product copy.
- Keep effects subtle and layouts readable.

**Don't**

- Recreate the reference artwork or use neural-network clip art.
- Put the mark on visually noisy imagery without a solid field.
- Apply rainbow gradients, heavy bloom, bevels or drop shadows to the mark.
- Present unconfirmed memories as truth or use brand language to disguise a permission request.
- Combine the NEXORA mark with a third-party logo so they appear to be one brand.

## 15. Open Source Brand Usage

The codebase is public/open source. Source availability does not imply endorsement, partnership or ownership of the NEXORA identity. Community use should:

- clearly identify forks and substantial modifications;
- avoid suggesting official status without project approval;
- retain applicable license and attribution notices;
- avoid using the mark for deceptive, privacy-invasive or data-broker products;
- use “Built with NEXORA” or “Based on NEXORA” for derivatives rather than presenting a fork as the official project.

Repository licensing and any future trademark policy remain authoritative over this summary.
