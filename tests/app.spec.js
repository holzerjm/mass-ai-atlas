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

// What a first screen holds. The map and the galaxy each fill a screen below a tall header,
// so until 2026-11 their category legend sat at the canvas's bottom-left corner and always
// landed just below the first screen (43 px below it at every desktop size), and the
// credits page was linked only from the footer, below the whole map. 1366 × 650 is a
// small laptop's browser window, the shortest of the sizes measured then.
test.describe("on the first screen", () => {
  test.use({ viewport: { width: 1366, height: 650 } });

  test("the map's and the galaxy's category rows, and the credits link", async ({ page }) => {
    const cats = Object.keys(ATLAS.CATS).length;
    await page.goto("./");
    await waitForApp(page);
    const onFirstScreen = async (sel) => {
      const box = await page.locator(sel).boundingBox();
      expect(box, `${sel} is not rendered`).not.toBeNull();
      expect(box.y + box.height, `${sel} ends below the first screen`).toBeLessThanOrEqual(650);
    };
    await expect(page.locator("#mapCatBar .cat-btn")).toHaveCount(cats);
    await onFirstScreen("#mapCatBar");
    const credits = page.locator(".tagline a", { hasText: "mapmakers" });
    await onFirstScreen('.tagline a[href="credits/"]');
    expect(await credits.evaluate(a => new URL(a.href).pathname)).toMatch(/\/credits\/$/);
    await onFirstScreen('.tagline a[href="updates/"]');

    await page.locator('.tab[data-view="galaxy"]').click();
    await expect(page.locator("#gxCatBar .cat-btn")).toHaveCount(cats);
    await onFirstScreen("#gxCatBar");
  });

  // #map and #galaxy are also the ids of the map and the galaxy canvas, so the browser
  // scrolls a #map or #galaxy link down to the canvas, past its category row. The canvases'
  // scroll-margin-top keeps such a link at the top of the page, where a tab click lands.
  for(const view of ["map", "galaxy"]){
    test(`a #${view} link opens at the top, with the category row in view`, async ({ page }) => {
      await page.goto(`./#${view}`);
      await waitForApp(page);
      await page.waitForLoadState("load");
      await page.waitForTimeout(300);   // the browser's scroll to the #fragment comes after load
      expect(await page.evaluate(() => scrollY)).toBe(0);
      const bar = await page.locator(view === "map" ? "#mapCatBar" : "#gxCatBar").boundingBox();
      expect(bar.y + bar.height).toBeLessThanOrEqual(650);
    });
  }
});

// A copy of this repository sets `const GH_REPO`, and the page's links to the repository must
// follow it. The footer's "reviewed openly on GitHub" link was written into the HTML and ignored
// GH_REPO until 2026-11, so a copy's footer linked to the original. This serves index.html with
// another GH_REPO, so it guards the wiring, not the value.
test("the nav's and the footer's GitHub links follow GH_REPO", async ({ page, baseURL }) => {
  const doc = new URL("./", baseURL).href;   // the page itself, not a CDN script also served at "/"
  let replaced = false;
  await page.route(url => url.href === doc, async route => {
    const res = await route.fetch();
    const html = await res.text();
    const copy = html.replace(/^const GH_REPO = "[^"]+"/m, 'const GH_REPO = "example-org/atlas-copy"');
    replaced = copy !== html;
    await route.fulfill({ response: res, body: copy });
  });
  await page.goto("./");
  await waitForApp(page);
  expect(replaced, "index.html must define `const GH_REPO`").toBe(true);
  for(const id of ["#ghLink", "#footGhLink"]){
    await expect(page.locator(id)).toHaveAttribute("href", "https://github.com/example-org/atlas-copy");
  }
});

// A category button hides that category's pins and shows them again, and says which
// state it is in.
test("a category button hides and shows that category's pins", async ({ page }) => {
  const cat = "vc", inCat = DATA.filter(d => d.cat === cat).length;
  await page.goto("./");
  await waitForApp(page);
  const shown = () => page.evaluate(() => (clustered ? clusterGroup : flatGroup).getLayers().length);
  const btn = page.locator(`#mapCatBar .cat-btn[data-cat="${cat}"]`);
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  expect(await shown()).toBe(DATA.length);
  await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  expect(await shown()).toBe(DATA.length - inCat);
  await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  expect(await shown()).toBe(DATA.length);
});

