# Requisite Variety — Blog Redesign

## Concept

A modern, clean blog for TRI-MAC that weaves **subtle cybernetic motifs** into every layer of the UI without overwhelming the content. The name "Requisite Variety" references Ashby's Law — the idea that a system's control capacity must match the complexity of what it regulates. The design reflects this: structured yet adaptive, minimal yet rich.

## Brand Anchors (Preserved)

| Element | Detail |
|---------|--------|
| **Logo** | TRI wordmark — retained as-is in the header |
| **Primary green** | `#2d5a4a` (dark teal) |
| **Light green bg** | `#e8f0e4` / `#d4e4cf` |
| **Accent blue** | `#2563eb` |
| **Dark text** | `#1a1a2e` (near-black with cool undertone) |
| **Framing** | Clean card-based layout with generous whitespace |

## Cybernetic Design Language

### Visual motifs
- **Circuit traces** — hairline SVG lines in the background that subtly suggest PCB traces / feedback loops
- **Node dots** — small circular accents at intersections (nav items, section dividers)
- **Data-flow arrows** — decorative `→` glyphs and animated dashes on hover
- **Grid pulse** — faint dot-grid background that recalls graph paper / system diagrams
- **Monospace accents** — dates, tags, and metadata rendered in `JetBrains Mono` for a terminal aesthetic

### Motion
- Subtle fade-up on scroll for post cards
- Circuit-trace lines animate on page load (CSS `stroke-dashoffset`)
- Hover states use a soft glow (`box-shadow` with brand teal at low opacity)

### Typography
- **Headings:** Inter (clean geometric sans)
- **Body:** Inter
- **Code / Meta:** JetBrains Mono

## Layout

```
┌─────────────────────────────────────────────────────┐
│  TRI ◆ REQUISITE VARIETY            [nav] [nav] [◎] │  ← header
├─────────────────────────────────────────────────────┤
│                                                     │
│  ░░░░ hero / featured post ░░░░░░░░░░░░░░░░░░░░░░  │  ← optional hero
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ post card│  │ post card│  │ post card│          │  ← 3-col grid
│  └──────────┘  └──────────┘  └──────────┘          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ post card│  │ post card│  │ post card│          │
│  └──────────┘  └──────────┘  └──────────┘          │
│                                                     │
├─────────────────────────────────────────────────────┤
│  ◆ TRI-MAC · requisite variety · 2026              │  ← footer
└─────────────────────────────────────────────────────┘
```

## Color Tokens

```css
--color-bg:          #f7faf5;     /* warm off-white with green tint */
--color-surface:     #ffffff;
--color-surface-alt: #e8f0e4;
--color-primary:     #2d5a4a;     /* TRI teal */
--color-accent:      #2563eb;     /* blue accent */
--color-text:        #1a1a2e;
--color-text-muted:  #6b7280;
--color-border:      #d4e4cf;
--color-glow:        rgba(45, 90, 74, 0.12);
--color-circuit:     rgba(45, 90, 74, 0.08);
```

## Files

- `index.html` — blog home page (post grid)
- `post.html` — individual post template
- `DESIGN.md` — this file
