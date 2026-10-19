#!/usr/bin/env node
/* Copy lint: fail when user-visible copy carries a hand-typed organization count.
 *
 * Why: counts typed into prose go stale silently. The footer said "Curated June
 * 2026 · 101 organizations" for months while the atlas listed 171, and the README
 * promised "160+" (both found in the v2.0 review, Sept 2026). Counts on the page
 * are now computed from DATA; this keeps new prose from reintroducing them.
 *
 *   node scripts/lint-copy.js                # index.html, events/index.html, README.md
 *   node scripts/lint-copy.js some/file.html # any files (fixtures, tests)
 *
 * Exit 0 with one OK line, or exit 1 listing file:line and the offending text.
 *
 * What counts as copy: HTML text and user-visible attribute values (alt, title,
 * aria-label, placeholder, meta content) — but not <script>, <style>, HTML
 * comments, or elements marked data-computed (text that code fills in from
 * DATA at load, e.g. <span id="footCount" data-computed>). Markdown: everything
 * except fenced code blocks, inline code spans and HTML comments; emphasis
 * markers are read as spaces, so "**160+** verified organizations" is caught.
 *
 * Both word orders count: "171 organizations" and "Organizations: 171" (or a
 * "| Organizations | 171 |" table row).
 *
 * Escape hatch for a genuine non-count sentence the pattern trips on: put
 * "lint-copy: ignore" anywhere on that line (in a comment).
 *
 * Dependency-free on purpose — it runs in CI before anything is installed.
 */
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const DEFAULT_FILES = ["index.html", "events/index.html", "README.md", "HACKATHON.md"];

// A number (optionally "160+" / "1,200") followed by up to two words and then a
// noun that means "organizations in this atlas". Two words covers "160+ verified
// organizations" and "101 Boston AI orgs"-style phrasing without reaching across
// a clause. Digits only: "one organization" is not a count claim.
const COUNT_RE = /(?<![\w.#-])(\d[\d,]*(?:[ \t]*\+)?)[ \t\n]+(?:[A-Za-z][\w'’-]*[ \t\n]+){0,2}?(organi[sz]ations?|orgs|entries|listings)\b/gi;
// The same claim noun-first: "Organizations: 171", "Organizations (171)", a table
// row "| Organizations | 171 |", or a heading cell and a number cell in HTML (tags
// read as spaces). At most one separator, and the number must stand alone, so
// dates ("entries: 2026-09") and ids ("entries v2") do not trip it.
const NOUN_FIRST_RE = /\b(organi[sz]ations?|orgs|entries|listings)[ \t\n]*(?:[:=|(–—][ \t\n|]*)?(\d[\d,]*\+?)(?![\w.\/:-])/gi;
const PATTERNS = [COUNT_RE, NOUN_FIRST_RE];
const VISIBLE_ATTRS = /\b(?:alt|title|aria-label|aria-description|placeholder|content|value)\s*=\s*("[^"]*"|'[^']*')/gi;

// Blank a span of text but keep its newlines, so offsets and line numbers in the
// masked copy still point at the original file.
const blank = (s) => s.replace(/[^\n]/g, " ");
const maskAll = (text, re, keep) => text.replace(re, (m, ...g) => (keep ? keep(m, ...g) : blank(m)));

function maskHtml(src) {
  let t = src;
  t = maskAll(t, /<!--[\s\S]*?-->/g);
  t = maskAll(t, /<script\b[\s\S]*?<\/script\s*>/gi);
  t = maskAll(t, /<style\b[\s\S]*?<\/style\s*>/gi);
  // data-computed elements: keep the tags, blank what's between them
  t = maskAll(t, /(<(\w+)\b[^>]*\bdata-computed\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi,
    (m, open, _tag, inner, close) => open + blank(inner) + close);
  // HTML-escaped spaces between the number and the noun still read as a space
  t = t.replace(/&nbsp;|&#160;/g, (m) => " ".repeat(m.length));
  return t;
}

function maskMarkdown(src) {
  let t = maskAll(src, /<!--[\s\S]*?-->/g);
  // fenced code blocks (``` or ~~~), line-based so an unclosed fence masks to EOF
  const lines = t.split("\n");
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      lines[i] = blank(lines[i]);
    } else if (m) {
      fence = m[1];
      lines[i] = blank(lines[i]);
    }
    // (4-space indented code is not skipped: fenced blocks are the convention here,
    // and skipping indents would also skip list-continuation prose)
  }
  t = lines.join("\n");
  t = maskAll(t, /(`+)[\s\S]*?\1/g);   // inline code spans
  // Emphasis markers read as spaces: the README's own offending line was bold
  // ("**Four ways to explore 160+ verified organizations**"), and "**160+**
  // verified organizations" renders the same count. Underscores only at a word
  // edge — intraword ones (snake_case) are not emphasis in GitHub Markdown.
  t = t.replace(/\*+|~~|(?<!\w)_+|_+(?!\w)/g, blank);
  return t;
}

function findCounts(masked, original) {
  const hits = [];
  const lineOf = (i) => original.slice(0, i).split("\n").length;
  // report the original text (with its ** or <b>), which is what someone will grep for
  const push = (index, len) => {
    const line = lineOf(index);
    const src = original.split("\n")[line - 1];
    if (/lint-copy:\s*ignore/.test(src)) return;
    hits.push({ line, text: original.slice(index, index + len).replace(/\s+/g, " ").trim() });
  };
  // 1) attribute values people see (tooltips, alt text, unfurl descriptions)
  for (const tag of masked.matchAll(/<[A-Za-z][^>]*>/g)) {
    for (const a of tag[0].matchAll(VISIBLE_ATTRS)) {
      const valStart = tag.index + a.index + a[0].indexOf(a[1]);
      for (const re of PATTERNS) for (const c of a[1].matchAll(re)) push(valStart + c.index, c[0].length);
    }
  }
  // 2) text content: tags become spaces so "<b>101</b> organizations" still reads
  const text = masked.replace(/<[^>]*>/g, blank);
  for (const re of PATTERNS) for (const c of text.matchAll(re)) push(c.index, c[0].length);
  return hits.sort((a, b) => a.line - b.line);
}

function lintFile(rel) {
  const file = path.isAbsolute(rel) ? rel : path.join(REPO, rel);
  const src = fs.readFileSync(file, "utf8");
  const masked = /\.(md|markdown)$/i.test(file) ? maskMarkdown(src) : maskHtml(src);
  return findCounts(masked, src).map((h) => ({ file: rel, ...h }));
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES;
let problems = [];
for (const f of files) {
  try {
    problems = problems.concat(lintFile(f));
  } catch (e) {
    console.error(`lint-copy: cannot read ${f}: ${e.message}`);
    process.exit(2);
  }
}

if (problems.length) {
  for (const p of problems) console.error(`${p.file}:${p.line}: hand-typed count "${p.text}"`);
  console.error(`\nlint-copy: ${problems.length} hand-typed organization count(s). ` +
    `Compute it from DATA instead (see footerFacts() in index.html), or drop the number.`);
  process.exit(1);
}
console.log(`lint-copy: OK — no hand-typed organization counts in ${files.join(", ")}`);
