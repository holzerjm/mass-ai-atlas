# Testing — the smoke suite and the post-deploy check

Two safety nets, both added in v2.0 Part A (2026-09-30):

1. **A Playwright + axe smoke suite** (`tests/`) that loads the real page in
   Chromium and checks the things founders rely on: shared links land where they
   point, every view shows, the counts are real, nothing throws, and there are
   no critical accessibility failures. It runs in CI on every PR that touches
   the page, the data, the scripts or the tests.
2. **A post-deploy check** (`tests/deploy/verify-live.js`) that runs at the end
   of every deploy and confirms the live site is serving exactly the files that
   were deployed.

The atlas itself is still buildless: `index.html` + `data/*.yml` open in a browser
with no npm step. `package.json` exists only for this tooling — nothing in it
is deployed, and nobody editing `data/entities.yml` needs to install anything.

---

> **A note on workers.** Every spec renders a WebGL basemap and the Galaxy canvas, so
> the suite is sensitive to how many browsers run at once. The config uses 4 locally
> and 2 in CI. On a machine with less GPU headroom those still contend and a spec can
> fail for lack of frames rather than a real defect — `axe: galaxy view` is the usual
> casualty. If a run fails where a serial run passes, re-run with `--workers=1` before
> believing it. Retries are deliberately off locally so flakes stay visible.

## Running the suite locally

You need Node 20+ and Python 3 (the tests serve the repo with
`python3 -m http.server`, the same way you would by hand).

```sh
npm ci                              # once: installs Playwright + axe (dev only)
npx playwright install chromium     # once: the browser the tests drive
npm run test:e2e                    # the whole suite, ~25 s
```

Useful variations:

```sh
npx playwright test tests/shortlist.spec.js   # one file
npx playwright test -g "#galaxy"              # tests whose title matches
npx playwright test --headed                  # watch it drive a real window
npx playwright test --ui                      # step through, with DOM snapshots
npx playwright show-report                    # the HTML report of the last run
```

The suite starts its own server on port **8101** (set `ATLAS_PORT` to change it)
and stops it afterwards. It refuses to reuse a server already on that port, so a
leftover one serving some other folder can't quietly be tested instead.

**Testing a different tree.** `ATLAS_ROOT` serves another directory with the
same tests. The main use is telling "my change broke it" from "the test is
wrong" — run the suite against the last commit:

```sh
mkdir -p /tmp/atlas-base && git archive HEAD | tar -x -C /tmp/atlas-base
ATLAS_ROOT=/tmp/atlas-base npm run test:e2e
```

Retries are off locally (a flaky test should be seen) and 2 in CI (shared runner
network, CDN-hosted scripts). Workers are capped at 4 locally and 2 in CI: every
page renders a WebGL basemap, and at 8 parallel browsers a busy laptop stalled
pages for 10–20 s at a time.

---

## What each test guards

| File | Test | Guards against |
|---|---|---|
| `app.spec.js` | the app boots | any uncaught error on load; the headline stat not matching `DATA.length`; the map not drawing pins; the first-visit tour not starting |
| | a shared deep link never starts the tour | the tour switching views over a link someone sent |
| | `?entry=<id>` opens that drawer | shared entry links (and the `/e/<id>/` share stubs, which redirect to them) landing on a blank map |
| | `?entry=` combines with `#view` | a link copied from the address bar while a drawer is open in, say, the Directory (`?entry=x#directory`) losing its entry |
| | unknown `?entry=` id | a mistyped or retired id breaking the page |
| | `#map`, `#galaxy`, `#journey`, `#directory` | each view link showing that view, with real content (pins, canvas, 5 stages, one card per entry) |
| | tab clicks write the hash; unknown hash → map | the URL staying shareable as people move around |
| | footer `#footCount` | the footer count being hand-typed again (it said "101 organizations" while the atlas listed 171) |
| | every entry opens a drawer | one malformed entry (unknown category, stage with no row) throwing only when someone opens it |
| `shortlist.spec.js` | `?list=` restores the shared list, and it survives | the d37a30c bug: opening an entry from a shared shortlist, closing it, or switching views rewrote the URL without `?list=`, so a reload or a forwarded link showed nothing. Also: viewing someone's list never writes it into your own saved stars |
| | `?list=` of unknown ids | a stale list link breaking the page |
| | co-located pins | every pin sharing exact coordinates with another lists the others in its popup's `.pop-colocated`, and each name there opens that entry's drawer. Every pair within the contract's 25 m is checked too (9 as of 2026-09-30), with the same distance formula as the map's `COLOCATED_M` grouping; the nearest pair outside it is 27.7 m apart |
| | affiliation labels | an entry with `affiliation` shows "Atlas publisher" / "Atlas sponsor" / "Sponsor-affiliated" in its drawer, and an entry without one shows none of them. Also fails if no entry has the field at all (it was lost, not empty) |
| `events.spec.js` | `/events/` loads and lists events | the events page breaking |
| | "→ on the atlas" link | the events page → atlas drawer hand-off |
| | without `events.json` | a missing feed leaving the page stuck on "Loading events…" |
| | events footer `#footCount` | same as the atlas footer |
| `a11y.spec.js` | axe on each view | see below |

