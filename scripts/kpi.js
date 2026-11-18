#!/usr/bin/env node
/* KPI summary: where the atlas reaches, how fresh it is, and how outside submissions
 * are reviewed, each printed with what its headline hides. A report, not a gate. It
 * stores nothing: today's figures come from data/, the history from git, and the
 * review figures from GitHub's public lists of this repository's issues and pull
 * requests. It prints; it never posts anywhere. monthly-health.yml runs it and posts.
 *
 *   node scripts/kpi.js                 plain-text summary
 *   node scripts/kpi.js --json          everything, as JSON
 *   node scripts/kpi.js --slack         a Slack message (Block Kit), printed, not sent
 *   node scripts/kpi.js --from f.json   render a saved --json result; computes nothing
 *   node scripts/kpi.js --offline       leave GitHub out
 *
 *   --months N    the freshness window (default 6)
 *   --cycle N     the rota's cycle, as monthly-health.yml passes it to stale.js (default 12)
 *   --repo o/n    the GitHub repository (default: GITHUB_REPOSITORY, then git's origin)
 *   --now DATE    count as if today were YYYY-MM-DD (for tests)
 *
 * GEOGRAPHY   Entries whose `town` is neither Boston nor Cambridge, and entries whose pin
 *             is more than 25 miles from Boston City Hall. A pin is where an organization
 *             sits, not whom it serves. The town is read from the entry and never worked
 *             out from the pin: an entry with none is left out and counted as left out,
 *             and when no entry has one the split reads "not available".
 * FRESHNESS   Entries whose lastVerified month is within N months of this month, counted
 *             as scripts/stale.js counts it. While the oldest check is younger than the
 *             window, 100% says nothing, so the figure comes with a forecast: what it
 *             reads on the 1st of each coming month if the rota's batch is checked every
 *             month and the atlas stays the size it is.
 * RE-CHECKS   The other half of freshness: how often a check finds something to fix.
 *             From git: every time an existing entry's lastVerified moved forward, and
 *             whether any other field of that entry changed in the same commit. It counts
 *             entries fixed because they were already known to be wrong, so it runs high.
 * REVIEW      Issues and pull requests from anyone but a maintainer or a bot: how many a
 *             machine checked, how many a machine prepared, how many a machine decided.
 *             The last is 0 by rule: nothing is published without a maintainer.
 *
 * With no git history (a shallow clone) the re-checks and the month-end figures read
 * "not available". With no token and no `gh`, or no network, the review figures do.
 * Either way the script still reports and exits 0. It exits 1 only when data/ cannot
 * be read or an option is wrong.
 */
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const { execFileSync, execFile } = require("child_process");

const REPO = path.join(__dirname, "..");
const SCHEMA = 1;

/* ---------- small helpers ---------- */

const YYYY_MM = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthIndex = ym => { const [y, m] = ym.split("-").map(Number); return y * 12 + (m - 1); };
const monthAt = i => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
const addMonths = (ym, n) => monthAt(monthIndex(ym) + n);
const pct = (n, of) => (of ? Math.round((n / of) * 100) : 0);
const tenth = x => (x === null ? null : Math.round(x * 10) / 10);
const median = list => {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b), mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Month names as the atlas's own copy writes them: "Nov. 16", "Sept. 2026", "June 2026".
const MONTHS = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
const monthLabel = ym => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const monthShort = ym => MONTHS[Number(ym.slice(5, 7)) - 1];
const dayLabel = iso => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;

/* ---------- geography ---------- */

// The reference point and the ring are the ones the team's first KPI count used
// (Nov. 2026), so the numbers stay comparable from month to month. An atlas for
// another region changes both, as it changes BASE in build-pages.js.
const CITY_HALL = { name: "Boston City Hall", lat: 42.3601, lng: -71.0589 };
const RING_MILES = 25;
// The two cities most of the atlas sits in. The share outside them leads the report.
const CORE_TOWNS = ["Boston", "Cambridge"];
// Every city and town there is (scripts/towns.js), to say how many the atlas reaches.
const { TOWNS: ALL_TOWNS } = require("./towns");
// Companies and corporate labs are places a founder hires from or sells to, not
// resources. Counting without them shows how far the resources themselves reach.
const EMPLOYERS = new Set(["startup", "corporate"]);

