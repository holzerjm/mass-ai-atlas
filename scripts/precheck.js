#!/usr/bin/env node
/* Pre-check: the half of a reviewer's checklist for data/entities.yml that a machine can do.
 *
 *   node scripts/precheck.js                       the entries that differ from origin/main
 *   node scripts/precheck.js --base HEAD^1         ...from another ref (CI: the pull request's base)
 *   node scripts/precheck.js --ids csail,engine    these entries, changed or not
 *   node scripts/precheck.js --offline             skip the checks that need the network
 *   node scripts/precheck.js --annotations         also print ::warning lines for GitHub
 *
 * For each changed entry it answers 5 of the 8 questions in MAINTAINING.md's checklist (Part 2,
 * Step 3): does the website work, does the pin match the address, does the town match the pin, is
 * it a duplicate, and is the date current. The other three need a person, and the report says so.
 *
 * Advice only: it ALWAYS exits 0, and a network that doesn't answer is a note, not a warning. On
 * GitHub it writes its report to the job summary ($GITHUB_STEP_SUMMARY).
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const yaml = require("js-yaml");
const { loadData, DATA_DIR } = require("./load-data");
const today = require("./today");
const { probe: realProbe } = require("./probe");
const realGeo = require("./geo");

const FILE = path.join(DATA_DIR, "entities.yml");
const MAX_NETWORK = 30;      // a mechanical change to more entries than this isn't a re-check: don't sweep the web for it
const FAR_M = 300;           // a pin farther than this from its address is worth a look

const CHECKS = ["website", "pin", "town", "duplicate", "date"];
const PEOPLE = ["a real, active Massachusetts organization relevant to AI founders",
  "a factual, neutral description", "the right category", "any affiliation the author disclosed"];

// ---------- what changed ----------
function changedEntries(base, head) {
  const was = new Map(base.map(d => [d.id, d]));
  const out = [];
  for (const d of head) {
    const old = was.get(d.id);
    if (!old) { out.push({ id: d.id, d, old: null, isNew: true, fields: Object.keys(d) }); continue; }
    const fields = [...new Set([...Object.keys(old), ...Object.keys(d)])].filter(k => JSON.stringify(old[k]) !== JSON.stringify(d[k]));
    if (fields.length) out.push({ id: d.id, d, old, isNew: false, fields });
  }
  return out;
}
const touched = (c, ...fields) => c.isNew || fields.some(f => c.fields.includes(f));

// ---------- helpers ----------
const monthIndex = ym => { const [y, m] = ym.split("-").map(Number); return y * 12 + (m - 1); };
const clean = (s, n = 120) => String(s == null ? "" : s).replace(/[\r\n]+/g, " ").trim().slice(0, n);
const urlKey = u => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, "").toLowerCase() + x.pathname.replace(/\/+$/, "") + x.search); } catch { return String(u || ""); } };
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const nameKey = n => String(n || "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/\b(the|inc|llc|corp|co|ltd)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
// Nothing private, and only https: the address comes from a pull request
function publicUrl(u) {
  let x; try { x = new URL(u); } catch { return false; }
  if (x.protocol !== "https:") return false;
  const h = x.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return !(/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/.test(h) || /^(0|10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(h) || /^(::1|f[cd]|fe80)/.test(h) || !h.includes("."));
}

const ok = (check, text) => ({ check, status: "ok", text });
const warn = (check, text) => ({ check, status: "warn", text });
const note = (check, text) => ({ check, status: "note", text });

// ---------- the five checks ----------
async function checkWebsite(c, deps) {
  const urls = [];
  if (touched(c, "url", "lastVerified")) urls.push(["website", c.d.url]);
  if (c.d.applyUrl && touched(c, "applyUrl", "lastVerified")) urls.push(["application page", c.d.applyUrl]);
  const out = [];
  for (const [label, url] of urls) {
    if (!publicUrl(url)) { out.push(warn("website", `the ${label} isn't a plain public https:// address (${clean(url, 80)})`)); continue; }
    let r;
    try { r = await deps.probe(url); if (r.cls === "error") r = await deps.probe(url); } catch (e) { r = { cls: "error", note: clean(e.message) }; }
    const at = (label === "website" ? "" : label + ": ") + clean(url, 100);
    if (r.cls === "ok") out.push(ok("website", `the ${label} answers`));
    else if (r.cls === "moved") out.push(warn("website", `${at} — ${clean(r.note)}: update the url if that is the organization's own site`));
    else if (r.cls === "blocked") out.push(note("website", `${at} — it refuses bots (${clean(r.note)}): open it in a browser`));
    else if (r.cls === "broken") out.push(warn("website", `${at} — ${clean(r.note)}`));
    else out.push(note("website", `${at} — couldn't be reached from here (${clean(r.note)}): open it`));
  }
  return out;
}

// The street part of an entry's loc ("1 Broadway & 245 Main St, Kendall Sq" -> "1 Broadway")
function streetOf(loc) {
  const m = String(loc || "").match(/(?:^|[,·]\s*)(\d+[A-Za-z]?(?:-\d+)?\s+[A-Za-z][^,·&(]*)/);
  return m ? m[1].trim() : null;
}
async function checkPin(c, deps) {
  if (!touched(c, "loc", "lat", "lng", "approx", "town")) return [];
  if (c.d.approx) return [note("pin", `marked approximate (${clean(c.d.loc, 60)}): check by eye that the pin is about right`)];
  const street = streetOf(c.d.loc);
  if (!street) return [note("pin", `no street number in "${clean(c.d.loc, 60)}": check the pin by eye`)];
  let p;
  try { p = await deps.geo.addressPoint(street, c.d.town); }
  catch (e) { return [note("pin", `the Census Bureau's lookup didn't answer (${clean(e.message, 60)}): check the pin by eye`)]; }
  if (!p) return [note("pin", `the Census Bureau found no match for "${clean(street, 60)}, ${clean(c.d.town, 30)}": check the pin by eye`)];
  const m = Math.round(deps.geo.meters(c.d.lat, c.d.lng, p.lat, p.lng));
  if (m > FAR_M) return [warn("pin", `the pin is ${m} m from "${clean(p.matched, 60)}", its address in loc`)];
  return [ok("pin", `${m} m from its address`)];
}

async function checkTown(c, deps) {
  if (!touched(c, "lat", "lng", "town")) return [];
  let t;
  try { t = await deps.geo.townAt(c.d.lat, c.d.lng); }
  catch (e) { return [note("town", `the Census Bureau's lookup didn't answer (${clean(e.message, 60)}): check the town by eye`)]; }
  if (!t) return [note("town", "the Census Bureau has no town for this point: check it by eye")];
  return t === c.d.town ? [ok("town", `the pin is in ${t}`)] : [warn("town", `the pin is in ${t}, but town says ${clean(c.d.town, 40)}`)];
}

function checkDuplicate(c, all) {
  if (!touched(c, "name", "url")) return [];
  const others = all.filter(d => d.id !== c.id);
  const out = [];
  const sameUrl = others.filter(d => urlKey(d.url) === urlKey(c.d.url));
  if (sameUrl.length) out.push(warn("duplicate", `the same website as ${sameUrl.map(d => d.name).join(", ")}`));
  const k = nameKey(c.d.name);
  const sameName = others.filter(d => nameKey(d.name) === k);
  if (sameName.length) out.push(warn("duplicate", `the same name as ${sameName.map(d => d.name).join(", ")}`));
  if (!sameUrl.length) {
    const sameHost = others.filter(d => hostOf(d.url) === hostOf(c.d.url) && hostOf(c.d.url));
    if (sameHost.length) out.push(note("duplicate", `the same site as ${sameHost.map(d => d.name).slice(0, 3).join(", ")}: make sure it is a separate organization`));
  }
  if (!sameName.length && k.length >= 6) {
    const near = others.filter(d => { const n = nameKey(d.name); return n.length >= 6 && (n.includes(k) || k.includes(n)); });
    if (near.length) out.push(note("duplicate", `a similar name to ${near.map(d => d.name).slice(0, 3).join(", ")}`));
  }
  return out.length ? out : [ok("duplicate", "no other entry has its name or website")];
}

function checkDate(c, now) {
  const month = now.slice(0, 7), out = [];
  if (c.isNew && c.d.added !== month) out.push(warn("date", `added is ${clean(c.d.added || "missing", 10)}, and a new entry's is this month (${month})`));
  if (c.isNew && !c.d.lastVerified) out.push(warn("date", "lastVerified is missing"));
  if (c.d.lastVerified && touched(c, "lastVerified")) {
    const age = monthIndex(month) - monthIndex(c.d.lastVerified);
    if (age < 0) out.push(warn("date", `lastVerified is ${c.d.lastVerified}, which is in the future`));
    else if (age > 1) out.push(warn("date", `lastVerified is ${c.d.lastVerified}, ${age} months ago: it should be the month someone checked`));
    else out.push(ok("date", `lastVerified is ${c.d.lastVerified}`));
  }
  return out;
}

// ---------- run ----------
async function precheck(changed, all, deps) {
  const online = deps.online !== false;
  const netIds = changed.filter(c => touched(c, "url", "applyUrl", "lastVerified", "loc", "lat", "lng", "approx", "town"));
  const overLimit = online && netIds.length > MAX_NETWORK;
  const results = [];
  for (const c of changed) {
    let r = [];
    if (!online || overLimit) {
      r = [];
      const want = [touched(c, "url", "applyUrl", "lastVerified") && "website", touched(c, "loc", "lat", "lng", "approx", "town") && "pin", touched(c, "lat", "lng", "town") && "town"].filter(Boolean);
      if (want.length) r.push(note(want[0], !online ? `not checked (offline): ${want.join(", ")}` : `not checked: ${netIds.length} entries changed, more than ${MAX_NETWORK} at once (${want.join(", ")})`));
    } else {
      r = r.concat(await checkWebsite(c, deps), await checkPin(c, deps), await checkTown(c, deps));
    }
    r = r.concat(checkDuplicate(c, all), checkDate(c, deps.now));
    results.push({ id: c.id, name: c.d.name, isNew: c.isNew, fields: c.fields, checks: r });
  }
  return results;
}

// ---------- report ----------
const ICON = { ok: "✅", warn: "⚠️", note: "💬" };
// A pull request's own words end up in the summary: keep them out of the Markdown
const md = s => String(s).replace(/[|\r\n]/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_{}\[\]#~!]/g, "\\$&");

function report(results) {
  const warnings = results.reduce((n, r) => n + r.checks.filter(x => x.status === "warn").length, 0);
  const text = [], L = [];
  const head = `Pre-check (advice only): ${results.length} entr${results.length === 1 ? "y" : "ies"} changed, ${warnings} warning${warnings === 1 ? "" : "s"}.`;
  text.push(head);
  L.push(`## Pre-check, for the reviewer`, "", head + " It answers 5 of the 8 questions in MAINTAINING.md; nothing here blocks a merge.", "");
  if (results.length) {
    L.push("| Entry | Check | |", "|---|---|---|");
    for (const r of results) {
      const shown = r.checks.filter(x => x.status !== "ok").concat(r.checks.filter(x => x.status === "ok"));
      for (const [i, x] of shown.entries()) {
        L.push(`| ${i === 0 ? `\`${r.id.replace(/[^a-z0-9-]/g, "")}\` ${md(clean(r.name, 60))}` : ""} | ${ICON[x.status]} ${x.check} | ${md(x.text)} |`);
        text.push(`  ${ICON[x.status]} ${r.id} · ${x.check}: ${x.text}`);
      }
      if (!shown.length) { L.push(`| \`${r.id.replace(/[^a-z0-9-]/g, "")}\` ${md(clean(r.name, 60))} | — | nothing here for a machine to check (${md(clean(r.fields.join(", "), 80))}) |`); text.push(`  ${r.id}: nothing for a machine to check (${r.fields.join(", ")})`); }
    }
    L.push("", "✅ looks right · ⚠️ look at it · 💬 couldn't be settled by a machine", "", `**Left for you:** ${PEOPLE.join("; ")}.`, "");
  }
  return { text: text.join("\n"), markdown: L.join("\n") + "\n", warnings };
}

// GitHub's log commands: %, CR and LF are escaped, and a property's , and : too
const esc = (s, prop) => { s = String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A"); return prop ? s.replace(/:/g, "%3A").replace(/,/g, "%2C") : s; };
function annotations(results, lineOf) {
  const out = [];
  for (const r of results) for (const x of r.checks.filter(x => x.status === "warn"))
    out.push(`::warning file=data/entities.yml,line=${lineOf(r.id) || 1},title=${esc(`Pre-check: ${r.id}`, true)}::${esc(x.check + ": " + x.text)}`);
  return out;
}

async function main(argv) {
  const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
  const base = opt("--base") || "origin/main", ids = opt("--ids");
  const online = !argv.includes("--offline");
  const text = fs.readFileSync(FILE, "utf8");
  const head = loadData().DATA;
  let changed;
  if (ids) {
    const want = new Set(ids.split(","));
    changed = head.filter(d => want.has(d.id)).map(d => ({ id: d.id, d, old: d, isNew: false, fields: ["url", "applyUrl", "loc", "lat", "lng", "town", "name", "lastVerified"] }));
  } else {
    let was;
    try { was = yaml.load(execFileSync("git", ["show", `${base}:data/entities.yml`], { cwd: path.join(__dirname, ".."), encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] }), { schema: yaml.CORE_SCHEMA }) || []; }
    catch (e) { console.log(`Pre-check skipped: no data/entities.yml at ${base} (${clean(e.stderr || e.message, 100)})`); return 0; }
    changed = changedEntries(was, head);
  }
  if (!changed.length) { console.log("Pre-check: no entries changed."); if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Pre-check, for the reviewer\n\nNo entries changed.\n"); return 0; }
  const results = await precheck(changed, head, { online, now: today(), probe: realProbe, geo: realGeo });
  const rep = report(results);
  if (argv.includes("--json")) { console.log(JSON.stringify({ results, warnings: rep.warnings }, null, 1)); return 0; }
  console.log(rep.text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, rep.markdown);
  if (argv.includes("--annotations")) {
    const lines = text.split("\n");
    for (const a of annotations(results, id => { const i = lines.findIndex(l => l === `- id: ${id}`); return i === -1 ? 0 : i + 1; })) console.log(a);
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .catch(e => { console.log(`Pre-check could not run: ${clean(e && e.message, 200)}`); })
    .finally(async () => {
      // Node's fetch keeps pooled sockets open, which can hold the process (see linkcheck.js)
      await new Promise(r => process.stdout.write("", r));
      process.exit(0);
    });
}

module.exports = { changedEntries, checkWebsite, checkPin, checkTown, checkDuplicate, checkDate, precheck, report, annotations, streetOf, publicUrl, MAX_NETWORK };
