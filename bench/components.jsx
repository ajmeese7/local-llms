/* ============================================================
   components.jsx — shared UI primitives + chart components.
   All components are exported to window so other Babel scripts
   can use them.
   ============================================================ */

const { useState, useMemo, useEffect, useRef } = React;

/* ---------- Editable text ----------
   Wraps any authored copy with a stable id so a local model can
   target it via DOM (`#txt-hero.title`) or via window.REPORT_OVERRIDES.
------------------------------------------------------------ */
function Txt({ id, as: As = "span", className, children }) {
  return <As id={`txt-${id}`} data-copy-id={id} className={className}>{children}</As>;
}

/* ---------- Eyebrow / label / section header ---------- */
function Eyebrow({ className = "", children }) {
  return <span className={`font-mono text-[10px] tracking-[0.18em] uppercase text-me-fg-3 ${className}`}>{children}</span>;
}
function Label({ className = "", children }) {
  return <span className={`font-mono text-[9px] tracking-[0.18em] uppercase text-me-fg-3 ${className}`}>{children}</span>;
}
function SectionHead({ num, title, sub }) {
  return (
    <div className="me-section-head">
      <h2><span className="num">{num}</span>{title}</h2>
      <span className="sub">{sub}</span>
    </div>
  );
}

/* ---------- Chips / flags ---------- */
function Chip({ on, cyan, children, ...rest }) {
  return (
    <button
      className={`me-chip ${on ? "on" : ""} ${cyan && on ? "cyan" : ""}`}
      {...rest}>
      {children}
    </button>
  );
}
function Flag({ kind = "", children }) {
  return <span className={`me-flag ${kind}`}>{children}</span>;
}
function MiniFlag({ kind = "", children }) {
  return <span className={`me-miniflag ${kind}`}>{children}</span>;
}

function isFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return false;
  const n = Number(value);
  return Number.isFinite(n);
}

function metricNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fmtMetric(value, digits = 1, suffix = "") {
  return isFiniteNumber(value) ? `${Number(value).toFixed(digits)}${suffix}` : "—";
}