function milesFromCityHall(lat, lng) {
  const R = 3958.8, rad = d => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat - CITY_HALL.lat) / 2) ** 2 +
    Math.cos(rad(CITY_HALL.lat)) * Math.cos(rad(lat)) * Math.sin(rad(lng - CITY_HALL.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const isBeyond = d => milesFromCityHall(d.lat, d.lng) > RING_MILES;

function geography(DATA) {
  const count = list => {
    const beyond = list.filter(isBeyond).length;
    return { total: list.length, beyond, pct: pct(beyond, list.length) };
  };
  const needs = {};
  for (const d of DATA) for (const o of d.offers || []) (needs[o] ||= []).push(d);
  return {
    from: CITY_HALL.name,
    miles: RING_MILES,
    all: count(DATA),
    resources: count(DATA.filter(d => !EMPLOYERS.has(d.cat))),
    needs: Object.fromEntries(Object.entries(needs).map(([k, v]) => [k, count(v)])),
    towns: towns(DATA),
  };
}

// Boston against Cambridge against the rest is a question about towns, and distance
// cannot answer it: Cambridge, Somerville and Brookline are as close to Boston City
// Hall as much of Boston is. So it is counted from each entry's `town` and from nothing
// else. An entry without one is left out and reported as left out, and when no entry
// has one the split says so rather than print a small ring that looks like an answer.
function towns(DATA) {
  const placed = DATA.filter(d => typeof d.town === "string" && d.town);
  if (!placed.length) return { available: false, reason: "entries carry no town yet" };
  const core = new Set(CORE_TOWNS);
  const count = list => {
    const outside = list.filter(d => !core.has(d.town)).length;
    return { total: list.length, outside, pct: pct(outside, list.length) };
  };
  const needs = {}, per = {};
  for (const d of placed) {
    per[d.town] = (per[d.town] || 0) + 1;
    for (const o of d.offers || []) (needs[o] ||= []).push(d);
  }
  return {
    available: true,
    core: CORE_TOWNS,
    all: count(placed),
    resources: count(placed.filter(d => !EMPLOYERS.has(d.cat))),
    needs: Object.fromEntries(Object.entries(needs).map(([k, v]) => [k, count(v)])),
    unplaced: DATA.length - placed.length,
    // how many cities and towns hold an entry, out of how many there are
    reached: Object.keys(per).length,
    of: ALL_TOWNS.length,
    list: Object.entries(per).map(([town, entries]) => ({ town, entries }))
      .sort((a, b) => b.entries - a.entries || a.town.localeCompare(b.town)),
  };
}

/* ---------- freshness and its forecast ---------- */

function freshness(DATA, now, { months = 6, cycle = 12, horizon = 12 } = {}) {
  const lv = d => (typeof d.lastVerified === "string" && YYYY_MM.test(d.lastVerified) ? d.lastVerified : null);
  const dated = DATA.filter(lv);
  const fresh = (ym, at) => monthIndex(at) - monthIndex(ym) <= months;   // stale.js: age <= months
  const within = dated.filter(d => fresh(d.lastVerified, now)).length;
  const oldest = dated.reduce((a, d) => (a === null || d.lastVerified < a ? d.lastVerified : a), null);
  const oldestAge = oldest === null ? null : monthIndex(now) - monthIndex(oldest);

  // The rota, as stale.js --cycle sizes and orders it: the batch least recently
  // verified, file order inside a month. An entry re-dated this month has had its
  // check, so it counts toward this month's batch; one added this month was dated
  // when it was written, which is not a re-check.
  const batch = Math.ceil(DATA.length / Math.max(1, cycle));
  const doneThisMonth = DATA.filter(d => d.lastVerified === now && d.added !== now).length;
  const state = DATA.map((d, i) => ({ i, ym: lv(d) || "0000-00" }));
  const forecast = [];
  for (let k = 0; k < horizon; k++) {
    const checking = addMonths(now, k);
    const size = k === 0 ? Math.max(0, batch - doneThisMonth) : batch;
    [...state].sort((a, b) => a.ym.localeCompare(b.ym) || a.i - b.i).slice(0, size)
      .forEach(s => { s.ym = checking; });
    const at = addMonths(now, k + 1);          // read on the 1st of the month after
    const n = state.filter(s => s.ym !== "0000-00" && fresh(s.ym, at)).length;
    forecast.push({ month: at, within: n, pct: pct(n, DATA.length) });
  }

  return {
    months, total: DATA.length, within, pct: pct(within, DATA.length),
    never: DATA.length - dated.length,
    oldest, oldestAge,
    // true while no entry has had the time to fall out of the window
    young: oldestAge !== null && oldestAge <= months,
    rota: { cycle, batch, doneThisMonth, leftThisMonth: Math.max(0, batch - doneThisMonth) },
    forecast,
    // Read on the 1st, a check made in one month counts on the next `months`
    // month-starts and no longer. So holding every entry inside the window takes a
    // check every `months` months: stale.js --cycle <months>.
    perMonthToHold: Math.ceil(DATA.length / months),
  };
}

/* ---------- history, rebuilt from git ---------- */

const git = (...args) => execFileSync("git", args,
  { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });

// One snapshot of the entries per commit on main that touched them, oldest first.
// Until the Oct. 2026 refactor the entries lived in data.js as `const DATA = [...]`;
// that file is evaluated in an empty context, which is all a data file needs.
function readSnapshots() {
  let shallow;
  try { shallow = git("rev-parse", "--is-shallow-repository").trim(); }
  catch { return { available: false, reason: "no git history here" }; }
  if (shallow === "true")
    return { available: false, reason: "this is a shallow clone, so the history is not here" };
  const yaml = require("js-yaml");
  let log;
  try {
    log = git("log", "--first-parent", "--reverse", "--format=%H%x09%cI%x09%s", "--",
      "data/entities.yml", "data.js").split("\n").filter(Boolean).map(l => l.split("\t"));
  } catch { return { available: false, reason: "git log failed" }; }
  const snapshots = [];
  for (const [sha, date, ...subject] of log) {
    let entries = null;
    try { entries = yaml.load(git("show", `${sha}:data/entities.yml`), { schema: yaml.CORE_SCHEMA }); } catch {}
    if (!Array.isArray(entries)) {
      try { entries = vm.runInNewContext(git("show", `${sha}:data.js`) + "\n;DATA", Object.create(null), { timeout: 3000 }); } catch {}
    }
    // A commit whose data cannot be read is left out; the next one is compared with
    // the one before it, so nothing is counted twice.
    if (Array.isArray(entries))
      snapshots.push({ sha: sha.slice(0, 7), date, subject: subject.join("\t"), entries: [...entries] });
  }
  return { available: true, snapshots };
}

// An entry without its lastVerified, keys sorted, as one string: two of these differ
// exactly when a field other than the date changed.
const factsOf = e => JSON.stringify(Object.keys(e).filter(k => k !== "lastVerified").sort().map(k => [k, e[k]]));

function rechecks(snapshots) {
  const commits = [], byMonth = new Map();
  let prev = null;
  for (const s of snapshots) {
    const cur = new Map(s.entries.filter(e => e && e.id).map(e => [e.id, e]));
    if (prev) {
      let redated = 0, changed = 0;
      for (const [id, e] of cur) {
        const p = prev.get(id);
        // New entries are not re-checks, and neither is the commit that gave every
        // entry its first lastVerified: that was a backfill from git, not a check.
        if (!p || !YYYY_MM.test(p.lastVerified || "") || !YYYY_MM.test(e.lastVerified || "")) continue;
        if (e.lastVerified <= p.lastVerified) continue;
        const edited = factsOf(e) !== factsOf(p);
        redated++; if (edited) changed++;
        // The month is the one the maintainer wrote, which is when the check happened.
        const m = byMonth.get(e.lastVerified) || { month: e.lastVerified, redated: 0, changed: 0 };
        m.redated++; if (edited) m.changed++;
        byMonth.set(e.lastVerified, m);
      }
      if (redated) commits.push({ sha: s.sha, date: s.date.slice(0, 10), subject: s.subject, redated, changed });
    }
    prev = cur;
  }
  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  const redated = months.reduce((n, m) => n + m.redated, 0);
  const changed = months.reduce((n, m) => n + m.changed, 0);
  return {
    available: true, redated, changed, pct: pct(changed, redated),
    since: months.length ? months[0].month : null, months, commits,
  };
}

// The atlas at the end of each month up to last month: how many entries, and how
// many beyond the ring. The last commit of a month is that month's state. `outside`,
// the entries outside the two cities, is there only for a month that ended with a town
// on every entry: before Nov. 2026 no entry had one, and a part count would mislead.
function monthEnds(snapshots, now) {
  const out = [];
  if (!snapshots.length) return out;
  for (let i = monthIndex(snapshots[0].date.slice(0, 7)); i < monthIndex(now); i++) {
    const month = monthAt(i);
    const last = snapshots.filter(s => s.date.slice(0, 7) <= month).pop();
    if (!last) continue;
    const t = towns(last.entries);
    out.push({ month, entries: last.entries.length, beyond: last.entries.filter(isBeyond).length,
      ...(t.available && !t.unplaced ? { outside: t.all.outside } : {}) });
  }
  return out;
}

/* ---------- review, from GitHub ---------- */

// Anyone with write access is a maintainer here. GitHub reports the association as
// it is today, so a contributor who is later given access moves out of this count,
// past submissions included.
const INSIDE = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const isOutside = item => (item.user || {}).type !== "Bot" && !INSIDE.has(item.author_association);
// How to tell that the suggestion bot drafted an issue's pull request: a maintainer
// put `bot:draft` on the issue (the only thing that starts the bot), and a pull
// request exists on the branch scripts/issue-to-entry.js names after the issue. The
// branch alone is not enough: a maintainer has opened one by hand under that name.
const DRAFT_LABEL = "bot:draft";
const draftBranch = n => `suggestion/issue-${n}`;

/* raw = { issues, pulls, checks, closers }:
     issues   GitHub's list of issues, which includes pull requests
     pulls    GitHub's list of pull requests (for each one's branch and head commit)
     checks   {pull number: completed check runs on its head commit}
     closers  {number: the account type that closed or merged it, "User" or "Bot"} */
function review(raw, now) {
  const draftBranches = new Set((raw.pulls || []).map(p => (p.head || {}).ref));
  const items = (raw.issues || []).filter(isOutside).map(i => {
    const pr = Boolean(i.pull_request);
    const decided = i.state === "closed";
    // A machine prepared a suggestion when the bot drafted its pull request. Drafting
    // runs the validator, so a drafted suggestion was machine-checked as well.
    const prepared = !pr && (i.labels || []).some(l => (l.name || l) === DRAFT_LABEL) &&
      draftBranches.has(draftBranch(i.number));
    return {
      number: i.number, kind: pr ? "pull request" : "issue",
      opened: i.created_at.slice(0, 10), open: !decided,
      checked: pr ? (raw.checks || {})[i.number] > 0 : prepared,
      prepared,
      machineDecided: decided && (raw.closers || {})[i.number] === "Bot",
      hours: decided ? (new Date(i.closed_at) - new Date(i.created_at)) / 36e5 : null,
    };
  }).sort((a, b) => a.number - b.number);
  const n = f => items.filter(f).length;
  const last = addMonths(now, -1);
  return {
    available: true, total: items.length,
    issues: n(i => i.kind === "issue"), pulls: n(i => i.kind === "pull request"),
    open: n(i => i.open), decided: n(i => !i.open),
    checked: n(i => i.checked), prepared: n(i => i.prepared), machineDecided: n(i => i.machineDecided),
    medianHours: tenth(median(items.filter(i => i.hours !== null).map(i => i.hours))),
    since: items.length ? items.map(i => i.opened).sort()[0].slice(0, 7) : null,
    lastMonth: { month: last, opened: n(i => i.opened.slice(0, 7) === last) },
    items: items.map(i => ({ ...i, hours: tenth(i.hours) })),
  };
}

// Where to ask GitHub: a token in the environment (how a workflow runs), else the
// `gh` command a maintainer is signed in to. Neither is required. The token is only
// ever sent to GitHub, as a header, and nothing here prints it.
function githubClient({ env = process.env, repo, offline }) {
  if (offline) return { reason: "left out with --offline" };
  if (!repo) return { reason: "no GitHub repository to ask about" };
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (token) {
    const api = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
    return {
      get: async p => {
        const r = await fetch(`${api}/repos/${repo}/${p}`, {
          headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28", "user-agent": "mass-ai-atlas-kpi" },
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
        return r.json();
      },
    };
  }
  try { execFileSync("gh", ["--version"], { stdio: "ignore", timeout: 10000 }); }
  catch { return { reason: "no GITHUB_TOKEN, and the gh command is not installed" }; }
  return {
    get: p => new Promise((resolve, reject) => execFile("gh", ["api", `repos/${repo}/${p}`],
      { encoding: "utf8", maxBuffer: 64 << 20, timeout: 20000 }, (err, stdout) => {
        if (err) return reject(new Error("the gh command got no usable answer from GitHub"));
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error("the gh command gave an answer that is not JSON")); }
      })),
  };
}

// Run the jobs a few at a time: enough to keep a run short, few enough to be polite.
async function inTurns(jobs, atOnce = 6) {
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(atOnce, queue.length) },
    async () => { while (queue.length) await queue.shift()(); }));
}

