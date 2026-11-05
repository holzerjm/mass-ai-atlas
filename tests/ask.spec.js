/* "Ask your own AI": the dialog that writes a prompt for someone's own assistant, and
   atlas-ai.txt, the file that prompt points at. See docs/testing.md. */
const { test, expect, ROOT, ATLAS, DATA, byId, waitForApp } = require("./helpers/atlas");
const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");
const { execFileSync } = require("child_process");

const dialog = page => page.locator("#askModal");
const openFromDirectory = async page => {
  await page.goto("./#directory");
  await waitForApp(page);
  await page.locator("#askOpen").click();
  await expect(dialog(page)).toBeVisible();
};
const prompt = page => page.locator("#askPrompt").textContent();

test("the Directory opens the dialog, and closing it puts the focus back", async ({ page }) => {
  await page.goto("./#directory");
  await waitForApp(page);
  await page.locator("#askOpen").focus();
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator("#askSituation")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator("#askOpen")).toBeFocused();
});

test("Tab stays inside the dialog", async ({ page }) => {
  await openFromDirectory(page);
  for(let i = 0; i < 12; i++){
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement.closest("#askModal"))).toBe(true);
  }
});

test("the prompt points at the file, carries the rules, and says what day it is", async ({ page, baseURL }) => {
  await openFromDirectory(page);
  const text = await prompt(page);
  expect(text).toContain(new URL("atlas-ai.txt", baseURL).href);
  expect(text).toContain("Recommend only organizations in the file");
  expect(text).toContain("Don't answer from memory");
  expect(text).toContain("End of file");
  expect(text).toContain("don't favor an organization because of who sponsors or runs the atlas");
  expect(text).toContain(`Today is ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.`);
  expect(text).toContain("My situation: [Describe your stage");
});

test("what someone types goes into the prompt, and nowhere else", async ({ page }) => {
  const sent = [];
  page.on("request", r => sent.push(r.url() + " " + (r.postData() || "")));
  await openFromDirectory(page);
  const words = "stealth radiology triage pilot in Worcester";
  await page.locator("#askSituation").fill(words);
  expect(await prompt(page)).toContain(`My situation: ${words}`);
  await page.keyboard.press("Escape");
  expect(page.url()).not.toContain("radiology");
  expect(sent.join(" ")).not.toContain("radiology");
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain("radiology");
});

test("a search already typed in the Directory starts the situation", async ({ page }) => {
  await page.goto("./#directory");
  await waitForApp(page);
  await page.locator("#dirSearch").fill("we need gpu time for a robotics startup");
  await page.locator("#askOpen").click();
  await expect(page.locator("#askSituation")).toHaveValue("we need gpu time for a robotics startup");
  expect(await prompt(page)).toContain("My situation: we need gpu time for a robotics startup");
});

test("the copy button copies the prompt as shown", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL).origin });
  await openFromDirectory(page);
  await page.locator("#askSituation").fill("two of us in Worcester");
  await page.locator("#askCopy").click();
  await expect(page.locator("#askCopy")).toHaveText("✓ Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await prompt(page));
  await expect(page.locator("#askCopy")).toHaveText("Copy the prompt", { timeout: 4000 });
});

test("without clipboard access, the prompt shows selected, ready to copy by hand", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) } });
  });
  await openFromDirectory(page);
  await page.locator("#askCopy").click();
  await expect(page.locator("#askRules")).toHaveAttribute("open", "");
  await expect(page.locator("#askCopy")).toContainText("Ctrl+C");
  expect(await page.evaluate(() => getSelection().toString())).toContain("Help me find what I need");
});

test("?ask=1 opens the dialog once, and closing it drops that from the address", async ({ page }) => {
  await page.goto("./?ask=1#directory");
  await waitForApp(page);
  await expect(dialog(page)).toBeVisible();
  await page.locator("#askModal .sl-x").click();
  await expect(dialog(page)).toBeHidden();
  await expect(page).not.toHaveURL(/ask=1/);
});

