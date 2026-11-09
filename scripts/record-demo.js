#!/usr/bin/env node
/* ============================================================
   Re-record docs/demo.gif from the live site.

     npm ci                               # once: Playwright comes with the browser tests
     npx playwright install chromium      # once
     node scripts/record-demo.js          # writes docs/demo.gif

   Playwright is NOT a runtime dependency of this repo — those stay ajv + js-yaml.
   It reaches node_modules only through the browser tests' @playwright/test.
   ffmpeg must be on PATH; any build will do, as no optional filter is used.

   Why this exists: the demo on the README went stale twice (it showed the old
   name and 171 entries, then a count that no longer matched), because nobody
   could regenerate it. Now the tour is code: change the steps and the beat list
   below, re-run, done.

   Frames come from Chrome's screencast at twice the viewport's size, each
   stamped with when it was drawn. Playwright's recordVideo caps near 1 Mbit/s,
   which blurred the text: fine for a 760 px GIF, not for one at full width.

   Flags:
     --url <u>       page to record (default: the live site)
     --out <p>       output gif (default: docs/demo.gif)
     --width <px>    gif width (default 1200, the viewport's own width)
     --fps <n>       gif frame rate (default 10)
     --colors <n>    palette size, 2 to 256 (default 256)
     --keep          keep the captured frames, their timeline and the palette
   ============================================================ */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let chromium;
for (const mod of ["@playwright/test", "playwright"]) {
  try { ({ chromium } = require(mod)); break; } catch {}
}
if (!chromium) {
  console.error("Playwright not found. Run:  npm ci && npx playwright install chromium\n" +
                "(it comes with the browser tests' @playwright/test — deliberately not a runtime dep)");
  process.exit(1);
}

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const num = (n, d, lo, hi) => {
  const v = Number(flag(n, d));
  if (!(v >= lo && v <= hi)) { console.error(`${n} takes a number from ${lo} to ${hi}`); process.exit(1); }
  return v;
};
const SITE = flag("--url", "https://the-open-accelerator.com/ecosystem/");
const OUT  = path.resolve(flag("--out", path.join(__dirname, "..", "docs", "demo.gif")));
const KEEP = argv.includes("--keep");

