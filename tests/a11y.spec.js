/* axe-core accessibility gate over the main views (see docs/testing.md).

   The gate, decided from the pristine 2026-09-30 baseline (main @ 76cf38e):
   - any CRITICAL violation fails, always — critical issues are never allowlisted;
   - a SERIOUS violation fails unless it is listed in KNOWN_SERIOUS below, with
     the scan and the elements it is tolerated in, and the reason;
   - moderate and minor findings are attached to the report, not failed on.
   Every page is scanned in both the dark and the light theme (the atlas views since
   2026-11), and the galaxy's keyboard list and search in the dark theme.
   See docs/testing.md. */
const AxeBuilder = require("@axe-core/playwright").default;
const { test, expect, DATA, waitForApp } = require("./helpers/atlas");

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

// Known serious issues the gate tolerates. Each entry is tolerated only
// in the scan it names AND only inside the elements `within` names (CSS
// selectors: a flagged node must be, or sit inside, one of them). There are no
// whole-rule entries: the same rule anywhere else on that page still fails, so a
// new colour-only link can't hide behind an old one. Fix an issue, then delete
// its selector (or the whole entry); the report says "allowlist entry unused"
// for each selector that no longer matches a flagged node.
// Empty since 2026-11-02, when the last of the three baseline entries was fixed.
// An entry looks like this:
//   { scan: "map view", rule: "color-contrast", since: "YYYY-MM-DD",
//     within: ["#someRegion"], why: "what fails, and why it ships anyway" },
const KNOWN_SERIOUS = [];

test("every KNOWN_SERIOUS entry is scoped to named elements", () => {
  // a rule-wide entry would tolerate every future node of that rule on the page
  const unscoped = KNOWN_SERIOUS.filter(k => !Array.isArray(k.within) || !k.within.length);
  expect(unscoped.map(k => `${k.scan}: ${k.rule}`)).toEqual([]);
});

const entry = DATA.find(d => d.id === "csail") || DATA[0];
const closed = DATA.find(d => !d.applyBy && d.applyNote && d.applyUrl) || entry;

const SCANS = [
  { name: "map view", url: "./" },
  { name: "galaxy view", url: "./#galaxy" },
  // the galaxy's keyboard list with a category open, and its search with results showing:
  // the ARIA tree and combobox only exist in full once someone uses them
  { name: "galaxy keyboard list and search", url: "./#galaxy", include: "#view-galaxy",
    prepare: async page => {
      await page.locator("#gxTree [aria-expanded]").first().focus();
      await page.keyboard.press("ArrowRight");
      await page.locator("#gxSearch").fill("ventures");
      await expect(page.locator("#gxResults")).toBeVisible();
    } },
  { name: "journey view", url: "./#journey" },
  // a pathway with open and closed programs, which the first stage's pathways don't have
  { name: "founder pathway", url: "./?pathway=fund-equity-free#journey", include: "#view-journey",
    prepare: page => expect(page.locator(".pw-status.closed").first()).toBeVisible() },
  { name: "founder pathway (light theme)", url: "./?pathway=fund-equity-free#journey", include: "#view-journey",
    theme: "light", prepare: page => expect(page.locator(".pw-status.closed").first()).toBeVisible() },
  { name: "directory view", url: "./#directory" },
  { name: "entry drawer", url: `./?entry=${entry.id}`, include: "#drawer" },
  { name: "shared shortlist", url: `./?list=${DATA[0].id},${DATA[1].id}`, include: "#shortlistModal" },
  // The atlas in the light theme, scanned since 2026-11. Until then it failed 21 to 34 times per
  // view: category colours as text on white, the site footer's grey on its dark band, and footer
  // links told apart by colour alone.
  { name: "map view (light theme)", url: "./", theme: "light" },
  { name: "galaxy view (light theme)", url: "./#galaxy", theme: "light" },
  { name: "journey view (light theme)", url: "./#journey", theme: "light" },
  { name: "directory view (light theme)", url: "./#directory", theme: "light" },
  { name: "entry drawer (light theme)", url: `./?entry=${entry.id}`, include: "#drawer", theme: "light" },
  // the "Applications closed" line and its link, which only a closed program has
  { name: "closed program's drawer", url: `./?entry=${closed.id}`, include: "#drawer" },
  { name: "closed program's drawer (light theme)", url: `./?entry=${closed.id}`, include: "#drawer", theme: "light" },
  { name: "shared shortlist (light theme)", url: `./?list=${DATA[0].id},${DATA[1].id}`, include: "#shortlistModal",
    theme: "light" },
  { name: "first-visit tour", url: "./", firstVisit: true, include: "#tourCard" },
  { name: "first-visit tour (light theme)", url: "./", firstVisit: true, include: "#tourCard",
    theme: "light" },
  { name: "events page", url: "./events/", events: true },
  { name: "events page (light theme)", url: "./events/", events: true,
    theme: "light" },
  { name: "credits page", url: "./credits/", credits: true },
  { name: "credits page (light theme)", url: "./credits/", credits: true,
    theme: "light" },
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
      if(scan.theme === "light"){
        await page.addInitScript(() => {
          try{ localStorage.setItem("toa-atlas-theme", "light"); }catch(e){}
        });
      }
      await page.goto(scan.url);
      if(scan.events){
        await expect(page.locator("#list .ev").first()).toBeVisible();
      } else if(scan.credits){
        // wait for the cards and the timeline, which render from data/credits.yml
        await expect(page.locator("#cards .card").first()).toBeVisible();
        await expect(page.locator("#timeline li").first()).toBeVisible();
      } else {
        await waitForApp(page);
        if(scan.include) await expect(page.locator(scan.include)).toBeVisible({ timeout: 8000 });
        if(scan.prepare) await scan.prepare(page);
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

// The atlas page's landmarks, which screen readers list for jumping around a page. Until 2026-11
// it had two footers and two headers outside any sectioning element and no <main>, so it listed
// two contentinfo and two banner landmarks with nothing to tell them apart, and no main one; its
// two <nav>s had no names either (#58).
// - The views and the atlas's own footer are inside <main>, so the TOA site footer is the one
//   contentinfo.
// - The hero is a section named by the page's title, so the TOA site header is the one banner.
// - Each <nav> has a name.
// axe rates all four rules moderate, and the gate above reports moderate findings without
// failing on them, so this test checks the four on their own.
test("the atlas page has one banner, one main and one footer landmark, each told apart", async ({ page }) => {
  await page.goto("./");
  await waitForApp(page);
  const { violations } = await new AxeBuilder({ page })
    .withRules(["landmark-no-duplicate-contentinfo", "landmark-one-main", "landmark-no-duplicate-banner", "landmark-unique"])
    .analyze();
  expect(violations.map(v => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([]);
});

// The events page had no <main>, so its content sat outside every landmark (until 2026-11). Its
// content is now its <main>, between the site header and the atlas's footer. The page is built
// by scripts/build-events-page.js, so that is where the <main> lives. The test runs on the
// events feed fixture, so the list is there to be scanned.
test("the events page has one banner, one main and one footer landmark, and nothing outside them", async ({ page }) => {
  await page.goto("./events/");
  await expect(page.locator("#list .ev").first()).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .withRules(["landmark-one-main", "region", "landmark-no-duplicate-banner", "landmark-no-duplicate-contentinfo", "landmark-unique"])
    .analyze();
  expect(violations.map(v => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([]);
});
