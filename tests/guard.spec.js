/* The error guard in tests/helpers/atlas.js, which every spec gets. These tests cover its one
   exception: WebKit's wording for a failed fetch from the map's tile host counts as a third-party
   request failure, not an error in the page. See docs/testing.md. */
const { test, expect, isTileFetchError, isTileFetchPageError } = require("./helpers/atlas");

const WEBKIT = url => `Fetch API cannot load ${url} due to access control checks.`;
const FONT = "https://tiles.openfreemap.org/fonts/Noto%20Sans%20Italic/0-255.pbf";
const FRAMES = "\n    at unknown (https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.min.js:5:10743)" +
               "\n    at Promise (:1:11)";
// The error as it reached the guard on 2026-11-15: Playwright cuts WebKit's console text at the
// first colon, the one in "https:", so only the stack's first line holds the whole text.
const asPlaywrightBuildsIt = url => {
  const text = WEBKIT(url), cut = text.indexOf(":");
  return { name: text.slice(0, cut), message: text.slice(cut + 2), stack: text + FRAMES };
};

test("WebKit's wording for a failed tile-host fetch is tolerated", async ({ page }) => {
  await page.goto("./updates/");
  const seen = page.waitForEvent("pageerror");
  await page.evaluate(m => { setTimeout(() => { throw new TypeError(m); }); }, WEBKIT(FONT));
  expect((await seen).message).toBe(WEBKIT(FONT));
  // The guard runs when the test ends: an error it didn't tolerate would fail the test there.
});

test("a tile-host request that fails is tolerated, however the engine reports it", async ({ page, browserName }, testInfo) => {
  const url = "https://tiles.openfreemap.org/fonts/guard-test/0-255.pbf";
  await page.route(url, route => route.abort());
  await page.goto("./updates/");
  const failed = page.waitForEvent("requestfailed", req => req.url() === url);
  // Chromium reports a failed request and nothing more. WebKit can also raise it as an error in
  // the page, in its own words, and that is the case the guard has to let through. Whether it
  // does so for a request aborted here isn't certain, so the test notes it instead of requiring it.
  const raised = browserName === "webkit" ? page.waitForEvent("pageerror", { timeout: 3000 }).catch(() => null) : null;
  await page.evaluate(u => fetch(u).catch(() => {}), url);
  await failed;
  const error = await raised;
  if (browserName === "webkit")
    testInfo.annotations.push({ type: "WebKit raised the failed fetch as a page error", description: error ? String(error.stack).split("\n")[0] : "no" });
});

test("the error is recognized in the shape Playwright gives it", () => {
  const real = asPlaywrightBuildsIt(FONT);
  expect(real.name).toBe("Fetch API cannot load https");
  expect(isTileFetchError(real.message), "its message alone doesn't match, which is why the stack is read").toBe(false);
  expect(isTileFetchPageError(real)).toBe(true);
  expect(isTileFetchPageError(new TypeError(WEBKIT(FONT))), "an error a page throws").toBe(true);
  for (const err of [asPlaywrightBuildsIt("https://the-open-accelerator.com/ecosystem/data/entities.yml"),
                     asPlaywrightBuildsIt("https://tiles.openfreemap.org.example.com/fonts/x.pbf"),
                     { name: "TypeError", message: "L is not defined", stack: "TypeError: L is not defined\n    at " + FONT + ":1:1" },
                     { name: "Error", message: "boom", stack: "Error: boom\n" + WEBKIT(FONT) },
                     new Error("Load failed"), {}, null, undefined])
    expect(isTileFetchPageError(err), JSON.stringify(err)).toBe(false);
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
