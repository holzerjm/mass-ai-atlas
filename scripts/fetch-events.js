#!/usr/bin/env node
/* fetch-events.js — builds events.json for /ecosystem/events/: Boston AI
 * community events over the next N days (default 10).
 *
 * Sources (see events-sources.json; no headless browser anywhere):
 *   1. Luma calendar ICS feeds        — public subscribe URLs, keyless
 *   2. Luma discover API (slug=ai)    — undocumented; best-effort, may break
 *   3. AI Tinkerers Boston            — homepage JSON-LD + llms-full.txt,
 *                                       per their agents.md usage terms
 *   4. events-manual.json             — maintainer/community one-offs
 *
 * The Luma discover-API approach builds on Nick Png's startup-event-scraper
 * (github.com/nkpng2k/startup-event-scraper, Apache-2.0) — thanks Nick.
 *
 * Output: events.json (gitignored) — rsynced to the server by CI, never
 * committed. Run weekly by .github/workflows/weekly-events.yml.
 *
 * Usage: node scripts/fetch-events.js [--days 10] [--out events.json]
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SOURCES = JSON.parse(fs.readFileSync(path.join(ROOT, "events-sources.json"), "utf8"));
const UA = "mass-ai-atlas-events/1.0 (github.com/holzerjm/mass-ai-atlas; weekly)";

const argv = process.argv.slice(2);
const argN = (flag, dflt) => { const i = argv.indexOf(flag); return i !== -1 && argv[i+1] ? argv[i+1] : dflt; };
const DAYS = parseInt(argN("--days", "10"), 10);
const OUT = argN("--out", path.join(ROOT, "events.json"));

const NOW = new Date();
const HORIZON = new Date(NOW.getTime() + DAYS * 86400e3);

// Relevance for general (non-AI-default) sources: AI proper, plus the
// data-infrastructure community — in Boston it is the same crowd.
const AI_RE = /\b(ai|a\.i\.|artificial intelligence|machine learning|\bml\b|llm|genai|gen-ai|generative|agentic|agents?|deep learning|neural|nlp|computer vision|robotics|data science|mlops|rag\b|foundation model|openai|anthropic|hugging ?face)\b/i;
const DATA_RE = /\b(data (party|engineer\w*|infra\w*|platform|stack|pipeline|meetup)|clickhouse|databricks|snowflake|kafka|duckdb|postgres|analytics|database|vector (db|database|search)|observability|etl)\b/i;
const relevant = (txt) => AI_RE.test(txt) || DATA_RE.test(txt);

// ---------- tiny ICS parser (only what Luma feeds emit) ----------
function parseICS(text) {
  const events = [];
  const unfold = text.replace(/\r?\n[ \t]/g, "");          // unfold continuations
  for (const block of unfold.split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0];
    const get = (k) => { const m = body.match(new RegExp("^" + k + "[^:]*:(.*)$", "m")); return m ? m[1].trim() : ""; };
    const unesc = (s) => s.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
    const dt = (v) => {  // 20260903T220000Z or date-only
      const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?/);
      if (!m) return null;
      return m[4] !== undefined
        ? new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]))
        : new Date(Date.UTC(+m[1], +m[2]-1, +m[3]));
    };
    const desc = unesc(get("DESCRIPTION"));
    const urlM = desc.match(/https:\/\/(?:lu\.ma|luma\.com)\/[A-Za-z0-9-]+/);
    events.push({
      title: unesc(get("SUMMARY")),
      start: dt(get("DTSTART")),
      end: dt(get("DTEND")),
      url: urlM ? urlM[0] : "",
      venue: unesc(get("LOCATION")),
      organizer: (body.match(/^ORGANIZER;CN=([^:;]+)/m) || [,""])[1].replace(/^"|"$/g, ""),
      desc,
    });
  }
  return events;
}

async function get(url, accept = "*/*") {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA, "Accept": accept } });
    clearTimeout(t);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally { clearTimeout(t); }
}

