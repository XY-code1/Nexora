# NEXORA Brand Asset Catalog

## Production assets

| Asset | Format / viewBox | Intended use | Notes |
|---|---|---|---|
| `apps/web/public/brand/nexora-logo.svg` | SVG / `0 0 520 128` | documentation headers, repository social compositions, wide product placements | symbol + NEXORA wordmark |
| `apps/web/public/brand/nexora-symbol.svg` | SVG / `0 0 128 128` | app chrome, project avatar, square placements | primary color mark |
| `apps/web/public/brand/nexora-symbol-mono.svg` | SVG / `0 0 128 128` | one-color print, badges and constrained surfaces | uses `currentColor` when inline |
| `apps/web/public/brand/favicon.svg` | SVG / `0 0 64 64` | browser favicon and 16–64 px contexts | simplified core, no orbital detail |
| `apps/web/public/brand/preview.html` | standalone HTML | design review and visual QA | not linked from product navigation |

All SVG assets are original, transparent-background vectors. They contain no embedded raster image, Base64 payload, external URL, script or required filter.

## Brand color primitives

```css
--brand-deep-space: #07111f;
--brand-midnight-navy: #0c1728;
--brand-panel-blue: #13243a;
--brand-electric-cyan: #12d9f5;
--brand-neon-violet: #906bff;
--brand-signal-green: #30d6a0;
--brand-ice-white: #eaf3ff;
--brand-slate: #8499b4;
```

These primitives coexist with the application's established semantic tokens (`--bg-primary`, `--color-primary`, `--text-primary`, etc.). B1 does **not** remap existing semantic tokens, preventing unintended visual changes. A future B2 migration may deliberately map semantic roles after page-level visual acceptance.

## Typography tokens

```css
--font-display: "Space Grotesk", Inter, "Noto Sans SC", system-ui, sans-serif;
--font-body: Inter, "Noto Sans SC", "Segoe UI Variable", system-ui, sans-serif;
--font-mono: "JetBrains Mono", "Cascadia Code", ui-monospace, monospace;
```

The project does not fetch fonts from a CDN. Consumers may self-host approved font files or use the listed fallbacks.

## File use examples

```html
<img src="/brand/nexora-logo.svg" alt="NEXORA">
<img src="/brand/nexora-symbol.svg" alt="" aria-hidden="true">
<link rel="icon" type="image/svg+xml" href="/brand/favicon.svg">
```

Decorative repetitions use empty alternative text. A standalone brand mark uses `alt="NEXORA"`.

## Change control

- Preserve SVG viewBoxes and geometry when optimizing assets.
- Do not convert SVGs to Base64 in product code.
- Add new assets to this catalog and document their intended context.
- Brand changes must not alter Core, API, MCP, Vault or permission behavior.
