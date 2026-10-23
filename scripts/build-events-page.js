// Assembler for events/index.html: lifts the standard TOA chrome (header +
// mobile nav + footer + theme toggle) verbatim from the atlas's index.html
// and wraps it around the events page content. events/index.html is GENERATED
// — edit this script (or index.html's chrome) and re-run:
//   node scripts/build-events-page.js
const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..");
const src = fs.readFileSync(REPO + "/index.html", "utf8");

// The contribution links below must point at whichever repository this copy IS,
// not at the one it was copied from. index.html's `const GH_REPO` is the single
// place that decides; read it rather than hardcoding, so that setting GH_REPO
// (or running scripts/setup-labels.sh --set-repo) fixes the atlas page AND this
// one together. Hardcoded here until 2026-10-23, when a dry run of the hackathon
// setup path found a copy's "Add your event" links filing issues upstream.
const GH_REPO = (src.match(/^const GH_REPO = "([^"]+)"/m) || [])[1];
if (!GH_REPO) throw new Error("GH_REPO: `const GH_REPO = \"owner/repo\"` was not found in index.html — the events page would ship contribution links pointing at someone else's repository");
const issueUrl = (template) => `https://github.com/${GH_REPO}/issues/new?template=${template}`;

function between(startMark, endMark, from = 0) {
  const a = src.indexOf(startMark, from);
  if (a === -1) throw new Error("start not found: " + startMark);
  const b = src.indexOf(endMark, a);
  if (b === -1) throw new Error("end not found: " + endMark);
  return src.slice(a, b + endMark.length);
}

const tailwind = between('<script src="https://cdn.tailwindcss.com"></script>', "</script>\n<script>") // CDN tag up to config open
  .replace(/<script>$/, "");
const twConfig = between("tailwind.config = {", "</script>");
const bootstrap = between("<script>(function(){try{if(localStorage.getItem('toa-atlas-theme')", "</script>");
const header = between("<!-- ============ STANDARD TOA SITE HEADER ============ -->", "</header>");
const mobileNav = between("<!-- Mobile Nav Overlay -->", "</div>");
// The atlas page fills #footCount from the dataset at runtime. This page ships no
// such script, so any number lifted into it can only go stale — it read "101
// organizations" for months. Baking the real count in at build time (as this did)
// only moved the problem: nothing in CI re-runs this generator, so the number was
// correct once and then frozen. Drop the clause instead; the atlas page still
// shows a live count, and scripts/lint-copy.js keeps a literal from creeping back.
const footerRaw = between('<footer class="footer">', "</footer>");
const COUNT_CLAUSE = /\s*·\s*<span id="footCount"[^>]*>[^<]*<\/span>\s*organizations across Massachusetts\./;
const withoutCount = footerRaw.replace(COUNT_CLAUSE, ".");
if (withoutCount === footerRaw) throw new Error("footer: the #footCount clause was not found in index.html — the events page would ship a count it cannot keep current");
// Same reasoning for the curation month. The atlas page fills #footCurated from the
// newest lastVerified in the data; this page has no script, so a month lifted into
// it could only rot — it said "Curated June 2026" into October. Drop the clause
// rather than bake in a date nothing regenerates.
const CURATED_CLAUSE = /\s*·\s*Curated\s*<span id="footCurated"[^>]*>[^<]*<\/span>/;
const footer = withoutCount.replace(CURATED_CLAUSE, "");
if (footer === withoutCount) throw new Error("footer: the #footCurated clause was not found in index.html — the events page would ship a curation date it cannot keep current");
const footerCss = between("/* ---------- FOOTER ---------- */", ".footer a{color:var(--gold);text-decoration:none}");
// chrome script: from toggleMobileMenu's containing <script> to the updateLogos sync call
const scriptStart = src.lastIndexOf("<script>", src.indexOf("function toggleMobileMenu"));
const scriptEnd = src.indexOf("</script>", src.indexOf("updateLogos(document.documentElement.classList.contains"));
const chromeJs = src.slice(scriptStart, scriptEnd + "</script>".length)
  .replace("if(typeof setMapTiles==='function')setMapTiles();", "");