const events = [];   // {title,start,end,url,venue,organizer,source,ai}
const errors = [];
const push = (e, source, ai) => {
  if (!e.title || !e.start || !e.url) return;
  if (!(e.start instanceof Date) || isNaN(e.start)) return; // a bad date in events-manual.json must not crash the whole refresh
  if (e.start < NOW || e.start > HORIZON) return;
  events.push({ ...e, source, ai });
};

// ---------- 1. Luma calendar ICS feeds ----------
async function pullCalendars() {
  for (const cal of SOURCES.luma_calendars) {
    try {
      const ics = await get(`https://api.luma.com/ics/get?entity=calendar&id=${cal.id}`, "text/calendar");
      for (const e of parseICS(ics))
        push(e, `luma:${cal.slug}`, cal.ai_default || relevant(e.title + " " + e.desc));
    } catch (err) { errors.push(`calendar ${cal.slug}: ${err.message}`); }
  }
}

// ---------- 2. Luma discover (best-effort; undocumented API) ----------
// Two passes: the AI category feed (everything is in-scope) and the
// unfiltered Boston city feed, keyword-screened for AI/data relevance.
async function pullDiscover() {
  for (const cfg of SOURCES.luma_discover) {
    const label = cfg.slug ? `luma:discover-${cfg.slug}` : "luma:discover-boston";
    let cursor = "", pages = 0;
    try {
      while (pages++ < 8) {
        const qs = new URLSearchParams({ latitude: cfg.latitude, longitude: cfg.longitude, pagination_limit: "25" });
        if (cfg.slug) qs.set("slug", cfg.slug);
        if (cursor) qs.set("pagination_cursor", cursor);
        const data = JSON.parse(await get(`https://api.luma.com/discover/get-paginated-events?${qs}`, "application/json"));
        for (const it of data.entries || []) {
          const ev = it.event || it;
          const organizer = (it.calendar && it.calendar.name) || ((ev.hosts || [])[0] || {}).name || "";
          push({
            title: ev.name || "",
            start: ev.start_at ? new Date(ev.start_at) : null,
            end: ev.end_at ? new Date(ev.end_at) : null,
            url: ev.url ? `https://luma.com/${ev.url}` : "",
            venue: (ev.geo_address_info && (ev.geo_address_info.address || ev.geo_address_info.city_state)) || "",
            organizer,
            desc: "",
          }, label, cfg.ai_default || relevant((ev.name || "") + " " + organizer));
        }
        if (!data.has_more || !data.next_cursor) break;
        const last = (data.entries || []).map(x => (x.event || x).start_at).filter(Boolean).pop();
        if (last && new Date(last) > HORIZON) break;
        cursor = data.next_cursor;
      }
    } catch (err) { errors.push(`${label}: ${err.message} (best-effort source — page still builds)`); }
  }
}

// ---------- 3. AI Tinkerers Boston ----------
async function pullTinkerers() {
  const base = SOURCES.aitinkerers.base;
  const browserUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
  // 3a: homepage JSON-LD ItemList of Event objects
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
    const res = await fetch(base + "/", { signal: ctl.signal, headers: { "User-Agent": browserUA } });
    clearTimeout(t);
    if (res.ok) {
      const html = await res.text();
      for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        let ld; try { ld = JSON.parse(m[1]); } catch { continue; }
        const items = ld["@type"] === "ItemList" ? (ld.itemListElement || []).map(x => x.item || x) : (ld["@type"] === "Event" ? [ld] : []);
        for (const ev of items) {
          if (!ev || ev["@type"] !== "Event") continue;
          push({
            title: ev.name || "",
            start: ev.startDate ? new Date(ev.startDate) : null,
            end: ev.endDate ? new Date(ev.endDate) : null,
            url: ev.url || "",
            venue: (ev.location && (ev.location.name || (ev.location.address && ev.location.address.streetAddress))) || "",
            organizer: "AI Tinkerers Boston", desc: "",
          }, "aitinkerers", true);
        }
      }
    }
  } catch (err) { errors.push(`aitinkerers homepage: ${err.message}`); }
  // 3b: llms-full.txt — catches events the homepage JSON-LD omits
  try {
    const txt = await get(base + "/llms-full.txt", "text/plain");
    for (const sec of txt.split(/^### /m).slice(1)) {
      const title = sec.split("\n")[0].trim();
      const url = (sec.match(/^> Source: (\S+)/m) || [,""])[1];
      const date = (sec.match(/\*\*Date:\*\*\s*(?:\w+day,\s*)?([A-Z][a-z]+ \d{1,2}, \d{4})/) || [,""])[1];
      const time = (sec.match(/Time:\s*(\d{1,2}:\d{2}\s*[AP]M)/i) || [,""])[1];
      const loc = (sec.match(/\*\*Location:\*\*\s*(.+)/) || [,""])[1];
      if (!title || !url || !date) continue;
      const start = new Date(`${date} ${time || "6:00 PM"} GMT-0400`);
      if (isNaN(start)) continue;
      push({ title, start, end: null, url, venue: (loc || "").trim(), organizer: "AI Tinkerers Boston", desc: "" },
        "aitinkerers", true);
    }
  } catch (err) { errors.push(`aitinkerers llms-full: ${err.message}`); }
}