// Both canvases fill a screen, so until 2026-11 a wheel turn over either one zoomed it,
// and the page below — the footer, the credits link — could not be scrolled to. Now the
// wheel scrolls the page (with a hint), and Ctrl + wheel, or a trackpad pinch, zooms.
test.describe("the wheel over the map and the galaxy", () => {
  test.use({ viewport: { width: 1366, height: 650 } });

  test("over the map it scrolls the page; Ctrl + wheel zooms the map", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    const zoom = () => page.evaluate(() => map.getZoom());
    const z0 = await zoom();
    await page.mouse.move(600, 600);   // the map starts below the header, at about y = 530
    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    await expect(page.locator(".map-wrap .zoom-hint")).toHaveClass(/\bshow\b/);
    expect(await zoom()).toBe(z0);

    await page.mouse.move(600, 400);   // still over the map, now that the page has moved
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -300);
    await page.keyboard.up("Control");
    await expect.poll(zoom).toBeGreaterThan(z0);
  });

  // The galaxy's camera fits it to the canvas and follows the layout as it settles, so its
  // scale moves by itself. Zooming is what hands the camera to the visitor (gxAuto false).
  test("over the galaxy it scrolls the page; Ctrl + wheel zooms the galaxy", async ({ page }) => {
    await page.goto("./#galaxy");
    await waitForApp(page);
    const scale = () => page.evaluate(() => gxScale);
    const auto = () => page.evaluate(() => gxAuto);
    await page.mouse.move(600, 600);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    await expect(page.locator(".galaxy-wrap .zoom-hint")).toHaveClass(/\bshow\b/);
    expect(await auto()).toBe(true);

    await page.mouse.move(600, 400);
    const s0 = await scale();
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await expect.poll(auto).toBe(false);
    expect(await scale()).toBeGreaterThan(s0);
  });
});

// The map search's results took only a click until 2026-11, as the galaxy's did; both boxes
// are now the same combobox. A pick still flies the map to the pin and opens its popup.
test("the map search's results can be chosen with the arrow keys and Enter", async ({ page }) => {
  const q = "ventures";
  expect(DATA.filter(d => d.name.toLowerCase().includes(q)).length, `entries named "${q}"`).toBeGreaterThan(1);
  await page.goto("./");
  await waitForApp(page);
  const input = page.locator("#mapSearch"), options = page.locator('#mapResults [role="option"][data-id]');
  await input.fill(q);
  await expect(page.locator("#mapResults")).toBeVisible();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await input.press("ArrowDown");
  await input.press("ArrowDown");
  const second = options.nth(1), id = await second.getAttribute("data-id");
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(input).toHaveAttribute("aria-activedescendant", await second.getAttribute("id"));
  await input.press("Enter");
  await expect(page.locator("#mapResults")).toBeHidden();
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await expect(input).toHaveValue(DATA.find(d => d.id === id).name);
  await expect.poll(() => page.evaluate(id => markers[id].isPopupOpen(), id), "the pin's popup").toBe(true);
  expect(await page.evaluate(() => map.getZoom())).toBe(15);
});

const scrolled = page => page.evaluate(() => scrollY);
// where the nav reaches the top of the window, with the category row right under it
const navAtTop = page => page.evaluate(() =>
  document.querySelector("#view-map").getBoundingClientRect().top + scrollY - document.querySelector(".nav").offsetHeight);
const restsAtNav = async (page, slack = 1) => {
  const y = await navAtTop(page);
  await expect.poll(async () => Math.abs(await scrolled(page) - y), "the page's distance from the nav's place").toBeLessThanOrEqual(slack);
};

