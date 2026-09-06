# A Website a Day 🌐

Every day: researches several app ideas against live data, picks the
best-supported one, builds it, checks its own work and fixes mistakes, asks
for your approval when it's not confident, promotes it, and later tells you
if it's actually getting traffic. All free.

- Research + ideas + code + self-review: Gemini API free tier
- Live demand/competition data: Hacker News Algolia Search API (free, no key)
- Scheduling + human-approval gate: GitHub Actions (free, public repos)
- Hosting: GitHub Pages (free)
- Analytics: GoatCounter (free tier)
- Promotion: RSS + Discord/Telegram (automatic), Reddit (drafted for you, posted by you)

## Why Hacker News, and not Google Trends / Reddit / a search API

This matters enough to be upfront about: I looked at the obvious "real
market data" sources and most of them are dead ends for a free pipeline as
of 2026:

- **Google Custom Search API** closed to new signups this year — not usable
  if you're setting this up fresh.
- **Reddit's API** shut down all free/unauthenticated read access in May
  2026, and self-service OAuth approval is effectively closed to individual
  developers now. Not usable as a data source, and (as covered below)
  definitely not usable for auto-posting.
- **Google Trends** has no official API at all — anything claiming to offer
  one is scraping an undocumented internal endpoint, which breaks without
  notice and technically violates Google's terms even for light use.

**Hacker News' Algolia-powered search API is still free, official-ish
(Algolia runs it as a public good), documented, and requires no key or
login.** It's the one live, current, genuinely free data source left that
fits this pipeline. The honest limitation: it skews toward developer/tech
audiences, so it's a real but partial signal — strong for dev-tool and
tech-adjacent ideas, weaker for, say, a wedding budgeting tool. The
pipeline leans on it for what it's good at (discussion volume + "has this
already been launched") and still asks for your review when the signal is
thin or ambiguous.

## How it picks an idea now

Each run: brainstorms 5 different app concepts, looks up real, current
Hacker News data for each one (how much it's discussed, and how many
similar tools have already launched as "Show HN" posts), then makes a
single Gemini call that has to reason from that actual data — not
vibes — to pick the one best-supported idea and write up demand/competition
reasoning that cites the real numbers. `meta.json` for each published site
keeps the full comparison (`candidates_considered`) so you can see what it
passed over and why.

## How it checks its own work

A second model call reviews the built site against the brief — missing
features, broken JS, placeholder text, weak/generic design, missing mobile
responsiveness — plus a few fast non-AI checks (valid HTML, no leftover
markdown fences, no lorem ipsum). If it finds real issues, it feeds them
back and asks for a fix, up to twice. Still not right after that → flagged
for review instead of shipped broken.

## When it asks for your input

Runs on autopilot when everything checks out. Stops and asks for **you**
when:
- idea confidence is below 65/100
- the code still has unresolved issues after two repair attempts, or the
  design score is below 7/10
- the model flagged a risk (trademark concern, shaky monetization claim, etc.)

Nothing publishes or promotes until you approve. You'll get a
Discord/Telegram ping (if configured) with a direct link to the GitHub
Actions run to approve or reject. Without those configured, check the
Actions tab — you'll see a run sitting in "Waiting" state.

## How you find out if one's doing well

Every generated site includes a GoatCounter tracking snippet (if you set
one up — see setup below). A separate daily job pulls real visitor counts
per site and:
- shows a "👀 N visits" badge on that site's card in the gallery
- pings you on Discord/Telegram the **first time** a site crosses a new
  visitor milestone (10 → 50 → 100 → 500 → 1,000 → 5,000 → 10,000), so you
  find out which one's actually working without getting a daily spam of
  numbers

## Setup (about 15 minutes)

1. **Gemini API key** — https://aistudio.google.com/ → "Get API key". Free,
   no card.

2. **Create a public GitHub repo**, push these files in.

3. **Required secret**: Settings → Secrets and variables → Actions:
   - `GEMINI_API_KEY`

4. **Human-approval gate**: Settings → Environments → New environment →
   name it exactly `manual-review` → add yourself as a **required
   reviewer** → Save. (`auto-publish` is created automatically, no setup
   needed.)

