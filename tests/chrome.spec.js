/* The TOA site chrome: the header, its mobile menu and the site footer, which the atlas and the
   events page share (scripts/build-events-page.js copies them). Until 2026-11 the Tailwind Play CDN
   built their CSS in each visitor's browser and printed a console warning that it isn't meant for
   production. Their rules are now written out in index.html, between the TOA SITE CHROME CSS
   markers. A first attempt at writing them out kept the class names but dropped their conditions
   (dark:, lg:, group-hover:) and left most classes with no rule, and nothing here caught it, so
   these check what the CDN used to do for free. */
const { test, expect } = require("./helpers/atlas");

const PAGES = [["atlas", "./"], ["events", "./events/"]];
const NAV = "#site-header nav";
const UNDERLINE = "#site-header nav a >> nth=0 >> span";

// The atlas's first-visit tour starts by itself after 1.4 s; these tests are about the header.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("toa-atlas-tour", "done"); } catch (e) {} });
});

for(const [name, url] of PAGES){
  test.describe(`the ${name} page's site chrome`, () => {
    test("loads nothing from the Tailwind CDN and logs no warning about it", async ({ page }) => {
      const asked = [], said = [];
      page.on("request", req => { if(/tailwindcss/i.test(req.url())) asked.push(req.url()); });
      page.on("console", msg => { if(/tailwind/i.test(msg.text())) said.push(msg.text()); });
      await page.goto(url, { waitUntil: "load" });
      expect(asked, "requests for Tailwind").toEqual([]);
      expect(said, "console messages about Tailwind").toEqual([]);
    });

    test("every class in the header, menu and footer has a rule", async ({ page }) => {
      await page.goto(url);
      const missing = await page.evaluate(() => {
        const selectors = [];
        const walk = rules => { for(const r of rules){ if(r.selectorText) selectors.push(r.selectorText); if(r.cssRules) walk(r.cssRules); } };
        // The CDN stylesheets (Leaflet's, Google Fonts') are cross-origin and can't be read. They
        // style none of the chrome.
        for(const sheet of document.styleSheets){ try { walk(sheet.cssRules); } catch (e) {} }
        // `.flex` must not count as a rule for `flex-col`, so the match has to end at the class name.
        const hasRule = cls => {
          const needle = "." + CSS.escape(cls);
          return selectors.some(sel => {
            for(let i = sel.indexOf(needle); i !== -1; i = sel.indexOf(needle, i + 1)){
              const next = sel[i + needle.length];
              if(next === undefined || !/[\w\\-]/.test(next)) return true;
            }
            return false;
          });
        };
        const roots = [...document.querySelectorAll("#site-header, #mobile-nav, footer.py-16")];
        const classes = new Set(roots.flatMap(root => [root, ...root.querySelectorAll("*")]).flatMap(el => [...el.classList]));
        return [...classes].filter(cls => !hasRule(cls)).sort();
      });
      expect(missing, "classes in the site chrome with no CSS rule (add theirs to the TOA SITE CHROME CSS block in index.html)").toEqual([]);
    });

    test("a laptop gets the nav, and a phone gets a menu that opens and closes", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(url);
      await expect(page.locator(NAV)).toBeVisible();
      await expect(page.locator("#mobile-menu-btn")).toBeHidden();
      await expect(page.locator("#site-header")).toHaveCSS("padding-left", "32px");
      // The gold underline grows under the link the pointer is on (`group-hover:`).
      await page.hover(`${NAV} a >> nth=0`);
      const link = await page.locator(`${NAV} a >> nth=0`).evaluate(el => el.getBoundingClientRect().width);
      await expect.poll(() => page.locator(UNDERLINE).evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(link, 0);

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator(NAV)).toBeHidden();
      await expect(page.locator("#mobile-menu-btn")).toBeVisible();
      await expect(page.locator("#site-header")).toHaveCSS("padding-left", "16px");
      const menuLeft = () => page.locator("#mobile-nav").evaluate(el => el.getBoundingClientRect().left);
      // Closed, the menu sits just past the visible area's right edge. That's the window's edge in
      // Chromium, and 10 px in from it in Playwright's WebKit, which draws the atlas's 10 px
      // scrollbar inside the window (see the WebKit jobs in docs/testing.md).
      const edge = await page.evaluate(() => visualViewport.offsetLeft + visualViewport.width);
      expect(await menuLeft(), "the closed menu sits off the right edge").toBeGreaterThanOrEqual(edge);
      await page.locator("#mobile-menu-btn").click();
      await expect.poll(menuLeft).toBe(0);
      await expect(page.locator("#mobile-nav")).toHaveCSS("position", "fixed");
      await page.getByRole("button", { name: "Close Menu" }).click();
      await expect.poll(menuLeft).toBeGreaterThanOrEqual(edge);
    });

    test("the header follows the theme", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(url);
      const header = page.locator("#site-header"), link = page.locator(`${NAV} a >> nth=0`);
      const toggle = page.getByRole("button", { name: "Toggle light/dark theme" });
      const [sun, moon] = [toggle.locator("svg >> nth=0"), toggle.locator("svg >> nth=1")];
      // dark, the page's default
      await expect(header).toHaveCSS("background-color", "rgba(10, 10, 15, 0.95)");
      await expect(link).toHaveCSS("color", "rgb(209, 213, 219)");
      await expect(sun).toBeVisible();
      await expect(moon).toBeHidden();
      await toggle.click();
      // light: gray-600 on white, not dark's gray-300, which nearly vanishes on white
      await expect(header).toHaveCSS("background-color", "rgba(255, 255, 255, 0.9)");
      await expect(link).toHaveCSS("color", "rgb(75, 85, 99)");
      await expect(sun).toBeHidden();
      await expect(moon).toBeVisible();
    });
  });
}
