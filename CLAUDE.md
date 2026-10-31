# CLAUDE.md: Team TBTT · Chart the Common Wealth Hackathon

Read this file fully before doing anything. It applies to every Claude Code session on this team.

## What we're building (2-hour build)
We're 3 students. The repo is the **Mass AI Atlas** (197 Massachusetts AI organizations in `data/entities.yml`, published as `atlas.json` / `atlas.csv`). We are building two connected parts:

1. **Heartbeat** (owner: Seat A): a deterministic verification pipeline. For each org, it collects dated, permanent records from independent witnesses (SEC EDGAR Form D filings and the Internet Archive Wayback CDX; the IRS via ProPublica if time allows). It matches each record to an Atlas org with a confidence level, refuses bad matches, and writes one case file per org with a status: `ALIVE_CORROBORATED`, `ALIVE_SINGLE`, `QUIET`, `FLATLINE`, or `CONFLICT`. A human reviews the results before anything touches the data.
2. **Ask the Atlas** (owners: Seats B and C): a chatbot for founders. A query like "pre-seed healthtech, need lab space" returns a ranked list of Atlas orgs. **Every result shows its heartbeat status and clickable sources.** It says "not in the Atlas" when nothing fits.

**Pitch:** "The Atlas says verified. We made it *truly tested*, and showed founders that trust."

## Seats and ownership (the no-conflict rule)
**Edit only your own folder.** You can read anything.

| Seat | Person | Role | Owns (edit only these) |
|---|---|---|---|
| A | **Arshmehar** | Heartbeat pipeline (SEC, Archive, matcher, cases, live command) | `heartbeat/**` |
| B | **Karthik** | Chatbot core: retrieval, ranking, Claude calls, the no-invented-orgs check | `chatbot/core/**` |
| C | **Bhoomika** | Chatbot app: UI, status badges, sources, doubt signals, demo flow. Also repo setup and shared files | `chatbot/app/**` |
| Shared | Bhoomika approves changes | Contracts, rules, config | `contracts/**`, `CLAUDE.md`, `.gitignore` |

Each part keeps its own dependency file: `chatbot/requirements.txt` (Karthik owns it; Bhoomika asks before adding to it). Heartbeat adds no new dependencies.

- **Never edit** `data/`, `scripts/`, `index.html` or any other original repo file. The only exception is Heartbeat's apply step, which runs only on items a human approved.
- To change a shared file, tell the team first. One person makes the change and the others pull.
- If you need something from another seat, ask. Don't edit their folder.

## How we work in parallel (each person runs their own Claude Code)
**Rule: two Claude Code sessions never edit the same file.** We split by folder and connect through the contracts below.

1. **Skeleton first (Karthik, first 10 minutes).** Create `chatbot/core/answer.py` with a stub `answer(query)` that returns a hard-coded result in the Contract 2 format. Create `chatbot/app/main.py` as a Streamlit page that calls it and displays the result. Push. Now the chatbot runs end to end.
2. **Then split.** Karthik replaces the stub with the real logic. Bhoomika builds the UI against the stub's output. Neither waits on the other.
3. **Heartbeat runs on its own.** The chatbot reads `contracts/sample-cases.jsonl` until Arshmehar's real `heartbeat/out/cases.jsonl` is ready, then `CASES_PATH` switches over.
4. **Integrate every 15–20 minutes:** pull, run the full app, push.
5. **If you run a second Claude Code session yourself,** give it a different subfolder and use a git worktree (`git worktree add ../tbtt-2`).

**Open every Claude Code session with your line:**
- Arshmehar: *"I'm Seat A (Arshmehar). Read CLAUDE.md. Only edit `heartbeat/`. Never change the `cases.jsonl` format without telling the team."*
- Karthik: *"I'm Seat B (Karthik). Read CLAUDE.md. Only edit `chatbot/core/` and `chatbot/requirements.txt`. Never change the signature or output format of `answer()`."*
- Bhoomika: *"I'm Seat C (Bhoomika). Read CLAUDE.md. Only edit `chatbot/app/` and the shared files. Read `answer()` output exactly as Contract 2 defines it."*

## Repo layout
```
contracts/
  cases.schema.md        # the contract between Heartbeat and the chatbot (frozen)
  sample-cases.jsonl     # hand-written sample: the chatbot builds against this first
  answer.schema.md       # the contract between chatbot/core and chatbot/app (frozen)
heartbeat/               # Seat A · Node 20, repo's js-yaml, no new deps
  lib/ witnesses/ match/ case/ review/ probes/ bin/
  out/                   # generated, gitignored except cases.jsonl
  cache/                 # gitignored
chatbot/
  core/                  # Seat B · Python
  app/                   # Seat C · Python (Streamlit)
.env                     # gitignored: ANTHROPIC_API_KEY, CLAUDE_MODEL, CASES_PATH
```

