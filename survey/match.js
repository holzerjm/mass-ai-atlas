#!/usr/bin/env node
/* Propose links: find other Atlas entries named on each unlinked entry's own homepage.
 *
 *   node survey/match.js   -> reads survey/cache/ (run fetch.js first),
 *                             writes survey/out/proposed-links.json (Contract 1)
 *
 * Deterministic: no AI. Every row carries the page it came from and the exact sentence.
 * Re-running keeps any status a reviewer already gave a (from_id, to_id) pair.
 */
const fs = require("fs");
const path = require("path");
const { DATA } = require("../scripts/load-data").loadData();

const CACHE = path.join(__dirname, "cache");
const FILE = path.join(__dirname, "out", "proposed-links.json");
const byId = new Map(DATA.map(d => [d.id, d]));

// Names that are ordinary words, or too vague to trust on their own
const GENERIC = new Set(["Matrix", "Apple", "Oracle", "Converge", "Luminous", "IDEA"]);

// "GV (Google Ventures)" -> GV, Google Ventures; "Apple (Cambridge)" -> Apple (a one-word place is not an alias)
function variants(name) {
  const m = name.match(/^(.*?)\s*\((?:fka\s+)?([^)]*)\)$/);
  const out = [m ? m[1] : name];
  if (m && m[2].includes(" ")) out.push(m[2]);
  return out.filter(v => v.length >= 4 && !GENERIC.has(v));
}

// variant -> id, dropping any variant two entries share
const NAMES = (() => {
  const seen = new Map();
  for (const d of DATA) for (const v of variants(d.name)) seen.set(v, seen.has(v) ? null : d.id);
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...seen].filter(([, id]) => id).map(([v, id]) => ({ id, v, re: new RegExp(`(?<![\\w@^&])${esc(v)}(?![\\w@])`, "g") }));
})();

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", hellip: "…" };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITIES[e.toLowerCase()] ?? m);

