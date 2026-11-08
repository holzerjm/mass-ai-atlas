#!/usr/bin/env node
/* ============================================================
   Re-record docs/demo.gif from the live site.

     npx playwright install chromium      # once
     node scripts/record-demo.js          # writes docs/demo.gif

   Playwright is NOT a dependency of this repo — the two runtime deps stay
   ajv + js-yaml. Run it with npx, or `npm i -D playwright` in a scratch clone.
   ffmpeg must be on PATH.

   Why this exists: the demo on the README went stale twice (it showed the old
   name and 171 entries, then a count that no longer matched), because nobody
   could regenerate it. Now the tour is code: change BEATS below, re-run, done.

   Flags:
     --url <u>    page to record (default: the live site)
     --out <p>    output gif (default: docs/demo.gif)
     --keep       keep the intermediate webm/mp4 for inspection
   ============================================================ */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("playwright not found. Run:  npx playwright install chromium\n" +
                "(or `npm i -D playwright` in a scratch clone — it is deliberately not a dep here)");
  process.exit(1);
}

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const SITE = flag("--url", "https://the-open-accelerator.com/ecosystem/");
const OUT  = path.resolve(flag("--out", path.join(__dirname, "..", "docs", "demo.gif")));
const KEEP = argv.includes("--keep");

// Capture big and downscale: the GIF is sharper than recording at target size.
const W = 1200, H = 750;
// A dense vector basemap defeats GIF's inter-frame compression — nearly every
// frame differs — so length, not quality settings, is what drives file size.
// 8 fps x ~25 s x 760px lands around 4.5 MB, under the 5 MB the README had before.
const FPS = 8, WIDTH = 760, COLORS = 64;