// Show on map flies to the pin and opens its popup when the map gets there. Until 2026-11 a
// 950 ms timer opened it against a 900 ms flight, so whether a popup appeared came down to how
// busy the machine was. Nothing here does: slowFlights makes every flight take 2 s or more, and
// the stray moveend comes from the flight's own first frame.
test.describe("Show on map", () => {
  const FLIGHT_MS = 2000;
  const show = page => page.getByRole("button", { name: "Show on map" }).click();
  const isOpen = (page, id) => page.evaluate(id => markers[id].isPopupOpen(), id);
  const popupOpens = (page, id) => expect.poll(() => isOpen(page, id), "the pin's popup").toBe(true);
  const goToPin = (page, id) => page.evaluate(id => { map.setView(markers[id].getLatLng(), 15, { animate: false }); }, id);
  const eastOf = (page, id, zoom, widths) => page.evaluate(({ id, zoom, widths }) => {
    const at = map.project(markers[id].getLatLng(), zoom).add([map.getSize().x * widths, 0]);
    map.setView(map.unproject(at, zoom), zoom, { animate: false });
  }, { id, zoom, widths });
  // Date.now() is the clock flyTo itself runs on, so a popup that waited for the end of the
  // flight can't report less than the whole flight.
  const slowFlights = (page, ms = FLIGHT_MS) => page.evaluate(ms => {
    const fly = map.flyTo;
    map.flyTo = function(ll, z, options){
      const start = Date.now();
      map.once("popupopen", () => { window.popupAfter = Date.now() - start; });
      return fly.call(this, ll, z, { ...options, duration: ms / 1000 });
    };
  }, ms);
  const popupWaited = async page => expect(await page.evaluate(() => popupAfter)).toBeGreaterThanOrEqual(FLIGHT_MS);

  test("the popup opens when the flight ends, however long that takes", async ({ page }) => {
    await page.goto(`./?entry=${entry.id}`);
    await waitForApp(page);
    await slowFlights(page);
    await show(page);
    await popupOpens(page, entry.id);
    await popupWaited(page);
    expect(await page.evaluate(() => map.getZoom())).toBe(15);
  });

  // A pan the flight stops ends inside flyTo, and a zoom or a resize can end during it. With the
  // pins ungrouped the pin is on the map the whole way, so only the check for arriving can hold
  // the popup back: at city zoom with the pin on the screen, and at street zoom with it just off
  // the screen, where the zoom alone already looks like an arrival.
  for(const [zoom, widths] of [[13, 0], [15, .8]]){
    test(`a move that ends during the flight isn't the arrival, from zoom ${zoom}`, async ({ page }) => {
      await page.goto("./");
      await waitForApp(page);
      await page.evaluate(() => setClustered(false));
      await eastOf(page, entry.id, zoom, widths);
      await page.evaluate(id => openDrawer(id), entry.id);
      await slowFlights(page);
      await page.evaluate(() => map.once("zoomstart", () => map.once("move", () => map.fire("moveend"))));
      await show(page);
      await popupOpens(page, entry.id);
      await popupWaited(page);
    });
  }

  // Filters set in the Directory frame the map on the way back to it, but this trip goes to one
  // pin. Framing as well sent the camera to the filters' zoom in the middle of the flight.
  test("the map goes straight to the pin, past the framing filters were waiting for", async ({ page }) => {
    const pin = DATA.find(d => d.offers.includes("compute"));
    await page.goto("./#directory");
    await waitForApp(page);
    await page.locator('#needChips .need-chip[data-need="compute"]').click();
    await page.locator("#cards").getByRole("button", { name: pin.name, exact: true }).click();
    await expect(page.locator("#drName")).toHaveText(pin.name);
    const start = await page.evaluate(() => {
      window.stops = [];
      map.on("moveend", () => stops.push(map.getZoom()));
      return map.getZoom();
    });
    await show(page);
    await popupOpens(page, pin.id);
    expect((await page.evaluate(() => stops)).filter(z => z !== start)).toEqual([15]);
  });

  // Ungrouping leaves the pins inside the cluster group too, which is off the map by then. Until
  // 2026-11 this asked that group to show the pin, which threw, so no popup ever appeared.
  test("it works with the pins not grouped", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    await page.locator(".map-cluster-toggle").click();
    await page.evaluate(id => openDrawer(id), entry.id);
    await show(page);
    await popupOpens(page, entry.id);
  });

  // The cluster group draws one map's width past each side of the screen, and its zoom animation
  // only brings in what was inside its clusters. So a pin that was alone, beyond that edge, stayed
  // off the map after a flight to it: until 2026-11 three pins showed nothing from the first
  // view, not even the pin. The map starts just past the edge here, whatever the data holds.
  for(const reducedMotion of ["no-preference", "reduce"]){
    test(`it reaches a pin the cluster group hasn't drawn (${reducedMotion})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      await page.goto("./");
      await waitForApp(page);
      const id = await page.evaluate(() => DATA.find(d => markers[d.id].__parent._zoom < 13).id);
      await eastOf(page, id, 13, 1.6);
      await page.evaluate(id => openDrawer(id), id);
      expect(await page.evaluate(id => map.hasLayer(markers[id]), id), "the pin starts off the map").toBe(false);
      await show(page);
      await popupOpens(page, id);
    });
  }

  // Nothing has to move here. A flight still runs, but with reduced motion the only moveend comes
  // before setView returns, so a listener added after it would wait for good.
  for(const reducedMotion of ["no-preference", "reduce"]){
    test(`it works from the pin itself (${reducedMotion})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      await page.goto(`./?entry=${entry.id}`);
      await waitForApp(page);
      await goToPin(page, entry.id);
      await show(page);
      await popupOpens(page, entry.id);
    });
  }

  // Each of these leaves a flight that will never arrive, so the map stops waiting for it. If it
  // didn't, the popup would open whenever the map next came to rest at the pin.
  test("dragging the map during the flight means no popup later", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });   // tall enough to have the map to drag
    await page.goto(`./?entry=${entry.id}`);
    await waitForApp(page);
    await slowFlights(page, 2 * test.info().timeout);   // it can't arrive first, however busy the machine
    await show(page);
    const start = await page.evaluate(() => map.getZoom());
    await expect.poll(() => page.evaluate(() => map.getZoom()), "the flight has begun").not.toBe(start);
    const box = await page.locator("#map").boundingBox();
    await page.mouse.move(box.x + 300, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 380, box.y + 100, { steps: 5 });
    await page.mouse.up();
    await goToPin(page, entry.id);
    expect(await isOpen(page, entry.id)).toBe(false);
  });

  test("a newer flight replaces the one it interrupts", async ({ page }) => {
    const pick = async d => {
      await page.locator("#mapSearch").fill(d.name);
      await page.locator(`#mapResults [data-id="${d.id}"]`).click();
    };
    const other = DATA.find(d => metersBetween(d, entry) > 5000);
    await page.goto("./");
    await waitForApp(page);
    await slowFlights(page);
    await pick(entry);
    await pick(other);
    await popupOpens(page, other.id);
    await goToPin(page, entry.id);
    expect(await isOpen(page, entry.id)).toBe(false);
  });

  // The map starts most of a screen down the page and a flight ends in the middle of it, so until
  // 2026-11 the pin could land below the window: at 1366 × 650 it was off the screen, with 5% of
  // its popup showing. Each of these has to end with the pin and the whole popup on screen, clear
  // of the sticky nav.
  const inWindow = (page, id) => page.evaluate(id => {
    const top = document.querySelector(".nav").getBoundingClientRect().bottom;
    const fits = el => { const box = el.getBoundingClientRect(); return box.top >= top && box.bottom <= innerHeight; };
    return { pin: fits(markers[id].getElement()), popup: fits(markers[id].getPopup().getElement()) };
  }, id);
  const onScreen = (page, id) => expect.poll(() => inWindow(page, id), "the pin and its popup").toEqual({ pin: true, popup: true });

  // A big window and a tall phone show the pin from the top of the page, so nothing moves there.
  for(const [width, height, moves, touch] of [[1366, 650, true], [1280, 720, true], [1440, 900, true], [1920, 1080, false], [390, 844, false, true]]){
    test.describe(`in a ${width} × ${height} window`, () => {
      test.use({ viewport: { width, height }, ...touch && { isMobile: true, hasTouch: true } });

      test("the pin and its popup end on screen", async ({ page }) => {
        await page.goto(`./?entry=${entry.id}`);
        await waitForApp(page);
        await show(page);
        await popupOpens(page, entry.id);
        await onScreen(page, entry.id);
        if(moves) await restsAtNav(page);
        else expect(await scrolled(page)).toBe(0);
      });
    });
  }

  test.describe("in a laptop's window", () => {
    test.use({ viewport: { width: 1366, height: 650 } });

    // The page has smooth scrolling on, so a tab's move to the top is a glide of about 400 ms, and
    // the flight starts 120 ms in. Near the map, that's a moment when the page looks well placed,
    // so a flight that took its reading then left it to glide on up. Until the page stopped
    // gliding here, 300 px down ended at the top every time, and 1,500 px down never did.
    for(const y of [300, 600, 1500]){
      test(`it works from another view, ${y} px down the page`, async ({ page }) => {
        await page.goto(`./?entry=${entry.id}#directory`);
        await waitForApp(page);
        await page.evaluate(top => window.scrollTo({ top, behavior: "instant" }), y);
        await show(page);
        await popupOpens(page, entry.id);
        await onScreen(page, entry.id);
        await restsAtNav(page);
      });
    }

    // A tab goes to the top of the page. Show on map used to go through one, so with the map
    // already in view the page jumped up and took the pin away.
    test("with the map already in view, the page stays where it is", async ({ page }) => {
      await page.goto("./");
      await waitForApp(page);
      const y = await page.evaluate(({ top, id }) => {
        window.scrollTo({ top, behavior: "instant" });
        window.tops = [];
        addEventListener("scroll", () => tops.push(scrollY));
        openDrawer(id);
        return scrollY;
      }, { top: await navAtTop(page), id: entry.id });
      await show(page);
      await popupOpens(page, entry.id);
      await onScreen(page, entry.id);
      expect(await page.evaluate(() => Math.min(scrollY, ...tops))).toBe(y);
    });

    test("from past the top of the map, the page comes back up", async ({ page }) => {
      await page.goto(`./?entry=${entry.id}`);
      await waitForApp(page);
      await page.evaluate(() => window.scrollTo({ top: 900, behavior: "instant" }));
      await show(page);
      await popupOpens(page, entry.id);
      await onScreen(page, entry.id);
      await restsAtNav(page);
    });

    test("a tab still goes to the top of the page afterwards", async ({ page }) => {
      await page.goto(`./?entry=${entry.id}`);
      await waitForApp(page);
      await show(page);
      await popupOpens(page, entry.id);
      await restsAtNav(page);
      await page.locator('.tab[data-view="map"]').click();
      await expect.poll(() => scrolled(page)).toBe(0);
    });

    // Enter picks a result without the page scrolling to it. This window is taller than the rest
    // here because a short list fits it, so the page hasn't moved for the list and the pick has
    // to do it: this is the search at its worst.
    test("a search pick brings its pin on screen, then leaves the page alone", async ({ page }) => {
      const input = page.locator("#mapSearch");
      const pick = async (d, before) => {
        await input.fill(d.name);
        await expect(page.locator(`#mapResults [data-id="${d.id}"]`)).toBeAttached();
        if(before !== undefined) expect(await scrolled(page), "the page before the pick").toBe(before);
        const place = await page.locator('#mapResults [role="option"][data-id]').evaluateAll((all, id) => all.findIndex(o => o.dataset.id === id), d.id);
        for(let i = 0; i <= place; i++) await input.press("ArrowDown");
        await input.press("Enter");
        await popupOpens(page, d.id);
        await onScreen(page, d.id);
      };
      const other = DATA.find(d => metersBetween(d, entry) > 5000);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("./");
      await waitForApp(page);
      await pick(entry, 0);
      await restsAtNav(page);
      const y = await scrolled(page);
      await pick(other);
      expect(await scrolled(page)).toBe(y);
    });

    // Every stop on the way down is a scroll event, so one stop is one jump.
    for(const reducedMotion of ["no-preference", "reduce"]){
      test(`the page ${reducedMotion === "reduce" ? "jumps there with reduced motion" : "glides there otherwise"}`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion });
        await page.goto(`./?entry=${entry.id}`);
        await waitForApp(page);
        await page.evaluate(() => {
          window.stops = new Set();
          addEventListener("scroll", () => stops.add(scrollY));
        });
        await show(page);
        await popupOpens(page, entry.id);
        await restsAtNav(page);
        const stops = await page.evaluate(() => stops.size);
        if(reducedMotion === "reduce") expect(stops).toBe(1);
        else expect(stops).toBeGreaterThan(1);
      });
    }
  });

  // A popup that needs more than half the map pushes its pin down, and a phone on its side has the
  // shortest map there is. The nav's place isn't enough here, so the category row gives way.
  test.describe("on a phone on its side", () => {
    test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

    test("the pin and the tallest popup end on screen", async ({ page }) => {
      await page.goto("./");
      await waitForApp(page);
      const id = await page.evaluate(() => {
        setClustered(false);
        const height = d => {
          markers[d.id].openPopup();
          return markers[d.id].getPopup().getElement().offsetHeight;
        };
        return DATA.map(d => [height(d), d.id]).sort((a, b) => b[0] - a[0])[0][1];
      });
      await page.goto(`./?entry=${id}`);
      await waitForApp(page);
      await show(page);
      await popupOpens(page, id);
      await onScreen(page, id);
    });
  });
});