test("a pathway offers it to someone it doesn't fit", async ({ page }) => {
  await page.goto("./#journey");
  await waitForApp(page);
  await page.locator(".pw-note a").click();
  await expect(dialog(page)).toBeVisible();
});

test("the dialog offers the data and a way to attach it", async ({ page }) => {
  await openFromDirectory(page);
  await expect(page.locator('#askModal a[download][href="atlas-ai.txt"]')).toBeVisible();
  await expect(page.locator('#askModal a.btn[href="atlas-ai.txt"]')).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the dialog fits the screen", async ({ page }) => {
    await openFromDirectory(page);
    const box = await page.locator("#askModal .modal-card").boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    // the card scrolls, so something too wide would hide inside it instead of moving the page
    expect(await page.locator("#askModal .modal-card").evaluate(c => c.scrollWidth <= c.clientWidth)).toBe(true);
  });
});

// The generated file. It isn't in git, so build it here from the data under test.
test.describe("atlas-ai.txt", () => {
  let text;
  const PATHWAYS = yaml.load(fs.readFileSync(path.join(ROOT, "data", "pathways.yml"), "utf8"), { schema: yaml.CORE_SCHEMA }) || [];
  test.beforeAll(() => {
    const out = path.join(os.tmpdir(), `atlas-ai-${process.pid}.txt`);
    execFileSync("node", [path.join(ROOT, "scripts", "export-ai.js"), out], { stdio: "ignore" });
    text = fs.readFileSync(out, "utf8");
    fs.unlinkSync(out);
  });

  test("lists every organization once, A to Z, with its id and verified month", () => {
    const heads = [...text.matchAll(/^### (.+) \[([a-z0-9-]+)\]$/gm)].map(m => m[2]);
    expect(heads.length).toBe(DATA.length);
    expect(heads).toEqual([...DATA].sort((a, b) => a.name.localeCompare(b.name)).map(d => d.id));
    for(const d of DATA) if(d.lastVerified) expect(text).toContain(`verified ${d.lastVerified}`);
  });

  test("carries every pathway, with entries that exist", () => {
    for(const p of PATHWAYS){
      expect(text).toContain(p.title);
      expect(text).toContain(p.lead);
    }
    for(const m of text.matchAll(/Organizations: ([a-z0-9, -]+)\./g))
      for(const id of m[1].split(", ")) expect(byId[id], id).toBeTruthy();
  });

  test("says how many it holds, and ends where it says it does", () => {
    expect(text).toContain(`${DATA.length} organizations and ${PATHWAYS.length} pathways`);
    expect(text.trimEnd().endsWith("\nEnd of file")).toBe(true);
    expect(text).toContain('The last line of this file is "End of file"');
  });

  // The rules belong in the prompt the founder reads, so the file has to stay data.
  test("holds no instructions for an assistant", () => {
    const head = text.slice(0, text.indexOf("## Pathways"));
    expect(head).not.toMatch(/\b(you must|you should|ignore|assistant|instructions?|recommend|always|never)\b/i);
  });

  test("shows the same application status as the page", () => {
    const today = new Date().toISOString().slice(0, 10);
    const block = id => text.split(/^### /m).find(b => b.includes(`[${id}]`));
    const rolling = DATA.find(d => d.applyBy === "rolling");
    expect(block(rolling.id)).toContain("Applications: open, rolling");
    const closed = DATA.find(d => !d.applyBy && d.applyNote);
    expect(block(closed.id)).toContain(`Applications: closed (${closed.applyNote})`);
    const dated = DATA.find(d => d.applyBy && d.applyBy !== "rolling" && d.applyBy >= today);
    if(dated) expect(block(dated.id)).toContain(`Applications: apply by ${dated.applyBy}`);
    const none = DATA.find(d => !d.applyBy && !d.applyNote);
    expect(block(none.id)).not.toContain("Applications:");
  });

  test("stays compact", () => {
    expect(Buffer.byteLength(text)).toBeLessThan(200 * 1024);
  });
});
