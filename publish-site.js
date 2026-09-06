// publish-site.js
// PUBLISH STEP — takes what generate-site.js produced (in .build-output/,
// restored here from the build job's artifact) and merges it into the
// public site: sites/<date-slug>/, the root index.html gallery, and
// feed.xml. Runs behind a human-approval gate when generate-site.js
// decided one was needed (see .github/workflows/daily-site.yml).

import fs from "fs";
import path from "path";
import { escapeHtml } from "./lib/util.js";

const OUT_DIR = path.join(process.cwd(), ".build-output");
const SITES_DIR = path.join(process.cwd(), "sites");
const DRAFTS_DIR = path.join(process.cwd(), "reddit-drafts");
const INDEX_FILE = path.join(process.cwd(), "index.html");
const FEED_FILE = path.join(process.cwd(), "feed.xml");

function main() {
  // --index-only: just refresh the gallery/feed from what's already
  // published (used by check-performance.js after updating visitor
  // counts) — skips merging a new build, since there isn't one.
  if (process.argv.includes("--index-only")) {
    rebuildIndex();
    rebuildFeed();
    console.log("Refreshed index.html and feed.xml (no new site).");
    return;
  }

  const dateSlug = fs.readFileSync(path.join(OUT_DIR, "date-slug.txt"), "utf8").trim();

  const siteDir = path.join(SITES_DIR, dateSlug);
  fs.mkdirSync(siteDir, { recursive: true });
  fs.copyFileSync(path.join(OUT_DIR, "site-files", "index.html"), path.join(siteDir, "index.html"));
  fs.copyFileSync(path.join(OUT_DIR, "site-files", "meta.json"), path.join(siteDir, "meta.json"));

  fs.mkdirSync(DRAFTS_DIR, { recursive: true });
  fs.copyFileSync(path.join(OUT_DIR, "reddit-draft.md"), path.join(DRAFTS_DIR, `${dateSlug}.md`));

  rebuildIndex();
  rebuildFeed();

  console.log(`Published ${dateSlug}`);
}

function loadAllMeta() {
  if (!fs.existsSync(SITES_DIR)) return [];
  return fs
    .readdirSync(SITES_DIR)
    .filter(f => fs.statSync(path.join(SITES_DIR, f)).isDirectory())
    .sort()
    .reverse()
    .map(dateSlug => {
      const metaPath = path.join(SITES_DIR, dateSlug, "meta.json");
      const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : { title: dateSlug };
      return { dateSlug, meta };
    });
}

function loadPerformance() {
  const file = path.join(process.cwd(), "performance.json");
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function rebuildIndex() {
  const entries = loadAllMeta();
  const perf = loadPerformance();

  const cards = entries
    .map(({ dateSlug, meta }) => {
      const visitors = perf[dateSlug]?.visitors;
      return `
        <a class="card" href="sites/${dateSlug}/">
          <h2>${escapeHtml(meta.title)}</h2>
          <p class="date">${meta.date || ""}</p>
          <p>${escapeHtml(meta.description || "")}</p>
          ${meta.why?.monetization ? `<p class="tag">💰 ${escapeHtml(meta.why.monetization)}</p>` : ""}
          ${typeof visitors === "number" ? `<p class="tag">👀 ${visitors.toLocaleString()} visits</p>` : ""}
        </a>`;
    })
    .join("\n");

  const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>A Website a Day</title>
<link rel="alternate" type="application/rss+xml" title="A Website a Day" href="feed.xml">
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 960px; margin: 0 auto; padding: 2rem 1.5rem; line-height: 1.5; }
  h1 { font-size: 1.9rem; margin-bottom: 0.3rem; }
  .sub { opacity: 0.7; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem; margin-top: 2rem; }
  .card { display: block; padding: 1.3rem; border: 1px solid #8883; border-radius: 14px; text-decoration: none; color: inherit; transition: transform .15s ease, border-color .15s ease; }
  .card:hover { transform: translateY(-3px); border-color: #8886; }
  .card h2 { margin: 0 0 0.3rem; font-size: 1.15rem; }
  .card .date { font-size: 0.75rem; opacity: 0.6; margin: 0 0 0.5rem; }
  .card p:not(.date):not(.tag) { margin: 0 0 0.6rem; font-size: 0.92rem; opacity: 0.85; }
  .card .tag { font-size: 0.78rem; opacity: 0.7; margin: 0; }
</style>
</head>
<body>
  <h1>🌐 A Website a Day</h1>
  <p class="sub">A new tiny AI-built app idea, automatically, every day — ${entries.length} so far. <a href="feed.xml">RSS</a></p>
  <div class="grid">
    ${cards || "<p>No sites yet — check back after the first run.</p>"}
  </div>
</body>
</html>`;

  fs.writeFileSync(INDEX_FILE, page, "utf8");
}

function rebuildFeed() {
  const entries = loadAllMeta();
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || "you/repo").split("/");
  const baseUrl = `https://${owner}.github.io/${repo}/`;

  const items = entries
    .map(
      ({ dateSlug, meta }) => `
    <item>
      <title>${escapeXml(meta.title)}</title>
      <link>${baseUrl}sites/${dateSlug}/</link>
      <guid>${baseUrl}sites/${dateSlug}/</guid>
      <description>${escapeXml(meta.description || "")}</description>
      <pubDate>${new Date(meta.date || Date.now()).toUTCString()}</pubDate>
    </item>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>A Website a Day</title>
  <link>${baseUrl}</link>
  <description>A new tiny AI-built app idea, automatically, every day.</description>
  ${items}
</channel>
</rss>`;

  fs.writeFileSync(FEED_FILE, xml, "utf8");
}

function escapeXml(str) {
  return String(str).replace(/[<>&'"]/g, c => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
  }[c]));
}

main();
