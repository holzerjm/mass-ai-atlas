/* Search, in the founder's words (see docs/testing.md). The three search boxes share one word-by-
   word search. Until 2026-11 each looked for the whole query as one exact string, so a sentence
   found nothing and the atlas's own spelling decided what a founder could find. */
const { test, expect, DATA, byId, waitForApp } = require("./helpers/atlas");

const shownIds = page => page.locator("#cards .card .card-open").evaluateAll(els => els.map(el => el.textContent));
// The box waits 220 ms after the last keystroke, so go by the count: empty the box, then search.
async function search(page, text){
  const all = `${DATA.length} of ${DATA.length} organizations`, count = page.locator("#dirCount");
  await page.locator("#dirSearch").fill("");
  await expect(count).toHaveText(all);
  await page.locator("#dirSearch").fill(text);
  await expect(count).not.toHaveText(all);
}
test.beforeEach(async ({ page }) => {
  await page.goto("./#directory");
  await waitForApp(page);
});

// Hyphens, plurals and a different form of a word found different entries, or none.
test("the Directory's search ignores hyphens and plurals, and knows founders' words", async ({ page }) => {
  await search(page, "wet lab");
  expect(await shownIds(page)).toContain(byId.labcentral.name);   // its entry says "wet-lab"
  await search(page, "women");
  expect(await shownIds(page)).toContain(byId.january.name);      // its entry says "Woman-led"
  await search(page, "accelerators");
  expect(await shownIds(page)).toContain(byId.masschallenge.name);
});

// "grant" missed 8 of the 17 entries that offer grants, MassChallenge among them, because the
// search never read `offers`.
test("searching for a need finds every entry that offers it", async ({ page }) => {
  for(const [word, offer] of [["grant", "grants"], ["gpu", "compute"], ["pilot", "customers"], ["mentor", "mentorship"]]){
    await search(page, word);
    const names = await shownIds(page);
    for(const d of DATA.filter(d => d.offers.includes(offer))) expect(names, `"${word}" finds ${d.name}`).toContain(d.name);
  }
});

test("several words must all match, wherever each one is", async ({ page }) => {
  await search(page, "robotics Seaport");
  const names = await shownIds(page);
  expect(names).toContain(byId.massrobotics.name);
  expect(names).not.toContain(byId.bdyn.name);   // robotics, but in Waltham
  await expect(page.locator("#dirCount")).not.toContainText("closest");
});

// One or two letters match a whole word only, or "ai" would find "air" and "vc" anything.
test("a word matches at the start of a word, and a short word only as a whole word", async ({ page }) => {
  await search(page, "robot");
  expect(await shownIds(page)).toContain(byId.massrobotics.name);
  await search(page, "bu");
  const names = await shownIds(page);
  expect(names).toContain(byId.buai.name);
  expect(names).not.toContain(byId.bdyn.name);   // Boston Dynamics: "built" and "business" don't count
});

// Every full sentence used to return nothing. Now the closest entries come back best first, the
// page says none matched every word, and each card shows what it matched on.
test("a founder's sentence finds the closest entries, and says that is what they are", async ({ page }) => {
  await search(page, "Six of us, seed-stage robotics. What we actually need is GPU time and a lab bench we can leave hardware on overnight.");
  await expect(page.locator("#dirCount")).toContainText("none match every word, closest first");
  expect(await shownIds(page)).toContain(byId.massrobotics.name);
  await expect(page.locator("#dirSort option").first()).toHaveText("Sort: Best match");
  await expect(page.locator("#cards .card .match-tag").first()).toBeVisible();
  await page.locator("#dirSearch").fill("");
  await expect(page.locator("#dirCount")).toHaveText(`${DATA.length} of ${DATA.length} organizations`);
  await expect(page.locator("#dirSort option").first()).toHaveText("Sort: A → Z");
  await expect(page.locator("#cards .card .match-tag")).toHaveCount(0);
});

test("a word nothing matches finds nothing, and clearing brings everything back", async ({ page }) => {
  await search(page, "zzzzzz");
  await expect(page.locator("#dirCount")).toHaveText(`0 of ${DATA.length} organizations`);
  await page.locator(".dir-count-row .filter-clear").click();
  await expect(page.locator("#dirSearch")).toHaveValue("");
  await expect(page.locator("#cards .card")).toHaveCount(DATA.length);
  await expect(page.locator(".dir-count-row .filter-clear")).toBeHidden();
});

test("the map's and the galaxy's searches use the same words", async ({ page }) => {
  await page.locator('.tab[data-view="map"]').click();
  await page.locator("#mapSearch").fill("wet lab");
  await expect(page.locator(`#mapResults [data-id="labcentral"]`)).toBeVisible();
  await page.locator('.tab[data-view="galaxy"]').click();
  await page.locator("#gxSearch").fill("wet lab");
  await expect(page.locator(`#gxResults [data-id="labcentral"]`)).toBeVisible();
});

// What someone types must never reach the address: a link, a server log or an analytics beacon
// should not carry a founder's own sentence.
test("what someone types stays out of the address", async ({ page }) => {
  await search(page, "our secret idea for radiology");
  await page.locator("#needChips .need-chip").first().click();
  await expect(page).toHaveURL(/need=/);
  expect(page.url()).not.toContain("radiology");
  expect(page.url()).not.toContain("secret");
});
