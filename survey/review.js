#!/usr/bin/env node
/* The human gate: approve or reject each proposed link, one at a time, high confidence first.
 *
 *   node survey/review.js
 *
 * Keys: a approve · r reject · s skip · o open the source page · q quit.
 * Saves survey/out/proposed-links.json after every answer, so quitting loses nothing.
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { execFile } = require("child_process");
const { DATA } = require("../scripts/load-data").loadData();

const FILE = path.join(__dirname, "out", "proposed-links.json");
const name = new Map(DATA.map(d => [d.id, d.name]));
const RANK = { high: 0, medium: 1, low: 2 };
const save = rows => fs.writeFileSync(FILE, "[\n" + rows.map(r => " " + JSON.stringify(r)).join(",\n") + "\n]\n");

async function main() {
  const rows = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const queue = rows.filter(r => r.status === "pending").sort((a, b) => RANK[a.confidence] - RANK[b.confidence]);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let n = 0;
  for (const r of queue) {
    console.log(`\n[${++n}/${queue.length}] ${r.confidence.toUpperCase()} · ${r.relation}`);
    console.log(`  ${name.get(r.from_id)} (${r.from_id})  ->  ${name.get(r.to_id)} (${r.to_id})`);
    console.log(`  "${r.quote}"`);
    console.log(`  ${r.source_url}`);
    let key;
    while (!["a", "r", "s", "q"].includes((key = (await rl.question("  [a]pprove [r]eject [s]kip [o]pen [q]uit > ")).trim().toLowerCase())))
      if (key === "o") execFile("open", [r.source_url]);
    if (key === "q") break;
    if (key === "s") continue;
    r.status = key === "a" ? "approved" : "rejected";
    save(rows);
  }
  rl.close();
  console.log("\n", rows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {}));
}

main();
