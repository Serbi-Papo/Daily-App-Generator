// lib/notify.js — best-effort notifiers. Both are no-ops if their secrets
// aren't set, so this repo works fine with neither, either, or both configured.

export async function notifyDiscord(webhookUrl, { title, description, url, extra }) {
  if (!webhookUrl) return;
  const embed = {
    title,
    description,
    url,
    color: 0x6366f1,
    fields: extra
      ? Object.entries(extra)
          .filter(([, value]) => value)
          .map(([name, value]) => ({ name, value: String(value).slice(0, 1000) }))
      : [],
  };
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (err) {
    console.warn("Discord notify failed (non-fatal):", err.message);
  }
}

export async function notifyTelegram(botToken, chatId, text) {
  if (!botToken || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (err) {
    console.warn("Telegram notify failed (non-fatal):", err.message);
  }
}
