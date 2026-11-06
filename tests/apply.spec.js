/* Deadlines and apply links (see docs/testing.md). Real deadlines change with the calendar, so each
   test sets the entry it needs in the page rather than relying on one. */
const { test, expect, DATA, waitForApp } = require("./helpers/atlas");

const [first, second] = DATA.filter(d => d.cat === "accel").map(d => d.id);
const [fund, otherFund] = DATA.filter(d => d.cat === "vc").map(d => d.id);
const APPLY = "https://example.org/apply";

// Give an entry these application fields and no others, then open its drawer.
const openWith = async (page, fields, id = first) => {
  await page.goto("./");
  await waitForApp(page);
  await page.evaluate(([id, fields]) => {
    for(const k of ["applyBy", "applyNote", "applyUrl"]) delete byId[id][k];
    Object.assign(byId[id], fields);
    openDrawer(id);
  }, [id, fields]);
};
const action = (page, text) => page.locator("#drBody .dr-actions a", { hasText: text });

test("an open application gets an Apply button, and the website steps back", async ({ page }) => {
  await openWith(page, { applyBy: "rolling", applyUrl: APPLY });
  await expect(page.locator("#drBody .dr-apply")).toContainText("Applications open — rolling");
  await expect(action(page, "Apply")).toHaveAttribute("href", APPLY);
  await expect(action(page, "Apply")).toHaveClass(/btn-pri/);
  await expect(action(page, "Apply")).toHaveAttribute("rel", "noopener");
  await expect(action(page, "Visit website")).toHaveClass(/btn-sec/);
});

test("with no application page, the website stays the main button", async ({ page }) => {
  await openWith(page, { applyBy: "rolling" });
  await expect(action(page, "Apply")).toHaveCount(0);
  await expect(action(page, "Visit website")).toHaveClass(/btn-pri/);
});

// A closed program still tells a founder when to come back, but it isn't open.
test("a closed program says when to come back, and offers no Apply button", async ({ page }) => {
  await openWith(page, { applyNote: "Opens each March", applyUrl: APPLY });
  await expect(page.locator("#drBody .dr-closed")).toContainText("Applications closed · Opens each March");
  await expect(page.locator("#drBody .dr-closed a")).toHaveAttribute("href", APPLY);
  await expect(action(page, "Apply")).toHaveCount(0);
  expect(await page.evaluate(id => applyOpen(byId[id]), first)).toBe(false);
});

// A pitch page is a way in, not an application, so it must not read as one.
test("a funder's pitch page says it takes pitches, and offers no Apply button", async ({ page }) => {
  await openWith(page, { applyUrl: APPLY }, fund);
  await expect(page.locator("#drBody .dr-pitch")).toContainText("Takes pitches");
  await expect(page.locator("#drBody .dr-pitch a")).toHaveAttribute("href", APPLY);
  await expect(page.locator("#drBody .dr-pitch a")).toHaveAttribute("rel", "noopener");
  await expect(page.locator("#drBody .dr-apply")).toHaveCount(1);
  await expect(action(page, "Apply")).toHaveCount(0);
  await expect(action(page, "Visit website")).toHaveClass(/btn-pri/);
  expect(await page.evaluate(id => applyOpen(byId[id]), fund)).toBe(false);
});

test("a funder with a real application is open, not just taking pitches", async ({ page }) => {
  await openWith(page, { applyBy: "rolling", applyUrl: APPLY }, fund);
  await expect(page.locator("#drBody .dr-apply")).toContainText("Applications open — rolling");
  await expect(page.locator("#drBody .dr-pitch")).toHaveCount(0);
  await expect(action(page, "Apply")).toHaveAttribute("href", APPLY);
});

test("only a funder takes pitches: anywhere else, a link alone shows nothing", async ({ page }) => {
  await openWith(page, { applyUrl: APPLY });
  await expect(page.locator("#drBody .dr-apply")).toHaveCount(0);
  await expect(action(page, "Apply")).toHaveCount(0);
});

test("the Open filter leaves out a funder that only takes pitches", async ({ page }) => {
  await page.goto("./?open=1#directory");
  await waitForApp(page);
  await page.evaluate(([id, url]) => {
    for(const k of ["applyBy", "applyNote", "applyUrl"]) delete byId[id][k];
    byId[id].applyUrl = url;
    renderCards();
  }, [fund, APPLY]);
  await expect(page.locator("#cards .card-open").first()).toBeVisible();
  const names = await page.locator("#cards .card-open").allTextContents();
  expect(names.map(n => n.trim())).not.toContain(DATA.find(d => d.id === fund).name);
});

test("Compare links a funder's pitch page in the Applications row", async ({ page }) => {
  await page.goto("./#directory");
  await waitForApp(page);
  await page.evaluate(([a, b, url]) => {
    for(const id of [a, b]) for(const k of ["applyBy", "applyNote", "applyUrl"]) delete byId[id][k];
    byId[a].applyUrl = url;
    toggleCompare(a); toggleCompare(b); openCompare();
  }, [fund, otherFund, APPLY]);
  const row = page.locator("#cmpBody tr", { hasText: "Applications" });
  await expect(row).toContainText("Takes pitches");
  await expect(row.locator("a")).toHaveAttribute("href", APPLY);
  await expect(row.locator("a")).toHaveText("How to pitch ↗");
});

// The note beside a date describes that deadline, so it must not outlive it.
test("a deadline that has passed shows nothing", async ({ page }) => {
  await openWith(page, { applyBy: "2020-01-01", applyNote: "Spring class", applyUrl: APPLY });
  await expect(page.locator("#drBody .dr-apply")).toHaveCount(0);
  await expect(action(page, "Apply")).toHaveCount(0);
});

// An expired date means the entry needs updating, not that the funder takes pitches.
test("a funder's deadline that has passed doesn't turn into a pitch", async ({ page }) => {
  await openWith(page, { applyBy: "2020-01-01", applyUrl: APPLY }, fund);
  await expect(page.locator("#drBody .dr-apply")).toHaveCount(0);
});

test("Closing soon lists the nearest date first, then rolling", async ({ page }) => {
  await page.goto("./#directory");
  await waitForApp(page);
  const [rolling] = DATA.filter(d => d.cat === "vc").map(d => d.id);
  await page.evaluate(([later, sooner, rolling]) => {
    DATA.forEach(d => delete d.applyBy);
    byId[later].applyBy = "2099-06-01";
    byId[sooner].applyBy = "2099-01-01";
    byId[rolling].applyBy = "rolling";
  }, [first, second, rolling]);
  await page.locator("#dirSort").selectOption("deadline");
  await expect(page).toHaveURL(/[?&]sort=deadline/);
  const names = await page.locator("#cards .card-open").evaluateAll(els => els.slice(0, 3).map(e => e.textContent.trim()));
  expect(names).toEqual([second, first, rolling].map(id => DATA.find(d => d.id === id).name));
});
