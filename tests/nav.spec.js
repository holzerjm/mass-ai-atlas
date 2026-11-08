/* The view tabs (see docs/testing.md). The bar is sticky, but until 2026-11 it left one window down
   the page, because <body>, its containing block, was one window tall: it was on screen for 0 to
   5% of the Directory's length. A bar that's always there brings jobs of its own, so these check
   those too. Scrolls here are instant: <html> has scroll-smooth, so a plain scrollTo is a glide. */
const { test, expect, waitForApp } = require("./helpers/atlas");

const VIEWS = ["map", "galaxy", "journey", "directory"];
const sized = (width, height, touch) => ({ viewport: { width, height }, ...touch && { isMobile: true, hasTouch: true } });
const toFoot = page => page.evaluate(() => {
  window.scrollTo({ top: document.scrollingElement.scrollHeight, behavior: "instant" });
  return new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
});

for(const [width, height, touch] of [[1366, 650], [1024, 700], [820, 600], [375, 667, true], [844, 390, true]]){
  test.describe(`in a ${width} × ${height} window`, () => {
    test.use(sized(width, height, touch));

    test("the tabs stay at the top of the window to the foot of every view", async ({ page }) => {
      await page.goto("./");
      await waitForApp(page);
      for(const view of VIEWS){
        await page.evaluate(view => switchView(view), view);
        await toFoot(page);
        const seen = await page.evaluate(() => {
          const bar = document.querySelector(".nav"), tab = bar.querySelector(".tab").getBoundingClientRect();
          return { page: scrollY, bar: bar.getBoundingClientRect().top, tab: bar.contains(document.elementFromPoint(tab.left + tab.width / 2, tab.top + tab.height / 2)) };
        });
        expect(seen.page, `how far down ${view} went`).toBeGreaterThan(height);
        expect(seen.bar, `where the bar is at the foot of ${view}`).toBe(0);
        expect(seen.tab, `a tab can be clicked at the foot of ${view}`).toBe(true);
      }
    });
  });
}

// Two rows in a phone on its side took 107 px, 27% of the window, and left no room for the map
// search's whole list. A short window takes the phone's one row, which is also what lets the
// map fit under the bar there, with some page left to swipe.
test.describe("in a short window", () => {
  for(const [width, height, touch] of [[844, 390, true], [932, 430, true], [1024, 500]]){
    test.describe(`${width} × ${height}`, () => {
      test.use(sized(width, height, touch));

      test("the tabs take one row", async ({ page }) => {
        await page.goto("./");
        await waitForApp(page);
        const bar = (await page.locator("nav.nav").boundingBox()).height;
        expect(bar).toBeLessThan(60);
        if(touch) expect(bar + (await page.locator("#map").boundingBox()).height).toBeLessThanOrEqual(height);
      });
    });
  }

  test.describe("and a window taller than that", () => {
    test.use(sized(1024, 700));

    test("keeps the tabs' icons", async ({ page }) => {
      await page.goto("./");
      await waitForApp(page);
      await expect(page.locator(".tab .ico").first()).toBeVisible();
    });
  });
});

// With the bar always there, a tab can be clicked from anywhere. As a glide, the page sat on the
// footer of a Map it had shrunk to for seconds before it set off, and from the foot of the Map
// scroll anchoring threw it to the foot of the Directory and it glided up through all of it.
test("a tab goes straight to the top of the page from the foot of any view", async ({ page }) => {
  await page.goto("./#directory");
  await waitForApp(page);
  for(const [from, to] of [["directory", "map"], ["map", "directory"], ["directory", "directory"], ["directory", "journey"], ["journey", "galaxy"], ["galaxy", "map"]]){
    await page.evaluate(view => switchView(view), from);
    await toFoot(page);
    const at = await page.evaluate(to => {
      document.querySelector(`.tab[data-view="${to}"]`).click();
      return scrollY;
    }, to);
    expect(at, `the page, as ${from} goes to ${to}`).toBe(0);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => scrollY), `the page, after ${from} goes to ${to}`).toBe(0);
  }
});

