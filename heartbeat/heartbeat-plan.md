# Heartbeat: verifying the Mass AI Atlas by its paper trail

Track A ("The Survey") · Chart the Common Wealth · Saturday 31 October 2026
Team plan, written Friday 30 October.

> **No code tonight.** Hackathon rules say all code is written on the day. Everything in
> this doc is planning, reading and setup. The numbers below come from single test calls
> made tonight to check that each source works.

## TL;DR

- **Idea:** give every Atlas organization a *heartbeat*: dated, permanent records from
  independent witnesses (the SEC, the IRS, the Internet Archive). Together they show it is
  alive, where it is, and that it is the same organization. A human still signs off, in one
  minute instead of ten.
- **Why it's different:** everyone else will re-read websites, probably with AI. We use
  records that *other parties* made about the organization.
  **"Websites are testimony. Filings are evidence."**
- **What it moves:** the official probe "not verified since June" (52 today), through human
  review of heartbeat case files. Bonus: guessed pins (87 today). New probe: organizations
  with a corroborated heartbeat.
- **Build:** three seats in parallel. A = witnesses · B = identity & matching ·
  C = review gate, integration & demo. No AI in the verification path, no API keys, no
  headless browser.

---

## 1. The idea

### The problem

- The Atlas lists 197 organizations. "Verified" (`lastVerified`) means one person checked the
  organization, mostly by looking at its website.
- **52 entries haven't been checked since June:** 19 VCs, 9 accelerators, 8 startups,
  6 events, 4 communities, 3 angel groups, 2 spaces, 1 student org. 34 of those 52 also
  have a guessed pin.
- A website is the organization talking about itself. A dead startup's site can stay up
  for years, so re-reading websites can't tell you whether an organization is still alive.

### The unique angle

Ask **other parties** what they recorded the organization *doing*:

| When an organization… | …this witness records it | Permanent? |
|---|---|---|
| raises money (VC funds, startups) | **SEC** Form D filing | Yes, on sec.gov |
| files as a nonprofit (accelerators, communities) | **IRS** Form 990, read through ProPublica's API | Yes |
| changes its website, or the site disappears or redirects | **Internet Archive** (Wayback Machine) | Yes |
| wins a federal grant *(extension)* | **USAspending / NIH / NSF** | Yes |

**New definition of verified:** an organization is **alive (corroborated)** when at least
two independent witnesses recorded it recently and nothing conflicts. A human then confirms
and stamps `lastVerified`. The system never says "dead". No witness means
**flatline: needs review**.

### Why judges will notice

1. **New sources.** The organizers asked for new sources, and nobody else will bring SEC and
   IRS filings.
2. **A new definition of verified.** The organizers asked for that too.
3. **Every source is permanent.** "Click any source" works today and a year from now.
4. **Deterministic.** No AI decides anything, so "run it again" gives the same answer.
5. **No personal data.** The people sections of filings are never read.
6. **A metaphor anyone gets:** heartbeat, flatline.

---

## 2. How it works, end to end

```
 data/entities.yml (197 organizations)
        │
  ① Identity index ── name, name variants, website domain, city
        │
  ② Witnesses (independent; each one only fetches and records)
        ├─ SEC EDGAR ......... Form D filings
        ├─ IRS 990 ........... ProPublica Nonprofit Explorer API
        ├─ Internet Archive .. Wayback CDX API
        └─ (extension) ....... USAspending / NIH / NSF awards
        │
  ③ Matcher ── is this record the same organization? high / medium / low / refused
        │
  ④ Case file per organization ── Alive? Where? Same org? + proposals
        │
  ⑤ Review queue ── a human approves or rejects (one decisions file per reviewer)
        │
  ⑥ Apply ── edits only the approved lines in data/entities.yml, then the validator
        │
  ⑦ Probes ── before → after, calibration, refusals, sources list
```

### ① Identity index (Seat B)

For each of the 197 entries: id, name, category, website domain, city (from `loc`), and
**name variants** for searching registries. Examples: ".406 Ventures" → "406 Ventures";
"Bessemer Venture Partners (Boston)" → "Bessemer Venture Partners"; "NextView Ventures" →
"NextView". Variants come from simple rules plus a short hand list prepared tonight on paper.