async function fetchReview(client, now) {
  if (!client.get) return { available: false, reason: client.reason };
  // One slow answer must not hold a monthly job: give the whole exchange a minute.
  const deadline = Date.now() + 60000;
  const get = p => {
    if (Date.now() > deadline) throw new Error("GitHub took longer than a minute");
    return client.get(p);
  };
  const all = async p => {
    const out = [];
    for (let page = 1; page <= 30; page++) {
      const batch = await get(`${p}&per_page=100&page=${page}`);
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  };
  try {
    const issues = await all("issues?state=all&sort=created&direction=asc");
    const pulls = await all("pulls?state=all&sort=created&direction=asc");
    const headOf = new Map(pulls.map(p => [p.number, (p.head || {}).sha]));
    const checks = {}, closers = {}, jobs = [];
    for (const i of issues.filter(isOutside)) {
      if (i.pull_request && headOf.get(i.number)) jobs.push(async () => {
        checks[i.number] = (await get(`commits/${headOf.get(i.number)}/check-runs?status=completed&per_page=1`)).total_count;
      });
      if (i.state === "closed") jobs.push(async () => {
        closers[i.number] = ((await get(`issues/${i.number}`)).closed_by || {}).type || null;
      });
    }
    await inTurns(jobs);
    return review({ issues, pulls, checks, closers }, now);
  } catch (e) {
    return { available: false, reason: String(e.message || e).slice(0, 120) };
  }
}

function repoSlug(explicit, env = process.env) {
  if (explicit) return explicit;
  if (env.GITHUB_REPOSITORY) return env.GITHUB_REPOSITORY;
  try {
    const m = git("remote", "get-url", "origin").trim().match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/);
    return m ? m[1] : null;
  } catch { return null; }
}

