/* axe-core accessibility gate over the main views (see docs/testing.md).

   The gate, decided from the pristine 2026-09-30 baseline (main @ 76cf38e):
   - any CRITICAL violation fails, always — critical issues are never allowlisted;
   - a SERIOUS violation fails unless it is listed in KNOWN_SERIOUS below, with
     the scan and the elements it is tolerated in, and the reason;
   - moderate and minor findings are attached to the report, not failed on.
   Default (dark) theme only; see docs/testing.md for why light mode is not
   gated yet. */
const AxeBuilder = require("@axe-core/playwright").default;
const { test, expect, DATA, waitForApp } = require("./helpers/atlas");

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

// Known serious issues, measured on the baseline. Each entry is tolerated only
// in the scan it names AND only inside the elements `within` names (CSS
// selectors: a flagged node must be, or sit inside, one of them). There are no
// whole-rule entries: the same rule anywhere else on that page still fails, so a
// new colour-only link can't hide behind an old one. Fix an issue, then delete
// its selector (or the whole entry); the report says "allowlist entry unused"
// for each selector that no longer matches a flagged node.
const KNOWN_SERIOUS = [
  { scan: "events page", rule: "color-contrast", since: "2026-09-30",
    within: ["#genLine", "#add + p"],
    why: "The events page's grey meta text is below 4.5:1 on the dark background (color var(--faint)): the 'refreshed …' line (#genLine) and the sources/credits paragraph under 'Get your event on this list', including its links. Fix in scripts/build-events-page.js." },
  { scan: "events page", rule: "link-in-text-block", since: "2026-09-30",
    within: ["#add p", ".footer-inner", "#list .atlas"],
    why: "Links told apart from the surrounding text by colour alone (no underline), in three places: the 'Get your event on this list' paragraph, the footer ('The Open Accelerator', 'Suggest an entry', 'GitHub'), and each event's '→ on the atlas' link. Fix in scripts/build-events-page.js." },
  { scan: "first-visit tour", rule: "color-contrast", since: "2026-09-30",
    within: ["#tourStep"],
    why: "The tour card's '1 / 5' step counter (.tour-step) is below 4.5:1. Only this node is tolerated." },
];

test("every KNOWN_SERIOUS entry is scoped to named elements", () => {
  // a rule-wide entry would tolerate every future node of that rule on the page
  const unscoped = KNOWN_SERIOUS.filter(k => !Array.isArray(k.within) || !k.within.length);
  expect(unscoped.map(k => `${k.scan}: ${k.rule}`)).toEqual([]);
});

const entry = DATA.find(d => d.id === "csail") || DATA[0];

const SCANS = [
  { name: "map view", url: "./" },
  { name: "galaxy view", url: "./#galaxy" },
  { name: "journey view", url: "./#journey" },
  { name: "directory view", url: "./#directory" },
  { name: "entry drawer", url: `./?entry=${entry.id}`, include: "#drawer" },
  { name: "shared shortlist", url: `./?list=${DATA[0].id},${DATA[1].id}`, include: "#shortlistModal" },
  { name: "first-visit tour", url: "./", firstVisit: true, include: "#tourCard" },
  { name: "events page", url: "./events/", events: true },
];

// For each flagged node, the `within` selector it falls under, or null. axe's
// node.target is a selector unique in the document (an array only for frames
// and shadow DOM, which this page has none of — those count as unmatched).
function withinWhich(page, nodes, within){
  return page.evaluate(({ sels, within }) => sels.map(sel => {
    let el = null;
    try{ el = sel && document.querySelector(sel); }catch(e){}
    return (el && within.find(w => el.closest(w))) || null;
  }), { sels: nodes.map(n => n.target.length === 1 ? n.target[0] : null), within });
}

function describeViolation(v){
  const nodes = v.nodes.slice(0, 5).map(n => "      " + n.target.join(" ")).join("\n");
  return `  [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? "" : "s"})\n${nodes}\n      ${v.helpUrl}`;
}

for(const scan of SCANS){
  test.describe(() => {
    if(scan.firstVisit) test.use({ firstVisit: true });

    test(`axe: ${scan.name}`, async ({ page }, testInfo) => {
      await page.goto(scan.url);
      if(scan.events){
        await expect(page.locator("#list .ev").first()).toBeVisible();
      } else {
        await waitForApp(page);
        if(scan.include) await expect(page.locator(scan.include)).toBeVisible({ timeout: 8000 });
      }
      await page.waitForTimeout(300);   // let open/close transitions settle

      let builder = new AxeBuilder({ page }).withTags(TAGS);
      if(scan.include) builder = builder.include(scan.include);
      const { violations } = await builder.analyze();

      const failing = [], tolerated = [];
      const usedWithin = new Set();   // "<rule> <selector>" pairs that matched a node
      for(const v of violations){
        if(v.impact === "critical"){ failing.push(v); continue; }
        if(v.impact !== "serious"){
          testInfo.annotations.push({ type: `axe ${v.impact} (not gated)`, description: `${v.id}: ${v.help} — ${v.nodes.length} node(s)` });
          continue;
        }
        const known = KNOWN_SERIOUS.find(k => k.scan === scan.name && k.rule === v.id);
        const hits = known ? await withinWhich(page, v.nodes, known.within) : v.nodes.map(() => null);
        hits.forEach(h => { if(h) usedWithin.add(`${v.id} ${h}`); });
        const unexpected = v.nodes.filter((n, i) => !hits[i]);
        if(unexpected.length) failing.push({ ...v, nodes: unexpected });
        if(unexpected.length < v.nodes.length) tolerated.push({ ...v, nodes: v.nodes.filter((n, i) => hits[i]) });
      }
      for(const v of tolerated){
        testInfo.annotations.push({ type: "axe serious (allowlisted)", description: `${v.id} — ${v.nodes.length} node(s): ${v.nodes.map(n => n.target.join(" ")).join(", ")}` });
      }
      for(const k of KNOWN_SERIOUS.filter(k => k.scan === scan.name)){
        for(const sel of k.within.filter(sel => !usedWithin.has(`${k.rule} ${sel}`))){
          testInfo.annotations.push({ type: "allowlist entry unused", description: `${k.rule} no longer occurs within "${sel}" in "${scan.name}" — remove that selector (or the whole entry) from KNOWN_SERIOUS` });
        }
      }

      expect(failing.length, `accessibility violations in ${scan.name}:\n${failing.map(describeViolation).join("\n")}`).toBe(0);
    });
  });
}