// The search box sits at the top of the map, most of a screen down the page, so until 2026-11 the
// list dropped below the window as someone typed: with the page at the top, 11 px of it showed at
// 1366 × 650, and none at 1024 × 700. A list that doesn't fit now brings the page to it.
test.describe("the map search's list", () => {
  const TALLEST = "robot";   // more matches than a list holds, so eight rows
  const GLIDE_MS = 600;      // longer than the page takes to move
  const input = page => page.locator("#mapSearch");
  const type = (page, text) => input(page).pressSequentially(text, { delay: 30 });
  const open = async page => {
    await page.goto("./");
    await waitForApp(page);
  };
  // The part of the window that shows, the box and the list, and whether each of the list's rows
  // is what's really at its spot on the screen. Boxes alone would pass a list under the nav.
  const read = page => page.evaluate(() => {
    const list = document.querySelector("#mapResults"), rows = [...list.querySelectorAll('[role="option"]')];
    const nav = document.querySelector(".nav").getBoundingClientRect().bottom, view = visualViewport;
    const box = document.querySelector("#mapSearch").getBoundingClientRect(), { top, bottom } = list.getBoundingClientRect();
    const seen = row => {
      const { left, top, width, height } = row.getBoundingClientRect();
      return list.contains(document.elementFromPoint(left + width / 2, top + height / 2));
    };
    return { from: Math.max(nav, view.offsetTop), to: view.offsetTop + view.height, boxTop: box.top, top, bottom, rows: rows.length, seen: rows.every(seen) };
  });
  // Two pixels to spare, because the page can stop that far off. scrollY is rounded down and the
  // nav's place is fractional, and each key works out the place again from a position in passing.
  const SLACK = 2;
  const fits = ({ from, to, boxTop, top, bottom, rows, seen }) => rows > 0 && seen && boxTop >= from - SLACK && top >= from && bottom <= to + SLACK;
  const shows = page => expect.poll(async () => fits(await read(page)), "the box and the whole list").toBe(true);
  const atNav = page => restsAtNav(page, SLACK);
  // A scroll event comes with the next frame, so this waits, or it would land in what's recorded next.
  const placeAt = (page, top) => page.evaluate(top => {
    window.scrollTo({ top, behavior: "instant" });
    return new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  }, top);
  const watch = page => page.evaluate(() => {
    window.tops = [];
    addEventListener("scroll", () => tops.push(scrollY));
  });
  const stays = async (page, y) => {
    await page.waitForTimeout(GLIDE_MS);
    expect(await page.evaluate(() => tops), "the page's moves").toEqual([]);
    expect(await scrolled(page)).toBe(y);
  };

  for(const [width, height, touch] of [[1366, 650], [1280, 720], [375, 667, true], [1024, 700]]){
    test.describe(`in a ${width} × ${height} window`, () => {
      test.use({ viewport: { width, height }, ...touch && { isMobile: true, hasTouch: true } });

      test("the whole list shows while typing", async ({ page }) => {
        await open(page);
        await type(page, TALLEST);
        await expect(page.locator('#mapResults [role="option"]')).toHaveCount(8);
        await shows(page);
        await atNav(page);
      });
    });
  }

  // Here the nav's place isn't far enough, so the category row gives way.
  test.describe("in a short window with the nav on two rows", () => {
    test.use({ viewport: { width: 820, height: 600 } });

    test("the page goes past the nav's place", async ({ page }) => {
      await open(page);
      await type(page, TALLEST);
      await shows(page);
      expect(await scrolled(page)).toBeGreaterThan(await navAtTop(page));
    });
  });

  // This window fits the box and a whole list only because the nav doesn't come along. It sticks
  // as far as the foot of <body>, one window down, and the box starts lower than that. Allowing
  // for a nav that isn't there cut the list off, even from a place where it fitted.
  test.describe("on a phone on its side", () => {
    test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

    test("the whole list shows, with no nav to clear", async ({ page }) => {
      await open(page);
      await type(page, TALLEST);
      await shows(page);
    });

    test("a list that fits below a nav that isn't there leaves the page alone", async ({ page }) => {
      await open(page);
      await placeAt(page, await input(page).evaluate(box => box.getBoundingClientRect().top + scrollY - 10));
      const y = await scrolled(page);
      await watch(page);
      await input(page).fill(TALLEST);
      await shows(page);
      await stays(page, y);
    });
  });

  // The browsers Playwright drives have no on-screen keyboard. A real one leaves innerHeight alone
  // and shrinks the visual viewport, which is what these stand in for. Keeping innerHeight would
  // leave a 390 × 844 phone's list under the keyboard, because it fits the window.
  const keyboardUp = (page, height) => page.evaluate(height =>
    Object.defineProperty(window, "visualViewport", { value: { offsetTop: 0, height } }), height);

  for(const [width, height, keyboard] of [[375, 667, 260], [390, 844, 330]]){
    test.describe(`on a ${width} × ${height} phone with its keyboard up`, () => {
      test.use({ viewport: { width, height }, isMobile: true, hasTouch: true });

      test("the whole list clears the keyboard", async ({ page }) => {
        await open(page);
        await keyboardUp(page, height - keyboard);
        await type(page, TALLEST);
        await shows(page);
      });
    });
  }

  // Too little shows for the box and a whole list, so the box stays in sight, as high as it can
  // go, and the list takes what's left. It scrolls inside itself, so nothing is out of reach. A
  // nav still in reach of the box stops it, and on a phone on its side there's none to stop it.
  for(const [width, height, keyboard, under] of [[375, 667, 300, "the nav"], [844, 390, 200, "the top of the window"]]){
    test.describe(`on a ${width} × ${height} phone with its keyboard up`, () => {
      test.use({ viewport: { width, height }, isMobile: true, hasTouch: true });

      test(`the box stops right under ${under}`, async ({ page }) => {
        await open(page);
        await keyboardUp(page, height - keyboard);
        await type(page, TALLEST);
        await expect.poll(async () => {
          const { from, boxTop } = await read(page);
          return Math.abs(boxTop - from);
        }, "how far the box is from where it should stop").toBeLessThanOrEqual(1);
      });
    });
  }

  // Bringing up the keyboard can also pan what shows down the page. Going to the nav's place then
  // would carry the box up out of sight, and going by the height alone would go too far.
  test.describe("on a phone with what shows panned down the page", () => {
    test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
    const panned = (page, offsetTop) => page.evaluate(offsetTop =>
      Object.defineProperty(window, "visualViewport", { value: { offsetTop, height: 407 } }), offsetTop);

    test("the box and the list stay in sight", async ({ page }) => {
      await open(page);
      await panned(page, 260);
      await type(page, TALLEST);
      await shows(page);
    });

    test("the page goes no further than it has to", async ({ page }) => {
      await open(page);
      await panned(page, 100);
      await type(page, TALLEST);
      await shows(page);
      await atNav(page);
    });
  });

  test.describe("in a 1920 × 1080 window", () => {
    test.use({ viewport: { width: 1920, height: 1080 } });

    test("the tallest list fits, so the page stays where it is", async ({ page }) => {
      await open(page);
      await watch(page);
      await type(page, TALLEST);
      await shows(page);
      await stays(page, 0);
    });
  });

  // A short list fits this window and the tallest doesn't, so what counts is the list, not the box.
  test.describe("in a 1440 × 900 window", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("a short list stays where it is, and a tall one brings the page", async ({ page }) => {
      await open(page);
      await watch(page);
      await input(page).fill(entry.name);
      await shows(page);
      await stays(page, 0);
      await input(page).fill(TALLEST);
      await shows(page);
      await atNav(page);
    });
  });

  // With the box out of sight a glide doesn't survive. The browser scrolls to the caret after each
  // key, which stops it, and after a stall it starts from an old position and drags a finished
  // glide back up: at 1024 × 700 the page reached 389 and went back to 34, with the list cut off.
  // That takes a stall to happen, so these check for what prevents it, which is one stop.
  for(const [width, height, y, where] of [[1024, 700, 0, "below"], [1366, 650, 900, "above"]]){
    test.describe(`in a ${width} × ${height} window`, () => {
      test.use({ viewport: { width, height } });

      test(`with the box ${where} the window, the page jumps there`, async ({ page }) => {
        await open(page);
        await input(page).evaluate(box => box.focus({ preventScroll: true }));
        await placeAt(page, y);
        await watch(page);
        await page.keyboard.type(TALLEST, { delay: 30 });
        await shows(page);
        await atNav(page);
        expect(new Set(await page.evaluate(() => tops)).size, "the page's stops").toBe(1);
      });
    });
  }

  test.describe("in a laptop's window", () => {
    test.use({ viewport: { width: 1366, height: 650 } });

    // It goes down in one go, however fast the keys come, and then stays there whatever's typed.
    test("the page moves once, not on every key", async ({ page }) => {
      await open(page);
      await watch(page);
      await type(page, TALLEST);
      await shows(page);
      await atNav(page);
      await page.waitForTimeout(GLIDE_MS);
      const y = await scrolled(page), way = await page.evaluate(() => tops.splice(0));
      expect(way, "the page's way down").toEqual([...way].sort((a, b) => a - b));
      for(let i = 0; i < TALLEST.length; i++) await input(page).press("Backspace");
      await type(page, "boston lab");
      for(let i = 0; i < 4; i++) await input(page).press("Backspace");   // and the list grows again
      await shows(page);
      await stays(page, y);
    });

    // Moving on focus would mean guessing at a list that isn't there yet, for someone who may not
    // be typing at all. A closing popup hands the box the focus too.
    test("the box taking the focus leaves the page alone", async ({ page }) => {
      await open(page);
      await watch(page);
      await input(page).click();
      await stays(page, 0);
      await input(page).fill(entry.name);
      await input(page).press("Enter");
      await expect.poll(() => page.evaluate(id => markers[id].isPopupOpen(), entry.id), "the pin's popup").toBe(true);
      await placeAt(page, 0);
      await page.evaluate(() => { tops.length = 0; });
      await page.keyboard.press("Escape");
      await expect(input(page)).toBeFocused();
      await stays(page, 0);
    });

    // The list fits and the box is on the screen, but it's under the nav, so what's typed doesn't show.
    test("with the box under the nav, the page comes back", async ({ page }) => {
      await open(page);
      const nav = await page.evaluate(() => document.querySelector(".nav").offsetHeight);
      await placeAt(page, await input(page).evaluate((box, nav) => box.getBoundingClientRect().top + scrollY - nav / 2, nav));
      await input(page).evaluate(box => box.focus({ preventScroll: true }));
      await page.keyboard.type(TALLEST, { delay: 30 });
      await shows(page);
      await atNav(page);
    });

    test("a tab still goes to the top of the page afterwards", async ({ page }) => {
      await open(page);
      await type(page, TALLEST);
      await atNav(page);
      await page.locator('.tab[data-view="map"]').click();
      await expect.poll(() => scrolled(page)).toBe(0);
    });

    // Each stop on the way down is a scroll event, so one stop is one jump. The reverse doesn't
    // hold: a glide that runs during a stall can arrive as one event too, so for a glide this
    // goes by what the page asked for.
    for(const reducedMotion of ["no-preference", "reduce"]){
      test(`the page ${reducedMotion === "reduce" ? "jumps there with reduced motion" : "glides there otherwise"}`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion });
        await open(page);
        await watch(page);
        await page.evaluate(() => {
          const go = window.scrollTo;
          window.asked = [];
          window.scrollTo = function(options){ asked.push(options.behavior); return go.call(this, options); };
        });
        await type(page, TALLEST);
        await shows(page);
        await atNav(page);
        if(reducedMotion === "reduce") expect(new Set(await page.evaluate(() => tops)).size).toBe(1);
        expect([...new Set(await page.evaluate(() => asked))]).toEqual([reducedMotion === "reduce" ? "auto" : "smooth"]);
      });
    }
  });
});

