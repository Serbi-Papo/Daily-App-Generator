// generate-site.js
// BUILD STEP — brainstorms several app ideas, pulls real live data on each
// from Hacker News (discussion volume + existing "Show HN" launches),
// picks the best one using that grounded data, builds it, self-reviews and
// repairs it, embeds analytics, and decides whether a human needs to
// approve it before publishing.
//
// Writes everything to .build-output/. A separate "publish" job (gated
// behind a human approval when needed — see README.md) picks it up from
// there. This script never touches sites/ directly.

import fs from "fs";
import path from "path";
import { callGemini, callGeminiJson } from "./lib/gemini.js";
import { staticValidate } from "./lib/validate.js";
import { notifyDiscord, notifyTelegram } from "./lib/notify.js";
import { gatherHnSignals } from "./lib/hn.js";
import { slugify, todayStamp, escapeHtml } from "./lib/util.js";

// ---- Tunable thresholds -------------------------------------------------
const CANDIDATE_COUNT = 5;             // how many ideas to research each run
const IDEA_CONFIDENCE_THRESHOLD = 65;  // below this, a human reviews before publish
const DESIGN_SCORE_THRESHOLD = 7;      // out of 10
const MAX_REPAIR_ATTEMPTS = 2;
const HTML_MAX_OUTPUT_TOKENS = 8192;   // headroom so a styled page doesn't get cut off
// --------------------------------------------------------------------------

const SITES_DIR = path.join(process.cwd(), "sites");
const OUT_DIR = path.join(process.cwd(), ".build-output");

// Runs a labeled stage so a failure's log clearly says which step broke,
// instead of a bare "exit code 1" with no context.
async function stage(name, fn) {
  console.log(`\n=== ${name} ===`);
  try {
    return await fn();
  } catch (err) {
    console.error(`✗ Failed during "${name}": ${err.message}`);
    throw err;
  }
}

function loadPastTitles() {
  if (!fs.existsSync(SITES_DIR)) return [];
  return fs
    .readdirSync(SITES_DIR)
    .filter(f => fs.statSync(path.join(SITES_DIR, f)).isDirectory())
    .map(f => f.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " "));
}

// ---- Step 1: brainstorm several cheap, lightweight candidates -----------
async function generateCandidates(pastTitles) {
  const avoidText = pastTitles.length
    ? `Do not repeat or closely resemble any of these previously built ideas: ${pastTitles.join(", ")}.`
    : "";

  const prompt = `
Propose ${CANDIDATE_COUNT} DIFFERENT small web app ideas, each buildable as a
SINGLE static HTML file (inline CSS + vanilla JS only — no backend, no
server, no database, no paid APIs, no accounts, no payments). Spread them
across different niches so they don't overlap with each other.

${avoidText}

Return ONLY a JSON array, nothing else:
[
  {
    "title": "short catchy title",
    "slug": "kebab-case-slug",
    "one_liner": "one sentence describing it",
    "search_terms": "2-4 words a real person would search for to find this kind of tool"
  }
]
`.trim();

  const candidates = await callGeminiJson(prompt);
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error(`Expected a non-empty JSON array of candidates, got: ${JSON.stringify(candidates).slice(0, 200)}`);
  }
  return candidates.map(c => ({ ...c, slug: slugify(c.slug || c.title) }));
}

// ---- Step 2: ground each candidate in real, current HN data -------------
async function researchCandidates(candidates) {
  const results = [];
  for (const c of candidates) {
    try {
      const signals = await gatherHnSignals(c.search_terms || c.title);
      results.push({ ...c, signals });
      console.log(
        `  "${c.title}": ${signals.discussionHits} HN mentions, ${signals.showHnHits} prior Show HN launches`
      );
    } catch (err) {
      console.warn(`  HN lookup failed for "${c.title}" (continuing without it): ${err.message}`);
      results.push({ ...c, signals: null });
    }
  }
  return results;
}

