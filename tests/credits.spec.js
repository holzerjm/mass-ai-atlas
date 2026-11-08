/* /credits/: the credits page. It reads ../data/credits.yml at load, the way
   index.html reads data/*.yml, so these tests read the same file and never need
   updating when someone is credited. */
const { test, expect, ROOT, waitForApp } = require("./helpers/atlas");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const CREDITS = yaml.load(fs.readFileSync(path.join(ROOT, "data", "credits.yml"), "utf8"),
  { schema: yaml.CORE_SCHEMA });
const PEOPLE = CREDITS.mapmakers;

test("the credits page shows one card per mapmaker in data/credits.yml", async ({ page }) => {
  await page.goto("./credits/");
  await expect(page.locator("#cards .card")).toHaveCount(PEOPLE.length);
  await expect(page.locator("#mmCount")).toHaveText(String(PEOPLE.length));
  for (const m of PEOPLE) {
    const card = page.locator(`#cards .card[data-github="${m.github}"]`);
    await expect(card.locator("a.handle")).toHaveAttribute("href", `https://github.com/${m.github}`);
    await expect(card.locator(".story")).toHaveText(m.story);
  }
});

test("the credits timeline shows every milestone, oldest first", async ({ page }) => {
  await page.goto("./credits/");
  await expect(page.locator("#timeline li")).toHaveCount(CREDITS.milestones.length);
  const dates = await page.locator("#timeline time").evaluateAll(ts => ts.map(t => t.getAttribute("datetime")));
  expect(dates).toEqual(CREDITS.milestones.map(m => m.date).sort());
});

test("a kind filter on the credits page shows only that kind, and All brings everyone back", async ({ page }) => {
  // pick a kind that some but not all mapmakers share, so the filter has to hide someone
  const counts = {};
  PEOPLE.forEach(m => m.kinds.forEach(k => counts[k] = (counts[k] || 0) + 1));
  const kind = Object.keys(counts).find(k => counts[k] < PEOPLE.length);
  test.skip(!kind, "every mapmaker shares every kind, so there is nothing to filter out");

  await page.goto("./credits/");
  await expect(page.locator("#cards .card")).toHaveCount(PEOPLE.length);
  await page.locator(`#filters .chip[data-kind="${kind}"]`).click();
  await expect(page.locator(`#filters .chip[data-kind="${kind}"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#cards .card:visible")).toHaveCount(counts[kind]);
  await expect(page.locator("#showing")).toContainText(`Showing ${counts[kind]} of ${PEOPLE.length}`);
  await page.locator('#filters .chip[data-kind="all"]').click();
  await expect(page.locator("#cards .card:visible")).toHaveCount(PEOPLE.length);
});

test("nobody on the credits page gets a photo, a real name, or a LinkedIn link without consent", async ({ page }) => {
  // `photo: true`, `name`, and `linkedin` are opt-in in data/credits.yml. Without them a
  // card shows initials and the public GitHub handle, and nothing else about the person.
  await page.goto("./credits/");
  await expect(page.locator("#cards .card")).toHaveCount(PEOPLE.length);
  await expect(page.locator("body")).toContainText("A real name, photo, or LinkedIn link appears only with that person's consent");
  for (const m of PEOPLE) {
    const card = page.locator(`#cards .card[data-github="${m.github}"]`);
    await expect(card.locator("img")).toHaveCount(m.photo ? 1 : 0);
    await expect(card.locator(".name")).toHaveCount(m.name ? 1 : 0);
    const linkedin = card.locator('a[href*="linkedin.com"]');
    await expect(linkedin).toHaveCount(m.linkedin ? 1 : 0);
    if (m.linkedin) {
      await expect(linkedin).toHaveAttribute("href", m.linkedin);
      await expect(linkedin).toHaveText("LinkedIn");
    }
  }
});

test("the atlas and events footers link to the credits page", async ({ page, baseURL }) => {
  // The events page copies the atlas footer, one folder down, so its link is
  // rewritten by scripts/build-events-page.js. Both must land on the same page.
  const want = new URL("credits/", baseURL).href;
  await page.goto("./");
  await waitForApp(page);
  expect(await page.locator("footer.footer a", { hasText: "mapmakers" }).evaluate(a => a.href)).toBe(want);
  await page.goto("./events/");
  expect(await page.locator("footer.footer a", { hasText: "mapmakers" }).evaluate(a => a.href)).toBe(want);
});