// Capture at 2x and downscale: text stays crisp at the viewport's own width.
const W = 1200, H = 750, DPR = 2;
// The budget is 10 MB, which keeps the README quick to load. A clean capture
// leaves the still parts of the page identical from frame to frame, and the GIF stores
// only what changed: a hold costs 1-3 KB a frame, the Galaxy's drift about 120 KB, a
// map flight about 300 KB. So motion drives the size, then the palette: 10 fps x ~23 s
// x 1200 px x 256 colours lands around 9 MB, 128 colours around 7.4, and 12 fps at 256
// colours goes over 10.
const WIDTH  = Math.round(num("--width", W, 100, W * DPR));
const FPS    = num("--fps", 10, 1, 50);
const COLORS = Math.round(num("--colors", 256, 2, 256));

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
  // The screencast draws at the window's own scale, which deviceScaleFactor alone
  // leaves at 1: without the forced scale the frames come out 1200 px wide.
  const browser = await chromium.launch({
    channel: "chromium",   // full Chromium in new headless mode, where the GPU flags work
    args: ["--force-color-profile=srgb", "--font-render-hinting=none", `--force-device-scale-factor=${DPR}`,
           "--ignore-gpu-blocklist", "--enable-gpu-rasterization", ...(process.platform === "darwin" ? ["--use-angle=metal"] : [])],
  });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  await ctx.route(/cloudflareinsights\.com/, r => r.abort());   // keep the recording out of the site's analytics
  // The first-visit tour is in the demo (the first step skips it); the banner of new
  // organizations isn't, so it starts out read.
  await ctx.addInitScript(() => { try { localStorage.setItem("toa-atlas-newbanner", "9999"); } catch (e) {} });
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

  // Chrome sends a frame only when the picture changes, so each frame lasts until the
  // next one. `t` is when Chrome drew it, `got` when it arrived here.
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", f => {
    const file = path.join(tmp, `f${String(frames.length).padStart(6, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, "base64"));
    frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000, got: Date.now() / 1000 });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W * DPR, maxHeight: H * DPR, everyNthFrame: 1 });

  const step = async (name, fn) => {
    const start = Date.now() / 1000;
    try { await fn(); } catch (e) { problems.push(`${name}: ${String(e.message || e).split("\n")[0]}`); }
    marks.push({ name, start, end: Date.now() / 1000 });
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
  // A tab click jumps the page to the top: re-pin after.
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
  await cdp.send("Page.stopScreencast");
  await ctx.close();
  await browser.close();

  if (problems.length) {
    console.error("tour had problems, not writing a gif:\n  " + problems.join("\n  "));
    process.exit(1);
  }
  if (!frames.length) { console.error("the screencast sent no frames"); process.exit(1); }

  // Put the frames on this script's clock, which the beat marks use. The shortest trip
  // from Chrome to here is as close as the two clocks can be lined up.
  const skew = Math.min(...frames.map(f => f.got - f.t));
  const shown = frames.map(f => f.t + skew);

  // Keep the action, drop the holds: the whole 43 s tour would be about 20 MB.
  // A beat runs from `lead` seconds after its step starts to `tail` before it ends, on
  // the frames' own clock. After a tab click, pin() has the page parked again by about
  // 3.4 s into the step, so each view's beat starts at 3.6.
  const beat = (name, lead = 0, tail = 0) => {
    const m = marks.find(x => x.name === name);
    return [m.start + lead, m.end - tail];
  };
  const windows = [
    beat("frame map", 0.6, 0.2), beat("search", 0.1, 0.0), beat("places to meet", 0.1, 0.6),
    beat("need on map", 1.6, 1.6), beat("galaxy", 3.6, 0.0), beat("journey", 3.6, 0.3),
    beat("directory", 3.6, 0.0), beat("sentence", 0.5, 0.0),
  ];
  // Play each window in real time at FPS: every tick takes the frame on screen then.
  const picks = [];
  for (const [a, b] of windows)
    for (let k = 0, i = 0; a + k / FPS < b; k++) {
      while (i + 1 < frames.length && shown[i + 1] <= a + k / FPS) i++;
      picks.push(frames[i].file);
    }

  const seq = path.join(tmp, "seq"), pal = path.join(tmp, "pal.png");
  fs.mkdirSync(seq);
  picks.forEach((f, n) => fs.linkSync(f, path.join(seq, `${String(n).padStart(6, "0")}.jpg`)));
  const input = ["-framerate", String(FPS), "-i", path.join(seq, "%06d.jpg")];
  // To RGB at full size, then down: scaling the JPEG's YUV straight to RGB would
  // halve its colour detail across.
  const scale = `format=rgb24,scale=${WIDTH}:-1:flags=lanczos`;
  sh("ffmpeg", ["-v", "error", "-y", ...input, "-vf", `${scale},palettegen=max_colors=${COLORS}:stats_mode=diff`, pal]);
  sh("ffmpeg", ["-v", "error", "-y", ...input, "-i", pal, "-lavfi", `[0:v]${scale}[v];[v][1:v]paletteuse=dither=none:diff_mode=rectangle`, OUT]);

  const mb = fs.statSync(OUT).size / 1e6;
  const dims = f => sh("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", f]).toString().trim();
  const span = frames[frames.length - 1].t - frames[0].t;
  console.log(`${OUT}: ${dims(OUT)}, ${picks.length} frames at ${FPS} fps (${(picks.length / FPS).toFixed(1)} s), ${COLORS} colours, ${mb.toFixed(1)} MB`);
  console.log(`captured ${frames.length} frames of ${dims(frames[0].file)} over ${span.toFixed(1)} s (${(frames.length / span).toFixed(1)} a second)`);
  console.log("beats:", marks.map(m => `${m.name} ${(m.end - m.start).toFixed(1)}s`).join(" · "));
  if (mb > 10) console.warn("over the 10 MB budget, which keeps the README quick to load: try a lower --fps or --colors.");
  if (KEEP) {
    fs.writeFileSync(path.join(tmp, "timeline.json"), JSON.stringify({ fps: FPS, skew, marks, windows,
      frames: frames.map((f, i) => ({ file: path.basename(f.file), shown: shown[i] })) }, null, 1));
    console.log("intermediates kept in", tmp);
  } else fs.rmSync(tmp, { recursive: true, force: true });
})();
