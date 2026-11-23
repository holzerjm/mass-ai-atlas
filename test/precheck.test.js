/* scripts/precheck.js, the machine half of a reviewer's checklist, and what it stands on:
   scripts/geo.js's street matching and scripts/probe.js's classifications.
   Fast and offline: no network, and nothing here depends on what data/ holds.

     node --test test/precheck.test.js

   The checks take their network from the caller, so these hand them a fake one. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const p = require("../scripts/precheck");
const geo = require("../scripts/geo");

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "precheck.js");
const entry = (over = {}) => ({ id: "acme-ai", name: "Acme AI Labs", cat: "startup", loc: "1 Main St, Cambridge", town: "Cambridge", lat: 42.36, lng: -71.08,
  url: "https://acme.example", desc: "d", offers: ["talent"], added: "2026-11", lastVerified: "2026-11", ...over });
const changed = (over = {}, old = null, fields = null) => {
  const d = entry(over);
  return { id: d.id, d, old, isNew: !old, fields: fields || Object.keys(d) };
};
const deps = (over = {}) => ({ online: true, now: "2026-11-23", probe: async () => ({ cls: "ok" }),
  geo: { addressPoint: async () => ({ matched: "1 MAIN ST, CAMBRIDGE, MA, 02142", lat: 42.36, lng: -71.08 }), townAt: async () => "Cambridge", meters: geo.meters }, ...over });
const statuses = checks => checks.map(c => `${c.check}:${c.status}`);
const texts = checks => checks.map(c => c.text).join(" | ");

// ---------- what changed ----------
test("a pull request's changed entries: new ones, and the fields that differ", () => {
  const base = [entry(), entry({ id: "b", name: "B" }), entry({ id: "gone", name: "Gone" })];
  const head = [entry(), entry({ id: "b", name: "B", town: "Boston", tags: ["x"] }), entry({ id: "new", name: "New" })];
  const c = p.changedEntries(base, head);
  assert.deepEqual(c.map(x => [x.id, x.isNew]), [["b", false], ["new", true]]);
  assert.deepEqual(c[0].fields.sort(), ["tags", "town"]);
});

// ---------- the website ----------
test("a website that answers is ok, and the application page is checked with it", async () => {
  const seen = [];
  const r = await p.checkWebsite(changed({ applyUrl: "https://acme.example/apply" }), deps({ probe: async u => { seen.push(u); return { cls: "ok" }; } }));
  assert.deepEqual(statuses(r), ["website:ok", "website:ok"]);
  assert.deepEqual(seen, ["https://acme.example", "https://acme.example/apply"]);
});
test("a moved or broken website is a warning, a blocked one a note, and a flaky one is tried twice", async () => {
  const at = async (cls, note = "") => (await p.checkWebsite(changed(), deps({ probe: async () => ({ cls, note }) })))[0];
  assert.equal((await at("moved", "now at https://other.example/")).status, "warn");
  assert.equal((await at("broken", "HTTP 404")).status, "warn");
  assert.equal((await at("blocked", "HTTP 403")).status, "note");
  let n = 0;
  const r = await p.checkWebsite(changed(), deps({ probe: async () => (++n === 1 ? { cls: "error", note: "timeout" } : { cls: "ok" }) }));
  assert.equal(n, 2); assert.equal(r[0].status, "ok");
  assert.equal((await at("error", "timeout")).status, "note", "a network that doesn't answer is never a warning");
});
test("an address that isn't a plain public https page is a warning, and is never fetched", async () => {
  for (const url of ["http://acme.example", "https://localhost/x", "https://10.0.0.4/", "https://169.254.169.254/latest/meta-data/", "https://192.168.1.1/", "https://172.16.0.1/", "https://[::1]/", "https://intranet.local/", "https://metadata.internal/", "file:///etc/passwd", "https://singleword/"]) {
    let fetched = false;
    const r = await p.checkWebsite(changed({ url }), deps({ probe: async () => { fetched = true; return { cls: "ok" }; } }));
    assert.equal(r[0].status, "warn", url); assert.equal(fetched, false, url);
  }
  assert.equal(p.publicUrl("https://www.acme.ai/apply?x=1"), true);
});
test("an entry whose link and check date didn't change is not probed", async () => {
  let n = 0;
  const r = await p.checkWebsite(changed({}, entry({ tags: ["a"] }), ["tags"]), deps({ probe: async () => { n++; return { cls: "ok" }; } }));
  assert.deepEqual(r, []); assert.equal(n, 0);
});

// ---------- the pin and the town ----------
test("the street part of an address, wherever it sits in loc", () => {
  assert.equal(p.streetOf("1 Broadway & 245 Main St, Kendall Sq"), "1 Broadway");
  assert.equal(p.streetOf("CIC, 1 Broadway, Cambridge"), "1 Broadway");
  assert.equal(p.streetOf("Stata Center, 32 Vassar St, Cambridge"), "32 Vassar St");
  assert.equal(p.streetOf("45 Woodlawn Ave, Pittsfield"), "45 Woodlawn Ave");
  assert.equal(p.streetOf("Kendall Sq"), null);
  assert.equal(p.streetOf("Boston area"), null);
});
test("a pin near its address is ok, and one far from it is a warning", async () => {
  const near = await p.checkPin(changed(), deps());
  assert.deepEqual(statuses(near), ["pin:ok"]);
  const far = await p.checkPin(changed({ lat: 42.37 }), deps());
  assert.equal(far[0].status, "warn"); assert.match(far[0].text, /pin is 111\d m/);
});
test("an approximate pin, an address without a number, and an address the Bureau doesn't have are notes", async () => {
  assert.deepEqual(statuses(await p.checkPin(changed({ approx: true, loc: "Boston" }), deps())), ["pin:note"]);
  assert.deepEqual(statuses(await p.checkPin(changed({ loc: "Kendall Sq" }), deps())), ["pin:note"]);
  const none = await p.checkPin(changed(), deps({ geo: { ...deps().geo, addressPoint: async () => null } }));
  assert.equal(none[0].status, "note"); assert.match(none[0].text, /found no match/);
});
test("a lookup that fails is a note, for the pin and the town alike", async () => {
  const broken = { addressPoint: async () => { throw new Error("HTTP 502"); }, townAt: async () => { throw new Error("HTTP 502"); }, meters: geo.meters };
  assert.deepEqual(statuses(await p.checkPin(changed(), deps({ geo: broken }))), ["pin:note"]);
  assert.deepEqual(statuses(await p.checkTown(changed(), deps({ geo: broken }))), ["town:note"]);
});
test("a pin outside the town it names is a warning", async () => {
  assert.deepEqual(statuses(await p.checkTown(changed(), deps())), ["town:ok"]);
  const r = await p.checkTown(changed({ town: "Boston" }), deps());
  assert.equal(r[0].status, "warn"); assert.match(r[0].text, /in Cambridge, but town says Boston/);
  assert.deepEqual(await p.checkTown(changed({}, entry({ desc: "x" }), ["desc"]), deps()), [], "town isn't looked up when the pin didn't change");
});
test("the Bureau's Amherst Town is the atlas's Amherst, and one Broadway is not another", () => {
  assert.equal(geo.townName("Amherst Town"), "Amherst");
  assert.equal(geo.townName("Cambridge"), "Cambridge");
  assert.equal(geo.townName(null), null);
  // On 2026-11-23 the Bureau answered "1 Broadway, Cambridge" with 1 Broadway Ct, two kilometers away
  assert.notEqual(geo.streetKey("1 Broadway"), geo.streetKey("1 BROADWAY CT"));
  assert.equal(geo.streetKey("131 Dartmouth Street"), geo.streetKey("131 DARTMOUTH ST"));
});

// ---------- duplicates and dates ----------
test("the same website or the same name is a warning, the same host and a similar name are notes", () => {
  const other = entry({ id: "acme", name: "Acme Robotics", url: "https://www.acme.example/" });
  const dup = p.checkDuplicate(changed({ id: "new" }), [other, entry({ id: "new" })]);
  assert.equal(dup[0].status, "warn"); assert.match(dup[0].text, /same website as Acme Robotics/);
  const name = p.checkDuplicate(changed({ id: "new", url: "https://else.example", name: "The Acme Robotics, Inc." }), [other, entry({ id: "new" })]);
  assert.ok(name.some(x => x.status === "warn" && /same name as/.test(x.text)));
  const host = p.checkDuplicate(changed({ id: "new", name: "Zeta Lab", url: "https://acme.example/labs/zeta" }), [entry({ id: "acme", name: "Acme Robotics", url: "https://acme.example/robotics" })]);
  assert.deepEqual(host.map(x => x.status), ["note"]); assert.match(host[0].text, /same site as/);
  const near = p.checkDuplicate(changed({ id: "new", name: "Acme Robotics Boston", url: "https://x.example" }), [other]);
  assert.ok(near.some(x => x.status === "note" && /similar name/.test(x.text)));
  assert.deepEqual(statuses(p.checkDuplicate(changed({ id: "new", name: "Zzz Qqq", url: "https://zzz.example" }), [other])), ["duplicate:ok"]);
  assert.deepEqual(p.checkDuplicate(changed({}, entry({ desc: "x" }), ["desc"]), [other]), [], "a name and url that didn't change aren't checked");
});
test("the date: this month or last is current, older and future are warnings, and a new entry needs both dates", () => {
  const on = (over, now = "2026-11-23") => p.checkDate(changed({ ...over }), now);
  assert.deepEqual(statuses(on({})), ["date:ok"]);
  assert.deepEqual(statuses(on({ lastVerified: "2026-10" })), ["date:ok"]);
  assert.deepEqual(statuses(on({ lastVerified: "2026-09" })), ["date:warn"]);
  assert.deepEqual(statuses(on({ lastVerified: "2026-12" })), ["date:warn"]);
  assert.deepEqual(statuses(on({}, "2026-12-01")), ["date:warn", "date:ok"], "added is last month's, and lastVerified last month's is still current");
  assert.deepEqual(statuses(on({ added: "2026-08" })), ["date:warn", "date:ok"]);
  assert.deepEqual(statuses(on({ lastVerified: undefined })), ["date:warn"]);
  const untouched = { ...changed({ lastVerified: "2026-06" }, entry({ lastVerified: "2026-06" }), ["desc"]) };
  assert.deepEqual(p.checkDate(untouched, "2026-11-23"), [], "an old date the pull request didn't touch is the rota's business, not this one's");
});

// ---------- the whole run ----------
test("every check that applies runs, and a change to a tag alone has nothing for a machine", async () => {
  const r = await p.precheck([changed(), { ...changed({}, entry(), ["tags"]) }], [entry()], deps());
  assert.deepEqual(r[0].checks.map(x => x.check), ["website", "pin", "town", "duplicate", "date"]);
  assert.deepEqual(r[1].checks, []);
});
test("offline, and above the limit, the network checks are notes and the others still run", async () => {
  const off = await p.precheck([changed()], [entry()], deps({ online: false, probe: async () => { throw new Error("no network allowed"); } }));
  assert.equal(off[0].checks[0].status, "note"); assert.match(off[0].checks[0].text, /offline/);
  assert.deepEqual(off[0].checks.slice(1).map(x => x.check), ["duplicate", "date"]);
  const many = Array.from({ length: p.MAX_NETWORK + 1 }, (_, i) => ({ ...changed({ id: `e${i}`, name: `Entry ${i}`, url: `https://e${i}.example` }), id: `e${i}` }));
  let probes = 0;
  const big = await p.precheck(many, many.map(c => c.d), deps({ probe: async () => { probes++; return { cls: "ok" }; } }));
  assert.equal(probes, 0); assert.match(big[0].checks[0].text, new RegExp(`${p.MAX_NETWORK + 1} entries changed, more than ${p.MAX_NETWORK}`));
});

// ---------- the report ----------
test("the report counts warnings, and says what is left for a person", async () => {
  const r = await p.precheck([changed({ town: "Boston" })], [entry()], deps());
  const rep = p.report(r);
  assert.equal(rep.warnings, 1);
  assert.match(rep.markdown, /1 entry changed, 1 warning/);
  assert.match(rep.markdown, /Left for you:\*\* a real, active Massachusetts organization/);
  assert.ok(rep.markdown.indexOf("⚠️ town") < rep.markdown.indexOf("✅ website"), "what needs a look comes first");
});
test("a pull request's words can't break out of the table or the log", async () => {
  const bad = "Evil | <img src=x> [link](https://x) `code`\n::error::gotcha";
  const r = [{ id: "evil", name: bad, isNew: true, fields: ["name"], checks: [{ check: "town", status: "warn", text: bad + " 100%" }] }];
  const rep = p.report(r);
  const row = rep.markdown.split("\n").find(l => l.startsWith("| `evil`"));
  assert.equal(row.split("|").length - 1, 5 - 1, "a pipe in a name adds no column");
  assert.ok(!/<img/.test(row), "no raw HTML"); assert.ok(!/[^\\]\[link\]/.test(row));
  const a = p.annotations(r, () => 7)[0];
  assert.match(a, /^::warning file=data\/entities\.yml,line=7,title=Pre-check%3A evil::/);
  assert.ok(!/[\r\n]/.test(a) && a.includes("%0A") && a.includes("100%25"), "a line break can't start another log command");
  assert.equal(p.annotations(r.map(x => ({ ...x, checks: [{ check: "town", status: "note", text: "n" }] })), () => 1).length, 0, "only warnings are annotated");
});

// ---------- the script itself ----------
test("run on a repository, it reports what changed and always exits 0", () => {
  const D = fs.mkdtempSync(path.join(os.tmpdir(), "precheck-"));
  test.after(() => fs.rmSync(D, { recursive: true, force: true }));
  // a copy of the checkout, with a commit for the base and another for the change
  execFileSync("git", ["-C", ROOT, "archive", "--format=tar", "HEAD"], { maxBuffer: 1 << 28, stdio: ["ignore", fs.openSync(path.join(D, "t.tar"), "w"), "ignore"] });
  execFileSync("tar", ["-xf", "t.tar"], { cwd: D }); fs.rmSync(path.join(D, "t.tar"));
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(D, "node_modules"));
  for (const f of ["scripts/precheck.js", "scripts/geo.js", "scripts/probe.js"]) fs.copyFileSync(path.join(ROOT, f), path.join(D, f));
  const git = (...a) => execFileSync("git", ["-C", D, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { stdio: "ignore" });
  git("init", "-q"); git("add", "-A"); git("commit", "-qm", "base");
  const f = path.join(D, "data", "entities.yml"), text = fs.readFileSync(f, "utf8");
  const anEntry = text.match(/^- id: (\S+)$/m)[1];
  fs.writeFileSync(f, text.replace(/^(  desc: )(.*)$/m, "$1$2 More."));
  const summary = path.join(D, "summary.md");
  const run = (...a) => spawnSync("node", ["scripts/precheck.js", "--offline", "--base", "HEAD", ...a], { cwd: D, encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: summary } });
  const r = run();
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Pre-check \(advice only\): 1 entry changed/); assert.match(r.stdout, new RegExp(anEntry));
  assert.match(fs.readFileSync(summary, "utf8"), /## Pre-check, for the reviewer/);
  fs.writeFileSync(f, text);                         // nothing changed
  assert.match(run().stdout, /no entries changed/);
  const none = spawnSync("node", ["scripts/precheck.js", "--offline", "--base", "no-such-ref"], { cwd: D, encoding: "utf8" });
  assert.equal(none.status, 0); assert.match(none.stdout, /skipped/);
  fs.writeFileSync(f, text.replace(/^(  desc: )(.*)$/m, "$1\"unclosed"));   // data that doesn't parse
  const broken = run();
  assert.equal(broken.status, 0); assert.match(broken.stdout, /could not run/);
});
