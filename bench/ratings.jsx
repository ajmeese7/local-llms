/* ============================================================
   ratings.jsx — manual subjective ratings.

   Storage: localStorage, keyed by (comparability_key, item_id) so a
   rating sticks across re-runs of the same configuration. Re-running
   with a different prompt template (different comparability_key) starts
   the rating fresh.

   Public API:
     BenchRatings.read(ck, itemId)        → {stars, note, tags, rated_at} | null
     BenchRatings.write(ck, itemId, data) → void
     BenchRatings.clear(ck, itemId)       → void
     BenchRatings.aggregate(ck, itemIds)  → {mean, count} (count of rated items)
     BenchRatings.exportAll()             → JSON string of all ratings on this host
     BenchRatings.importAll(json)         → number of ratings imported
   ============================================================ */

const RATING_PREFIX = "bench:rating:";

function _key(comparabilityKey, itemId) {
  return `${RATING_PREFIX}${comparabilityKey}:${itemId}`;
}

function readRating(comparabilityKey, itemId) {
  if (!comparabilityKey || !itemId) return null;
  try {
    const raw = localStorage.getItem(_key(comparabilityKey, itemId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Subscribers fire whenever a rating is written, cleared, or imported. Lets
// components on other pages (e.g. the home leaderboard) re-render against
// localStorage without a manual refresh.
const _subscribers = new Set();
function _notify() {
  for (const cb of _subscribers) {
    try { cb(); } catch { /* swallow subscriber errors */ }
  }
}
function subscribe(callback) {
  _subscribers.add(callback);
  return () => _subscribers.delete(callback);
}

function writeRating(comparabilityKey, itemId, data) {
  if (!comparabilityKey || !itemId) return;
  const merged = {
    stars: data?.stars ?? null,
    note: data?.note ?? "",
    tags: Array.isArray(data?.tags) ? data.tags.filter(t => typeof t === "string") : [],
    rated_at: new Date().toISOString(),
  };
  // No rating data? Drop the entry so it doesn't show as "rated".
  const empty = merged.stars == null && !merged.note && !merged.tags.length;
  const k = _key(comparabilityKey, itemId);
  if (empty) {
    try { localStorage.removeItem(k); } catch { /* quota / privacy mode */ }
    _notify();
    return;
  }
  try {
    localStorage.setItem(k, JSON.stringify(merged));
    _notify();
  } catch {
    // Quota exceeded or storage disabled. Caller can re-read to confirm.
  }
}

function clearRating(comparabilityKey, itemId) {
  try { localStorage.removeItem(_key(comparabilityKey, itemId)); _notify(); } catch { /* */ }
}

// Mean over rated items only. Unrated items are excluded from the count.
function aggregateRatings(comparabilityKey, itemIds) {
  let sum = 0;
  let count = 0;
  for (const id of itemIds || []) {
    const r = readRating(comparabilityKey, id);
    if (r && Number.isFinite(Number(r.stars))) {
      sum += Number(r.stars);
      count += 1;
    }
  }
  return count > 0 ? { mean: sum / count, count } : { mean: null, count: 0 };
}

function exportAll() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(RATING_PREFIX)) continue;
      try { out[k.slice(RATING_PREFIX.length)] = JSON.parse(localStorage.getItem(k)); }
      catch { /* skip corrupt */ }
    }
  } catch { /* storage disabled */ }
  return JSON.stringify({ version: 1, exported_at: new Date().toISOString(), ratings: out }, null, 2);
}

function importAll(jsonText) {
  let parsed;
  try { parsed = JSON.parse(jsonText); }
  catch { return 0; }
  const ratings = parsed?.ratings;
  if (typeof ratings !== "object" || ratings === null) return 0;
  let imported = 0;
  for (const [suffix, data] of Object.entries(ratings)) {
    if (typeof data !== "object" || data === null) continue;
    try {
      localStorage.setItem(RATING_PREFIX + suffix, JSON.stringify(data));
      imported += 1;
    } catch { /* quota */ }
  }
  if (imported > 0) _notify();
  return imported;
}

window.BenchRatings = {
  read: readRating,
  write: writeRating,
  clear: clearRating,
  aggregate: aggregateRatings,
  subscribe,
  exportAll,
  importAll,
};
