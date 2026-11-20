#!/usr/bin/env node
/* Keeps both atlas pages loading the shared loader at an address that changes with it.

   Both pages load atlas-data.js as atlas-data.js?v=<version>, where <version> is
   the first 10 hex digits of the sha256 of atlas-data.js, with CRLF line endings
   read as LF so a Windows checkout computes the same value. Cloudflare keeps .js
   files at its edge for about 2 hours and tells browsers to keep them for 4 (its
   zone defaults; the origin sends no Cache-Control), so a changed loader at an
   unchanged address could pair a new page with an old loader for hours.
   A new version is a new address, which neither Cloudflare nor a browser has
   cached. Cloudflare keys its cache on the query string, so this works without
   any change to Cloudflare or the server.

     node scripts/loader-version.js           # check: exit 1 if either page is stale
     node scripts/loader-version.js --write   # update both pages to the current version

   validate.yml runs the check on every pull request. The committed pages ship as-is.

   This relies on the deploy putting the loader in place no later than either page.
   deploy.yml uploads them in one rsync command, and rsync sorts its file list, so
   atlas-data.js lands before both pages. If a page were ever uploaded first,
   in a command of its own, a visitor in the gap would make Cloudflare cache the
   old loader under the new version for about 2 hours. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const LOADER = path.join(ROOT, "atlas-data.js");
const PAGES = ["index.html", "atlas3d.html"];
// The one tag that loads the loader, with or without a version.
const TAG = /<script src="atlas-data\.js(?:\?v=([0-9a-f]*))?"><\/script>/g;

function reportError(page, message) {
  if (process.env.GITHUB_ACTIONS) console.log(`::error file=${page}::${message}`);
  console.error(`loader-version: ${message}`);
  process.exitCode = 1;
}

const version = crypto.createHash("sha256")
  .update(fs.readFileSync(LOADER, "utf8").replace(/\r\n/g, "\n"))
  .digest("hex")
  .slice(0, 10);

// Check both tags before writing, so a missing or duplicate tag leaves both files intact.
const pages = PAGES.map(page => {
  const file = path.join(ROOT, page);
  const html = fs.readFileSync(file, "utf8");
  const tags = [...html.matchAll(TAG)];
  if (tags.length !== 1) {
    reportError(page, `expected exactly one <script src="atlas-data.js?v=..."></script> tag in ${page}, found ${tags.length}`);
  }
  return { page, file, html, current: tags[0]?.[1] || "" };
});
if (process.exitCode) process.exit(process.exitCode);

const write = process.argv.includes("--write");
for (const { page, file, html, current } of pages) {
  if (current === version) {
    console.log(`loader-version: OK, ${page} loads atlas-data.js?v=${version}`);
  } else if (write) {
    fs.writeFileSync(file, html.replace(TAG, `<script src="atlas-data.js?v=${version}"></script>`));
    console.log(`loader-version: ${page} now loads atlas-data.js?v=${version}` +
      (current ? ` (was ${current})` : ""));
  } else {
    reportError(page, `${page} loads atlas-data.js${current ? `?v=${current}` : " with no version"}, ` +
      `but atlas-data.js is at version ${version}. ` +
      `Run node scripts/loader-version.js --write and commit the updated pages.`);
  }
}
