#!/usr/bin/env node
/* Post-deploy check: is the LIVE site serving exactly the files this checkout
   just deployed? Run by deploy.yml after the rsync steps; safe to run locally
   (read-only GETs):

     node tests/deploy/verify-live.js                     # default files, ~3 min of retries
     node tests/deploy/verify-live.js --timeout 20 data/entities.yml

   Why: rsync exiting 0 only proves the origin accepted the files. On 2026-08-31
   the TOA site's own deploy overwrote a fresh atlas deploy with a June snapshot,
   and nothing noticed. This fetches each file through Cloudflare's proxy (the
   path real visitors take) and compares sha256 with the local file, retrying
   with backoff before giving up.

   What it sees: the unique ?deploy-check= query means Cloudflare can never
   answer from its edge cache, so this checks what the ORIGIN serves through the
   proxy (plus Cloudflare's HTML rewrites, below). It cannot see an edge-cached
   copy of the plain URLs. On 2026-09-30 none was edge-cached (cf-cache-status:
   DYNAMIC for /ecosystem/, index.html, data/entities.yml, events/ and
   map-style-dark.json), so visitors get the origin's copy too; a Cloudflare
   cache rule for /ecosystem/ would change that, and this check would not notice.

   Cloudflare's Email Address Obfuscation rewrites every mailto: in HTML it
   serves (verified 2026-09-30: live index.html differed from main only by that
   rewrite). The rewrite is reversed exactly before hashing — see
   undoEmailObfuscation() — so a real difference still fails.

   Each file ends as one of:
     matched     the live bytes equal this checkout's;
     mismatched  the live site answered, with different bytes or 404/410 —
                 proof it is not serving this deploy;
     unverified  no usable answer (network error, timeout, a Cloudflare
                 challenge, 403/429/5xx) — says nothing either way about what
                 visitors get, so it is reported as "could not check".
   Exit 0 = every file matched. Exit 1 = anything else within the budget. In
   GitHub Actions the per-file report and the two lists are written to
   $GITHUB_OUTPUT (`report`, `mismatched`, `unverified`; deploy.yml words its
   Slack alert from them) and to $GITHUB_STEP_SUMMARY. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..", "..");
// index.html fetches every one of these at load, so a deploy that misses one
// leaves the page showing its "data failed to load" banner.
const DEFAULT_FILES = ["index.html", "atlas-data.js", "data/entities.yml",
  "data/entities.schema.yml", "data/categories.yml", "data/categories.schema.yml",
  "data/stages.yml", "data/stages.schema.yml", "events/index.html", "map-style-dark.json"];

const args = process.argv.slice(2);
let base = "https://the-open-accelerator.com/ecosystem/";
// Time budget for the whole check, fetches included, checked before each retry.
// The retry schedule below waits 180 s in all; the extra 30 s is for the
// fetches themselves, so the last retry still runs on a normal day, and a slow
// origin gets fewer retries rather than a much longer check. (At a 180 s budget
// the last 60 s retry could never start: the earlier waits already add up to
// 120 s, plus fetch time — found in review, 2026-09-30.)
let budgetS = 210;
const files = [];
for(let i = 0; i < args.length; i++){
  if(args[i] === "--base") base = args[++i];
  else if(args[i] === "--timeout") budgetS = Number(args[++i]);
  else files.push(args[i]);
}
if(!base.endsWith("/")) base += "/";   // directory URL: data/*.yml resolves relatively
if(!files.length) files.push(...DEFAULT_FILES);

const sha256 = buf => crypto.createHash("sha256").update(buf).digest("hex");
const short = h => h ? h.slice(0, 12) : "—";

// Cloudflare encodes an address as hex: first byte is the key, each following
// byte is XORed with it.
function cfDecode(hex){
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for(let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}
// Reverses the three rewrites Email Address Obfuscation makes: the injected
// decoder <script>, mailto: hrefs, and addresses in text. Only exact Cloudflare
// markup is touched, so anything else that differs still fails the hash.
function undoEmailObfuscation(html){
  return html
    .replace(/<script data-cfasync="false" src="\/cdn-cgi\/scripts\/[0-9a-f]+\/cloudflare-static\/email-decode\.min\.js"><\/script>/g, "")
    .replace(/href="\/cdn-cgi\/l\/email-protection#([0-9a-f]+)"/g, (_, hex) => `href="mailto:${cfDecode(hex)}"`)
    .replace(/<span class="__cf_email__" data-cfemail="([0-9a-f]+)">\[email&#160;protected\]<\/span>/g, (_, hex) => cfDecode(hex))
    .replace(/<a href="\/cdn-cgi\/l\/email-protection" class="__cf_email__" data-cfemail="([0-9a-f]+)">\[email&#160;protected\]<\/a>/g, (_, hex) => cfDecode(hex));
}

async function fetchLive(file, attempt){
  const tag = `${(process.env.GITHUB_SHA || "local").slice(0, 12)}-${attempt}-${Date.now()}`;
  const url = `${base}${file}?deploy-check=${tag}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache", "Pragma": "no-cache", "User-Agent": "boston-ai-atlas-deploy-check" },
    signal: AbortSignal.timeout(20000),
  });
  let body = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get("content-type") || "";
  const rewritten = type.includes("text/html") && body.includes("/cdn-cgi/");
  if(rewritten) body = Buffer.from(undoEmailObfuscation(body.toString("utf8")), "utf8");
  return {
    status: res.status, bytes: body.length, sha: res.ok ? sha256(body) : null, rewritten,
    challenged: !!res.headers.get("cf-mitigated"),
    cache: res.headers.get("cf-cache-status") || "—", lastModified: res.headers.get("last-modified") || "—",
  };
}

// "mismatched" only when the live site actually answered and the answer is not
// this deploy (other bytes, or the file is gone). Everything else that failed
// is "unverified": a runner that can't reach the site, or that Cloudflare
// challenges, learns nothing about what visitors see.
function verdict(r, want){
  if(r.sha && r.sha === want) return "matched";
  if(r.error) return "unverified";
  if(r.challenged) return "unverified";
  if(r.status >= 200 && r.status < 300) return "mismatched";
  if(r.status === 404 || r.status === 410) return "mismatched";
  return "unverified";
}

(async () => {
  const want = {};
  for(const f of files) want[f] = sha256(fs.readFileSync(path.join(ROOT, f)));
  const last = {};
  let pending = [...files];
  const started = Date.now();
  // 3 min of waiting in all (see budgetS): gives a racing writer — the TOA
  // site's own deploy, a slow origin disk — time to settle before a verdict,
  // and rides out a brief network or Cloudflare error on the runner
  const delays = [0, 5, 10, 15, 20, 30, 40, 60];
  for(let attempt = 1; attempt <= delays.length && pending.length; attempt++){
    const wait = delays[attempt - 1] * 1000;
    if(Date.now() - started + wait > budgetS * 1000) break;
    if(wait){
      console.log(`… ${pending.join(", ")} not matching yet; retrying in ${wait / 1000}s`);
      await new Promise(r => setTimeout(r, wait));
    }
    for(const f of pending){
      try{ last[f] = await fetchLive(f, attempt); }
      catch(e){ last[f] = { error: e.message || String(e) }; }
    }
    pending = pending.filter(f => last[f].sha !== want[f]);
  }

  const verdicts = Object.fromEntries(files.map(f => [f, verdict(last[f] || { error: "not checked" }, want[f])]));
  const mismatched = files.filter(f => verdicts[f] === "mismatched");
  const unverified = files.filter(f => verdicts[f] === "unverified");
  const lines = files.map(f => {
    const r = last[f] || { error: "not checked" };
    if(verdicts[f] === "matched") return `✓ ${f} matches (${short(want[f])}${r.rewritten ? ", after undoing Cloudflare email obfuscation" : ""})`;
    if(r.error) return `? ${f}: could not check — fetch failed (${r.error})`;
    if(r.challenged) return `? ${f}: could not check — Cloudflare challenged the request (HTTP ${r.status})`;
    if(verdicts[f] === "unverified") return `? ${f}: could not check — HTTP ${r.status}`;
    if(r.status >= 400) return `✗ ${f}: HTTP ${r.status} — not on the live site`;
    return `✗ ${f}: live ${short(r.sha)} (${r.bytes} bytes, cf-cache ${r.cache}, last-modified ${r.lastModified}) ≠ deployed ${short(want[f])}`;
  });
  const secs = Math.round((Date.now() - started) / 1000);
  console.log(lines.join("\n"));
  if(mismatched.length) console.log(`LIVE MISMATCH after ${secs}s: ${mismatched.length} of ${files.length} file(s) are not what was deployed — ${base}`);
  if(unverified.length) console.log(`COULD NOT CHECK after ${secs}s: ${unverified.length} of ${files.length} file(s) — ${base}`);
  if(!pending.length) console.log(`OK: all ${files.length} files live and identical to this checkout (${secs}s) — ${base}`);

  if(process.env.GITHUB_OUTPUT){
    const eof = "EOF_" + crypto.randomBytes(6).toString("hex");
    fs.appendFileSync(process.env.GITHUB_OUTPUT,
      `report<<${eof}\n${lines.join("\n")}\n${eof}\nmismatched=${mismatched.join(" ")}\nunverified=${unverified.join(" ")}\n`);
  }
  if(process.env.GITHUB_STEP_SUMMARY){
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### Live site check\n\n${lines.map(l => "- " + l).join("\n")}\n\n`);
  }
  process.exit(pending.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
