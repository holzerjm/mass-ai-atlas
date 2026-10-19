# Moving the atlas repo to a TOA GitHub organization

A step-by-step checklist for transferring `holzerjm/boston-ai-atlas` to an
organization owned by The Open Accelerator, with at least two owners, without breaking
the live site, the contribution forms, the suggestion bot or the Monday events post.

Written 2026-09-30 from the repository's own workflows and scripts, a read-only look at
the repository's settings, and GitHub's documentation. Where GitHub's docs do not say
what happens, this file says **unconfirmed** — check it on the day rather than assume.

**Why bother:** today one personal account holds the repository, its secrets, the bot's
GitHub App and the token that starts the Monday refresh. If that account is
unavailable, nobody can merge, rotate a leaked key or fix a failed deploy. See
`SECRETS.md` for the full inventory.

**What you need:** about two hours; owner access to the new organization; admin on the
repository; a login on the origin server (`toa-forge`) as the `forge` user; manager
access to the TOA Slack app(s). Do it on a Tuesday–Thursday that is not the 1st of the
month (the monthly health check runs then) — not a Monday (the events refresh) and
not with a suggestion-bot PR in flight.

---

## 1. Before the transfer

- [ ] **Create the organization** (e.g. `the-open-accelerator`) and invite a **second
      owner**. Two people with the Owner role, both with two-factor authentication;
      turn on "Require two-factor authentication" for the org.
- [ ] Make sure the org has **no repository named `boston-ai-atlas`** and no fork of it —
      GitHub refuses the transfer if it does ([docs][transfer]).
- [ ] **Org settings → Actions → General:** allow actions. Every action these workflows
      use is GitHub-owned (`actions/checkout`, `actions/setup-node`,
      `actions/upload-artifact`, `actions/download-artifact`,
      `actions/create-github-app-token`), so "allow actions created by GitHub" is
      enough. Set the default workflow permissions to **read** (the repository uses
      read today; jobs that need more declare it). Leave "Allow GitHub Actions to
      create and approve pull requests" **off** (it is off today).
- [ ] **Org settings → Personal access tokens:** keep fine-grained tokens allowed. By
      default an org owner must approve each fine-grained token that can reach the
      org (tokens created by org owners need no approval), and the default maximum
      lifetime is 366 days ([docs][pat-policy]). Step 6 needs one such token.
- [ ] **Snapshot the current state** so you can compare afterwards:
      ```bash
      gh label list  --repo holzerjm/boston-ai-atlas
      gh secret list --repo holzerjm/boston-ai-atlas     # names + dates only, never values
      gh api repos/holzerjm/boston-ai-atlas/actions/workflows --jq '.workflows[] | "\(.name) \(.state)"'
      ```
      On 2026-09-30: 4 atlas labels (`new-entry`, `flag`, `bot:draft`,
      `event-suggestion`) plus GitHub's defaults; 8 secrets (`SECRETS.md` §1;
      `ATLAS_BOT_PAT` is not set); 5 active workflows; no rulesets, no branch
      protection, no webhooks, no deploy keys, no Actions variables or environments,
      no GitHub Pages site; one collaborator (@holzerjm).
- [ ] **Find out who owns the bot's GitHub App** — github.com/settings/apps on
      @holzerjm's account. If it is listed there, it is a personal App; step 4 moves it.
- [ ] Tell the TOA Slack channel the repo is moving and that suggestion links will
      redirect.

## 2. The transfer itself

- [ ] Repository **Settings → General → Danger Zone → Transfer ownership**, choose the
      organization, type the repository name to confirm. You need permission to
      create repositories in the organization ([docs][transfer]).
- [ ] **Never create a repository or fork at `holzerjm/boston-ai-atlas` afterwards.**
      GitHub: "If you create a new repository or fork at the previous repository
      location, the redirects to the transferred repository will be permanently
      deleted" ([docs][transfer]). Do not fork the moved repository back into the
      personal account under the same name.
- [ ] Point every local clone at the new URL (GitHub recommends it even though git
      redirects): `git remote set-url origin https://github.com/<org>/boston-ai-atlas.git`

## 3. What carries over — and what doesn't

