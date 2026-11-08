#!/usr/bin/env node
/* ============================================================
   Export the atlas dataset to a spreadsheet-friendly CSV.

   Usage:
     node scripts/export-csv.js                 -> writes atlas.csv
     node scripts/export-csv.js my-export.csv   -> writes my-export.csv
     node scripts/export-csv.js -                -> prints to the screen (stdout)

   Then import the file into Google Sheets (File -> Import -> Upload) or
   Excel (Data -> From Text/CSV). One row per organization.
   ============================================================ */
const fs = require("fs");

const { CATS, STAGES, DATA } = require("./load-data").loadData();

// --- Lookups (turn codes into human-readable text) ---
const catLabel = c => (CATS[c] && CATS[c].label) || c || "";
const stageName = {};
for (const s of STAGES) stageName[s.n] = s.t;                 // 1 -> "Spark", 3 -> "Build", ...
const stagesToText = arr => (arr || []).map(n => stageName[n] || n).join("; ");

// --- CSV cell escaping (RFC 4180): quote fields containing comma/quote/newline ---
const cell = v => {
  if (v === undefined || v === null) v = "";
  v = String(v);
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
};
const toRow = arr => arr.map(cell).join(",");

// --- Columns: [ header, value(entry) ] ---
const COLUMNS = [
  ["id",             d => d.id],
  ["name",           d => d.name],
  ["category",       d => catLabel(d.cat)],          // human label, e.g. "Venture Capital"
  ["category_code",  d => d.cat],                     // raw key, e.g. "vc"
  ["location",       d => d.loc],
  ["approximate",    d => (d.approx ? "yes" : "")],
  ["lat",            d => d.lat],
  ["lng",            d => d.lng],
  ["website",        d => d.url],
  ["badge",          d => d.badge || ""],
  ["description",    d => d.desc],
  ["why_it_matters", d => d.why || ""],
  ["tags",           d => (d.tags || []).join("; ")],
  ["stages",         d => stagesToText(d.stages)],    // e.g. "Build; Fund"
  ["linked_ids",     d => (d.links || []).join("; ")],
  ["last_verified",  d => d.lastVerified || ""],        // "YYYY-MM" month last confirmed
  ["offers",         d => (d.offers || []).join("; ")], // what founders get (controlled vocab)
  ["apply_by",       d => d.applyBy || ""],             // "rolling" or "YYYY-MM-DD" deadline
  ["apply_note",     d => d.applyNote || ""],
  ["apply_url",      d => d.applyUrl || ""],            // the application page, when it isn't `url`
];

// --- Build the CSV ---
const lines = [toRow(COLUMNS.map(c => c[0]))];
for (const d of DATA) lines.push(toRow(COLUMNS.map(c => c[1](d))));
const BOM = String.fromCharCode(0xFEFF);   // byte-order mark: helps Excel read UTF-8 (accents, em-dashes)
const csv = BOM + lines.join("\r\n") + "\r\n";

// --- Output ---
const arg = process.argv[2] || "atlas.csv";
if (arg === "-") {
  process.stdout.write(csv);
} else {
  fs.writeFileSync(arg, csv);
  console.log(`Wrote ${DATA.length} organizations x ${COLUMNS.length} columns -> ${arg}`);
  console.log(`Import: Google Sheets (File -> Import -> Upload) or Excel (Data -> From Text/CSV).`);
}
