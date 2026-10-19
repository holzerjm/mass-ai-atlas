/* v2.0 Part A cross-stream contracts (co-located pins, affiliation labels).
   Written against the contract text, not the implementation, so they hold
   whatever markup the map/drawer code chooses. See docs/testing.md. */
const { test, expect, DATA, byId, AFFILIATION_LABELS, metersBetween, waitForApp } = require("./helpers/atlas");

// ---- contract 3: co-located pins --------------------------------------------
// Pins at the same spot can't all be clicked at street zoom (clustering is off
// at z15 and spiderfy is off), so each such marker's popup must list the others
// in a .pop-colocated element. Exact-coordinate groups are computed from DATA
// (9 pairs as of 2026-09-30), and so are near pairs up to the contract radius
// of 25 m (9 more). This is the same haversine (R = 6371000 m) as index.html's
// COLOCATED_M grouping, so both sides agree on which pairs count; in this data
// the closest pair outside 25 m is 27.7 m apart. (An earlier 20 m cutoff left
// mit-ibm/mit-sandbox, material/startupboston and pydata/mit-sandbox, 22–25 m
// apart, unguarded.)
const NEAR_M = 25;
const exactGroups = Object.values(DATA.reduce((g, d) => {
  (g[`${d.lat},${d.lng}`] = g[`${d.lat},${d.lng}`] || []).push(d);
  return g;
}, {})).filter(g => g.length > 1);
const nearPairs = [];
for(let i = 0; i < DATA.length; i++) for(let j = i + 1; j < DATA.length; j++){
  const m = metersBetween(DATA[i], DATA[j]);
  if(m > 0 && m <= NEAR_M) nearPairs.push([DATA[i], DATA[j]]);
}

// Opens entry `id`'s popup through the public contract (markers[id].openPopup())
// and returns the .pop-colocated text ("" when there is none, null when the
// popup did not open). Un-grouping the pins first puts every marker on the map;
// inside a cluster a marker has no map yet and openPopup() is a no-op. The text
// is read from this marker's own popup element: a closed popup lingers in the
// DOM for its 200 ms fade, so a document-wide query can read the previous one.
// autoPan is off only while the test opens it: each pan re-renders the WebGL
// basemap, and dozens of them in a row stalled busy machines for 10 s+.
async function colocatedText(page, id){
  return page.evaluate(id => {
    if(typeof setClustered === "function") setClustered(false);
    const m = markers[id];
    const pop = m.getPopup(), autoPan = pop.options.autoPan;
    pop.options.autoPan = false;
    m.openPopup();
    pop.options.autoPan = autoPan;
    const el = m.isPopupOpen() && pop.getElement();
    if(!el) return null;
    const co = el.querySelector(".pop-colocated");
    return co ? co.textContent : "";
  }, id);
}

test.describe("contract 3 — co-located pins", () => {
  test("markers stay one per entry, at the entry's exact coordinates (never jittered)", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    const moved = await page.evaluate(() => DATA.filter(d => {
      const ll = markers[d.id] && markers[d.id].getLatLng();
      return !ll || ll.lat !== d.lat || ll.lng !== d.lng;
    }).map(d => d.id));
    expect(moved).toEqual([]);
  });

  test("the data still has co-located pins to guard", () => {
    // if this fails, every shared spot was resolved in data.js and the tests
    // below guard nothing: rethink them (e.g. test a page fixture) rather than
    // let them pass vacuously
    expect(exactGroups.length + nearPairs.length).toBeGreaterThan(0);
  });

  test("every exact-coordinate pin's popup lists the others at that spot", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    const missing = [];
    for(const group of exactGroups){
      for(const d of group){
        const text = await colocatedText(page, d.id);
        for(const other of group.filter(o => o !== d)){
          if(text === null) missing.push(`${d.id}: popup did not open`);
          else if(!text.includes(other.name)) missing.push(`${d.id}: .pop-colocated does not list "${other.name}"`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test(`pins within ${NEAR_M} m list each other`, async ({ page }) => {
    test.skip(!nearPairs.length, "no near pairs in the data");
    await page.goto("./");
    await waitForApp(page);
    const missing = [];
    for(const [x, y] of nearPairs){
      for(const [d, other] of [[x, y], [y, x]]){
        const text = await colocatedText(page, d.id);
        if(!text || !text.includes(other.name)) missing.push(`${d.id} → "${other.name}" (${metersBetween(d, other).toFixed(1)} m)`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("each name in .pop-colocated opens that organization's drawer", async ({ page }) => {
    const [d, other] = exactGroups[0] || nearPairs[0] || [];
    test.skip(!d, "no co-located pins in the data");
    await page.goto("./");
    await waitForApp(page);
    await colocatedText(page, d.id);
    const list = page.locator(".leaflet-popup-content .pop-colocated");
    await expect(list).toBeVisible();
    await list.getByText(other.name, { exact: true }).click();
    await expect(page.locator("#drawer")).toHaveClass(/\bopen\b/);
    await expect(page.locator("#drName")).toHaveText(other.name);
  });
});

// ---- contract 1: affiliation labels -----------------------------------------
const affiliated = DATA.filter(d => d.affiliation);
const LABELS = Object.values(AFFILIATION_LABELS);

test.describe("contract 1 — affiliation labels", () => {
  test("data.js carries affiliation fields, all from the contract vocabulary", () => {
    // TOA publishes the atlas, so at least its own entry is always affiliated;
    // an empty list means the field was lost, not that there is nothing to label
    expect(affiliated.length).toBeGreaterThan(0);
    const bad = affiliated.filter(d => !(d.affiliation in AFFILIATION_LABELS)).map(d => `${d.id}: ${d.affiliation}`);
    expect(bad).toEqual([]);
  });

  test("an affiliated entry's drawer shows its label; unaffiliated drawers show none", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    const drawers = await page.evaluate(() => DATA.map(d => {
      openDrawer(d.id);
      return [d.id, document.getElementById("drawer").textContent];
    }));
    const problems = [];
    for(const [id, text] of drawers){
      const want = byId[id].affiliation ? AFFILIATION_LABELS[byId[id].affiliation] : null;
      if(want && !text.includes(want)) problems.push(`${id}: missing "${want}"`);
      // neutrality: an entry with no affiliation wears no label. (Affiliated
      // drawers may explain their label in other words, so they are not checked
      // for the other labels.)
      if(!want) for(const label of LABELS){
        if(text.includes(label)) problems.push(`${id}: shows "${label}" but has no affiliation`);
      }
    }
    expect(problems).toEqual([]);
  });
});
