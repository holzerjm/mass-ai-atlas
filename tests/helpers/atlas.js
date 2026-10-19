/* Shared test plumbing for the atlas smoke suite (see docs/testing.md).
   Every spec imports `test`/`expect` from here instead of @playwright/test, so
   each test gets the same error guard and the same deterministic events feed. */
const fs = require("fs");
const path = require("path");
const base = require("@playwright/test");

// Same tree the web server serves (playwright.config.js) — the baseline run
// must read the baseline's data, not the working tree's.
const ROOT = path.resolve(process.env.ATLAS_ROOT || path.join(__dirname, "..", ".."));

// The dataset the way scripts/load-data.js reads it — the same shared loader the
// page itself uses — but rooted at ROOT rather than this file, so ATLAS_ROOT still
// selects the tree under test. Throws on a schema error, which is what we want: a
// suite running against invalid data would report confusing failures instead.
const yaml = require("js-yaml");
const Ajv = require("ajv");
function loadAtlas(){
  const { FILES, loadAtlas: load } = require(path.join(ROOT, "atlas-data.js"));
  const dir = path.join(ROOT, "data");
  const texts = Object.fromEntries(
    FILES.map(f => [f, fs.readFileSync(path.join(dir, f), "utf8")]));
  return load(texts, yaml, Ajv);
}
const ATLAS = loadAtlas();
const { DATA } = ATLAS;
const byId = Object.fromEntries(DATA.map(d => [d.id, d]));

// Contract 1 (Part A brief): affiliation value → the label the drawer shows.
const AFFILIATION_LABELS = {
  "publisher": "Atlas publisher",
  "sponsor": "Atlas sponsor",
  "sponsor-affiliated": "Sponsor-affiliated",
};

function metersBetween(a, b){
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// events.json is produced weekly by the events pipeline and is not in git, so
// CI never has one and a local checkout has a stale one. Tests get a fixed feed
// dated relative to now: one event hosted by a real atlas entry (exercises the
// "→ on the atlas" link and the drawer's event ribbon), one with no host.
function eventsFixture(){
  const now = Date.now(), h = 3600e3;
  const host = DATA[0];
  return {
    schema: 1,
    generated: new Date(now - 2*h).toISOString(),
    window_days: 10,
    events: [
      { title: "Test fixture: founder office hours", start: new Date(now + 26*h).toISOString(),
        end: new Date(now + 28*h).toISOString(), url: "https://example.com/fixture-1",
        venue: "Cambridge, MA", organizer: host.name, source: "fixture", atlasId: host.id },
      { title: "Test fixture: AI meetup", start: new Date(now + 50*h).toISOString(),
        end: new Date(now + 52*h).toISOString(), url: "https://example.com/fixture-2",
        venue: "Boston, MA", organizer: "Fixture Meetup", source: "fixture" },
    ],
  };
}

const test = base.test.extend({
  // true = behave like a first-time visitor (the guided tour auto-starts on a
  // plain URL). Off by default: the tour switches views and covers the page
  // 1.4 s after load, which would race every other assertion.
  firstVisit: [false, { option: true }],
  // "fixture" | "missing" — what the page gets when it asks for events.json.
  eventsFeed: ["fixture", { option: true }],
  // Same-origin URLs a test deliberately makes fail (regexes).
  expectedHttpErrors: [[], { option: true }],

  page: async ({ page, firstVisit, eventsFeed, expectedHttpErrors, baseURL }, use, testInfo) => {
    if(!firstVisit){
      await page.addInitScript(() => { try{ localStorage.setItem("toa-atlas-tour", "done"); }catch(e){} });
    }
    await page.route("**/events.json*", route => eventsFeed === "missing"
      ? route.fulfill({ status: 404, contentType: "text/plain", body: "File not found" })
      : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(eventsFixture()) }));

    // The error guard. Uncaught exceptions always fail the test. So does any
    // failed same-origin request: those are files this repo ships (data/*.yml,
    // map-style-dark.json, events/), so a 404 is our bug. Third-party failures
    // (map tiles, fonts, the hot-linked TOA logo and favicon) are recorded on the
    // report but do not fail: they are outside this repo, CI's network makes them
    // flaky, and if a CDN *script* the app needs (Leaflet, MapLibre) fails, the
    // app throws "L is not defined" and the pageerror rule catches it anyway.
    const origin = new URL(baseURL).origin;
    const pageErrors = [], ownFailures = [], thirdParty = [];
    const expected = url => expectedHttpErrors.some(re => re.test(url));
    page.on("pageerror", err => pageErrors.push(String(err && err.stack || err)));
    page.on("response", res => {
      if(res.status() < 400) return;
      const line = `${res.status()} ${res.url()}`;
      if(res.url().startsWith(origin)) { if(!expected(res.url())) ownFailures.push(line); }
      else thirdParty.push(line);
    });
    page.on("requestfailed", req => {
      const why = (req.failure() || {}).errorText || "failed";
      // navigation away from a page cancels its in-flight requests; not a fault
      if(/ERR_ABORTED|NS_BINDING_ABORTED/.test(why)) return;
      const line = `${why} ${req.url()}`;
      if(req.url().startsWith(origin)) { if(!expected(req.url())) ownFailures.push(line); }
      else thirdParty.push(line);
    });

    await use(page);

    for(const t of thirdParty.slice(0, 20)){
      testInfo.annotations.push({ type: "third-party request failed (tolerated)", description: t });
    }
    base.expect(pageErrors, "uncaught errors in the page").toEqual([]);
    base.expect(ownFailures, "failed requests for files this repo ships").toEqual([]);
  },
});

// The app is ready once its synchronous init has run: stats rendered from DATA
// and one Leaflet marker per entry.
async function waitForApp(page){
  await base.expect(page.locator("#stats .stat").first()).toBeVisible();
  await page.waitForFunction(n => typeof markers === "object" && Object.keys(markers).length === n, DATA.length);
}

module.exports = { test, expect: base.expect, ROOT, ATLAS, DATA, byId, AFFILIATION_LABELS, metersBetween, eventsFixture, waitForApp };