const CURSOR_CSS = `
#__cur{position:fixed;z-index:2147483647;width:22px;height:22px;left:0;top:0;pointer-events:none;
  transition:transform .40s cubic-bezier(.33,.9,.35,1);transform:translate(60px,420px);
  filter:drop-shadow(0 2px 3px rgba(0,0,0,.55))}
#__cur.__click::after{content:"";position:absolute;left:-9px;top:-9px;width:40px;height:40px;
  border-radius:50%;border:3px solid #FFC600;animation:__pop .45s ease-out forwards}
@keyframes __pop{from{transform:scale(.25);opacity:.95}to{transform:scale(1.25);opacity:0}}`;

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-demo-"));
  const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--font-render-hinting=none"] });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: 2,
    recordVideo: { dir: tmp, size: { width: W, height: H } },
  });
  const page = await ctx.newPage();
  const problems = [], marks = [];
  page.on("pageerror", e => problems.push("pageerror: " + e.message));

  const moveTo = (x, y) => page.evaluate(([x, y]) => {
    const c = document.getElementById("__cur"); if (c) c.style.transform = `translate(${x}px,${y}px)`;
  }, [x, y]);
  const ping = () => page.evaluate(() => {
    const c = document.getElementById("__cur");
    if (c) { c.classList.remove("__click"); void c.offsetWidth; c.classList.add("__click"); }
  });

  // Keep the target on screen: the page is taller than the viewport, and Leaflet
  // stalls flyTo when its container is scrolled out of view.
  async function click(sel, { settle = 700, block = "nearest" } = {}) {
    const el = await page.waitForSelector(sel, { state: "visible", timeout: 15000 });
    await el.evaluate((e, b) => e.scrollIntoView({ block: b, behavior: "smooth" }), block);
    await page.waitForTimeout(700);
    const b = await el.boundingBox();
    if (b) { await moveTo(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(430); }
    await ping(); await page.waitForTimeout(160);
    await el.click(); await page.waitForTimeout(settle);
  }
  // Park the tab bar under the sticky header so the app fills the frame.
  async function pin() {
    await page.evaluate(() => {
      const tab = document.querySelector(".tab"), hdr = document.getElementById("site-header");
      if (!tab) return;
      const hh = hdr ? hdr.getBoundingClientRect().height : 0;
      window.scrollTo({ top: Math.max(0, window.scrollY + tab.getBoundingClientRect().top - hh - 6), behavior: "smooth" });
    });
    await page.waitForTimeout(900);
  }

  await page.goto(SITE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.DATA && window.DATA.length > 0, { timeout: 60000 });
  await page.waitForTimeout(2000);                       // let tiles paint
  await page.addStyleTag({ content: CURSOR_CSS });
  await page.evaluate(() => {                            // a cursor: Playwright's leaves no trace
    const d = document.createElement("div"); d.id = "__cur";
    d.innerHTML = `<svg width="22" height="22" viewBox="0 0 22 22"><path d="M2 1 L2 17 L6.3 13.1 L9.2 19.6 L12.1 18.3 L9.2 12 L15 12 Z" fill="#fff" stroke="#151515" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    document.body.appendChild(d);
  });
  const T0 = Date.now();
  const step = async (name, fn) => {
    const start = Date.now() - T0;
    try { await fn(); } catch (e) { problems.push(`${name}: ${String(e.message || e).split("\n")[0]}`); }
    marks.push({ name, start: +(start / 1000).toFixed(2), end: +((Date.now() - T0) / 1000).toFixed(2) });
  };

  await step("skip tour",   () => click('#tourCard button:has-text("Skip")', { settle: 520 }));
  await step("frame map",   async () => { await pin(); await page.waitForTimeout(700); });
  await step("search",      async () => {
    await click("#mapSearch", { settle: 350 });
    await page.type("#mapSearch", "CIC", { delay: 70 });
    await page.waitForTimeout(750);
    const item = await page.$('#mapResults div[data-id="cic"]');
    if (!item) throw new Error("CIC Cambridge not in #mapResults");
    const b = await item.boundingBox();
    if (b) { await moveTo(b.x + 40, b.y + b.height / 2); await page.waitForTimeout(450); }
    await item.click(); await page.waitForTimeout(1500);
  });
  // The marker popup leads to the drawer; the drawer is where the detail lives.
  await step("open drawer", async () => {
    const btn = await page.waitForSelector(".leaflet-popup-content .pop-btn", { state: "visible", timeout: 12000 });
    const b = await btn.boundingBox();
    if (b) { await moveTo(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(450); }
    await ping(); await btn.click();
    await page.waitForFunction(() => /\bopen\b/.test(document.getElementById("drawer")?.className || ""), { timeout: 10000 });
    await page.waitForTimeout(800);
  });
  // "Places to meet" is lazy: #meetBtn queries the vector tiles on demand.
  await step("places to meet", async () => {
    await page.evaluate(() => document.getElementById("meetBtn")?.scrollIntoView({ block: "center", behavior: "smooth" }));
    await page.waitForTimeout(550);
    const btn = await page.waitForSelector("#meetBtn", { state: "visible", timeout: 10000 });
    const b = await btn.boundingBox();
    if (b) { await moveTo(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(430); }
    await ping(); await btn.click();
    await page.waitForFunction(() => /quieter options/i.test(document.getElementById("drBody")?.innerText || ""), { timeout: 15000 });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const b = document.getElementById("drBody");
      [...b.querySelectorAll("*")].find(e => /places to meet/i.test(e.textContent || ""))
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    await page.waitForTimeout(2300);
  });
  await step("close drawer",  () => click("#drClose", { settle: 550 }));
  // A need filters the pins, and the map frames what it leaves, well beyond the Boston view.
  await step("need on map",   async () => {
    await pin();
    await click('#mapNeeds button:has-text("Compute")', { settle: 2600 });
    await click("#mapNote .filter-clear", { settle: 600 });
  });
  // Each view is shorter than the map, so the scroll clamps back up: re-pin after.
  for (const [name, sel, hold] of [["galaxy", "Galaxy", 1900], ["journey", "Founder Journey", 1700], ["directory", "Directory", 600]])
    await step(name, async () => { await pin(); await click(`.tab:has-text("${sel}")`, { settle: 600 }); await pin(); await page.waitForTimeout(hold); });
  // A founder's sentence, in their words: the page says these are the closest entries.
  await step("sentence",      async () => {
    await click("#dirSearch", { settle: 250 });
    await page.type("#dirSearch", "We need GPU time and a lab bench for our robots", { delay: 34 });
    await page.waitForFunction(() => /closest first/.test(document.getElementById("dirCount")?.textContent || ""), { timeout: 5000 });
    await page.waitForTimeout(2300);
  });

  await page.waitForTimeout(800);
  await ctx.close();
  await browser.close();

  if (problems.length) {
    console.error("tour had problems, not writing a gif:\n  " + problems.join("\n  "));
    process.exit(1);
  }

  const webm = fs.readdirSync(tmp).filter(f => f.endsWith(".webm")).map(f => path.join(tmp, f))[0];
  if (!webm) { console.error("no video was recorded"); process.exit(1); }

  // Recording starts at page load; T0 is after the data renders. Derive the
  // offset from the total so the beat marks line up with video time.
  const dur = Number(sh("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0",
    "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", webm]).toString().trim()) / 25;
  const offset = dur - (marks[marks.length - 1].end + 0.8);

  // Keep the action, drop the holds: a continuous 45 s recording is ~25 MB of GIF.
  const beat = (name, lead = 0, tail = 0) => {
    const m = marks.find(x => x.name === name);
    return `between(t,${(m.start + offset + lead).toFixed(2)},${(m.end + offset - tail).toFixed(2)})`;
  };
  const sel = [
    beat("frame map", 0.2, 0.2), beat("search", 0.1, 1.0), beat("places to meet", 0.1, 0.6),
    beat("need on map", 1.6, 1.6), beat("galaxy", 1.5, 1.3), beat("journey", 2.3, 1.9),
    beat("directory", 1.6, 0.0), beat("sentence", 0.5, 0.0),
  ].join("+");
  const vf = `select='${sel}',setpts=N/(25*TB),fps=${FPS},scale=${WIDTH}:-2:flags=lanczos`;

  const cut = path.join(tmp, "cut.mp4"), pal = path.join(tmp, "pal.png");
  sh("ffmpeg", ["-v", "error", "-y", "-i", webm, "-vf", vf, "-an", "-c:v", "libx264", "-crf", "12", "-preset", "slow", cut]);
  sh("ffmpeg", ["-v", "error", "-y", "-i", cut, "-vf", `palettegen=max_colors=${COLORS}:stats_mode=diff`, pal]);
  sh("ffmpeg", ["-v", "error", "-y", "-i", cut, "-i", pal, "-lavfi", "paletteuse=dither=none:diff_mode=rectangle", OUT]);

  const kb = (fs.statSync(OUT).size / 1048576).toFixed(1);
  const frames = sh("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=nb_frames", "-of", "csv=p=0", OUT]).toString().trim();
  console.log(`${OUT}: ${frames} frames, ${(frames / FPS).toFixed(1)}s, ${kb} MB`);
  console.log("beats:", marks.map(m => m.name).join(" · "));
  if (KEEP) console.log("intermediates kept in", tmp);
  else fs.rmSync(tmp, { recursive: true, force: true });
})();
