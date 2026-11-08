// @ts-check
/* Playwright smoke suite for the atlas — see docs/testing.md.
   The page is served exactly the way it ships: a static directory at a
   directory URL (index.html fetches data/*.yml relatively, so /ecosystem/ works and
   /ecosystem does not). No build step is involved, and none may be added. */
const path = require("path");
const { defineConfig, devices } = require("@playwright/test");

const PORT = Number(process.env.ATLAS_PORT || 8101);
// ATLAS_ROOT serves a different tree with the same tests, e.g. a pristine
// `git archive HEAD` export, to tell "the suite is broken" apart from "the
// change under test is broken".
const ROOT = path.resolve(process.env.ATLAS_ROOT || __dirname);
const CI = !!process.env.CI;

module.exports = defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: CI,
  // Retries only in CI, where the page's CDN scripts (Leaflet, MapLibre) and
  // map tiles come over a shared runner network. Locally a flaky
  // test should be seen, not retried away.
  retries: CI ? 2 : 0,
  // Every page renders a WebGL basemap and animates the Galaxy canvas. At the
  // default of half the CPU cores (8 on a 16-core laptop) the browsers starved
  // each other for 10–20 s at a time (2026-09-30); 4 keeps a full run ~20 s.
  workers: CI ? 2 : 4,
  reporter: CI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // A small Node static server (tests/server.js) with a long accept queue. Until
    // 2026-11 this was `python3 -m http.server` with a queue raised to 128, because its
    // default of 5 overflowed on macOS when parallel browsers each fetched every
    // data/*.yml at once: Chrome got ERR_CONNECTION_RESET and the page said "the atlas
    // data failed to load" (2026-11-01). Node keeps CI free of Python, so the tests can
    // run in Playwright's own image. ROOT goes in as an argument, quoted for spaces.
    command: `node "${path.join(__dirname, "tests", "server.js")}" ${PORT} "${ROOT}"`,
    url: `http://127.0.0.1:${PORT}/`,
    // Never silently reuse: a leftover server on this port could be serving a
    // different tree (another checkout, or the baseline export).
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: "ignore",
    stderr: "ignore",
  },
});
