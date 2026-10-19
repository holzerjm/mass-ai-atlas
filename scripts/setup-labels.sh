#!/usr/bin/env bash
# Create (or re-sync) the four issue labels the atlas's contribution loop depends on.
#
# Why this exists: GitHub SILENTLY skips a label that an issue form asks for when the
# label doesn't exist in the repo. Until 2026-08-28 `new-entry` and `flag` were
# missing, so issues #12/#13 arrived unlabelled and nobody noticed. Labels do not come
# along if the repo is recreated or forked, and the suggestion bot only runs on
# `bot:draft` — so after any move, and in any copy made from this template, run this first.
#
# Idempotent: `gh label create --force` creates a missing label and updates the colour
# and description of an existing one, so running it twice is harmless.
#
# Usage:   scripts/setup-labels.sh <owner/repo>
#   e.g.   scripts/setup-labels.sh holzerjm/mass-ai-atlas
# Needs:   the GitHub CLI (gh), logged in as someone with write access to that repo.
#
# Colours and descriptions mirror holzerjm/mass-ai-atlas as of 2026-10-19.
# Who uses each label:
#   new-entry         applied by .github/ISSUE_TEMPLATE/suggest-entry.yml
#   flag              applied by .github/ISSUE_TEMPLATE/flag-entry.yml
#   event-suggestion  applied by .github/ISSUE_TEMPLATE/suggest-event.yml
#   bot:draft         added BY A MAINTAINER to trigger .github/workflows/suggest-to-pr.yml
#                     (never auto-applied — that is the bot's trust boundary)
set -euo pipefail

REPO="${1:-}"
if [[ ! "$REPO" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
  echo "Usage: $0 <owner/repo>   e.g. $0 holzerjm/mass-ai-atlas" >&2
  exit 2
fi
command -v gh >/dev/null || { echo "The GitHub CLI (gh) is not installed: https://cli.github.com" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh is not logged in — run: gh auth login" >&2; exit 1; }

# name | colour (hex, no #) | description
LABELS=(
  "new-entry|4ade80|Community suggestion from the ➕ Suggest an entry form"
  "flag|EE0000|🚩 Report of an outdated or incorrect entry"
  "bot:draft|0e8a16|Maintainer-approved: let the suggestion bot draft this issue as a PR"
  "event-suggestion|fbca04|📅 Event or calendar suggestion for /ecosystem/events"
)

for row in "${LABELS[@]}"; do
  IFS='|' read -r name color desc <<<"$row"
  gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" --force >/dev/null
  echo "✓ $name"
done
echo "Labels in place on $REPO. Check: gh label list --repo $REPO"
