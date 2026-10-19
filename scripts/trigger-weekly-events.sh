#!/usr/bin/env bash
# Reliable alarm clock for the "Weekly events refresh" GitHub workflow.
#
# GitHub's own cron scheduler delivers this repo's Monday firings hours late
# or not at all (observed: 5-6h late on 2026-09-07, none by 9am on
# 2026-09-14). This script runs from a plain cron on the origin server and
# asks GitHub to start the workflow via workflow_dispatch — with NO inputs, so
# the workflow's own once-a-week gate decides whether this run does the work.
# The server cron and GitHub's fallback crons can therefore both fire without
# ever producing a double refresh; only a human passing force=true skips it.
#
# Also self-heals GitHub's "workflow disabled after 60 days without pushes":
# if the workflow is not active, it is re-enabled before dispatching.
#
# Needs a fine-grained personal access token with ONLY
#   Repository access: holzerjm/mass-ai-atlas
#   Permissions:       Actions → Read and write
# stored (mode 600) in $TOKEN_FILE. Optional: a Slack incoming-webhook URL in
# $ALERT_FILE — failures are then posted there as well as logged.
#
# Install (as the forge user on the origin server):
#   mkdir -p ~/bin ~/.local/log ~/.config/mass-ai-atlas && chmod 700 ~/.config/mass-ai-atlas
#   cp scripts/trigger-weekly-events.sh ~/bin/ && chmod +x ~/bin/trigger-weekly-events.sh
#   crontab -e →  1 11 * * 1  ~/bin/trigger-weekly-events.sh >> ~/.local/log/weekly-events.log 2>&1
#                 1 12 * * 1  (same)      # 11:01 UTC = 7am EDT, 12:01 UTC = 7am EST; the gate skips the wrong one
#                 1 13 * * 1  (same)      # spare, in case api.github.com was unreachable
#                 1 12 * * 2  (same)      # Tuesday retry if Monday never happened
set -euo pipefail

REPO="holzerjm/mass-ai-atlas"
WORKFLOW="weekly-events.yml"
CONF="${CONF:-$HOME/.config/mass-ai-atlas}"
# Installs that predate the boston-ai-atlas → mass-ai-atlas rename keep their
# existing config dir, so the server needs no directory move. Written as an `if`
# because a bare `[ ... ] && ...` returning 1 would trip set -e and the ERR trap.
if [ ! -d "$CONF" ] && [ -d "$HOME/.config/boston-ai-atlas" ]; then
  CONF="$HOME/.config/boston-ai-atlas"
fi
TOKEN_FILE="${TOKEN_FILE:-$CONF/github-token}"
ALERT_FILE="${ALERT_FILE:-$CONF/alert-webhook}"
ATTEMPTS="${ATTEMPTS:-3}"
API="https://api.github.com/repos/$REPO/actions/workflows/$WORKFLOW"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }
shout() {   # post to the alert webhook, if configured
  [ -r "$ALERT_FILE" ] || return 0
  local msg="$*"; msg=${msg//\"/\'}; msg=${msg//\\/ }; msg=$(printf '%s' "$msg" | tr -d '\000-\037')
  curl -sS --max-time 20 -X POST -H 'Content-type: application/json' \
    -d "{\"text\":\"$msg\"}" "$(tr -d '[:space:]' < "$ALERT_FILE")" >/dev/null 2>&1 || log "(alert webhook also failed)"
}
alert() {   # log loudly, shout, exit 1
  log "ERROR: $*"; shout "⚠️ Weekly events refresh: the server-side trigger on $(hostname) failed — $*"; exit 1
}
trap 'alert "unexpected failure at line $LINENO"' ERR

[ -r "$TOKEN_FILE" ] || alert "token file $TOKEN_FILE is missing or unreadable (see the header of this script)"
TOKEN=$(tr -d '[:space:]' < "$TOKEN_FILE")
[ -n "$TOKEN" ] || alert "token file $TOKEN_FILE is empty"

BODY=$(mktemp); HDRS=$(mktemp); trap 'rm -f "$BODY" "$HDRS"' EXIT
gh_api() {   # gh_api METHOD URL [JSON] → sets CODE, response body in $BODY
  local args=(-sS --max-time 30 -o "$BODY" -D "$HDRS" -w '%{http_code}' -X "$1"
              -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json"
              -H "X-GitHub-Api-Version: 2022-11-28")
  [ -n "${3:-}" ] && args+=(-d "$3")
  CODE=$(curl "${args[@]}" "$2" 2>/dev/null) || CODE="000"
}
msg() { grep -o '"message": *"[^"]*"' "$BODY" 2>/dev/null | head -1 | sed 's/"message": *"//; s/"$//'; }

# 1) Self-heal a workflow GitHub disabled for inactivity.
gh_api GET "$API"
case "$CODE" in
  200)
    STATE=$(grep -o '"state": *"[^"]*"' "$BODY" | head -1 | sed 's/.*: *"//; s/"$//' || true)
    case "$STATE" in
      active) ;;
      disabled_inactivity)
        log "workflow was disabled for inactivity — re-enabling it"
        gh_api PUT "$API/enable"
        [ "$CODE" = "204" ] || alert "could not re-enable the workflow (HTTP $CODE $(msg))" ;;
      *) alert "workflow state is '${STATE:-unknown}' — someone disabled it on purpose? Not touching it" ;;
    esac
    # Fine-grained tokens expire (max 1 year). Warn for the last two weeks, while there is still time.
    EXP=$(grep -i '^github-authentication-token-expiration:' "$HDRS" | head -1 | sed 's/^[^:]*: *//; s/[[:space:]]*$//' || true)
    if [ -n "$EXP" ]; then
      EXP_S=$(date -d "$EXP" +%s 2>/dev/null || echo 0)
      if [ "$EXP_S" -gt 0 ] && [ $(( (EXP_S - $(date +%s)) / 86400 )) -lt 14 ]; then
        log "WARNING: the GitHub token expires on $EXP — rotate it (docs/events-guide.md)"
        shout "⚠️ Weekly events refresh: the server-side GitHub token on $(hostname) expires on $EXP — rotate it before then (docs/events-guide.md)"
      fi
    fi ;;
  401|403) alert "GitHub rejected the token (HTTP $CODE: $(msg)) — expired or wrong scopes? Rotate it, see docs/events-guide.md" ;;
  404)     alert "workflow $WORKFLOW not found in $REPO (HTTP 404) — was it renamed?" ;;
  *)       log "warning: could not read the workflow state (HTTP $CODE $(msg)); trying to dispatch anyway" ;;
esac

# 2) Dispatch. Retry only what can be transient (network, 5xx); 4xx means a human is needed.
for i in $(seq 1 "$ATTEMPTS"); do
  gh_api POST "$API/dispatches" '{"ref":"main"}'
  case "$CODE" in
    204)             log "dispatched $WORKFLOW (attempt $i)"; exit 0 ;;
    401|403|404|422) alert "dispatch refused (HTTP $CODE: $(msg)) — not retrying" ;;
    *)               log "dispatch attempt $i failed (HTTP $CODE $(msg))"
                     if [ "$i" -lt "$ATTEMPTS" ]; then sleep 120; fi ;;
  esac
done
alert "all $ATTEMPTS dispatch attempts failed"
