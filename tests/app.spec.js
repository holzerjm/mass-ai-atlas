/* Core invariants founders rely on: the page boots, shared links land where
   they point, and each view actually shows. See docs/testing.md. */
const { test, expect, DATA, ATLAS, metersBetween, waitForApp } = require("./helpers/atlas");

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

// The count's twin: "Curated <month>" was left hand-typed when the count was fixed,
// so it still read June 2026 in October. It now renders the newest lastVerified in
// the data. Derived here the same way the page does, so the test tracks the data
// rather than a month someone has to remember to update.
test("footer #footCurated shows the newest verification month", async ({ page }) => {
  const MONTHS = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];
  const newest = DATA.map((d) => d.lastVerified).filter(Boolean).sort().pop();
  const [y, m] = newest.split("-");
  await page.goto("./");
  await waitForApp(page);
  await expect(page.locator("#footCurated")).toHaveText(`${MONTHS[+m - 1]} ${y}`);
  // the placeholder must actually have been replaced
  await expect(page.locator("#footCurated")).not.toHaveText("—");
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

// Pins at the same spot draw on top of each other at street zoom (clustering
// stops at z15 and spiderfy is off), so only the top one can be clicked: on
// 2026-11-01, 16 entries could not be reached from the map at all. Each popup
// lists the others within 25 m instead. Groups are computed from DATA with the
// same haversine as index.html's COLOCATED_M grouping, so both sides agree on
// which pairs count; that day the closest pair outside 25 m was 27.7 m apart.
test.describe("co-located pins", () => {
  const NEAR_M = 25;
  const exactGroups = Object.values(DATA.reduce((g, d) => {
    (g[`${d.lat},${d.lng}`] = g[`${d.lat},${d.lng}`] || []).push(d);
    return g;
  }, {})).filter(g => g.length > 1);
  const nearPairs = [];
  for(let i = 0; i < DATA.length; i++) for(let j = i + 1; j < DATA.length; j++){
    const m = metersBetween(DATA[i], DATA[j]);
    if(m > 0 && m <= NEAR_M) nearPairs.push([DATA[i], DATA[j]]);
  }

  // Opens entry `id`'s popup and returns its .pop-colocated text ("" when there
  // is none, null when the popup did not open). Un-grouping the pins first puts
  // every marker on the map: inside a cluster a marker has no map, and
  // openPopup() does nothing. autoPan is off while the test opens it, because
  // each pan re-renders the WebGL basemap and dozens in a row stall a busy machine.
  const colocatedText = (page, id) => page.evaluate(id => {
    setClustered(false);
    const m = markers[id], pop = m.getPopup(), autoPan = pop.options.autoPan;
    pop.options.autoPan = false;
    m.openPopup();
    pop.options.autoPan = autoPan;
    const el = m.isPopupOpen() && pop.getElement();
    if(!el) return null;
    const co = el.querySelector(".pop-colocated");
    return co ? co.textContent : "";
  }, id);

  test("markers stay one per entry, at the entry's exact coordinates", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    const moved = await page.evaluate(() => DATA.filter(d => {
      const ll = markers[d.id] && markers[d.id].getLatLng();
      return !ll || ll.lat !== d.lat || ll.lng !== d.lng;
    }).map(d => d.id));
    expect(moved).toEqual([]);
  });

  test("the data still has co-located pins to guard", () => {
    // if every shared spot is ever resolved in the data, the tests below guard
    // nothing: rethink them rather than let them pass vacuously
    expect(exactGroups.length + nearPairs.length).toBeGreaterThan(0);
  });

  test("every pin that shares its spot lists the others in its popup", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    const missing = [];
    for(const group of exactGroups) for(const d of group){
      const text = await colocatedText(page, d.id);
      for(const other of group.filter(o => o !== d)){
        if(text === null) missing.push(`${d.id}: popup did not open`);
        else if(!text.includes(other.name)) missing.push(`${d.id}: .pop-colocated does not list "${other.name}"`);
      }
    }
    expect(missing).toEqual([]);
  });

  test(`pins within ${NEAR_M} m list each other`, async ({ page }) => {
    test.skip(!nearPairs.length, "no near pairs in the data");
    await page.goto("./");
    await waitForApp(page);
    const missing = [];
    for(const [x, y] of nearPairs) for(const [d, other] of [[x, y], [y, x]]){
      const text = await colocatedText(page, d.id);
      if(!text || !text.includes(other.name)) missing.push(`${d.id} → "${other.name}" (${metersBetween(d, other).toFixed(1)} m)`);
    }
    expect(missing).toEqual([]);
  });

  test("each name in .pop-colocated opens that organization's drawer", async ({ page }) => {
    const [d, other] = exactGroups[0] || nearPairs[0] || [];
    test.skip(!d, "no co-located pins in the data");
    await page.goto("./");
    await waitForApp(page);
    await colocatedText(page, d.id);
    const list = page.locator(".leaflet-popup-content .pop-colocated");
    await expect(list).toBeVisible();
    await list.getByText(other.name, { exact: true }).click();
    await expect(page.locator("#drawer")).toHaveClass(/\bopen\b/);
    await expect(page.locator("#drName")).toHaveText(other.name);
  });
});
