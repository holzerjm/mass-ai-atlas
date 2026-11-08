#!/usr/bin/env node
/* The static server the browser tests run against (playwright.config.js starts it).

     node tests/server.js <port> <root>

   It serves <root> the way the live site does: files at their paths, a directory's
   index.html at its URL with a trailing slash, and a redirect when the slash is missing.
   It replaces `python3 -m http.server`, so CI can run in Playwright's own image, which has
   no Python. Two things carried over from that server's setup:

   - A long accept queue. Python's default backlog of 5 overflowed on macOS when parallel
     browsers each fetched every data/*.yml at once; Chrome got ERR_CONNECTION_RESET and the
     page said "the atlas data failed to load" (2026-11-01). Node's listen takes the backlog
     as an option; 511 is its own default, set here so nobody lowers it by accident.
   - No caching headers, so every test sees the files as they are on disk.

   It only reads, never leaves <root>, and answers GET and HEAD. */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.argv[2]);
const ROOT = path.resolve(process.argv[3] || ".");
if (!Number.isInteger(PORT) || PORT <= 0) {
  console.error("usage: node tests/server.js <port> <root>");
  process.exit(2);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yml": "application/yaml; charset=utf-8",
  ".yaml": "application/yaml; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": Buffer.byteLength(body), ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed\n", { Allow: "GET, HEAD" });

  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    return send(res, 400, "Bad request\n");
  }
  const file = path.join(ROOT, urlPath);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 403, "Forbidden\n");

  fs.stat(file, (err, st) => {
    if (err) return send(res, 404, "Not found\n");
    let target = file;
    if (st.isDirectory()) {
      if (!urlPath.endsWith("/")) {
        const q = req.url.indexOf("?");
        const location = req.url.slice(0, q === -1 ? undefined : q) + "/" + (q === -1 ? "" : req.url.slice(q));
        return send(res, 301, "Moved permanently\n", { Location: location });
      }
      target = path.join(file, "index.html");
    }
    fs.stat(target, (err2, st2) => {
      if (err2 || !st2.isFile()) return send(res, 404, "Not found\n");
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(target).toLowerCase()] || "application/octet-stream",
        "Content-Length": st2.size,
      });
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(target).on("error", () => res.destroy()).pipe(res);
    });
  });
});

server.listen({ port: PORT, host: "127.0.0.1", backlog: 511 }, () => {
  console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}/`);
});
