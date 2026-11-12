/* The error guard in tests/helpers/atlas.js, which every spec gets. These tests cover its one
   exception: WebKit's wording for a failed fetch from the map's tile host counts as a third-party
   request failure, not an error in the page. See docs/testing.md. */
const { test, expect, isTileFetchError } = require("./helpers/atlas");

const WEBKIT = url => `Fetch API cannot load ${url} due to access control checks.`;
const FONT = "https://tiles.openfreemap.org/fonts/Noto%20Sans%20Italic/0-255.pbf";

test("WebKit's wording for a failed tile-host fetch is tolerated", async ({ page }) => {
  await page.goto("./updates/");
  const seen = page.waitForEvent("pageerror");
  await page.evaluate(m => { setTimeout(() => { throw new TypeError(m); }); }, WEBKIT(FONT));
  expect((await seen).message).toBe(WEBKIT(FONT));
  // The guard runs when the test ends: an error it didn't tolerate would fail the test there.
});

test("the tolerance matches only that wording on that host", () => {
  for (const m of [WEBKIT(FONT), `TypeError: ${WEBKIT(FONT)}`,
                   WEBKIT("https://tiles.openfreemap.org/planet/20261101_001001_pt/14/4955/6060.pbf")])
    expect(isTileFetchError(m), m).toBe(true);
  for (const m of [WEBKIT("https://the-open-accelerator.com/ecosystem/data/entities.yml"),
                   WEBKIT("https://cdn.jsdelivr.net/npm/js-yaml@4.3.2/dist/js-yaml.min.js"),
                   WEBKIT("https://tiles.openfreemap.org.example.com/fonts/x.pbf"),
                   "NetworkError when attempting to fetch resource.",
                   "Load failed",
                   `Error in a handler. ${WEBKIT(FONT)}`,
                   "L is not defined", "", undefined])
    expect(isTileFetchError(m), String(m)).toBe(false);
});
