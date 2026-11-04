/* The filters: one set for the map and the Directory, kept in the address (see docs/testing.md).
   Until 2026-11 only the Directory had needs and stages, a reload cleared them, and no link could
   carry them. */
const { test, expect, DATA, waitForApp } = require("./helpers/atlas");

const offering = need => DATA.filter(d => d.offers.includes(need));
const pins = page => page.evaluate(() => (clustered ? clusterGroup : flatGroup).getLayers().length);
const need = (page, row, key) => page.locator(`${row} .need-chip[data-need="${key}"]`);

test("a filter goes into the address, and a reload keeps it", async ({ page }) => {
  await page.goto("./#directory");
  await waitForApp(page);
  await need(page, "#needChips", "compute").click();
  await page.locator("#dirStage").selectOption("3");
  await expect(page).toHaveURL(/\?need=compute&stage=3#directory$/);
  const count = await page.locator("#dirCount").textContent();
  await page.reload();
  await waitForApp(page);
  await expect(need(page, "#needChips", "compute")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#dirStage")).toHaveValue("3");
  await expect(page.locator("#dirCount")).toHaveText(count);
});

// Each kind of filter, from a link someone sent, with the page's other parameters beside them.
test("a shared link sets every filter, and an entry opens over them", async ({ page }) => {
  const id = offering("compute").find(d => d.cat === "gov").id;
  await page.goto(`./?need=compute&stage=3&open=1&cat=gov,accel&sort=new&entry=${id}#directory`);
  await waitForApp(page);
  await expect(page.locator("#drawer")).toHaveClass(/\bopen\b/);
  await expect(need(page, "#needChips", "open")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#dirStage")).toHaveValue("3");
  await expect(page.locator("#dirSort")).toHaveValue("new");
  await expect(page.locator('#catChips .cat-chip[aria-pressed="true"]')).toHaveCount(2);
  await page.keyboard.press("Escape");
  // closing the drawer rewrites the address, and only ?entry= goes
  await expect(page).not.toHaveURL(/entry=/);
  for(const param of ["need=compute", "stage=3", "open=1", "sort=new"]) expect(page.url()).toContain(param);
});

test("unknown values in a link are ignored", async ({ page }) => {
  await page.goto("./?need=compute,nonsense&stage=9&open=maybe&cat=nope&sort=sideways#directory");
  await waitForApp(page);
  await expect(page.locator('#needChips .need-chip[aria-pressed="true"]')).toHaveCount(1);
  await expect(page.locator("#dirStage")).toHaveValue("");
  await expect(page.locator("#dirSort")).toHaveValue("name");
  await expect(page.locator("#cards .card")).toHaveCount(offering("compute").length);
});

// The map answers to the same filters, whichever view set them.
test("the map shows what the Directory shows, and the two share their controls", async ({ page }) => {
  await page.goto("./");
  await waitForApp(page);
  expect(await pins(page)).toBe(DATA.length);
  await expect(page.locator("#mapNote .filter-clear")).toBeHidden();

  await need(page, "#mapNeeds", "compute").click();
  await expect.poll(() => pins(page)).toBe(offering("compute").length);
  await expect(page.locator("#mapCount")).toHaveText(`${offering("compute").length} of ${DATA.length} organizations on the map`);
  await expect(page).toHaveURL(/need=compute/);

  await page.locator('.tab[data-view="directory"]').click();
  await expect(need(page, "#needChips", "compute")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#cards .card")).toHaveCount(offering("compute").length);

  await page.locator("#dirStage").selectOption("3");
  const both = offering("compute").filter(d => (d.stages || []).includes(3));
  await expect(page.locator("#cards .card")).toHaveCount(both.length);
  await page.locator('.tab[data-view="map"]').click();
  await expect(page.locator("#mapStage")).toHaveValue("3");
  await expect.poll(() => pins(page)).toBe(both.length);
});

test("a category hidden on the map is hidden in the Directory too", async ({ page }) => {
  const cat = "vc", inCat = DATA.filter(d => d.cat === cat).length;
  await page.goto("./");
  await waitForApp(page);
  await page.locator(`#mapCatBar .cat-btn[data-cat="${cat}"]`).click();
  await expect(page).toHaveURL(/cat=/);
  await page.locator('.tab[data-view="directory"]').click();
  await expect(page.locator(`#catChips .cat-chip[data-cat="${cat}"]`)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#cards .card")).toHaveCount(DATA.length - inCat);
});

// Most compute is outside the Boston view, so a filter must not leave the map looking empty.
test("a need frames the pins it leaves, and clearing returns to the chosen view", async ({ page }) => {
  await page.goto("./");
  await waitForApp(page);
  const inView = () => page.evaluate(ids => ids.filter(id => map.getBounds().contains(markers[id].getLatLng())).length, offering("compute").map(d => d.id));
  const start = await page.evaluate(() => [map.getCenter().lat, map.getZoom()]);
  await need(page, "#mapNeeds", "compute").click();
  await expect.poll(inView).toBe(offering("compute").length);
  await page.locator("#mapNote .filter-clear").click();
  await expect(page.locator("#mapNote .filter-clear")).toBeHidden();
  await expect(need(page, "#mapNeeds", "funding")).toBeFocused();
  await expect.poll(() => pins(page)).toBe(DATA.length);
  await expect.poll(() => page.evaluate(() => map.getZoom())).toBe(start[1]);
  expect(page.url()).not.toContain("need=");
});

// Filters can hide the pin a search finds, or the one a drawer's "Show on map" asks for.
test("a pin the filters hide can still be reached", async ({ page }) => {
  const hidden = DATA.find(d => !d.offers.includes("compute"));
  await page.goto("./?need=compute");
  await waitForApp(page);
  await page.locator("#mapSearch").fill(hidden.name);
  await page.locator(`#mapResults [data-id="${hidden.id}"]`).click();
  await expect(page.locator("#drName")).toHaveText(hidden.name);
  await page.getByRole("button", { name: "Show on map" }).click();
  await expect.poll(() => page.evaluate(id => markers[id].isPopupOpen(), hidden.id), "the pin's popup").toBe(true);
  expect(page.url()).not.toContain("need=");
});

// The headline figures were plain text until 2026-11. Each link's set matches its figure.
test("the headline figures open the Directory with that set showing", async ({ page }) => {
  await page.goto("./");
  await waitForApp(page);
  const free = offering("grants").length;
  await page.locator("#stats a.stat", { hasText: "equity-free" }).click();
  await expect(page.locator("#stats a.stat", { hasText: "equity-free" }).locator("b")).toHaveText(String(free));
  await expect(page.locator("#cards .card")).toHaveCount(free);
  await expect(page).toHaveURL(/\?need=grants#directory$/);

  const capital = DATA.filter(d => d.cat === "vc" || d.cat === "angel").length;
  await page.locator("#stats a.stat", { hasText: "capital" }).click();
  await expect(page.locator("#cards .card")).toHaveCount(capital);
  await expect(need(page, "#needChips", "grants")).toHaveAttribute("aria-pressed", "false");

  await page.locator("#stats a.stat", { hasText: "organizations" }).click();
  await expect(page.locator("#cards .card")).toHaveCount(DATA.length);
  expect(new URL(page.url()).search).toBe("");
  await expect(page.locator("#stats a.stat")).toHaveCount(3);
});

// The header filled a phone's first screen (until 2026-11): the map started 792 px down, the
// Directory's first card 1,428 px down, and the sticky tabs took three rows.
test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the map and the Directory's first card are on the first screen", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    const top = sel => page.locator(sel).first().evaluate(el => el.getBoundingClientRect().top + scrollY);
    expect(await top("#map")).toBeLessThan(600);
    expect((await page.locator("nav.nav").boundingBox()).height).toBeLessThan(70);
    await page.locator('.tab[data-view="directory"]').click();
    expect(await top("#cards .card")).toBeLessThan(760);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

// The site menu's button had the browser's gray behind a white icon: 1.15:1 on the atlas and the
// events page, which lifts the header from it.
for(const [name, url] of [["atlas", "./"], ["events", "./events/"]]){
  test(`the ${name} page's menu button has no gray box behind its icon`, async ({ page }) => {
    await page.goto(url);
    const bg = await page.locator("#mobile-menu-btn").evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).toBe("rgba(0, 0, 0, 0)");
  });
}

test("the hero's button doesn't promise an open application", async ({ page }) => {
  await page.goto("./");
  await waitForApp(page);
  await expect(page.locator(".hero-cta .btn-pri")).toHaveText("Learn about the TOA Residency");
});
