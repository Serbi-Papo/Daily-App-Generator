// lib/goatcounter.js — reads visitor stats back out of GoatCounter (the
// free analytics embedded in every generated site) so the pipeline can tell
// you which site is actually getting traffic.
//
// GoatCounter's API is versioned "v0" and still evolving, so exact field
// names on /api/v0/stats/hits can shift over time. This parses defensively
// and falls back to 0 rather than crashing if a field isn't where expected
// — check https://www.goatcounter.com/help/api if counts look wrong.

export async function fetchHits({ code, token }) {
  const url = `https://${code}.goatcounter.com/api/v0/stats/hits?limit=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`GoatCounter API error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const hits = data.hits || [];

  return hits.map(h => ({
    path: h.path || h.title || "",
    count:
      h.count ??
      (Array.isArray(h.stats) ? h.stats.reduce((sum, d) => sum + (d.count || 0), 0) : 0),
  }));
}
