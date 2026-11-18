/* scripts/kpi.js, the KPI summary. Fast and offline: no network and no browser.

     node --test test/kpi.test.js

   Most of these hand small made-up inputs to the functions the script exports, so
   they hold whatever data/ says. The ones that run the script itself assert only
   what is true of any valid atlas, in a full clone or a shallow one. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const kpi = require("../scripts/kpi");
const { loadData } = require("../scripts/load-data");

const SCRIPT = path.join(__dirname, "..", "scripts", "kpi.js");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "kpi-test-"));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// Run the script. `bare` takes away the token and every command on PATH, so it finds
// no gh and no git: the state of a machine that can reach neither GitHub nor history.
const run = (args, { bare = false } = {}) => {
  const env = { ...process.env };
  delete env.GITHUB_TOKEN; delete env.GH_TOKEN; delete env.GITHUB_REPOSITORY;
  if (bare) env.PATH = TMP;
  return spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: "utf8" });
};

/* ---------- geography ---------- */

const CITY_HALL = [42.3601, -71.0589];
const MILES_PER_DEGREE = (2 * Math.PI * 3958.8) / 360;
const north = miles => ({ lat: CITY_HALL[0] + miles / MILES_PER_DEGREE, lng: CITY_HALL[1] });

test("miles are measured from Boston City Hall", () => {
  assert.equal(kpi.milesFromCityHall(...CITY_HALL), 0);
  const worcester = kpi.milesFromCityHall(42.2626, -71.8023);      // Worcester City Hall
  assert.ok(worcester > 37 && worcester < 40, `Worcester is ${worcester} miles out`);
  assert.ok(Math.abs(kpi.milesFromCityHall(north(10).lat, north(10).lng) - 10) < 0.01);
});

test("geography counts pins beyond the ring, with and without employers, and by need", () => {
  const entry = (id, cat, miles, offers) => ({ id, cat, offers, ...north(miles) });
  const g = kpi.geography([
    entry("a", "accel", 1, ["funding"]),
    entry("b", "startup", 3, ["talent"]),
    entry("c", "accel", kpi.RING_MILES - 0.1, ["funding", "compute"]),   // just inside
    entry("d", "accel", kpi.RING_MILES + 0.1, ["funding"]),              // just outside
    entry("e", "corporate", 90, ["talent"]),
  ]);
  assert.deepEqual(g.all, { total: 5, beyond: 2, pct: 40 });
  assert.deepEqual(g.resources, { total: 3, beyond: 1, pct: 33 });       // without startup and corporate
  assert.deepEqual(g.needs.funding, { total: 3, beyond: 1, pct: 33 });
  assert.deepEqual(g.needs.compute, { total: 1, beyond: 0, pct: 0 });
  assert.deepEqual(g.needs.talent, { total: 2, beyond: 1, pct: 50 });
});

test("geography says the town split is missing instead of guessing it from distance", () => {
  const g = kpi.geography([{ id: "a", cat: "accel", offers: ["funding"], ...north(2) }]);
  assert.equal(g.towns.available, false);
  assert.match(g.towns.reason, /town/);
});

/* ---------- freshness ---------- */

const dated = (n, lastVerified, added = "2026-06") =>
  Array.from({ length: n }, (_, i) => ({ id: `${lastVerified}-${added}-${i}`, lastVerified, added }));

test("freshness counts a month as stale.js does: within N months means an age of N or less", () => {
  const f = kpi.freshness([
    { id: "six", lastVerified: "2026-05" },      // 6 months before 2026-11: inside
    { id: "seven", lastVerified: "2026-04" },    // 7: outside
    { id: "now", lastVerified: "2026-11" },
    { id: "never" },
  ], "2026-11", { months: 6 });
  assert.equal(f.within, 2);
  assert.equal(f.total, 4);
  assert.equal(f.pct, 50);
  assert.equal(f.never, 1);
  assert.equal(f.oldest, "2026-04");
  assert.equal(f.young, false);
});

test("freshness flags a figure no entry has had time to fall out of", () => {
  const f = kpi.freshness(dated(10, "2026-08"), "2026-11", { months: 6 });
  assert.equal(f.pct, 100);
  assert.equal(f.oldestAge, 3);
  assert.equal(f.young, true);
});

