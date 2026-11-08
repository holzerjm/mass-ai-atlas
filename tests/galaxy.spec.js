/* The Galaxy on a phone and from the keyboard (#45, #47). See docs/testing.md.
   The galaxy is a canvas, so these tests read the page's own drawing state: gxNodes are in
   layout units, and gxScale with the camera offset (gxOX, gxOY) turns them into canvas pixels. */
const { test, expect, ATLAS, DATA, waitForApp } = require("./helpers/atlas");

const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };

// A node's place on the canvas, and on the page (for a tap)
function nodeAt(page, id){
  return page.evaluate(id => {
    const n = gxNodes.find(x => x.id === id), r = gxCanvas.getBoundingClientRect();
    const x = gxW/2+gxOX+n.x*gxScale, y = gxH/2+gxOY+n.y*gxScale;
    return { x, y, pageX: r.left+x, pageY: r.top+y };
  }, id);
}

// #45. The layout is about three times wider than a phone's canvas, so until 2026-11 a phone
// showed its middle third, with category labels cut off at both edges, and a small laptop
// lost its top and bottom. The camera now fits the whole galaxy, labels included, to the
// canvas, and labels that would land on each other are left off.
for(const [screen, use] of [["a phone", PHONE], ["a small laptop", { viewport: { width: 1366, height: 650 } }]]){
  test.describe(`on ${screen}`, () => {
    test.use(use);

    test("the whole galaxy fits its canvas, and its labels stay inside it, apart", async ({ page }) => {
      await page.goto("./#galaxy");
      await waitForApp(page);
      await page.waitForTimeout(2500);   // let the layout spread out from where it starts
      const fit = await page.evaluate(() => {
        const cx = gxW/2+gxOX, cy = gxH/2+gxOY, boxes = gxLabelBoxes;
        const off = gxNodes.filter(n => {
          const x = cx+n.x*gxScale, y = cy+n.y*gxScale;
          return x < 0 || x > gxW || y < 0 || y > gxH;
        }).map(n => n.name);
        const cut = boxes.filter(b => b.x0 < 0 || b.x1 > gxW || b.y0 < 0 || b.y1 > gxH).map(b => b.text);
        const overlaps = [];
        boxes.forEach((a, i) => boxes.slice(i+1).forEach(b => {
          if(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) overlaps.push(`${a.text} / ${b.text}`);
        }));
        return { off, cut, overlaps, labels: boxes.length, hubs: gxNodes.filter(n => n.hub).length };
      });
      expect(fit.off, "nodes outside the canvas").toEqual([]);
      expect(fit.cut, "labels cut off at the canvas's edge").toEqual([]);
      expect(fit.overlaps, "labels drawn over each other").toEqual([]);
      expect(fit.labels, "hub labels left off").toBeGreaterThanOrEqual(Math.ceil(fit.hubs * 0.6));
    });
  });
}

test.describe("on a phone", () => {
  test.use(PHONE);

  // #45. A finger has no hover, and until 2026-11 a tap opened the drawer at once, so on a
  // phone a node's connections could not be traced at all.
  test("a tap traces a node's connections, a second tap opens it, and a tap on empty space clears it", async ({ page }) => {
    await page.goto("./#galaxy");
    await waitForApp(page);
    await page.locator(".galaxy-wrap").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    await expect(page.locator(".gx-hint .for-touch")).toBeVisible();
    await expect(page.locator(".gx-hint .for-mouse")).toBeHidden();

    const id = await page.evaluate(() => gxNodes.filter(n => !n.hub).sort((a, b) => (b.deg||0) - (a.deg||0))[0].id);
    const name = DATA.find(d => d.id === id).name;
    let p = await nodeAt(page, id);
    await page.touchscreen.tap(p.pageX, p.pageY);
    await expect.poll(() => page.evaluate(() => gxLocked && gxLocked.id)).toBe(id);
    await expect(page.locator("#gxTip")).toBeVisible();
    await expect(page.locator("#gxTip")).toContainText(name);
    await expect(page.locator("#gxTip")).toContainText("Tap again for details");
    await expect(page.locator("#drawer")).not.toHaveClass(/\bopen\b/);

    p = await nodeAt(page, id);
    await page.touchscreen.tap(p.pageX, p.pageY);
    await expect(page.locator("#drawer")).toHaveClass(/\bopen\b/);
    await expect(page.locator("#drName")).toHaveText(name);
    await page.locator("#drClose").tap();
    await expect(page.locator("#drawer")).not.toHaveClass(/\bopen\b/);
    // it slides out over the canvas, so wait until it has gone
    await expect.poll(() => page.locator("#drawer").evaluate(el => el.getBoundingClientRect().left >= innerWidth)).toBe(true);
    expect(await page.evaluate(() => gxLocked && gxLocked.id), "closing the drawer keeps the traced node").toBe(id);

    // a spot on the canvas, not under the search box or the hint, with no node near it
    const empty = await page.evaluate(() => {
      const r = gxCanvas.getBoundingClientRect();
      for(let y = 80; y < gxH-80; y += 9) for(let x = 10; x < gxW-10; x += 9){
        if(document.elementFromPoint(r.left+x, r.top+y) === gxCanvas && !gxNodeAt(x, y, 40)) return { pageX: r.left+x, pageY: r.top+y };
      }
      return null;
    });
    expect(empty, "an empty spot on the canvas").not.toBeNull();
    await page.touchscreen.tap(empty.pageX, empty.pageY);
    await expect.poll(() => page.evaluate(() => gxLocked)).toBeNull();
    await expect(page.locator("#gxTip")).toBeHidden();
  });
});

