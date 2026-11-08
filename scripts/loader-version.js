#!/usr/bin/env node
/* Keeps index.html loading the shared loader at an address that changes with it.

   index.html loads atlas-data.js as atlas-data.js?v=<version>, where <version> is
   the first 10 hex digits of the sha256 of atlas-data.js, with CRLF line endings
   read as LF so a Windows checkout computes the same value. Cloudflare keeps .js
   files at its edge for about 2 hours and tells browsers to keep them for 4 (its
   zone defaults; the origin sends no Cache-Control), so a changed loader at an
   unchanged address could pair a new index.html with an old loader for hours.
   A new version is a new address, which neither Cloudflare nor a browser has
   cached. Cloudflare keys its cache on the query string, so this works without
   any change to Cloudflare or the server.

     node scripts/loader-version.js           # check: exit 1 if index.html is stale
     node scripts/loader-version.js --write   # update index.html to the current version

   validate.yml runs the check on every pull request. Nothing rewrites index.html
   at deploy time: the committed page is the page that ships.

   This relies on the deploy putting the loader in place no later than the page.
   deploy.yml uploads both in one rsync command, and rsync sorts its file list, so
   atlas-data.js lands before index.html. If index.html were ever uploaded first,
   in a command of its own, a visitor in the gap would make Cloudflare cache the
   old loader under the new version for about 2 hours. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const LOADER = path.join(ROOT, "atlas-data.js");
const PAGE = path.join(ROOT, "index.html");
// The one tag that loads the loader, with or without a version.
const TAG = /<script src="atlas-data\.js(?:\?v=([0-9a-f]*))?"><\/script>/g;

function fail(message) {
  // In GitHub Actions, also annotate index.html so the reason shows on the PR.
  if (process.env.GITHUB_ACTIONS) console.log(`::error file=index.html::${message}`);
  console.error(`loader-version: ${message}`);
  process.exit(1);
}

const version = crypto.createHash("sha256")
  .update(fs.readFileSync(LOADER, "utf8").replace(/\r\n/g, "\n"))
  .digest("hex")
  .slice(0, 10);

const html = fs.readFileSync(PAGE, "utf8");
const tags = [...html.matchAll(TAG)];
if (tags.length !== 1) {
  fail(`expected exactly one <script src="atlas-data.js?v=..."></script> tag in index.html, found ${tags.length}`);
}
const current = tags[0][1] || "";

if (process.argv.includes("--write")) {
  if (current === version) {
    console.log(`loader-version: index.html already loads atlas-data.js?v=${version}`);
  } else {
    fs.writeFileSync(PAGE, html.replace(TAG, `<script src="atlas-data.js?v=${version}"></script>`));
    console.log(`loader-version: index.html now loads atlas-data.js?v=${version}` +
      (current ? ` (was ${current})` : ""));
  }
  process.exit(0);
}

if (current !== version) {
  fail(`index.html loads atlas-data.js${current ? `?v=${current}` : " with no version"}, ` +
    `but atlas-data.js is at version ${version}. ` +
    `Run node scripts/loader-version.js --write and commit index.html.`);
}
console.log(`loader-version: OK, index.html loads atlas-data.js?v=${version}`);