test("the forecast walks the rota month by month and reads each figure on the 1st", () => {
  // 24 entries, all checked in Aug. 2026. A 12-month cycle is 2 a month.
  const f = kpi.freshness(dated(24, "2026-08"), "2026-11", { months: 6, cycle: 12 });
  assert.equal(f.rota.batch, 2);
  assert.equal(f.rota.leftThisMonth, 2);
  assert.deepEqual(f.forecast.map(p => p.month),
    ["2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10", "2027-11"]);
  // Aug.'s checks count through Feb. 1. On March 1 only the 8 re-checked since do,
  // and from then on the 1st always finds the last six batches inside the window.
  assert.deepEqual(f.forecast.map(p => p.within), [24, 24, 24, 8, 10, 12, 12, 12, 12, 12, 12, 12]);
  assert.deepEqual(f.forecast.map(p => p.pct), [100, 100, 100, 33, 42, 50, 50, 50, 50, 50, 50, 50]);
  // Holding all 24 inside six months, read on the 1st, takes a check every six months.
  assert.equal(f.perMonthToHold, 4);
});

test("entries re-dated this month count toward this month's batch; new ones do not", () => {
  const data = [...dated(20, "2026-08"), ...dated(2, "2026-11"), ...dated(2, "2026-11", "2026-11")];
  const f = kpi.freshness(data, "2026-11", { months: 6, cycle: 12 });
  assert.equal(f.rota.batch, 2);
  assert.equal(f.rota.doneThisMonth, 2);       // the two added in Nov. were dated, not re-checked
  assert.equal(f.rota.leftThisMonth, 0);
  // So no Aug. entry is re-dated in November: on March 1, 20 − 3 × 2 of them are out.
  assert.equal(f.forecast.find(p => p.month === "2027-03").within, 24 - 14);
});

/* ---------- re-checks and month ends, from snapshots ---------- */

const snap = (sha, date, entries) => ({ sha, date: `${date}T12:00:00Z`, subject: `commit ${sha}`, entries });

test("a re-check is an existing entry whose lastVerified moved forward", () => {
  const r = kpi.rechecks([
    snap("a", "2026-08-01", [{ id: "x", name: "X" }, { id: "y", name: "Y" }]),
    // every entry gets its first date: a backfill, not a check
    snap("b", "2026-08-28", [{ id: "x", name: "X", lastVerified: "2026-08" }, { id: "y", name: "Y", lastVerified: "2026-08" }]),
    // x confirmed as it was, y corrected, z new
    snap("c", "2026-09-21", [{ id: "x", name: "X", lastVerified: "2026-09" }, { id: "y", name: "Y Inc.", lastVerified: "2026-09" },
      { id: "z", name: "Z", lastVerified: "2026-09" }]),
    // an edit with no new date, and a date that moves back: neither is a re-check
    snap("d", "2026-10-02", [{ id: "x", name: "X Labs", lastVerified: "2026-09" }, { id: "y", name: "Y Inc.", lastVerified: "2026-08" },
      { id: "z", name: "Z", lastVerified: "2026-09" }]),
    // x re-dated with its keys in another order, which is not a change; y removed
    snap("e", "2026-10-05", [{ lastVerified: "2026-10", name: "X Labs", id: "x" }, { id: "z", name: "Z", lastVerified: "2026-09" }]),
  ]);
  assert.equal(r.redated, 3);
  assert.equal(r.changed, 1);
  assert.equal(r.pct, 33);
  assert.equal(r.since, "2026-09");
  assert.deepEqual(r.months, [
    { month: "2026-09", redated: 2, changed: 1 },
    { month: "2026-10", redated: 1, changed: 0 },
  ]);
  assert.deepEqual(r.commits.map(c => [c.sha, c.redated, c.changed]), [["c", 2, 1], ["e", 1, 0]]);
});

test("no re-checks yet is a result, not an error", () => {
  const r = kpi.rechecks([snap("a", "2026-06-12", [{ id: "x", lastVerified: "2026-06" }])]);
  assert.deepEqual([r.redated, r.changed, r.pct, r.since], [0, 0, 0, null]);
});

test("a month's state is its last commit, and a quiet month keeps the one before", () => {
  const far = { id: "far", ...north(60) }, near = { id: "near", ...north(1) };
  const ends = kpi.monthEnds([
    snap("a", "2026-06-12", [near]),
    snap("b", "2026-06-30", [near, far]),
    snap("c", "2026-08-15", [near, far, { id: "far2", ...north(40) }]),
    snap("d", "2026-10-03", [near]),                     // this month is not over
  ], "2026-10");
  assert.deepEqual(ends, [
    { month: "2026-06", entries: 2, beyond: 1 },
    { month: "2026-07", entries: 2, beyond: 1 },
    { month: "2026-08", entries: 3, beyond: 2 },
    { month: "2026-09", entries: 3, beyond: 2 },
  ]);
});

