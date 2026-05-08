/* ============================================================
   data.jsx
   Schema loaders + bench rollup. No React. Pure functions and
   fetch glue.

   Top-level entity: a **bench**, keyed by (hardware_profile,
   model_profile). Each bench owns capability **cells** (one per
   comparability_key — i.e. one capability against this model).
   Each cell keeps history: re-running the same adapter against
   the same model preserves earlier results, latest highlighted.

   Hub reads:
     reports/reports.json                  registry index (with `benches`)
     reports/profiles.json                 profile/provider snapshot
     reports/<id>/manifest.json            full run fingerprint
     reports/<id>/summary.json             aggregated metrics
     reports/<id>/results.jsonl            per-item rows (lazy)
   ============================================================ */

const REPORTS_BASE = "reports/";

/* ---------- JSONL ---------- */
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

async function loadIndex() {
  const empty = { version: 4, reports: [], benches: [], generated_at: null };
  try {
    const r = await fetch(`${REPORTS_BASE}reports.json`);
    if (!r.ok) return empty;
    const json = await r.json();
    if (!json || !Array.isArray(json.reports)) return empty;
    if (!Array.isArray(json.benches)) {
      json.benches = deriveBenches(json.reports);
    }
    return json;
  } catch (err) {
    console.warn("failed to load registry:", err);
    return empty;
  }
}

async function loadProfilesSnapshot() {
  return fetchJson(`${REPORTS_BASE}profiles.json`);
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
    id, base, manifest,
    summary: summary || null,
    results: results ? parseJsonl(results) : [],
  };
}

/* ---------- Bench resolution ---------- */
function deriveBenches(reports) {
  // Client-side fallback when the registry is older than v4.
  const grouped = new Map();
  for (const r of reports) {
    const hw = r.hardware?.profile || "unknown";
    const model = r.profile || r.alias || "unknown";
    const key = `${hw}::${model}`;
    if (!grouped.has(key)) grouped.set(key, { hw, model, members: [] });
    grouped.get(key).members.push(r);
  }
  const benches = [];
  for (const { hw, model, members } of grouped.values()) {
    members.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
    const head = members[0];
    benches.push({
      id: hashId(`${hw}::${model}`),
      hardware_profile: hw,
      model_profile: model,
      model_alias: head.alias || model,
      title: benchTitleFromHead(head, hw, model),
      latest_timestamp: head.timestamp,
      hardware: head.hardware || null,
      server: head.server || null,
      cell_count: 0,  // re-derived in buildCells
      run_count: members.length,
      cells: deriveCells(members),
    });
    benches[benches.length - 1].cell_count = benches[benches.length - 1].cells.length;
  }
  benches.sort((a, b) => (b.latest_timestamp || "").localeCompare(a.latest_timestamp || ""));
  return benches;
}

function deriveCells(reports) {
  const byKey = new Map();
  for (const r of reports) {
    const key = r.comparability_key;
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }
  const cells = [];
  for (const [key, runs] of byKey.entries()) {
    runs.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
    const latest = runs[0];
    cells.push({
      comparability_key: key,
      comparability_prefix: key.slice(0, 8),
      adapter: latest.adapter || {},
      latest,
      history_ids: runs.map(r => r.id),
      run_count: runs.length,
    });
  }
  cells.sort((a, b) =>
    (b.latest.timestamp || "").localeCompare(a.latest.timestamp || "") ||
    (a.adapter.name || "").localeCompare(b.adapter.name || "")
  );
  return cells;
}