### ② Witnesses (Seat A: SEC and IRS · Seat B: Archive)

Witness code **only fetches and records**. It never decides who a record belongs to.

- **SEC.** Search EDGAR full-text search for Form D and D/A filings from the last three years
  that contain the name or one of its variants. From each hit keep: filer name, form (new or
  amendment), filing date, business city and state, CIK, accession number, and a link to the
  filing. For pins only, open the filing's XML and read the issuer's street address.
  **Never read the "related persons" section**, because it lists people.
- **IRS via ProPublica.** Search Nonprofit Explorer by name with state = MA to get the EIN,
  legal name and city. The organization lookup gives the street address and the tax years
  filed. IRS data lags about two years, so it proves "exists and is registered here", not
  "active this year". Never read officer or compensation data.
- **Internet Archive.** Use the Wayback CDX API on the organization's homepage to get the
  latest capture date, HTTP status and any redirect target. A redirect to a different domain
  means a possible acquisition or rebrand, so it counts as a conflict. This also gives a
  permanent snapshot link showing what the site said and when. It is *supporting* evidence
  (the site is up), not proof that the organization is acting.

**Shared HTTP helper (Seat A builds it first, everyone uses it):**
- an honest user agent with the project name and a team contact email (the SEC requires one)
- a per-host rate limit, well under the SEC's 10 requests per second and about 1 per second
  elsewhere
- back off on 429 and 503, stop on 403
- every response cached (gitignored)
- a `--live` flag that skips the cache for the demo

### ③ Matcher (Seat B, the core truth risk)

| Level | Rule | Real example (30 Oct) |
|---|---|---|
| **High** | The filer name starts with the Atlas name or an approved variant, and the filer is in MA | "NextView Ventures VI, L.P.", Boston, MA → `nextview` |
| **Medium** | The name matches only after stripping suffixes, or the city differs within MA | |
| **Low** | Only partial overlap. Goes to review and never counts as a witness on its own | |
| **Refused: mention** | The Atlas name appears inside *another* filer's record | "Pillar VC" found in Glia AI, Inc.'s filing |
| **Conflict: location** | The organization's own filings list an address outside MA | Flybridge 2025, L.P. → New York, NY |

Filers whose name looks like a person's are dropped.

**Calibration, measured two ways:**
1. **Identity precision.** Blind-check 20–30 matches with the confidence level hidden, then
   report precision per level with the sample size.
2. **Liveness on known-alive organizations.** The 145 entries a human verified between August
   and October are our ground truth for "alive". Measure how many Heartbeat calls alive and
   how many it calls flatline. That number shows why flatline must never mean dead, and it
   is what we use to tune the "recent" windows below.

### ④ Case file (Seat C)

Every organization gets three answers, each with its witnesses: **Alive? Where? Same org?**

How recent counts as recent. These are starting guesses, tuned at 1:15 against the 145
known-alive entries:

| Witness | Strength | Counts as recent if… |
|---|---|---|
| SEC Form D / D/A | strong | filed in the last 36 months (funds raise every few years) |
| Federal award *(extension)* | strong | active, or started in the last 24 months |
| IRS 990 | medium | latest tax year within the last 3 years |
| Internet Archive | supporting | captured in the last 90 days, status 200, same domain |

| Status | Rule | What the system says |
|---|---|---|
| **ALIVE · corroborated** | 2+ recent witnesses from different sources, at least one strong or medium, no conflict | Ready for a human to re-verify |
| **ALIVE · single** | Exactly one recent witness | Needs a second source |
| **QUIET** | Witnesses found, none recent | Needs review |
| **FLATLINE** | No witnesses found | Needs review. Not evidence it's dead |
| **CONFLICT** | Own filings outside MA, or the site redirects to another domain | Needs review first |

