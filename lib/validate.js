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

  // Security backstop — deliberately limited to patterns with essentially
  // no legitimate use in a small static tool, to avoid false-positive
  // repair loops. Nuanced judgment calls (e.g. dynamic innerHTML use) are
  // left to the AI review pass, which can weigh context.
  if (/\beval\s*\(/.test(html)) {
    issues.push("Security: eval() found — never needed here, remove it.");
  }
  if (/\bnew\s+Function\s*\(/.test(html)) {
    issues.push("Security: new Function() found — avoid dynamic code execution.");
  }
  if (/document\.write\s*\(/.test(html)) {
    issues.push("Security: document.write() found — use DOM methods instead.");
  }

  const blankLinks = html.match(/<a\b[^>]*target=["']_blank["'][^>]*>/gi) || [];
  if (blankLinks.some(tag => !/rel=["'][^"']*noopener/i.test(tag))) {
    issues.push('Security: a target="_blank" link is missing rel="noopener noreferrer".');
  }

  const credentialPattern =
    /(AIza[0-9A-Za-z_-]{20,})|(sk-[A-Za-z0-9]{20,})|((api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["'])/i;
  if (credentialPattern.test(html)) {
    issues.push("Security: text resembling an embedded API key/credential found — remove it.");
  }

  return { ok: issues.length === 0, issues };
}
