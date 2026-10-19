#!/usr/bin/env node
/* Link-rot checker — fetches every entry's url and classifies the result.
 * A report, not a gate: ALWAYS exits 0. Run monthly by CI (with the
 * verification rota) and postable to Slack; safe to run locally.
 *
 *   node scripts/linkcheck.js            full report
 *   node scripts/linkcheck.js --plain    terse lines only (for Slack)
 *
 * Classifications:
 *   moved    2xx but the final URL is on a different domain — update the url
 *   blocked  403/429/503 — likely bot-blocking, needs a HUMAN look, not a bot
 *   broken   404/410/other 4xx-5xx, network error, or timeout (after 1 retry)
 * Healthy URLs are counted but not listed.
 */

const { DATA } = require("./load-data").loadData();

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 mass-ai-atlas-linkcheck";
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

// Hosts that refuse every automated request with something other than 403/429/503,
// so the status says nothing about the entry's URL. metacareers.com answers HTTP 400
// to every path including its own root and a nonsense path; it loads fine in a real
// browser. Without this, it reports BROKEN every month and trains us to skim the
// report. Verified by hand 2026-09-21 — drop a host from here if it starts behaving.
// Hosts that refuse automated requests outright — each verified by hand in a real
// browser, so a 403 or a dropped connection from them says nothing about the link.
// Listed so the monthly report does not cry wolf on entries we just checked.
const BOT_WALLED = new Set(["metacareers.com", "meta.com",
  "mitre.org", "analog.com", "evolv.com"]);

async function probe(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { redirect: "follow", signal: ctl.signal,
      headers: { "User-Agent": UA, "Accept": "text/html,*/*" } });
    clearTimeout(timer);
    if ([403, 429, 503].includes(res.status)) return { cls: "blocked", note: `HTTP ${res.status}` };
    if (!res.ok && BOT_WALLED.has(host(url)))
      return { cls: "blocked", note: `HTTP ${res.status} — host refuses all bots` };
    if (!res.ok) return { cls: "broken", note: `HTTP ${res.status}` };
    if (host(res.url) && host(res.url) !== host(url)) return { cls: "moved", note: `now at ${res.url}` };
    return { cls: "ok" };
  } catch (e) {
    clearTimeout(timer);
    // Some bot walls drop the connection instead of answering 403, so the
    // allowance has to apply here too or the host still reports as broken.
    if (BOT_WALLED.has(host(url)))
      return { cls: "blocked", note: "connection refused — host refuses all bots" };
    return { cls: "error", note: e.name === "AbortError" ? "timeout" : (e.cause?.code || e.message) };
  }
}

(async () => {
  const results = [];
  const queue = [...DATA];
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const d = queue.shift();
      let r = await probe(d.url);
      if (r.cls === "error") r = await probe(d.url);           // one retry
      if (r.cls === "error") r = { cls: "broken", note: r.note };
      results.push({ id: d.id, name: d.name, url: d.url, ...r });
    }
  });
  await Promise.all(workers);

  const by = (c) => results.filter(r => r.cls === c);
  const plain = process.argv.includes("--plain");
  const line = (r) => `  ${r.id} — ${r.url} (${r.note})`;

  console.log(`Link check: ${by("ok").length} of ${results.length} URLs healthy` +
    ` · ${by("broken").length} broken · ${by("moved").length} moved · ${by("blocked").length} blocked (need a human look)`);
  if (by("broken").length) console.log(`\nBROKEN — fix or flag the entry:\n` + by("broken").map(line).join("\n"));
  if (by("moved").length) console.log(`\nMOVED — update the url field:\n` + by("moved").map(line).join("\n"));
  if (!plain && by("blocked").length)
    console.log(`\nBLOCKED — the site refuses bots; open it in a browser before assuming it's fine:\n` + by("blocked").map(line).join("\n"));

  // Exit explicitly. Node's fetch keeps pooled sockets alive after the last
  // response, which can hold the event loop open indefinitely once we have
  // swept ~170 hosts: on 2026-09-01 this printed the whole report in 40s and
  // then idled until GitHub's 6-hour cap cancelled the job, so the rota and
  // the Slack post never ran. Flush stdout first — it is a pipe under `| tee`,
  // where writes are async and process.exit() would truncate the report — and
  // race a short timer so a stuck flush can never hang the job either.
  await Promise.race([
    new Promise(resolve => process.stdout.write("", resolve)),
    new Promise(resolve => setTimeout(resolve, 2000)),
  ]);
  process.exit(0);
})();