// ---- Step 3: pick the best candidate, grounded in that real data --------
async function evaluateAndPick(researched) {
  const dataBlock = researched
    .map((c, i) => {
      if (!c.signals) return `${i + 1}. ${c.title} — ${c.one_liner} (no live data available)`;
      const launches =
        c.signals.topLaunches.map(l => `"${l.title}" (${l.points} pts)`).join(", ") || "none found";
      return `${i + 1}. ${c.title} — ${c.one_liner}
   Live Hacker News data for "${c.search_terms}":
   - ${c.signals.discussionHits} total mentions in HN stories/comments (general interest signal)
   - ${c.signals.showHnHits} prior "Show HN" launches of similar tools (competition signal)
   - Examples of prior launches: ${launches}`;
    })
    .join("\n\n");

  const prompt = `
You are a sharp indie-hacker scout picking which of these ${researched.length}
app ideas to actually build today. Real, live Hacker News data has been
pulled for each — use it as your primary evidence, don't just go with vibes.

${dataBlock}

How to read the data: some discussion volume is good (real interest exists),
but a high "Show HN" launch count for the same niche means it's already
crowded — that's a real, current competition signal, not a guess. Low
discussion AND low launches can mean either an untapped niche or genuinely
no demand — say which you think it is and why.

Pick exactly ONE. Monetization must be realistic for a static, backend-less
site: a donation/"buy me a coffee" link, a relevant affiliate link, an email
waitlist for a future paid "pro" version, or ads once it has traffic. Nothing
requiring logins, payments, or a database.

Return ONLY a JSON object with this exact shape, nothing else:
{
  "title": "short catchy title",
  "slug": "kebab-case-slug",
  "description": "one sentence describing the site, for a human visitor",
  "features": ["feature 1", "feature 2", "feature 3"],
  "target_user": "who specifically wants this",
  "demand_reasoning": "1-2 sentences citing the actual HN numbers above",
  "competition_reasoning": "1-2 honest sentences citing the actual Show HN data above",
  "existing_alternatives": ["from the data, or general knowledge if data was sparse"],
  "monetization_plan": "1-2 sentences, specific and realistic for a static site",
  "confidence_score": 0,
  "risk_flags": []
}

confidence_score (0-100): honest confidence given the actual data — don't
inflate it. risk_flags: anything a human should sanity-check (empty array if
genuinely none).
`.trim();

  const idea = await callGeminiJson(prompt);
  if (!idea || typeof idea !== "object" || !idea.title) {
    throw new Error(`Expected an idea object with a title, got: ${JSON.stringify(idea).slice(0, 200)}`);
  }
  idea.slug = slugify(idea.slug || idea.title);
  idea.confidence_score = Number(idea.confidence_score) || 0;
  idea.risk_flags = Array.isArray(idea.risk_flags) ? idea.risk_flags : [];
  return idea;
}

async function generateHtml(idea) {
  const prompt = `
Build a complete, polished, single-file website for this app idea:

Title: ${idea.title}
Description: ${idea.description}
Target user: ${idea.target_user}
Features (all must be fully functional, not decorative): ${(idea.features || []).join(", ")}

Design requirements (this matters as much as functionality):
- A real, considered design system: a specific color palette (not default
  black-on-white or default blue links), a clear typographic scale (distinct
  sizes/weights for headings vs body), generous consistent spacing.
- Modern layout appropriate to the content — do not just stack default
  elements top to bottom.
- Subtle, purposeful motion is welcome (transitions on interactive elements)
  but nothing gimmicky.
- Fully responsive: must look intentional on a narrow mobile screen, not just
  "not broken" — include a viewport meta tag and real @media rules.
- Good contrast and legible font sizes (accessibility matters).

Technical requirements:
- Output ONE complete HTML file (<!DOCTYPE html> through </html>).
- Inline all CSS in a <style> tag and all JS in a <script> tag. No external
  fonts/CDNs/dependencies that could fail offline.
- Every listed feature must actually work when clicked/used, with real logic
  in the JS — not a placeholder.
- Write real, specific copy. No "lorem ipsum" or "[placeholder]" text anywhere.
- Return ONLY the raw HTML, no markdown code fences, no commentary.

Security requirements (this is a public static file — treat all input as
untrusted):
- NEVER use eval(), new Function(), or setTimeout/setInterval with a string
  argument.
- If any user input (from a text field, URL params, etc.) is ever displayed
  back on the page, insert it via textContent or an explicit HTML-escaping
  function — never via innerHTML/insertAdjacentHTML with a raw string.
- Never embed any API key, token, or credential in the page, even a fake
  placeholder one — this file is public source code.
- Any link that opens in a new tab (target="_blank") must include
  rel="noopener noreferrer".
- Never build a URL for fetch/navigation by concatenating unescaped user
  input into it.
`.trim();

  const raw = await callGemini(prompt, { maxOutputTokens: HTML_MAX_OUTPUT_TOKENS });
  return raw.replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
}

