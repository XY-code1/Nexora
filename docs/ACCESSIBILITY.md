# Accessibility & Internationalization Acceptance

> Status: implemented 2026-11-09. See [`PROJECT_STATUS.md`](PROJECT_STATUS.md) for the authoritative capability status.

## 1. Internationalization

- `apps/web/src/i18n.ts` holds the `zh-CN` and `en` resource bundles, a `useT()` hook, a language switcher, locale-aware date formatting (`formatDate`) and localized error text (`localizedError`).
- The language is stored in `localStorage` under `nexora.language` and applies without a reload.
- Dates, navigation, page titles, the token gate, the external-change banner and shared status labels are localized.
- Adding a language means adding one entry to `resources`; missing keys fall back to `zh-CN`.

## 2. Automated accessibility tests

`apps/web/e2e/accessibility.spec.ts` runs with Playwright and `@axe-core/playwright`:

| Test | What it checks |
|---|---|
| axe scan | No `critical` or `serious` violations on the overview |
| keyboard flow | Skip link → main region, every nav item reachable, Enter activates |
| 200% zoom | No horizontal overflow, primary actions reachable |
| language switch | Shell re-renders in `en` and back to `zh-CN` |

Run locally: `npm run e2e -- accessibility.spec.ts` (the Playwright config starts the local API server automatically).

## 3. Keyboard flow audit

- Skip link (`a.skip-link`) is the first focusable element and moves focus to `#main-content`.
- The sidebar drawer traps focus, closes with Escape and returns focus to the menu button.
- The page heading receives focus on navigation; a live region announces the view name.
- All destructive actions (restore, disconnect, shutdown) require an explicit confirmation.

## 4. High contrast

- Honors `prefers-contrast: more` automatically.
- A manual **高对比度** toggle in the top bar adds `html.high-contrast`, which raises border contrast and forces a black background.
- Verified against WCAG 2.1 AA contrast ratios for body text and boundaries.

## 5. 200% zoom

- The e2e test doubles the root zoom and asserts `scrollWidth <= innerWidth` with no clipped primary actions.

## 6. Screen reader acceptance

Manual checklist (assistive technology: NVDA / VoiceOver):

- [ ] The token gate announces its label, hint and error.
- [ ] Navigation items expose their name and current-page state.
- [ ] The external-change banner is a live region and is announced.
- [ ] Definition lists expose row labels.
- [ ] No action is available only through drag or hover.

## 7. Known gaps

- Page-specific deep strings are still mixed Chinese/English; the shell, dates, statuses and errors are localized first.
- `prefers-reduced-motion` is respected by the existing CSS but not covered by an automated test.
