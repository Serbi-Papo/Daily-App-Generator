// lib/validate.js — fast, deterministic checks that don't rely on the model
// grading its own homework correctly. Runs alongside the AI self-review.

export function staticValidate(html) {
  const issues = [];
  if (!/<!DOCTYPE html>/i.test(html)) issues.push("Missing <!DOCTYPE html>.");
  if (!/<\/html>/i.test(html)) issues.push("Missing closing </html> — output may be truncated.");
  if (!/name=["']viewport["']/i.test(html)) issues.push("Missing responsive viewport meta tag.");
  if (!/<style/i.test(html)) issues.push("No <style> block found.");
  if (/```/.test(html)) issues.push("Leftover markdown code fence in output.");
  if (/lorem ipsum/i.test(html)) issues.push("Placeholder 'lorem ipsum' text found.");
  if (html.length < 800) issues.push("Output looks too short — possibly truncated or empty.");
  return { ok: issues.length === 0, issues };
}