| Proposal | Allowed when | Writes |
|---|---|---|
| **Re-verify** | ALIVE · corroborated, location agrees, no conflict, **and** a human confirms the entry still reads right and checks any `facts` | `lastVerified: 2026-10` |
| **Sharpen pin** *(stretch)* | Two independent witnesses give the same street address, for example a filing plus the archived contact page. Geocoded with OpenStreetMap Nominatim at 1 request per second, as the repo's suggestion bot already does | `loc`, `lat`, `lng`, remove `approx` |
| **Flag** | Any conflict | Nothing. A drafted note for the maintainer, never auto-posted |

Universities, corporates and government orgs are institutional and not at risk. None of
them are in the stale 52, so we don't spend review time on them.

### ⑤ Review queue (Seat C)

- A terminal tool. It shows the Atlas entry, the three answers, and each witness with its
  date, confidence and a clickable link.
- **Order:** conflicts first, then stale organizations with a corroborated heartbeat (fast
  wins), then quiet and flatline.
- **Keys:** approve, reject or skip, with an optional note.
- **Each reviewer writes their own decisions file**, so there are no merge conflicts. An
  approval needs at least one approve and no reject.

### ⑥ Apply (Seat C)

- Applies only approved proposals, and changes only the affected lines (`lastVerified`, and
  `loc`/`lat`/`lng`/`approx` for pins). It never re-saves the whole file.
- Then runs `node scripts/validate.js` and `node scripts/lint-copy.js`.
- Commits to a **`proposals`** branch in its own git worktree and opens a PR inside our fork,
  so CI runs. Nothing goes to the upstream repo during the event.

### ⑦ Probes and reports (Seat C, with B helping)

Prints before → after for every probe we touch, plus status counts, calibration numbers,
refusals by reason, and the declared-sources list, generated from the fetch log.

### The live command

`heartbeat <id | name | website>` runs steps ②–④ live for one organization and prints its
case file. It works for any of the 197. For an organization outside the Atlas it shows the
witnesses but proposes nothing.

This is a mockup, built from the real results of 30 Oct:

```
nextview · NextView Ventures · vc · Boston, Seaport (pin approximate)
  ALIVE · corroborated    WHERE · agrees (Boston, MA)    SAME ORG · high
  2025-02-13  SEC      Form D · NextView Ventures VI, L.P. · Boston, MA
  2026-02-12  SEC      Form D · NextView Ventures VI, L.P. · Boston, MA
  2026-10-13  ARCHIVE  homepage captured · same site
  → proposal: re-verify (needs a human)

flybridge · Flybridge · vc · Back Bay, Boston (pin approximate)
  CONFLICT · own filings list New York, NY → needs review
  2024-11-27  SEC      Form D · Flybridge 2025, L.P. · New York, NY

pillar · Pillar VC · vc
  REFUSED · "Pillar VC" appears in Glia AI, Inc.'s filing (Belmont, MA).
            That is a mention, not Pillar's own record.
```

---

## 3. Proof it works (tested 30 Oct, single API calls)

| Source | Test | Result |
|---|---|---|
| SEC EDGAR full-text search | The 19 stale VCs, Form D since Oct 2024 | **8** have a filing with an MA address · **1** conflict (Flybridge, New York) · **1** wrong-filer hit caught (Pillar → Glia AI) · **9** none yet (need name variants, or genuinely quiet) |
| ProPublica Nonprofit API | MassChallenge, MassRobotics | MassChallenge: EIN 27-0382989, filings through tax year 2023, 10 Fan Pier Blvd Ste 300, Boston. MassRobotics: EIN 47-1919574 |
| Wayback CDX API | nextview.vc | 176 distinct versions since 2024, latest capture 13 Oct 2026 |
| USAspending, NIH RePORTER, NSF | MA AI awards | All respond (extension) |
| SBIR.gov API | Awards | 403, under maintenance. Not needed |

None of these need an API key, and none need a headless browser.

---

## 4. Scoring

### What moves

| Probe | Today | How Heartbeat moves it | Target |
|---|---|---|---|
| Not verified since June *(official)* | 52 | A human re-verifies using heartbeat case files | 25–35 left |
| Guessed pins *(official, stretch)* | 87 | Two witnesses agree on a street address | a few fewer |
| ALIVE · corroborated *(new)* | never measured | Measured at the 1:15 checkpoint | X of 197 |
| FLATLINE *(new)* | never measured | Measured; each one reviewed | — |