5. **GoatCounter (for analytics + "which one worked" notifications)**:
   - Sign up free at https://www.goatcounter.com/ (no card) and pick a site
     code, e.g. `myproject` → your dashboard is `myproject.goatcounter.com`
   - Account menu → API → New key (needs at least read access to stats)
   - Add secrets: `GOATCOUNTER_CODE` (just the code, e.g. `myproject`) and
     `GOATCOUNTER_API_TOKEN`
   - Skip this and everything else still works — you just won't get
     visitor badges or "it's doing well" pings

6. **(Optional) promotion secrets** — skip any you don't want:
   - `DISCORD_WEBHOOK_URL` — Discord Server Settings → Integrations →
     Webhooks → New Webhook
   - `TELEGRAM_BOT_TOKEN` — message @BotFather → `/newbot`
   - `TELEGRAM_CHAT_ID` — add the bot to your chat/channel, send it a
     message, then check `https://api.telegram.org/bot<TOKEN>/getUpdates`

7. **Enable GitHub Pages** — Settings → Pages → Source: "Deploy from a
   branch" → `main` / `/ (root)`.

8. **Test it** — Actions tab → "Generate daily site" → "Run workflow".
   Watch the `build` job logs to see the candidate research happen live.

9. **Done** — the generator runs daily at 09:00 UTC, the performance
   checker at 18:00 UTC (both editable via the `cron` line in their
   workflow files). Gallery: `https://<username>.github.io/<repo>/`.

## About Reddit

Still not automated, and now for an even clearer reason: Reddit shut down
free API access entirely in 2026 (both anonymous and new OAuth
registrations), specifically while cracking down on bots and AI-driven
posting. An auto-poster today would need to fight that enforcement
directly — fast ban, and it can get the domain itself flagged as spammy.

Every publish still writes a disclosed, first-person draft to
`reddit-drafts/<date-slug>.md` for you to review and post manually — pick a
relevant subreddit, check its self-promotion rules, keep the "I built this"
disclosure, follow the 90/10 participation norm.

## File map

```
generate-site.js        build: candidates → HN research → pick → build → self-review/repair → decide
check-performance.js    reads GoatCounter, updates performance.json, notifies on milestones
publish-site.js         merges a build into sites/, rebuilds gallery + feed (--index-only to just refresh stats)
notify-published.js     announces a fresh publish on Discord/Telegram
lib/gemini.js           Gemini API wrapper (retries, JSON parsing)
lib/hn.js               Hacker News Algolia search client (live data)
lib/goatcounter.js      GoatCounter stats reader
lib/validate.js         fast non-AI HTML sanity checks
lib/notify.js           Discord/Telegram senders (no-ops if unconfigured)
lib/util.js             slugify/date/escape helpers
sites/<date-slug>/      one folder per published site
reddit-drafts/          one draft per publish, for you to review and post
performance.json        latest visitor counts per site (feeds the gallery badges)
performance-state.json  which milestones have already been notified, per site
index.html              auto-generated gallery
feed.xml                auto-generated RSS feed
```

## Notes

- **Model name drift**: Google renames free-tier Gemini model IDs every few
  months. 404 on "model not found" → check https://aistudio.google.com/ and
  update `MODEL` in `lib/gemini.js`.
- **GoatCounter API drift**: it's a "v0", still-evolving API — if visitor
  counts look wrong, check the raw response shape at
  https://www.goatcounter.com/help/api against `lib/goatcounter.js`.
- **Tuning strictness**: thresholds are at the top of `generate-site.js` —
  raise them for a pickier pipeline, lower for more auto-publishing.
  `CANDIDATE_COUNT` controls how many ideas get researched per run (more =
  better picks, more Gemini/HN calls).
- **Hard failures** (bad JSON twice in a row, API hiccup) fail the job
  outright and GitHub emails you — the final backstop under the review gate.
- Hobby-project pattern: no human eyeballs the *content* of an
  auto-published site if it clears the thresholds. Set
  `IDEA_CONFIDENCE_THRESHOLD = 101` to force manual review of every single
  site regardless of score.
