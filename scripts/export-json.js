#!/usr/bin/env node
/* Generates atlas.json — the public machine-readable dataset served at
 * https://the-open-accelerator.com/ecosystem/atlas.json (CI regenerates it on
 * every deploy; the file is gitignored locally).
 *
 * The envelope is versioned: bump `schema` on any breaking change to entry
 * fields so downstream consumers can detect it.
 *
 * Usage: node scripts/export-json.js [outfile]
 */
const fs = require("fs");
const path = require("path");

const { CATS, STAGES, DATA } = require("./load-data").loadData();

const counts = {};
for (const d of DATA) counts[d.cat] = (counts[d.cat] || 0) + 1;

const out = {
  schema: 1,
  generated: new Date().toISOString(),
  title: "Mass AI Atlas — verified organizations of Massachusetts' AI ecosystem",
  source: "https://github.com/holzerjm/mass-ai-atlas",
  website: "https://the-open-accelerator.com/ecosystem/",
  license: "CC BY 4.0 — (c) The Open Accelerator; attribution required",
  license_url: "https://creativecommons.org/licenses/by/4.0/",
  total: DATA.length,
  counts,
  cats: CATS,
  stages: STAGES,
  data: DATA,
};

const dest = process.argv[2] || path.join(__dirname, "..", "atlas.json");
fs.writeFileSync(dest, JSON.stringify(out, null, 1));
console.log(`atlas.json → ${DATA.length} entries → ${dest}`);
