#!/usr/bin/env node
/* Probe 2: how many Atlas entries have no connections.
 *   no_links  entries whose links list is empty (the organizers' "zero edges" count and the chatbot's doubt)
 *   isolated  entries with no links either way (nobody links to them either)
 * "after" adds the approved rows of out/proposed-links.json in memory. On the proposals branch,
 * where they are already in data/entities.yml, before and after come out the same.
 *
 *   node survey/probes.js                            -> prints the numbers and writes survey/out/probes.json
 *   node survey/probes.js ../mass-ai-atlas-proposals -> prints the numbers for that checkout's data only
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const OTHER = process.argv[2] && path.resolve(process.argv[2]);
const { DATA } = require(path.join(OTHER || path.join(__dirname, ".."), "scripts", "load-data")).loadData();

const OUT = path.join(__dirname, "out");
const LINKS = path.join(OUT, "proposed-links.json");

function probe(extra) {
  const links = new Map(DATA.map(d => [d.id, new Set(d.links || [])]));
  for (const r of extra) links.get(r.from_id)?.add(r.to_id);
  const linkedTo = new Set([...links.values()].flatMap(s => [...s]));
  const none = DATA.filter(d => !links.get(d.id).size);
  return { entries: DATA.length, no_links: none.length, isolated: none.filter(d => !linkedTo.has(d.id)).length };
}

const rows = fs.existsSync(LINKS) ? JSON.parse(fs.readFileSync(LINKS, "utf8")) : [];
const approved = rows.filter(r => r.status === "approved");
// Calibration: how often a human approved each confidence level (pending rows not counted)
const calibration = {};
for (const level of ["high", "medium", "low"]) {
  const decided = rows.filter(r => r.confidence === level && r.status !== "pending");
  const yes = decided.filter(r => r.status === "approved").length;
  calibration[level] = { approved: yes, decided: decided.length, rate: decided.length ? +(yes / decided.length).toFixed(2) : null };
}
let commit = null;
try { commit = execSync("git rev-parse --short HEAD", { cwd: __dirname }).toString().trim(); } catch {}

const result = {
  measured_at: new Date().toISOString(),
  data_commit: commit,
  approved_links: approved.length,
  before: probe([]),
  after: probe(approved),
  calibration,
};
if (!OTHER) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "probes.json"), JSON.stringify(result, null, 2) + "\n");
}
console.log(`Probe 2 · entries with no links: ${result.before.no_links} -> ${result.after.no_links}` +
  `  (isolated: ${result.before.isolated} -> ${result.after.isolated}, approved links: ${approved.length})`);