## Contract 1: `cases.jsonl` (Heartbeat → chatbot)
One JSON object per line, one per Atlas org. UTF-8, dates `YYYY-MM-DD`.
```json
{"id":"nextview","name":"NextView Ventures","cat":"vc",
 "status":"ALIVE_CORROBORATED",
 "witnesses":[{"source":"sec","event":"form_d","date":"2026-02-12","record_name":"NextView Ventures VI, L.P.","city":"Boston","state":"MA","url":"https://www.sec.gov/...","confidence":"high"},
              {"source":"archive","event":"homepage_capture","date":"2026-10-13","url":"https://web.archive.org/...","confidence":"high"}],
 "refusals":[],
 "checked_at":"2026-10-31"}
```
- `status` is one of `ALIVE_CORROBORATED | ALIVE_SINGLE | QUIET | FLATLINE | CONFLICT | NOT_CHECKED`
- The chatbot reads the path from `CASES_PATH`. Until Heartbeat's real file exists, it uses `contracts/sample-cases.jsonl`.
- **Orgs missing from cases.jsonl → show `NOT_CHECKED`.** Never crash.

## Contract 2: `answer()` (chatbot/core → chatbot/app)
`chatbot/core` exposes one function: `answer(query: str) -> dict`
```json
{"query":"...",
 "results":[{"id":"masschallenge","name":"MassChallenge","why":"short reason it fits, from Atlas fields only",
             "status":"ALIVE_CORROBORATED","atlas_url":"...","sources":[{"label":"SEC Form D 2026-02","url":"..."}],
             "doubts":["approximate pin","last verified 2026-06"]}],
 "not_found":"what we couldn't find in the Atlas, or null"}
```
`doubts` covers the six signals: approximate pin (`approx`), `lastVerified` month, startup with no `stages`, no `links`, funder with no check size, and `applyBy` (rolling, dated or past).

## Truth rules (these affect our score, so never break them)
- **Never invent an organization.** The chatbot answers **only** from `atlas.json` plus `cases.jsonl`. Claude may rank and explain, but every result `id` must exist in `atlas.json`. Validate this in code and drop anything that doesn't match.
- **Every claim has a source URL.** No URL means it isn't shown.
- **Never present an inference as a verification.** "Alive" is shown as dated evidence. Only a human stamps `lastVerified`.
- **Organizations, not people.** Never read or store SEC "related persons", IRS officers, or any personal names or contacts.
- **Massachusetts only.** An out-of-state record is a `CONFLICT`, never evidence.
- **Heartbeat has no AI in the verification path.** It's deterministic, so a rerun gives the same answer.
- Say "needs review" or "not in the Atlas" instead of guessing.

## Tech conventions
- **Heartbeat:** Node 20+, built-ins plus `js-yaml`. All HTTP goes through `heartbeat/lib/http.js`: an honest user agent with a team email (the SEC requires one), roughly 1 request per second per host (under 10 for the SEC), back off on 429/503, cache every response, and support `--live`.
- **Chatbot:** Python 3.11, Streamlit for the UI, the `anthropic` SDK. The model comes from the `CLAUDE_MODEL` env var. The key comes **only** from `.env`, never hard-coded and never committed.
- Load Atlas data from a local copy of `atlas.json` that you download once at the start. A mid-day merge must not change our demo.
- Keep it simple: no new frameworks, no databases, no Docker.

## Git workflow
- Everyone works on `main` in their own folder only.
- **Before every push:** `git pull --rebase`, then push. Commit small and often (every 15–20 minutes).
- Commit message format: `[arshmehar] sec witness`, `[karthik] retrieval`, `[bhoomika] badges`.
- Never `git push --force`. Never commit `.env`, `heartbeat/cache/`, or large files.
- If a rebase conflict appears outside your folder, **stop and tell the team**. Don't resolve someone else's file.
- Bhoomika tags the demo commit at freeze: `git tag demo`.

## Timeline (2 hours from start = T)
| Time | Goal |
|---|---|
| T+0:15 | Setup done. **Bhoomika:** contracts and sample committed. **Karthik:** chatbot skeleton pushed. **Everyone:** repo runs and `.env` works |
| T+0:45 | **Checkpoint 1.** Arshmehar: a real case for NextView. Karthik: real retrieval on the sample file. Bhoomika: badges and sources showing |
| T+1:20 | **Checkpoint 2.** The real `cases.jsonl` (at least the 52 stale entries) is wired into the chatbot end to end |
| T+1:45 | **Feature freeze.** Only bug fixes. Bhoomika records the backup video, Karthik writes the brief, Arshmehar saves validator output, Bhoomika tags `demo` |
| T+2:00 | Code freeze. Rehearse the 4-minute demo twice |

**Cut order if behind:** IRS witness → review queue polish → chatbot extras. **Never cut:** the matcher's refusals, sources on screen, the no-invented-orgs check, live runs.

## Demo must-haves (judges will test these)
- `heartbeat <any org> --live` runs on an org the judges pick.
- The chatbot answers a query the judges type themselves.
- Every source is clickable and actually supports the claim.
- Show one refusal (e.g. Pillar VC: the name appears in someone else's filing) and one conflict (e.g. Flybridge: filing address in New York).
- Before → after numbers on screen.

## How Claude Code should behave here
- Start each session by restating your seat and folder.
- Make small changes and run them immediately. Don't build big untested chunks.
- Don't use web search or fetch tools to collect pipeline data. Only the pipeline's own code fetches data.
- Ask before adding a dependency or touching a shared file.
- When unsure about a rule, choose the more honest option ("needs review").
