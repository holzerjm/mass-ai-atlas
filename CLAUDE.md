# CLAUDE.md: Team TBTT · Chart the Common Wealth Hackathon

Read this file fully before doing anything. It applies to every Claude Code session on this team.

## The setup: two projects, one repo
The repo is the **Mass AI Atlas**: 197 Massachusetts AI organizations in `data/entities.yml`, published as `atlas.json` / `atlas.csv`. We submit **two projects**:

| Track | Project | People |
|---|---|---|
| **A: The Survey** (backend data) | **Missing connections:** propose sourced `links` for isolated entries, which moves probe 2 | **Arsh** |
| **B: The Passage** (founder experience) | **Ask the Atlas:** a chatbot that gives founders a ranked, sourced shortlist and shows every doubt signal | **Karthik** (engine) + **Bhoomika** (panel) |

**How they connect:** the chatbot shows doubt signals such as "no connections" and "approximate pin". Arsh's proposed links feed into the chatbot through a **before/after toggle**, so in the demo, "no connections" disappears from an entry live, with the source sentence shown.

## Seats and ownership (the no-conflict rule)
**Edit only your own paths.** You can read anything.

| Person | Role | Owns (edit only these) |
|---|---|---|
| **Arsh** | Track A: link extraction, matching, confidence, review queue, probe numbers | `survey/**`, and the `proposals` branch |
| **Karthik** | Track B engine: data loading, retrieval, ranking, Claude calls, the no-invented-orgs check | `chatbot/core/**`, `chatbot/requirements.txt` |
| **Bhoomika** | Track B panel: UI, doubt badges, sources, before/after toggle, demo flow. Also repo setup and shared files | `chatbot/app/**`, `contracts/**`, `CLAUDE.md`, `.gitignore` |

- **Never edit `data/`, `scripts/`, `index.html` or any other original repo file on `main`.**
- Arsh's `data/entities.yml` changes go **only** on the `proposals` branch, and only after a human approves each one.
- To change a shared file or a contract, tell the team first. Bhoomika makes the change and the others pull.
- If you need something from another person's folder, ask. Don't edit it.

## How we work in parallel (each person runs their own Claude Code)
**Rule: two Claude Code sessions never edit the same file.**

1. **Skeleton first (Karthik, first 10 minutes).** Create `chatbot/core/answer.py` with a stub `answer(query, mode)` that returns a hard-coded result in the Contract 2 format, and `chatbot/app/main.py` as a Streamlit page that calls it. Push. The chatbot now runs end to end.
2. **Then split.** Karthik replaces the stub with real logic. Bhoomika builds the panel against the stub's output. Arsh works independently in `survey/`.
3. **Sample first.** Bhoomika commits `contracts/sample-proposed-links.json` (3–5 rows using real Atlas ids), so the toggle can be built before Arsh's real output exists.
4. **Integrate every 15–20 minutes:** pull, run, push.
5. **A second session of your own** must use a different subfolder and a git worktree (`git worktree add ../tbtt-2`).

**Open every Claude Code session with your line:**
- Arsh: *"I'm Arsh (Track A). Read CLAUDE.md. Only edit `survey/`. Data edits only on the `proposals` branch, only for approved items. Never change the proposed-links format without telling the team."*
- Karthik: *"I'm Karthik (Track B engine). Read CLAUDE.md. Only edit `chatbot/core/` and `chatbot/requirements.txt`. Never change the signature or output format of `answer()`."*
- Bhoomika: *"I'm Bhoomika (Track B panel). Read CLAUDE.md. Only edit `chatbot/app/` and the shared files. Read `answer()` output exactly as Contract 2 defines it."*

## Repo layout
```
contracts/
  proposed-links.schema.md        # Contract 1 (frozen)
  sample-proposed-links.json      # sample so the toggle works before Arsh's output exists
  answer.schema.md                # Contract 2 (frozen)
survey/                           # Arsh · Track A
  out/proposed-links.json         # Arsh's output: the only survey file the chatbot reads
  out/probes.json                 # before/after numbers
  cache/                          # gitignored
chatbot/
  data/atlas.json                 # frozen local copy, downloaded once at the start
  core/                           # Karthik · Python
  app/                            # Bhoomika · Python (Streamlit)
  requirements.txt
.env                              # gitignored: ANTHROPIC_API_KEY, CLAUDE_MODEL, ATLAS_PATH, LINKS_PATH
```

## Contract 1: `proposed-links.json` (Arsh → chatbot)
A JSON array, one object per proposed link:
```json
[{"from_id":"example-startup","to_id":"example-accel","relation":"hosted_at",
  "source_url":"https://example.org/about",
  "quote":"the exact sentence from the page that supports this link",
  "confidence":"high",
  "status":"approved"}]
```
- Both `from_id` and `to_id` must exist in `atlas.json`.
- `relation` must match what `data/entities.schema.yml` allows for `links`. Arsh confirms this from the schema and updates this contract at the start.
- `confidence` is `high | medium | low`. `status` is `approved | pending | rejected`.
- **The chatbot shows `approved` links as connections, `pending` ones only as "proposed, needs review", and never shows `rejected` ones.**
- The chatbot reads the path from `LINKS_PATH`. Until Arsh's real file exists, it uses `contracts/sample-proposed-links.json`.
- **Arsh gives a heads-up before any change to ids, fields, or this format.** The chatbot reads `links`, `facts`, `approx` and `lastVerified`.