// #47. The galaxy is a canvas, which a keyboard can't enter and a screen reader can't read.
// Every node is also in a tree of organizations by category that Tab reaches after ⌖ and the
// arrow keys move through, and the canvas draws its focus.
test("the keyboard reaches every organization in the galaxy, and Enter opens one", async ({ page }) => {
  await page.goto("./#galaxy");
  await waitForApp(page);
  const tree = page.locator("#gxTree");
  const cats = Object.keys(ATLAS.CATS).filter(k => DATA.some(d => d.cat === k));
  await expect(tree.locator('[role="treeitem"][aria-expanded]')).toHaveCount(cats.length);
  await expect(tree.locator('[role="treeitem"]:not([aria-expanded])')).toHaveCount(DATA.length);

  await page.locator(".gx-home").focus();
  await page.keyboard.press("Tab");
  const first = tree.locator('[role="treeitem"][aria-expanded]').first();
  await expect(first).toBeFocused();
  await expect(page.locator(".galaxy-wrap")).toHaveClass(/\bkbd\b/);
  await expect(page.locator(".gx-hint .for-keys")).toBeVisible();

  await page.keyboard.press("ArrowRight");   // opens the category
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowRight");   // and moves into it
  const org = first.locator('[role="group"] > [role="treeitem"]').first();
  await expect(org).toBeFocused();
  const id = await org.getAttribute("data-node"), name = DATA.find(d => d.id === id).name;
  expect(await page.evaluate(() => gxKbd && gxKbd.id), "the node the canvas shows as focused").toBe(id);
  await expect(page.locator("#gxTip")).toContainText(name);

  await page.keyboard.press("Enter");
  await expect(page.locator("#drawer")).toHaveClass(/\bopen\b/);
  await expect(page.locator("#drName")).toHaveText(name);
  await page.keyboard.press("Escape");
  await expect(page.locator("#drawer")).not.toHaveClass(/\bopen\b/);
  await expect(org).toBeFocused();

  await page.keyboard.press("ArrowLeft");    // back up to the category
  await expect(first).toBeFocused();
  await page.keyboard.press("ArrowLeft");    // which closes
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowDown");    // so the next entry is the next category
  await expect(tree.locator('[role="treeitem"][aria-expanded]').nth(1)).toBeFocused();
});

// #47. The galaxy search's results took only a click until 2026-11.
test("the galaxy search's results can be chosen with the arrow keys and Enter", async ({ page }) => {
  const q = "ventures";
  expect(DATA.filter(d => d.name.toLowerCase().includes(q)).length, `entries matching "${q}"`).toBeGreaterThan(1);
  await page.goto("./#galaxy");
  await waitForApp(page);
  const input = page.locator("#gxSearch"), options = page.locator('#gxResults [role="option"][data-id]');
  await input.fill(q);
  await expect(page.locator("#gxResults")).toBeVisible();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await input.press("ArrowDown");
  await input.press("ArrowDown");
  const second = options.nth(1), id = await second.getAttribute("data-id");
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(input).toHaveAttribute("aria-activedescendant", await second.getAttribute("id"));
  await input.press("Enter");
  await expect(page.locator("#gxResults")).toBeHidden();
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await expect(input).toHaveValue(DATA.find(d => d.id === id).name);
  expect(await page.evaluate(() => gxLocked && gxLocked.id), "the organization the search locked").toBe(id);
});

// The drawer's "Connected to" entries were spans that took only a click; as buttons they let
// the keyboard follow the galaxy's connections. Following one redraws the drawer, and closing
// it must still put focus back where the drawer was opened from.
test("the drawer's connections can be followed by keyboard, and closing it returns focus", async ({ page }) => {
  const d = DATA.find(x => (x.links || []).some(l => DATA.some(o => o.id === l)));
  await page.goto("./#galaxy");
  await waitForApp(page);
  await page.evaluate(id => gxTreeCurrent(id), d.id);
  const item = page.locator(`#gxTree [data-node="${d.id}"]`);
  await item.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#drName")).toHaveText(d.name);
  const link = page.locator("#drBody button.chip").first();
  const to = (await link.textContent()).trim();
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#drName")).toHaveText(to);
  await page.keyboard.press("Escape");
  await expect(page.locator("#drawer")).not.toHaveClass(/\bopen\b/);
  await expect(item).toBeFocused();
});

// A category hidden with its button leaves the keyboard list, and Tab's place in the list
// moves on if it was in that category.
test("a category hidden with its button leaves the galaxy's keyboard list", async ({ page }) => {
  await page.goto("./#galaxy");
  await waitForApp(page);
  const [firstCat, secondCat] = Object.keys(ATLAS.CATS).filter(k => DATA.some(d => d.cat === k));
  const entry = k => page.locator(`#gxTree [data-node="hub:${k}"]`);
  await expect(entry(firstCat)).toHaveAttribute("tabindex", "0");
  await page.locator(`#gxCatBar .cat-btn[data-cat="${firstCat}"]`).click();
  expect(await entry(firstCat).evaluate(el => el.hidden)).toBe(true);
  await expect(entry(secondCat)).toHaveAttribute("tabindex", "0");
  await page.locator(`#gxCatBar .cat-btn[data-cat="${firstCat}"]`).click();
  expect(await entry(firstCat).evaluate(el => el.hidden)).toBe(false);
});
