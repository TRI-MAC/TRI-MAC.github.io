# Requisite Variety

The official research blog for TRI's Human-Centered AI (HCAI) Division. Requisite Variety publishes essays, research briefs, interactive benchmark dashboards, and academic papers exploring how AI is transforming work, decision-making, and human capabilities.

## Tech Stack

- **Frontend**: Static HTML, CSS, vanilla JavaScript (no frameworks)
- **Fonts**: Inter (body), JetBrains Mono (code/metadata), Space Grotesk (logo) via Google Fonts
- **Decorative graphics**: Inline SVG (circuit traces, dot grids, node dots)
- **Content indexing**: Static JSON files (`index.json` per content folder)

## Directory Structure

```
rv/
├── index.html              # Blog homepage
├── nav.js                  # Shared header/footer injection
├── styles.css              # Global styles
├── post.css                # Shared post/paper layout styles
├── post.html               # Post template reference
├── DESIGN.md               # Design language specification
├── SCRAPER_SPEC.md         # Benchmarks scraper specification (scraper lives in a separate repo)
├── about/                  # About page
├── posts/                  # Human-written research essays
│   └── index.json          # Post index (slug, date)
├── ai-posts/               # Auto-generated weekly AI essays
│   └── index.json          # AI post index (slug, date)
├── papers/                 # Academic publications
│   └── index.json          # Paper index (slug, title, authors, venue, abstract, url, date)
└── benchmarks/             # HCAI benchmark leaderboards
    ├── index.html          # Dashboard UI
    └── benchmarks-data.json# Benchmark data (updated by an external service)
```

## Content Types

| Type | Folder | Description |
|------|--------|-------------|
| **Posts** | `posts/` | Human-written essays on cybernetics, HCAI research, and sociotechnical systems |
| **AI Posts** | `ai-posts/` | Weekly auto-generated essays (content updated by an external service) |
| **Papers** | `papers/` | HCAI-affiliated peer-reviewed papers with metadata (authors, venue, abstract) |
| **Benchmarks** | `benchmarks/` | Live leaderboards for 5 HCAI-focused benchmarks (ConfidenceBench, EQ-Bench 3, EmpathyBench, AbsenceBench, DesignArena) |

## External Dependencies

This repo contains only the static served documents. Several content areas are updated by separate services that commit directly to this repo:

- **`benchmarks/benchmarks-data.json`** — Updated nightly by an external scraper (see [SCRAPER_SPEC.md](SCRAPER_SPEC.md) for the data format)
- **`ai-posts/`** — AI-generated essays added by a separate service
- **`/artagent/`** (sibling directory) — Daily AI art pieces managed by a separate service

## Adding Content

Each content type uses a folder-per-item convention with an `index.html` inside:

1. Create a new folder under the appropriate content directory (e.g., `posts/my-new-post/`)
2. Add an `index.html` using the shared post template structure
3. Register the item in the parent folder's `index.json`

Posts and AI posts share the layout defined in `post.css`. Papers include additional metadata in a `paper.json` file.

## Design Language

The visual identity uses cybernetic motifs — circuit traces, node dots, data-flow arrows, and dot-grid backgrounds — to reflect system dynamics and feedback loops. See [DESIGN.md](DESIGN.md) for the full specification.

## Deployment

Static site served via GitHub Pages at [TRI-MAC.github.io](https://TRI-MAC.github.io). No build step required.
