# The events page — how it works and how to run it

This is the guide for **the-open-accelerator.com/ecosystem/events** — the
"Boston AI Events, next 10 days" page. It explains where the events come from,
how the Monday refresh works, and what to do when something needs a human.
Written for maintainers who don't live in this repo; nothing here requires more
than a browser and, occasionally, one terminal command.

---

## The one-paragraph version

Every **Monday at 7am Boston time**, a robot (GitHub Actions) collects AI and
data-community events from Luma and AI Tinkerers, keeps the ones happening in
the **next 10 days** in Greater Boston, writes them to
`/ecosystem/events.json` on the web server, and posts the list to the Scouts
Slack channel. The page at `/ecosystem/events/` simply displays that file.
No server, no database, nothing to babysit.

---

## Where events come from

| Source | How | Trust level |
|---|---|---|
| **Luma calendars** in [`events-sources.json`](../events-sources.json) (Startup Boston, TOA's own, AI Furnace, …) | Each calendar's public **ICS feed** — the same URL the "Subscribe" button hands out. Sanctioned, keyless, stable. | Highest |
| **Luma discover — AI category** (what you see at luma.com/discover/boston/ai) | Luma's internal discover API, Boston coordinates, `ai` category. Everything here is in-scope by definition. | Best-effort* |
| **Luma discover — all of Boston** | Same API without the category, then **keyword-screened**: AI terms (LLM, agents, ML, robotics…) plus the data-infrastructure community (ClickHouse, Databricks, Kafka, vector DBs…) — in Boston it's the same crowd. | Best-effort* |
| **AI Tinkerers Boston** | Their agent-friendly endpoints (`llms-full.txt` + the homepage's structured data), per the usage terms in their own `agents.md`. | High |
| **[`events-manual.json`](../events-manual.json)** (create it if needed) | Hand-added one-offs: `[{"title","start","url","venue","organizer"}]`. Entries expire naturally once their date passes. | You |

\* "Best-effort" means the API is undocumented and Luma could change it without
notice. If it breaks, the page keeps working from the other sources, and the
run's log says exactly which source failed.

After collection, the robot **dedupes** (same URL, or same title on the same
day), drops anything outside the 10-day window, strips any HTML from titles,
and — a nice touch — links each event to its host's **atlas entry** when the
organizer matches one ("→ on the atlas").

## The Monday refresh, step by step

The workflow is [`weekly-events.yml`](../.github/workflows/weekly-events.yml):

1. **The alarm clock lives on the web server, not on GitHub.** GitHub's own
   cron scheduler proved unreliable for this repo — Monday firings arrived
   5-6 hours late one week and not at all by mid-morning the next — so the
   origin server (`toa-forge`) runs a plain cron at 11:01, 12:01 and 13:01 UTC on
   Mondays (7am EDT / 7am EST, plus a spare) and 12:01 UTC on Tuesdays (a
   retry if Monday never happened) that asks GitHub to start the workflow. The
   script is `scripts/trigger-weekly-events.sh`, installed as
   `~/bin/trigger-weekly-events.sh` for the `forge` user, logging to
   `~/.local/log/weekly-events.log`. GitHub's own crons stay in place as
   fallbacks: Monday 11:07, 12:07, 13:07, 15:07 and 17:07 UTC, then Tuesday
   and Wednesday 12:07 UTC.
2. **One gate decides, however a run started.** A first step lets a run do the
   work only if it is at or after 7am Boston time on the most recent Monday
   *and* the live `events.json` has not been regenerated since then. The first
   run that passes both checks does the work; every later one exits quietly.
   That is what makes the server cron and GitHub's crons safe together: no
   double posts, a late firing still runs, a completely missed Monday is
   self-healed by the Tuesday fallback, and daylight-saving needs no special
   handling because the gate reads the clock. The decision is printed as a
   `Gate:` line in the run's job summary.
3. **Fetch**: `node scripts/fetch-events.js` pulls all sources and writes
   `events.json`.
4. **Ship**: `events.json` is rsync'd to the web server (same deploy key as
   the atlas). It is **never committed to git** — the repo stays clean.
5. **Announce**: the day-grouped list posts to Slack
   (`SLACK_SCOUTS_WEBHOOK_URL` secret — the live TOA Scouts channel; to
   redirect it, for example to a test channel, re-set the secret, no code
   change).
6. Everything the run did is in the workflow's **job summary** on the Actions
   tab.

**Run it right now** (any day, any time). A plain manual run goes through the
same once-a-week gate, so it refreshes only if this week's refresh is missing;
tick *force* on the run dialog (or add `-f force=true` below) to refresh and
post regardless — for example to publish a just-approved event mid-week:
Actions tab → *Weekly events refresh* → *Run workflow*, or:

```bash
gh workflow run "Weekly events refresh" --repo holzerjm/mass-ai-atlas
```

**Test locally without shipping anything:**

```bash
node scripts/fetch-events.js          # writes events.json locally, prints a per-source count
```

## Adding events (three doors)

1. **A whole calendar** — the best one. If an organizer publishes on a public
   Luma calendar, add it to `events-sources.json`: view-source their calendar
   page, search for `cal-`, and add `{ "id": "cal-…", "slug": "their-slug",
   "name": "Their Name", "ai_default": true }` (set `ai_default: false` if the
   calendar isn't AI-only — the keyword screen then applies). Everything they
   ever publish flows in automatically.
2. **TOA's Luma calendar** — community members can submit at
   [luma.com/toa](https://luma.com/toa) (admin-approved); that calendar is
   already an ingested source.
3. **A one-off** — the [suggest-event issue form](https://github.com/holzerjm/mass-ai-atlas/issues/new?template=suggest-event.yml)
   (label `event-suggestion`), which a maintainer turns into an
   `events-manual.json` entry or a new source calendar.

## When something looks wrong

- **An event is missing.** Check: is it within 10 days? In Greater Boston? On
  any of our sources? If it's on the unfiltered Boston feed but has no AI/data
  keyword in its title, the screen dropped it — either add a keyword to
  `DATA_RE`/`AI_RE` in `scripts/fetch-events.js` (one line), or add the
  organizer's calendar with `ai_default: true`. (Real example: ClickHouse's
  "Boston Data Party" prompted the data-community keywords.)
- **A junk event got in.** Tighten the same keyword lists, or if a whole
  calendar is noisy, set its `ai_default: false`.
- **No Monday post, or the page shows last week's list.** Open the Actions
  tab: a normal Monday shows several *Weekly events refresh* runs (the
  server-triggered ones plus GitHub's fallbacks), all green — read each run's job summary `Gate:` line to find the one that did
  the work (the others say "skipped" and why). If none ran at all, GitHub
  dropped or delayed the firings (it happens; see the step-by-step section
  above) — run it manually with *force* ticked (on Mondays, only after 7am, or
  the 7am firing will post a second time).
- **The page says "Couldn't load events".** The last shipped `events.json` is
  stale or missing — check the latest *Weekly events refresh* run on the
  Actions tab; its log names the failing step. Re-run manually after fixing.
- **A Luma source failed.** The job summary lists per-source errors; the
  discover feeds are the fragile ones (undocumented API). The page degrades
  gracefully — the fix is usually "wait" or "add the calendar as an ICS
  source instead", which is sturdier.
- **No Slack post.** If the secret is unset the step skips quietly; if Slack
  rejects the post the run goes red (the file is already live). Fix the webhook,
  then re-run with *force* ticked to post.

## Housekeeping facts

- The events page (`events/index.html`) deploys with the atlas (merge →
  live ~1 min). The data (`events.json`) refreshes only on the weekly run or
  a manual dispatch — two different cadences by design.
- **`events/index.html` is generated — don't hand-edit it.** It's assembled by
  `node scripts/build-events-page.js`, which copies the real TOA header,
  mobile nav, footer, and theme toggle out of the atlas's `index.html` so the
  two pages can never drift apart. To change the events page, edit that
  script and re-run it; to change the shared chrome, edit `index.html` and
  re-run it.
- The server trigger authenticates with a **fine-grained GitHub token** that can
  do exactly one thing — start Actions workflows in this repo — stored at
  `~/.config/mass-ai-atlas/github-token` on `toa-forge` (mode 600). Optionally
  put a Slack incoming-webhook URL (the deploy channel's works) in
  `~/.config/mass-ai-atlas/alert-webhook` and the script will post there when
  a dispatch fails, instead of only logging to `~/.local/log/weekly-events.log`.
  The script also re-enables the workflow if GitHub disabled it for inactivity.
  Fine-grained tokens expire (one year at most). For the last two weeks before expiry the
  script warns (in its log, and via the alert webhook if configured); after
  expiry the Monday refresh depends on GitHub's own unreliable crons. Rotate it at
  github.com/settings/personal-access-tokens (repository access: this repo only;
  permissions: Actions → Read and write), replace the file, and test with
  `~/bin/trigger-weekly-events.sh` — the workflow run it starts should show
  `Gate: skipped` if the week's refresh already happened.
- Three guards keep a bad week from locking itself in: a refresh that looks
  broken (most sources failed, or nothing found while something failed) is not
  shipped; after shipping, a Verify step re-reads the live file and fails the
  run if it does not show the refresh (a refresh the gate could never see would
  otherwise repeat every firing); and a Slack rejection turns the run red.
- The gate reads the live `events.json` through Cloudflare. Today the edge does
  not cache it (`cf-cache-status: DYNAMIC`) and the gate adds a cache-buster;
  never add a Cloudflare cache rule that caches JSON *and* ignores query strings.
- A forced run queued behind an in-progress run can show as *Cancelled* if
  another automatic firing arrives meanwhile (one pending run per group) — just
  run it again.
- GitHub pauses cron workflows after ~60 days of repo inactivity; the atlas's
  normal commit traffic keeps this from happening, but if the repo ever goes
  fully quiet for a quarter, re-enable from the Actions tab.
- The aggregation approach builds on
  [nkpng2k/startup-event-scraper](https://github.com/nkpng2k/startup-event-scraper)
  (Apache-2.0) — keep the credit lines in `scripts/fetch-events.js` and on the
  page footer.