// ---------- 4. manual one-offs ----------
function pullManual() {
  const p = path.join(ROOT, "events-manual.json");
  if (!fs.existsSync(p)) return;
  try {
    for (const e of JSON.parse(fs.readFileSync(p, "utf8")))
      push({ title: e.title, start: new Date(e.start), end: e.end ? new Date(e.end) : null,
        url: e.url, venue: e.venue || "", organizer: e.organizer || "", desc: "" }, "manual", e.ai !== false);
  } catch (err) { errors.push(`events-manual.json: ${err.message}`); }
}

// ---------- atlas host matching (adds atlasId when the organizer is an entry) ----------
function matchAtlas(list) {
  const { DATA } = require("./load-data").loadData();
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const byName = DATA.map(d => [d.id, norm(d.name)]);
  for (const e of list) {
    const o = norm(e.organizer || "");
    if (!o) continue;
    const hit = byName.find(([, n]) => n === o || (o.length > 5 && (n.includes(o) || o.includes(n))));
    if (hit) e.atlasId = hit[0];
  }
}

(async () => {
  await Promise.all([pullCalendars(), pullDiscover(), pullTinkerers()]);
  pullManual();

  // AI filter + dedupe (by url, then by title+day)
  const seen = new Set();
  const clean = [];
  for (const e of events.sort((a, b) => a.start - b.start)) {
    if (!e.ai) continue;
    const day = e.start.toISOString().slice(0, 10);
    const k1 = e.url.replace(/^https:\/\/(lu\.ma|luma\.com)/, "luma").replace(/\/$/, "");
    const k2 = e.title.toLowerCase().replace(/\s+/g, " ") + "|" + day;
    if (seen.has(k1) || seen.has(k2)) continue;
    seen.add(k1); seen.add(k2);
    for (const f of ["title", "venue", "organizer"])
      e[f] = String(e[f] || "").replace(/[<>]/g, "").slice(0, 200);   // never HTML
    clean.push({ title: e.title, start: e.start.toISOString(), end: e.end ? e.end.toISOString() : null,
      url: e.url, venue: e.venue, organizer: e.organizer, source: e.source, atlasId: undefined });
  }
  matchAtlas(clean);

  const out = {
    schema: 1,
    generated: NOW.toISOString(),
    window_days: DAYS,
    source: "https://github.com/holzerjm/mass-ai-atlas",
    credits: "Luma discover approach builds on github.com/nkpng2k/startup-event-scraper (Apache-2.0)",
    errors,
    total: clean.length,
    events: clean,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`events.json → ${clean.length} AI events in the next ${DAYS} days → ${OUT}`);
  const bySrc = {};
  for (const e of clean) bySrc[e.source] = (bySrc[e.source] || 0) + 1;
  console.log("by source:", JSON.stringify(bySrc));
  if (errors.length) console.log("source errors (page still builds):\n  " + errors.join("\n  "));
})();
