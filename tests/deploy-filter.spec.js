/* The deploy's path filter (on.push.paths in .github/workflows/deploy.yml) decides whether a merge
   goes live. The deploy builds atlas.json, atlas.csv, atlas-ai.txt, the share pages and the events
   page by running scripts, so a change to one of those changes a deployed file, and the filter has
   to name it. Until 2026-11-23 it didn't name any script: #188 changed scripts/export-ai.js, merged
   green, and deployed nothing, so the change wasn't live. */
const { test, expect } = require("./helpers/atlas");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.join(__dirname, "..");
const wf = yaml.load(fs.readFileSync(path.join(ROOT, ".github", "workflows", "deploy.yml"), "utf8"));
const on = wf.on ?? wf[true];   // YAML 1.1 reads a bare "on" as true
const paths = on.push.paths;

// The scripts the deploy runs to build a file, by name: export-*.js and build-*.js. validate.js and
// lint-copy.js only check; they build nothing, so a change to one doesn't change what is uploaded.
const runs = wf.jobs.deploy.steps.map(s => s.run || "").join("\n");
const built = [...runs.matchAll(/node (scripts\/(?:export|build)-[\w-]+\.js)/g)].map(m => m[1]);

// A script and the local files it requires, and what those require.
function closure(file, seen = new Set()){
  if(seen.has(file)) return seen;
  seen.add(file);
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  for(const m of src.matchAll(/require\(["'](\.\.?\/[^"']+)["']\)/g)){
    let dep = path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, file)), m[1]));
    if(!dep.endsWith(".js")) dep += ".js";
    if(dep.startsWith("scripts/") && fs.existsSync(path.join(ROOT, dep))) closure(dep, seen);
  }
  return seen;
}
const needed = [...new Set(built.flatMap(f => [...closure(f)]))].sort();

test("the deploy's path filter names every script that builds a file it uploads", () => {
  expect(built.length, "the deploy runs no export-* or build-* script, so this test finds nothing").toBeGreaterThanOrEqual(5);
  for(const script of needed) expect(paths, script).toContain(script);
});

test("the filter names no script the deploy doesn't build with", () => {
  expect(paths.filter(p => p.startsWith("scripts/")).sort()).toEqual(needed);
  for(const p of paths) expect(fs.existsSync(path.join(ROOT, p.replace(/\/\*\*$/, ""))), `${p} exists`).toBe(true);
});