## Contract 2: `answer()` (chatbot/core → chatbot/app)
`answer(query: str, mode: "before" | "after") -> dict`
- `before`: original `atlas.json` only.
- `after`: `atlas.json` plus Arsh's approved links.
```json
{"query":"...","mode":"after",
 "results":[{"id":"...","name":"...","why":"short reason it fits, from Atlas fields only",
             "atlas_url":"...",
             "connections":[{"to_id":"...","relation":"...","source_url":"...","quote":"...","new":true}],
             "doubts":["approximate pin","last verified 2026-06","no stage listed"]}],
 "not_found":"what we couldn't find in the Atlas, or null"}
```
**The six doubt signals** (Track B is scored on showing all of them):
1. approximate pin (`approx: true`)
2. the month the entry was last verified (`lastVerified`)
3. a startup with no `stages`
4. an entry with no `links`
5. a funder with no check size
6. a deadline (`applyBy`) that is rolling, dated, or past

## Truth rules (both tracks, never break them)
- **Never invent an organization.** The chatbot answers **only** from `atlas.json` plus approved links. Every result id must exist in `atlas.json`. Check this in code and drop anything that doesn't match.
- **Every claim has a source URL.** No URL means it isn't shown or proposed.
- **Never present an inference as a verification.** Proposed links are labeled as proposed until a human approves them.
- **Organizations, not people.** Never store or output data about individuals or any personal contact details.
- **Massachusetts only.** An out-of-state org is a false positive.
- **Public pages and documented APIs only.** Never use platforms whose terms forbid automated collection (no LinkedIn, Crunchbase, PitchBook or scraping search engines).
- Say "needs review" or "not in the Atlas" instead of guessing.

## Track A specifics (Arsh)
- Output must pass `node scripts/validate.js` on the `proposals` branch. **A validator failure caps Track Excellence at 2.**
- Every proposed link carries `source_url` plus the exact `quote`.
- Track Excellence needs a **before/after on screen** plus **at least two of:** a review queue a maintainer could use, dedup against existing links, multi-source corroboration, calibrated confidence, a new probe.
- Confirm the official probe 2 number at the probe reveal (our count was 74 isolated entries; the organizers' page says 104 with zero edges).
- Keep a list of every domain fetched, for the declared sources list.

## Track B specifics (Karthik + Bhoomika)
- A founder who has never seen it reaches a defensible shortlist unaided and knows what to do next.
- All six doubt signals show **before** the action they should change. A confident entry still looks confident.
- A dead end says so and offers an alternative.
- It works on a phone-width screen and with the keyboard alone.
- Judges will type their own query, so test off-script queries all session.

## Tech conventions
- **Survey:** Arsh's choice (Node 20 with the repo's `js-yaml`, or Python). Honest user agent, about 1 request per second per host, cache responses in `survey/cache/`.
- **Chatbot:** Python 3.11, Streamlit, the `anthropic` SDK. The model comes from the `CLAUDE_MODEL` env var. The key comes **only** from `.env`, never hard-coded or committed.
- The chatbot reads the frozen `chatbot/data/atlas.json`, so a mid-day merge can't move our demo.
- Keep it simple: no new frameworks, no databases, no Docker.

## Git workflow
- Everyone works on `main`, in their own paths only. Arsh's data edits go only on `proposals`.
- **Before every push:** `git pull --rebase`, then push. Commit small and often (every 15–20 minutes).
- Commit message format: `[arsh] link extractor`, `[karthik] retrieval`, `[bhoomika] doubt badges`.
- **No Claude trace in the repo:** no "Generated with Claude" or Co-Authored-By lines in commits, and never commit `.claude/` or local session files.
- Never `git push --force`. Never commit `.env`, caches, or large files.
- If a rebase conflict appears outside your paths, **stop and tell the team**. Don't resolve someone else's file.

## Timeline
| Time | Goal |
|---|---|
| Start + 0:15 | **Bhoomika:** contracts and sample committed. **Karthik:** skeleton pushed. **Arsh:** link format confirmed from the schema, "before" probe number recorded |
| Midpoint | **Checkpoint.** Arsh: first real proposed links with sources. Karthik: real retrieval and all six doubts. Bhoomika: panel and toggle working on the sample |
| 2:00 | Arsh's real `proposed-links.json` is wired in, and the toggle shows real before/after |
| **2:30** | **Feature freeze.** Only bug fixes |
| 2:45 | Arsh: before/after probe numbers final. Backup videos recorded (Bhoomika for Track B, Arsh for Track A) |
| **3:15** | **Both tracks submitted:** public repo, 2-min YouTube video, 1-page brief, declared track, declared sources. Arsh adds validator output |
| 3:45 | Demos. Rehearse twice before. If rooms are parallel, Arsh presents Track A alone |

**Cut order if behind:** chatbot polish → pending-link display → extra probes. **Never cut:** sources on screen, the no-invented-orgs check, the human approval gate, a passing validator, live runs.

## Demo must-haves (judges will test these)
- **Track A:** before/after on probe 2 on screen. One refused link (a source that didn't support it). Click any `source_url`, and the quote is on that page.
- **Track B:** the chatbot answers a query the judges type. All six doubts are visible. Every source is clickable. Flip the before/after toggle: "no connections" disappears, with the source sentence shown.

## How Claude Code should behave here
- Start each session by restating who you are and your paths.
- Make small changes and run them immediately. Don't build big untested chunks.
- Ask before adding a dependency or touching a shared file.
- When unsure about a rule, choose the more honest option ("needs review").
