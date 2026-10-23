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
# Pointing the page at your own repository is the DEFAULT, because forgetting it
# is silent and lands on someone else's repository (see the GH_REPO block below).
# It is a no-op when they already match, so the original repo is unaffected.
SET_REPO=1
case "${2:-}" in
  --keep-repo) SET_REPO=0 ;;
  --set-repo)  SET_REPO=1 ;;   # accepted for anyone following older notes
  "")          ;;
  *) echo "Unknown option: $2" >&2; exit 2 ;;
esac
if [[ ! "$REPO" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
  echo "Usage: $0 <owner/repo> [--keep-repo]   e.g. $0 holzerjm/mass-ai-atlas" >&2
  echo "  Creates the four issue-form labels, and points index.html's GH_REPO at" >&2
  echo "  <owner/repo> so this copy's contribution buttons open issues on it." >&2
  echo "  --keep-repo  leave GH_REPO alone (warns if it points somewhere else)." >&2
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

# ---------------------------------------------------------------------------
# The other thing a copy does not inherit: index.html's GH_REPO.
#
# Both community buttons (+ Suggest an entry, and the flag on every entry) build
# their URL from `const GH_REPO` in index.html. Left at the upstream default, a
# copy's buttons file issues on SOMEONE ELSE'S repository — silently, because the
# page looks and behaves correctly either way. Found during the 2026-10-23 dry
# run of the hackathon setup path.
#
# This script already knows the repo you meant, so it is the right place to say so.
# ---------------------------------------------------------------------------
HTML="$(dirname "$0")/../index.html"
CURRENT="$(sed -n 's/^const GH_REPO = "\([^"]*\)".*/\1/p' "$HTML" | head -1)"

if [[ -z "$CURRENT" ]]; then
  echo "⚠ Could not find 'const GH_REPO' in $HTML — check the contribution buttons by hand." >&2
elif [[ "$CURRENT" == "$REPO" ]]; then
  echo "✓ index.html GH_REPO already points at $REPO"
elif [[ "$SET_REPO" == "1" ]]; then
  perl -pi -e "s{^const GH_REPO = \"\Q$CURRENT\E\"}{const GH_REPO = \"$REPO\"}" "$HTML"
  echo "✓ index.html GH_REPO: $CURRENT -> $REPO"
  # events/index.html is GENERATED from index.html and carries the same links, so
  # rewriting one without the other leaves the tree failing its own contract test
  # (tests/events.spec.js). Regenerate here rather than leaving it to be remembered.
  GEN="$(dirname "$0")/build-events-page.js"
  if command -v node >/dev/null 2>&1 && [[ -f "$GEN" ]]; then
    if node "$GEN" >/dev/null 2>&1; then
      echo "✓ events/index.html regenerated to match"
    else
      echo "⚠ Could not regenerate events/index.html — run: node scripts/build-events-page.js" >&2
    fi
  else
    echo "⚠ node not found — run: node scripts/build-events-page.js so the events page follows" >&2
  fi
  echo "  Commit both files."
else
  echo
  echo "⚠ index.html still points at $CURRENT, not $REPO (--keep-repo was given)."
  echo "  The + Suggest an entry and flag buttons on your page, and the events"
  echo "  page's + Add your event link, will open issues on $CURRENT."
  echo "  Change your mind with:  $0 $REPO"
fi
