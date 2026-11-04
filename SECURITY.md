# Security policy

## Reporting a vulnerability

Report it privately through GitHub:
**[open a draft security advisory](../../security/advisories/new)**.
That channel is private between you and the maintainers, and it is the route we prefer.

If you cannot use GitHub, reach us through
[the-open-accelerator.com/community](https://the-open-accelerator.com/community/) and ask
for a private channel. Do not describe the issue in that first message.

> **Running a copy of this template?** The GitHub links above are relative, so they already
> point at *your* repository — but that fallback contact is The Open Accelerator's. Replace
> it with your own, and enable private vulnerability reporting under **Settings → Code
> security**, or the primary route above has nothing behind it.

**Do not open a public issue for a security problem.** A public issue tells everyone
about the weakness before there is a fix.

What helps us act quickly:

- What an attacker could do, not only what is technically wrong.
- The steps to reproduce it, and the URL or file where you saw it.
- Anything you already know about scope, such as whether it needs maintainer access.

This is a small project maintained by volunteers. We aim to acknowledge a report within
3 working days and to tell you what we intend to do within 10. There is no bug bounty, and
we cannot pay for reports, but we will credit you in the advisory unless you would rather
we did not.

## What is in scope

Only `main` is supported. The live site is deployed from it on every merge, so the
published site and the latest commit are the same thing. There are no releases and no
older versions to patch.

| Area | Why it matters |
|---|---|
| The published site at the-open-accelerator.com/ecosystem | What visitors actually load |
| `index.html` and the render path | Entry text becomes HTML here |
| `data/` and its JSON Schemas | The schemas are a security control, not only a data check |
| `scripts/` | Especially `issue-to-entry.js`, which parses untrusted input |
| `.github/workflows/` | Especially the suggestion bot and the deploy pipeline |

## What the design already does

Worth knowing before you report, so you can tell a real finding from an intended
behavior:

- **There is no backend and no accounts.** No server-side code, no database, and no login, and
  the atlas's own code collects nothing about visitors. What a visitor does on the page stays
  in their browser, in 6 `localStorage` keys, all starting with `toa-atlas-`.
- **Cloudflare counts page views.** Cloudflare serves the site and adds its Web Analytics script
  to each page, outside this repository. The script reports the page's address, without its
  query string, along with load timings, and it sets no cookies.
- **The URL carries filters and ids, never what someone typed.** Filter values are checked
  against the atlas's fixed lists and anything else is ignored. Text typed into a search box
  stays out of the URL, so links and logs don't carry a founder's own words.
- **No secret reaches the browser.** The deploy credentials and Slack webhooks are GitHub
  Actions secrets, used only inside CI.
- **Untrusted input is gated by a human.** The suggestion bot runs only on the `bot:draft`
  label, which a maintainer applies by hand. Until then, nothing in a stranger's issue is
  parsed, geocoded, or given a token.
- **The bot is split on trust.** The job that parses issue text runs with
  `contents: read` and cannot write to the repository or mint the bot credential; a
  separate job opens the pull request.
- **Issue text never reaches a shell.** Values are written through a YAML serializer, so a
  value cannot escape its field.
- **Text fields reject angle brackets** at the schema level, and the generated share pages
  escape their output again.
- **The atlas data is validated twice**: in CI before it ships, and again in the visitor's
  browser before anything is drawn. The credits page's data, `data/credits.yml`, is checked
  in CI only. The page inserts every value as text, never as HTML, and accepts only
  `https:` links.

## What is not a security issue

- An entry that is out of date, wrong, or missing. Use the **🚩 Flag** button on the entry,
  or [open an issue](../../issues/new/choose).
- A dead or redirected link. The monthly health check already sweeps these.
- An organization you believe should not be listed. That is an editorial decision; see
  `MAINTAINING.md`.
- A report that a third-party CDN or the tile provider *could* in principle serve something
  malicious, with no evidence that it has. We know the trade-off and accept it; see
  `PROJECT_STATE.md`.
- Output from an automated scanner with no demonstrated impact on this site.
