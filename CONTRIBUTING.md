# Contributing to the Mass AI Atlas

Thanks for keeping Massachusetts' AI map alive. There are two ways to fix the data,
depending on your comfort with Git, and a third for fixing the code.

Taking part means following our [code of conduct](CODE_OF_CONDUCT.md). Found a security
problem rather than a wrong entry? See [SECURITY.md](SECURITY.md) — do not open a public
issue for it.

## 1. No Git required

- **Suggest a new entry:** [open a suggestion form](../../issues/new?template=suggest-entry.yml)
- **Flag a problem:** [open a flag form](../../issues/new?template=flag-entry.yml) — or click
  **🚩 Flag** on any entry inside the atlas itself

A maintainer reviews each issue and turns accepted suggestions into pull requests.

## 2. Pull requests (preferred)

All data lives in YAML files under [`data/`](data/): the entries in
[`data/entities.yml`](data/entities.yml) (one list item per organization), plus
[`categories.yml`](data/categories.yml) and [`stages.yml`](data/stages.yml). Each file
has a JSON Schema next to it (`*.schema.yml`) that defines every field and its rules.

### Adding an entry

1. Fork and clone the repo
2. Add your entry to `data/entities.yml` (keep it inside its category section — see the
   `# ---------- … ----------` comments)
3. Validate: `npm ci` (once), then `node scripts/validate.js`
4. Open a PR explaining what the org is and including a source link

### Entry schema

The authoritative definition is [`data/entities.schema.yml`](data/entities.schema.yml).
An annotated example:

```yaml
- id: acme-ai                       # unique, kebab-case
  name: Acme AI Labs
  cat: startup                      # startup | vc | angel | accel | university |
                                    # corporate | community | event | gov | space | student
  loc: 1 Broadway, Cambridge        # address, or neighborhood if venues vary
  lat: 42.3629                      # lat/lng must be within Massachusetts
  lng: -71.0838
  approx: true                      # include if coordinates are neighborhood-level
  url: https://acme.ai              # official site, https only
  badge: Applications open          # optional highlight
  desc: 1-2 factual sentences. What it is, what it does.   # max 400 chars
  why: One sentence on why an early-stage founder should care.
  tags: [robotics, lab space]       # 2-4 short lowercase tags
  stages: [1, 3]                    # founder stages served: 1 Spark, 2 Validate,
                                    # 3 Build, 4 Fund, 5 Scale
  links: [csail, engine]            # ids of related entries (Galaxy view edges)
  offers: [funding, mentorship]     # what founders GET, 1-6 of: funding | grants |
                                    # space | compute | mentorship | community |
                                    # talent | customers (powers the "I need…" filter)
  applyBy: '2026-10-15'             # optional: rolling, or the current application
                                    # deadline — past dates auto-hide in the app
  applyNote: Fall 2026 cohort       # optional, max 40 chars, shown next to the deadline
  facts: [[Check size, $500K–$2M],
          [Equity, 6%]]             # optional "at a glance" table, 1-6 rows; labels:
                                    # Check size | Stage | Terms | Equity | Board seat |
                                    # Program length | Cohort size | Focus
  added: 2026-08                    # month (YYYY-MM) the entry joined the atlas —
                                    # set once, never changed; powers the "✨ New" highlight
  lastVerified: 2026-08             # month (YYYY-MM) a maintainer last confirmed the
                                    # org is real, active, and the facts are right
```

Text containing `: ` or ` #`, or starting with a quote or bracket, must be quoted.

### What gets accepted

- **Real, active, Massachusetts** organizations relevant
  to AI founders
