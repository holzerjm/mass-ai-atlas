/* Shared shortlists (?list=a,b). Regression guard for d37a30c (2026-09-21):
   updateURL() rebuilt the URL from location.pathname and kept only ?entry=, so a
   shared shortlist lost its list the first time the recipient opened a drawer or
   switched views — and a reload, or passing the link on, showed nothing. */
const { test, expect, DATA, waitForApp } = require("./helpers/atlas");

const [a, b] = [DATA[0], DATA[Math.floor(DATA.length / 2)]];
const listParam = page => new URL(page.url()).searchParams.get("list");

test("?list= restores the shared shortlist, and the list survives opening an entry from it", async ({ page }) => {
  // an unknown id in a shared list is dropped, not fatal
  const shared = `${a.id},no-such-org,${b.id}`;
  await page.goto(`./?list=${shared}`);
  await waitForApp(page);

  const modal = page.locator("#shortlistModal");
  await expect(modal).toBeVisible();
  await expect(page.locator("#slTitle")).toHaveText("A shared shortlist");
  await expect(modal.locator(".sl-row")).toHaveCount(2);
  await expect(modal.locator(".sl-row").nth(0)).toContainText(a.name);
  await expect(modal.locator(".sl-row").nth(1)).toContainText(b.name);

  // open an entry from the shared list
  await modal.locator(".sl-row a", { hasText: a.name }).click();
  await expect(page.locator("#drawer")).toHaveClass(/\bopen\b/);
  await expect(page.locator("#drName")).toHaveText(a.name);
  expect(new URL(page.url()).searchParams.get("entry")).toBe(a.id);
  expect(listParam(page)).toBe(shared);

  // close the drawer and switch views both ways — each rewrites the URL
  await page.locator("#drClose").click();
  await expect(page.locator("#drawer")).not.toHaveClass(/\bopen\b/);
  expect(listParam(page)).toBe(shared);
  await page.locator('.tab[data-view="directory"]').click();
  await expect(page).toHaveURL(/#directory$/);
  expect(listParam(page)).toBe(shared);
  await page.locator('.tab[data-view="map"]').click();
  expect(listParam(page)).toBe(shared);

  // the URL the recipient now holds (or forwards) still restores the list
  await page.reload();
  await expect(page.locator("#shortlistModal")).toBeVisible();
  await expect(page.locator("#shortlistModal .sl-row")).toHaveCount(2);

  // viewing someone's list must not write it into the viewer's own saved stars
  expect(await page.evaluate(() => localStorage.getItem("toa-atlas-stars"))).toBeNull();
});

test("a ?list= of only unknown ids opens nothing and breaks nothing", async ({ page }) => {
  await page.goto("./?list=no-such-org,also-missing");
  await waitForApp(page);
  await page.waitForTimeout(800);   // the shared list opens after 500 ms when valid
  await expect(page.locator("#shortlistModal")).toBeHidden();
});
