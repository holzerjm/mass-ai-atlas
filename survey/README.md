# Survey: missing connections (Track A)

Many Atlas entries show no connections, so the map hides that a program grew out of another
org, or that a fund backs a startup. This pipeline finds those connections on the orgs' own
public pages, proves each one with the exact sentence, and lets a human approve it before
anything touches the data.

**Probe 2, entries with no links: `104` → `100`** (no links in either direction: `74` → `69`).
Approved links are written only on the `proposals` branch, where `node scripts/validate.js` passes
(`out/validator-output.txt`).

## How it works

| Step | Command | What it does |
|---|---|---|
| Before | `node survey/probes.js` | Counts entries with no links. Writes `out/probes.json` |
| Fetch | `node survey/fetch.js` | Downloads the homepage of every entry with no links: honest user agent, robots.txt, 1 request per second per site, cached, no headless browser |
| Match | `node survey/match.js` | Finds other Atlas entries named on each page. Keeps the exact sentence, labels the relation, scores confidence, skips pairs already linked |
| Review | `node survey/review.js` | The human gate: approve, reject, skip, or open the page |
| Apply | `node survey/apply.js ../mass-ai-atlas-proposals` | Writes only approved links, only on the `proposals` branch, only the `links` line |
| After | `node survey/probes.js` | Before/after, plus calibration |

No AI anywhere in the pipeline: the same pages give the same proposals every time.

## Output (`out/`)

- `proposed-links.json`: Contract 1, read by the chatbot. 7 approved, 13 rejected, 2 pending.
- `refusals.json`: links refused automatically, with no quote kept, so no names are stored.
- `probes.json`: before/after and calibration.
- `sources.json`: every host contacted (the declared sources).

## What it refuses

- **Sentences about people** (bios, speaker cards, "former VP of…"). Refused automatically, 23 of them. The pipeline is about organizations, not people.
- **Indirect links**: for example, "Akooda is backed by Founder Collective" on Two Lanterns' site is about a third company. Rejected in review.
- **Bare mentions**: a news blurb that names a company is scored low. No low-confidence link was approved.
- **A global company standing in for its local office**: "NVIDIA" alone is capped below high for the NVIDIA (Westford) entry.
- **Blocked sites**: LinkedIn, Meetup and social networks are never fetched.

## Calibration (human decisions per confidence level)

| Confidence | Approved / decided |
|---|---|
| high | 6 / 11 |
| medium | 1 / 3 |
| low | 0 / 6 |

## Limits and next steps

Homepages only for now. A few sites block automated requests, and a few render with JavaScript
and give no text. Next: read About, Portfolio and Partners pages, and the pages of
already-connected orgs that name isolated ones.

*Data: Mass AI Atlas, The Open Accelerator — the-open-accelerator.com/ecosystem (CC BY 4.0). Sources: the organizations' own public websites, listed in `out/sources.json`.*