/* ---------- review ---------- */

const item = (number, association, o = {}) => ({
  number, author_association: association, user: { type: o.bot ? "Bot" : "User" },
  state: o.closed ? "closed" : "open", created_at: o.opened || "2026-10-05T00:00:00Z",
  closed_at: o.closed || null, labels: (o.labels || []).map(name => ({ name })),
  ...(o.pr ? { pull_request: {} } : {}),
});
const RAW = {
  issues: [
    item(1, "OWNER", { closed: "2026-10-05T01:00:00Z" }),                          // the maintainer's own
    item(2, "CONTRIBUTOR", { bot: true, pr: true, closed: "2026-10-05T01:00:00Z" }),  // a bot's pull request
    item(3, "NONE", { closed: "2026-10-05T02:00:00Z", labels: ["new-entry"] }),     // 2 hours
    item(4, "CONTRIBUTOR", { pr: true, closed: "2026-10-05T10:00:00Z" }),           // 10 hours, checks ran
    item(5, "FIRST_TIME_CONTRIBUTOR", { pr: true, opened: "2026-11-03T00:00:00Z" }),  // open, checks never released
    item(6, "NONE", { closed: "2026-10-06T00:00:00Z", labels: ["new-entry", "bot:draft"] }),   // 24 hours, the bot drafted it
    item(7, "NONE", { closed: "2026-10-05T04:00:00Z", labels: ["new-entry"] }),     // 4 hours, a maintainer drafted it by hand
    item(8, "NONE", { closed: "2026-10-05T06:00:00Z" }),                            // 6 hours, closed by a bot
    item(9, "COLLABORATOR", { pr: true }),
    item(10, "MEMBER", {}),
  ],
  pulls: [
    { number: 4, head: { ref: "fix-a-link", sha: "s4" } },
    { number: 5, head: { ref: "new-map", sha: "s5" } },
    { number: 20, head: { ref: "suggestion/issue-6", sha: "s20" } },
    { number: 21, head: { ref: "suggestion/issue-7", sha: "s21" } },
  ],
  checks: { 4: 3, 5: 0 },
  closers: { 3: "User", 4: "User", 6: "User", 7: "User", 8: "Bot" },
};

test("review counts submissions from anyone but a maintainer or a bot", () => {
  const r = kpi.review(RAW, "2026-11");
  assert.deepEqual(r.items.map(i => i.number), [3, 4, 5, 6, 7, 8]);
  assert.deepEqual([r.total, r.issues, r.pulls, r.open, r.decided], [6, 4, 2, 1, 5]);
  assert.equal(r.since, "2026-10");
  assert.deepEqual(r.lastMonth, { month: "2026-10", opened: 5 });
  assert.equal(r.medianHours, 6);                 // of 2, 4, 6, 10 and 24 hours
});

test("machine-checked, machine-prepared and machine-decided each need their own evidence", () => {
  const r = kpi.review(RAW, "2026-11");
  const flags = n => { const i = r.items.find(x => x.number === n); return [i.checked, i.prepared, i.machineDecided]; };
  assert.deepEqual(flags(4), [true, false, false]);    // check runs finished on its head commit
  assert.deepEqual(flags(5), [false, false, false]);   // none ran
  assert.deepEqual(flags(6), [true, true, false]);     // bot:draft and the bot's branch: drafted, so validated
  assert.deepEqual(flags(7), [false, false, false]);   // the bot's branch name alone proves nothing
  assert.deepEqual(flags(8), [false, false, true]);    // a bot closed it
  assert.deepEqual([r.checked, r.prepared, r.machineDecided], [2, 1, 1]);
});

/* ---------- rendering ---------- */

