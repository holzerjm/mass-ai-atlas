# Testing — the smoke suite and the post-deploy check

Two checks, both added in v2.0 Part A (2026-09-30):

1. **A Playwright + axe smoke suite** (`tests/`) that loads the real page in
   Chromium and checks the things founders rely on: shared links land where they
   point, every view shows, the counts are real, nothing throws, and there are
   no critical accessibility failures. It runs in CI on every pull request.
2. **A post-deploy check** (`tests/deploy/verify-live.js`) that confirms the
   live site is serving exactly the files in your checkout. You run it by hand,
   with `npm run verify:live`: no workflow runs it, `deploy.yml` included.

The atlas itself is still buildless: `index.html` + `data/*.yml` open in a browser
with no npm step. `package.json` exists only for this tooling — nothing in it
is deployed, and nobody editing `data/entities.yml` needs to install anything.

---

> **In CI.** `.github/workflows/e2e.yml` runs this suite on every pull request. It is
> deliberately **not** a required check while there is no history on GitHub runners — see
> the note below. Promote it by adding `e2e` to the required status checks of the `main`
> ruleset; nothing in the workflow changes.

> **A note on workers.** Every spec renders a WebGL basemap and the Galaxy canvas, so
> the suite is sensitive to how many browsers run at once. The config uses 4 locally
> and 2 in CI. On a machine with less GPU headroom those still contend and a spec can
> fail for lack of frames rather than a real defect — `axe: galaxy view` is the usual
> casualty. If a run fails where a serial run passes, re-run with `--workers=1` before
> believing it. Retries are deliberately off locally so flakes stay visible. A serial
> re-run only settles frames: when the page says "the atlas data failed to load", read
> the failure first (see [Telling a flake from a failure](#telling-a-flake-from-a-failure)).

> **A note on the test server.** The suite serves the repo with the server
> `python3 -m http.server` runs, but from a one-line script in `playwright.config.js`
> that raises its listen backlog from Python's default of 5 to 128. The page requests
> every `data/*.yml` file at once, and on a Mac, parallel browsers overflowed a queue of
> 5: Chrome got `net::ERR_CONNECTION_RESET` or `net::ERR_SOCKET_NOT_CONNECTED`, the page
> said "Sorry — the atlas data failed to load", and the test timed out in `waitForApp`.
> On 2026-11-01, 4 of 10 local runs at `--workers=2` failed that way before the change,
> and none of 10 after it; GitHub's Linux runners had not shown it in their last 10
> runs. Keep the backlog if you change `webServer.command`. Serving the atlas by hand
> with the stock server is rarely affected: one browser opens at most six connections to
> a host, and 300 requests six at a time drew no resets. Rarely is not never, though: the
> same day, a `--workers=1` run, which is a single browser, still lost `axe: map view` to a
> reset. If a page you serve by hand says its data failed to load, reload it.

## Running the suite locally

You need Node 20+ and Python 3 (the tests serve the repo with Python's
`http.server`, the same way you would by hand, with a longer connection queue: see
the note on the test server above).

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

### Telling a flake from a failure

Read a failure before you re-run it. The terminal shows each test's errors, and
`npx playwright show-report` keeps a screenshot and a trace of every failed test.

A page showing **"Sorry — the atlas data failed to load"** never got its data, so
`waitForApp` times out on `#stats .stat`. What else the test reports says why:

| The test also reports | Which means |
|---|---|
| "failed requests for files this repo ships" with `net::ERR_CONNECTION_RESET` or `net::ERR_SOCKET_NOT_CONNECTED` on `data/` | the test server dropped the connection: the backlog in the note on the test server. Check that `webServer.command` still raises it |
| the same list with a `404` | a file the page asks for is missing from the tree being served |
| no failed request, and a YAML or schema error in the trace's console | the data is wrong; `node scripts/validate.js` reports the same error |
| no failed request, and "third-party request failed (tolerated)" for js-yaml or Ajv | the page could not load the library that reads its data. That is the network: re-run |

Anything else that fails under parallel workers but passes at `--workers=1` — most
often `axe: galaxy view` — is GPU contention, as in the note on workers.

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
| | footer `#footCurated` | the curation month being hand-typed again (it still said "Curated June 2026" in October). The test takes the newest `lastVerified` in the data, the way the page does, so it never needs updating by hand |
| | every entry opens a drawer | one malformed entry (unknown category, stage with no row) throwing only when someone opens it |
| | co-located pins | a pin that shares its spot losing the others: every pin within 25 m of another (exact or near, by the map's own haversine) must list them in its popup's `.pop-colocated`, each name there must open that entry's drawer, and markers must stay at their exact coordinates. Without it, 16 entries could not be reached from the map at street zoom (2026-11-01) |
| | category rows and the credits and updates links on the first screen | the categories dropping below the first screen again. In a 1366 × 650 window, the map's and the galaxy's rows of category buttons, and the header's link to the credits page, must end above the fold. Until 2026-11 the categories were a legend in the canvas's bottom-left corner, which always sat just below the first screen, and the credits page was linked only from the footer |
| | a `#map` or `#galaxy` link opens at the top | the browser scrolling such a link down to the element with that id (the map or the galaxy canvas), past its category row. The canvases' `scroll-margin-top` keeps the page at the top, where a tab click leaves it |
| | the nav's and the footer's GitHub links follow `GH_REPO` | a copy of this repository linking to the one it was copied from. The test serves `index.html` with a different `GH_REPO` and checks both links. The footer's link was written into the HTML and ignored `GH_REPO` until 2026-11 |
| | a category button hides and shows its pins | a category toggle that stops removing that category's pins, or doesn't put them back, or doesn't report its state in `aria-pressed` |
| | the wheel over the map and the galaxy | a full-screen canvas swallowing the wheel again. A plain wheel turn must scroll the page and show the zoom hint without zooming, and Ctrl + wheel must zoom. Until 2026-11 any wheel turn zoomed, and the footer could not be scrolled to. The galaxy's scale moves by itself while its layout settles, so there the test checks that only Ctrl + wheel takes the camera off its fitted view (`gxAuto`) |
| | the map search's results take the arrow keys and Enter | the map search taking only a click again. It is the galaxy search's combobox (`searchBox`): the arrow keys must move through the results (`aria-activedescendant`, `aria-selected`), and Enter must pick one, which flies the map to the pin at zoom 15 and opens its popup. Until 2026-11 only a mouse could pick a result, and a 950 ms timer opened the popup. When a busy machine finished the 900 ms flight after that timer, the pin was still inside a cluster and no popup appeared: 5 of 20 runs at 4 workers. The popup now opens when the flight ends |
| | the Journey's organizations take Tab and Enter | the Founder Journey's organizations going back to spans that take only a click. Tab must reach the first one from the Journey's tab, Enter must open its drawer, and closing the drawer must put focus back on it |
| | the Journey's stages take the keyboard | the Founder Journey's stages going back to divs that take only a click, which left the keyboard with stage 1 and nothing else. Tab must move from stage 1 to stage 2, Enter must choose it (`aria-pressed`) and show its panel, and the focus must stay on it when the stepper redraws |
| | a pin's popup takes the focus | "Full details →" falling out of a keyboard's reach again. Leaflet puts popups after every pin in the tab order, so the popup must take the focus when it opens: after a search pick, and after Enter on a focused pin. Enter must open the drawer, Escape must close the drawer and then the popup, and the focus must go back to the search box, or to the pin when the popup's × closes it |
| | the Directory's category chips take the keyboard | the Directory's category chips going back to spans that take only a click, or not saying which categories show. Enter on a chip must show its category alone (`aria-pressed`, and that category's cards), and turning it off must bring every category back |
| `galaxy.spec.js` | the galaxy fits its canvas, on a phone and on a small laptop | the galaxy opening cropped again. Every node must be on the canvas, and every label inside it, with no two overlapping. Until 2026-11 the galaxy opened at its layout's own size, which a phone showed only the middle third of, with category labels cut off at both edges; a 1366 × 650 window lost its top and bottom |
| | a tap traces, a second tap opens, a tap on empty space clears | a phone losing the hover that explains the galaxy. The first tap must trace a node's connections and pin its tooltip without opening the drawer, the second must open it, and a tap on empty space must clear the choice. Until 2026-11 a tap opened the drawer at once |
| | the keyboard reaches every organization | the galaxy being mouse-only again. Its tree of organizations must hold one entry per category and one per entry in the data, Tab must reach it after ⌖, the arrow keys must open a category and move through it while the canvas shows the focus (`gxKbd`), and Enter must open the drawer, with focus back on the entry when it closes |
| | the search's results take the arrow keys and Enter | the galaxy search taking only a click again. The arrow keys must move through the results (`aria-activedescendant`, `aria-selected`) and Enter must pick one and lock its constellation |
| | the drawer's connections can be followed by keyboard | the drawer's "Connected to" entries going back to spans that take only a click, and focus going nowhere when a drawer reopened from inside itself is closed. Until 2026-11 it took the return point after the redraw had removed the button pressed, so focus fell to `<body>` |
| | a hidden category leaves the keyboard list | a category hidden with its button still taking Tab in the galaxy's tree, or Tab's place staying in it |
| `search.spec.js` | hyphens, plurals, and founders' words | the atlas's own spelling deciding what a founder finds again. "wet lab" must find LabCentral's "wet-lab", "women" must find January Ventures' "Woman-led", and a plural must match |
| | a need finds every entry that offers it | a search that doesn't read `offers`. "grant" missed 8 of the 17 entries offering grants until 2026-11. "gpu", "pilot", and "mentor" must each find every entry with that offer |
| | several words must all match | a short query turning into "any of these words". Each word may match anywhere in the entry |
| | word starts, and short words whole | matching inside words. "robot" must find robotics, and "bu" must not match "built" |
| | a sentence finds the closest entries | a founder's sentence finding nothing, as every sentence did until 2026-11, or a list that doesn't say it is only the closest. The count must say so, the sort must read "Best match", and each card must show what it matched on |
| | no match, then Clear filters | a dead end. Clear filters must empty the search and bring every entry back |
| | the three boxes share the search | the map's or the galaxy's box going back to its own matching |
| | typed text stays out of the address | a founder's own sentence reaching a link, a server log, or an analytics beacon |
| `filters.spec.js` | a filter goes into the address, and a reload keeps it | filters that vanish on reload and can't be shared, as they did until 2026-11 |
| | a shared link sets every filter | a link losing a filter, or `?entry=` taking the filters with it when the drawer closes |
| | unknown values are ignored | a mistyped link breaking the page or setting a filter that doesn't exist |
| | the map shows what the Directory shows | the two views drifting apart. A need or a stage set in either must show in the other's controls, pins, and cards |
| | a hidden category hides in both | the same for categories, which share one set too |
| | a need frames the pins it leaves | a filter leaving the Boston view looking empty when most of what it left is elsewhere. Clear filters must return to the chosen view and move the focus to the first filter |
| | a pin the filters hide can still be reached | a search or Show on map doing nothing because the pin is filtered out |
| | the headline figures open the Directory | a figure and its link disagreeing. Each link's set must be the count it shows |
| | on a phone, the map and the first card are on the first screen | the header filling a phone's first screen again (the map started 792 px down and the first card 1,428 px down, until 2026-11), or the sticky tabs going back to three rows |
| | the menu button has no gray box | the browser's default button background returning behind the white menu icon (1.15:1), on the atlas and on the events page, which lifts the header from it |
| | the hero's button | the hero promising an open application again. It said "Apply" while the residency page said applications had closed |
| `apply.spec.js` | an open application gets an Apply button | the apply link going missing, or 2 main buttons competing. Apply is the main button only while applications are open |
| | with no application page, the website stays the main button | an empty Apply button, or the drawer losing its main button |
| | a closed program says when to come back | a program between windows looking blank, or showing an Apply button for a form that's shut |
| | a deadline that has passed shows nothing | an expired date, or the note that described it, outliving the deadline |
| | Closing soon lists the nearest date first | the sort dropping dated deadlines below rolling ones, or leaving the address |
| `pathways.spec.js` | every pathway shows its steps in order | a pathway drifting from `data/pathways.yml`: a step out of order, a missing organization, or an organization shown without its own reason |
| | a step lists its organizations by closing date, then by name | someone's place in a step becoming a judgment. Real entries get fixed statuses, so a deadline passing can't change the result |
| | a closed program says so in a step | a closed program reading like an open one, or like one with no information |
| | a chosen pathway goes into the link | a shared pathway opening at the wrong one, or a link that keeps a pathway after a new stage is chosen or the Journey is left |
| | a link to a pathway that doesn't exist | a stale link breaking the Journey |
| | a pathway can be chosen by keyboard | the focus falling off the page when a pathway redraws |
| | an organization in a step opens its drawer | a step's organizations taking only a click, or closing the drawer losing the reader's place |
| | a step's Directory link lands on as many organizations as it says | the count on the link and the filtered list disagreeing |
| | an entry that doesn't exist never shows | an id reaching the page without resolving to an entry, in a copy of the atlas that removed one and skipped `validate.js`. A step left with nothing goes too |
| | the whole list still follows the pathways | the stage's full list going missing, or its count drifting from the data |
| | without `data/pathways.yml` | the Journey depending on the file. `deploy.yml` sends the page before `data/`, so a visitor can load a new page a moment before its file arrives |
| | the longest pathway fits a phone | a pathway forcing the page sideways at 390 px |
| `shortlist.spec.js` | `?list=` restores the shared list, and it survives | the d37a30c bug: opening an entry from a shared shortlist, closing it, or switching views rewrote the URL without `?list=`, so a reload or a forwarded link showed nothing. Also: viewing someone's list never writes it into your own saved stars |
| | `?list=` of unknown ids | a stale list link breaking the page |
| `events.spec.js` | `/events/` loads and lists events | the events page breaking |
| | "→ on the atlas" link | the events page → atlas drawer hand-off |
| | without `events.json` | a missing feed leaving the page stuck on "Loading events…" |
| | events footer, no count | an organisation count coming back into the events footer. That page never loads the atlas data, so a count there could only go stale (it said "101 organizations" for months); `scripts/build-events-page.js` drops the clause, and the test fails if `#footCount` or an "N organizations" phrase reappears |
| | events footer, no curation date | the same for the curation month, which said "Curated June 2026" into October |
| | events footer, light theme | the footer band turning light with the page, which puts the white partner marks on a near-white ground (it did until 2026-11). The footer's ground, text and link colours must match the dark theme's |
| | events footer, Suggest an entry link | the link doing nothing. The footer is copied from `index.html`, where the link calls `suggestEntry()`, and this page has no such function, so a click only threw a `ReferenceError` (it did until 2026-11). `scripts/build-events-page.js` points it at the `suggest-entry.yml` form on `GH_REPO` instead, and the test fails on any other address or an `onclick` |
| | contribution links follow `GH_REPO` | a copy of this repository filing its issues on the one it was copied from. `scripts/build-events-page.js` takes the repository from `const GH_REPO` in `index.html`; until 2026-10-23 the page hardcoded `holzerjm/mass-ai-atlas` in three links. The test checks the wiring, not the value |
| | events footer's GitHub link follows `GH_REPO` | the same for the events page, which runs no atlas script, so `scripts/build-events-page.js` sets the link at build time. The test runs the generator on `index.html` with a different `GH_REPO` in a temporary folder and checks the footer it writes |
| `credits.spec.js` | one card per mapmaker | the credits page drifting from `data/credits.yml`: a missing card, a wrong handle link, a story that doesn't match, or a hand-typed count |
| | the timeline, oldest first | a milestone going missing or out of order |
| | a kind filter, and All | the filter hiding the wrong people, or All failing to bring everyone back |
| | no photo, real name, or LinkedIn link without consent | a card showing a GitHub photo, a real name, or a LinkedIn link that `data/credits.yml` doesn't opt in to with `photo: true`, `name`, or `linkedin`, or a LinkedIn link going to the wrong profile |
| | both footers link to the credits page | the events page's copy of the footer pointing one folder too deep. `scripts/build-events-page.js` rewrites that link |
| `ask.spec.js` | the Directory opens the dialog, and closing it puts the focus back | a dialog the keyboard can't leave, or one that loses the reader's place |
| | Tab stays inside the dialog | the keyboard walking the page behind it |
| | the prompt points at the file and carries the rules | a change dropping the rules that keep answers honest, such as "Don't answer from memory" |
| | what someone types goes into the prompt, and nowhere else | a founder's words reaching the address, storage, or the network |
| | a search already typed starts the situation | someone having to type their sentence twice |
| | the copy button copies the prompt as shown | the prompt copied differing from the prompt shown |
| | without clipboard access, the prompt shows selected | a browser that refuses the clipboard leaving the button dead |
| | `?ask=1` opens the dialog once | the dialog coming back on every reload |
| | a pathway offers it | the way in from the Journey going missing |
| | the dialog recommends attaching the data, offers a look at it, and states its limits | a founder left relying on a web tool that cuts or summarizes the file, or the privacy and accuracy notes going missing |
| | the dialog fits a phone | the dialog running off the screen at 390 px |
| | `atlas-ai.txt` lists every organization, A to Z | an entry missing, or the order depending on anything but the name |
| | it carries every pathway, with entries that exist | a pathway dropped, or a step naming something that isn't there |
| | it ends where it says it does | the last line or the count going missing, so an assistant couldn't tell it read only part |
| | it holds no instructions for an assistant | rules creeping into the file. They belong in the prompt a founder reads |
| | it shows the same application status as the page | the file and the page disagreeing about what's open |
| | it stays compact | the file growing until web tools cut it |
| `updates.spec.js` | every update, newest first | the page drifting from `data/updates.yml`, or a date out of order |
| | every Try it link lands inside the atlas | a `try` link pointing at something that isn't there. A pathway link must open that pathway |
| | a Try it link on the page opens what it says | the page building the wrong address from a `try` value |
| | new organizations by month, and where the record starts | the first month in `added` being counted as new. That month is when the field began, so 116 "new" organizations would be false |
| | a new organization's link opens its entry | a name on the page leading nowhere |
| | the updates show without the entries | one failed file blanking the page |
| | the page says so without the updates | a missing file leaving an empty page with no explanation |
| | the atlas loads as usual without the updates | the atlas depending on the file. `deploy.yml` sends the page before `data/` |
| | both footers link to the updates page | the events page's copy of the footer pointing one folder too deep |
| | the banner names the newest update, and shows once | a returning visitor seeing it on every visit, or not at all |
| | its link opens the updates page, and counts as reading it | the banner coming back after someone followed it |
| | a newer update beats last month's dismissal | a month saved before updates existed hiding a new one |
| | a shared shortlist link isn't interrupted | the banner covering what someone was sent to see |
| | a first visit gets the tour | news about what changed reaching someone who hasn't seen any of it |
| | the tour mentions applying, and points at the pathways | the tour falling behind the page again. Its text is hand-written, so nothing else notices |
| | the tour without pathways | the Journey step pointing at nothing. It falls back to the stages |
| | the updates page fits a phone | a long name forcing the page sideways at 390 px |
| `a11y.spec.js` | axe on each view | see below |
| | every allowlist entry is scoped | a `KNOWN_SERIOUS` entry with no `within`, which would tolerate its rule on every element of that page, including ones added later |
| | one banner, one main and one footer landmark, each told apart | the atlas page's landmarks going wrong again (#58). Until 2026-11 screen readers listed two contentinfo and two banner landmarks with nothing to tell them apart, and no main one, and its two `<nav>`s had no names. The views and the atlas's own footer now sit in `<main>`, so the TOA site footer is the page's one footer. The hero is a section named by the page's title, so the TOA site header is the one banner. Each `<nav>` has a name. axe rates the four rules moderate, which the gate reports without failing, so this test runs `landmark-no-duplicate-contentinfo`, `landmark-one-main`, `landmark-no-duplicate-banner` and `landmark-unique` on their own |
| | the events page's landmarks | the events page losing its main landmark again. Until 2026-11 its content was a `<div>`, so the page had no main landmark and its content sat outside every landmark. `scripts/build-events-page.js` now writes it as the page's `<main>`. The test runs `landmark-one-main`, `region`, `landmark-no-duplicate-banner`, `landmark-no-duplicate-contentinfo` and `landmark-unique` on the page with the events fixture |

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
  `test.use({ firstVisit: true })` turns it back on. The what's-new banner is off the same way,
  because it arrives after load and moves the page down: `test.use({ newBanner: true })` turns it
  back on.

If a test fails because you changed that behaviour on purpose, change the test
in the same PR and say why in the commit message — the tests are the written
record of what shared links and counts promise.

Tests read the page's own globals by name (`DATA`, `markers`, `openDrawer`)
through `page.evaluate` — top-level `let`/`const` in `index.html`
are reachable that way. The Node side reads `data/*.yml` through the same shared
loader the page uses (`atlas-data.js`), exactly as
`validate.js` does.

---

## The accessibility gate (axe)

`a11y.spec.js` runs [axe-core](https://github.com/dequelabs/axe-core) against
WCAG 2.0/2.1 A and AA rules on: the map, galaxy, journey and directory views,
an open entry drawer, a founder pathway with open and closed programs, a shared shortlist,
the first-visit tour card, the what's-new banner, the Ask your own AI dialog, the events page,
the credits page and the updates page, each in both the dark and the light theme; and the galaxy's keyboard
list and search with a category open and results showing, in the dark theme.

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
selectors rather than axe's own `nth-child` selectors keep an unrelated edit
from breaking the gate.

**The allowlist has been empty since 2026-11-02.** The baseline had three entries,
all since fixed and removed: the events page's faint meta text (`color-contrast`)
and its colour-only links (`link-in-text-block`), both in October 2026, and the
first-visit tour's "1 / 5" step counter (`color-contrast`), in November 2026.

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

**Light theme on atlas views: gated since 2026-11.** Until then the map, galaxy,
journey and directory views, the entry drawer and the shared shortlist were scanned in
the dark theme only. In the light theme each view failed 21 to 34 times:

- category colours used as text on white: the Directory's category chips and the
  Journey's group headings now use the category's ink, which darkens in light mode;
- the site footer's grey (Tailwind's gray-500, 4.08:1) on its dark band;
- the atlas footer's links, told apart from its text by colour alone, now underlined;
- the Directory's "Apply by" tags (4.43:1) and the shortlist's URLs (3.8:1).

The two footer faults were there in the dark theme as well. There the footer band has no
background of its own, so axe could not measure its contrast and reported nothing.
On the 2026-09-30 baseline the light theme had 19 serious `color-contrast` nodes on the
map and 207 in the Directory, before the category ink and other fixes in between.

The tour card's light scan came with its step-counter fix: the colour first proposed for
the counter passed in the dark theme and failed, at 2.61:1, in the light one.

---

## CI (`.github/workflows/validate.yml` and `e2e.yml`)

Two workflows run on every pull request, and **neither is path-filtered**. That is
deliberate: a path-filtered required status check never reports on a PR outside its
paths, and would block that PR forever. On pushes to `main`, **Validate atlas data** is
limited to `data/**`, `scripts/**`, `atlas-data.js`, `package.json`,
`package-lock.json`, `index.html` and `events/**`; **Browser tests** has no path filter
there either.

| Workflow | Job | What it does |
|---|---|---|
| Validate atlas data | `validate` | `node scripts/validate.js`; then `node scripts/lint-copy.js`, which fails if user-visible copy in `index.html`, `events/index.html`, `README.md` or `HACKATHON.md` hand-types an organisation count or a curation month; then `node scripts/build-events-page.js`, failing if the rebuilt `events/index.html` differs from the committed one (run that script and commit what it writes) or the generator can no longer run; then `node scripts/loader-version.js`, failing if the version in `index.html`'s `atlas-data.js?v=` no longer matches the file (run it with `--write` and commit `index.html`); then `node scripts/stale.js` as a freshness report, which is informational and never fails the build |
| Browser tests | `e2e` | `npm ci`, Chromium restored from a cache keyed on the lockfile, `npm run test:e2e`; on failure uploads `playwright-report/` as the **playwright-report** artifact, kept 7 days |

**Only `validate` is a required status check** on `main`. Browser tests runs and reports
but gates nothing, on purpose — the comment at the top of `e2e.yml` says why, and what to
change to promote it.

CI retries a failed test twice (`retries: CI ? 2 : 0`). Locally it does not, so a flake
stays visible while you work.

A pull request from someone who has not contributed to this repository before lands with
both workflows in `action_required`. They do not run until a maintainer presses *Approve
and run workflows* on the PR's Checks tab, so "no checks reported" on such a PR is not a
red build.

To read a CI failure: open the run → Artifacts → download
**playwright-report** → unzip → `npx playwright show-report <folder>`. `trace:
"retain-on-failure"` puts a trace inside the report for each failed test, so it replays
step by step.

---

## The post-deploy check (`npm run verify:live`)

`rsync` exiting 0 only proves the origin server accepted the files. It doesn't
prove visitors get them: the files could land in the wrong directory, or a TOA
site deploy could be racing this one (the 2026-08-31 overwrite in
`PROJECT_STATE.md`).

`tests/deploy/verify-live.js` checks the live site, but only when you run it:
no workflow calls it. `deploy.yml` validates `data/` and builds the generated
files before it uploads anything, and never looks at the live site afterwards,
so a green deploy run, and the Slack message it sends, prove only that the
upload succeeded, not that visitors get the new files. Once a deploy run has
finished, run the check by hand (read-only GETs):

```sh
npm run verify:live                               # compares against this checkout
node tests/deploy/verify-live.js --timeout 20 data/entities.yml
```

A checkout of `main` should report `OK`; a branch with unmerged changes to the
files it compares will (correctly) report a mismatch. The script:

1. hashes (sha256) this checkout's `index.html`, `atlas-data.js`, the data and
   schema files in `data/`, `events/index.html`, `credits/index.html`, `updates/index.html` and
   `map-style-dark.json`
   (`DEFAULT_FILES` at the top of the script), or only the files you name;
2. fetches each from `https://the-open-accelerator.com/ecosystem/` through
   Cloudflare's proxy, with a cache-busting query
   (`?deploy-check=local-<attempt>-<time>`) and `no-cache` headers. The unique
   query means Cloudflare always asks the origin, so this checks what the
   origin serves, never an edge-cached copy (see "What it doesn't cover").
   `--base <url>` checks a different deployment instead, such as a copy's
   own site;
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
nothing else, so a plain hash comparison would fail every time. The script
reverses that exact rewrite before hashing (the encoding is a one-byte XOR key);
any other difference still fails. If Cloudflare's features change and the
check starts failing on every run, look at a `diff` between the live file and
the local one before suspecting the deploy.

**One deploy at a time.** `deploy.yml` has a `concurrency` group,
`deploy-atlas`, so a deploy run that starts while another is in progress waits
for it instead of uploading alongside it, and a newer run never cancels one
that is running. GitHub keeps one waiting run per group, so a newer run
replaces a waiting one. That loses no change, since the newer run deploys a
later `main`, but the replaced push's commits are missing from the Slack
summary. A deploy run normally takes about 20 seconds, and `timeout-minutes: 15`
stops one whose upload hangs, so it cannot hold the group, and every deploy
behind it, for GitHub's default limit of six hours.

**What it doesn't cover:**

- It checks only when someone runs it. A deploy that did not land, or a later
  overwrite (a TOA site deploy an hour afterwards), goes unnoticed until someone
  does. A step at the end of `deploy.yml` would catch the first, and a scheduled
  run of `npm run verify:live` against `main` would catch the second.
- `atlas.json`, `atlas.csv`, `atlas-ai.txt`, `sitemap.xml` and the `/e/<id>/` share stubs are
  deployed but not compared.
- Edge-cached copies. The cache-busting query bypasses Cloudflare's cache on
  purpose, so the check sees the origin. On 2026-09-30 none of the plain URLs
  (`/ecosystem/`, `index.html`, `data/entities.yml`, `events/`, `map-style-dark.json`)
  was edge-cached (`cf-cache-status: DYNAMIC`), so visitors get the origin's
  copy too. If a Cloudflare cache rule ever starts caching them, a stale edge
  copy would go unnoticed here; purge the cache after deploys in that case.
  `atlas-data.js` is cached already: on 2026-11-02 Cloudflare served it from its
  edge (`cf-cache-status: HIT`, `Cache-Control: max-age=14400`), while every
  other file the check compares was `DYNAMIC`. Those are Cloudflare's zone
  defaults, about 2 hours at the edge and 4 in browsers, and the check, which
  bypasses the cache, would not see a stale copy. So `index.html` loads the
  loader as `atlas-data.js?v=<version>`, a short hash of the file that
  `scripts/loader-version.js` keeps current and CI checks. Cloudflare keys its
  cache on the query string, so a changed loader is a new address that neither
  Cloudflare nor a browser has cached. The plain `atlas-data.js` address can
  still be stale at the edge, but the page no longer requests it. This relies
  on the upload order: `deploy.yml` copies `atlas-data.js` and `index.html` in
  one `rsync` command, which sorts its file list, so the loader lands first.
  Uploading `index.html` first, in a command of its own, would let a visitor in
  the gap make Cloudflare cache the old loader under the new address.
