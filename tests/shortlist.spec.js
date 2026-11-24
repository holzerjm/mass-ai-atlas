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

// The shortlist prints with a box to tick beside each organization. With an entry's first move
// under its name, the printed page says what to do at each one, not only where it is.
test("a shortlist row carries the entry's first move, and nothing where the entry has none", async ({ page }) => {
  await page.goto(`./?list=${a.id},${b.id}`);
  await waitForApp(page);
  await expect(page.locator("#shortlistModal")).toBeVisible();
  await page.evaluate(([a, b]) => {
    byId[a].firstMove = "Register for the next open night & bring a demo."; delete byId[b].firstMove;
    renderShortlist([a, b]);
  }, [a.id, b.id]);
  const rows = page.locator("#shortlistModal .sl-row");
  await expect(rows.nth(0).locator(".sl-move")).toHaveText("First move: Register for the next open night & bring a demo.");
  await expect(rows.nth(1).locator(".sl-move")).toHaveCount(0);
  await page.emulateMedia({ media: "print" });
  await expect(rows.nth(0).locator(".sl-move")).toBeVisible();
});

// A row says whether the organization is taking applications, in the words its pathway card
// uses, so a saved list shows what is open and what closes when.
test("a shortlist row says whether applications are open, and nothing where the atlas doesn't know", async ({ page }) => {
  await page.goto(`./?list=${a.id},${b.id}`);
  await waitForApp(page);
  await expect(page.locator("#shortlistModal")).toBeVisible();
  await page.evaluate(([a, b]) => {
    for(const id of [a, b]){ for(const k of ["applyBy", "applyNote", "applyUrl"]) delete byId[id][k]; }
    byId[a].applyBy = "rolling"; byId[a].applyNote = "Reviewed monthly";
    renderShortlist([a, b]);
  }, [a.id, b.id]);
  const rows = page.locator("#shortlistModal .sl-row");
  await expect(rows.nth(0).locator(".sl-status")).toHaveText("⏳ Open · Reviewed monthly");
  await expect(rows.nth(1).locator(".sl-status")).toHaveCount(0);
});

// An organization that closes leaves the atlas, and a visitor may have starred it. The header's
// count, the list and the link to share must agree on what is left.
test("a starred entry that has left the atlas isn't counted, listed, or shared", async ({ page }) => {
  await page.addInitScript(ids => localStorage.setItem("toa-atlas-stars", JSON.stringify(ids)), [a.id, "left-the-atlas"]);
  await page.goto("./#directory");
  await waitForApp(page);
  await expect(page.locator("#starNav")).toBeVisible();
  await expect(page.locator("#starCount")).toHaveText("1");
  await page.evaluate(() => openShortlist());
  await expect(page.locator("#shortlistModal .sl-row")).toHaveCount(1);
  expect(await page.evaluate(() => shortlistIds())).toEqual([a.id]);

  // starring and unstarring others keeps the old star stored, in case the entry comes back
  await page.evaluate(id => toggleStar(id), b.id);
  await expect(page.locator("#starCount")).toHaveText("2");
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem("toa-atlas-stars"))).sort()).toEqual([a.id, b.id, "left-the-atlas"].sort());

  // and with nothing else starred, the header shows no star at all
  await page.evaluate(ids => ids.forEach(id => toggleStar(id)), [a.id, b.id]);
  await expect(page.locator("#starNav")).toBeHidden();
});

test("a ?list= of only unknown ids opens nothing and breaks nothing", async ({ page }) => {
  await page.goto("./?list=no-such-org,also-missing");
  await waitForApp(page);
  await page.waitForTimeout(800);   // the shared list opens after 500 ms when valid
  await expect(page.locator("#shortlistModal")).toBeHidden();
});