The official probes are revealed at 10:00. Our 52 and 87 are our own counts, and they match
the gaps the organizers published. Re-check them at 10:00.

### Rubric map

| Criterion | How we earn it | Caps we avoid |
|---|---|---|
| **Truth & Provenance** | Permanent sources, dates and confidence on every row, flatline = needs review, "alive" shown as evidence, and only a human stamps verified | Field with no source · fabricated org · no human gate · inference shown as verification · refusing everything |
| **Track Excellence** | Before/after on an official probe, **plus** review queue · dedup (fund names → Atlas ids) · two-witness corroboration · measured confidence · new probe | Validator failure |
| **Innovation** | New sources (SEC, IRS, Archive) and a new definition of verified | — |
| **Presentation** | Live run, the judges' pick, the heartbeat metaphor, and explaining *why* | Canned recording shown as live |

### The four judge questions

| Question | What we show |
|---|---|
| "Show me something your system refused." | Pillar (a mention, not its own record). People sections never read. Low-confidence names held back. "We refuse to call anything dead." Counts come from the refusals file. |
| "Run it again on this one I just picked." | `heartbeat "<name>" --live`. Any of the 197 works. If there are no witnesses, it says FLATLINE with the reasons, which is still an honest answer. |
| "Which probe failed this morning and passes now?" | Not verified since June: 52 → N, every stamp approved by a human. |
| "Click a source. Any source." | An SEC filing, a ProPublica page or a Wayback snapshot. All permanent. |

---

## 5. What goes into building it

**Stack:** Node 20+, the repo's own language. Read the data with `scripts/load-data.js` and
check it with the real validator. Built-ins only (`fetch`, `readline`, `crypto`, `fs`), plus
`js-yaml`, which is already installed. No new dependencies. Claude Code helps *build* it,
but nothing inside the pipeline calls an AI.

| # | Component | Seat | Input → output | Effort | Done when |
|---|---|---|---|---|---|
| 1 | Skeleton, CONTRACTS.md, root CLAUDE.md, contract check, `.gitignore` lines (`heartbeat/cache/`, `.env`) | C | → folders | Low | All three can run the empty pipeline |
| 2 | Shared HTTP helper (user agent, rate limit, cache, sha256, `--live`) | A | → `lib/http` | Low | Repeat calls come from the cache |
| 3 | Identity index and name variants | B | entities.yml → identity.json | Low | All 197 have variants, hand list applied |
| 4 | SEC witness | A | identity → raw-sec.jsonl | Medium | NextView returns its filings with links |
| 5 | IRS witness | A | identity → raw-irs.jsonl | Low | MassChallenge returns its EIN and address |
| 6 | Archive witness | B | identity → raw-archive.jsonl | Low | nextview.vc shows its latest capture and redirect check |
| 7 | **Matcher, confidence, refusals, conflicts** | B | raw-*.jsonl → witnesses.jsonl, refusals.jsonl | **High** | NextView high, Pillar refused, Flybridge conflict |
| 8 | Status rules and case files | C | witnesses → cases.jsonl | Medium | Every organization has a status and reasons |
| 9 | Review queue | C | cases → decisions-*.jsonl | Medium | 10 cases reviewed in 5 minutes |
| 10 | Apply and validate | C | decisions → diff on `proposals` | Medium–High | Validator passes and `git diff` shows only the intended lines |
| 11 | Probes and metrics | C | everything → metrics.json and a printed table | Low | Before → after printed |
| 12 | Calibration (blind sample, known-alive recall, window tuning) | B | witnesses → calibration.jsonl | Low | Precision per level with n |
| 13 | `heartbeat <org>` live command | B | id or name → printed case file | Low–Medium | Works on 5 organizations picked by teammates |
| 14 | Pin sharpening *(stretch)* | A | street addresses → proposals | Medium | Two-witness address, geocoded |
| 15 | Extension: witnesses in reverse *(stretch)* | A | award APIs → candidates | Medium | See section 10 |
| 16 | Deliverables: README probe line, sources list, brief, video, validator output | C + all | | Low | Submitted by 3:15 |