async function reviewHtml(html, idea) {
  const prompt = `
You are doing quality control on a website you're about to publish. Review
this HTML file against the brief below and be genuinely critical — the goal
is to catch real problems before this goes live, not to rubber-stamp it.

Brief:
Title: ${idea.title}
Features that must work: ${(idea.features || []).join(", ")}

HTML to review:
${html}

Check specifically for: features that are listed but not actually implemented
in the JS, broken or incomplete JS logic, leftover placeholder/lorem-ipsum
text, poor color contrast or default/generic styling, non-responsive layout,
missing viewport meta tag, and any leftover markdown fences.

Also check specifically for these security issues, and treat any of them as
"major" severity if found: eval() or new Function() usage; innerHTML or
insertAdjacentHTML assigned from a variable/expression instead of a fixed
string (potential XSS); any API key, token, or credential embedded in the
page; target="_blank" links missing rel="noopener noreferrer"; building a
URL by concatenating unescaped input into it.

Return ONLY a JSON object:
{
  "design_score": 0,
  "severity": "none",
  "issues": []
}

design_score: 1-10, honest rating of visual polish and design intentionality.
severity: "none" if publish-ready, "minor" for small nitpicks that don't
block publishing, "major" if a feature is broken/missing or it looks
unfinished and should be fixed before publishing.
issues: short, specific, actionable strings a developer could act on
directly. Empty array if genuinely none.
`.trim();

  const parsed = await callGeminiJson(prompt);
  return {
    designScore: Number(parsed.design_score) || 0,
    severity: parsed.severity || "none",
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
  };
}

async function repairHtml(html, issues, idea) {
  const prompt = `
Fix this HTML file for "${idea.title}" based on the specific issues below.
Keep everything that already works. Return the FULL corrected HTML file,
still a single self-contained file with inline <style> and <script>, still
using real content (no lorem ipsum), still responsive.

Issues to fix:
${issues.map(i => `- ${i}`).join("\n")}

Current HTML:
${html}

Return ONLY the raw corrected HTML, no markdown fences, no commentary.
`.trim();

  const raw = await callGemini(prompt, { maxOutputTokens: HTML_MAX_OUTPUT_TOKENS });
  return raw.replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
}

async function generateRedditDraft(idea) {
  const prompt = `
Write a Reddit post draft for someone sharing an app they personally built.
Tone: honest, low-key, first-person, not salesy. Follow Reddit norms: it
must clearly disclose "I built this" up front, describe the actual problem
it solves, and invite feedback rather than just dropping a link.

App: ${idea.title} — ${idea.description}
Key features: ${(idea.features || []).join(", ")}

Return plain text in exactly this format:
TITLE: <the post title, one line>
BODY:
<the post body, 3-6 short sentences/paragraphs>
`.trim();

  const raw = await callGemini(prompt);
  return raw.trim();
}