- Factual, neutral descriptions — no marketing copy, no superlatives you can't source
- Affiliation is welcome (you know your org best!) — just disclose it in the PR/issue
- One entry per organization; programs of an org get a `links` edge, not always their
  own entry (maintainer's judgment)

### What gets removed

Entries flagged as shut down, relocated out of the region, or persistently
unverifiable. When in doubt we mark things clearly rather than delete silently.

## 3. Fixing something in the code

Use this path for a change outside `data/`, such as an issue labelled
[`good first issue`](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
`index.html` is the whole app: one file of HTML, CSS and plain JavaScript that reads
`data/*.yml` as it loads. There is no build step, and the
[house rules](HACKATHON.md#house-rules-worth-keeping) say why a change can't add one.

1. **Claim the issue.** Comment on it, so two people don't fix the same thing.
2. **Set up.** Fork and clone the repo. You need Node 20+ and Python 3.

   ```bash
   npm ci                            # once: the scripts' and tests' dependencies
   npx playwright install chromium   # once: the browser the tests drive
   python3 -m http.server            # then open http://localhost:8000
   ```

   Serve the folder rather than opening `index.html` from `file://`: browsers block a
   `file://` page from reading its data.
3. **Make the change, and measure it yourself.** An issue says what is wrong and how to
   check it, but whoever wrote it looked once. For anything visual, check both themes, with
   the switch in the site header, and a phone-width window.
4. **Update what depends on your change.**
   - **The events page.** It is generated: `scripts/build-events-page.js` builds
     `events/index.html` from its own template plus the Tailwind setup, site header, mobile
     menu, footer and theme code it copies from `index.html`. If you changed either file,
     run `node scripts/build-events-page.js` and commit any change it makes. Never edit
     `events/index.html` by hand. If the script stops with `start not found`, your change
     removed a marker it copies from, so update the script to match.
   - **The loader's version.** `index.html` loads `atlas-data.js` at an address that
     carries a short hash of the file, so browsers and Cloudflare fetch a changed loader
     at once instead of serving a cached copy. If you changed `atlas-data.js`, run
     `node scripts/loader-version.js --write` and commit `index.html` with it.
   - **The tests.** If a test fails because you changed on purpose what it checks, update
     the test in the same pull request and say why. If you fixed an issue on the
     accessibility allowlist, `KNOWN_SERIOUS` in `tests/a11y.spec.js`, delete its entry. The
     HTML report, `npx playwright show-report`, marks it "allowlist entry unused".
   - **The deploy list.** The deploy publishes only the files and folders that
     [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) names. If you add a file
     the live site needs, add it to that upload list and to the `paths:` filter.
5. **Run what CI runs.**

   ```bash
   node scripts/validate.js && node scripts/lint-copy.js && npm run test:e2e
   ```

   CI also rebuilds the events page and checks the loader's version, and fails if
   either is out of date. If a browser test
   fails, read the failure before you re-run it:
   [`docs/testing.md`](docs/testing.md#telling-a-flake-from-a-failure) explains how to tell
   a flake from a real failure.
6. **Open the pull request.** Say what you changed and how you checked it, with screenshots
   for anything visual, and link the issue with a closing keyword such as `Closes #123`. If
   `main` moves on before it's merged, merge `main` into your branch and run the checks
   again ([here's why](HACKATHON.md#before-you-call-it-done)).

## Review process

- CI (`scripts/validate.js`) must pass: the JSON Schemas in `data/` (field types,
  MA coordinates, https links, …) plus unique ids, valid category, resolvable connections
- The browser tests run on every pull request too. They don't block a merge, but a code
  change is expected to pass them
- On your first pull request, the checks wait until a maintainer approves them, so "no
  checks reported" means waiting, not failing
- One maintainer approval merges, and **merging is publishing**: a GitHub Action
  re-checks the data and updates the live site within about a minute
  (see [MAINTAINING.md](MAINTAINING.md), Part 3)
- Maintainers stamp or refresh `lastVerified` whenever they verify an entry (accepting
  it, or resolving a flag) — it records when someone actually checked the org, not
  merely when the entry was last edited
- Flags with a source link get fast-tracked

## Maintainers

The Open Accelerator team — reach us via
[the TOA community](https://the-open-accelerator.com/community/).