**Critical path:** identity index → SEC witness → matcher → status → review queue → human
review → apply → probes. Everything else runs beside it and is cut first.

---

## 6. The 3-person setup

### Seats

| Seat | Owns | Who |
|---|---|---|
| **A · Witnesses** | HTTP helper, SEC, IRS. Later pins and the extension | ___ |
| **B · Identity & matching** | Identity index, Archive witness, matcher, calibration, live command | ___ |
| **C · Gate, integration & demo** | Skeleton, contracts, case files, review queue, apply, probes, deliverables. Also the timekeeper | ___ |

### Folder ownership

```
heartbeat/
  CONTRACTS.md          C
  lib/http.js           A
  witnesses/sec.js      A
  witnesses/irs.js      A
  witnesses/archive.js  B
  identity/             B
  match/                B
  case/                 C
  review/               C
  apply/                C
  probes/               C
  bin/heartbeat.js      B
  out/                  generated; every file has exactly one writer
  cache/                gitignored, deleted after the event
```

### Contracts (agreed tonight in prose, frozen and committed at 10:45)

All files are UTF-8 with LF line endings, one JSON object per line, dates `YYYY-MM-DD` and
times in UTC ISO 8601. Any "by" field holds A, B or C, never a name.

| File in `heartbeat/out/` | Writer | Read by | One row = | Fields |
|---|---|---|---|---|
| identity.json | B | all | one Atlas organization | id, name, cat, domain, city, variants[] |
| raw-sec.jsonl | A | B | one SEC filing hit | source, query, record_name, form, date, city, state, street?, record_id, url, fetched_at, sha256 |
| raw-irs.jsonl | A | B | one nonprofit record | source, query, record_name, ein, latest_tax_year, city, state, street, url, fetched_at, sha256 |
| raw-archive.jsonl | B | B | one homepage history | source, domain, latest_capture, status, redirect_to?, snapshot_url, fetched_at |
| witnesses.jsonl | B | C | one record matched to one organization | id, source, event, date, record_name, city, state, street?, url, confidence, match_reason |
| refusals.jsonl | B | C | one refused record | source, record_name, url, reason (mention / out_of_state / person_name / low_confidence), note |
| cases.jsonl | C | C | one organization | id, alive{status, witnesses}, where{status, address?}, same_org{confidence}, proposals[] |
| decisions-A/B/C.jsonl | each reviewer | C | one decision | id, proposal, decision (approve / reject / skip), by, at, note |
| calibration.jsonl | B | C | one blind-checked match | witness_ref, confidence, correct, by |
| metrics.json | C | all | the run | probes before/after, status counts, precision per level (+n), alive recall on the 145, refusals by reason |

Example `witnesses.jsonl` row, using real IDs:

```json
{"id":"nextview","source":"sec","event":"form_d_amendment","date":"2026-02-12","record_name":"NextView All Access II, L.P.","city":"Boston","state":"MA","url":"https://www.sec.gov/Archives/edgar/data/2046803/000204680326000001/","confidence":"high","match_reason":"starts with approved variant 'NextView'; filer in MA"}
```

### Git

- Make a **public fork** (the submission needs a public repo) and turn Actions on, so CI runs
  on our PR.
- Everyone commits to `main`, only in their own folders. Run `git pull --rebase` before every
  push and keep commits small.
- Data changes live **only** on the `proposals` branch, in a separate worktree owned by C.
- Tag the demo commit at 3:15.

### Claude Code (one session per seat)

- **Root CLAUDE.md** (C commits it at 10:45, drafted tonight as plain text):
  - Edit only your own folders.
  - Never edit `data/entities.yml`. Only C's apply step does, only for approved items, only
    on `proposals`.
  - All HTTP goes through `heartbeat/lib/http`. Don't use web search or web-fetch tools to
    collect pipeline data.
  - Never read or store people fields (SEC related persons, IRS officers, NSF/NIH PIs).
  - No AI calls inside the pipeline.
  - Tests use real cached responses, never invented organizations.
  - Run `node scripts/validate.js` before any proposals commit. Commit small and often.
