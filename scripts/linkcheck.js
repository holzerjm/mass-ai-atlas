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
 *   blocked  403/429/503 — likely bot-blocking, needs a HUMAN look, not a bot.
 *            Not the same as fine: in November 2026 one of these hosts had
 *            become a gambling site, and its bot wall was all a bot could see.
 *   broken   404/410/other 4xx-5xx, network error, or timeout (after 1 retry),
 *            or a parked domain: a for-sale or expired page served with a 200
 * Healthy URLs are counted but not listed.
 */

const { DATA } = require("./load-data").loadData();

const { probe } = require("./probe");

(async () => {
  const results = [];
  // An entry's application page rots on its own schedule, so it gets its own check.
  const queue = DATA.flatMap(d => d.applyUrl ? [d, { id: d.id, name: d.name, url: d.applyUrl }] : [d]);
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
