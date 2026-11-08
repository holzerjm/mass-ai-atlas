/* A pin's popup opens over everything that floats on the map. See docs/testing.md.
   Until 2026-11 it opened under all of it: at 375 × 667 the search box, the view switch and the
   map's buttons hid part of the name on 197 of 198 popups and the × on all of them, at 360 × 640
   the button on 155, and a click in the top half of the map hid 41 names on a laptop. */
const { test, expect, DATA, waitForApp } = require("./helpers/atlas");

const entry = DATA.find(d => d.id === "csail") || DATA[0];
const PHONE = { isMobile: true, hasTouch: true };

// Puts a pin at a share of the map's width and height, with the pins ungrouped so that it's there
// to open, and the page where the top of the map meets the nav.
const placePin = (page, id, x, y) => page.evaluate(({ id, x, y }) => {
  setClustered(false);
  const ll = markers[id].getLatLng(), size = map.getSize();
  map.setView(ll, 15, { animate: false });
  map.panBy(map.latLngToContainerPoint(ll).subtract([size.x * x, size.y * y]), { animate: false });
  const top = map.getContainer().getBoundingClientRect().top - document.querySelector(".nav").offsetHeight;
  window.scrollBy({ top, behavior: "instant" });
}, { id, x, y });
const openPopup = (page, id) => page.evaluate(id => markers[id].openPopup(), id);
const middle = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

// Opens every popup on the map at each of these places, and lists what's on top of its name, its
// button or its ×. The first is where Show on map stops, and the others are by the map's top
// corners, where a tap can open one. Autopan's glide is a quarter of a second, and hundreds of
// those would take minutes, so the pans are instant, and nothing here waits for a frame.
const PLACES = [[.5, .5], [.14, .3], [.86, .3]];
const hiddenParts = page => page.evaluate(places => {
  const pan = map.panBy, nav = document.querySelector(".nav").offsetHeight, hidden = [];
  map.panBy = (offset, options) => pan.call(map, offset, { ...options, animate: false });
  const lines = el => { const text = document.createRange(); text.selectNodeContents(el); return [...text.getClientRects()]; };
  // A hit test reaches only what the visual viewport shows. In a phone-sized window, Playwright's
  // WebKit paints the page's 10 px scrollbar over the window's right edge, where an iPhone shows
  // only an overlay, and elementFromPoint finds nothing under it. So points outside the visual
  // viewport aren't tested for cover, and a part that leaves the window counts as hidden by itself.
  const seen = visualViewport;
  const points = box => {
    const all = [];
    for(const y of [box.top + 2, box.top + box.height / 2, box.bottom - 2])
      for(let x = box.left + 1; x < box.right; x += 5)
        if(x >= seen.offsetLeft && x < seen.offsetLeft + seen.width && y >= seen.offsetTop && y < seen.offsetTop + seen.height) all.push([x, y]);
    return all;
  };
  const offWindow = box => box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight;
  setClustered(false);
  for(const d of mapEntries().list) for(const [x, y] of places){
    const pin = markers[d.id], ll = pin.getLatLng(), size = map.getSize();
    map.setView(ll, 15, { animate: false });
    map.panBy(map.latLngToContainerPoint(ll).subtract([size.x * x, size.y * y]));
    pin.openPopup();
    const popup = pin.getPopup().getElement();
    window.scrollBy({ top: popup.getBoundingClientRect().top - nav - 8, behavior: "instant" });
    const parts = {
      name: lines(popup.querySelector(".pop-name")),
      button: [popup.querySelector(".pop-btn").getBoundingClientRect()],
      close: [popup.querySelector(".leaflet-popup-close-button").getBoundingClientRect()],
    };
    for(const [part, boxes] of Object.entries(parts)){
      const over = boxes.some(offWindow) ? null
        : boxes.flatMap(points).map(([x, y]) => document.elementFromPoint(x, y)).find(at => !popup.contains(at));
      if(over !== undefined) hidden.push(`${d.id} at ${x}, ${y}: ${part} under ${over ? over.className || over.tagName : "the window's edge"}`);
    }
    map.closePopup();
  }
  map.panBy = pan;
  return hidden;
}, PLACES);
const nothingHidden = async page => {
  const hidden = await hiddenParts(page);
  expect(hidden.slice(0, 6), `${hidden.length} parts of popups hidden`).toEqual([]);
};

for(const [width, height, phone] of [[390, 844, true], [375, 667, true], [360, 640, true], [844, 390, true], [1366, 650, false]]){
  for(const theme of ["dark", "light"]){
    test.describe(`in a ${width} × ${height} window, ${theme} theme`, () => {
      test.use({ viewport: { width, height }, ...phone && PHONE });

      test("nothing covers a popup's name, its button or its ×", async ({ page }) => {
        if(theme === "light") await page.addInitScript(() => { try{ localStorage.setItem("toa-atlas-theme", "light"); }catch(e){} });
        await page.goto("./");
        await waitForApp(page);
        await nothingHidden(page);
      });
    });
  }
}

