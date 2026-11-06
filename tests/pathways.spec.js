/* The Founder Journey's pathways, from data/pathways.yml. These tests read the same file, so
   changing a pathway never means changing a test. See docs/testing.md. */
const { test, expect, ROOT, ATLAS, DATA, byId, waitForApp } = require("./helpers/atlas");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const PATHS = yaml.load(fs.readFileSync(path.join(ROOT, "data", "pathways.yml"), "utf8"),
  { schema: yaml.CORE_SCHEMA }) || [];
const stageOf = p => PATHS.filter(x => x.stage === p.stage);
const step = (page, n) => page.locator(`#stepper .step[data-n="${n}"]`);
const pick = (page, id) => page.locator(`.pw-pick[data-pathway="${id}"]`);
async function openJourney(page, url = "./#journey"){
  await page.goto(url);
  await waitForApp(page);
  await expect(page.locator(".pw-pick").first()).toBeVisible();
}
// A pathway the test writes itself, drawn the way the page draws one from the file.
const drawPathway = (page, steps) => page.evaluate(steps => {
  PATHWAYS = [{ id: "test", stage: 1, title: "A test", lead: "The order.", steps }];
  jrStage = 1; jrPathway = ""; renderStepper(); renderJourney();
}, steps);

test.describe("pathways", () => {
  test.skip(!PATHS.length, "this copy of the atlas has no pathways");

  test("every pathway shows its steps in order, with each organization's own reason", async ({ page }) => {
    await openJourney(page);
    for(const s of ATLAS.STAGES){
      const here = PATHS.filter(p => p.stage === s.n);
      await step(page, s.n).click();
      await expect(page.locator(".pw-pick")).toHaveCount(here.length);
      if(!here.length) continue;
      await expect(page.locator(".pw-pick").first()).toHaveAttribute("aria-pressed", "true");
      for(const p of here){
        await pick(page, p.id).click();
        await expect(page.locator(".pw-lead")).toHaveText(p.lead);
        await expect(page.locator(".pw-step h5")).toHaveText(p.steps.map(x => x.do));
        await expect(page.locator(".pw-why")).toHaveText(p.steps.map(x => x.why));
        const ids = p.steps.flatMap(x => x.entries || []);
        await expect(page.locator(".pw-org")).toHaveCount(ids.length);
        expect((await page.locator(".pw-org p").allTextContents()).sort())
          .toEqual(ids.map(id => byId[id].why || byId[id].desc).sort());
        await expect(page.locator(".pw-more")).toHaveCount(p.steps.filter(x => x.more).length);
      }
    }
  });

  // The order inside a step is never a judgment. Real entries get known statuses here, so a
  // deadline passing can't change this test.
  test("a step lists its organizations by closing date, then by name", async ({ page }) => {
    await openJourney(page);
    const [a, b, c, d, e] = [...DATA].sort((x, y) => x.name.localeCompare(y.name)).map(x => x.id);
    await page.evaluate(([a, b, c, d, e]) => {
      for(const id of [a, b, c, d, e]){ delete byId[id].applyBy; delete byId[id].applyNote; }
      byId[e].applyBy = "2099-01-01"; byId[d].applyBy = "2099-06-01"; byId[c].applyBy = "rolling";
    }, [a, b, c, d, e]);
    await drawPathway(page, [{ do: "A step", why: "Why", entries: [a, b, c, d, e] }]);
    await expect(page.locator(".pw-name")).toHaveText([e, d, c, a, b].map(id => byId[id].name));
    await expect(page.locator(".pw-org").nth(0).locator(".pw-status")).toContainText("Apply by January 1, 2099");
    await expect(page.locator(".pw-org").nth(2).locator(".pw-status")).toContainText("Open");
  });

  test("a closed program says so in a step, with its note", async ({ page }) => {
    await openJourney(page);
    const id = DATA[0].id;
    await page.evaluate(id => { delete byId[id].applyBy; byId[id].applyNote = "Next round in spring"; }, id);
    await drawPathway(page, [{ do: "A step", why: "Why", entries: [id] }]);
    await expect(page.locator(".pw-status.closed")).toHaveText("⏸ Closed · Next round in spring");
  });

  test("a funder that takes pitches says so in a step", async ({ page }) => {
    await openJourney(page);
    const id = DATA.find(d => d.cat === "vc").id;
    await page.evaluate(id => {
      delete byId[id].applyBy; delete byId[id].applyNote;
      byId[id].applyUrl = "https://example.org/pitch";
    }, id);
    await drawPathway(page, [{ do: "A step", why: "Why", entries: [id] }]);
    await expect(page.locator(".pw-status.pitch")).toHaveText("📨 Takes pitches");
  });

  test("a chosen pathway goes into the link, and the link brings it back", async ({ page }) => {
    const p = PATHS.find(x => stageOf(x)[0] !== x);
    test.skip(!p, "no stage has a second pathway to choose");
    const other = ATLAS.STAGES.find(s => s.n !== p.stage);
    await openJourney(page);
    await step(page, p.stage).click();
    await pick(page, p.id).click();
    await expect(page).toHaveURL(new RegExp(`[?&]pathway=${p.id}(&|#)`));
    await page.reload();
    await waitForApp(page);
    await expect(pick(page, p.id)).toHaveAttribute("aria-pressed", "true");
    await expect(step(page, p.stage)).toHaveAttribute("aria-pressed", "true");
    // a new stage starts at its first pathway, so the link lets go of the old one
    await step(page, other.n).click();
    await expect(page).not.toHaveURL(/pathway=/);
    await page.goto(`./?pathway=${p.id}#journey`);
    await expect(pick(page, p.id)).toHaveAttribute("aria-pressed", "true");
    await page.locator('.tab[data-view="directory"]').click();
    await expect(page).not.toHaveURL(/pathway=/);
  });

  test("a link to a pathway that doesn't exist opens the Journey as usual", async ({ page }) => {
    await openJourney(page, "./?pathway=no-such-route#journey");
    await expect(step(page, ATLAS.STAGES[0].n)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".pw-pick").first()).toHaveAttribute("aria-pressed", "true");
  });

  test("a pathway can be chosen by keyboard, and the focus stays on it", async ({ page }) => {
    await openJourney(page);
    const picks = page.locator(".pw-pick");
    test.skip(await picks.count() < 2, "the first stage has one pathway");
    await picks.nth(0).focus();
    await page.keyboard.press("Tab");
    await expect(picks.nth(1)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(picks.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(picks.nth(0)).toHaveAttribute("aria-pressed", "false");
    await expect(picks.nth(1)).toBeFocused();
  });

  test("an organization in a step opens its drawer, and closing it puts the focus back", async ({ page }) => {
    await openJourney(page);
    const name = page.locator(".pw-name").first(), text = (await name.textContent()).trim();
    await name.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#drawer")).toHaveClass(/\bopen\b/);
    await expect(page.locator("#drName")).toHaveText(text);
    await page.keyboard.press("Escape");
    await expect(page.locator("#drawer")).not.toHaveClass(/\bopen\b/);
    await expect(name).toBeFocused();
  });

  test("a step's Directory link lands on as many organizations as it says", async ({ page }) => {
    const p = PATHS.find(x => x.steps.some(s => s.more));
    test.skip(!p, "no step links to the Directory");
    await openJourney(page, `./?pathway=${p.id}#journey`);
    const link = page.locator(".pw-more").first();
    const count = +(await link.textContent()).match(/\d+/)[0];
    await link.click();
    await expect(page).toHaveURL(/#directory$/);
    await waitForApp(page);
    await expect(page.locator("#view-directory .card")).toHaveCount(count);
  });

  // validate.js stops a build on an unknown id. This is the page's own guard, for a copy of
  // the atlas that removed an entry without running it: a name can't reach the page unless
  // it resolves to an entry, and a step left with nothing goes.
  test("an entry that doesn't exist never shows, and a step left empty goes", async ({ page }) => {
    await openJourney(page);
    await drawPathway(page, [
      { do: "Keeps its one real entry", why: "Why", entries: [DATA[0].id, "gone"] },
      { do: "Has nothing left", why: "Why", entries: ["gone-too"] },
      { do: "Links to the Directory", why: "Why", more: { cat: DATA[0].cat } },
    ]);
    await expect(page.locator(".pw-step h5")).toHaveText(["Keeps its one real entry", "Links to the Directory"]);
    await expect(page.locator(".pw-org")).toHaveCount(1);
  });

  test("the whole list still follows the pathways", async ({ page }) => {
    await openJourney(page);
    const s = ATLAS.STAGES[0], n = DATA.filter(d => (d.stages || []).includes(s.n)).length;
    await expect(page.locator(".jr-all")).toHaveText(`All ${n} organizations at this stage`);
    await expect(page.locator("#jrPanel .chip")).toHaveCount(n);
  });
});

// The file adds to the Journey and nothing depends on it. deploy.yml sends the page before
// data/, so a visitor can load a new page a moment before its file arrives.
test.describe("without data/pathways.yml", () => {
  test.use({ expectedHttpErrors: [/\/data\/pathways\.yml/] });

  test("the Journey shows its stages as it always did", async ({ page }) => {
    await page.route("**/data/pathways.yml", route => route.fulfill({ status: 404, body: "" }));
    await page.goto("./#journey");
    await waitForApp(page);
    await expect(page.locator("#jrPanel .jr-tip").first()).toBeVisible();
    await expect(page.locator(".pw")).toHaveCount(0);
    await step(page, ATLAS.STAGES[1].n).click();
    await expect(page.locator("#jrPanel h3")).toContainText(ATLAS.STAGES[1].t);
    await expect(page.locator("#jrPanel .chip").first()).toBeVisible();
  });
});

test.describe("pathways on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the longest pathway fits the screen", async ({ page }) => {
    const size = p => p.steps.reduce((n, s) => n + (s.entries || []).length, 0);
    const p = [...PATHS].sort((a, b) => size(b) - size(a))[0];
    test.skip(!p, "this copy of the atlas has no pathways");
    await openJourney(page, `./?pathway=${p.id}#journey`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
