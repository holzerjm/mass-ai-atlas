/* /updates/: what's new, and the banner and links that lead to it. These tests read the same
   files as the page, so adding an update never means changing a test. See docs/testing.md. */
const { test, expect, ROOT, ATLAS, DATA, waitForApp } = require("./helpers/atlas");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const UPDATES = yaml.load(fs.readFileSync(path.join(ROOT, "data", "updates.yml"), "utf8"),
  { schema: yaml.CORE_SCHEMA }) || [];
const NEWEST = [...UPDATES].sort((a, b) => b.date.localeCompare(a.date))[0];
const FIRST = DATA.map(d => d.added).filter(Boolean).sort()[0];
const ADDED = DATA.filter(d => d.added && d.added !== FIRST);
const openUpdates = async page => {
  await page.goto("./updates/");
  await expect(page.locator("#months .month").first()).toBeVisible();
};

test("the updates page shows every update, newest first", async ({ page }) => {
  test.skip(!UPDATES.length, "this copy of the atlas has no updates");
  await openUpdates(page);
  await expect(page.locator(".timeline li")).toHaveCount(UPDATES.length);
  const dates = await page.locator(".timeline time").evaluateAll(ts => ts.map(t => t.getAttribute("datetime")));
  expect(dates).toEqual(UPDATES.map(u => u.date).sort().reverse());
  expect((await page.locator(".timeline h3").allTextContents()).sort()).toEqual(UPDATES.map(u => u.title).sort());
  await expect(page.locator(".try a")).toHaveCount(UPDATES.filter(u => u.try).length);
});

test("every Try it link lands inside the atlas", async ({ page, baseURL }) => {
  for(const u of UPDATES.filter(x => x.try)){
    await page.goto("about:blank");   // a hash-only link is otherwise a same-page move with no response
    const res = await page.goto(new URL(u.try, baseURL).href);
    expect(res.ok(), u.try).toBe(true);
    const pathway = new URLSearchParams(u.try.split("#")[0].split("?")[1] || "").get("pathway");
    if(pathway) await expect(page.locator(`.pw-pick[data-pathway="${pathway}"]`)).toHaveAttribute("aria-pressed", "true");
  }
});

test("a Try it link on the page opens what it says", async ({ page }) => {
  const u = UPDATES.find(x => (x.try || "").includes("pathway="));
  test.skip(!u, "no update links to a pathway");
  await openUpdates(page);
  await page.locator(".timeline li", { hasText: u.title }).locator(".try a").click();
  await waitForApp(page);
  await expect(page.locator(".pw-pick[aria-pressed='true']")).toBeVisible();
  expect(page.url()).toContain(u.try);
});

// The first month is when `added` began, so 116 "new" organizations in it would be false.
test("new organizations appear by month, and the first month is where the record starts", async ({ page }) => {
  await openUpdates(page);
  const months = [...new Set(ADDED.map(d => d.added))];
  for(const ym of months){
    const here = ADDED.filter(d => d.added === ym);
    const box = page.locator(`section[aria-labelledby="m${ym}"] .orgs`);
    await expect(box.locator("summary")).toHaveText(`${here.length} new organization${here.length === 1 ? "" : "s"}`);
    await expect(box.locator("a")).toHaveCount(here.length);
  }
  await expect(page.locator(`section[aria-labelledby="m${FIRST}"] .orgs`)).toHaveCount(0);
  await expect(page.locator("#orgCount")).toHaveText(String(DATA.length));
  await expect(page.locator("#addedCount")).toHaveText(String(ADDED.length));
  await expect(page.locator("#start")).toContainText(`${DATA.length - ADDED.length} organizations already on the map`);
  await expect(page.locator("#start a")).toHaveAttribute("href", "../credits/#historyTitle");
});

test("a new organization's link opens its entry", async ({ page }) => {
  test.skip(!ADDED.length, "no organization joined after the first month");
  await openUpdates(page);
  const name = (await page.locator(".orgs[open] a").first().textContent()).trim();
  await page.locator(".orgs[open] a").first().click();
  await waitForApp(page);
  await expect(page.locator("#drawer")).toHaveClass(/\bopen\b/);
  await expect(page.locator("#drName")).toHaveText(name);
});

test.describe("when a file doesn't load", () => {
  test.use({ expectedHttpErrors: [/\/data\/(updates|entities)\.yml/] });

  test("the updates still show without the entries", async ({ page }) => {
    await page.route("**/data/entities.yml", route => route.fulfill({ status: 404, body: "" }));
    await page.goto("./updates/");
    await expect(page.locator(".timeline li")).toHaveCount(UPDATES.length);
    await expect(page.locator(".orgs")).toHaveCount(0);
    await expect(page.locator("#stat")).toBeHidden();
  });

  test("the page says so without the updates, and still lists organizations", async ({ page }) => {
    await page.route("**/data/updates.yml", route => route.fulfill({ status: 404, body: "" }));
    await page.goto("./updates/");
    await expect(page.locator(".error")).toContainText("failed to load");
    await expect(page.locator(".orgs").first()).toBeVisible();
  });

  test("the atlas loads as usual without the updates", async ({ page }) => {
    await page.route("**/data/updates.yml", route => route.fulfill({ status: 404, body: "" }));
    await page.goto("./");
    await waitForApp(page);
    await expect(page.locator("#mapCatBar .cat-btn").first()).toBeVisible();
  });
});

