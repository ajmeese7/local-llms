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

/* ---------- Bar chart ---------- */
const BAR_CFG = {
  tps:     { title: "Average Output tok/s", key: "tps",     fmt: v => v.toFixed(1),         better: "high", cls: "" },
  latency: { title: "Average Latency (s)",  key: "latency", fmt: v => v.toFixed(2) + " s",  better: "low",  cls: "metric-latency" },
  quality: { title: "Quality Heuristic %",  key: "quality", fmt: v => v.toFixed(1) + "%",   better: "high", cls: "metric-quality" },
};
function BarChart({ profiles }) {
  const [metric, setMetric] = useState("tps");
  const cfg = BAR_CFG[metric];

  // Stable row order: alphabetical by profile so React keys map 1:1 across metric switches.
  // Visual order is controlled by the `order` style based on the current metric's ranking.
  const stable = useMemo(() => [...profiles].sort((a, b) => a.profile.localeCompare(b.profile)), [profiles]);

  const ranking = useMemo(() => {
    const sorted = [...stable].sort((a, b) =>
      cfg.better === "high" ? b[cfg.key] - a[cfg.key] : a[cfg.key] - b[cfg.key]
    );
    const m = new Map();
    sorted.forEach((p, i) => m.set(p.profile, i));
    return m;
  }, [stable, metric]);

  const max = Math.max(...stable.map(p => p[cfg.key]));

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
          const pct = phase.ready ? (p[cfg.key] / max) * 100 : 0;
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

  const xVals = profiles.map(p => p.tps);
  const yVals = profiles.map(p => p.quality);
  const xMax = Math.ceil(Math.max(...xVals) / 25) * 25 + 25;
  const xMin = 0;
  const yMaxRaw = Math.max(...yVals);
  const yMinRaw = Math.min(...yVals);
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
          {profiles.map(p => {
            const cx = xScale(p.tps), cy = yScale(p.quality);
            const cls = p.role === "balanced" ? "balanced" : p.role === "fastest" ? "fastest" : "other";
            const r = p.role === "balanced" ? 9 : p.role === "fastest" ? 8 : 6;
            const [dx, dy] = offsetMap[p.profile];
            return (
              <g key={p.profile}>
                <circle className={`scatter-pt ${cls}`} cx={cx} cy={cy} r={r}>
                  <title>{`${p.profile} · ${p.tps.toFixed(1)} tok/s · ${p.quality.toFixed(1)}%`}</title>
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

/* ---------- Quality bar ---------- */
function QBar({ q, qmax }) {
  const r = q / qmax;
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
function highlightThinking(text) {
  const lines = text.split("\n");
  let inThink = false;
  return lines.map(line => {
    if (/^\s*<think>/i.test(line))  { inThink = true;  return `<span class="think">${escapeHtml(line)}</span>`; }
    if (/^\s*<\/think>/i.test(line)) { inThink = false; return `<span class="think">${escapeHtml(line)}</span>`; }
    if (inThink) return `<span class="think">${escapeHtml(line)}</span>`;
    if (/^\s*(here'?s a thinking process|thinking process|deconstruct(?:ing)? the prompt|analy(?:s|z)e (?:user|the)|drafting - attempt|identify )/i.test(line)) {
      return `<span class="think">${escapeHtml(line)}</span>`;
    }
    return escapeHtml(line);
  }).join("\n");
}

Object.assign(window, {
  Txt, Eyebrow, Label, SectionHead, Chip, Flag, MiniFlag,
  BarChart, Scatter, CleanlinessGrid, QBar,
  escapeHtml, highlightThinking,
});
