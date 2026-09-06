// notify-published.js
// Runs after publish-site.js + git push, in the publish job. Announces the
// newly published site on Discord/Telegram (if configured) and surfaces the
// Reddit draft so you can review and post it manually.

import fs from "fs";
import path from "path";
import { notifyDiscord, notifyTelegram } from "./lib/notify.js";
import { escapeHtml } from "./lib/util.js";

const OUT_DIR = path.join(process.cwd(), ".build-output");

async function main() {
  const dateSlug = fs.readFileSync(path.join(OUT_DIR, "date-slug.txt"), "utf8").trim();
  const meta = JSON.parse(fs.readFileSync(path.join(process.cwd(), "sites", dateSlug, "meta.json"), "utf8"));
  const redditDraft = fs.readFileSync(path.join(process.cwd(), "reddit-drafts", `${dateSlug}.md`), "utf8");

  const [owner, repo] = (process.env.GITHUB_REPOSITORY || "you/repo").split("/");
  const siteUrl = `https://${owner}.github.io/${repo}/sites/${dateSlug}/`;

  await notifyDiscord(process.env.DISCORD_WEBHOOK_URL, {
    title: `✅ Published: ${meta.title}`,
    description: meta.description,
    url: siteUrl,
    extra: {
      "Why it could work": meta.why?.demand || "",
      Monetization: meta.why?.monetization || "",
      "Reddit draft": redditDraft.slice(0, 900),
    },
  });

  await notifyTelegram(
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.TELEGRAM_CHAT_ID,
    `✅ <b>Published:</b> ${escapeHtml(meta.title)}\n${escapeHtml(meta.description)}\n${siteUrl}\n\n📋 Reddit draft ready in <code>reddit-drafts/${dateSlug}.md</code> — review and post manually.`
  );

  console.log("Notifications sent (where configured).");
}

main().catch(err => {
  console.error("Notify failed (non-fatal):", err.message);
});
