#!/usr/bin/env node
/* Fetch the homepage of every Atlas entry that has no links, politely, into survey/cache/.
 *
 *   node survey/fetch.js            -> skips pages already in the cache
 *   node survey/fetch.js --live     -> fetches again
 *   node survey/fetch.js pathai ... -> only these ids
 *
 * One request per second per host, honest user agent, robots.txt respected, no headless browser.
 * Writes survey/out/sources.json: every host contacted, for the declared-sources list.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DATA } = require("../scripts/load-data").loadData();

const CACHE = path.join(__dirname, "cache");
const OUT = path.join(__dirname, "out");
const UA = "mass-ai-atlas-survey/1.0 (Chart the Common Wealth hackathon; +https://github.com/kartsen03/mass-ai-atlas)";
// Terms forbid automated collection, or the page is a login wall
const BLOCKED = /(^|\.)(linkedin\.com|meetup\.com|facebook\.com|instagram\.com|x\.com|twitter\.com)$/;

const args = process.argv.slice(2);
const LIVE = args.includes("--live");
const ONLY = args.filter(a => !a.startsWith("--"));

const lastHit = new Map();
async function politeFetch(url) {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) || 0) + 1000 - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastHit.set(host, Date.now());
  return fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
}

// shortcut: reads only the "User-agent: *" Disallow lines (no Allow, no wildcards); upgrade if we fetch deeper than homepages
function parseRobots(txt) {
  const rules = [];
  let star = false, prevAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line.includes(":")) continue;
    const key = line.slice(0, line.indexOf(":")).trim().toLowerCase();
    const val = line.slice(line.indexOf(":") + 1).trim();
    if (key === "user-agent") { star = (prevAgent && star) || val === "*"; prevAgent = true; continue; }
    prevAgent = false;
    if (star && key === "disallow" && val) rules.push(val === "/*" ? "/" : val);
  }
  return rules;
}

const robots = new Map();
async function allowed(url) {
  const u = new URL(url);
  if (!robots.has(u.origin)) {
    let rules = [];
    try {
      const res = await politeFetch(u.origin + "/robots.txt");
      if (res.ok) rules = parseRobots(await res.text());
    } catch {}
    robots.set(u.origin, rules);
  }
  return !robots.get(u.origin).some(p => u.pathname.startsWith(p));
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const targets = DATA.filter(d => !(d.links || []).length && (!ONLY.length || ONLY.includes(d.id)));
  let fetched = 0, cached = 0;
  for (const d of targets) {
    const metaFile = path.join(CACHE, d.id + ".json");
    if (!LIVE && fs.existsSync(metaFile)) { cached++; continue; }
    const meta = { id: d.id, url: d.url, fetched_at: new Date().toISOString() };
    const host = new URL(d.url).hostname.replace(/^www\./, "");
    if (BLOCKED.test(host)) meta.skipped = "site terms forbid automated collection";
    else if (!(await allowed(d.url))) meta.skipped = "robots.txt disallows";
    else {
      try {
        const res = await politeFetch(d.url);
        const body = (await res.text()).slice(0, 3e6);
        Object.assign(meta, { status: res.status, final_url: res.url, sha256: crypto.createHash("sha256").update(body).digest("hex") });
        if (res.ok) fs.writeFileSync(path.join(CACHE, d.id + ".html"), body);
      } catch (e) {
        meta.error = String(e.cause?.code || e.name || e);
      }
    }
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
    fetched++;
    console.log(`${d.id.padEnd(24)} ${meta.skipped || meta.error || meta.status}`);
  }

  // Declared sources: every host contacted, rebuilt from the whole cache so cached runs list it too
  const hosts = new Set();
  for (const f of fs.readdirSync(CACHE).filter(f => f.endsWith(".json"))) {
    const m = JSON.parse(fs.readFileSync(path.join(CACHE, f), "utf8"));
    if (m.skipped === "site terms forbid automated collection") continue;
    for (const u of [m.url, m.final_url]) if (u) hosts.add(new URL(u).hostname);
  }
  fs.writeFileSync(path.join(OUT, "sources.json"), JSON.stringify({ updated_at: new Date().toISOString(), hosts: [...hosts].sort() }, null, 1) + "\n");
  console.log(`\nfetched ${fetched}, already cached ${cached}, hosts contacted ${hosts.size} -> survey/out/sources.json`);
}

main();