const page = `<!doctype html>
<!-- GENERATED FILE — do not edit by hand. Rebuild with: node scripts/build-events-page.js (see docs/events-guide.md) -->
<html lang="en" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Boston AI Events — the next 10 days</title>
<meta name="description" content="AI community events across Greater Boston for the next 10 days — meetups, workshops, demo nights and hackathons. Refreshed every Monday by the Mass AI Atlas.">
<link rel="canonical" href="https://the-open-accelerator.com/ecosystem/events/">
<meta property="og:title" content="Boston AI Events — the next 10 days">
<meta property="og:description" content="AI community events across Greater Boston, refreshed every Monday. A companion to the Mass AI Atlas by The Open Accelerator.">
<meta property="og:url" content="https://the-open-accelerator.com/ecosystem/events/">
<meta property="og:image" content="https://people.redhat.com/jholzer/TOA/android-icon-192x192.png">
<link rel="icon" href="https://the-open-accelerator.com/favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Red+Hat+Display:wght@500;700;900&family=Red+Hat+Text:ital,wght@0,400;0,500;1,400&family=Red+Hat+Mono:wght@400;500&display=swap">
${tailwind}<script>
${twConfig}
${bootstrap}
<style>
  :root{--bg:#0d0f12;--panel:#16191e;--panel2:#1c2027;--line:#272c35;--text:#e8eaed;
    --muted:#9aa1ab;--faint:#6b7280;--gold:#ffc600;--red:#ff5c45;--ok:#4ade80}
  html:not(.dark){--bg:#faf9f7;--panel:#ffffff;--panel2:#f3f1ee;--line:#e2ddd6;--text:#1c1a17;
    --muted:#5d574e;--faint:#8a8478;--gold:#b45309;--red:#ee0000;--ok:#15803d}
  *{margin:0;padding:0;box-sizing:border-box}
  /* Tailwind preflight is off (matching the atlas): restore the border base
     its utilities rely on, and the link reset for the ported chrome. */
  *,::before,::after{border-width:0;border-style:solid}
  #site-header a,#mobile-nav a{text-decoration:none}
  body{background:var(--bg);color:var(--text);font-family:"Red Hat Text",-apple-system,sans-serif;
    font-size:15.5px;line-height:1.5}
  .wrap{max-width:780px;margin:0 auto;padding:40px 20px 90px}
  .eyebrow{font-family:"Red Hat Mono",monospace;font-size:11.5px;letter-spacing:.14em;
    text-transform:uppercase;color:var(--red);margin-bottom:10px}
  h1{font-family:"Red Hat Display",sans-serif;font-weight:900;font-size:36px;line-height:1.05;
    margin-bottom:8px;text-wrap:balance}
  .stand{color:var(--muted);max-width:62ch}
  .topnav{display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin:20px 0 0;
    border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:11px 2px;font-size:13.5px}
  .topnav a{color:var(--gold);text-decoration:none}
  .topnav a:hover{text-decoration:underline}
  .topnav .meta{color:var(--faint);margin-left:auto;font-size:12px}
  .day{margin-top:34px}
  .day h2{font-family:"Red Hat Display",sans-serif;font-weight:700;font-size:17px;
    display:flex;align-items:baseline;gap:10px}
  .day h2 .dow{color:var(--red)}
  .day h2 .tonight{font-size:11px;font-family:"Red Hat Mono",monospace;letter-spacing:.08em;
    color:var(--gold);border:1px solid var(--gold);border-radius:999px;padding:2px 8px}
  .ev{display:flex;gap:14px;border:1px solid var(--line);border-radius:10px;background:var(--panel);
    padding:13px 15px;margin-top:9px;cursor:pointer;transition:border-color .15s}
  .ev:hover{border-color:var(--gold)}
  .ev .time{font-family:"Red Hat Mono",monospace;font-size:12.5px;color:var(--muted);
    min-width:72px;padding-top:2px;white-space:nowrap}
  .ev .title{color:var(--text);text-decoration:none;font-weight:500;font-size:15px}
  .ev:hover .title{color:var(--gold)}
  .ev .sub{color:var(--muted);font-size:13px;margin-top:3px}
  a.atlas{color:var(--gold);text-decoration:none;white-space:nowrap}
  a.atlas:hover{text-decoration:underline}
  .empty{color:var(--muted);border:1px dashed var(--line);border-radius:10px;padding:22px;
    margin-top:26px;text-align:center}
  .contrib{margin-top:44px;border:1px solid var(--line);border-left:3px solid var(--red);
    border-radius:10px;background:var(--panel);padding:16px 20px}
  .contrib h3{font-family:"Red Hat Display",sans-serif;font-size:16px;margin-bottom:6px}
  .contrib p{color:var(--muted);font-size:14px}
  .contrib a{color:var(--gold);text-decoration:none}
  .contrib a:hover{text-decoration:underline}
  :focus-visible{outline:2px solid var(--gold);outline-offset:2px}
${footerCss}
  @media (max-width:520px){h1{font-size:29px}.ev{flex-direction:column;gap:4px}.ev .time{min-width:0}}
</style>
</head>
<body>
${header}</header>
${mobileNav}
<div class="wrap">
  <p class="eyebrow">The Open Accelerator · Mass AI Atlas</p>
  <h1>Boston AI Events</h1>
  <p class="stand">Every AI community event we can find across Greater Boston for the next
  10 days — meetups, workshops, demo nights, hackathons. Refreshed every Monday morning.</p>
  <div class="topnav">
    <a href="../">🗺️ The Atlas</a>
    <a href="https://the-open-accelerator.com/calendar/">🗓️ TOA's own calendar</a>
    <a href="${issueUrl("suggest-event.yml")}" target="_blank" rel="noopener">➕ Add your event</a>
    <span class="meta" id="genLine">loading…</span>
  </div>

  <div id="list"><div class="empty">Loading events…</div></div>

  <div class="contrib" id="add">
    <h3>Get your event on this list</h3>
    <p>Three ways, easiest first: run your events on a public
    <b>Luma calendar</b> and <a href="${issueUrl("suggest-event.yml")}">tell us its address</a>
    (we'll ingest everything you publish, forever) · submit it to
    <a href="https://luma.com/toa">TOA's Luma calendar</a> (admin-approved) · or
    <a href="${issueUrl("suggest-event.yml")}">suggest a one-off event</a>.
    AI-relevant, Greater Boston, open to the community — that's the whole bar.</p>
  </div>

  <p style="margin-top:36px;color:var(--faint);font-size:12px">
    A companion to the <a style="color:var(--faint)" href="../">Mass AI Atlas</a> · sources: community Luma calendars,
    Luma's Boston AI feed, and <a style="color:var(--faint)" href="https://boston.aitinkerers.org/">AI Tinkerers Boston</a> ·
    aggregation approach builds on <a style="color:var(--faint)" href="https://github.com/nkpng2k/startup-event-scraper">nkpng2k's startup-event-scraper</a> (Apache-2.0)
  </p>
</div>
${footer}</footer>
<script>
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const TZ = "America/New_York";
const fmtTime = d => new Intl.DateTimeFormat("en-US",{hour:"numeric",minute:"2-digit",timeZone:TZ}).format(d);
const dayKey = d => new Intl.DateTimeFormat("en-CA",{dateStyle:"short",timeZone:TZ}).format(d);
const fmtDay = d => ({
  dow: new Intl.DateTimeFormat("en-US",{weekday:"long",timeZone:TZ}).format(d),
  rest: new Intl.DateTimeFormat("en-US",{month:"long",day:"numeric",timeZone:TZ}).format(d),
});
(async () => {
  const list = document.getElementById("list");
  let data;
  try { data = await (await fetch("../events.json", {cache:"no-cache"})).json(); }
  catch(e){ list.innerHTML = '<div class="empty">Couldn’t load events right now — try again shortly.</div>'; return; }
  const gen = new Date(data.generated);
  document.getElementById("genLine").textContent =
    "refreshed " + new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",timeZone:TZ}).format(gen);
  const upcoming = (data.events||[]).map(e=>({...e, startD:new Date(e.start)}))
    .filter(e=>e.startD > new Date(Date.now()-3*3600e3))
    .sort((a,b)=>a.startD-b.startD);
  if(!upcoming.length){
    list.innerHTML = '<div class="empty">Quiet stretch — no AI events found for the coming days.<br>Know one we missed? Add it below. 👇</div>';
    return;
  }
  const today = dayKey(new Date());
  const groups = new Map();
  for(const e of upcoming){ const k=dayKey(e.startD); if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(e); }
  let html = "";
  for(const [k, evs] of groups){
    const {dow, rest} = fmtDay(evs[0].startD);
    html += \`<section class="day"><h2><span class="dow">\${esc(dow)}</span> \${esc(rest)}\` +
      (k===today ? ' <span class="tonight">today</span>' : "") + \`</h2>\`;
    for(const e of evs){
      const who = [e.organizer, e.venue].filter(Boolean).map(esc).join(" · ");
      const atlas = e.atlasId ? \` <a class="atlas" href="../?entry=\${encodeURIComponent(e.atlasId)}">→ on the atlas</a>\` : "";
      html += \`<div class="ev" data-url="\${esc(e.url)}" role="link" tabindex="0" aria-label="\${esc(e.title)}">\` +
        \`<span class="time">\${esc(fmtTime(e.startD))}</span>\` +
        \`<span><a class="title" href="\${esc(e.url)}" target="_blank" rel="noopener">\${esc(e.title)}</a>\` +
        \`<div class="sub">\${who}\${atlas}</div></span></div>\`;
    }
    html += \`</section>\`;
  }
  list.innerHTML = html;
  list.addEventListener("click", ev=>{
    if(ev.target.closest("a")) return;                       // inner links win
    const card = ev.target.closest(".ev");
    if(card && card.dataset.url) window.open(card.dataset.url, "_blank", "noopener");
  });
  list.addEventListener("keydown", ev=>{
    if(ev.key!=="Enter") return;
    const card = ev.target.closest(".ev");
    if(card && card.dataset.url) window.open(card.dataset.url, "_blank", "noopener");
  });
})();
</script>
${chromeJs}
</body>
</html>
`;
fs.writeFileSync(REPO + "/events/index.html", page);
console.log("events/index.html assembled:", page.length, "bytes; chrome pieces: header",
  header.length, "· mobileNav", mobileNav.length, "· footer", footer.length, "· js", chromeJs.length);
