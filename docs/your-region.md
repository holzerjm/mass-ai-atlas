# Start an atlas for your region

The Mass AI Atlas is a GitHub template, so another state, city, or region can start its own
atlas from it. This note is for the organization that would run one: a state AI hub, an
economic development agency, an accelerator, or a university. The code is ready to reuse. The
real work is the research behind each entry, and the care to keep it current.

## What you get

- **Four ways in:** a map, the Galaxy of connections between organizations, a Founder Journey
  of stages and pathways, and a Directory that answers a question typed in plain words. Filters
  narrow by category, by what founders need, and by stage.
- **Applications:** programs that take applications show a deadline or "rolling", an Apply
  link, or when they reopen, and a founder can sort by what closes soonest.
- **Open data:** every entry is published as JSON, as CSV, and as a plain-text file sized for
  AI assistants.
- **Pages around it:** What's new, a credits page for contributors, and an optional weekly
  events page built from public calendars.
- **Checks on every change:** schema validation of the data, browser tests across the views in
  both themes, a deploy when a change merges, a monthly link check, and a form that becomes a
  draft pull request once a maintainer asks for it.
- **No backend:** no server code, no database, no accounts, and no build step. It's static files
  that any web host can serve.

## What it takes

- **A maintainer who reviews every change.** Each entry is a public claim about a real
  organization, so a person approves every listing before it goes live.
- **People to research entries and re-check them.** The re-check queue sizes itself from the
  data: at about 200 entries it asks for 17 a month, which reaches every entry once a year.
- **Rules for what belongs.** Decide them before the first outside suggestion arrives. The
  Massachusetts rules are in [MAINTAINING.md](../MAINTAINING.md), Appendix E.
- **A web host for static files,** plus a place to run the deploy workflow, or deploy by hand
  with `scripts/sync-to-site.sh`. A Slack webhook for alerts is optional.

## Start your copy

1. Choose **Use this template** on GitHub to create your own repository.
2. Run `scripts/setup-labels.sh <owner/repo>`. It creates the labels the suggestion forms and
   the bot depend on, and points the site's GitHub links at your repository.
3. Work through **Make it yours** in [HACKATHON.md](../HACKATHON.md): the workflows, the
   security contact, the code of conduct, credits, pathways, What's new, and branding.
4. Change what's specific to Massachusetts, in the table below.
5. Replace `data/entities.yml` with your own entries. Keep the schema, so validation, the tests,
   and the exports keep working. Run `node scripts/validate.js` after each change.
6. Point the deploy at your server: replace the repository guard and the secrets in the
   workflows, as **Make it yours** describes.

## What's specific to Massachusetts

| Where | What to change |
|---|---|
| `data/entities.schema.yml` | The `lat` and `lng` limits form a box around Massachusetts that catches typed-in mistakes. Set your region's box. |
| `index.html`, `MA_BOUNDS` and the map's views | The map's outer bounds, its two preset views ("Boston area" and "Whole Commonwealth"), and the re-center button's label. |
| `index.html`, the copy | The page's name, title, description, and help text name Massachusetts and Boston. Search the file for both. |
| Your site's address | `BASE` in `scripts/build-pages.js`, `SITE` in `scripts/export-ai.js`, `website` in `scripts/export-json.js`, the links in `scripts/build-events-page.js`, the default in `tests/deploy/verify-live.js`, and the canonical and `og:url` links at the top of `index.html`. |
| `events-sources.json` | The calendars behind the events page are Boston's. Swap in your region's, or leave the events page out. |
| The header, footer and logo | They are The Open Accelerator's site design. Use your own. |

The categories in `data/categories.yml` and the founder stages in `data/stages.yml` aren't
specific to Massachusetts, so most regions can keep them.

## Credit and licences

The code is MIT, so keep its licence notice. The Massachusetts data is CC BY 4.0: if you start
from any of its entries, credit the Mass AI Atlas. `data/credits.yml` names the people who built
the atlas upstream. Keep them, and add your own contributors below them.

## Tell us

When your atlas is live, [open an issue upstream](https://github.com/holzerjm/mass-ai-atlas/issues/new)
with its name and address. Hearing what you changed helps the next region start faster.