const ENTRIES = [
  { id: "a", cat: "accel", offers: ["funding"], lastVerified: "2026-08", added: "2026-06", ...north(1) },
  { id: "b", cat: "startup", offers: ["talent"], lastVerified: "2026-09", added: "2026-06", ...north(3) },
  { id: "c", cat: "gov", offers: ["funding", "compute"], lastVerified: "2026-11", added: "2026-06", ...north(60) },
];
const HISTORY = [
  snap("a", "2026-09-30", ENTRIES.map(e => ({ ...e, lastVerified: "2026-08" }))),
  snap("b", "2026-10-20", ENTRIES.map(e => ({ ...e, lastVerified: e.id === "b" ? "2026-10" : "2026-08", loc: "moved" }))),
];
const result = (over = {}) => ({
  schema: kpi.SCHEMA, generated: "2026-11-01T13:00:00Z", month: "2026-11", commit: "abc1234", entries: ENTRIES.length,
  geography: kpi.geography(ENTRIES),
  freshness: kpi.freshness(ENTRIES, "2026-11"),
  rechecks: kpi.rechecks(HISTORY),
  monthEnds: { available: true, months: kpi.monthEnds(HISTORY, "2026-11") },
  review: kpi.review(RAW, "2026-11"),
  ...over,
});
const NO_HISTORY = { available: false, reason: "this is a shallow clone, so the history is not here" };

