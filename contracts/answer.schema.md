# Contract 2: `answer()` (chatbot/core → chatbot/app) · FROZEN

Writer: Karthik (`chatbot/core/`). Reader: Bhoomika (`chatbot/app/`).
The signature and output format never change without telling the team. Bhoomika commits changes.

## Signature

```python
from chatbot.core.answer import answer

answer(query: str, mode: str = "after") -> dict   # mode is "before" or "after"
```

- `before`: the original `chatbot/data/atlas.json` only.
- `after`: `atlas.json` plus the links in `LINKS_PATH` (see Contract 1).
  Approved links count as connections. Pending links are shown but count for nothing.
- **Same query, same ranking in both modes.** Only `connections` and `doubts` differ, so
  the toggle shows exactly what the links changed.
- It **never raises** to the app. On any error it returns `results: []` and a short plain
  `not_found` message (e.g. `"Something went wrong: needs review."`).
- It reads `ATLAS_PATH` (default `chatbot/data/atlas.json`) and `LINKS_PATH`. Nothing else.
- Import note: `streamlit run chatbot/app/main.py` doesn't put the repo root on the import path, so
  `main.py` runs `sys.path.insert(0, str(Path(__file__).resolve().parents[2]))` before the import.

## Output

```json
{"query":"pre-seed AI fund for MIT alumni","mode":"after",
 "results":[{"id":"sbxi","name":"SBXi",
             "why":"short reason it fits, from Atlas fields only",
             "atlas_url":"https://the-open-accelerator.com/ecosystem/?entry=sbxi",
             "connections":[{"to_id":"mit-sandbox","relation":"program_of","status":"approved",
                             "source_url":"https://github.com/...#L1893",
                             "quote":"grew out of the MIT Sandbox program.","new":true}],
             "doubts":["approximate pin","last verified 2026-06"]}],
 "not_found":"what we couldn't find in the Atlas, or null"}
```

### Top level

| Field | Type | Notes |
|---|---|---|
| `query` | string | The query exactly as given |
| `mode` | string | `"before"` or `"after"`, echoed |
| `results` | array | Ranked, best first. **May be empty.** At most 8 items |
| `not_found` | string or `null` | What the query asked for that the Atlas doesn't cover, in plain words, plus an alternative when there is one (e.g. `"No wet-lab space is listed in the Atlas. The closest listed spaces are below."`). `null` when everything was covered. **Never null when `results` is empty** |
| `understood` | string or `null` | *Optional.* How we read the question, in plain words (e.g. `"pre-seed funding · for MIT alumni · any MA location"`). This is **our reading, not a fact**, and the app labels it that way. It never names an org. Absent or `null` means don't show it |
| `trust` | object or `null` | *Optional.* Which of the top two results to trust less, and why. See below. Absent or `null` means don't show it |

### `trust` (optional)

```json
{"id":"sbxi","reason":"last verified 2025-11 and no connections, while the other is verified 2026-06 with 3 connections"}
```

| Field | Type | Notes |
|---|---|---|
| `id` | string | Must be `results[0].id` or `results[1].id`. The app ignores `trust` otherwise |
| `reason` | string | One sentence built **only** from the two entries' `doubts` and Atlas fields, never from the model's judgement |

`null` when there are fewer than two results or nothing separates them. Readers that don't
know these two fields can ignore them, so adding them doesn't break anything.

### Result

| Field | Type | Notes |
|---|---|---|
| `id` | string | **Must exist in `atlas.json`.** core checks this in code and drops anything else |
| `name` | string | Copied from `atlas.json`, never from the model |
| `why` | string | One or two sentences, built only from that org's Atlas fields (`desc`, `why`, `tags`, `stages`, `offers`, `facts`, `loc`). `loc` gives place answers their "located in …" wording |
| `atlas_url` | string | `https://the-open-accelerator.com/ecosystem/?entry=<id>`. This is the source for everything in `why` |
| `connections` | array | See below. May be empty |
| `doubts` | array of strings | See below. May be empty |

### `connections`

| Field | Type | Notes |
|---|---|---|
| `to_id` | string | Must exist in `atlas.json` (the app looks up its name there) |
| `relation` | string | From Contract 1. `"listed"` for links already in the Atlas |
| `status` | string | `"atlas"` (already in `links`), `"approved"` or `"pending"`. Never `"rejected"` |
| `source_url` | string | For `atlas` links: the `atlas_url` of this entry. Otherwise copied from Contract 1 |
| `quote` | string or `null` | `null` for `atlas` links. Otherwise the exact quote from Contract 1 |
| `new` | bool | `false` for `atlas`, `true` for `approved` and `pending` |

Order: `atlas` links first, then `approved`, then `pending`. In `before` mode only
`atlas` links appear.

### `doubts`

The six signals, computed **in code** from Atlas fields (never by the model), in this order
and with this exact wording:

| # | Signal | When | String |
|---|---|---|---|
| 1 | Approximate pin | `approx: true` | `"approximate pin"` |
| 2 | Last verified | `lastVerified` is set (always shown, even when recent) | `"last verified YYYY-MM"` |
| 3 | Startup with no stages | `cat == "startup"` and `stages` is missing or empty | `"no stage listed"` |
| 4 | No connections | `links` is missing or empty, **and** (in `after` mode) there is no approved link from this entry | `"no connections"` |
| 5 | Funder with no check size | `offers` includes `"funding"` and no `facts` row is labelled `"Check size"` | `"no check size listed"` |
| 6 | Deadline | `applyBy` is set | `"applications rolling"`, `"apply by YYYY-MM-DD"`, or `"deadline passed YYYY-MM-DD"` when the date is before today |

The app turns these strings into badges. It doesn't reword them or add new ones.