// Visible page text as sentences; menus and footers are dropped so a nav link is not a "connection"
function sentences(html) {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|head|nav|footer)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/?(p|div|li|h[1-6]|br|tr|td|section|article|ul|ol|blockquote|button|a)\b[^>]*>/gi, m => (/^<\/?a\b/i.test(m) ? " " : "\n"))
    .replace(/<[^>]+>/g, " ");
  return decode(text)
    .split(/\n|(?<=[.!?])\s+(?=[A-Z"“])/)
    .map(s => s.replace(/\s+/g, " ").trim())
    .filter(s => s.length >= 20 && !/[{}]|\\"|":/.test(s));   // embedded JSON is not page text
}

// A sentence about a person (a bio, a speaker card) is not an org-to-org link, and its names must not be stored
const PERSON = new RegExp([
  /\b(he|she|his|her|him)\b/,
  /\b(ceo|cto|coo|cfo|cmo|evp|svp|vp|co-?founder|former|previously|prior to joining|director|professor|engineer|architect|head of|\w+ lead (?:at|,)|advis[eo]rs?|execs?|president|member of (?:the )?technical staff|phd)\b/,
  / · /,
  /(^|, )[A-Z][a-z]+ (led|joined|earned|served|generated|built|worked|architected|spent|brings)\b/,
].map(r => r.source).join("|"), "i");

const RELATIONS = [
  ["funded_by", /\b(backed by|invest(?:ed|ors?|ment)|funded by|funding from|portfolio|led by|seed round|raised)\b/i],
  ["program_of", /\b(program (?:of|from|at)|a ?part of|grew out of|spun out|spin-?out|initiative of|run by|founded at|born (?:at|out of))\b/i],
  ["hosted_at", /\b(based (?:at|in)|located (?:at|in)|housed (?:at|in)|resident|offices? (?:at|in)|headquartered (?:at|in))\b/i],
  ["partner", /\b(partner(?:s|ed|ship)?|collaborat\w*|together with|co-?host\w*|sponsor\w*|in association with)\b/i],
  ["related", /\b(alum(?:ni|nus|na)?|cohort|graduates? of|accelerator|incubat\w*|member of)\b/i],
];
const RANK = { high: 0, medium: 1, low: 2 };

// An exact piece of the sentence, at most ~240 characters, centred on the name
function excerpt(s, at, len) {
  if (s.length <= 300) return s;
  let a = Math.max(0, at - 110), b = Math.min(s.length, at + len + 110);
  if (a > 0) a = s.indexOf(" ", a) + 1;
  if (b < s.length) b = s.lastIndexOf(" ", b);
  return s.slice(a, b);
}

// "NVIDIA (Westford)" -> "Westford": a mention of the global company is not proof about the local office
const placeOf = name => (name.match(/\(([A-Z][a-z]+)\)$/) || [])[1];

function candidates(d, html, sourceUrl) {
  const linked = id => (d.links || []).includes(id) || (byId.get(id).links || []).includes(d.id);
  const selfNames = variants(d.name);
  const out = [], refused = [];
  for (const s of sentences(html)) {
    const hits = [];
    for (const n of NAMES) for (const m of s.matchAll(n.re)) hits.push({ id: n.id, at: m.index, len: m[0].length });
    // keep the longest name at each spot ("Harvard Innovation Labs", not a shorter name inside it)
    const kept = hits.filter(h => !hits.some(o => o !== h && o.at <= h.at && o.at + o.len >= h.at + h.len && o.len > h.len));
    const named = new Set(kept.map(h => h.id));
    const person = PERSON.test(s);
    const rel = RELATIONS.find(([, re]) => re.test(s));
    const aboutSelf = selfNames.some(v => s.includes(v)) || /\b(we|our)\b/i.test(s);
    for (const h of kept) {
      if (h.id === d.id || linked(h.id)) continue;
      if (person) { refused.push({ from_id: d.id, to_id: h.id, source_url: sourceUrl, reason: "about a person, not an org link" }); continue; }
      // no connection word -> low; a connection word in a short sentence about this org, or with few names -> high
      let confidence = !rel ? "low" : (aboutSelf || named.size <= 2) && s.length <= 300 ? "high" : "medium";
      const place = placeOf(byId.get(h.id).name);
      if (confidence === "high" && place && !s.includes(place)) confidence = "medium";
      out.push({ from_id: d.id, to_id: h.id, relation: rel ? rel[0] : "related", source_url: sourceUrl,
        quote: excerpt(s, h.at, h.len), confidence, status: "pending" });
    }
  }
  return { out, refused };
}

function main() {
  const old = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : [];
  const status = new Map(old.map(r => [r.from_id + ">" + r.to_id, r.status]));
  // reviewed rows survive a re-run even if the page no longer shows them
  const rows = new Map(old.filter(r => r.status !== "pending").map(r => [r.from_id + ">" + r.to_id, r]));
  const refusals = new Map();
  let pages = 0, empty = 0;
  for (const d of DATA) {
    const htmlFile = path.join(CACHE, d.id + ".html");
    if (!fs.existsSync(htmlFile)) continue;
    const meta = JSON.parse(fs.readFileSync(path.join(CACHE, d.id + ".json"), "utf8"));
    const html = fs.readFileSync(htmlFile, "utf8");
    pages++;
    if (!sentences(html).length) empty++;
    const { out, refused } = candidates(d, html, meta.final_url || d.url);
    for (const r of refused) refusals.set(r.from_id + ">" + r.to_id, r);
    for (const c of out) {
      const key = c.from_id + ">" + c.to_id;
      if (rows.has(key) && rows.get(key).status !== "pending") continue;
      const prev = rows.get(key);
      if (!prev || RANK[c.confidence] < RANK[prev.confidence] || (c.confidence === prev.confidence && c.quote.length < prev.quote.length))
        rows.set(key, { ...c, status: status.get(key) || "pending" });
    }
  }
  const list = [...rows.values()].sort((a, b) => (a.from_id + ">" + a.to_id).localeCompare(b.from_id + ">" + b.to_id));
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  // one row per line keeps git diffs and merges small
  const jsonl = rows => "[\n" + rows.map(r => " " + JSON.stringify(r)).join(",\n") + "\n]\n";
  fs.writeFileSync(FILE, jsonl(list));
  // refusals keep no quote, so no personal names are stored; a pair that also has a good sentence is not refused
  const refusedList = [...refusals].filter(([k]) => !rows.has(k)).map(([, r]) => r).sort((a, b) => (a.from_id + a.to_id).localeCompare(b.from_id + b.to_id));
  fs.writeFileSync(path.join(path.dirname(FILE), "refusals.json"), jsonl(refusedList));
  const by = k => list.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
  console.log(`pages read ${pages} (no readable text: ${empty}) · proposed ${list.length} links from ${new Set(list.map(r => r.from_id)).size} entries · refused ${refusedList.length}`);
  console.log("confidence", by("confidence"), "relation", by("relation"), "status", by("status"));
}

if (require.main === module) main();
module.exports = { variants, sentences, candidates };