// The note says how many pins a filter leaves, in a row of its own under the view switch.
test.describe("with a filter's note on the map", () => {
  test.use({ viewport: { width: 360, height: 640 }, ...PHONE });

  test("nothing covers a popup's name, its button or its ×", async ({ page }) => {
    await page.goto("./?need=talent");
    await waitForApp(page);
    await expect(page.locator("#mapNote")).toHaveClass(/\bon\b/);
    await nothingHidden(page);
  });
});

// The pane isn't inside the map pane, so nothing moves it but the page's own code. The gap between
// the popup's foot and the pin is read every frame, because a popup that only catches up at the
// end of a move would look right afterwards. A glide comes between the zooms: a zoom that starts
// straight after another can part the two for a moment, with Leaflet's own pane as well (28 of 90
// zoom outs on 2026-11-06, against 14 of 90 with this one, and none with a rest between them).
test("a popup stays on its pin however the map moves", async ({ page }) => {
  await page.goto("./");
  await waitForApp(page);
  await placePin(page, entry.id, .5, .7);
  await page.evaluate(id => {
    markers[id].openPopup();
    const gap = id => {
      const popup = markers[id].getPopup().getElement().getBoundingClientRect(), pin = markers[id].getElement().getBoundingClientRect();
      return [popup.left + popup.width / 2 - pin.left - pin.width / 2, popup.bottom - pin.top - pin.height / 2];
    };
    const start = gap(id), off = window.off = (pin = id) => Math.max(...gap(pin).map((now, i) => Math.abs(now - start[i])));
    const moves = {
      "a zoom in": () => map.zoomIn(),
      "a glide": () => map.panBy([80, 40]),
      "a zoom out": () => map.zoomOut(),
      "a jump": () => map.panBy([-80, -40], { animate: false }),
    };
    window.drift = async name => {
      let moving = true, most = 0;
      map.once("moveend", () => { moving = false; });
      moves[name]();
      do {
        most = Math.max(most, off());
        await new Promise(requestAnimationFrame);
      } while(moving);
      return most;
    };
  }, entry.id);
  for(const name of ["a zoom in", "a glide", "a zoom out", "a jump"]){
    expect(await page.evaluate(name => drift(name), name), `how far the popup left its pin in ${name}`).toBeLessThan(3);
    await expect.poll(() => page.evaluate(() => off()), `the popup back on its pin after ${name}`).toBeLessThan(1);
  }
  // The zoom's class has to come off again, or a popup that hasn't been open yet glides in from
  // the map's corner.
  const next = DATA.find(d => d.id !== entry.id).id;
  expect(await page.evaluate(next => { markers[next].openPopup(); return off(next); }, next), "how far from its pin the next popup opens").toBeLessThan(1);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 667 }, ...PHONE });

  const tap = async (page, target) => {
    const { x, y } = middle(await target.boundingBox());
    await page.touchscreen.tap(x, y);
  };

  test("a popup's × and its button take a tap", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    // A test taps faster than anyone could, and Leaflet calls two taps within 200 ms a double tap,
    // wherever they land. The zoom would take the pin somewhere else, and the next tap with it.
    await page.evaluate(() => map.doubleClickZoom.disable());
    await placePin(page, entry.id, .5, .6);
    const pin = page.locator(`.leaflet-marker-icon[title="${entry.name}"]`), details = page.locator(".leaflet-popup .pop-btn");
    await tap(page, pin);
    await expect(details).toBeFocused();
    // Up to the search box's row, where a tap on × used to land on the search box. The pin stays
    // on the map, whatever the popup's height.
    await page.evaluate(() => {
      const top = document.querySelector(".leaflet-popup").getBoundingClientRect().top - map.getContainer().getBoundingClientRect().top;
      map.panBy([0, top - 20], { animate: false });
    });
    await tap(page, page.locator(".leaflet-popup-close-button"));
    await expect(page.locator(".leaflet-popup")).toHaveCount(0);
    await tap(page, pin);
    await expect(details).toBeFocused();
    await tap(page, details);
    await expect(page.locator("#drName")).toHaveText(entry.name);
  });

  // Only the keyboard's focus brings a control back over a popup. A tap leaves the focus on the
  // button it hit, and lifting the view switch then would put it on top of the popup again.
  test("a tap on the view switch leaves it under the popup", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    await placePin(page, entry.id, .5, .85);
    await openPopup(page, entry.id);
    const button = page.locator('.mv-btn[data-view="state"]');
    await tap(page, button);
    await expect(button).toBeFocused();
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".map-view-switch")).zIndex)).toBe("999");
  });

  // Enter leaves the focus in the search box, and the box comes back over a popup while it has the
  // focus. So it's the popup taking the focus that keeps its name in view. A tap on a result wouldn't
  // show this, because it takes the focus out of the box by itself. The tallest popup is the one
  // that reaches the box.
  test("a popup opened from the search isn't under the search box", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    const { id, name } = await page.evaluate(() => {
      setClustered(false);
      // Leaflet fades a closed popup out for 200 ms before it removes it. After all of them in a
      // row, WebKit on CI was still removing 130 to 170 when the search's popup opened, so the
      // locator below found them all. Measured without the fade, each one goes as it closes.
      const fade = map._fadeAnimated;
      map._fadeAnimated = false;
      const height = d => {
        markers[d.id].openPopup();
        return markers[d.id].getPopup().getElement().offsetHeight;
      };
      const tallest = DATA.map(d => [height(d), d]).sort((a, b) => b[0] - a[0])[0][1];
      map.closePopup();
      map._fadeAnimated = fade;
      return { id: tallest.id, name: tallest.name };
    });
    await page.locator("#mapSearch").fill(name);
    await expect(page.locator('#mapResults [role="option"]').first()).toHaveAttribute("data-id", id);
    await page.keyboard.press("Enter");
    await expect(page.locator(".leaflet-popup .pop-btn")).toBeFocused({ timeout: 15000 });
    await expect.poll(() => page.evaluate(() => {
      const popup = document.querySelector(".leaflet-popup"), box = document.querySelector(".map-search").getBoundingClientRect();
      const name = document.createRange();
      name.selectNodeContents(popup.querySelector(".pop-name"));
      const lines = [...name.getClientRects()];
      return {
        besideBox: lines.some(line => line.top < box.bottom),
        reached: lines.every(line => popup.contains(document.elementFromPoint(line.left + line.width / 2, line.top + line.height / 2))),
      };
    }), "the popup's name, up beside the search box").toEqual({ besideBox: true, reached: true });
  });
});

