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
