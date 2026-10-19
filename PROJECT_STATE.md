# Project State — Mass AI Atlas

**Purpose of this file:** a self-contained handoff so development can continue in
Claude Code (or by any new maintainer) without the original chat history. It captures
what this project is, how it's built, what's been decided, and what's left.

**Last updated:** 2026-08-30; 158 entries. Recent history: FoundersEdge + Milemark via
issues #12/#13; 21 VCs from the MGMT Boston sweep; LabCentral via the suggestion bot's
first run (PR #15); 15 gov/space/student orgs; then the first link-rot sweep fixed 19
URLs and retired three defunct orgs (BUMIC → replaced by BU AI Society; Cogito acquired
by Verint; XLR8 defunct).
Repo: <https://github.com/holzerjm/mass-ai-atlas> · Live: <https://the-open-accelerator.com/ecosystem/>

---

## 1. What this is

An interactive map of Massachusetts' AI ecosystem, aimed at **early-stage founders**
(especially young/first-time founders) who need to find capital, labs, community and
programs. Published by **The Open Accelerator (TOA)** — an initiative of the MA AI Hub,
Red Hat and IBM Ventures.

It began as a better answer to <https://daimlas.com/maaimap/> ("MAAI Map"), a static
list that — despite the name — has no map, no search, no filtering, and no entity
detail. The design brief was: *same domain, far more engaging and useful.*

**Four views**, all client-side over one dataset:

| View | What it does |
|------|--------------|
| 🗺️ **Map** | Leaflet dark-tile map, one pin per org, colour-coded by category; searchable; legend doubles as category toggles |
| ✨ **Galaxy** | Canvas force-directed graph — category hubs plus entity nodes, edges from `links` (170 cited edges across 114 entries as of 2026-10-11). Degree-weighted nodes, hover traces an org's constellation, hub hover lights its category, legend toggles, and a search box that centers + locks any org's neighborhood. Drag/zoom/click |
| 🧭 **Founder Journey** | 5 stages (Spark → Validate → Build → Fund → Scale); each shows curated tips plus every entry whose `stages` includes that number |
| 📇 **Directory** | Card grid, full-text search, category chips, stage filter, sort |

A detail **drawer** is shared by all views: description, "why it matters for founders",
tags, stages, connected entries, website link, "show on map", **places to meet** (cafés,
quick bites and quieter options within ~450 m, read from the basemap's OpenStreetMap
points of interest on demand), and a **🚩 Flag** button.

---

## 2. Architecture & conventions

Deliberately **buildless** — it must survive being copied into a static site and
edited by non-developers.

```
index.html          ~158KB  the entire app: HTML + CSS + vanilla JS in one file
atlas-data.js               shared loader: parses data/*.yml, validates against the schemas
data/entities.yml           DATA — the only file most contributors touch
data/categories.yml         CATS
data/stages.yml             STAGES
data/*.schema.yml           JSON Schema (draft-07) for each data file
```

- **No framework, no bundler.** Serve the folder and `index.html` runs. Node (plus
  `npm ci` for js-yaml and Ajv) is used only for the maintenance scripts.
- At load, `index.html` fetches `data/*.yml` and the schemas, validates them via
  `atlas-data.js` (js-yaml + Ajv from cdnjs), sets the `CATS`/`STAGES`/`DATA` globals,
  then starts the app script (parked as `type="text/plain"` until the data is ready —
  see the comment there for the planned module rewrite). Scripts load the same files
  through `scripts/load-data.js`. **Relative paths matter**: the page must be served at a
  directory URL (`/ecosystem/`), not `/ecosystem`.
- External runtime deps, all CDN: Leaflet 1.9.4 + MapLibre GL 5.24 + maplibre-gl-leaflet
  (map), Tailwind Play CDN, Google Fonts (Red Hat Display), plus the TOA logo hot-linked
  from `the-open-accelerator.com`.
- **Map basemap (since 2026-08-30): OpenFreeMap vector tiles** — keyless, unlimited,
  commercial use permitted — rendered through MapLibre GL via the `maplibre-gl-leaflet`
  binding (Leaflet remains the map engine; markers/popups unchanged). Light mode uses the
  stock `positron` style; dark mode uses **our own `map-style-dark.json`** — OpenFreeMap's
  `fiord` grafted with positron's highway shields, airport label, and river line-labels
  (fiord's palette), so the two themes have label parity; fiord's ferry-route labels are
  kept. The style file deploys alongside `index.html`/`data/` (deploy.yml + sync script
  include it). Sprites/fonts/tiles load from OpenFreeMap; if it ever degrades, VersaTiles
  is a one-line style-URL fallback. The previous CARTO raster tiles (retired-track,
  key-watermarked as of 2026-08-25) are fully removed.
  *Consequence:* opening `index.html` from `file://` shows a broken TOA logo — expected,
  noted in the README.
- **Brand:** dark theme, Red Hat red (`#EE0000` / `#ff5c45`) for primary actions, Red Hat
  Display typeface, TOA logo in the header, Red Hat + MA AI Hub + IBM logos in the footer.
  Per-category accent colours are defined in `CATS` and used consistently across all views.

### Data model (`data/`)

Three data sets, each a YAML file with a JSON Schema beside it: `CATS` in
`categories.yml` (11 categories → label + colour), `STAGES` in `stages.yml` (5 founder
stages with tips), and `DATA` in `entities.yml` (the list of entries, grouped under
`# ---------- CATEGORY ----------` comment banners). One entry:

```yaml
- id: acme-ai
  name: Acme AI Labs
  cat: startup
  loc: 1 Broadway, Cambridge
  lat: 42.3629
  lng: -71.0838
  approx: true
  url: https://acme.ai
  badge: Applications open
  desc: 1–2 factual sentences, max 400 chars.
  why: Why an early-stage founder should care.
  tags: [robotics, warehouse]
  stages: [3, 4]
  links: [csail]
  added: 2026-08
  lastVerified: 2026-08
```

YAML is parsed with js-yaml's `CORE_SCHEMA`, so unquoted dates stay strings. Per-field
rules live in `data/*.schema.yml`; `scripts/validate.js` adds what a schema can't express
(uniqueness, cross-file references, links, dates vs. today, warnings).

`id` kebab-case & unique · `cat` ∈ CATS keys · lat/lng inside MA bounds · `url` https ·
`links` must resolve to real ids (they draw Galaxy edges) · `approx: true` when the pin is
neighbourhood-level · `lastVerified` is the month a maintainer last **actually checked**
the org (validator warns if missing, errors if malformed; drawer shows "✓ Verified …",
entries >12 months old get a stale marker). **Since 2026-08-30 ("decision tool" fields):**
`offers` — 1-6 of a controlled 8-value vocabulary (funding · grants · space · compute ·
mentorship · community · talent · customers) powering the Directory's "I need…" filter;
`applyBy` — `"rolling"` or a `"YYYY-MM-DD"` deadline (past dates auto-hide in the app,
validator warns until cleared/rolled); `applyNote` — short cohort label; `facts` — an
optional 1-6-row [label, value] "at a glance" table (whitelisted labels). Tags are a
canonical ~45-word vocabulary (list in `validate.js`; unknown tags warn-only).
**Since 2026-08-31:** `added` — the month (`"YYYY-MM"`) the entry joined the atlas, set
once and never changed (backfilled for all entries from git first-commit dates; the bot
stamps it automatically). Powers the "✨ New" chips, the once-a-month new-orgs banner,
and the Directory's "Recently added" sort. Validator warns if missing, errors if
malformed or future. Full reference: `CONTRIBUTING.md`; enforced by `data/entities.schema.yml` + `scripts/validate.js`.

**Current composition (197 entries, 2026-10-11):** vc 48 · startup 35 · accel 20 ·
university 19 · corporate 19 · student 13 · space 10 · gov 9 · community 9 · event 8 ·
angel 7.
(Startup bar raised 15 → 28 on 2026-09-01: a 20-candidate research list was independently
verified by a 4-agent workflow — 13 passed, 4 held, 1 skipped for NYC HQ, 2 were dupes.)

### Editorial voice

Descriptions are factual and neutral; the `why` field is the opinionated, founder-useful
part ("Free money — apply every year you're eligible"). Keep that split. Entries are real,
verified organizations — no aspirational or promotional listings.

---

## 3. Contribution system

Community contributions are **GitHub-native** (chosen over forms/serverless: no backend,
transparent moderation, contribution history, on-brand for an open-source accelerator).

- In-app **➕ Suggest an entry** (nav) and **🚩 Flag** (every detail drawer) open prefilled
  GitHub issue forms. `const GH_REPO` in `index.html` controls the target repo —
  currently `holzerjm/mass-ai-atlas`. **Update it if the repo ever moves to a TOA org.**
- `.github/ISSUE_TEMPLATE/suggest-entry.yml` — structured form incl. category dropdown,
  stage checkboxes, spam/affiliation confirmations.
- `.github/ISSUE_TEMPLATE/flag-entry.yml` — reason dropdown + source link; the entry id is
  prefilled by the app.
- The forms apply `new-entry` / `flag` labels. ⚠️ Those labels must exist in the repo —
  GitHub **silently skips** labels that don't (they were missing until 2026-08-28, which
  is why issues #12/#13 arrived unlabelled). If the repo ever moves, recreate them
  (and `bot:draft`, below).
- **Nothing auto-publishes.** A maintainer converts each issue into a `data/entities.yml` edit —
  by hand, or with the suggestion bot.

### Suggestion bot (`.github/workflows/suggest-to-pr.yml` + `scripts/issue-to-entry.js`)

Maintainer adds the **`bot:draft`** label to a suggestion issue → the bot parses the
form, geocodes the address (Nominatim), builds a `yaml.dump`-serialized `data/entities.yml` entry, and
opens a **draft PR** with a review checklist. It never publishes (merge does that).

**Trust model — read before editing this workflow:**
- **Maintainer-gated.** The trigger is `issues: [labeled]` gated on the `bot:draft`
  label, which the form does *not* auto-apply — so untrusted internet input is never
  parsed, geocoded, or handed a token until a human asks. Create the label if the repo
  moves: `gh label create bot:draft`.
- **Two jobs, split on trust.** `draft` (no bot secret, `contents:read`+`issues:write`)
  parses the untrusted issue and uploads an artifact; `publish` (holds the bot token)
  opens the PR from that artifact **without running any issue-derived code**. One parser
  bug can't reach the deploy-capable token.
- **Injection-safe.** Issue text is read from the event file (never `${{ }}`-interpolated
  into `run:`), every value reaches `data/entities.yml` via `yaml.dump`, and the schema
  rejects `<`/`>` in text fields (defence-in-depth with the app's `esc()` render
  escaping). The token pushes via an auth header, not a URL.
- **Token:** a GitHub App (`ATLAS_APP_ID` + `ATLAS_APP_PRIVATE_KEY`, Contents RW + PRs RW)
  — preferred — or a repo-scoped fine-grained PAT (`ATLAS_BOT_PAT`). Must be the bot token,
  not `GITHUB_TOKEN`, so `validate.yml` runs on the bot's PR (GitHub's recursion guard).
- **Applied:** the `Protect main` ruleset (id 24857657) requires the `validate` status
  check and blocks deletion and force-pushes. Requiring a review is still optional and
  not enabled. Nothing automated pushes to `main`, which is what makes this possible.

### CI (`.github/workflows/validate.yml`)

- `validate` job — runs `npm ci` + `scripts/validate.js` on every PR (no path filter, so
  it can be a required check) and on pushes to `main` touching `data/`, `scripts/`,
  `atlas-data.js` or the npm manifests. This is the safety net non-technical maintainers rely on.
- The entry-count shield reads `total` straight from the deployed `atlas.json`; there is no
  badge job and nothing automated pushes to `main`, which is what lets `validate` be a
  required status check.

### Scripts

| Script | Purpose |
|--------|---------|
| `scripts/validate.js` | Schema + integrity validation. Run before every commit. |
| `scripts/load-data.js` | Node side of `atlas-data.js`: `loadData()` returns `{CATS, STAGES, DATA}` (throws on schema errors). Every script loads data through it. |
| `scripts/stale.js` | Freshness report (`lastVerified` older than N months, default 12); `--queue N` prints the monthly verification rota. Never fails; CI appends it to the job summary. |
| `scripts/linkcheck.js` | Link-rot checker — probes every entry URL, classifies broken/moved/blocked. A report, always exits 0. Run monthly by `monthly-health.yml` (with the rota), posted to Slack. |
| `scripts/fetch-events.js` | Builds `events.json` (gitignored) for **/ecosystem/events/** — Boston AI events, next 10 days, from Luma calendar ICS feeds (`events-sources.json`), Luma's discover API (best-effort, undocumented), AI Tinkerers (`llms-full.txt` + JSON-LD, per their agents.md), and `events-manual.json`. Runs Mondays 7am ET via `weekly-events.yml`, started by a cron on the origin server (`scripts/trigger-weekly-events.sh`, fine-grained token on `toa-forge`) because GitHub's scheduler delivered this repo's crons hours late or not at all; GitHub crons remain as Mon/Tue/Wed fallbacks behind a Monday-anchored idempotent gate (a run does the work only if it is past 7am Eastern on the latest Monday and the live `events.json` was not regenerated since; a manual run passes `force=true` to skip it); a sanity check refuses to ship a broken refresh (most sources failed), a Verify step fails the run if the live file does not show it, and a Slack rejection is red, not silent; the workflow then rsyncs the JSON and posts to the Scouts Slack (`SLACK_SCOUTS_WEBHOOK_URL`). The static page `events/index.html` deploys with the atlas; suggestions arrive via `suggest-event.yml` (label `event-suggestion`). Builds on nkpng2k/startup-event-scraper (Apache-2.0, credited). Full maintainer guide: `docs/events-guide.md`. |
| `scripts/build-events-page.js` | Assembles `events/index.html` (a **generated file** — never hand-edit it) by lifting the TOA header/mobile-nav/footer/theme-toggle chrome verbatim from the atlas's `index.html` and wrapping it around the events page content. Re-run after changing either the shared chrome or the events layout. |
| `scripts/export-csv.js` | Dataset → `atlas.csv` for Sheets/Excel. Output is gitignored. |
| `scripts/export-json.js` | Dataset → `atlas.json` (versioned envelope). Both exports regenerate at deploy and are served publicly at `/ecosystem/atlas.{json,csv}` under **CC BY 4.0**. |
| `scripts/sync-to-site.sh` | Copies `index.html` + `atlas-data.js` + `data/*.yml` into the TOA site tree. |

---

## 4. Deployment

**Automatic since 2026-08-29** — merging to `main` is publishing.
`.github/workflows/deploy.yml` fires on pushes touching `index.html`/`atlas-data.js`/`data/`
(plus manual `workflow_dispatch` runs): it re-validates `data/`, rsyncs the page, loader
and data files to the origin server, and posts a summary (new/updated entry names, count, links) to
the TOA Slack — or a failure alert; a failed deploy leaves the live site unchanged.

Plumbing (all in repo secrets, Settings → Secrets → Actions): `DEPLOY_SSH_KEY` is a
dedicated ed25519 key whose `authorized_keys` line on the server is
**rrsync-restricted** to writing the ecosystem docroot only; `DEPLOY_HOST` is the
**origin IP** (the domain resolves to Cloudflare's proxy, which won't pass SSH);
`DEPLOY_USER`; `DEPLOY_PATH` is `/` (paths are relative to the rrsync root);
`SLACK_WEBHOOK_URL` is optional — notifications skip silently without it and are
`continue-on-error`, so Slack can never break a deploy.

Manual fallback: `./scripts/sync-to-site.sh <dest>` from a local checkout with SSH
access. The atlas is **not** on GitHub Pages.

**The site-wide deploy must never touch `/ecosystem/`.** The rest of
the-open-accelerator.com deploys separately via Eleventy from
`~/notes/OpenAccelerator/TOAsite` (`npm run deploy` → rsync `_site/` to the docroot,
sometimes with `--delete`). On 2026-08-31 a stale June snapshot in that tree
(`src/ecosystem/`) overwrote a fresh atlas deploy (CARTO-era `index.html`, 121-entry
`data.js`); a `--delete` run would have wiped the whole server dir. Guarded since then
by two lines there: `eleventyConfig.ignores.add("src/ecosystem/**")` in
`eleventy.config.js` (the folder never reaches `_site`) and `/ecosystem/` in
`.rsync-exclude` (never shipped, and protected from `--delete`). If the atlas ever
regresses on the live site right after a TOA site publish, check those guards first —
recovery is one manual `workflow_dispatch` of `deploy.yml`.

`index.html` carries `<link rel="canonical">` and `og:url` pointing at
`https://the-open-accelerator.com/ecosystem/`, so that URL stays canonical even if a
GitHub Pages copy exists.

---

## 5. Documentation map

| File | Audience |
|------|----------|
| `README.md` | Everyone — what it is, run, deploy, contribute, CSV export |
| `CONTRIBUTING.md` | Contributors — entry schema, what's accepted/removed, review process |
| `MAINTAINING.md` | **Maintainers — the full triage playbook**: issue → entry, PR review, publish, field cheat-sheets, flag handling, CI error decoder. Written for people who don't use Git daily; nearly all of it is point-and-click on github.com |
| `docs/add-an-entry-walkthrough.md` | The friendly 10-minute hand-to-anyone version of the above |
| `PROJECT_STATE.md` | This file — handoff/context |

---

## 6. Status & known gaps

**Done:** four views · 197 verified entries · TOA branding · GitHub contribution loop ·
CI validation + live count shield · `validate` as a required status check on `main` ·
auto-deploy on merge + Slack notifications · suggestion bot
(issue → draft PR) · maintainer docs · CSV export · `lastVerified` freshness field + stale
report · shareable deep links (`?entry=` / `#view`) · HTML-escaped rendering · MIT licence ·
OpenFreeMap vector basemap (repo-owned dark style) · guided tour · Galaxy search + focus ·
monthly health rails (link-check + verification rota → Slack) · events page (`/events/`,
weekly Luma/AI-Tinkerers fetch) · founder stickiness: ★ shortlist (localStorage +
`?list=` share links + print), ⚖ compare (up to 3 funders side-by-side), ✨ new-this-month
(banner, chips, "Recently added" sort), 🎟 event ribbons on cards/drawer via `events.json` ·
live at `/ecosystem/`.

**Open items / ideas, roughly by value:**

1. **Accessibility pass** — keyboard navigation for the Galaxy canvas, focus states,
   `prefers-reduced-motion` for the animated views, contrast audit.
2. **Mobile polish** — the Galaxy view is cramped on small screens.
3. **Self-hosted assets** — vendoring Leaflet/Tailwind/fonts/logo would remove CDN
   dependence and fix the `file://` experience. (Beyond the TOA logo, the favicon and
   `og:image` are also hot-linked — from the-open-accelerator.com and people.redhat.com.)
4. **Tailwind Play CDN** prints a console warning about production use; if it ever
   matters, precompile or drop it (most styling is hand-written CSS anyway).

*(Resolved 2026-08-28: README/CONTRIBUTING described a GitHub Pages deploy path that was
never how this ships — both now describe the real sync-to-site flow. `lastVerified`
freshness field + `scripts/stale.js` report shipped, all 123 entries backfilled from git
add-dates. Deep links `?entry=<id>` / `#<view>` + a drawer "Copy link" button shipped.
Resolved 2026-08-29: category balance — gov 9 · space 8 · student 13 after the verified
thin-category sourcing pass; `vc` (49) is heavy by design, tracking the real market.)*

**Deliberate non-goals:** no backend/database, no build step, no auto-publishing of
community submissions, no user accounts.

---

## 7. Working here in Claude Code

- Repo root is the working directory; `main` is the only long-lived branch.
- **Always run `node scripts/validate.js` after touching `data/`** — same check CI runs
  (`npm ci` once first).
- The entry-count shield reads `total` from the deployed `atlas.json`, so it follows a deploy on its own,
  or just let CI do it on merge.
- Commit messages that close a suggestion should say `closes #NN` — it auto-closes the
  issue and links the commit for the contributor.
- To test the whole app quickly: `python3 -m http.server` and open `localhost:8000`.
  (The page fetches `data/*.yml`, which browsers block on `file://`.)
- When adding entries in bulk, keep them inside the correct `# ---------- CATEGORY ----------`
  banner in `data/entities.yml` — order within a section doesn't matter, but the banners are how
  humans navigate the file.