### Rules every test gets for free

Every spec imports `test` from `tests/helpers/atlas.js`, which adds:

- **An error guard.** Any uncaught exception in the page fails the test. So does
  any failed request for a file this repo ships (same origin: `data/*.yml`,
  `map-style-dark.json`, `events/`). Failed *third-party* requests — map tiles,
  Google Fonts, the hot-linked TOA logo and favicon — are listed on the report
  but don't fail: they are outside this repo and CI's network makes them flaky.
  That tolerance doesn't hide a broken app: if a CDN *script* the page needs
  (Leaflet, MapLibre) fails to load, the app throws `L is not defined` and the
  first rule catches it.
- **A fixed events feed.** `events.json` is regenerated weekly and isn't in git,
  so every test gets a small feed dated relative to "now" instead (one event
  hosted by a real atlas entry, one not). A test can ask for
  `eventsFeed: "missing"` to get a 404.
- **No tour.** The first-visit tour starts 1.4 s after a plain page load and
  switches views, which would race other assertions, so it is marked as seen.
  `test.use({ firstVisit: true })` turns it back on.

If a test fails because you changed that behaviour on purpose, change the test
in the same PR and say why in the commit message — the tests are the written
record of what shared links and counts promise.

Tests read the page's own globals by name (`DATA`, `markers`, `map`,
`openDrawer`) through `page.evaluate` — top-level `let`/`const` in `index.html`
are reachable that way. The Node side reads `data/*.yml` through the same shared
loader the page uses (`atlas-data.js`), exactly as
`validate.js` does.

---

## The accessibility gate (axe)

