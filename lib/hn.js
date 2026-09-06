// lib/hn.js — Hacker News search via the public Algolia API. Free, no key,
// no login. Used as a real, live (if tech-skewed) signal: how much a topic
// gets discussed (demand proxy) and how many similar things have already
// been launched as "Show HN" posts (competition proxy).
//
// Docs: https://hn.algolia.com/api

const BASE = "https://hn.algolia.com/api/v1/search";

export async function hnSearch(query, { tags, hitsPerPage = 5 } = {}) {
  const params = new URLSearchParams({ query, hitsPerPage: String(hitsPerPage) });
  if (tags) params.set("tags", tags);

  const res = await fetch(`${BASE}?${params.toString()}`);
  if (!res.ok) throw new Error(`HN Algolia API error ${res.status}`);
  const data = await res.json();

  return {
    totalHits: data.nbHits || 0,
    hits: (data.hits || []).map(h => ({
      title: h.title || h.story_title || "",
      points: h.points ?? 0,
      numComments: h.num_comments ?? 0,
      url: h.url || h.story_url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    })),
  };
}

// Gathers both a general-discussion signal and a "has this basically been
// built already" signal for a given search phrase.
export async function gatherHnSignals(query) {
  const [discussion, launches] = await Promise.all([
    hnSearch(query, { hitsPerPage: 5 }),
    hnSearch(query, { tags: "show_hn", hitsPerPage: 5 }),
  ]);
  return {
    discussionHits: discussion.totalHits,
    topDiscussion: discussion.hits.slice(0, 3),
    showHnHits: launches.totalHits,
    topLaunches: launches.hits.slice(0, 3),
  };
}