/* ---------- Bar chart ---------- */
const BAR_CFG = {
  tps:     { title: "Average Output tok/s", key: "tps",     fmt: v => fmtMetric(v, 1),       better: "high", cls: "" },
  latency: { title: "Average Latency (s)",  key: "latency", fmt: v => fmtMetric(v, 2, " s"), better: "low",  cls: "metric-latency" },
  quality: { title: "Quality Heuristic %",  key: "quality", fmt: v => fmtMetric(v, 1, "%"),  better: "high", cls: "metric-quality" },
};
function BarChart({ profiles }) {
  const [metric, setMetric] = useState("tps");
  const cfg = BAR_CFG[metric];

  // Stable row order: alphabetical by profile so React keys map 1:1 across metric switches.
  // Visual order is controlled by the `order` style based on the current metric's ranking.
  const stable = useMemo(() => [...profiles].sort((a, b) => a.profile.localeCompare(b.profile)), [profiles]);

  const ranking = useMemo(() => {
    const sorted = [...stable].sort((a, b) =>
      cfg.better === "high"
        ? metricNumber(b[cfg.key], -Infinity) - metricNumber(a[cfg.key], -Infinity)
        : metricNumber(a[cfg.key], Infinity) - metricNumber(b[cfg.key], Infinity)
    );
    const m = new Map();
    sorted.forEach((p, i) => m.set(p.profile, i));
    return m;
  }, [stable, metric]);

  const finiteValues = stable.map(p => Number(p[cfg.key])).filter(Number.isFinite);
  const max = Math.max(...finiteValues, 0);

  // Two-phase render: on metric change, mount the new class with width:0 first,
  // then on the next animation frame, set the real width. This guarantees a
  // fresh transition on every row, every time.
  const [phase, setPhase] = useState({ metric, ready: true });
  useEffect(() => {
    if (phase.metric === metric) return;
    setPhase({ metric, ready: false });
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPhase({ metric, ready: true }));
    });
    return () => cancelAnimationFrame(id);
  }, [metric, phase.metric]);

  return (
    <div className="me-card p-4 md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3.5">
        <h3 className="font-display text-[12px] md:text-[13px] tracking-[0.18em] uppercase m-0">{cfg.title}</h3>
        <div className="flex">
          {Object.keys(BAR_CFG).map((k, i) => (
            <button
              key={k}
              onClick={() => setMetric(k)}
              className={`font-mono text-[10px] tracking-wider uppercase px-2.5 py-1 cursor-pointer transition-colors border ${
                metric === k
                  ? "bg-me-cyan text-me-bg border-me-cyan"
                  : "bg-transparent text-me-fg-2 border-me-border hover:text-me-fg"
              } ${i > 0 ? "border-l-0" : ""}`}>
              {k === "tps" ? "tok/s" : k}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        {stable.map((p, i) => {
          const rank = ranking.get(p.profile);
          const pct = phase.ready && max > 0 ? (metricNumber(p[cfg.key]) / max) * 100 : 0;
          const isHl = p.role === "balanced";
          // Stagger by VISUAL rank so the cascade reads top→bottom in the new order.
          const delay = phase.ready ? rank * 40 : 0;
          return (
            <div key={p.profile}
                 className={`bar-row ${cfg.cls} ${isHl ? "highlight" : ""}`}
                 style={{ order: rank }}>
              <div className="lbl" title={p.profile}>{p.profile}</div>
              <div className="track">
                <div className="fill" style={{width: `${pct}%`, transitionDelay: `${delay}ms`}}></div>
              </div>
              <div className="num">{cfg.fmt(p[cfg.key])}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Scatter plot ---------- */
function Scatter({ profiles }) {
  const W = 600, H = 320;
  const padL = 44, padR = 90, padT = 14, padB = 38;

  const plottable = profiles.filter(p => isFiniteNumber(p.tps) && isFiniteNumber(p.quality));
  const xVals = plottable.map(p => Number(p.tps));
  const yVals = plottable.map(p => Number(p.quality));
  const xMax = Math.ceil(Math.max(...xVals, 0) / 25) * 25 + 25;
  const xMin = 0;
  const yMaxRaw = Math.max(...yVals, 100);
  const yMinRaw = Math.min(...yVals, 0);
  const yMax = Math.min(100, Math.ceil(yMaxRaw / 5) * 5 + 5);
  const yMin = Math.max(0, Math.floor(yMinRaw / 5) * 5 - 5);

  const xScale = v => padL + ((v - xMin) / (xMax - xMin)) * (W - padL - padR);
  const yScale = v => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);

  const xTicks = []; for (let v = xMin; v <= xMax; v += 25) xTicks.push(v);
  const yTicks = []; for (let v = yMin; v <= yMax; v += 5) yTicks.push(v);

  const offsetMap = {};
  profiles.forEach((p, i) => { offsetMap[p.profile] = [12, i % 2 === 0 ? -10 : 14]; });

  return (
    <div className="me-card p-4 md:p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3.5">
        <h3 className="font-display text-[12px] md:text-[13px] tracking-[0.18em] uppercase m-0">Quality vs Throughput</h3>
        <div className="font-mono text-[11px] text-me-fg-3">y: rubric % · x: tok/s</div>
      </div>
      <div className="scatter-wrap">
        <svg className="scatter-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <g className="scatter-grid">
            {xTicks.map(v => <line key={`gx${v}`} x1={xScale(v)} x2={xScale(v)} y1={padT} y2={H - padB} />)}
            {yTicks.map(v => <line key={`gy${v}`} x1={padL} x2={W - padR} y1={yScale(v)} y2={yScale(v)} />)}
          </g>
          <g className="scatter-axis">
            <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} />
            <line x1={padL} x2={padL} y1={padT} y2={H - padB} />
            {xTicks.map(v => <text key={`tx${v}`} x={xScale(v)} y={H - padB + 14} textAnchor="middle">{v}</text>)}
            {yTicks.map(v => <text key={`ty${v}`} x={padL - 8} y={yScale(v) + 3} textAnchor="end">{v}%</text>)}
          </g>
          <text className="scatter-axis-title" x={(W - padR + padL) / 2} y={H - 6} textAnchor="middle">tok/s →</text>
          <text className="scatter-axis-title" x={-((H + padT) / 2)} y="14" transform="rotate(-90)" textAnchor="middle">quality %</text>
          {plottable.map(p => {
            const cx = xScale(p.tps), cy = yScale(p.quality);
            const cls = p.role === "balanced" ? "balanced" : p.role === "fastest" ? "fastest" : "other";
            const r = p.role === "balanced" ? 9 : p.role === "fastest" ? 8 : 6;
            const [dx, dy] = offsetMap[p.profile];
            return (
              <g key={p.profile}>
                <circle className={`scatter-pt ${cls}`} cx={cx} cy={cy} r={r}>
                  <title>{`${p.profile} · ${fmtMetric(p.tps, 1)} tok/s · ${fmtMetric(p.quality, 1, "%")}`}</title>
                </circle>
                <text className={`scatter-label ${cls === "other" ? "" : cls}`} x={cx + dx} y={cy + dy}>{p.profile}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ---------- Cleanliness grid ---------- */
function CleanlinessGrid({ profiles, prompts }) {
  const labels = prompts.map(p => p.id.split("_").slice(-1)[0].slice(0, 6));
  return (
    <div id="clean-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
      {profiles.map(p => (
        <div key={p.profile} className="me-card p-3.5">
          <h4 className="font-mono text-[12px] md:text-[13px] m-0 mb-3 text-me-fg break-all">{p.profile}</h4>
          <div className="flex gap-0.5 mb-2.5">
            {p.cleanliness.map((c, i) => (
              <div key={i} className={`clean-seg ${c}`}
                   data-tip={`${labels[i]}: ${c === "clean" ? "clean answer" : c === "leak" ? "thinking preamble" : "empty content"}`}>
                {labels[i]}
              </div>
            ))}
          </div>
          <div className="font-mono text-[11px] text-me-fg-3">
            clean {p.cleanCount}/{p.runCount} · leak {p.leakCount}/{p.runCount}
            {p.emptyCount > 0 && <> · empty {p.emptyCount}/{p.runCount}</>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Cleanliness stacked bar ----------
   Per-cell summary, replaces the per-prompt grid for adapters with
   many items (mmlu/gsm8k routinely have 100+ rows). One bar shows
   the clean/leak/empty distribution; counts go below.
------------------------------------------------------------ */
function CleanlinessBar({ clean = 0, leak = 0, empty = 0 }) {
  const total = (clean | 0) + (leak | 0) + (empty | 0);
  if (total === 0) return (
    <div className="font-mono text-[10px] text-me-fg-3">no rows</div>
  );
  const cw = (clean / total) * 100;
  const lw = (leak / total) * 100;
  const ew = (empty / total) * 100;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-white/5 border border-me-border relative overflow-hidden">
        {clean > 0 && <div className="absolute inset-y-0 bg-me-success/70" style={{ left: 0, width: `${cw}%` }} title={`${clean} clean`}></div>}
        {leak > 0  && <div className="absolute inset-y-0 bg-me-warning/70" style={{ left: `${cw}%`, width: `${lw}%` }} title={`${leak} leak`}></div>}
        {empty > 0 && <div className="absolute inset-y-0 bg-me-danger/70" style={{ left: `${cw + lw}%`, width: `${ew}%` }} title={`${empty} empty`}></div>}
      </div>
      <div className="font-mono text-[10px] text-me-fg-3 whitespace-nowrap">
        {Math.round((clean / total) * 100)}% clean
      </div>
    </div>
  );
}

/* ---------- Quality bar ---------- */
function QBar({ q, qmax }) {
  const r = qmax ? q / qmax : 0;
  const cls = r < 0.6 ? "low" : r >= 1 ? "full" : "";
  return (
    <span className={`qbar ${cls}`}>
      <span className="qnum">{q}/{qmax}</span>
      <span className="qtrack"><span className="qfill" style={{width: `${r * 100}%`}}></span></span>
    </span>
  );
}

/* ---------- Excerpt highlighting ---------- */
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Split raw output into alternating "think" / "prose" segments. Think
// segments cover explicit <think>…</think> blocks plus heuristic reasoning
// preambles ("Here's a thinking process", etc.). The non-think segments
// then get a second pass to extract fenced code blocks.
function splitThinkSegments(text) {
  const segs = [];
  const reasonHead = /^\s*(here'?s a thinking process|thinking process|deconstruct(?:ing)? the prompt|analy(?:s|z)e (?:user|the)|drafting - attempt|identify )/i;
  const lines = text.split("\n");
  let mode = "prose";
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    segs.push({ kind: mode, text: buf.join("\n") });
    buf = [];
  };
  for (const line of lines) {
    if (/^\s*<think>/i.test(line)) {
      flush();
      mode = "think";
      buf.push(line);
      continue;
    }
    if (/^\s*<\/think>/i.test(line)) {
      buf.push(line);
      flush();
      mode = "prose";
      continue;
    }
    if (mode === "prose" && reasonHead.test(line)) {
      // Single-line reasoning leak; emit as its own think segment so we
      // don't poison the code highlighter with prose.
      flush();
      segs.push({ kind: "think", text: line });
      continue;
    }
    buf.push(line);
  }
  flush();
  return segs;
}

// Within a prose blob, peel out fenced code blocks (```lang … ```), keeping
// the surrounding prose intact. Models routinely write a preamble before
// the answer; the user wants that preserved in the source-code view.
// Returns segments shaped like:
//   {kind: "prose", text}
//   {kind: "code",  text, language}
function splitFencedCode(text) {
  const segs = [];
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const open = rest.match(/```([a-zA-Z0-9_+\-]*)\s*\n/);
    if (!open) {
      if (i < text.length) segs.push({ kind: "prose", text: text.slice(i) });
      break;
    }
    const fenceStart = i + open.index;
    if (fenceStart > i) segs.push({ kind: "prose", text: text.slice(i, fenceStart) });
    const codeStart = fenceStart + open[0].length;
    const tail = text.slice(codeStart);
    const close = tail.match(/\n\s*```\s*(?:\n|$)/);
    if (close) {
      segs.push({ kind: "code", text: tail.slice(0, close.index), language: open[1] || null });
      i = codeStart + close.index + close[0].length;
    } else {
      segs.push({ kind: "code", text: tail, language: open[1] || null });
      break;
    }
  }
  return segs;
}

// Map a markdown fence language hint to a Prism component we have loaded.
function languageAlias(lang) {
  if (!lang) return null;
  const l = String(lang).toLowerCase();
  if (l === "html" || l === "xml" || l === "svg") return "markup";
  if (l === "js" || l === "jsx" || l === "ts" || l === "tsx" || l === "javascript") return "javascript";
  if (l === "py" || l === "python") return "python";
  if (l === "sh" || l === "shell" || l === "bash" || l === "zsh") return "bash";
  if (l === "css") return "css";
  if (l === "json") return "json";
  if (l === "markup") return "markup";
  return null;
}

// Run Prism over `text` if a known language is given and Prism is loaded.
// Returns escaped HTML either way.
function highlightCode(text, language) {
  const safe = escapeHtml(text);
  if (!language || typeof window.Prism === "undefined") return safe;
  const grammar = window.Prism.languages[language];
  if (!grammar) return safe;
  try {
    return window.Prism.highlight(text, grammar, language);
  } catch {
    return safe;
  }
}

// Public: turn raw output into highlighted HTML for the excerpt panel.
//
// The full raw text is preserved (prose preambles, narrative around code,
// closing remarks). Fenced code blocks get Prism-highlighted with the
// language declared by the fence. Free-floating non-fenced content gets
// `fallbackLanguage` if provided (for adapters where the entire response
// is expected to be code, e.g. raw JSON for tool-use); otherwise it
// renders as plain escaped text.
function highlightExcerpt(text, fallbackLanguage) {
  const out = [];
  for (const t of splitThinkSegments(text)) {
    if (t.kind === "think") {
      out.push(`<span class="think">${escapeHtml(t.text)}</span>`);
      continue;
    }
    const blocks = splitFencedCode(t.text);
    const hasCode = blocks.some(b => b.kind === "code");
    for (const b of blocks) {
      if (b.kind === "code") {
        out.push(highlightCode(b.text, languageAlias(b.language) || fallbackLanguage));
      } else if (!hasCode && fallbackLanguage) {
        // No fences in this segment but caller declared a language for
        // the whole response (e.g. JSON tool-use). Highlight the prose
        // as that language.
        out.push(highlightCode(b.text, fallbackLanguage));
      } else {
        out.push(escapeHtml(b.text));
      }
    }
  }
  return out.join("\n");
}

// Pick a Prism language for a given item id + raw output. Errs on the side
// of plain text — wrong highlighting is worse than no highlighting.
function detectExcerptLanguage(itemId, raw) {
  const id = String(itemId || "");
  const head = String(raw || "").trimStart().slice(0, 200).toLowerCase();
  if (id.startsWith("design_") || id.startsWith("canvas_")) return "markup";
  if (id === "agentic_code_debug" || id === "agentic_self_critique") return "python";
  if (id === "agentic_multi_step_planning") return "bash";
  if (id === "agentic_tool_use_json" || id.startsWith("agentic_structured_extraction")) return "json";
  if (id === "coding_bugfix") return "python";
  if (id === "coding_shell") return "bash";
  // Fall back to content sniffing for adapters we don't know about.
  if (head.startsWith("<!doctype") || head.startsWith("<html")) return "markup";
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  if (head.startsWith("#!/")) return "bash";
  return null;
}

// Pull the first fenced code block out of a model response, ignoring any
// prose before/after the fence. Models often wrap their answer with a
// preamble like "Here's the complete solution:" before opening a ```html
// block — without this the syntax highlighter and HTML preview both miss.
//
// If no fence is found, returns the input unchanged.
// If a fence is opened but never closed (truncated output), returns
// everything from after the opening fence to the end of the string.
function stripCodeFences(raw) {
  const text = String(raw || "");
  // Look for the first ```<lang>\n anywhere in the document.
  const open = text.match(/```([a-zA-Z0-9_+\-]*)\s*\n/);
  if (!open) return text;
  const startIdx = open.index + open[0].length;
  // Find the matching closing fence (``` on its own line, or end-of-string).
  const tail = text.slice(startIdx);
  const close = tail.match(/\n\s*```\s*(?:\n|$)/);
  if (close) return tail.slice(0, close.index);
  return tail;  // unclosed fence — return whatever was generated
}

// Detect whether the raw output is renderable as a standalone HTML page.
function looksLikeHtmlDoc(raw) {
  const head = stripCodeFences(raw).trimStart().slice(0, 200).toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html");
}

/* ---------- Diagnostic helpers ---------- */

// Classify a failed/unscored row into one of: "ok", "low", "empty", "err".
// Used to drive the diagnostic banner on the expanded row.
function classifyRow(row) {
  if (row.error) return "err";
  if (Number(row.http_status) >= 400) return "err";
  const cleanliness = classifyExcerpt(row);
  if (cleanliness === "empty") return "empty";
  const partial = Number(row.score?.partial);
  const correct = !!row.score?.correct;
  if (Number.isFinite(partial) && partial < 1 && !correct) return "low";
  return "ok";
}

// Local copy of classifyCleanliness (defined in data.jsx) so this module
// can run in any load order. Kept in sync with data.jsx — if you change one,
// change the other.
function classifyExcerpt(row) {
  const raw = (row.raw || "").trim();
  if (!raw) return "empty";
  if (/^<think>\s*<\/think>/i.test(raw) && raw.length < 80) return "empty";
  return "clean";
}

// Build a one-sentence diagnosis for a row. Returns null when no diagnosis
// is needed (i.e. the row scored cleanly).
function diagnoseRow(row) {
  const kind = classifyRow(row);
  if (kind === "ok") return null;
  const status = Number(row.http_status);
  const errStr = String(row.error || "");
  const lat = Number(row.latency_ms);
  if (kind === "err") {
    if (status === 0 || /connection|refused|reset|enotfound/i.test(errStr)) {
      return {
        kind,
        headline: "Connection failed",
        detail: "The eval client never reached the inference server. Common causes: server not running, wrong port in the endpoint config, or systemd unit failed to start. Verify with `systemctl status llama-server-<endpoint>` and check the URL in the run's manifest.json.",
      };
    }
    if (status === 504 || /timeout|timed.?out/i.test(errStr)) {
      return {
        kind,
        headline: "Request timed out",
        detail: `httpx ceiling is 600s. Either the server stalled, or generation legitimately needed more wall time than that — try lowering max_tokens, raising the client timeout, or checking server-side logs for OOM/queue-depth issues. Latency observed: ${Number.isFinite(lat) ? `${(lat/1000).toFixed(1)}s` : "unknown"}.`,
      };
    }
    if (status >= 500) {
      return {
        kind,
        headline: `Server error (HTTP ${status})`,
        detail: "The server accepted the request and crashed/refused mid-flight. Check `journalctl -u llama-server-<endpoint>` or the inference process's stderr for the matching window.",
      };
    }
    if (status >= 400) {
      return {
        kind,
        headline: `Client error (HTTP ${status})`,
        detail: "The server rejected the request shape. Usually means the OpenAI-compat payload disagrees with the server build (e.g. `chat_template_kwargs` ignored, model name mismatch, max_tokens too large for the loaded context).",
      };
    }
    return { kind, headline: "Inference failed", detail: errStr || "Server returned no usable response." };
  }
  if (kind === "empty") {
    const tokens = Number(row.output_tokens);
    const cap = Number(row.max_tokens);
    if (Number.isFinite(tokens) && tokens > 0) {
      const hitCap = Number.isFinite(cap) && tokens >= cap - 4;
      const detail = hitCap
        ? `The model emitted ${tokens.toLocaleString()} output tokens — that's the configured max_tokens cap of ${cap.toLocaleString()} — and never exited the <think> block. Bump max_tokens for this item, or run with thinking disabled (/no_think prefix).`
        : `The model emitted ${tokens.toLocaleString()} output tokens but no usable answer — typically an unclosed <think> block where reasoning starved before the final answer. Increase max_tokens${Number.isFinite(cap) ? ` (currently ${cap.toLocaleString()})` : ""} for this item, disable thinking with /no_think, or both.`;
      return { kind, headline: "Model produced only reasoning", detail };
    }
    return {
      kind,
      headline: "Model returned empty content",
      detail: "Both `content` and `reasoning_content` were empty in the server's response. Often a chat-template issue: the model's prompt template may not match what the server is sending. Compare the server log's `formatted prompt:` line to what the model card expects.",
    };
  }
  if (kind === "low") {
    const misses = (row.score?.breakdown?.misses || []).length;
    const hits = (row.score?.breakdown?.hits || []).length;
    return {
      kind,
      headline: `Rubric matched ${hits} / ${hits + misses} checks`,
      detail: "Substring-rubric scoring missed at least one expected pattern. See the missed-checks panel below — these are loose presence checks, not quality judgments. For design/canvas items the model may have produced a perfectly fine page that just happens to use different keywords than the rubric.",
    };
  }
  return null;
}

/* ---------- Manual rating widget ---------- */
function StarRating({ value, onChange }) {
  const v = Number.isFinite(Number(value)) ? Number(value) : 0;
  return (
    <span className="star-rating" role="radiogroup" aria-label="Manual rating">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          role="radio"
          aria-checked={v === n}
          className={`star ${n <= v ? "filled" : ""}`}
          title={n === v ? "Click to clear" : `Rate ${n}/5`}
          onClick={(e) => {
            e.stopPropagation();
            onChange(n === v ? null : n);
          }}>
          ★
        </button>
      ))}
      {v > 0 && (
        <span className="star-num">{v}/5</span>
      )}
    </span>
  );
}

Object.assign(window, {
  Txt, Eyebrow, Label, SectionHead, Chip, Flag, MiniFlag,
  BarChart, Scatter, CleanlinessGrid, CleanlinessBar, QBar,
  StarRating,
  escapeHtml, highlightExcerpt, detectExcerptLanguage, looksLikeHtmlDoc,
  stripCodeFences, classifyRow, diagnoseRow,
});
