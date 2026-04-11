# Nightly HCAI Benchmark Scraper — Agent Specification

## Overview

Build a Python script + GitHub Actions workflow that scrapes 5 HCAI-relevant
leaderboard sites nightly and commits the results as a JSON file to the
TRI-MAC.github.io repo at `rv/benchmarks-data.json`.

The page `rv/benchmarks.html` in that repo reads this JSON at load time and
renders one card per benchmark with a top-10 leaderboard table.

## Output File

Path: `rv/benchmarks-data.json` in the `TRI-MAC.github.io` repo.

Schema (example):

    {
      "updated": "2026-04-10T03:00:00Z",
      "benchmarks": [
        {
          "name": "ConfidenceBench",
          "description": "Live benchmark for calibrated confidence...",
          "url": "https://confidencebench.com/",
          "columns": ["#", "Model", "Provider", "Score"],
          "rows": [
            ["1", "GPT-5 Standard", "OpenAI", "+406"],
            ["2", "...", "...", "..."]
          ]
        },
        {
          "name": "DesignArena",
          "description": "Crowdsourced live design benchmark...",
          "url": "https://www.designarena.ai/leaderboard",
          "sub_leaderboard": "Data Visualization Arena",
          "columns": ["#", "Model", "Elo Rating"],
          "rows": [["1", "GLM 5.1", "1363"], ["2", "...", "..."]]
        }
      ]
    }

Field notes:

- `updated`: ISO 8601 UTC timestamp of when the scrape ran.
- `sub_leaderboard`: Only present on the DesignArena entry. Records which
  sub-leaderboard was randomly selected that night.
- `rows`: Top 10 entries. Each row is an array of strings matching `columns`.
- `#` column: 1-indexed rank as a string ("1", "2", ...).

## Scrape Targets

All 5 sites are JS-rendered. Use Playwright with headless Chromium.

### 1. ConfidenceBench

- URL: https://confidencebench.com/
- Find the leaderboard table on the page.
- Columns: `["#", "Model", "Provider", "Score"]`
- Extract top 10 rows. Score is a signed integer string like "+406" or "−39".
- Description (static): "Live benchmark for calibrated confidence that penalizes
  overconfident mistakes rather than rewarding accuracy alone."

### 2. EQ-Bench 3

- URL: https://eqbench.com/
- Find the main Elo leaderboard table (the first/primary one on the page).
- Columns: `["#", "Model", "Elo Score"]`
- Extract top 10 rows. Elo score is a decimal string like "1911.8".
- Description (static): "Live emotional-intelligence benchmark built around
  challenging role-plays and analysis tasks that emphasize empathy, social skill,
  insight, and audience/context tailoring."

### 3. EmpathyBench

- URL: https://www.empathybench.com/
- Find the "Model Leaderboard" table.
- Columns: `["#", "Model", "Provider", "Avg Score", "Tier"]`
- Extract top 10 rows. Avg Score is a percentage string like "51.3%".
  Tier is one of: "Excellent", "Good", "Average", "Below Average".
- Description (static): "Live empathy leaderboard that aggregates RMET, EQ, and
  IRI-style evaluations into a single emotional-intelligence ranking."

### 4. AbsenceBench

- URL: https://absencebench.github.io/#leaderboard
- Find the "Full Model Leaderboard" section (JS-rendered table, not the brief
  "Model Performance" summary at the top).
- Columns: `["#", "Model", "Avg Score"]`
- Extract top 10 rows (or all rows if fewer than 10). Avg Score is a decimal
  string like "71.2".
- Description (static): "Live benchmark for detecting missing information and
  absent context, which is directly useful for caveating and \"what's missing?\"
  reasoning."

### 5. DesignArena

- URL: https://www.designarena.ai/leaderboard
- This page has multiple top-level tabs: Code, Image, Video, Audio, More.
- Within each tab there are multiple sub-category leaderboards (e.g. under Code:
  Website, UI Component, Game Dev, Data Visualization, 3D Design, Web App,
  Mobile, Android, Full Stack, SVG).
- **Random selection logic:** Pick a random top-level tab, then pick a random
  sub-category leaderboard from that tab. Record the full name (e.g.
  "Data Visualization Arena") in the `sub_leaderboard` field.
- Columns: `["#", "Model", "Elo Rating"]`
- Extract top 10 rows. Elo rating is an integer string like "1363".
- Description (static): "Crowdsourced live design benchmark where human pairwise
  votes continuously update rankings across UI, web, visualization, and related
  creative/design tasks."

## Resilience

- Before writing, read the existing `rv/benchmarks-data.json` if it exists.
- If scraping a single benchmark fails (timeout, selector not found, network
  error), keep that benchmark's previous data from the existing JSON. Do not
  blank it out or remove it.
- Only update the top-level `"updated"` timestamp. Individual benchmarks do not
  have their own timestamps.
- Log which benchmarks succeeded and which failed.

## Tech Stack

- Python 3.11+
- playwright (async API preferred)
- No other heavy dependencies needed. Use stdlib json for output.
- Install browsers in CI: `playwright install chromium`

## GitHub Actions Workflow

- Cron schedule: `0 3 * * *` (3:00 AM UTC daily)
- Also allow manual trigger: `workflow_dispatch`
- Steps:
  1. Checkout `TRI-MAC.github.io` repo
  2. Set up Python, install dependencies (pip install playwright,
     playwright install chromium)
  3. Run the scraper script
  4. If `rv/benchmarks-data.json` changed, commit and push:

         git config user.name "benchmark-bot"
         git config user.email "benchmark-bot@users.noreply.github.com"
         git add rv/benchmarks-data.json
         git diff --cached --quiet || git commit -m "chore: update benchmark data [skip ci]"
         git push

- The workflow needs write access to the repo. Use the default GITHUB_TOKEN
  with contents: write permission, or a PAT if the scraper lives in a
  different repo and pushes cross-repo.

## Notes

- The descriptions are static strings baked into the scraper (listed above for
  each benchmark). They do not need to be scraped.
- The URLs are static and baked in.
- The page (benchmarks.html) shows a graceful fallback if the JSON fails to
  load — each benchmark shows its name, description, and a "visit site" link
  with no table. So even if the scraper completely breaks, the page still works.
