# Sector Shift

**A daily 15-minute read on which sectors are gaining and losing.**

Every day at 04:00 UTC the tape — market news plus fresh research — is scored, tagged with *who gains* and *who loses*, and rolled up into one number: the **net shift**. The dashboard is built to be read in about 15 minutes: a briefing, the movers, the pulse chart, the tone, and the stories behind them.

→ **[Live dashboard](https://muxd22-alt.github.io/SectorShift/)**

---

## What it actually measures

SectorShift is not a news aggregator. It is a daily measurement of **sector rotation in the information stream**:

1. Each item (news story or paper) is read once by a free model and marked up with:
   - **benefiting entities** and **disrupted entities** (sectors *and* companies)
   - an **impact / breakthrough score** (1–10, with a published rubric — thin stories stay thin)
   - a **one-line hook**, sentiment, tickers, tags, and a concrete *what happens next*
2. For any day:

   ```
   net shift (day) = Σ benefiting mentions − Σ disrupting mentions
   ```

3. That series runs back 90 days and drives everything: the dial, the movers table, the chart, the streak.
4. Supporting numbers: **7-day average**, **up-streak** (consecutive days net > 0), **stories/7d**, **bullish tone %** (positive vs. negative news in the last 7 days).

Nothing here is investment advice — it is a measurement of what the information tape is doing, made readable.

---

## The 15-minute read

| Section | What you get | ~Time |
|---|---|---|
| **Today's briefing** | Headline, 3–5 bullets, what to watch — written from today's tape | 2 min |
| **Shift dial** | Net shift today vs. 7-day average, streak, tone | 1 min |
| **Sector movers** | Sectors and companies ranked by net mentions (Today / 7 days / 30 days) — click to filter | 3 min |
| **Shift index chart** | 90 days of daily net shift with a 7-day average line | 2 min |
| **Market tone** | Positive / neutral / negative split of the last 7 days of news | 1 min |
| **Research corner** | Highest-scoring papers that could move a sector before the market notices | 3 min |
| **The read** | Every item on the tape, hardest-hitting first, with filters | 3 min |

---

## Architecture

```
arXiv ─────────────┐
Yahoo Finance RSS ─┼─► fetch_*.py ─► free LLM markup ─► Turso (libSQL)
MarketWatch RSS ───┘        │                                │
CNBC RSS ───────────────────┘                                ▼
                                        export_data.py (history + stats)
                                                    │
                                        build_digest.py (daily briefing)
                                                    ▼
                                             public/data.json
                                                    ▼
                                        GitHub Pages dashboard (PWA)
```

- **.github/workflows/daily_update.yml** — cron `0 4 * * *` (04:00 UTC): setup DB → fetch & analyze → export → build briefing → commit `data.json` → deploy Pages.
- **public/** — static site. No build step, no framework, no CDN dependencies. Works offline via the service worker.

## Models: free tier only — $0/day

Analysis runs exclusively on free OpenRouter models. If one is rate-limited, out of credit, slow, or returns malformed JSON, the next model in the chain is tried automatically, so the daily job never blocks on a single provider:

1. `nvidia/nemotron-3-super-120b-a12b:free`
2. `google/gemma-4-31b-it:free`
3. `thinkingmachines/inkling:free`
4. `nvidia/nemotron-3.5-lightning:free`

Override the chain with the `OPENROUTER_MODELS` environment variable (comma-separated).

Prompts enforce a strict JSON schema, a published scoring rubric, an 18-word hook, and a banned-filler list — the goal is a specific, skeptical desk note, not generic AI copy.

---

## Repository layout

```
├── .github/workflows/daily_update.yml   # daily measure → export → brief → deploy
├── public/                              # the site (served by GitHub Pages)
│   ├── index.html  app.js  style.css    # Apple-style dashboard
│   ├── data.json                        # generated daily: history, stats, digest, items
│   ├── manifest.json  sw.js  icon.svg   # installable PWA (network-first)
├── scripts/
│   ├── llm.py                           # free-model chain, JSON extraction, retries
│   ├── metrics.py                       # pure measurement functions (rollup, stats)
│   ├── setup_db.py                      # Turso schema + Hook column migration
│   ├── fetch_arxiv.py                   # papers → markup → Turso
│   ├── fetch_yahoo.py                   # news (4 feeds) → markup → Turso
│   ├── export_data.py                   # rows → data.json (90-day history + stats)
│   └── build_digest.py                  # daily briefing (deterministic fallback)
└── requirements.txt
```

---

## Data contract (`public/data.json`)

```jsonc
{
  "generated_at": "2026-10-05T04:07:12+00:00",
  "stats": {
    "date": "2026-10-05",
    "items_today": 14, "net_today": 6, "net_yesterday": 3,
    "net_7d_avg": 5.1, "streak": 3,
    "bull_pct": 62, "bear_pct": 23,
    "top_gain": { "name": "Artificial Intelligence", "net": 19 },
    "top_fall": { "name": "Traditional Software Development", "net": -5 }
  },
  "history": [ { "date": "2026-07-08", "ben": 12, "dis": 5, "net": 7, "items": 9, "bull": 5, "bear": 2, "neutral": 2 } ],
  "digest": { "headline": "…", "bullets": ["…"], "movers": [...], "watch": "…", "model": "…" },
  "papers": [ … ], "news": [ … ]
}
```

The frontend degrades gracefully at every level: no `digest` → deterministic hero from top-scored items; no `history` → chart hidden; empty today → the read anchors to the last day that had tape.

---

## Local development

```bash
# serve the dashboard (data.json is committed, so this just works)
python -m http.server 8000 --directory public     # → http://localhost:8000

# rebuild history/stats from an existing data.json (offline, no DB)
python -c "import json,sys; sys.path.insert(0,'scripts'); from metrics import rollup; \
d=json.load(open('public/data.json',encoding='utf-8')); h,s=rollup(d.get('papers',[]),d.get('news',[])); \
d['history'],d['stats']=h,s; json.dump(d,open('public/data.json','w',encoding='utf-8'),separators=(',',':'))"

# rebuild the briefing offline (falls back to the deterministic digest
# when OPENROUTER_API_KEY is unset)
python scripts/build_digest.py
```

Pipeline dependencies: `pip install -r requirements.txt`.

## GitHub setup

Secrets required by the workflow:

| Secret | Purpose |
|---|---|
| `TURSO_DATABASE_URL` | libSQL database URL |
| `TURSO_AUTH_TOKEN` | libSQL auth token |
| `OPENROUTER_API_KEY` | free-tier key used for analysis (spend stays $0) |

Then: **Settings → Pages → Source: GitHub Actions**. The `Daily SectorShift Update` workflow runs on cron and via *Run workflow*, commits the generated `data.json`, and deploys the site.

First run creates the schema (`scripts/setup_db.py`), so no manual migration is needed.

---

## Principles

- **A measurement, not a feed.** Every screen traces back to net shift.
- **Free models, deterministic fallbacks.** If the LLM is down, the product still ships a readable briefing.
- **No framework, no build, no trackers.** One HTML, one CSS, one JS file, one JSON.
- **Honest quiet days.** Empty days render as empty — the chart shows the flat line instead of inventing heat.
