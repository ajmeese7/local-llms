/* ============================================================
   data.jsx
   Pure functions for parsing results.jsonl + deriving the
   shape the UI consumes. No React in this file.
   ============================================================ */

/* ---------- JSONL parsing ---------- */
function parseJsonl(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); }
    catch (e) { console.warn("bad jsonl line:", t.slice(0, 80)); }
  }
  return out;
}

/* ---------- Cleanliness classification ----------
   leak  = visible <think> block or "thinking process" preamble in content
   empty = used_reasoning_fallback=true AND output starts with empty <think></think>
           or response is mostly empty content
   clean = answer text only, no preamble
---------------------------------------------------- */
const THINK_PREAMBLE_RE =
  /^\s*(<think>|here'?s a thinking process|thinking process|deconstruct(?:ing)? the prompt|analy(?:s|z)e (?:user|the) (?:input|requirements?|prompt))/i;

function classifyCleanliness(row) {
  const ex = (row.excerpt || "").trim();
  // Empty <think></think> followed by JSON-only is the AEON long_context pattern
  if (/^<think>\s*<\/think>/.test(ex) && row.word_count != null && row.word_count < 30) return "empty";
  if (row.used_reasoning_fallback === false && row.word_count != null && row.word_count < 20) {
    // model produced almost nothing in content — treat as empty
    return "empty";
  }
  if (THINK_PREAMBLE_RE.test(ex)) return "leak";
  if (/^\s*<think>/i.test(ex)) return "leak";
  return "clean";
}

/* ---------- Aggregation ---------- */
function buildDataset(rows) {
  // Group by profile
  const byProfile = new Map();
  const byPrompt = new Map();

  for (const r of rows) {
    if (!byProfile.has(r.profile)) byProfile.set(r.profile, []);
    byProfile.get(r.profile).push(r);
    if (!byPrompt.has(r.prompt_id)) byPrompt.set(r.prompt_id, { id: r.prompt_id, category: r.category, runs: [] });
    byPrompt.get(r.prompt_id).runs.push(r);
  }

  // Compute prompt order (first appearance) and category order from data
  const promptOrder = [];
  for (const r of rows) if (!promptOrder.includes(r.prompt_id)) promptOrder.push(r.prompt_id);

  // Per-profile averages
  const profiles = [];
  for (const [profile, runs] of byProfile.entries()) {
    const tps = avg(runs.map(r => r.tokens_per_sec));
    const latency = avg(runs.map(r => r.time_total_sec));
    const quality = avg(runs.map(r => r.quality_ratio)) * 100;
    const cleanliness = promptOrder.map(pid => {
      const run = runs.find(r => r.prompt_id === pid);
      return run ? classifyCleanliness(run) : null;
    }).filter(Boolean);
    profiles.push({
      profile,
      alias: runs[0].alias || profile,
      runs,
      tps, latency, quality, cleanliness,
      cleanCount: cleanliness.filter(c => c === "clean").length,
      leakCount:  cleanliness.filter(c => c === "leak").length,
      emptyCount: cleanliness.filter(c => c === "empty").length,
      runCount: runs.length,
      ok: runs.every(r => r.http_code === "200" || r.http_code === 200),
    });
  }

  // Roles: balanced (best quality*speed product among non-degraded), fastest, top-quality
  const sortedByTps = [...profiles].sort((a, b) => b.tps - a.tps);
  const fastest = sortedByTps[0];
  const sortedByQuality = [...profiles].sort((a, b) => b.quality - a.quality || b.tps - a.tps);
  const topQuality = sortedByQuality[0];

  // Balanced: highest tps among profiles within 1.5pp of top quality
  const qualityFloor = topQuality.quality - 1.5;
  const balancedCandidates = profiles.filter(p => p.quality >= qualityFloor);
  const balanced = balancedCandidates.sort((a, b) => b.tps - a.tps)[0] || topQuality;

  for (const p of profiles) {
    p.role = (p === balanced) ? "balanced"
           : (p === fastest && p !== balanced) ? "fastest"
           : (p === topQuality && p !== balanced && p !== fastest) ? "top-quality"
           : "baseline";
  }

  // Prompts in observed order
  const prompts = promptOrder.map(pid => byPrompt.get(pid));

  // Run-level metadata
  const totalRuns = rows.length;
  const okRuns = rows.filter(r => String(r.http_code) === "200").length;
  const runDir = (() => {
    const f = rows[0]?.response_file || "";
    const m = f.match(/benchmark-results\/([^\/]+)/);
    return m ? m[1] : "(unknown run)";
  })();

  return { profiles, prompts, balanced, fastest, topQuality, totalRuns, okRuns, runDir, raw: rows };
}

function avg(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

/* ---------- Auto-generated copy (overridable) ----------
   Every authored text element has a stable `id`. The runtime
   merges any `window.REPORT_OVERRIDES[id]` over the auto value,
   so a local model can selectively rewrite text without
   touching the data layer.
------------------------------------------------------------ */
function generateNarrative(d, meta = {}) {
  const b = d.balanced, f = d.fastest, tq = d.topQuality;
  const speedup = (b.tps / median(d.profiles.map(p => p.tps))).toFixed(1);
  const fastSpeedup = (f.tps / b.tps).toFixed(1);
  const qualityDelta = (b.quality - f.quality).toFixed(0);

  const o = window.REPORT_OVERRIDES || {};
  const pick = (id, fallback) => o[id] != null ? o[id] : fallback;

  return {
    "hero.title": pick("hero.title", meta.title || "Local LLM Benchmark"),
    "hero.subtitle": pick("hero.subtitle",
      `// ${d.profiles.length} local profiles · ${d.totalRuns} runs through llama-server's OpenAI-compatible /chat/completions endpoint`),
    "hero.body": pick("hero.body",
      `The fastest profile in this run is ${f.profile} at ${f.tps.toFixed(1)} tok/s — roughly ${fastSpeedup}× the throughput of ${b.profile}, but its rubric quality drops by ${Math.abs(qualityDelta)} points.\n\nFor a daily driver, ${b.profile} wins on balance: it ${b === tq ? "ties for" : "lands within striking distance of"} top quality (${b.quality.toFixed(1)}%) while running ~${speedup}× faster than the median profile.`),
    "rec.balanced.tradeoff": pick("rec.balanced.tradeoff",
      `Cleanest balance of speed and rubric quality in this run. ${b.cleanCount}/${b.runCount} prompts produced clean output. The default to ship.`),
    "rec.fastest.tradeoff": pick("rec.fastest.tradeoff",
      `Fastest by ${fastSpeedup}× but rubric quality is ${qualityDelta > 0 ? "down " + qualityDelta + " points" : "comparable"}. Audit the per-prompt scores before putting this on the critical path.`),
    "rec.quality.tradeoff": pick("rec.quality.tradeoff",
      `Highest quality average (${tq.quality.toFixed(1)}%). Use when correctness matters more than throughput.`),
    "rec.creative.tradeoff": pick("rec.creative.tradeoff",
      `Distinct writing voice with the cleanest output of any profile in this run.`),
    "summary.cleanliness.note": pick("summary.cleanliness.note",
      `// per-prompt reasoning leakage — left-to-right: ${d.prompts.map(p => p.id.split("_")[0]).join(" · ")}`),
    "methodology.timings": pick("methodology.timings",
      `All ${d.profiles.length} profiles were tested through llama-server's /chat/completions endpoint with stream:false. Reported latency is end-to-end response time.`),
    "methodology.ttft": pick("methodology.ttft",
      `The raw report column ttft_sec is curl's time_starttransfer, but because requests were non-streaming this is effectively full-response time. This page omits the misleading column.`),
    "methodology.rubric": pick("methodology.rubric",
      `Quality is a lightweight automated keyword/requirement rubric scored per prompt with a max score that varies by prompt. Quality % is the average ratio across the prompts.`),
    "methodology.cleanliness": pick("methodology.cleanliness",
      `Several profiles emit visible <think> blocks or "Here's a thinking process:" preambles in their content field. Some emit empty content and place the answer in reasoning_content.`),
  };
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/* ---------- Auto recommendation cards ---------- */
function generateRecommendations(d, copy) {
  const recs = [];
  recs.push({
    id: "rec.balanced",
    tag: "Balanced default",
    profile: d.balanced.profile,
    metric_speed: d.balanced.tps.toFixed(1) + " tok/s",
    metric_quality: d.balanced.quality.toFixed(1) + "%",
    tradeoff: copy["rec.balanced.tradeoff"],
    flags: [
      [d.balanced.cleanCount > 0 ? "clean" : "leak", `${d.balanced.cleanCount}/${d.balanced.runCount} clean`],
      d.balanced.leakCount ? ["leak", `${d.balanced.leakCount} leaks`] : null,
    ].filter(Boolean),
    highlight: true,
  });
  if (d.fastest !== d.balanced) {
    recs.push({
      id: "rec.fastest",
      tag: "Fastest",
      profile: d.fastest.profile,
      metric_speed: d.fastest.tps.toFixed(1) + " tok/s",
      metric_quality: d.fastest.quality.toFixed(1) + "%",
      tradeoff: copy["rec.fastest.tradeoff"],
      flags: [
        d.fastest.emptyCount ? ["danger", `${d.fastest.emptyCount} empty`] : null,
        d.fastest.leakCount  ? ["leak", `${d.fastest.leakCount} leaks`] : null,
      ].filter(Boolean),
      cyan: true,
    });
  }
  if (d.topQuality !== d.balanced && d.topQuality !== d.fastest) {
    recs.push({
      id: "rec.quality",
      tag: "Top quality",
      profile: d.topQuality.profile,
      metric_speed: d.topQuality.tps.toFixed(1) + " tok/s",
      metric_quality: d.topQuality.quality.toFixed(1) + "%",
      tradeoff: copy["rec.quality.tradeoff"],
      flags: [],
    });
  }
  // Add a "cleanest output" pick if distinct
  const cleanest = [...d.profiles].sort((a, b) => b.cleanCount - a.cleanCount || b.quality - a.quality)[0];
  if (cleanest && cleanest !== d.balanced && cleanest !== d.fastest && cleanest !== d.topQuality && cleanest.cleanCount > 0) {
    recs.push({
      id: "rec.creative",
      tag: "Cleanest output",
      profile: cleanest.profile,
      metric_speed: cleanest.tps.toFixed(1) + " tok/s",
      metric_quality: cleanest.quality.toFixed(1) + "%",
      tradeoff: copy["rec.creative.tradeoff"],
      flags: [["clean", `${cleanest.cleanCount}/${cleanest.runCount} clean`]],
    });
  }
  return recs;
}

/* ---------- Public ---------- */
window.BenchData = { parseJsonl, buildDataset, generateNarrative, generateRecommendations, classifyCleanliness };

/* ============================================================
   .conf parser — reads llama-server overlay files
   Format is shell `KEY=value` (with optional quotes) plus comments.
   ============================================================ */
function parseConf(text, filename) {
  const fields = {};
  const order = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    let val = m[2];
    // Strip matching quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fields[m[1]] = val;
    if (!order.includes(m[1])) order.push(m[1]);
  }

  // Derive convenience fields
  const modelPath = fields.MODEL || "";
  const modelFile = modelPath.split("/").pop() || modelPath;
  const quant = extractQuant(modelFile || fields.HF_FILE || "");
  const profileId = (filename || "").replace(/\.conf$/, "");

  return {
    profile_id: profileId,
    fields,
    order,
    derived: {
      model_file: modelFile,
      quant,
    },
  };
}

function extractQuant(name) {
  if (!name) return null;
  // Common llama.cpp quant patterns: Q5_K_XL, Q4_K_M, Q6_K, IQ4_XS, etc.
  const m = name.match(/(UD-)?(IQ?\d+_[A-Z]+(?:_[A-Z]+)?|Q\d+_[A-Z]+(?:_[A-Z]+)?|F16|F32|BF16)/i);
  return m ? m[2].toUpperCase() : null;
}

/* ---------- Profile aggregation across reports ---------- */
function buildProfileBundle(confs /* [{profile_id, fields, order, derived}] */) {
  // Group by HF_REPO so the diff view can find related profiles.
  const groups = new Map();
  for (const c of confs) {
    const repo = c.fields.HF_REPO || `__solo__:${c.profile_id}`;
    if (!groups.has(repo)) groups.set(repo, []);
    groups.get(repo).push(c);
  }
  const families = [...groups.entries()].map(([repo, members]) => ({
    repo,
    members,
    isFamily: !repo.startsWith("__solo__:") && members.length > 1,
  }));
  return { confs, byId: new Map(confs.map(c => [c.profile_id, c])), families };
}

/* Diff two confs and return a list of {key, a, b, differs} */
function diffConfs(a, b) {
  const keys = new Set([...Object.keys(a.fields), ...Object.keys(b.fields)]);
  const rows = [];
  for (const k of keys) {
    const av = a.fields[k];
    const bv = b.fields[k];
    rows.push({ key: k, a: av, b: bv, differs: av !== bv });
  }
  // Stable order: differing keys first, then alphabetical
  rows.sort((x, y) => (y.differs - x.differs) || x.key.localeCompare(y.key));
  return rows;
}

/* ============================================================
   Hub-level loaders — fetch a registry, then individual reports
   ============================================================ */
async function loadRegistry(base = "reports/") {
  try {
    const r = await fetch(`${base}reports.json`);
    if (!r.ok) return { reports: [] };
    return await r.json();
  } catch { return { reports: [] }; }
}

async function loadReportSummary(id, base = "reports/") {
  // Load meta + results; profiles loaded lazily when needed
  const metaR = await fetch(`${base}${id}/meta.json`);
  const meta = metaR.ok ? await metaR.json() : { id, title: id };
  const jsonlR = await fetch(`${base}${id}/results.jsonl`);
  const jsonl = jsonlR.ok ? await jsonlR.text() : "";
  const rows = jsonl ? parseJsonl(jsonl) : [];
  const dataset = rows.length ? buildDataset(rows) : null;
  return { id, meta, jsonl, dataset, source: "bundled", base };
}

async function loadProfilesForReport(report) {
  if (!report.dataset) return { confs: [], bundle: buildProfileBundle([]) };
  const ids = report.dataset.profiles.map(p => p.profile);
  const confs = [];
  for (const id of ids) {
    try {
      const r = await fetch(`${report.base}${report.id}/profiles/${id}.conf`);
      if (r.ok) {
        const text = await r.text();
        confs.push(parseConf(text, `${id}.conf`));
      }
    } catch {}
  }
  return { confs, bundle: buildProfileBundle(confs) };
}

/* ============================================================
   localStorage "My runs" support
   ============================================================ */
const LS_KEY = "meese-bench:my-runs";

function listMyRuns() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); }
  catch { return []; }
}

