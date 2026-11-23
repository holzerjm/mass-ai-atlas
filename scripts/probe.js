/* One URL's health, the way the monthly link check reads it: ok, moved, blocked, broken, or an
 * error to retry. Used by scripts/linkcheck.js (every entry, monthly) and scripts/precheck.js (the
 * entries a pull request changes). Fetches with a browser's user agent and reads only the start of
 * the page.
 *
 *   const { probe } = require("./probe");   await probe("https://example.org")
 *     -> { cls: "ok" | "moved" | "blocked" | "broken" | "error", note }
 *
 * Classifications:
 *   moved    2xx but the final URL is on a different domain
 *   blocked  403/429/503, or a host that refuses bots: needs a HUMAN look
 *   broken   404/410/other 4xx-5xx, or a parked domain (a for-sale or expired page served with a 200)
 *   error    a network error or a timeout; linkcheck.js retries it once and then calls it broken
 */
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

// A domain that no longer belongs to the organization still answers 200 on its own
// host, so status and redirects alone call it healthy. These are the page shapes that
// give one away, matched against the raw page before any script runs. The first is
// why this exists: www.aimlconference.com became GoDaddy's for-sale lander, a one-line
// script redirect to /lander, and was reported healthy every month from the day its
// entry was added until a sweep in a real browser found it for sale.
const PARKED = [
  [/window\.location\.href\s*=\s*["']\/lander["']/, "redirects to a for-sale lander"],
  [/<title>[^<]*\b(?:is for sale|domain (?:name )?(?:is )?for sale|buy this domain)\b/i, "for-sale page"],
  [/<title>[^<]*\b(?:website expired|domain (?:has )?expired|this site has expired)\b/i, "expired site"],
];

// The start of a page is enough to recognize a parked one (that lander is 114 bytes),
// and downloading every homepage in full each month would be a waste.
async function pageStart(res, limit = 65536) {
  if (!res.body) return "";
  const reader = res.body.getReader(), dec = new TextDecoder();
  let text = "";
  try {
    while (text.length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return text;
}

async function probe(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { redirect: "follow", signal: ctl.signal,
      headers: { "User-Agent": UA, "Accept": "text/html,*/*" } });
    if ([403, 429, 503].includes(res.status)) return { cls: "blocked", note: `HTTP ${res.status}` };
    if (!res.ok && BOT_WALLED.has(host(url)))
      return { cls: "blocked", note: `HTTP ${res.status} — host refuses all bots` };
    if (!res.ok) return { cls: "broken", note: `HTTP ${res.status}` };
    if (host(res.url) && host(res.url) !== host(url)) return { cls: "moved", note: `now at ${res.url}` };
    // A body we could not read says nothing either way, so it stays ok rather than broken.
    const page = await pageStart(res).catch(() => "");
    const parked = PARKED.find(([re]) => re.test(page));
    if (parked) return { cls: "broken", note: `parked domain — ${parked[1]}` };
    return { cls: "ok" };
  } catch (e) {
    // Some bot walls drop the connection instead of answering 403, so the
    // allowance has to apply here too or the host still reports as broken.
    if (BOT_WALLED.has(host(url)))
      return { cls: "blocked", note: "connection refused — host refuses all bots" };
    return { cls: "error", note: e.name === "AbortError" ? "timeout" : (e.cause?.code || e.message) };
  } finally {
    clearTimeout(timer);   // only now: the 15s budget covers reading the page as well
  }
}

module.exports = { probe, host, UA };
