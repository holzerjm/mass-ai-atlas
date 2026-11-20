/* 3D Lenses (atlas3d.html): its own page beside the atlas, linked from the corner of its map.
   The page loads, puts every entry on the map, and an entry's card says how sure the atlas
   is and links each doubt to the line of data behind it. See docs/testing.md. */
const fs = require("fs");
const path = require("path");
const { test, expect, ROOT, DATA, byId, eventsFixture, waitForApp } = require("./helpers/atlas");

// the page sets this once the map style has loaded and its layers are drawn
const ready = page => page.waitForFunction(() => window.__atlas3d && window.__atlas3d.ready, null, { timeout: 30_000 });

// Where each entry's block starts and ends in data/entities.yml, counted the way GitHub
// numbers the lines its source links point at.
const YAML_LINES = fs.readFileSync(path.join(ROOT, "data", "entities.yml"), "utf8").split("\n");
function blockOf(id){
  const at = YAML_LINES.findIndex(l => new RegExp(`^\\s*-\\s+id:\\s*["']?${id}["']?\\s*$`).test(l));
  const next = YAML_LINES.findIndex((l, i) => i > at && /^\s*-\s+id:/.test(l));
  return { first: at + 1, last: next === -1 ? YAML_LINES.length : next };
}

test("3D Lenses loads and puts every entry on the map", async ({ page }) => {
  await page.goto("./atlas3d.html");
  await ready(page);
  // each entry is its own pin or sits in exactly one group, so together they are every entry
  const drawn = await page.evaluate(() => window.__atlas3d.drawn());
  expect(drawn.pins + drawn.grouped).toBe(DATA.length);
  // the legend's confidence rows count every entry once
  const counts = await page.locator("#legend [data-tier] .count").allTextContents();
  expect(counts.reduce((a, c) => a + Number(c), 0)).toBe(DATA.length);
});

test("an entry's card describes the atlas's record and links each signal to its line of data", async ({ page }) => {
  const d = byId.csail || DATA[0];
  await page.goto(`./atlas3d.html?entry=${d.id}`);
  await ready(page);
  const card = page.locator("#card");
  await expect(card).toHaveClass(/open/);
  await expect(card.locator("h3")).toHaveText(d.name);
  await expect(card).toContainText("Atlas confidence:");
  // the score describes the atlas, never the organization (review of #79)
  await expect(page.locator("body")).not.toContainText(/credibility/i);

  const { first, last } = blockOf(d.id);
  const sources = await card.locator(".sig a.src").evaluateAll(as => as.map(a => a.href));
  const dataLinks = sources.filter(h => h.includes("/data/entities.yml"));
  expect(dataLinks.length).toBeGreaterThan(0);
  for(const href of dataLinks){
    const line = Number((href.match(/#L(\d+)$/) || [])[1]);
    expect(line, `${href} should point inside ${d.id}'s block, lines ${first}–${last}`).toBeGreaterThanOrEqual(first);
    expect(line, `${href} should point inside ${d.id}'s block, lines ${first}–${last}`).toBeLessThanOrEqual(last);
  }
});

test("an event the feed says an entry hosts shows on its card as a fact, not a guess", async ({ page }) => {
  const host = DATA[0];   // eventsFixture() makes DATA[0] the host of its first event
  await page.goto(`./atlas3d.html?entry=${host.id}`);
  await ready(page);
  const card = page.locator("#card");
  await expect(card).toContainText("Hosting events this month");
  await expect(card).not.toContainText("(inferred)");
  await expect(card).toContainText(eventsFixture().events[0].title);
});

// An event that only names an entry is a guess. The card shows it and says so, and it adds
// nothing to the score: until 2026-11 a name match added up to 10 points, as a hosted event does.
test("an event that only names an entry shows as a guess and adds no points", async ({ page }) => {
  const named = byId.csail || DATA.find(d => d.id !== DATA[0].id && d.name.length >= 8);
  const now = Date.now(), h = 3600e3;
  await page.route("**/events.json*", route => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ schema: 1, generated: new Date(now - 2*h).toISOString(), window_days: 10, events: [
      { title: `Test fixture: an evening at ${named.name}`, start: new Date(now + 26*h).toISOString(),
        end: new Date(now + 28*h).toISOString(), url: "https://example.com/fixture-3",
        venue: "Boston, MA", organizer: "Fixture Meetup", source: "fixture" }] }) }));
  await page.goto(`./atlas3d.html?entry=${named.id}`);
  await ready(page);
  const row = page.locator("#card li", { hasText: "(inferred)" });
  await expect(row).toContainText("a name match, not a confirmation");
  await expect(row.locator(".pts")).toHaveText("—");
  await expect(page.locator("#card")).not.toContainText("Hosting events this month");
});

// The stats count what the map fades and what a card calls "Not re-checked for months": entries
// whose last check is four or more months old. Until 2026-11 the row was fixed to June 2026.
test("the stats count entries not re-checked for four months or more, by age", async ({ page }) => {
  await page.goto("./atlas3d.html");
  await ready(page);
  const months = ym => { const [y, m] = ym.split("-").map(Number), t = new Date(); return (t.getFullYear() - y) * 12 + (t.getMonth() + 1 - m); };
  const expected = DATA.filter(d => !d.lastVerified || months(d.lastVerified) >= 4).length;
  const shown = await page.evaluate(() => {
    const label = [...document.querySelectorAll("#stats span")].find(s => s.textContent.startsWith("Not re-checked for 4 months or more"));
    return label ? label.nextElementSibling.textContent : null;
  });
  expect(shown, "the row is missing").not.toBeNull();
  expect(Number(shown)).toBe(expected);
  await expect(page.locator("#stats")).not.toContainText("June");
});

// The atlas's map links here from its bottom-left corner. It floats over the map rather than
// joining the nav, whose one row is full at laptop widths; on a phone the map attribution wraps
// across the bottom edge, so the link must clear it there.
for(const [width, height] of [[1366, 650], [390, 844]]){
  test(`the atlas map's link to 3D Lenses is clickable at ${width} × ${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("./");
    await waitForApp(page);
    const link = page.locator("#view-map .map-3d");
    await expect(link).toHaveAttribute("href", "atlas3d.html");
    await link.scrollIntoViewIfNeeded();
    const onTop = await link.evaluate(a => {
      const r = a.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return a === top || a.contains(top);
    });
    expect(onTop, "something covers the link to 3D Lenses").toBe(true);
  });
}

test("an unknown ?entry= id leaves the map as it was", async ({ page }) => {
  await page.goto("./atlas3d.html?entry=no-such-entry");
  await ready(page);
  await expect(page.locator("#card")).not.toHaveClass(/open/);
});
