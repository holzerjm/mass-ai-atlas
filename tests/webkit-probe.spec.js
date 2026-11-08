/* TEMPORARY, for PR #151 only: prints layout facts from WebKit's run. Remove before merging. */
const { test, waitForApp } = require("./helpers/atlas");
const PHONE = { isMobile: true, hasTouch: true };

const facts = () => {
  const r = el => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
  return {
    inner: [innerWidth, innerHeight], client: [document.documentElement.clientWidth, document.documentElement.clientHeight],
    vv: [visualViewport.width, visualViewport.height, visualViewport.scale, visualViewport.offsetLeft, visualViewport.offsetTop],
    scrollW: [document.documentElement.scrollWidth, document.body.scrollWidth], scrollY,
    coarse: matchMedia("(pointer: coarse)").matches, hoverNone: matchMedia("(hover: none)").matches,
    phoneCss: matchMedia("(max-width:720px), (pointer:coarse)").matches,
    map: r(map.getContainer()), mapSize: [map.getSize().x, map.getSize().y], nav: document.querySelector(".nav").offsetHeight,
  };
};

for (const [w, h] of [[844, 390], [375, 667]]) {
  test.describe(`probe ${w} x ${h}`, () => {
    test.use({ viewport: { width: w, height: h }, ...PHONE });
    test("layout facts", async ({ page, browserName }) => {
      test.skip(browserName !== "webkit", "WebKit only");
      await page.goto("./");
      await waitForApp(page);
      const before = await page.evaluate(facts);
      const one = await page.evaluate(() => {
        const r = el => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
        const at = (x, y) => { const el = document.elementFromPoint(x, y); return el ? String(el.className || el.tagName).slice(0, 40) : null; };
        setClustered(false);
        const pan = map.panBy, nav = document.querySelector(".nav").offsetHeight;
        map.panBy = (o, opt) => pan.call(map, o, { ...opt, animate: false });
        const pin = markers.csail, ll = pin.getLatLng(), size = map.getSize();
        map.setView(ll, 15, { animate: false });
        map.panBy(map.latLngToContainerPoint(ll).subtract([size.x * .86, size.y * .3]));
        const pinAt = map.latLngToContainerPoint(ll);
        pin.openPopup();
        const popup = pin.getPopup().getElement(), x = popup.querySelector(".leaflet-popup-close-button");
        const beforeScroll = { popup: r(popup), close: r(x), scrollY };
        window.scrollBy({ top: popup.getBoundingClientRect().top - nav - 8, behavior: "instant" });
        const xb = x.getBoundingClientRect();
        map.panBy = pan;
        return { pinAt: [Math.round(pinAt.x), Math.round(pinAt.y)], beforeScroll, popup: r(popup), close: r(x), scrollY,
          atClose: [at(xb.left + 1, xb.top + 2), at(xb.left + xb.width / 2, xb.top + xb.height / 2), at(xb.right - 2, xb.bottom - 2)],
          atRightEdge: [at(innerWidth - 12, xb.top + 2), at(innerWidth - 5, xb.top + 2), at(innerWidth - 1, xb.top + 2)] };
      });
      console.log(`PROBE ${w}x${h} ` + JSON.stringify({ before, one, after: await page.evaluate(facts) }));
    });
  });
}

test.describe("probe fade", () => {
  test.use({ viewport: { width: 375, height: 667 }, ...PHONE });
  test("popups left after opening every one", async ({ page, browserName }) => {
    test.skip(browserName !== "webkit", "WebKit only");
    await page.goto("./");
    await waitForApp(page);
    const t0 = Date.now();
    await page.evaluate(() => { setClustered(false); for (const d of DATA) markers[d.id].openPopup(); map.closePopup(); });
    const samples = [];
    for (const pause of [0, 500, 500, 1000, 2000, 4000, 8000]) {
      if (pause) await page.waitForTimeout(pause);
      samples.push([Date.now() - t0, await page.locator(".leaflet-popup").count()]);
    }
    console.log("PROBE fade [ms, popups] " + JSON.stringify(samples));
  });
});
