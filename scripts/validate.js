#!/usr/bin/env node
/* Validates data/*.yml — run locally before opening a PR:  node scripts/validate.js
   Per-field rules (types, formats, lengths, allowed values, no HTML) live in
   data/*.schema.yml. This script runs those schemas, then the checks a schema
   can't express: uniqueness, references across files, links between entries,
   dates relative to today, and warnings. */
const { checkData } = require("./load-data");

let checked;
try { checked = checkData(); }
catch (e) {   // YAML syntax error — js-yaml's message names the file, line and column
  console.log(`FAILED: ${e.message}`);
  process.exit(1);
}
const { atlas, errors: schemaErrors } = checked;
const { CATS, STAGES, DATA } = atlas;

console.log(`Mass AI Atlas — validating ${DATA.length} entries, ${Object.keys(CATS).length} categories\n`);
if (schemaErrors.length) {
  console.log("Schema errors:\n" + schemaErrors.join("\n"));
  console.log(`\nFAILED: ${schemaErrors.length} schema error(s). Fix these first — the remaining checks run once the schema passes.`);
  process.exit(1);
}

const errors = [];
const warn = [];
const err = (id, msg) => errors.push(`  ✗ [${id}] ${msg}`);

const ids = new Set();
const names = new Set();
const TODAY = new Date().toISOString().slice(0, 10);
// canonical tag vocabulary — unknown tags only WARN (contributors may propose new
// ones; a maintainer either maps them to an existing tag or adds them here)
const TAGS = new Set(["pre-seed","seed","multi-stage","equity-free","strategic","venture studio",
  "incubator","research","applied AI","AI-native","generative AI","edge AI","ML","infrastructure",
  "open source","AI safety","deep tech","robotics","security","policy","defense","enterprise",
  "consumer","healthcare","biotech","fintech","education","climate","industrial","students",
  "founders","diverse founders","MIT spinout","co-living","coworking","lab space","events",
  "hackathons","MIT","Harvard","Tufts","Babson","Northeastern","BU","BC"]);
const THIS_MONTH = new Date().toISOString().slice(0, 7);   // current UTC month
const validStages = new Set(STAGES.map(s => s.n));

for (const d of DATA) {
  const id = d.id;
  if (ids.has(d.id)) err(id, "duplicate id");
  ids.add(d.id);
  const key = d.name.toLowerCase();
  if (names.has(key)) err(id, `duplicate name "${d.name}"`);
  names.add(key);
  if (!Object.hasOwn(CATS, d.cat)) err(id, `unknown category "${d.cat}" (valid: ${Object.keys(CATS).join(", ")})`);
  for (const t of d.tags || [])
    if (!TAGS.has(t))
      warn.push(`  ⚠ [${id}] tag ${JSON.stringify(t)} is not in the canonical vocabulary (see scripts/validate.js)`);
  // loc is "street, city" — the state is implied by the atlas and never written out.
  // Warn only: the suggestion bot builds loc from free text, so a contributor
  // typing "Cambridge, MA" should get a nudge, not a red build.
  if (/,\s*(MA|Mass|Massachusetts)\.?$/i.test(d.loc))
    warn.push(`  ⚠ [${id}] loc ends in ", MA" — the atlas writes "street, city" and leaves the state implied`);
  if (!d.why) warn.push(`  ⚠ [${id}] missing "why it matters" — strongly encouraged`);
  if (!d.tags || d.tags.length < 1) warn.push(`  ⚠ [${id}] no tags`);
  for (const s of d.stages || [])
    if (!validStages.has(s)) err(id, `invalid stage ${s} (valid: ${[...validStages].join(", ")})`);
  if (d.applyBy !== undefined && d.applyBy !== "rolling" && d.applyBy < TODAY)
    warn.push(`  ⚠ [${id}] applyBy ${d.applyBy} has passed — set the next deadline or remove it`);
  if (d.applyUrl && !d.applyBy && !d.applyNote)
    warn.push(`  ⚠ [${id}] applyUrl never shows without applyBy or applyNote — add one or remove it`);
  if (d.added === undefined)
    warn.push(`  ⚠ [${id}] missing added — the month the entry joined the atlas ("YYYY-MM")`);
  else if (d.added > THIS_MONTH)
    err(id, `added ${d.added} is in the future`);
  if (d.lastVerified === undefined)
    warn.push(`  ⚠ [${id}] missing lastVerified — add the month this entry was last confirmed ("YYYY-MM")`);
  else if (d.lastVerified > THIS_MONTH)
    err(id, `lastVerified ${d.lastVerified} is in the future`);
  else if (d.lastVerified < "2020-01")
    err(id, `lastVerified ${d.lastVerified} looks like a typo (before 2020)`);
}
// resolve links after all ids known
for (const d of DATA)
  for (const l of d.links || [])
    if (!ids.has(l)) err(d.id, `links to unknown entry "${l}"`);

