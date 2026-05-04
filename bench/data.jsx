/* ============================================================
   data.jsx
   Schema loaders. No React. Pure functions and fetch glue.

   The hub reads:
     reports/reports.json                  registry index
     reports/profiles.json                 profile/provider snapshot
     reports/<id>/manifest.json            full run fingerprint
     reports/<id>/summary.json             aggregated metrics
     reports/<id>/results.jsonl            per-item rows (lazy)
     reports/<id>/report.html              standalone per-run page
   ============================================================ */

const REPORTS_BASE = "reports/";

/* ---------- JSONL parser ---------- */
function parseJsonl(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try { out.push(JSON.parse(line)); }
    catch (err) { console.warn("bad jsonl line:", line.slice(0, 80), err); }
  }
  return out;
}

/* ---------- Network ---------- */
async function loadIndex() {
  try {
    const r = await fetch(`${REPORTS_BASE}reports.json`);
    if (!r.ok) return { version: 2, reports: [], generated_at: null };
    const json = await r.json();
    if (!json || !Array.isArray(json.reports)) {
      return { version: 2, reports: [], generated_at: null };
    }
    return json;
  } catch (err) {
    console.warn("failed to load registry:", err);
    return { version: 2, reports: [], generated_at: null };
  }
}

function extractQuant(filename) {
  if (typeof filename !== "string" || !filename) return "";
  const stripped = filename.replace(/\.gguf$/i, "");
  const match = stripped.match(/(?:UD-)?(IQ?\d+_[A-Z0-9]+(?:_[A-Z0-9]+)?|Q\d+_[A-Z0-9]+(?:_[A-Z0-9]+)?|BF16|F16|F32)/i);
  return match ? match[1] : "";
}

async function loadProfilesSnapshot() {
  try {
    const r = await fetch(`${REPORTS_BASE}profiles.json`);
    if (!r.ok) return null;
    const json = await r.json();
    if (!json || typeof json !== "object") return null;
    return json;
  } catch (err) {
    console.warn("failed to load profiles snapshot:", err);
    return null;
  }
}

async function loadRun(id) {
  const base = `${REPORTS_BASE}${encodeURIComponent(id)}/`;
  const [manifest, summary, results] = await Promise.all([
    fetchJson(base + "manifest.json"),
    fetchJson(base + "summary.json"),
    fetchText(base + "results.jsonl"),
  ]);
  if (!manifest) return null;
  return {
    id,
    base,
    manifest,
    summary: summary || null,
    results: results ? parseJsonl(results) : [],
  };
}

async function fetchJson(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
async function fetchText(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return "";
    return await r.text();
  } catch { return ""; }
}

/* ---------- Adapter / track helpers ---------- */
function listAdapters(reports) {
  const seen = new Set();
  for (const r of reports) {
    const a = r.adapter || {};
    if (a.name) seen.add(a.name);
  }
  return [...seen].sort();
}

function listTracks(reports) {
  const seen = new Set();
  for (const r of reports) {
    const t = r.adapter && r.adapter.track;
    if (t) seen.add(t);
  }
  return [...seen].sort();
}

function groupByComparability(reports) {
  const buckets = new Map();
  for (const r of reports) {
    const key = r.comparability_key || `__lone__:${r.id}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }
  return buckets;
}

/* ---------- Format helpers used by views ---------- */
function fmtAccuracy(ci) {
  if (!ci || ci.point == null) return "—";
  return (ci.point * 100).toFixed(1) + "%";
}
function fmtCi(ci) {
  if (!ci || ci.point == null) return "—";
  if (ci.lo == null || ci.hi == null) return fmtAccuracy(ci);
  return `${(ci.point * 100).toFixed(1)}% [${(ci.lo * 100).toFixed(1)}, ${(ci.hi * 100).toFixed(1)}]`;
}
function fmtMs(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(0) + " ms";
}
function fmtTps(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(1) + " tok/s";
}
function fmtTimestamp(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().replace("T", " ").replace("Z", " UTC");
  } catch { return iso; }
}

/* ---------- Per-run summary metrics for cards ---------- */
function summaryCards(run) {
  const s = run.summary || {};
  const m = run.manifest || {};
  const adapter = m.adapter || {};
  return [
    { label: "Items", value: s.item_count ?? "—" },
    { label: "Correct", value: s.correct_count ?? "—" },
    { label: "Accuracy", value: fmtCi(s.accuracy) },
    { label: "Partial mean", value: s.partial ? (s.partial.point * 100).toFixed(1) + "%" : "—" },
    { label: "Parse failures", value: s.parse_failure_count ?? 0 },
    { label: "Errors", value: s.error_count ?? 0 },
    { label: "Median latency", value: fmtMs(s.median_latency_ms) },
    { label: "Median TTFT", value: fmtMs(s.median_ttft_ms) },
    { label: "Median throughput", value: fmtTps(s.median_tokens_per_sec) },
    { label: "Track", value: adapter.track || "—" },
    { label: "Adapter", value: adapter.name ? `${adapter.name}@${adapter.version}` : "—" },
    {
      label: "Comparability",
      value: m.comparability_key ? m.comparability_key.slice(0, 12) + "…" : "—",
      copy: m.comparability_key || null,
      title: m.comparability_key
        ? `${m.comparability_key}\n(click to copy)\n\nSHA-256 of model + provider + decode params + prompt template + dataset + scorer. Two runs with the same key are apples-to-apples comparable.`
        : undefined,
    },
  ];
}

/* ---------- Public ----------
   Surface used by other .jsx files in this hub. REPORTS_BASE and parseJsonl
   stay module-local since they're internal helpers. If you need either from
   another file, lift it back onto window.BenchData rather than re-fetching
   `reports/` paths in two places.
*/
window.BenchData = {
  loadIndex,
  loadProfilesSnapshot,
  loadRun,
  extractQuant,
  listAdapters,
  listTracks,
  groupByComparability,
  fmtAccuracy,
  fmtCi,
  fmtMs,
  fmtTps,
  fmtTimestamp,
  summaryCards,
};