function hashId(s) {
  // Lightweight, browser-friendly stable id. Not cryptographic; only used
  // when the server hasn't already produced a sha256 id.
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${hex}${hex}`.slice(0, 16);
}

function benchTitleFromHead(head, hwProfile, modelProfile) {
  const alias = head.alias || modelProfile;
  const gpu = head.hardware?.gpu_name || hwProfile;
  if (!gpu || gpu === "unknown") return alias;
  return `${alias} on ${gpuShort(gpu)}`;
}

function gpuShort(name) {
  if (!name) return "";
  return name.replace(/^NVIDIA\s+/i, "").replace(/^GeForce\s+/i, "");
}

function findBench(index, benchId) {
  if (!index || !Array.isArray(index.benches)) return null;
  return index.benches.find(b => b.id === benchId) || null;
}

async function loadBench(benchId) {
  const index = await loadIndex();
  const bench = findBench(index, benchId);
  if (!bench) return null;
  // For each cell, eagerly load the latest run (manifest+summary+results).
  // History is loaded lazily via loadCellHistory().
  const cells = await Promise.all(
    (bench.cells || []).map(async cell => {
      const latestId = cell.latest?.id;
      const run = latestId ? await loadRun(latestId) : null;
      return {
        ...cell,
        run,
        rollup: run ? buildCellRollup(cell, run) : null,
      };
    })
  );
  return {
    bench,
    meta: buildBenchMeta(bench, cells),
    cells,
  };
}

async function loadCellHistory(cell) {
  const ids = (cell.history_ids || []).slice(1);  // drop the latest (already loaded)
  const runs = await Promise.all(ids.map(id => loadRun(id)));
  return runs.filter(Boolean);
}

function buildBenchMeta(bench, cells) {
  const latestCell = cells[0];
  const head = latestCell?.run?.manifest || {};
  // Prefer the registry-computed total; fall back to summing cell rollups.
  let suiteSeconds = bench.suite_seconds ?? null;
  if (suiteSeconds == null) {
    let sum = 0;
    let any = false;
    for (const c of cells) {
      const w = c.rollup?.wallSeconds;
      if (Number.isFinite(Number(w))) { sum += Number(w); any = true; }
    }
    suiteSeconds = any ? sum : null;
  }
  return {
    id: bench.id,
    title: bench.title,
    model_alias: bench.model_alias,
    model_profile: bench.model_profile,
    hardware_profile: bench.hardware_profile,
    hardware: bench.hardware || head.hardware || null,
    server: bench.server || head.server || null,
    provider: head.provider?.name || null,
    latest_timestamp: bench.latest_timestamp,
    cell_count: bench.cell_count,
    run_count: bench.run_count,
    suite_seconds: suiteSeconds,
  };
}

/* ---------- Per-cell rollup ---------- */
function buildCellRollup(cell, run) {
  const summary = run.summary || {};
  const results = run.results || [];
  const adapter = cell.adapter || run.manifest?.adapter || {};
  // Adapters where partial mean is the right headline (rubric-graded);
  // everything else uses accuracy.
  const rubricAdapters = new Set(["local_smoke"]);
  const useRubric = rubricAdapters.has(adapter.name);
  const ci = useRubric ? summary.partial : summary.accuracy;
  const qualityKind = useRubric ? "partial" : "accuracy";
  const quality = ci && Number.isFinite(Number(ci.point))
    ? Number(ci.point) * 100
    : null;

  let cleanCount = 0, leakCount = 0, emptyCount = 0;
  const tpsValues = [];
  const latencyValues = [];
  for (const row of results) {
    const c = classifyCleanliness(row);
    if (c === "clean") cleanCount++;
    else if (c === "leak") leakCount++;
    else if (c === "empty") emptyCount++;
    if (Number.isFinite(Number(row.tokens_per_sec))) tpsValues.push(Number(row.tokens_per_sec));
    if (Number.isFinite(Number(row.latency_ms))) latencyValues.push(Number(row.latency_ms) / 1000);
  }
  const timing = summary.timing || null;
  return {
    quality,
    qualityCi: ci || null,
    qualityKind,
    accuracyCi: summary.accuracy || null,
    partialCi: summary.partial || null,
    tps: summary.median_tokens_per_sec ?? median(tpsValues),
    latency: summary.median_latency_ms != null
      ? summary.median_latency_ms / 1000
      : median(latencyValues),
    medianLatencyMs: summary.median_latency_ms ?? null,
    medianTtftMs: summary.median_ttft_ms ?? null,
    itemCount: summary.item_count ?? results.length,
    correctCount: summary.correct_count ?? null,
    parseFailureCount: summary.parse_failure_count ?? 0,
    errorCount: summary.error_count ?? 0,
    cleanCount, leakCount, emptyCount,
    totalRows: results.length,
    wallSeconds: timing?.wall_seconds ?? null,
    computeSeconds: timing?.compute_seconds ?? null,
  };
}

/* ---------- Cleanliness ---------- */
const THINK_PREAMBLE_RE =
  /^\s*(<think>|here'?s a thinking process|thinking process|deconstruct(?:ing)? the prompt|analy(?:s|z)e (?:user|the) (?:input|requirements?|prompt))/i;

function classifyCleanliness(row) {
  const raw = (row.raw || "").trim();
  if (!raw) return "empty";
  if (/^<think>\s*<\/think>/i.test(raw) && raw.length < 80) return "empty";
  if (THINK_PREAMBLE_RE.test(raw)) return "leak";
  if (/^\s*<think>/i.test(raw)) return "leak";
  return "clean";
}

/* ---------- Per-metric leaderboards ----------
   A leaderboard ranks bench cells across the registry by one metric.
   Cells from the same hardware_profile are apples-to-apples (their
   comparability_keys agree on hardware). Cross-hardware ranking is
   shown but flagged as "cross-hw" so the user reads it accordingly.
*/
async function loadLeaderboards(index) {
  const idx = index || (await loadIndex());
  const benches = (idx.benches || []);
  // Eagerly load each bench so we can read every cell's rollup. With one
  // bench in the common case this is cheap.
  const loaded = await Promise.all(benches.map(b => loadBench(b.id)));
  const valid = loaded.filter(Boolean);

  // Discover what adapters exist across the registry.
  const adapterNames = new Set();
  for (const lb of valid) for (const c of lb.cells) if (c.adapter?.name) adapterNames.add(c.adapter.name);

  // For each metric we care about, build a leaderboard.
  const result = {
    tps: rankCells(valid, "tps"),
    quality: rankCells(valid, "quality"),
    perAdapter: {},
  };
  for (const adapter of adapterNames) {
    result.perAdapter[adapter] = rankCells(valid, "quality", adapter);
  }
  return result;
}

function rankCells(loadedBenches, metric, adapterName) {
  const rows = [];
  for (const lb of loadedBenches) {
    for (const cell of lb.cells) {
      if (!cell.rollup) continue;
      if (adapterName && cell.adapter?.name !== adapterName) continue;
      const value = Number(cell.rollup[metric]);
      if (!Number.isFinite(value)) continue;
      rows.push({
        value,
        metric,
        adapter: cell.adapter,
        benchId: lb.bench.id,
        benchTitle: lb.bench.title,
        modelAlias: lb.bench.model_alias,
        hardwareProfile: lb.bench.hardware_profile,
        timestamp: cell.latest?.timestamp,
      });
    }
  }
  rows.sort((a, b) => b.value - a.value);
  return rows;
}

/* ---------- Recommendations ---------- */
function generateRecommendations(loadedBenches, currentBench) {
  // Compare cells across benches sharing the same hardware_profile.
  const sameHw = loadedBenches.filter(b => b.bench.hardware_profile === currentBench.bench.hardware_profile);
  if (sameHw.length < 2) return [];  // need a peer to recommend against
  const recs = [];
  // For each adapter present in the current bench, find best on this hw.
  for (const cell of currentBench.cells) {
    const name = cell.adapter?.name;
    if (!name) continue;
    const peers = [];
    for (const lb of sameHw) {
      const peer = lb.cells.find(c => c.adapter?.name === name);
      if (peer && peer.rollup) peers.push({ bench: lb.bench, cell: peer });
    }
    if (peers.length < 2) continue;
    const winner = peers.reduce(
      (best, p) => Number(p.cell.rollup.quality) > Number(best.cell.rollup.quality) ? p : best,
    );
    if (winner.bench.id !== currentBench.bench.id) {
      recs.push({
        adapter: name,
        winnerTitle: winner.bench.title,
        winnerBenchId: winner.bench.id,
        winnerQuality: winner.cell.rollup.quality,
        currentQuality: cell.rollup?.quality,
      });
    }
  }
  return recs;
}

/* ---------- .conf parser ---------- */
function parseConf(text, filename) {
  const fields = {};
  const order = [];
  for (const raw of (text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fields[m[1]] = val;
    if (!order.includes(m[1])) order.push(m[1]);
  }
  const modelPath = fields.MODEL || "";
  const modelFile = modelPath.split("/").pop() || modelPath;
  const quant = extractQuant(modelFile || fields.HF_FILE || "");
  const profileId = (filename || "").replace(/\.conf$/, "");
  return { profile_id: profileId, fields, order, derived: { model_file: modelFile, quant } };
}

async function loadProfileConf(profileName) {
  if (!profileName) return null;
  const safe = encodeURIComponent(profileName);
  for (const url of [`configs/${safe}.conf`, `../config/profiles/${safe}.conf`]) {
    const text = await fetchText(url);
    if (text) return parseConf(text, `${profileName}.conf`);
  }
  return null;
}

/* ---------- Format helpers ---------- */
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

function extractQuant(filename) {
  if (typeof filename !== "string" || !filename) return "";
  const stripped = filename.replace(/\.gguf$/i, "");
  const match = stripped.match(/(?:UD-)?(IQ?\d+_[A-Z0-9]+(?:_[A-Z0-9]+)?|Q\d+_[A-Z0-9]+(?:_[A-Z0-9]+)?|BF16|F16|F32)/i);
  return match ? match[1] : "";
}

function fmtAccuracy(ci) {
  if (!ci || ci.point == null) return "—";
  return (Number(ci.point) * 100).toFixed(1) + "%";
}
function fmtCi(ci) {
  if (!ci || ci.point == null) return "—";
  if (ci.lo == null || ci.hi == null) return fmtAccuracy(ci);
  return `${(ci.point * 100).toFixed(1)}% [${(ci.lo * 100).toFixed(1)}, ${(ci.hi * 100).toFixed(1)}]`;
}
function fmtMs(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(0)} ms` : "—";
}
function fmtTps(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)} tok/s` : "—";
}
function fmtSeconds(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)} s` : "—";
}
function fmtQuality(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "—";
}
function fmtDuration(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1) return `${(n * 1000).toFixed(0)} ms`;
  if (n < 60) return `${n.toFixed(1)} s`;
  const totalSec = Math.round(n);
  const minutes = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (minutes < 60) return `${minutes}m ${sec.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins.toString().padStart(2, "0")}m`;
}
function fmtTimestamp(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().replace("T", " ").replace("Z", " UTC");
  } catch { return iso; }
}
function fmtDateOnly(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
  } catch { return iso; }
}

/* ---------- Public ---------- */
window.BenchData = {
  // loaders
  loadIndex, loadProfilesSnapshot, loadRun, loadBench, loadCellHistory,
  loadLeaderboards, loadProfileConf,
  // bench helpers
  deriveBenches, deriveCells, findBench, gpuShort,
  // dataset helpers
  classifyCleanliness, generateRecommendations,
  // configs
  parseConf, extractQuant,
  // formatters
  fmtAccuracy, fmtCi, fmtMs, fmtTps, fmtSeconds, fmtQuality, fmtDuration, fmtTimestamp, fmtDateOnly,
};