test("the text names each measure and what its headline hides", () => {
  const text = kpi.renderText(result());
  for (const label of ["GEOGRAPHY", "FRESHNESS", "RE-CHECKS", "REVIEW"]) {
    const block = text.split("\n\n").find(b => b.startsWith(`${label}: `));
    assert.ok(block, `${label} is missing`);
    assert.match(block, /\n {2}Keep in mind: /, `${label} has no caveat`);
  }
  assert.match(text, /^Atlas KPIs as of Nov\. 1, 2026: 3 organizations, commit abc1234\n/);
  assert.match(text, /GEOGRAPHY: 1 of 3 \(33%\) sit beyond 25 miles of Boston City Hall/);
  assert.match(text, /not available: entries carry no town yet/);
  assert.match(text, /RE-CHECKS: 1 of 1 re-checked in Oct\. 2026 needed an edit/);
  assert.match(text, /At the end of Oct\. 2026: 1 of 3/);
  assert.doesNotMatch(text, /undefined|NaN|null|\[object/);
  assert.ok(text.endsWith("\n"));
});

test("a part that could not be counted says so and why, and the rest still shows", () => {
  const text = kpi.renderText(result({
    rechecks: NO_HISTORY, monthEnds: NO_HISTORY,
    review: { available: false, reason: "no GITHUB_TOKEN, and the gh command is not installed" },
  }));
  assert.match(text, /RE-CHECKS: not available \(this is a shallow clone, so the history is not here\)/);
  assert.match(text, /REVIEW: not available \(no GITHUB_TOKEN, and the gh command is not installed\)/);
  assert.match(text, /GEOGRAPHY: 1 of 3/);
  assert.match(text, /FRESHNESS: 3 of 3/);
  assert.doesNotMatch(text, /At the end of/);
  assert.doesNotMatch(text, /undefined|NaN|null|\[object/);
});

test("a month with no re-check leads, because it means the rota was skipped", () => {
  // the same history, read two months later: nothing was re-dated in December
  const text = kpi.renderText(result({ month: "2027-01", generated: "2027-01-01T13:00:00Z" }));
  assert.match(text, /RE-CHECKS: no entry was re-checked in Dec\. 2026\n {2}The last before that: 1 of 1 re-checked in Oct\. 2026 needed an edit/);
});

test("a machine-decided submission is called out, because the rule is that there are none", () => {
  assert.match(kpi.renderText(result()), /Machine-decided should be 0: nothing is published without a maintainer\. Look at #8\./);
  const none = kpi.review({ ...RAW, closers: { ...RAW.closers, 8: "User" } }, "2026-11");
  assert.match(kpi.renderText(result({ review: none })), /Machine-decided stays 0 by rule/);
});

test("the Slack message has the TOA shape: header, one section, a context line, a text fallback", () => {
  const p = kpi.renderSlack(result(), {});
  assert.deepEqual(p.blocks.map(b => b.type), ["header", "section", "context"]);
  assert.deepEqual(p.blocks[0].text, { type: "plain_text", text: "📊 Atlas KPIs", emoji: true });
  const body = p.blocks[1].text;
  assert.equal(body.type, "mrkdwn");
  assert.ok(body.text.length < 3000, "Slack cuts a section off at 3000 characters");
  assert.match(body.text, /^\*3 organizations\* as of Nov\. 1, 2026\n/);
  for (const label of ["Geography", "Freshness", "Re-checks", "Review"]) {
    const line = body.text.split("\n").find(l => l.startsWith(`• *${label}:* `));
    assert.ok(line, `${label} is missing`);
    assert.match(line, / _[^_]+_$/, `${label} has no caveat in italics`);
  }
  assert.match(p.text, /^📊 Atlas KPIs — 33% beyond 25 miles, 100% checked within 6 months$/);
  assert.doesNotMatch(JSON.stringify(p), /undefined|NaN|\[object/);
});

test("the Slack context links the commit and the run when a workflow built it", () => {
  const local = kpi.renderSlack(result(), {}).blocks[2].elements[0].text;
  assert.equal(local, "node scripts/kpi.js");
  const ci = kpi.renderSlack(result(), {
    GITHUB_ACTIONS: "true", GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "someone/an-atlas",
    GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567", GITHUB_RUN_ID: "77",
  }).blocks[2].elements[0].text;
  assert.equal(ci, "<https://github.com/someone/an-atlas/commit/0123456789abcdef0123456789abcdef01234567|`0123456`>" +
    " · <https://github.com/someone/an-atlas/actions/runs/77|full figures in the run summary> · via GitHub Actions");
});

test("the Slack message escapes what Slack would read as markup", () => {
  const p = kpi.renderSlack(result({ review: { available: false, reason: "a <b> & c" } }), {});
  assert.match(p.blocks[1].text.text, /not available \(a &lt;b&gt; &amp; c\)/);
});

/* ---------- the script itself ---------- */

test("offline it still reports on this repository's data, and exits 0", () => {
  const r = run(["--offline", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  const { DATA } = loadData();
  assert.equal(out.schema, kpi.SCHEMA);
  assert.equal(out.entries, DATA.length);
  assert.equal(out.geography.all.total, DATA.length);
  assert.ok(out.geography.all.beyond <= DATA.length);
  assert.equal(out.freshness.total, DATA.length);
  assert.equal(out.freshness.forecast.length, 12);
  for (const p of out.freshness.forecast) assert.ok(p.pct >= 0 && p.pct <= 100);
  assert.deepEqual(out.review, { available: false, reason: "left out with --offline" });
  // git history is there in a full clone and not in a shallow one; either is a report
  for (const part of [out.rechecks, out.monthEnds]) {
    assert.equal(typeof part.available, "boolean");
    if (!part.available) assert.equal(typeof part.reason, "string");
  }

  // a saved result renders without computing anything again
  const saved = path.join(TMP, "kpi.json");
  fs.writeFileSync(saved, r.stdout);
  const text = run(["--from", saved], { bare: true });
  assert.equal(text.status, 0, text.stderr);
  assert.equal(text.stdout, kpi.renderText(out));
  const slack = run(["--from", saved, "--slack"], { bare: true });
  assert.equal(slack.status, 0, slack.stderr);
  assert.deepEqual(JSON.parse(slack.stdout).blocks.map(b => b.type), ["header", "section", "context"]);
});

test("with no token, no gh and no git it reports what it can, and exits 0", () => {
  const r = run([], { bare: true });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^GEOGRAPHY: \d+ of \d+ /m);
  assert.match(r.stdout, /^FRESHNESS: \d+ of \d+ /m);
  assert.match(r.stdout, /^RE-CHECKS: not available \(no git history here\)$/m);
  assert.match(r.stdout, /^REVIEW: not available \(/m);
});

// The figures are compared with what freshness() gives this repository's data for the same month,
// so the test holds whatever data/ says. It used to expect no entry inside six months of Feb. 2031,
// which is true only until an entry is checked in Aug. 2030: from then on this test, and the
// required check it runs in, would have failed on the first re-check.
test("--now sets the month the figures are counted for", () => {
  const r = run(["--now", "2031-02-09", "--json"], { bare: true });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.month, "2031-02");
  assert.equal(out.generated, "2031-02-09T00:00:00Z");
  assert.equal(out.freshness.forecast[0].month, "2031-03");
  const { months, cycle } = kpi.parseArgs([]);     // the script's own window and rota cycle
  assert.deepEqual(out.freshness, kpi.freshness(loadData().DATA, "2031-02", { months, cycle }));
});

test("a wrong option, or a file that is not a saved result, exits 1 and says why", () => {
  const bad = run(["--nonsense"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown option --nonsense/);
  assert.equal(run(["--months", "0"]).status, 1);
  assert.equal(run(["--now", "November"]).status, 1);
  const other = path.join(TMP, "other.json");
  fs.writeFileSync(other, JSON.stringify({ hello: "there" }));
  const from = run(["--from", other]);
  assert.equal(from.status, 1);
  assert.match(from.stderr, /is not a result this version wrote/);
});
