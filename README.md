# Mass AI Atlas

[![Validate atlas data](https://github.com/holzerjm/mass-ai-atlas/actions/workflows/validate.yml/badge.svg)](https://github.com/holzerjm/mass-ai-atlas/actions/workflows/validate.yml)
[![Organizations](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fthe-open-accelerator.com%2Fecosystem%2Fatlas.json&query=%24.total&label=organizations&color=60a5fa)](data/entities.yml)
[![Live site](https://img.shields.io/badge/live-the--open--accelerator.com%2Fecosystem-EE0000)](https://the-open-accelerator.com/ecosystem/)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-4ade80)](CONTRIBUTING.md)
[![The Open Accelerator](https://img.shields.io/badge/by-The%20Open%20Accelerator-EE0000)](https://the-open-accelerator.com)

The living map of Massachusetts' AI ecosystem — built by the community for the community and founders, presented by
[The Open Accelerator](https://the-open-accelerator.com) (an initiative between the
MA AI Hub, Red Hat & IBM).

[![A 19-second tour: searching the Map over the Boston area, an entry's drawer with the places to meet nearby, the whole-Commonwealth view, the Galaxy of connections, the Founder Journey, and the Directory filtered to equity-free money](docs/demo.gif)](https://the-open-accelerator.com/ecosystem/)

**Four ways to explore the Massachusetts AI ecosystem:**

- 🗺️ **Map** — every VC, lab, accelerator and community pinned across Massachusetts
- ✨ **Galaxy** — an animated network of how the ecosystem connects (spinouts, funds, hosts)
- 🧭 **Founder Journey** — resources curated by stage, from first spark to scale
- 📇 **Directory** — full-text search with category and stage filters

Each entry's drawer says what the organization offers founders, shows when a maintainer
last verified it, and under **places to meet** lists the cafés, quick bites and quieter
spots within a five-minute walk.
Every entry and view is linkable — `?entry=csail` opens straight to an organization,
`#galaxy` to a view (there's a 🔗 Copy link button in each entry's drawer).

> **Building on this as a template?** Start with [HACKATHON.md](HACKATHON.md): setup, the
> architecture on one page, where to extend it, and what to change because it is still
> pointed at The Open Accelerator.

## Run it

It's a static site — no build step.

The hosted live page is at https://the-open-accelerator.com/ecosystem/

```bash
# locally
python3 -m http.server     # then open http://localhost:8000
```

Opening `index.html` straight from `file://` doesn't work: the page fetches its data
from `data/*.yml`, which browsers block on `file://`. Use the local server above.

The maintenance scripts (`scripts/`) need Node 20+ and the two npm dependencies
(js-yaml, Ajv): run `npm ci` once.

## Deploy

**Merging is publishing.** A GitHub Action deploys `index.html`, `atlas-data.js`,
`data/` and the map style to [the live site](https://the-open-accelerator.com/ecosystem/) on every
merge to `main` that touches them — it re-validates the data first, then rsyncs to
the server and posts a summary to the TOA Slack. (Not GitHub Pages.)

Manual fallback, from a checkout with SSH access to the server:

```bash
./scripts/sync-to-site.sh <destination>
```

The page must be served at a directory URL (`…/ecosystem/`, trailing slash) so the
relative `data/` fetches resolve.

**If the repo ever moves (or you host your own copy):** set `GH_REPO` in
`index.html` (search for `const GH_REPO`) to your `org/repo` so the in-app
**Suggest** and **Flag** buttons point at the right issue forms.

## Contribute

The atlas is community-maintained:

- **➕ Suggest an entry** — [open a suggestion](../../issues/new?template=suggest-entry.yml)
  or edit [`data/entities.yml`](data/entities.yml) and send a PR
- **🚩 Flag an entry** — [report something outdated or miscategorized](../../issues/new?template=flag-entry.yml)
  (or use the Flag button on any entry inside the atlas)

See [CONTRIBUTING.md](CONTRIBUTING.md) for the entry schema and review process.
Every PR is automatically validated by CI, and a maintainer can
hand your suggestion to the **atlas bot**, which drafts it as a pull request
(geocoded and validated) for human review — nothing publishes without a maintainer
merge.

**Maintainers** turn accepted issues and PRs into entries — see
[MAINTAINING.md](MAINTAINING.md) for the step-by-step process.

## Repo layout

```
index.html                        the app — one file of HTML/CSS/vanilla JS (Leaflet +
                                  MapLibre GL, Tailwind & web fonts via CDN; TOA-branded)
data/entities.yml                 the dataset — this is what you edit
data/categories.yml, stages.yml   the categories and founder stages
data/*.schema.yml                 JSON Schemas for the three data files
atlas-data.js                     shared loader: parses data/*.yml + validates against
                                  the schemas (used by index.html and scripts/)
package.json                      npm deps for the scripts (js-yaml, Ajv) — `npm ci`
map-style-dark.json               the dark basemap style (OpenFreeMap fiord + our grafts)
scripts/validate.js               schema + integrity validation (runs in CI and locally)
scripts/load-data.js              Node wrapper around atlas-data.js — scripts load data via this
test/data-refactor-equivalence.test.js  one-time check that data/ matches the old data.js
scripts/stale.js                  freshness report — entries longest unverified
scripts/export-csv.js             export the dataset to a spreadsheet-friendly CSV
scripts/issue-to-entry.js         the suggestion bot's form parser / entry builder
scripts/fetch-events.js           events aggregator — feeds /ecosystem/events/ weekly
scripts/build-events-page.js      assembles events/index.html (generated — see docs/)
scripts/trigger-weekly-events.sh  server-side cron that starts the weekly refresh (GitHub cron is late)
scripts/sync-to-site.sh           manual deploy fallback (CI normally deploys on merge)
.github/ISSUE_TEMPLATE/           suggest & flag forms
.github/workflows/validate.yml    CI validation + freshness summary on every data PR
.github/workflows/deploy.yml      auto-deploy to the live site + Slack notification
.github/workflows/suggest-to-pr.yml  the suggestion bot (maintainer-gated, drafts PRs)
.github/workflows/weekly-events.yml  Monday 7am ET events refresh + Slack post
docs/events-guide.md              how the events page & weekly refresh work
CONTRIBUTING.md                   entry schema & contributor workflow
MAINTAINING.md                    maintainer guide — turn issues & PRs into data/entities.yml
PROJECT_STATE.md                  architecture, decisions & backlog (start here if new)
```

## The data

The atlas is also an **open dataset** — the only maintained, human-verified dataset of
Massachusetts' AI ecosystem. Two machine-readable endpoints regenerate on every
deploy:

- **JSON** — <https://the-open-accelerator.com/ecosystem/atlas.json> — a versioned
  envelope (`schema: 1`) with all entries, categories, stages and per-category counts
- **CSV** — <https://the-open-accelerator.com/ecosystem/atlas.csv> — one row per
  organization, ready for Google Sheets (*File → Import*) or Excel (*Data → From
  Text/CSV*)

Columns/fields include name, category, location, lat/lng, website, description, tags,
founder stages and the month a maintainer last verified the entry.

To regenerate locally: `node scripts/export-json.js` and `node scripts/export-csv.js`.

**Methodology:** every entry is checked by a human against the organization's own
website plus an independent source before it ships, and re-verified on a rolling
basis (`lastVerified` records the month; entries more than a year unverified are
flagged in the app). Defunct or unverifiable organizations are removed.

**License:** the dataset is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — free to use, share and
adapt with attribution to **The Open Accelerator**. Suggested citation:
*"Mass AI Atlas, The Open Accelerator — the-open-accelerator.com/ecosystem"*.

Some pin locations are approximate (neighborhood-level) and community groups move
between venues — check official sites before visiting. Curated since June 2026.

© 2026 The Open Accelerator.