| Thing | After the transfer | Source |
|---|---|---|
| Issues, pull requests, wiki, stars, watchers | Move with the repository | Confirmed ([docs][transfer]) |
| Git history and contribution credit | Preserved | Confirmed ([docs][transfer]) |
| **Actions secrets**, webhooks, services, deploy keys | "Remain associated after the transfer" — the 8 secrets should still be there. (No webhooks or deploy keys exist today.) | Confirmed ([docs][transfer]) |
| Web links and `git clone` / `fetch` / `push` to the old URL | Redirected to the new location | Confirmed ([docs][transfer]) |
| GitHub Pages URLs | Not redirected — **does not matter here**: the atlas is not on Pages (checked) | Confirmed ([docs][transfer]) |
| Issue assignees | Kept only for people who are members of the organization; all others are cleared | Confirmed ([docs][transfer]) |
| `raw.githubusercontent.com/holzerjm/...` URLs (the README's count badge, links in `docs/carto-to-openfreemap.md`) | **Unconfirmed** — the transfer page does not mention raw URLs. Update them (step 5) rather than rely on it | — |
| `api.github.com/repos/holzerjm/boston-ai-atlas/...` (the server trigger script) | **Unconfirmed** — not on the transfer page. The script calls curl without following redirects, so treat it as broken until step 6 is done | — |
| **Labels** | **Unconfirmed** — the transfer page does not mention them. Expected to move with the repository; run `scripts/setup-labels.sh` anyway (step 5), it is idempotent | — |
| Workflows and their schedules | **Unconfirmed** — not on the transfer page. Check every workflow is still "active" (step 8) | — |
| **The bot's GitHub App installation** | **Does not follow.** The App is installed on the account that owned the repo. A private App "can only be installed on the user or organization account of the app owner" ([docs][app-private]), so a personal App cannot simply be installed on the org | Confirmed for private Apps; step 4 |
| **The server's fine-grained token** | **Stops working.** A fine-grained token can only reach resources owned by the resource owner chosen when it was created ([docs][pat]) — today that is @holzerjm, not the org | Confirmed; step 6 |
| Branch protection / rulesets | Nothing to carry — none exist today. Create them in step 7 | Checked 2026-09-30 |
| `CODEOWNERS` | A file, so it moves. Owners must have write access to the new repository, or their lines are ignored ([docs][codeowners]) | Confirmed |

## 4. Reinstall (and re-scope) the bot's GitHub App

The suggestion bot (`suggest-to-pr.yml`) mints its token from `ATLAS_APP_ID` +
`ATLAS_APP_PRIVATE_KEY`. Pick one:

- [ ] **A — transfer the App to the org (preferred).** App settings → Advanced →
      *Transfer ownership* → the organization ([docs][app-transfer]). GitHub warns if
      this uninstalls it from your account — expected. Then, as an org owner, install
      it on the org with **Only select repositories → `boston-ai-atlas`** and exactly
      these permissions: Contents **read & write**, Pull requests **read & write**,
      Metadata read. Nothing else.
      *Unconfirmed:* whether the App ID and existing private keys survive a transfer.
      Compare the App ID with `ATLAS_APP_ID`, and generate a fresh private key anyway:
      update `ATLAS_APP_PRIVATE_KEY`, then delete the old key (`SECRETS.md` §1).
- [ ] **B — register a new App owned by the org** with the permissions above, install
      it on this repository only, set both secrets, then delete the old personal App.
- [ ] Either way: uninstall any leftover installation on @holzerjm's account that no
      longer covers anything.
- [ ] Do **not** fall back to `ATLAS_BOT_PAT` unless the App route is impossible — a
      personal token ties the bot to one person again.

## 5. Labels and hardcoded repository URLs

- [ ] Recreate / re-sync the labels (GitHub silently drops a label an issue form asks
      for when the label doesn't exist — that is how issues #12/#13 arrived
      unlabelled in August):
      ```bash
      scripts/setup-labels.sh <org>/boston-ai-atlas
      gh label list --repo <org>/boston-ai-atlas
      ```
- [ ] Open one PR that replaces `holzerjm/boston-ai-atlas` everywhere (list below).
- [ ] Merge that PR. It touches `index.html`, so it deploys: the live ➕ / 🚩 links now
      open the new repository's forms.

Regenerate the list of places with:

```bash
git grep -n -e 'holzerjm/boston-ai-atlas' -e 'holzerjm%2Fboston-ai-atlas' -e 'GH_REPO ='
```

Snapshot on the Part A branch, 2026-09-30 (line numbers will drift):

| File:line | What | Notes |
|---|---|---|
| `index.html:665` | `const GH_REPO = "holzerjm/boston-ai-atlas"` | Drives the ➕ Suggest / 🚩 Flag issue links and the nav GitHub icon. **The one that matters most.** |
| `index.html:616` | Footer "reviewed openly on GitHub" link, hardcoded | Not driven by `GH_REPO` |
| `scripts/build-events-page.js:141, 150, 153` | Three "suggest an event" form links | Its footer link already derives from `GH_REPO` (line 48) |
| `events/index.html:154, 163, 166, 189` | Generated copies of the above | Never hand-edit: re-run `node scripts/build-events-page.js` |
| `README.md:3` | CI status badge + link | |
| `README.md:4` | Entry-count badge via `raw.githubusercontent.com/holzerjm%2Fboston-ai-atlas/…/badge.json` | Or replace it — see step 7 (badge) |
| `scripts/export-json.js:36` | `source:` field of the public `atlas.json` | |
| `scripts/fetch-events.js:25, 234` | User-Agent string and `source:` of `events.json` | |
| `scripts/issue-to-entry.js:146` | User-Agent sent to Nominatim (their usage policy wants a contact) | |
| `scripts/trigger-weekly-events.sh:16, 30` | Comment and `REPO=` — **the copy installed on the server must be updated too** (step 6) | |
| `docs/events-guide.md:83, 103` | `gh workflow run --repo …` example and the suggest-event link | |
| `docs/carto-to-openfreemap.md:172, 174, 181` | Links to the dark style and the doc itself (raw URLs) | |
| `PROJECT_STATE.md:12, 125-126` | Repo link and the `GH_REPO` note | |
| `SECRETS.md`, `.github/CODEOWNERS`, `scripts/setup-labels.sh` usage example | Owner handle and examples | Update owners once the org team exists |

Not affected: the workflows build URLs from `${{ github.repository }}`;
`CONTRIBUTING.md` uses relative links; `~/.config/boston-ai-atlas/` on the
server is just a folder name. Outside this repository only comments mention it
(`~/notes/OpenAccelerator/TOAsite/.rsync-exclude:7`, `eleventy.config.js:41`).

## 6. Re-scope the server's trigger token (`toa-forge`)

The Monday events refresh is started by `scripts/trigger-weekly-events.sh` from the
`forge` user's crontab on the origin server, using a fine-grained token in
`~/.config/boston-ai-atlas/github-token`. After the transfer it can no longer reach the
repository, and the Monday post quietly falls back to GitHub's unreliable crons.

- [ ] Create a new fine-grained token: **Resource owner = the organization**,
      Repository access = **only `boston-ai-atlas`**, Permissions = **Actions: Read and
      write**, nothing else; expiry 1 year (calendar reminder a month before). If you
      are not an org owner it shows as *pending* until an owner approves it
      ([docs][pat-policy]).
- [ ] On the server: replace the token file (keep mode 600), copy the updated script
      (step 5) over `~/bin/trigger-weekly-events.sh`, and run it once by hand. The
      workflow run it starts in the new repository should say `Gate: skipped` if this
      week's refresh already happened.
- [ ] Revoke the old token at github.com/settings/personal-access-tokens. Add a line
      to the rotation log in `SECRETS.md`.

## 7. Code owners and a ruleset on `main` — with NO bypass actors

The goal: nothing reaches `main` (which auto-deploys) except through a reviewed pull
request, and no person or bot is exempt. Rulesets let you list bypass actors; leave
that list **empty** ([docs][rulesets]).

**First, stop the one bot that pushes to `main`.** The `badge` job in
`.github/workflows/validate.yml` commits `badge.json` straight to `main` after every
merge. With no bypass actors that push will fail. Proposed fix, in order of preference:

1. **Delete the badge commit entirely** (recommended). The public `atlas.json` already
   carries the count as `total` on every deploy, and shields.io can read it directly —
   checked on 2026-09-30, this renders "organizations: 171":
   `https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fthe-open-accelerator.com%2Fecosystem%2Fatlas.json&query=%24.total&label=organizations&color=60a5fa`
   Put that in `README.md:4`, remove the `badge` job, `scripts/badge.js` and
   `badge.json`. No bot writes to `main`, and the badge shows what is actually live.
2. Or have `deploy.yml` write `badge.json` to the server next to `atlas.json` and point
   the README's endpoint badge there. Also no push, but one more file to ship.
3. Not recommended: a badge PR on every merge (noise), or `github-actions[bot]` as a
   bypass actor (breaks the rule this step exists for).

Side effect to know: `monthly-health.yml` notes that the badge commits kept the repo
"active" so GitHub doesn't pause its cron after ~60 days. The monthly rota PRs are
activity too; if the repo ever goes quiet for two months, re-enable the workflow from
the Actions tab (the events workflow re-enables itself via the server trigger).

**Second, make the required check always report.** GitHub keeps a required check
*Pending* — and the PR unmergeable — when its workflow is skipped by a `paths` filter
([docs][skipped-checks]). `validate.yml` has `paths` filters, so a PR that only edits,
say, `docs/` would be stuck forever. Remove the `paths` filter from the
`pull_request` trigger (the checks take a minute), or add a small job that always runs
and is the one you mark required.

**Then create the ruleset** (repository Settings → Rules → Rulesets → New branch
ruleset), in two stages:

- [ ] **Stage 1 — now, while there is one maintainer.** Target: default branch.
      Bypass list: **empty**. Rules: *Restrict deletions*; *Block force pushes*;
      *Require a pull request before merging* with **0** required approvals (this
      blocks direct pushes but still lets the only maintainer merge their own PR);
      *Require status checks to pass* — the validate job (plus whatever else stream T
      wires in), after the `paths` fix above.
      Do **not** turn on "Require review from Code Owners" or ≥1 approval yet: GitHub
      never counts an author's own approval, and with no bypass actors the sole
      maintainer would be locked out.
- [ ] **Stage 2 — once a second owner exists.** Replace `@holzerjm` in
      `.github/CODEOWNERS` with an org team of at least two people (the file explains
      the planned two-person rule for sponsor-affiliated entries and narrative files).
      Then in the ruleset: required approvals **1**; *Require review from Code
      Owners*; *Dismiss stale approvals when new commits are pushed*; *Require approval
      of the most recent reviewable push*.
- [ ] Check the file parses: `gh api repos/<org>/boston-ai-atlas/codeowners/errors`
      should return an empty `errors` list.

Unaffected by the ruleset: the suggestion bot pushes to its own `suggestion/issue-N`
branches and opens draft PRs; `deploy.yml` runs on the merge commit; the events
workflow never pushes; the health workflow's `save-state` job pushes `health.json` to
the orphan `health-state` branch and nowhere else.

Keep the ruleset targeted at the **default branch only** (or, if you ever widen it to
all branches, exclude `health-state`). With no bypass actors, a rule on `health-state`
would reject that push, and because the save step is `continue-on-error` the run still
goes green: the monthly report arrives, but each month loses the previous baseline and
the rota's "what changed" rows quietly disappear.

*Unconfirmed:* the docs pages read for this checklist only spell out rulesets for
GitHub Team/Enterprise orgs; our understanding is that repository rulesets,
branch protection and code-owner review are available on **public** repositories in a
GitHub Free organization. Confirm the Rules tab exists in the new org before the
transfer; if it doesn't, classic branch protection offers the same rules.

## 8. Verify after the transfer

- [ ] `https://github.com/holzerjm/boston-ai-atlas` redirects to the new URL
      (`curl -sI` shows a redirect to the new location).
- [ ] `gh secret list --repo <org>/boston-ai-atlas` shows the same 8 names as the
      snapshot (values can't be read back — the workflow runs below prove them).
- [ ] `gh label list --repo <org>/boston-ai-atlas` shows the 4 atlas labels.
- [ ] All 5 workflows show *active* (Actions tab, or the `gh api …/actions/workflows`
      command from step 1).
- [ ] **Deploy:** Actions → *Deploy to TOA site* → *Run workflow*. Green, the live check
      passes, and the Slack post lands. This exercises `DEPLOY_*` and
      `SLACK_WEBHOOK_URL`.
- [ ] **Events trigger:** run `~/bin/trigger-weekly-events.sh` on the server; a run
      appears in the new repository (normally `Gate: skipped`). Don't dispatch with
      *force* unless you mean to post to the Scouts channel.
- [ ] **Suggestion bot:** open a test issue with the ➕ form from the **live site**
      (proves `GH_REPO` and the `new-entry` label), add `bot:draft`, confirm a draft PR
      opens as the App and the validate check runs on it. Close the PR, delete the
      branch, close the issue.
- [ ] **Flag and events forms:** 🚩 Flag on any entry opens the new repo's form with the
      `flag` label; the events page's *Add your event* opens the suggest-event form.
- [ ] **Ruleset:** a direct `git push` to `main` is rejected; a PR that touches only a
      doc gets its required check and can merge.
- [ ] If the `health-state` branch existed before the move, it is still there (branches
      move with the repository). After the next monthly run, check that its `save-state`
      job pushed a new commit — a failed push is hidden behind `continue-on-error`, so
      open the job rather than trusting the green tick.
- [ ] README badges render from the new location.
- [ ] Clean up: old personal token revoked; old App key (or old App) deleted; any
      stale personal App installation removed.
- [ ] Update `SECRETS.md` (owners, second owner, backup responder, rotation log) and
      `PROJECT_STATE.md` (repo URL, `GH_REPO` note).

**Rolling back:** an org owner can transfer the repository back the same way; the same
caveats apply in reverse (App installation, token resource owner, hardcoded URLs).

[transfer]: https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository
[app-private]: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private
[app-transfer]: https://docs.github.com/en/apps/maintaining-github-apps/transferring-ownership-of-a-github-app
[pat]: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
[pat-policy]: https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization
[rulesets]: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository
[codeowners]: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners
[skipped-checks]: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks
