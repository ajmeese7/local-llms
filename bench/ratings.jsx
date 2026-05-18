/* ============================================================
   ratings.jsx — manual subjective ratings.

   Storage: localStorage, keyed by (comparability_key, item_id) so a
   rating sticks across re-runs of the same configuration. Re-running
   with a different prompt template (different comparability_key) starts
   the rating fresh. Bench-level notes (overall "how does this model
   feel") are stored separately, keyed by bench id.

   Public API:
     BenchRatings.read(ck, itemId)        → {stars, note, tags, rated_at} | null
     BenchRatings.write(ck, itemId, data) → void
     BenchRatings.clear(ck, itemId)       → void
     BenchRatings.aggregate(ck, itemIds)  → {mean, count} (count of rated items)
     BenchRatings.readBenchNote(benchId)  → {text, stars, updated_at} | null
     BenchRatings.writeBenchNote(benchId, {text, stars}) → void
     BenchRatings.exportAll()             → JSON string of all ratings on this host
     BenchRatings.importAll(json)         → number of entries imported
   ============================================================ */

const RATING_PREFIX = "bench:rating:";
const BENCH_NOTE_PREFIX = "bench:note:";

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

function readBenchNote(benchId) {
  if (!benchId) return null;
  try {
    const raw = localStorage.getItem(BENCH_NOTE_PREFIX + benchId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    if (typeof parsed.text !== "string") return null;
    // Older entries (pre-stars) have no `stars` field; normalize to null.
    if (!Number.isFinite(Number(parsed.stars))) parsed.stars = null;
    return parsed;
  } catch {
    return null;
  }
}

function writeBenchNote(benchId, data) {
  if (!benchId) return;
  const k = BENCH_NOTE_PREFIX + benchId;
  const text = (data?.text ?? "").trim();
  const starsRaw = Number(data?.stars);
  const stars = Number.isFinite(starsRaw) && starsRaw >= 1 && starsRaw <= 5
    ? Math.round(starsRaw) : null;
  if (!text && stars == null) {
    try { localStorage.removeItem(k); } catch { /* */ }
    _notify();
    return;
  }
  const payload = { text, stars, updated_at: new Date().toISOString() };
  try {
    localStorage.setItem(k, JSON.stringify(payload));
    _notify();
  } catch { /* quota */ }
}

function exportAll() {
  const ratings = {};
  const benchNotes = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith(RATING_PREFIX)) {
        try { ratings[k.slice(RATING_PREFIX.length)] = JSON.parse(localStorage.getItem(k)); }
        catch { /* skip corrupt */ }
      } else if (k.startsWith(BENCH_NOTE_PREFIX)) {
        try { benchNotes[k.slice(BENCH_NOTE_PREFIX.length)] = JSON.parse(localStorage.getItem(k)); }
        catch { /* skip corrupt */ }
      }
    }
  } catch { /* storage disabled */ }
  return JSON.stringify({
    version: 2,
    exported_at: new Date().toISOString(),
    ratings,
    bench_notes: benchNotes,
  }, null, 2);
}

// Import strategy: "merge" only writes entries that aren't already in
// localStorage (preserves local edits); "overwrite" replaces every entry.
// Returns the total count of ratings + bench notes imported.
function importAll(jsonText, strategy = "overwrite") {
  let parsed;
  try { parsed = JSON.parse(jsonText); }
  catch { return 0; }
  let imported = 0;
  const ratings = parsed?.ratings;
  if (typeof ratings === "object" && ratings !== null) {
    for (const [suffix, data] of Object.entries(ratings)) {
      if (typeof data !== "object" || data === null) continue;
      const k = RATING_PREFIX + suffix;
      if (strategy === "merge") {
        try { if (localStorage.getItem(k) !== null) continue; } catch { /* */ }
      }
      try {
        localStorage.setItem(k, JSON.stringify(data));
        imported += 1;
      } catch { /* quota */ }
    }
  }
  const benchNotes = parsed?.bench_notes;
  if (typeof benchNotes === "object" && benchNotes !== null) {
    for (const [benchId, data] of Object.entries(benchNotes)) {
      if (typeof data !== "object" || data === null) continue;
      const text = typeof data.text === "string" ? data.text.trim() : "";
      const starsRaw = Number(data.stars);
      const stars = Number.isFinite(starsRaw) && starsRaw >= 1 && starsRaw <= 5
        ? Math.round(starsRaw) : null;
      if (!text && stars == null) continue;
      const k = BENCH_NOTE_PREFIX + benchId;
      if (strategy === "merge") {
        try { if (localStorage.getItem(k) !== null) continue; } catch { /* */ }
      }
      try {
        localStorage.setItem(k, JSON.stringify(data));
        imported += 1;
      } catch { /* quota */ }
    }
  }
  if (imported > 0) _notify();
  return imported;
}