/* ---------- putting it together ---------- */

async function compute({ DATA, now, today, months, cycle, repo, offline, env }) {
  const history = readSnapshots();
  let commit = null;
  try { commit = git("rev-parse", "--short", "HEAD").trim(); } catch {}
  return {
    schema: SCHEMA, generated: today, month: now, commit, entries: DATA.length,
    geography: geography(DATA),
    freshness: freshness(DATA, now, { months, cycle }),
    rechecks: history.available ? rechecks(history.snapshots) : { available: false, reason: history.reason },
    monthEnds: history.available ? { available: true, months: monthEnds(history.snapshots, now) }
      : { available: false, reason: history.reason },
    review: await fetchReview(githubClient({ env, repo: repoSlug(repo, env), offline }), now),
  };
}

/* ---------- rendering ---------- */

const of = (n, total) => `${n} of ${total} (${pct(n, total)}%)`;
const listOf = names => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
const NEEDS_SHOWN = ["funding", "customers", "compute"];   // the three the first count singled out

// The sentences both formats share. Each headline has a `mind`: what the number hides.
function sentences(r) {
  const g = r.geography, f = r.freshness, rc = r.rechecks, rv = r.review;
  const lastEnd = r.monthEnds.available ? r.monthEnds.months[r.monthEnds.months.length - 1] : null;

  const t = g.towns, ring = `${of(g.all.beyond, g.all.total)} sit beyond ${g.miles} miles of ${g.from}`;
  const byNeed = (set, n) => NEEDS_SHOWN.filter(k => set[k]).map(k => `${k} ${set[k][n]} of ${set[k].total}`).join(", ");
  const mind = "A pin is where an organization sits, not whom it serves.";
  let geo;
  if (t.available) {
    // The towns lead and the ring follows: a quarter of the atlas can sit outside the
    // two cities and still be a short drive from them.
    const outside = `outside ${listOf(t.core)}`;
    geo = { head: `${of(t.all.outside, t.all.total)} sit ${outside}`, next: ring, mind, more: [
      `Beyond ${g.miles} miles of ${g.from}: ${of(g.all.beyond, g.all.total)}`,
    ] };
    if (g.resources.total !== g.all.total)
      geo.more.push(`Without companies and corporate labs: ${of(t.resources.outside, t.resources.total)} ${outside}, ` +
        `${of(g.resources.beyond, g.resources.total)} beyond ${g.miles} miles`);
    if (byNeed(t.needs, "outside")) geo.more.push(`By what founders get, ${outside}: ${byNeed(t.needs, "outside")}`);
    if (byNeed(g.needs, "beyond")) geo.more.push(`By what founders get, beyond ${g.miles} miles: ${byNeed(g.needs, "beyond")}`);
    geo.more.push(`Entries sit in ${t.reached}${t.of ? ` of ${t.of}` : ""} cities and towns`);
    if (lastEnd) geo.more.push(`At the end of ${monthLabel(lastEnd.month)}: ` +
      (lastEnd.outside === undefined ? "" : `${lastEnd.outside} of ${lastEnd.entries} ${outside}, `) +
      `${lastEnd.beyond} of ${lastEnd.entries} beyond ${g.miles} miles`);
    if (t.unplaced) geo.more.push(`${t.unplaced} ${t.unplaced === 1 ? "entry has" : "entries have"} no town, ` +
      "so the figures by town leave " + (t.unplaced === 1 ? "it" : "them") + " out");
  } else {
    geo = { head: ring, mind, more: [],
      missing: `The share outside ${listOf(CORE_TOWNS)} is not available: ${t.reason}.` };
    if (g.resources.total !== g.all.total)
      geo.more.push(`Without companies and corporate labs: ${of(g.resources.beyond, g.resources.total)}`);
    if (byNeed(g.needs, "beyond")) geo.more.push(`Beyond ${g.miles} miles, by what founders get: ${byNeed(g.needs, "beyond")}`);
    if (lastEnd) geo.more.push(`At the end of ${monthLabel(lastEnd.month)}: ${lastEnd.beyond} of ${lastEnd.entries}`);
  }

  const at = k => f.forecast[k - 1];
  const points = [1, 3, 6, 9, 12].map(at).filter(Boolean);
  const end = f.forecast[f.forecast.length - 1];
  const fresh = {
    head: `${of(f.within, f.total)} were checked within ${f.months} months`,
    mind: f.oldest === null ? "No entry carries a lastVerified month."
      : f.young ? `The oldest check is ${monthLabel(f.oldest)}, so no entry has had time to fall out of the window.`
      : `The oldest check is ${monthLabel(f.oldest)}.`,
    more: [
      `Forecast, read on the 1st, if the rota's ${f.rota.batch} a month are all checked: ` +
        points.map((p, i) => `${i === points.length - 1 ? monthLabel(p.month) : monthShort(p.month)} ${p.pct}%`).join(", "),
      `Holding every entry inside ${f.months} months on the 1st takes ${f.perMonthToHold} a month`,
    ],
    forecastEnd: end ? `${end.pct}% by ${monthLabel(end.month)}` : null,
  };
  if (f.never) fresh.more.push(`${f.never} ${f.never === 1 ? "entry has" : "entries have"} no lastVerified at all`);
  if (f.rota.leftThisMonth) fresh.more.push(`${f.rota.leftThisMonth} of this month's ${f.rota.batch} are still to check`);

  let re;
  if (!rc.available) re = { head: `not available (${rc.reason})`, mind: null, more: [] };
  else if (!rc.redated) re = { head: "none recorded yet", mind: null, more: [] };
  else {
    // Last month leads, because the report goes out on the 1st, when this month has
    // nothing yet. A month with no re-check at all is a rota that was skipped, and
    // that is worth the headline. Run later in a month, it adds this month so far.
    const lastMonth = addMonths(r.month, -1);
    const m = rc.months.find(x => x.month === lastMonth);
    const latest = rc.months.filter(x => x.month < lastMonth).pop();
    const sofar = rc.months.find(x => x.month === r.month);
    const line = x => `${x.changed} of ${x.redated} re-checked in ${monthLabel(x.month)} needed an edit`;
    re = {
      head: m ? line(m) : `no entry was re-checked in ${monthLabel(lastMonth)}`,
      mind: "It counts every re-dated entry, also those fixed because they were known to be wrong, so it runs high.",
      more: [
        ...(!m && latest ? [`The last before that: ${line(latest)}`] : []),
        ...(sofar ? [`So far in ${monthLabel(sofar.month)}: ${sofar.changed} of ${sofar.redated}`] : []),
        `Since ${monthLabel(rc.since)}: ${of(rc.changed, rc.redated)}`,
      ],
    };
  }

  let rev;
  if (!rv.available) rev = { head: `not available (${rv.reason})`, mind: null, more: [] };
  else if (!rv.total) rev = { head: "no outside submissions yet", mind: null, more: [] };
  else {
    rev = {
      head: `${rv.total} outside ${rv.total === 1 ? "submission" : "submissions"} since ${monthLabel(rv.since)}: ` +
        `${rv.checked} machine-checked, ${rv.prepared} machine-prepared, ${rv.machineDecided} machine-decided`,
      mind: rv.machineDecided
        ? "Machine-decided should be 0: nothing is published without a maintainer. Look at " +
          rv.items.filter(i => i.machineDecided).map(i => `#${i.number}`).join(", ") + "."
        : "Machine-decided stays 0 by rule: nothing is published without a maintainer.",
      more: [
        `${rv.issues} ${rv.issues === 1 ? "issue" : "issues"} and ${rv.pulls} ${rv.pulls === 1 ? "pull request" : "pull requests"}; ` +
          `${rv.decided} decided, ${rv.open} open; ${rv.lastMonth.opened} opened in ${monthLabel(rv.lastMonth.month)}`,
      ],
    };
    if (rv.medianHours !== null) rev.more.push(`Median time to a decision: ${rv.medianHours} hours`);
  }
  return { geo, fresh, re, rev };
}

