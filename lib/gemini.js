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
      // Rate limits (429) and "model overloaded" (503) both need a much
      // longer cooldown than a generic hiccup — these clear on their own
      // within seconds to tens of seconds, not milliseconds.
      const needsLongWait = err.status === 429 || err.status === 503;
      const wait = needsLongWait ? 8000 * (attempt + 1) : 1500 * (attempt + 1);
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

// Calls Gemini expecting JSON. If EITHER the network/API call fails (e.g. a
// transient 503) OR the response isn't valid JSON, re-prompts from scratch
// up to `retries` times — a fresh generation is usually fine even when the
// previous attempt wasn't. (Both failure modes must be inside the same
// try/catch below — a bug previously let network errors skip this retry
// loop entirely.)
export async function callGeminiJson(prompt, { retries = 2, maxOutputTokens } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const raw = await callGemini(prompt, { json: true, maxOutputTokens, retries: 2 });
      return parseJsonLoose(raw);
    } catch (err) {
      lastErr = err;
      console.warn(`  Attempt ${attempt + 1}/${retries + 1} failed: ${err.message}`);
    }
  }
  throw lastErr;
}
