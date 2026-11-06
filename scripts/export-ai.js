#!/usr/bin/env node
/* Generates atlas-ai.txt — the atlas in a compact form for a founder's own AI assistant,
 * served at https://the-open-accelerator.com/ecosystem/atlas-ai.txt (CI regenerates it on
 * every deploy; the file is gitignored locally). The page's "Ask your own AI" prompt points
 * at it.
 *
 * This file is data only. The rules for the assistant live in the prompt in index.html,
 * which the founder can read and pastes in themselves. A careful assistant is right to
 * distrust instructions it finds inside a fetched file, so none belong here.
 *
 * Organizations go A to Z, so nobody's position depends on anything but their name. The
 * last line lets an assistant tell whether it read the whole file: web tools often cut a
 * long page without saying so, and a file cut at M would quietly lose everything after it.
 *
 * Usage: node scripts/export-ai.js [outfile]
 */
const fs = require("fs");
const path = require("path");

const { loadData, loadPathways } = require("./load-data");
const { CATS, STAGES, DATA } = loadData();
const PATHWAYS = loadPathways();

const SITE = "https://the-open-accelerator.com/ecosystem/";   // a copy changes this, as it does BASE in build-pages.js
const TODAY = new Date().toISOString().slice(0, 10);
const LAST_LINE = "End of file";
const stageName = Object.fromEntries(STAGES.map(s => [s.n, s.t]));
const byId = Object.fromEntries(DATA.map(d => [d.id, d]));
const PITCHES = "takes pitches";

// The same four states the page shows. A date that has passed says nothing, as it does there.
function applications(d) {
  const note = d.applyNote ? ` (${d.applyNote})` : "";
  if (d.applyBy === "rolling") return `open, rolling${note}`;
  if (d.applyBy && d.applyBy >= TODAY) return `apply by ${d.applyBy}${note}`;
  if (!d.applyBy && d.applyNote) return `closed${note}`;
  if (!d.applyBy && d.applyUrl && (d.cat === "vc" || d.cat === "angel")) return PITCHES;
  return "";
}

function entry(d) {
  const lines = [`### ${d.name} [${d.id}]`];
  lines.push([CATS[d.cat].label, d.loc, d.lastVerified && `verified ${d.lastVerified}`].filter(Boolean).join(" · "));
  const about = [
    (d.stages || []).length && `Stages: ${d.stages.map(n => stageName[n]).join(", ")}.`,
    `Offers: ${d.offers.join(", ")}.`,
    (d.tags || []).length && `Tags: ${d.tags.join(", ")}.`,
  ].filter(Boolean).join(" ");
  lines.push(about);
  const status = applications(d);
  if (status) lines.push(`Applications: ${status}.` + (d.applyUrl ? ` ${status === PITCHES ? "Pitch" : "Apply"} at ${d.applyUrl}` : ""));
  lines.push(`Site: ${d.url}`);
  lines.push(`About: ${d.desc}`);
  if (d.why) lines.push(`Why it matters: ${d.why}`);
  if (d.facts) lines.push(`Facts: ${d.facts.map(([k, v]) => `${k}: ${v}`).join("; ")}`);
  return lines.join("\n");
}

function pathway(p) {
  const steps = p.steps.map((s, i) => {
    const ids = (s.entries || []).filter(id => byId[id]);
    const who = ids.length ? ` Organizations: ${ids.join(", ")}.` : "";
    const more = s.more ? ` See also every ${[s.more.need, s.more.cat && CATS[s.more.cat].label].filter(Boolean).join(" ")} entry at this stage.` : "";
    return `${i + 1}. ${s.do}. ${s.why}${who}${more}`;
  });
  return [`### ${stageName[p.stage]}: ${p.title}`, p.lead, ...steps].join("\n");
}

const list = [...DATA].sort((a, b) => a.name.localeCompare(b.name));
const text = [
  "# Mass AI Atlas: compact data",
  "Organizations in Massachusetts' AI ecosystem, what each one offers a founder, and hand-written pathways through the founder stages.",
  `Source: ${SITE} (full data: ${SITE}atlas.json)`,
  "Presented by The Open Accelerator, an initiative between the MA AI Hub, Red Hat, and IBM. Nobody pays to appear here.",
  "License: CC BY 4.0. Credit: Mass AI Atlas, The Open Accelerator.",
  `Generated ${TODAY}. ${DATA.length} organizations and ${PATHWAYS.length} pathways. The last line of this file is "${LAST_LINE}".`,
  "",
  "## How to read it",
  `An organization's atlas page is ${SITE}?entry=ID, where ID is the value in square brackets after its name.`,
  "\"verified\" is the month a person last confirmed the organization is real and its entry is right.",
  "Applications: \"open, rolling\" means taking applications now, \"apply by\" gives the next deadline, \"closed\" means not now, and \"takes pitches\" means a funder's own page invites pitches, with no set application process. With no Applications line, the atlas has no information, which doesn't mean there's no way in.",
  `Stages: ${STAGES.map(s => `${s.t} (${s.s})`).join(", ")}.`,
  "",
  "## Pathways",
  "Each is an ordered route for one situation. A step is a kind of option, not a ranking of the organizations in it.",
  "",
  PATHWAYS.map(pathway).join("\n\n"),
  "",
  "## Organizations, A to Z",
  "",
  list.map(entry).join("\n\n"),
  "",
  LAST_LINE,
  "",
].join("\n");

const dest = process.argv[2] || path.join(__dirname, "..", "atlas-ai.txt");
fs.writeFileSync(dest, text);
console.log(`atlas-ai.txt → ${DATA.length} entries, ${PATHWAYS.length} pathways, ${Math.round(text.length / 1024)} KB → ${dest}`);