function renderText(r) {
  const s = sentences(r);
  const block = (label, x) => [
    `${label}: ${x.head}`,
    ...x.more.map(l => `  ${l}`),
    ...(x.mind ? [`  Keep in mind: ${x.mind}`] : []),
    ...(x.missing ? [`  ${x.missing}`] : []),
  ];
  return [
    `Atlas KPIs as of ${dayLabel(r.generated)}: ${r.entries} organizations${r.commit ? `, commit ${r.commit}` : ""}`,
    "",
    ...block("GEOGRAPHY", s.geo), "",
    ...block("FRESHNESS", s.fresh), "",
    ...block("RE-CHECKS", s.re), "",
    ...block("REVIEW", s.rev),
  ].join("\n") + "\n";
}

// The TOA Slack style, as deploy.yml posts it: a header, one section that opens with
// the bold headline and lists the rest as bullets, a context line with the commit and
// the run, and a plain `text` for notifications. The workflow sends it; this prints it.
function renderSlack(r, env = process.env) {
  const s = sentences(r);
  const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // A headline, then in italics what it hides. `extra` is a plain sentence between the two.
  const bullet = (label, x, extra) =>
    `• *${label}:* ${esc(x.head)}.` + (extra ? ` ${esc(extra)}` : "") +
    (x.mind ? ` _${esc(x.mind + (x.missing ? " " + x.missing : ""))}_` : "");
  const lines = [
    `*${r.entries} organizations* as of ${dayLabel(r.generated)}`,
    bullet("Geography", s.geo, s.geo.next ? `${s.geo.next}.` : ""),
    bullet("Freshness", s.fresh, s.fresh.forecastEnd ? `At the rota's ${r.freshness.rota.batch} a month it reads ${s.fresh.forecastEnd}.` : ""),
    bullet("Re-checks", s.re),
    bullet("Review", s.rev),
  ];
  const server = env.GITHUB_SERVER_URL, repo = env.GITHUB_REPOSITORY;
  const context = [];
  if (server && repo && env.GITHUB_SHA)
    context.push(`<${server}/${repo}/commit/${env.GITHUB_SHA}|\`${env.GITHUB_SHA.slice(0, 7)}\`>`);
  if (server && repo && env.GITHUB_RUN_ID)
    context.push(`<${server}/${repo}/actions/runs/${env.GITHUB_RUN_ID}|full figures in the run summary>`);
  context.push(env.GITHUB_ACTIONS ? "via GitHub Actions" : "node scripts/kpi.js");
  const title = "📊 Atlas KPIs";
  return {
    text: `${title} — ` + (r.geography.towns.available
      ? `${r.geography.towns.all.pct}% outside ${listOf(r.geography.towns.core)}, `
      : `${r.geography.all.pct}% beyond ${r.geography.miles} miles, `) +
      `${r.freshness.pct}% checked within ${r.freshness.months} months`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: title, emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
      { type: "context", elements: [{ type: "mrkdwn", text: context.join(" · ") }] },
    ],
  };
}

