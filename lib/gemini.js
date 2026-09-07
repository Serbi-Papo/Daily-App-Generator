// lib/gemini.js — thin wrapper around the Gemini API free tier.

// Google renames/retires free-tier model IDs every few months. If this
// starts 404ing, the error message from the API almost always names the
// exact replacement model to use — just swap it in below.
const MODEL = "gemini-3.6-flash";
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.error("Missing GEMINI_API_KEY environment variable.");
  process.exit(1);
}

async function rawCall(prompt, { json = false, maxOutputTokens } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

  const generationConfig = {};
  if (json) generationConfig.responseMimeType = "application/json";
  if (maxOutputTokens) generationConfig.maxOutputTokens = maxOutputTokens;

  const body = { contents: [{ parts: [{ text: prompt }] }] };
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    const err = new Error(`Gemini API error ${res.status}: ${errText}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map(p => p.text).join("") ?? "";
  if (!text) {
    throw new Error(
      `Empty response from Gemini (finishReason: ${candidate?.finishReason || "unknown"}): ${JSON.stringify(data).slice(0, 500)}`
    );
  }
  return text;
}

export async function callGemini(prompt, { json = false, maxOutputTokens, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await rawCall(prompt, { json, maxOutputTokens });
    } catch (err) {
      lastErr = err;
      // Rate limits (429) need a much longer cooldown than a generic
      // hiccup does — the free tier's per-minute window needs time to reset.
      const wait = err.status === 429 ? 8000 * (attempt + 1) : 1500 * (attempt + 1);
      console.warn(`  Gemini call failed (attempt ${attempt + 1}/${retries + 1}): ${err.message}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// Strips markdown fences and, if that's still not valid JSON, extracts the
// outermost {...} or [...] block — models occasionally add a stray word
// before/after valid JSON even when explicitly told not to.
export function parseJsonLoose(text) {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    const candidate =
      arrMatch && (!objMatch || arrMatch.index < objMatch.index) ? arrMatch[0] : objMatch?.[0];
    if (candidate) return JSON.parse(candidate);
    throw new Error(`Could not parse JSON from model output: ${cleaned.slice(0, 300)}`);
  }
}

// Calls Gemini expecting JSON. If parsing fails, re-prompts from scratch
// (a fresh generation, not just a network retry) up to `retries` times —
// a second attempt is usually clean even when the first wasn't.
export async function callGeminiJson(prompt, { retries = 2, maxOutputTokens } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const raw = await callGemini(prompt, { json: true, maxOutputTokens, retries: 1 });
    try {
      return parseJsonLoose(raw);
    } catch (err) {
      lastErr = err;
      console.warn(`  JSON parse failed (attempt ${attempt + 1}/${retries + 1}): ${err.message}`);
    }
  }
  throw lastErr;
}
