#!/usr/bin/env node
/* Write the approved links into a proposals checkout's data/entities.yml, changing only the
 * links line of each affected entry (or adding one just above offers:). Never touches main.
 *
 *   git worktree add ../mass-ai-atlas-proposals -b proposals     (once)
 *   node survey/apply.js ../mass-ai-atlas-proposals [links.json]
 *   cd ../mass-ai-atlas-proposals && node scripts/validate.js
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const target = path.resolve(process.argv[2] || "");
const src = process.argv[3] || path.join(__dirname, "out", "proposed-links.json");
const YML = path.join(target, "data", "entities.yml");

let branch = "";
try { branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: target }).toString().trim(); } catch {}
if (branch !== "proposals" || !fs.existsSync(YML)) {
  console.error(`Give the proposals worktree as the first argument (got ${target}, branch "${branch}").`);
  process.exit(1);
}

const approved = JSON.parse(fs.readFileSync(src, "utf8")).filter(r => r.status === "approved");
const add = new Map();
for (const r of approved) add.set(r.from_id, [...(add.get(r.from_id) || []), r.to_id]);

const lines = fs.readFileSync(YML, "utf8").split("\n");
let changed = 0;
for (const [id, toIds] of add) {
  const start = lines.indexOf(`- id: ${id}`);
  if (start === -1) { console.error(`  ! ${id} is not in entities.yml, skipped`); continue; }
  let end = start + 1;
  while (end < lines.length && lines[end].startsWith("  ")) end++;
  const block = lines.slice(start + 1, end);
  const li = block.findIndex(l => l.startsWith("  links:"));
  if (li !== -1 && !/^  links: \[[^\]]*\]$/.test(block[li])) { console.error(`  ! ${id} has a links line in an unexpected form, skipped`); continue; }
  const have = li === -1 ? [] : block[li].slice("  links: [".length, -1).split(",").map(s => s.trim()).filter(Boolean);
  const next = [...new Set([...have, ...toIds])];
  if (next.length === have.length) continue;
  const line = `  links: [${next.join(", ")}]`;
  if (li !== -1) lines[start + 1 + li] = line;
  else {
    const oi = block.findIndex(l => l.startsWith("  offers:"));
    lines.splice(start + 1 + (oi === -1 ? block.length : oi), 0, line);
  }
  changed++;
}
fs.writeFileSync(YML, lines.join("\n"));
console.log(`${approved.length} approved rows -> links added to ${changed} entries in ${YML}`);