// data/credits.yml feeds the credits page (credits/index.html), not the atlas, so
// atlas-data.js never loads it. Check it here: its schema, then one entry per
// person and no date in the future. CORE_SCHEMA keeps dates as strings, as the
// atlas loader does.
{
  const fs = require("fs"), path = require("path"), yaml = require("js-yaml"), Ajv = require("ajv");
  const { DATA_DIR } = require("./load-data");
  const cerr = msg => errors.push(`  ✗ [credits.yml] ${msg}`);
  try {
    const read = f => yaml.load(fs.readFileSync(path.join(DATA_DIR, f), "utf8"), { schema: yaml.CORE_SCHEMA, filename: f });
    const schema = read("credits.schema.yml"), credits = read("credits.yml");
    const ajv = new Ajv({ allErrors: true });
    if (!ajv.validate(schema, credits)) {
      for (const e of ajv.errors) cerr(`${e.instancePath || "/"} ${e.message}`);
    } else {
      const seen = new Set();
      for (const m of credits.mapmakers) {
        if (seen.has(m.github.toLowerCase())) cerr(`${m.github} is listed more than once`);
        seen.add(m.github.toLowerCase());
        if (m.since > TODAY) cerr(`${m.github}: since ${m.since} is in the future`);
      }
      for (const ms of credits.milestones)
        if (ms.date > TODAY) cerr(`milestone "${ms.title}" is dated ${ms.date}, in the future`);
    }
  } catch (e) { cerr(e.message); }   // a YAML syntax error names the line and column
}

// data/pathways.yml feeds the Founder Journey. The page reads it on its own and works
// without it, so atlas-data.js never loads it, and it is checked here the way credits.yml
// is: its schema, then what a schema can't see, which is every reference to another file.
// An unknown entry stops the build, so removing an entry can't quietly hollow out a pathway.
{
  const fs = require("fs"), path = require("path"), yaml = require("js-yaml"), Ajv = require("ajv");
  const { DATA_DIR } = require("./load-data");
  const perr = msg => errors.push(`  ✗ [pathways.yml] ${msg}`);
  try {
    const read = f => yaml.load(fs.readFileSync(path.join(DATA_DIR, f), "utf8"), { schema: yaml.CORE_SCHEMA, filename: f });
    const schema = read("pathways.schema.yml"), pathways = read("pathways.yml");
    const offers = new Set(read("entities.schema.yml").items.properties.offers.items.enum);
    const ajv = new Ajv({ allErrors: true });
    if (!ajv.validate(schema, pathways)) {
      for (const e of ajv.errors) perr(`${e.instancePath || "/"} ${e.message}`);
    } else {
      const seen = new Set(), byId = new Map(DATA.map(d => [d.id, d]));
      for (const p of pathways) {
        if (seen.has(p.id)) perr(`duplicate id "${p.id}"`);
        seen.add(p.id);
        if (!validStages.has(p.stage)) perr(`${p.id}: invalid stage ${p.stage} (valid: ${[...validStages].join(", ")})`);
        const used = new Set();
        p.steps.forEach((s, i) => {
          const at = `${p.id}, step ${i + 1}`;
          for (const id of s.entries || []) {
            const d = byId.get(id);
            if (!d) { perr(`${at}: unknown entry "${id}"`); continue; }
            if (used.has(id)) perr(`${at}: "${id}" is already in an earlier step`);
            used.add(id);
            if (!(d.stages || []).includes(p.stage))
              warn.push(`  ⚠ [pathways.yml] ${at}: "${id}" isn't listed at stage ${p.stage}, so its entry and this pathway disagree`);
          }
          if (s.more && s.more.cat && !Object.hasOwn(CATS, s.more.cat)) perr(`${at}: unknown category "${s.more.cat}"`);
          if (s.more && s.more.need && !offers.has(s.more.need)) perr(`${at}: unknown need "${s.more.need}"`);
        });
      }
    }
  } catch (e) { perr(e.message); }   // a YAML syntax error names the line and column
}

if (warn.length) console.log("Warnings:\n" + warn.join("\n") + "\n");
if (errors.length) {
  console.log("Errors:\n" + errors.join("\n"));
  console.log(`\nFAILED: ${errors.length} error(s).`);
  process.exit(1);
}
console.log("PASSED: data/ is valid.");