function saveMyRun(run) {
  const all = listMyRuns().filter(r => r.id !== run.id);
  all.unshift(run);
  localStorage.setItem(LS_KEY, JSON.stringify(all));
}

function deleteMyRun(id) {
  const all = listMyRuns().filter(r => r.id !== id);
  localStorage.setItem(LS_KEY, JSON.stringify(all));
}

function loadMyRunDataset(id) {
  const run = listMyRuns().find(r => r.id === id);
  if (!run) return null;
  const rows = parseJsonl(run.jsonl);
  if (!rows.length) return null;
  const dataset = buildDataset(rows);
  const confs = (run.confs || []).map(c => parseConf(c.text, c.filename));
  return {
    id: run.id,
    meta: run.meta || { id: run.id, title: run.title || run.id },
    dataset,
    source: "local",
    confs,
    bundle: buildProfileBundle(confs),
  };
}

/* Cross-run leaderboard: best tok/s seen per model alias across all runs */
function buildLeaderboard(reports /* [{dataset, meta}] */) {
  const best = new Map(); // alias -> { alias, tps, profile, runId, runTitle }
  for (const r of reports) {
    if (!r.dataset) continue;
    for (const p of r.dataset.profiles) {
      const key = p.alias || p.profile;
      const entry = { alias: key, profile: p.profile, tps: p.tps, quality: p.quality, runId: r.id, runTitle: r.meta?.title || r.id };
      const cur = best.get(key);
      if (!cur || entry.tps > cur.tps) best.set(key, entry);
    }
  }
  return [...best.values()].sort((a, b) => b.tps - a.tps);
}

/* Public hub API */
Object.assign(window.BenchData, {
  parseConf, extractQuant, buildProfileBundle, diffConfs,
  loadRegistry, loadReportSummary, loadProfilesForReport,
  listMyRuns, saveMyRun, deleteMyRun, loadMyRunDataset,
  buildLeaderboard,
});
