# NEXORA Logo Specification

## Logo construction

The NEXORA **Intelligence Core** is built on a `128 × 128` SVG coordinate system:

```text
0,0 ┌──────────────────────────────┐ 128,0
    │      orbit envelope          │
    │  node   ┌─ core ─┐   node   │
    │         │  inner  │          │
    │         │  prism  │          │
0,128└──────────────────────────────┘128,128
```

- Outer core vertices: `(64,25) (93,42) (93,85) (64,103) (35,85) (35,42)`.
- Inner prism vertices: top/bottom axis centered at `x=64`, with a `26 × 35` visual envelope.
- Primary orbit: ellipse centered at `(64,64)`, radii `51 × 24`, rotated `-18°`.
- Secondary orbit: asymmetric closed curve crossing behind the core.
- Nodes: 10 px circles centered at `(15,69)` and `(109,42)`.
- Full lockup: `520 × 128`; symbol occupies the first `128 × 128`, wordmark starts at `x=148`.

The geometry remains recognizable without glow or filters. The central prism represents user-owned intelligence; the orbits represent explicit, reversible connections.

## Proportions

Let `C` be the symbol width. The full horizontal lockup is approximately `4.06C × C`. The recommended wordmark cap height is `0.43C`. Never alter the relative symbol/wordmark scale in the supplied lockup.

## Clear space

Minimum clear space is `0.16C` on every side of the symbol or full lockup. For the 128-unit symbol this equals 20 units. No text, border, crop or unrelated icon may enter this area.

## Minimum size

| Asset | Screen minimum | Print minimum |
|---|---:|---:|
| Full lockup | 180 px wide | 38 mm wide |
| Symbol | 32 px | 8 mm |
| Favicon | 16 px | not recommended |

At 16–24 px, use `favicon.svg`; do not scale the detailed symbol down as a substitute.

## Color specification

- Core/orbit primary: Electric Cyan `#12D9F5`.
- Core/orbit secondary: Neon Violet `#906BFF`.
- Inner highlight: Ice White `#EAF3FF`.
- Internal negative field: Deep Space `#07111F`.
- Secondary lockup line: Slate `#8499B4`.

Gradients interpolate only between approved brand colors. They are supportive, not essential to silhouette recognition.

## Dark background

Use the primary assets on Deep Space, Midnight Navy or similarly quiet dark surfaces. Maintain the supplied internal Deep Space core and Ice White wordmark.

## Light background

The primary lockup includes a restrained Deep Space keyline around its Ice White wordmark for cross-background legibility. On very light or monochrome editorial surfaces, prefer the monochrome symbol in Deep Space.

## Monochrome

`nexora-symbol-mono.svg` uses `currentColor` and defaults to Ice White. When the SVG is inlined, set CSS `color` to Ice White on dark backgrounds or Deep Space on light backgrounds. Do not add a second color.

```html
<span style="color:#07111F">
  <img src="/brand/nexora-symbol-mono.svg" alt="NEXORA">
</span>
```

For inline SVG usage, inherit `currentColor` from the container. An SVG loaded through `<img>` uses the document default color; use CSS masking or inline markup when color inheritance is required.

## Incorrect usage

- Do not rotate or skew the core or orbit system.
- Do not change the orbit/node count.
- Do not place effects that obscure the geometry.
- Do not use cyan/violet on insufficiently contrasting backgrounds.
- Do not recolor individual faces outside the approved palette.
- Do not replace the NEXORA wordmark with an unrelated typeface treatment.
- Do not put third-party marks inside the orbit.
- Do not crop through nodes or the core.

## Asset map

```text
apps/web/public/brand/
├── nexora-logo.svg          # 520 × 128 full lockup
├── nexora-symbol.svg        # 128 × 128 primary symbol
├── nexora-symbol-mono.svg   # 128 × 128 currentColor symbol
└── favicon.svg              # 64 × 64 simplified mark
```
