# Building on the Mass AI Atlas

You have a working map of the Massachusetts AI ecosystem — every organization verified by a
person — and everything that keeps it honest. This page is the short version of how it fits together
and where to cut into it.

Deeper reading when you need it: [`CONTRIBUTING.md`](CONTRIBUTING.md) for the data rules,
[`PROJECT_STATE.md`](PROJECT_STATE.md) for the full architecture, [`docs/testing.md`](docs/testing.md)
for the test suite.

## Run it

```bash
npm ci                      # 2 deps: ajv, js-yaml
python3 -m http.server      # then open http://localhost:8000
```

That is the whole setup. **Do not open `index.html` from `file://`** — the page fetches
`data/*.yml`, which browsers block on `file://`. Serve a directory, open the directory URL.

A `404` for `events.json` in the console is expected locally. That file is produced by the
events pipeline at deploy time and is not in git; the page handles its absence.

```bash
node scripts/validate.js    # the data rules
node scripts/lint-copy.js   # no hand-typed organization counts in prose
npm run test:e2e            # the browser suite (needs: npx playwright install chromium)
```

One more step if you made this repository from the template: run

```bash
scripts/setup-labels.sh <owner/repo>     # e.g. scripts/setup-labels.sh you/your-atlas
```

once. Labels do not come with a copy, and GitHub **silently drops** a label an issue form
asks for when it does not exist — so until you run this, suggestions arrive unlabelled and
the suggestion bot never sees them. It is idempotent; running it twice is harmless. The rest
of what to change in your own copy is in [Make it yours](#make-it-yours).

## The shape of it

There is no build step, no framework, no database, no server-side code and no accounts. That
is deliberate, and it is why you can read the whole thing in an afternoon.

When someone opens the page:

1. The browser loads `index.html` — one hand-written file, HTML + CSS + vanilla JS, ~160 KB.
2. It fetches six files from `data/`: three data files and their three JSON Schemas.
3. `atlas-data.js` parses the YAML and validates every file **in the browser**.
4. On failure the page shows a banner. On success the data becomes globals and the app runs.

The same `atlas-data.js` runs in Node (`scripts/load-data.js`), so the data is checked in CI
and again in each visitor's browser. That is what makes it safe to serve raw YAML with no
build artifact in between.

| Piece | What it is |
|---|---|
| `index.html` | the entire application, 1,900 lines |
| `data/entities.yml` | the organizations, plus `categories.yml` (11) and `stages.yml` (5) |
| `data/*.schema.yml` | JSON Schema for each — these are a safety control, not just a type check |
| `atlas-data.js` | the shared loader, used by the page and by every script |
| `scripts/` | validate, exports, link check, freshness rota, the events pipeline |
| `tests/` | about 30 Playwright tests over the four views, deep links, shortlist, events, accessibility |

Map stack: Leaflet 1.9.4 with a MapLibre GL 5.24.0 vector basemap from OpenFreeMap (keyless),
markercluster 1.5.3. All from CDNs — there is nothing to bundle.

## Where to cut into it

**Add a field to an entry.** Three places: `data/entities.schema.yml` (declare it — the schema
sets `additionalProperties: false`, so an undeclared field is rejected), `scripts/validate.js`
if it needs a rule that spans records, and the render path in `index.html`. Escape anything
that reaches HTML.

**Add a view.** The four views are `.view` sections with a `.tab[data-view]` button each. The
tab handler at the top of the app script swaps `active` classes and calls `updateURL()`. Adding
a fifth means a section, a tab, and adding its name to the list in the on-load deep-link block.

**Filter differently.** `offers` is the interesting field: every entry declares 1–6 of
`funding, grants, space, compute, mentorship, community, talent, customers`. That is what powers
"I need…" — filtering by what an organization *gives* rather than what it is called.

**Add a data source.** The events pipeline is the worked example: `events-sources.json` lists
calendars, `scripts/fetch-events.js` pulls and screens them, `scripts/build-events-page.js`
renders a page. None of it needs a headless browser.

**Just consume the data.** If you are building something beside the atlas rather than inside
it, read the published dataset instead of scraping:

- `/ecosystem/atlas.json` — every entry plus the category and stage definitions, in a
  versioned envelope. The `schema` field is bumped on any breaking change, so you can detect one.
- `/ecosystem/atlas.csv` — the same records as 18 columns.
- `/ecosystem/events.json` — AI events in the next 10 days.

## Make it yours

This template is a working copy of a live site, so some of it points back at The Open
Accelerator. Change these before you go far:

- **The workflows that touch TOA infrastructure** — `deploy`, `weekly-events`, `monthly-health`
  and the suggestion bot — are guarded with `if: github.repository == 'holzerjm/mass-ai-atlas'`.
  They will skip in your copy rather than fail. Delete them, or replace the guard with your own
  repo and supply your own secrets. **`validate` is deliberately not guarded** — you want it.
- **`SECURITY.md`** uses relative GitHub links, so its advisory and issue routes already
  point at *your* repo. Two things still need you: replace the TOA fallback contact, and
  enable private vulnerability reporting under **Settings → Code security**, or the
  primary route has nothing behind it.
- **`CODE_OF_CONDUCT.md`** names `conduct@the-open-accelerator.com`. Change it.
- **Run `scripts/setup-labels.sh <owner/repo>` first.** Labels do **not** come with a
  template copy, and GitHub *silently* drops a label an issue form asks for when it does
  not exist — so the suggest and flag forms would quietly arrive unlabelled, and the
  suggestion bot (which only runs on `bot:draft`) would never fire. The script is
  idempotent; run it once after creating your repo.
- **Branding** — the header, footer and logo are TOA's. The `GH_REPO` constant in the app
  script builds the "Suggest an entry" link; point it at your repo.

## The licence matters here

Two different licences:

- **The code is MIT.** Do what you like.
- **The dataset is CC BY 4.0 — attribution required.** If you ship anything built on this
  dataset, credit The Open Accelerator. Suggested: *"Mass AI Atlas, The Open Accelerator —
  the-open-accelerator.com/ecosystem"*. Map data is OpenStreetMap via OpenFreeMap.

If you replace the data with your own, that is your dataset and your call.

## House rules worth keeping

These exist because something went wrong once:

- **Escape everything that reaches HTML.** Text fields reject angle brackets at the schema
  level and the generated pages escape again. Two layers, on purpose.
- **Never type a count into prose.** `scripts/lint-copy.js` fails the build if you do. The
  footer claimed "101 organizations" for months while the atlas listed 171 <!-- lint-copy: ignore -->. Compute it, or
  leave it out.
- **`lastVerified` means a person checked the organization**, not that someone edited the line.
- **No build step.** The moment one appears, the page stops being readable end to end, and
  contribution stops being "edit a YAML file in the browser".

## Things worth building

Starting points, not a prescription:

- Match a founder's stage and needs to the organizations that fit, and explain *why* each.
- Find what is missing: which parts of the state, or which categories, are thinly covered.
- An agent that drafts a new entry from an organization's website, ready for a human to verify.
- Chart how the ecosystem changed, using the `added` and `lastVerified` months.
- Embed a filtered slice of the map somewhere else.
- Something the atlas is not: this is a map. It is not a CRM, a newsletter, or a matchmaker.

## Before you call it done

```bash
node scripts/validate.js && node scripts/lint-copy.js && npm run test:e2e
```

If a browser test fails, re-run it with `--workers=1` before believing it. Every spec renders a
WebGL basemap, and under parallel workers a test can fail for lack of frames rather than a real
defect. Retries are off on purpose so flakes stay visible.

---

*Mass AI Atlas — The Open Accelerator, with Red Hat, the Massachusetts AI Hub, and IBM.
Dataset CC BY 4.0, code MIT.*