- **Open every session the same way:** "You own heartbeat/<your folders>. Read anything; edit
  only those folders and your own output files. Contracts are in heartbeat/CONTRACTS.md."
- Use subagents only for read-only work, such as checking name variants across the 197.

### Communication

- **Checkpoints** are 5-minute standups at 11:45, 1:15, 2:15 and 2:45. C keeps time.
- A contract change means a 2-minute huddle and a CONTRACTS.md commit.
- At each checkpoint, C pulls and runs the whole chain from a clean checkout.

---

## 7. Workflow

### Tonight (setup only, no code)

**Everyone**
- [ ] Node 20+, then `npm ci`. Check that `node scripts/validate.js` and
      `node scripts/lint-copy.js` pass on the untouched repo
- [ ] Read this plan and agree on seats

**Anyone:** create the public fork, turn Actions on, add teammates

**Seat A**
- [ ] Read the SEC's "Accessing EDGAR data" fair-access rules and ProPublica's API terms
- [ ] Choose the team contact email for the user agent (a team alias, not personal)
- [ ] Open two SEC filing links and one Wayback snapshot in a browser, and pick the link
      format judges will click

**Seat B**
- [ ] On paper, write the name-variant list for the 52 stale entries. Start with the 9 VCs
      that had no SEC hit: Ven^X, Epipelagic Ventures, IBM Ventures, Underscore VC, Founder
      Collective, Bessemer Venture Partners (Boston), Accomplice, .406 Ventures, Material Impact

**Seat C**
- [ ] Draft CONTRACTS.md and the root CLAUDE.md as plain text
- [ ] Draft the demo script and set up screen recording

### Saturday

| Time | A · Witnesses | B · Identity & matching | C · Gate & demo |
|---|---|---|---|
| 9:30 | Setup check | Setup check | Setup check: a clean clone runs |
| 10:00 | **Probes revealed.** Everyone writes down the seven numbers and compares them with ours (52 stale, 87 approx) | | |
| 10:15 | Confirm which official probes we move and adjust the plan | | |
| **10:45** | HTTP helper | Identity index and variants | Skeleton, contracts, CLAUDE.md, `.gitignore`, contract check. Record the "before" numbers |
| 11:15 | SEC witness: NextView first, then the 52 | Archive witness | Status rules, tested on hand-made rows from tonight's results |
| **11:45** | ✅ **Checkpoint 1:** NextView end to end (SEC → match → case printed) | | |
| 12:00 | IRS witness | Matcher: confidence, refusals, conflicts | Case files and review queue |
| 12:45 | *Track lock (Track A)* | | |
| **1:15** | ✅ **Checkpoint 2:** full run on all 197, status counts. Go or no-go on pins and the extension | | |
| 1:15 | Pins or the extension | Calibration and window tuning; `heartbeat <org>` | Apply step on the proposals worktree; probes |
| **1:45** | 🔍 **Review block, all three, 25 minutes, protected.** Each person writes their own decisions file, including the blind calibration check | | |
| **2:15** | ✅ Apply approved items → validate + lint-copy → probes "after" → screenshots. **Drill:** each person runs `heartbeat` on organizations the other two pick | | |
| 2:45 | **Feature freeze.** Record the 2-minute video from a real run | Brief, sources list | README probe line, validator output |
| 3:15 | Everything pushed, demo commit tagged, submitted: public repo, video, brief, declared sources, validator output | | |
| 3:30 | **Code freeze.** Two timed rehearsals | | |
| 3:45 | **Demos** | | |

**README probe line:** `lint-copy.js` runs in CI and fails on any typed count next to words
like "organizations". Put the numbers in inline code, for example: Not verified since June:
`52` → `N`.

**Cut order if we're behind:** (1) the extension, (2) pin sharpening, (3) the IRS witness,
(4) pretty output. **Never cut:** matcher confidence and refusals, the review gate, the
validator, the live command.

---

## 8. Demo script (4 minutes, hard cut)

