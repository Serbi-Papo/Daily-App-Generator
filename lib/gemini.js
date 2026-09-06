// lib/gemini.js — thin wrapper around the Gemini API free tier.

// Google renames/retires free-tier model IDs every few months (right now
// it's Flash / Flash-Lite; Pro models are paid-only as of 2026). Check
// https://aistudio.google.com/ (your project's live rate limits) and update
// this if calls start failing with a 404 "model not found" error.
const MODEL = "gemini-2.5-flash";
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.error("Missing GEMINI_API_KEY environment variable.");
  process.exit(1);
}

export async function callGemini(prompt, { json = false, retries = 2 } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = { contents: [{ parts: [{ text: prompt }] }] };
  if (json) body.generationConfig = { responseMimeType: "application/json" };

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API error ${res.status}: ${errText}`);
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ?? "";
      if (!text) throw new Error("Empty response from Gemini: " + JSON.stringify(data));
      return text;
    } catch (err) {
      lastErr = err;
      console.warn(`Gemini call failed (attempt ${attempt + 1}/${retries + 1}): ${err.message}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// Strips markdown code fences some models add even when told not to.
export function parseJsonLoose(text) {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned);
}