/* ---------- command line ---------- */

function parseArgs(argv) {
  const o = { format: "text", months: 6, cycle: 12, offline: false, from: null, repo: null, today: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => { if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`); return argv[++i]; };
    const whole = () => { const n = Number(value()); if (!Number.isInteger(n) || n < 1) throw new Error(`${a} needs a whole number, 1 or more`); return n; };
    if (a === "--json" || a === "--slack") o.format = a.slice(2);
    else if (a === "--offline") o.offline = true;
    else if (a === "--from") o.from = value();
    else if (a === "--repo") o.repo = value();
    else if (a === "--months") o.months = whole();
    else if (a === "--cycle") o.cycle = whole();
    else if (a === "--now") {
      o.today = value();
      if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(o.today)) throw new Error("--now needs a date as YYYY-MM-DD");
    } else throw new Error(`unknown option ${a}`);
  }
  return o;
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(`kpi.js: ${e.message}. Usage is at the top of scripts/kpi.js.`); process.exit(1); }

  let result;
  if (o.from) {
    try { result = JSON.parse(fs.readFileSync(o.from, "utf8")); }
    catch (e) { console.error(`kpi.js: cannot read ${o.from}: ${e.message}`); process.exit(1); }
    if (result.schema !== SCHEMA) { console.error(`kpi.js: ${o.from} is not a result this version wrote`); process.exit(1); }
  } else {
    let DATA;
    try { ({ DATA } = require("./load-data").loadData()); }
    catch (e) { console.error(`kpi.js: cannot read data/: ${e.message}`); process.exit(1); }
    // The current month in UTC, as stale.js takes it.
    const today = o.today ? `${o.today}T00:00:00Z` : new Date().toISOString().slice(0, 19) + "Z";
    result = await compute({ DATA, now: today.slice(0, 7), today, months: o.months, cycle: o.cycle,
      repo: o.repo, offline: o.offline, env: process.env });
  }

  const out = o.format === "json" ? JSON.stringify(result, null, 2) + "\n"
    : o.format === "slack" ? JSON.stringify(renderSlack(result), null, 2) + "\n"
    : renderText(result);
  // Exit explicitly, as linkcheck.js does: fetch keeps its sockets open, and a monthly
  // job once idled for six hours on that. Flush first, since stdout may be a pipe.
  await Promise.race([
    new Promise(resolve => process.stdout.write(out, resolve)),
    new Promise(resolve => setTimeout(resolve, 2000)),
  ]);
  process.exit(0);
}

module.exports = {
  milesFromCityHall, geography, towns, freshness, rechecks, monthEnds, review, isOutside,
  githubClient, fetchReview, renderText, renderSlack, parseArgs, RING_MILES, CORE_TOWNS, SCHEMA,
};

if (require.main === module) main();