// Fetch ratings.json from the repo's bench/reports/ directory. The bench's
// `eval report` command doesn't emit this file — it's committed by the
// user via the Export button. Returns the number of ratings merged in.
async function loadFromRepo(strategy = "merge") {
  try {
    const r = await fetch("reports/ratings.json", { cache: "no-store" });
    if (!r.ok) return 0;
    const text = await r.text();
    return importAll(text, strategy);
  } catch {
    return 0;
  }
}

// Bench ids changed when the registry started keying by
// (hardware_profile, model_profile, server.engine) instead of (hardware,
// model). Any bench note written before that split is now orphaned in
// localStorage under the old id. This walks the orphans, computes the
// legacy `sha256("hw::model")[:16]` for every current bench, and re-keys
// matches onto the most-recently-timestamped new bench. Idempotent: the
// second call is a no-op because the source keys are gone.
async function _legacyBenchId(hw, model) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${hw}::${model}`));
  let hex = "";
  for (const byte of new Uint8Array(buf)) hex += byte.toString(16).padStart(2, "0");
  return hex.slice(0, 16);
}

async function migrateBenchNotes(index) {
  if (!index || !Array.isArray(index.benches)) return 0;

  // Build legacyId => list of candidate current benches.
  const byLegacy = new Map();
  for (const b of index.benches) {
    const hw = b.hardware_profile || "unknown";
    const model = b.model_profile || "unknown";
    const legacyId = await _legacyBenchId(hw, model);
    if (legacyId === b.id) continue;  // not split, no migration possible
    const arr = byLegacy.get(legacyId) || [];
    arr.push(b);
    byLegacy.set(legacyId, arr);
  }
  if (byLegacy.size === 0) return 0;

  // Sweep localStorage for orphan note keys (bench id not in the registry).
  const currentIds = new Set(index.benches.map(b => b.id));
  const orphanKeys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(BENCH_NOTE_PREFIX)) continue;
      const id = k.slice(BENCH_NOTE_PREFIX.length);
      if (!currentIds.has(id)) orphanKeys.push(k);
    }
  } catch {
    return 0;
  }

  let migrated = 0;
  for (const k of orphanKeys) {
    const oldId = k.slice(BENCH_NOTE_PREFIX.length);
    const candidates = byLegacy.get(oldId);
    if (!candidates || !candidates.length) continue;
    candidates.sort((a, b) => (b.latest_timestamp || "").localeCompare(a.latest_timestamp || ""));
    const winner = candidates[0];
    const newKey = BENCH_NOTE_PREFIX + winner.id;
    try {
      const value = localStorage.getItem(k);
      if (value && localStorage.getItem(newKey) == null) {
        localStorage.setItem(newKey, value);
        migrated += 1;
      }
      localStorage.removeItem(k);
    } catch {
      // Quota or storage disabled. Skip silently; next page load retries.
    }
  }
  if (migrated > 0) _notify();
  return migrated;
}

window.BenchRatings = {
  read: readRating,
  write: writeRating,
  clear: clearRating,
  aggregate: aggregateRatings,
  readBenchNote,
  writeBenchNote,
  subscribe,
  exportAll,
  importAll,
  loadFromRepo,
  migrateBenchNotes,
};