test.describe("in a laptop's window", () => {
  test.use({ viewport: { width: 1366, height: 650 } });

  test("the search's results come up over an open popup", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    await placePin(page, entry.id, .16, .55);
    await openPopup(page, entry.id);
    await page.locator("#mapSearch").click();
    await page.keyboard.type("mit");
    await expect(page.locator("#mapResults.open")).toHaveCount(1);
    const rows = await page.evaluate(() => {
      const popup = document.querySelector(".leaflet-popup").getBoundingClientRect();
      return [...document.querySelectorAll("#mapResults [role=option]")].slice(0, 6).map(row => {
        const box = row.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
        return { overPopup: x > popup.left && x < popup.right && y > popup.top && y < popup.bottom, reached: row.contains(document.elementFromPoint(x, y)) };
      });
    });
    expect(rows.some(row => row.overPopup), "a result that would be behind the popup").toBe(true);
    expect(rows.filter(row => !row.reached)).toEqual([]);
  });

  test("a control that takes the keyboard's focus comes back over an open popup", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    await placePin(page, entry.id, .9, .4);
    await openPopup(page, entry.id);
    await expect(page.locator(".leaflet-popup .pop-btn")).toBeFocused();
    const onSwitch = () => page.evaluate(() => document.activeElement.matches(".mv-btn"));
    for(let i = 0; i < 8 && !(await onSwitch()); i++) await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const button = document.activeElement, box = button.getBoundingClientRect(), popup = document.querySelector(".leaflet-popup").getBoundingClientRect();
      const x = box.left + box.width / 2, y = box.top + box.height / 2;
      return { button: button.className, overPopup: x > popup.left && x < popup.right && y > popup.top && y < popup.bottom, reached: button === document.elementFromPoint(x, y) };
    });
    expect(focused).toEqual({ button: "mv-btn", overPopup: true, reached: true });
  });

  test("the wheel's hint shows over an open popup", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    await placePin(page, entry.id, .5, .75);
    await openPopup(page, entry.id);
    // It takes no pointer, so elementFromPoint can't see it until it's asked to for a moment.
    const hint = await page.evaluate(() => {
      const hint = document.querySelector(".map-wrap .zoom-hint"), popup = document.querySelector(".leaflet-popup").getBoundingClientRect();
      hint.style.transition = "none";
      hint.style.pointerEvents = "auto";
      hint.classList.add("show");
      const box = hint.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
      return { overPopup: x > popup.left && x < popup.right && y > popup.top && y < popup.bottom, reached: hint.contains(document.elementFromPoint(x, y)) };
    });
    expect(hint).toEqual({ overPopup: true, reached: true });
  });

  test("the nav stays over an open popup", async ({ page }) => {
    await page.goto("./");
    await waitForApp(page);
    await placePin(page, entry.id, .5, .4);
    await openPopup(page, entry.id);
    const under = await page.evaluate(() => {
      const nav = () => document.querySelector(".nav").getBoundingClientRect(), popup = () => document.querySelector(".leaflet-popup").getBoundingClientRect();
      window.scrollBy({ top: popup().top - nav().bottom + 20, behavior: "instant" });
      const x = popup().left + popup().width / 2, y = nav().bottom - 10;
      return { behindNav: popup().top < y, reached: !!document.elementFromPoint(x, y).closest(".nav") };
    });
    expect(under).toEqual({ behindNav: true, reached: true });
  });
});