// Shift + Tab scrolls what it reaches to the top of the window, which is under the bar. The room
// has to be the bar's real height, which depends on how it wraps, so a fixed number won't do.
test.describe("the keyboard", () => {
  const underBar = page => page.evaluate(() =>
    Math.max(0, document.querySelector(".nav").getBoundingClientRect().bottom - document.activeElement.getBoundingClientRect().top));
  for(const [view, items, width, height] of [["directory", "#cards .card-open", 820, 600], ["journey", "#jrPanel .chip", 1366, 650]]){
    test.describe(`in a ${width} × ${height} window`, () => {
      test.use(sized(width, height));

      test(`Shift + Tab up the ${view} never stops under the tabs`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(`./#${view}`);
        await waitForApp(page);
        // Just below the bar, so the walk up the page reaches it in a few stops.
        await page.locator(items).nth(30).evaluate(item => {
          item.focus({ preventScroll: true });
          window.scrollTo({ top: item.getBoundingClientRect().top + scrollY - document.querySelector(".nav").offsetHeight - 40, behavior: "instant" });
        });
        for(let i = 0; i < 16; i++){
          await page.keyboard.press("Shift+Tab");
          // A pixel to spare, because the page stops on whole pixels and the items don't sit on them.
          await expect.poll(() => underBar(page), `how much of stop ${i + 1} is under the tabs`).toBeLessThanOrEqual(1);
        }
      });
    });
  }

  test.describe("in a window where the tabs just fit one row", () => {
    test.use(sized(1160, 700));

    test("the room kept for them follows their height", async ({ page }) => {
      await page.goto("./");
      await waitForApp(page);
      const room = () => page.evaluate(() => [parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop), document.querySelector(".nav").offsetHeight]);
      const [kept, oneRow] = await room();
      expect(kept).toBe(oneRow);
      await page.evaluate(() => { document.querySelector("#starNav").style.display = ""; });
      await expect.poll(async () => { const [kept, bar] = await room(); return bar > oneRow && kept === bar; }, "the room, with the shortlist's tab wrapping the bar").toBe(true);
    });
  });
});

// The 64 px this used to allow left the search box under a bar of two rows, by 21 px here.
for(const [width, height, touch] of [[1366, 650], [1024, 700], [844, 390, true], [375, 667, true]]){
  test.describe(`in a ${width} × ${height} window`, () => {
    test.use(sized(width, height, touch));

    test("a headline figure opens the Directory right under the tabs", async ({ page }) => {
      await page.goto("./");
      await waitForApp(page);
      await page.locator("#stats a.stat").first().click();
      // The view starts right under the tabs before the page moves, so this waits for the tabs to reach the top.
      await expect.poll(() => page.evaluate(() => {
        const bar = document.querySelector(".nav").getBoundingClientRect(), view = document.querySelector("#view-directory").getBoundingClientRect();
        return Math.abs(bar.top) <= 1 && Math.abs(view.top - bar.bottom) <= 1;
      }), "the tabs at the top of the window, with the Directory right under them").toBe(true);
    });
  });
}

// The room for the bar takes the middle of the window down by half its height, which is towards
// the tour's card at the foot of the window, so the spot allows for that.
test.describe("the tour, in an 820 × 600 window", () => {
  test.use(sized(820, 600));

  test("keeps what it points at clear of its card", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("./");
    await waitForApp(page);
    await page.evaluate(() => startTour());
    const steps = await page.evaluate(() => TOUR.length);
    for(let step = 1; step <= steps; step++){
      await expect(page.locator("#tourStep")).toHaveText(`${step} / ${steps}`);
      const overlap = await page.evaluate(() => {
        const spot = document.querySelector(".tour-spot").getBoundingClientRect(), card = document.querySelector("#tourCard").getBoundingClientRect();
        return Math.max(0, Math.min(spot.bottom, card.bottom) - Math.max(spot.top, card.top));
      });
      expect(overlap, `step ${step}`).toBe(0);
      await page.evaluate(() => nextTourStep());
    }
  });
});

// Behind a bar that's always there, a sticky banner stays for the whole page, and where it wraps it
// shows below the bar, over whatever is passing. This writes its own text, so it doesn't depend on
// which updates a copy of the atlas has.
test.describe("the what's-new banner, on a narrow phone", () => {
  test.use(sized(320, 568, true));

  test("scrolls away with the page", async ({ page }) => {
    await page.goto("./#directory");
    await waitForApp(page);
    await page.evaluate(() => {
      document.querySelector("#newBannerText").textContent = "✨ New: a line long enough to wrap on a phone — ";
      document.querySelector("#newBanner").style.display = "";
      window.scrollTo({ top: 2000, behavior: "instant" });
    });
    expect(await page.locator("#newBanner").evaluate(banner => banner.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);
  });
});

// In the light theme the bar passes over the dark footer band at the foot of every view, and only
// a nearly solid ground keeps its gold text at 4.5:1 there. It read 3.9:1 at 90%.
test("the light theme's tabs keep their gold text readable over the dark footer band", async ({ page }) => {
  await page.addInitScript(() => { try{ localStorage.setItem("toa-atlas-theme", "light"); }catch(e){} });
  await page.goto("./");
  await waitForApp(page);
  const ratio = await page.evaluate(() => {
    const parts = el => getComputedStyle(el), rgba = text => text.match(/[\d.]+/g).map(Number);
    const [r, g, b, a = 1] = rgba(parts(document.querySelector(".nav")).backgroundColor);
    const band = rgba(parts(document.querySelector("footer.py-16")).backgroundColor);
    const ground = [r, g, b].map((c, i) => c * a + band[i] * (1 - a)), ink = rgba(parts(document.querySelector("#suggestBtn")).color);
    const lum = rgb => rgb.map(c => { const s = c / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    return (lum(ground) + .05) / (lum(ink) + .05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});