`a11y.spec.js` runs [axe-core](https://github.com/dequelabs/axe-core) against
WCAG 2.0/2.1 A and AA rules on: the map, galaxy, journey and directory views,
an open entry drawer, a shared shortlist, the first-visit tour card, and the
events page.

The gate was set from what the pristine baseline (main @ 76cf38e) actually
produced:

- **Critical → always fails.** Critical issues can never be allowlisted.
- **Serious → fails unless allowlisted** in `KNOWN_SERIOUS` at the top of the
  file.
- **Moderate / minor → reported, not failed.** They appear as annotations on the
  test in the HTML report.

### The allowlist

Each `KNOWN_SERIOUS` entry names the axe rule, the one scan it is tolerated in,
the elements it is tolerated in (`within`: CSS selectors — a flagged node must
be, or sit inside, one of them), the date, and why. There are no rule-wide
entries (a test fails if one is added): the same rule anywhere else on that page
still fails, so a new colour-only link can't hide behind a known one. Region
selectors (`#add p`, `.footer-inner`) rather than axe's own `nth-child`
selectors keep an unrelated footer edit from breaking the gate. As of
2026-09-30:

| Scan | Rule | Within | Why it's tolerated for now |
|---|---|---|---|
| events page | `color-contrast` | `#genLine`, `#add + p` | the grey "refreshed …" line and the sources/credits paragraph with its links (`--faint`) are below 4.5:1 — fix in `scripts/build-events-page.js` |
| events page | `link-in-text-block` | `#add p`, `.footer-inner`, `#list .atlas` | colour-only links in three places: the "Get your event on this list" paragraph, the footer ("The Open Accelerator", "Suggest an entry", "GitHub"), and each event's "→ on the atlas" link — same file |
| first-visit tour | `color-contrast` | `#tourStep` | the "1 / 5" counter is below 4.5:1 |

To **fix one**: fix the page, run `npx playwright test tests/a11y.spec.js`, and
the report shows "allowlist entry unused" naming each selector that no longer
has a flagged node — delete that selector, and the entry once none are left. A
partial fix shows up the same way. To **add one**: only for a serious issue you
have decided to ship with, scoped to the elements it affects, with a reason
someone else can act on. Never add a critical one; fix it instead.

### Found on the baseline

The first run against main @ 76cf38e failed on two real bugs, both fixed in
`index.html` in the same change that added the suite:

- **Critical, Directory view: `select-name`.** The founder-stage and sort
  `<select>`s had no accessible name, so a screen reader announced them as
  unlabelled combo boxes. Fixed with `aria-label`s.
- **`?entry=x#directory` opened nothing.** On load, switching to the `#view`
  ran `updateURL()`, which (no drawer open yet) deleted `?entry=` before it was
  read. `updateURL()` itself writes exactly that URL whenever a drawer is open
  in a non-map view, so any link copied from the address bar there was broken.
  Fixed by reading `?entry=` first.

Not gated yet:

- **Light theme.** The suite scans the default dark theme. The
  light theme had 19 serious `color-contrast` nodes on the map view and 207 in
  the Directory (category chips, card text), plus 3 `link-in-text-block`, on the
  baseline. Gating it now would mean allowlisting the whole theme; it belongs
  with a contrast pass on the light palette.

---

## CI (`.github/workflows/validate.yml`)

Runs on PRs and pushes to `main` that touch `data/`, `index.html`,
`events/**`, `map-style-dark.json`, `README.md`, `scripts/**`, `tests/**`,
`package*.json`, `playwright.config.js` or the workflow itself. `README.md` is
there for the copy lint, which checks it: without it a README-only PR could
merge a hand-typed count and the next unrelated PR would go red for it.

| Job | What it does |
|---|---|
| `validate` | `node scripts/validate.js` + the freshness report (unchanged) |
| `badge` | on pushes to `main`, regenerates `badge.json` (unchanged) |
| `lint-copy` | `node scripts/lint-copy.js` — fails if user-visible copy in `index.html`, `events/index.html` or `README.md` hand-types an organisation count |
| `e2e` | `npm ci`, `npx playwright install --with-deps chromium`, `npm run test:e2e`; on failure uploads `playwright-report/` + `test-results/` (traces, screenshots) as the **playwright-report** artifact, kept 14 days |

To read a CI failure: open the run → Artifacts → download
**playwright-report** → unzip → `npx playwright show-report <folder>`. The trace
of each failed test replays it step by step.

---

## The post-deploy check (`deploy.yml`)

`rsync` exiting 0 only proves the origin server accepted the files. It doesn't
prove visitors get them: the files could land in the wrong directory, or a TOA
site deploy could be racing this one (the 2026-08-31 overwrite in
`PROJECT_STATE.md`).

So after the rsync steps, `deploy.yml` runs
`node tests/deploy/verify-live.js`, which:

1. hashes (sha256) the local `index.html`, `data/*.yml`, `events/index.html` and
   `map-style-dark.json` — the files the run just copied;
2. fetches each from `https://the-open-accelerator.com/ecosystem/` through
   Cloudflare's proxy, with a cache-busting query
   (`?deploy-check=<sha>-<attempt>-<time>`) and `no-cache` headers. The unique
   query means Cloudflare always asks the origin, so this checks what the
   origin serves, never an edge-cached copy (see "What it doesn't cover");
3. compares hashes, retrying the files that don't match yet with backoff
   (waits of 5, 10, 15, 20, 30, 40, 60 s — 3 minutes in all, within a 210 s
   budget that also counts the fetches);
4. prints one line per file and exits 1 unless every file matched. A file that
   doesn't match ends as either **mismatched** — the live site answered with
   other bytes, or 404/410 — or **could not check** — a network error,
   timeout, Cloudflare challenge, or 403/429/5xx, which says nothing either way
   about what visitors get.

**Cloudflare rewrites the HTML.** Its *Email Address Obfuscation* feature
replaces every `mailto:` link in the pages it serves with an encoded
`/cdn-cgi/l/email-protection#…` link and injects a decoder script. On
2026-09-30 the live `index.html` differed from `main` by exactly that and
nothing else, so a plain hash comparison would fail on every deploy. The script
reverses that exact rewrite before hashing (the encoding is a one-byte XOR key);
any other difference still fails. If Cloudflare's features change and the
check starts failing on every deploy, look at a `diff` between the live file and
the local one before suspecting the deploy.

**What happens on a mismatch:**

- the verify step is `continue-on-error`, so it does **not** trip the existing
  "🚨 Atlas deploy failed — the live site is *unchanged*" alert, which would be
  false here (the files were copied);
- a separate Slack message, "⚠️ Atlas live check failed", lists each file with
  the live and deployed hashes, Cloudflare's cache status and the file's
  `Last-Modified` (same header / section / context layout as the others;
  `continue-on-error`; skipped silently when `SLACK_WEBHOOK_URL` is unset). It
  says "still not serving them" only when a file is proven **mismatched**; when
  files merely **could not be checked** it says so and asks for a check by
  hand;
- a proven mismatch also holds back the usual "🗺️ Atlas updated — N
  organizations live" message, which would be false. When the check only
  couldn't fetch the site, that message still goes out, followed by the "could
  not check" alert;
- the last step of the job then fails the run, so it shows red in Actions.

The workflow also has `concurrency: deploy-atlas`, so two merges in quick
succession deploy one after the other instead of overwriting each other's
files mid-check.

Run the same check by hand at any time (read-only GETs):

```sh
npm run verify:live                               # compares against this checkout
node tests/deploy/verify-live.js --timeout 20 data/entities.yml
```

A checkout of `main` should report `OK`; a branch with unmerged changes to those
files will (correctly) report a mismatch.

**What it doesn't cover:**

- It checks once, at deploy time. A later overwrite (a TOA site deploy an hour
  afterwards) isn't caught until the next atlas deploy. Running
  `npm run verify:live` from a scheduled workflow against `main` would close
  that gap.
- `atlas.json`, `atlas.csv`, `sitemap.xml` and the `/e/<id>/` share stubs are
  deployed but not compared.
- Edge-cached copies. The cache-busting query bypasses Cloudflare's cache on
  purpose, so the check sees the origin. On 2026-09-30 none of the plain URLs
  (`/ecosystem/`, `index.html`, `data/entities.yml`, `events/`, `map-style-dark.json`)
  was edge-cached (`cf-cache-status: DYNAMIC`), so visitors get the origin's
  copy too. If a Cloudflare cache rule ever starts caching them, a stale edge
  copy would go unnoticed here; purge the cache after deploys in that case.
