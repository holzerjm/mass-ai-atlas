/* Core invariants founders rely on: the page boots, shared links land where
   they point, and each view actually shows. See docs/testing.md. */
const { test, expect, DATA, ATLAS, waitForApp } = require("./helpers/atlas");

const VIEWS = ["map", "galaxy", "journey", "directory"];
const entry = DATA.find(d => d.id === "csail") || DATA[0];

test.describe("first visit", () => {
  test.use({ firstVisit: true });

  test("the app boots with every entry on the map and no uncaught errors", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    // headline stat is computed from DATA, never hand-typed
    await expect(page.locator("#stats .stat b").first()).toHaveText(String(DATA.length));
    await expect(page.locator("#view-map")).toHaveClass(/\bactive\b/);
    await expect(page.locator("#map .leaflet-marker-icon").first()).toBeVisible();
    // first-time visitors get the guided tour (and the error guard sees its timers run)
    await expect(page.locator("#tourCard")).toBeVisible({ timeout: 8000 });
  });

  test("a shared deep link never starts the first-visit tour", async ({ page }) => {
    // "never over a shared link": the tour would switch views and cover the
    // drawer the sender meant to show
    await page.goto(`./?entry=${entry.id}`);
    await expect(page.locator("#drawer")).toHaveClass(/\bopen\b/);
    await page.waitForTimeout(2500);   // the tour's auto-start delay is 1.4 s
    await expect(page.locator("#tourCard")).toBeHidden();
  });
});

test.describe("?entry= deep links", () => {
  test("?entry=<id> opens that entry's drawer", async ({ page }) => {
    await page.goto(`./?entry=${entry.id}`);
    await expect(page.locator("#drawer")).toHaveClass(/\bopen\b/);
    await expect(page.locator("#drName")).toHaveText(entry.name);
    expect(new URL(page.url()).searchParams.get("entry")).toBe(entry.id);
  });

  test("?entry= combines with #view", async ({ page }) => {
    await page.goto(`./?entry=${entry.id}#directory`);
    await expect(page.locator("#view-directory")).toHaveClass(/\bactive\b/);
    await expect(page.locator("#drawer")).toHaveClass(/\bopen\b/);
    await expect(page.locator("#drName")).toHaveText(entry.name);
  });

  test("an unknown ?entry= id is ignored and the page still works", async ({ page }) => {
    await page.goto("./?entry=no-such-org-" + Date.now());
    await waitForApp(page);
    await expect(page.locator("#drawer")).not.toHaveClass(/\bopen\b/);
    // still fully usable: a real entry opens normally afterwards
    await page.evaluate(id => openDrawer(id), entry.id);
    await expect(page.locator("#drName")).toHaveText(entry.name);
  });
});

test.describe("#view deep links", () => {
  for(const view of VIEWS){
    test(`#${view} shows the ${view} view`, async ({ page }) => {
      await page.goto(`./#${view}`);
      await waitForApp(page);
      await expect(page.locator(`#view-${view}`)).toHaveClass(/\bactive\b/);
      await expect(page.locator(`#view-${view}`)).toBeVisible();
      for(const other of VIEWS.filter(v => v !== view)){
        await expect(page.locator(`#view-${other}`)).toBeHidden();
      }
      await expect(page.locator(`.tab[data-view="${view}"]`)).toHaveClass(/\bactive\b/);
      // and the view has real content, not just an empty active section
      if(view === "map") await expect(page.locator("#map .leaflet-marker-icon").first()).toBeVisible();
      if(view === "galaxy"){
        const box = await page.locator("#galaxy").boundingBox();
        expect(box && box.width > 100 && box.height > 100).toBeTruthy();
      }
      if(view === "journey") await expect(page.locator("#stepper .step")).toHaveCount(ATLAS.STAGES.length);
      if(view === "directory") await expect(page.locator("#cards .card")).toHaveCount(DATA.length);
    });
  }

  test("switching tabs writes the view into the URL hash", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    await page.locator('.tab[data-view="journey"]').click();
    await expect(page).toHaveURL(/#journey$/);
    await page.locator('.tab[data-view="map"]').click();
    await expect(page).not.toHaveURL(/#/);
  });

  test("an unknown #hash falls back to the map", async ({ page }) => {
    await page.goto("./#no-such-view");
    await waitForApp(page);
    await expect(page.locator("#view-map")).toHaveClass(/\bactive\b/);
  });
});

// Contract 2 (Part A brief): the footer count is computed from DATA, rendered
// into #footCount. Before v2.0 it was hand-typed and said 101 while the atlas
// listed 171.
test("footer #footCount shows the live entry count", async ({ page }) => {
  await page.goto("./");
  await waitForApp(page);
  await expect(page.locator("#footCount")).toHaveText(new RegExp(`\\b${DATA.length}\\b`));
});

test("every entry opens a drawer with its name", async ({ page }) => {
  // cheap full sweep: one bad entry (a missing CATS key, a stage number with no
  // STAGES row) throws inside openDrawer and would only show for that org
  await page.goto("./");
  await waitForApp(page);
  const broken = await page.evaluate(() => {
    const bad = [];
    for(const d of DATA){
      try{ openDrawer(d.id); if(document.getElementById("drName").textContent !== d.name) bad.push(d.id + ": wrong name"); }
      catch(e){ bad.push(d.id + ": " + e.message); }
    }
    return bad;
  });
  expect(broken).toEqual([]);
});