test("the atlas and events footers link to the updates page", async ({ page, baseURL }) => {
  const want = new URL("updates/", baseURL).href;
  await page.goto("./");
  await waitForApp(page);
  expect(await page.locator("footer.footer a", { hasText: "what's new" }).evaluate(a => a.href)).toBe(want);
  await page.goto("./events/");
  expect(await page.locator("footer.footer a", { hasText: "what's new" }).evaluate(a => a.href)).toBe(want);
});

test.describe("the banner, for someone who hasn't read the newest update", () => {
  test.use({ newBanner: true });
  const banner = page => page.locator("#newBanner");
  test.skip(!NEWEST, "this copy of the atlas has no updates");

  test("it names the newest update, and shows once", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    await expect(banner(page)).toBeVisible();
    await expect(page.locator("#newBannerText")).toContainText(NEWEST.title);
    await banner(page).locator(".nb-x").click();
    await expect(banner(page)).toBeHidden();
    await page.reload();
    await waitForApp(page);
    await page.waitForTimeout(400);   // the file is read after load, so give it the time to be wrong
    await expect(banner(page)).toBeHidden();
  });

  test("its link opens the updates page, and counts as reading it", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    await banner(page).locator("a").click();
    await expect(page).toHaveURL(/\/updates\/$/);
    expect(await page.evaluate(() => localStorage.getItem("toa-atlas-newbanner") >= "0")).toBe(true);
    await page.goto("./");
    await waitForApp(page);
    await page.waitForTimeout(400);
    await expect(banner(page)).toBeHidden();
  });

  test("someone who dismissed last month's banner still sees a newer update", async ({ page }) => {
    await page.addInitScript(d => { try{ localStorage.setItem("toa-atlas-newbanner", d.slice(0, 7)); }catch(e){} }, NEWEST.date);
    await page.goto("./");
    await waitForApp(page);
    await expect(page.locator("#newBannerText")).toContainText(NEWEST.title);
  });

  test("a shared shortlist link isn't interrupted", async ({ page }) => {
    await page.goto(`./?list=${DATA[0].id}`);
    await waitForApp(page);
    await page.waitForTimeout(400);
    await expect(page.locator("#newBannerText")).not.toContainText(NEWEST.title);
  });
});

test.describe("a first visit", () => {
  test.use({ firstVisit: true, newBanner: true });

  test("gets the tour, not news about what changed", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    await expect(page.locator("#tourCard")).toBeVisible({ timeout: 8000 });
    await expect(page.locator("#newBannerText")).not.toContainText("New:");
  });
});

test.describe("the tour", () => {
  const toStep = async (page, title) => {
    await page.evaluate(() => startTour());
    for(let i = 0; i < 8; i++){
      await expect(page.locator("#tourCard")).toBeVisible();
      if((await page.locator("#tourTitle").textContent()).includes(title)) return;
      const shown = await page.locator("#tourStep").textContent();
      await page.locator("#tourNext").click();
      await expect(page.locator("#tourStep")).not.toHaveText(shown);
    }
    throw new Error(`the tour has no step called ${title}`);
  };

  test("mentions applying, and points the Journey step at the pathways", async ({ page }) => {
    await page.goto("./#journey");
    await waitForApp(page);
    await expect(page.locator(".pw-picks")).toBeVisible();
    await toStep(page, "The Directory");
    await expect(page.locator("#tourText")).toContainText("Open to apply now");
    await expect(page.locator("#tourText")).toContainText("Closing soon");
    await toStep(page, "Founder Journey");
    await expect(page.locator(".pw-picks")).toHaveClass(/\btour-spot\b/);
  });
});

test.describe("the tour without pathways", () => {
  test.use({ expectedHttpErrors: [/\/data\/pathways\.yml/] });

  test("the Journey step points at the stages instead", async ({ page }) => {
    await page.route("**/data/pathways.yml", route => route.fulfill({ status: 404, body: "" }));
    await page.goto("./");
    await waitForApp(page);
    await page.evaluate(() => { tourStep = 2; nextTourStep(); });
    await expect(page.locator("#tourTitle")).toHaveText("Founder Journey");
    await expect(page.locator("#stepper")).toHaveClass(/\btour-spot\b/);
  });
});

test.describe("the updates page on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("fits the screen", async ({ page }) => {
    await openUpdates(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
