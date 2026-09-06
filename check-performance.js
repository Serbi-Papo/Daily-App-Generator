// check-performance.js
// Runs on its own schedule (see .github/workflows/check-performance.yml).
// Pulls real visitor counts from GoatCounter, updates performance.json
// (which the gallery reads to show a visits badge on each card), and
// notifies you the FIRST time a site crosses a new visitor milestone —
// not every single day, so you don't get spammed.
//
// No LLM calls here — this is deliberately deterministic.

import fs from "fs";
import path from "path";
import { fetchHits } from "./lib/goatcounter.js";
import { notifyDiscord, notifyTelegram } from "./lib/notify.js";
import { escapeHtml } from "./lib/util.js";

const MILESTONES = [10, 50, 100, 500, 1000, 5000, 10000];

const SITES_DIR = path.join(process.cwd(), "sites");
const PERF_FILE = path.join(process.cwd(), "performance.json");
const STATE_FILE = path.join(process.cwd(), "performance-state.json");

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function listSiteSlugs() {
  if (!fs.existsSync(SITES_DIR)) return [];
  return fs.readdirSync(SITES_DIR).filter(f => fs.statSync(path.join(SITES_DIR, f)).isDirectory());
}

async function main() {
  const code = process.env.GOATCOUNTER_CODE;
  const token = process.env.GOATCOUNTER_API_TOKEN;
  if (!code || !token) {
    console.log("GOATCOUNTER_CODE / GOATCOUNTER_API_TOKEN not set — skipping performance check.");
    return;
  }

  const slugs = listSiteSlugs();
  if (!slugs.length) {
    console.log("No published sites yet.");
    return;
  }

  console.log("Fetching visitor stats from GoatCounter...");
  const hits = await fetchHits({ code, token });

  const performance = loadJson(PERF_FILE, {});
  const state = loadJson(STATE_FILE, {});
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || "you/repo").split("/");

  for (const slug of slugs) {
    // Sum every recorded path that belongs to this site's folder, however
    // GoatCounter recorded it (with/without repo prefix, trailing slash).
    const matcher = new RegExp(`/sites/${slug}(/|$)`);
    const total = hits.filter(h => matcher.test(h.path || "")).reduce((sum, h) => sum + (h.count || 0), 0);

    performance[slug] = { visitors: total, lastChecked: new Date().toISOString() };

    const notifiedMilestones = state[slug] || [];
    const newMilestones = MILESTONES.filter(m => total >= m && !notifiedMilestones.includes(m));

    if (newMilestones.length) {
      const milestone = Math.max(...newMilestones);
      const meta = loadJson(path.join(SITES_DIR, slug, "meta.json"), { title: slug });
      const siteUrl = `https://${owner}.github.io/${repo}/sites/${slug}/`;

      console.log(`🎉 ${slug} crossed ${milestone} visitors!`);

      await notifyDiscord(process.env.DISCORD_WEBHOOK_URL, {
        title: `🎉 ${meta.title} just crossed ${milestone} visitors`,
        description: meta.description || "",
        url: siteUrl,
        extra: { "Total visitors": total },
      });
      await notifyTelegram(
        process.env.TELEGRAM_BOT_TOKEN,
        process.env.TELEGRAM_CHAT_ID,
        `🎉 <b>${escapeHtml(meta.title)}</b> just crossed <b>${milestone}</b> visitors!\nTotal so far: ${total}\n${siteUrl}`
      );

      state[slug] = [...notifiedMilestones, ...newMilestones];
    }
  }

  fs.writeFileSync(PERF_FILE, JSON.stringify(performance, null, 2));
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log("Performance check complete.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