| Time | What | Who |
|---|---|---|
| 0:00–0:30 | The problem and the insight: "One person checks 197 websites. Websites are testimony; filings are evidence." | C |
| 0:30–1:15 | `heartbeat nextview`: a clean, corroborated heartbeat. Click the SEC filing | A |
| 1:15–2:00 | **The judges' pick, run live** | B |
| 2:00–2:30 | A conflict (Flybridge) and a refusal (Pillar): what we refuse, and why | B |
| 2:30–3:30 | Before → after: stale 52 → N, every stamp approved by a human. Corroborated X of 197. Precision per confidence level. How often known-alive organizations look like flatlines | C |
| 3:30–4:00 | Why it matters: verification stops being one person's checklist. It can run monthly in the repo's existing health workflow and post conflicts to Slack | C |

The video is a backup only. Never play it as if it were live.

---

## 9. Rules and risks

| Rule | What we do |
|---|---|
| Organizations, not people | Never read SEC related persons, IRS officer data, or NSF/NIH PI fields. Drop filers that look like a person. No contact details anywhere. The cache is gitignored and deleted after the event |
| Public pages and documented APIs only | SEC EDGAR (declared user agent, under 10 requests per second), ProPublica, Wayback CDX, USAspending, NIH, NSF. Never LinkedIn, Crunchbase, PitchBook or search engines. Never pretend to be a browser |
| Every claim sourced | Every witness row has a permanent URL. No URL means no row |
| Flag, never write | Only the apply step writes, only approved items, only on `proposals` |
| Massachusetts only | Out-of-state filings are conflicts, never evidence of MA presence |
| Inference labeled | "Alive" is shown as dated evidence. Only a human stamps `lastVerified` |
| Validator passes | `validate.js` and `lint-copy.js` on every proposals commit. Save the final output for submission |
| Attribution | The README credits "Mass AI Atlas, The Open Accelerator — the-open-accelerator.com/ecosystem" (CC BY 4.0), plus SEC EDGAR, ProPublica Nonprofit Explorer, the Internet Archive, and OpenStreetMap if we do pins |

| Risk | Mitigation |
|---|---|
| SEC full-text search isn't allowed for automated use, or it goes down | Confirm tonight. Fallback: the SEC's official quarterly Form D data sets (bulk download) |
| Generic names match the wrong filer ("Engine", "Pillar") | The hand variant list, confidence levels, refusing mentions, and measured precision |
| VCs between funds file nothing for years and look "quiet" | Per-witness windows tuned on the 145 known-alive entries. Quiet is not dead |
| IRS data lags about two years | It counts as "exists, with an address", at medium strength |
| The Archive is slow or down during the demo | Cached results, shown as cached with their timestamp. `--live` still works for SEC |
| Too few entries reviewed in time | Fast wins first in the queue, three reviewers in parallel, and a protected review block |
| Venue wifi fails | A cached full run ready to show, plus a phone hotspot |

---

## 10. Extension: run the witnesses in reverse (idea #4)

Start this only after Checkpoint 2 is green.

1. Pull recent MA AI awards (USAspending, NIH RePORTER, NSF; SBIR.gov is down) and MA Form D
   filers from the last 24–36 months. Strip people fields as soon as the data is parsed.
2. Dedup against the 197 with the same matcher.
3. Keep only candidates with a recent heartbeat. That fixes the "grants from 1990 → dead
   companies" problem.
4. **New probe:** "the Atlas covers X of N federally funded MA AI companies", by region.
   Tonight's data point: **0 of 37** NSF-funded MA AI small businesses are in the Atlas
   (simple name match).
5. Candidates go to the queue as suggestions only, and a human writes the description. New
   startup entries follow the Atlas convention: `offers: [talent]`, no stages.

---

## 11. Open questions to settle

1. Is the SEC's full-text search OK for automated use? (Seat A, tonight)
2. Which SEC link opens best for a judge: the filing folder or the rendered form? (Seat A, tonight)
3. Does a `lastVerified` stamped by our reviewers count as "a person checked"? Ask an
   organizer or mentor early on Saturday.
4. Exactly how do the official probes count? (10:00)
5. Who takes seats A, B and C?

---

*Data: Mass AI Atlas, The Open Accelerator (CC BY 4.0). SEC EDGAR, ProPublica Nonprofit
Explorer, and the Internet Archive Wayback Machine, as cited.*