// Injects the GoatCounter tracking snippet if configured. No-op otherwise —
// the pipeline works fine without analytics, it just can't tell you which
// site did well later.
function embedAnalytics(html) {
  const code = process.env.GOATCOUNTER_CODE;
  if (!code) return html;
  const snippet = `<script data-goatcounter="https://${code}.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${snippet}\n</head>`);
  return html.replace(/<\/body>/i, `${snippet}\n</body>`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const candidates = await stage(`Brainstorming ${CANDIDATE_COUNT} candidate ideas`, () =>
    generateCandidates(loadPastTitles())
  );

  const researched = await stage("Researching candidates on Hacker News", () => researchCandidates(candidates));

  const idea = await stage("Picking the best-supported idea", () => evaluateAndPick(researched));
  console.log(`  Idea: ${idea.title} (confidence ${idea.confidence_score}/100)`);

  let html = await stage("Building the site", () => generateHtml(idea));

  let review = { designScore: 0, severity: "major", issues: ["not yet reviewed"] };
  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    const staticCheck = staticValidate(html);
    const semantic = await stage(`Self-review pass ${attempt + 1}`, () => reviewHtml(html, idea));
    review = {
      designScore: semantic.designScore,
      severity: staticCheck.ok ? semantic.severity : "major",
      issues: [...staticCheck.issues, ...semantic.issues],
    };

    const passes =
      staticCheck.ok && review.severity !== "major" && review.designScore >= DESIGN_SCORE_THRESHOLD;

    if (passes || attempt === MAX_REPAIR_ATTEMPTS) break;

    console.log(`  Found ${review.issues.length} issue(s), attempting a fix...`);
    html = await stage(`Repair attempt ${attempt + 1}`, () => repairHtml(html, review.issues, idea));
  }

  html = embedAnalytics(html);

  const codeOk = review.severity !== "major" && review.designScore >= DESIGN_SCORE_THRESHOLD;
  const needsReview =
    !codeOk || idea.confidence_score < IDEA_CONFIDENCE_THRESHOLD || idea.risk_flags.length > 0;

  const redditDraft = await stage("Drafting a Reddit post", () => generateRedditDraft(idea));

  const dateSlug = `${todayStamp()}-${idea.slug}`;
  const meta = {
    title: idea.title,
    slug: idea.slug,
    date: todayStamp(),
    description: idea.description,
    features: idea.features,
    target_user: idea.target_user,
    why: {
      demand: idea.demand_reasoning,
      competition: idea.competition_reasoning,
      existing_alternatives: idea.existing_alternatives,
      monetization: idea.monetization_plan,
    },
    confidence_score: idea.confidence_score,
    design_score: review.designScore,
    risk_flags: idea.risk_flags,
    review_issues: review.issues,
    needs_review: needsReview,
    candidates_considered: researched.map(c => ({
      title: c.title,
      hn_mentions: c.signals?.discussionHits ?? null,
      hn_show_hn_launches: c.signals?.showHnHits ?? null,
    })),
  };

  const siteFilesDir = path.join(OUT_DIR, "site-files");
  fs.mkdirSync(siteFilesDir, { recursive: true });
  fs.writeFileSync(path.join(siteFilesDir, "index.html"), html, "utf8");
  fs.writeFileSync(path.join(siteFilesDir, "meta.json"), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "reddit-draft.md"), redditDraft, "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "date-slug.txt"), dateSlug, "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "needs-review.txt"), String(needsReview));
  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify({ dateSlug, ...meta }, null, 2));

  console.log(`\nDone. needs_review=${needsReview}`);

  if (needsReview) {
    const runUrl =
      process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null;

    const reasons = [];
    if (!codeOk) reasons.push(`code review: ${review.issues.slice(0, 3).join("; ") || "design/quality below threshold"}`);
    if (idea.confidence_score < IDEA_CONFIDENCE_THRESHOLD) reasons.push(`idea confidence only ${idea.confidence_score}/100`);
    if (idea.risk_flags.length) reasons.push(`flags: ${idea.risk_flags.join("; ")}`);

    await notifyDiscord(process.env.DISCORD_WEBHOOK_URL, {
      title: `⚠️ Review needed: ${idea.title}`,
      description: idea.description,
      url: runUrl || undefined,
      extra: {
        Why: reasons.join(" | "),
        "Approve here": runUrl || "check the Actions tab",
      },
    });
    await notifyTelegram(
      process.env.TELEGRAM_BOT_TOKEN,
      process.env.TELEGRAM_CHAT_ID,
      `⚠️ <b>Review needed:</b> ${escapeHtml(idea.title)}\n${escapeHtml(idea.description)}\n\nWhy: ${escapeHtml(reasons.join(" | "))}\n\n${runUrl ? `Approve here: ${runUrl}` : "Check the Actions tab to approve."}`
    );
  }
}

main().catch(err => {
  console.error("\nFATAL:", err.message);
  process.exit(1);
});