// The Founder Journey's organizations were spans that took only a click until 2026-11. As
// buttons, Tab reaches them from the Journey's tab, Enter opens one, and closing its drawer
// puts focus back on it.
test("the Founder Journey's organizations can be reached with Tab and opened with Enter", async ({ page }) => {
  await page.goto("./#journey");
  await waitForApp(page);
  const chip = page.locator("#jrPanel .chip").first(), name = (await chip.textContent()).trim();
  await page.locator('.tab[data-view="journey"]').focus();
  const onChip = () => page.evaluate(() => document.activeElement.matches("#jrPanel .chip"));
  for(let i = 0; i < 60 && !(await onChip()); i++) await page.keyboard.press("Tab");
  await expect(chip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#drawer")).toHaveClass(/\bopen\b/);
  await expect(page.locator("#drName")).toHaveText(name);
  await page.keyboard.press("Escape");
  await expect(page.locator("#drawer")).not.toHaveClass(/\bopen\b/);
  await expect(chip).toBeFocused();
});

// The Founder Journey's stages were divs that took only a click until 2026-11, so the keyboard
// saw stage 1 and nothing else. As buttons they say which stage is chosen (aria-pressed), and
// the focus stays on the chosen one when the stepper redraws.
test("the Founder Journey's stages can be chosen by keyboard", async ({ page }) => {
  await page.goto("./#journey");
  await waitForApp(page);
  const step = n => page.locator(`#stepper .step[data-n="${n}"]`);
  await expect(step(1)).toHaveAttribute("aria-pressed", "true");
  await step(1).focus();
  await page.keyboard.press("Tab");
  await expect(step(2)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(step(2)).toHaveAttribute("aria-pressed", "true");
  await expect(step(1)).toHaveAttribute("aria-pressed", "false");
  await expect(step(2)).toBeFocused();
  await expect(page.locator("#jrPanel h3")).toContainText(ATLAS.STAGES.find(s => s.n === 2).t);
});

// "Full details →" in a pin's popup was a span until 2026-11, and Leaflet puts popups after
// every pin in the tab order, so the keyboard could not reach it. The popup now takes the
// focus when it opens, and gives it back when it closes or Escape is pressed inside it.
test("a pin's popup takes the focus, so the keyboard can open its details", async ({ page }) => {
  await page.goto("./");
  await waitForApp(page);
  const input = page.locator("#mapSearch"), details = page.locator(".leaflet-popup .pop-btn");
  await input.fill(entry.name);   // a pick flies to street zoom, where no pin is clustered
  const ids = await page.locator('#mapResults [role="option"][data-id]').evaluateAll(els => els.map(el => el.dataset.id));
  expect(ids, `${entry.name} among the results`).toContain(entry.id);
  for(let i = 0; i <= ids.indexOf(entry.id); i++) await input.press("ArrowDown");
  await input.press("Enter");
  await expect(details).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#drName")).toHaveText(entry.name);
  await page.keyboard.press("Escape");   // closes the drawer
  await expect(details).toBeFocused();
  await page.keyboard.press("Escape");   // then the popup
  await expect(page.locator(".leaflet-popup")).toHaveCount(0);
  await expect(input).toBeFocused();

  // a pin opens its popup with Enter, and gets the focus back when the popup's × closes it
  const pinFocused = () => page.evaluate(id => document.activeElement === markers[id].getElement(), entry.id);
  await page.evaluate(id => markers[id].getElement().focus(), entry.id);
  await page.keyboard.press("Enter");
  await expect(details).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".leaflet-popup-close-button")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".leaflet-popup")).toHaveCount(0);
  expect(await pinFocused(), "the focus back on the pin").toBe(true);
});

// The Directory's category chips were spans that took only a click until 2026-11. As buttons
// they say which categories show (aria-pressed), as the "I need…" chips beside them do.
test("the Directory's category chips work by keyboard and say which categories show", async ({ page }) => {
  await page.goto("./#directory");
  await waitForApp(page);
  const cats = Object.keys(ATLAS.CATS).length, pressed = page.locator('#catChips .cat-chip[aria-pressed="true"]');
  const first = page.locator("#catChips .cat-chip").first(), cat = await first.getAttribute("data-cat");
  await expect(pressed).toHaveCount(cats);
  await first.focus();
  await page.keyboard.press("Enter");   // with every category showing, a chip shows its own alone
  await expect(pressed).toHaveCount(1);
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#cards .card")).toHaveCount(DATA.filter(d => d.cat === cat).length);
  await page.keyboard.press("Space");   // and turning that one off shows them all again
  await expect(pressed).toHaveCount(cats);
  await expect(page.locator("#cards .card")).toHaveCount(DATA.length);
});
