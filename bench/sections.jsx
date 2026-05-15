/* ============================================================
   sections.jsx — Overview / Prompts / Config sections.
   Methodology lives in methodology.jsx as a top-level page.

   Inputs: the bench-shaped { bench, meta, cells } produced by
   data.jsx#loadBench. Each cell has `run` (manifest+summary+
   results) and `rollup` (headline metrics + cleanliness counts).
   ============================================================ */

const { useState: _useState, useMemo: _useMemo, useCallback: _useCallback } = React;

/* ====================== OVERVIEW ====================== */
function OverviewSection({ bench, leaderboards, onOpenPrompts, onOpenRun }) {
  const meta = bench.meta;
  const cells = bench.cells;
  return (
    <section data-screen-label="01 Overview">
      <BenchHero meta={meta} />

      {meta.hardware && <GpuStateRibbon hardware={meta.hardware} />}

      <SectionHead
        num="01"
        title="Capabilities"
        sub={`// ${cells.length} cell${cells.length === 1 ? "" : "s"} · ${meta.run_count} run${meta.run_count === 1 ? "" : "s"}${meta.partial_run_count ? ` +${meta.partial_run_count} partial` : ""} accumulated`}
      />
      {cells.length === 0 ? (
        <div className="me-card p-6 font-mono text-[12px] text-me-fg-3">
          No capability cells yet. Run an adapter against this model and it'll appear here.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cells.map(cell => (
            <CapabilityCell
              key={cell.comparability_key}
              cell={cell}
              onOpenPrompts={() => onOpenPrompts(cell.adapter.name)}
              onOpenRun={(runId) => onOpenRun(cell.adapter.name, runId)} />
          ))}
        </div>
      )}

      <SectionHead num="02" title="Output Cleanliness" sub="// did the model leak its reasoning into the response?" />
      <CleanlinessLegend />
      <CleanlinessOverview cells={cells} />

      {leaderboards && <RecommendationsBlock leaderboards={leaderboards} bench={bench} />}
    </section>
  );
}

function BenchHero({ meta }) {
  const hw = meta.hardware;
  const server = meta.server;
  const stats = [];
  if (meta.latest_timestamp) stats.push({ id: "time", icon: "fa-regular fa-clock", value: window.BenchData.fmtTimestamp(meta.latest_timestamp) });
  if (hw?.gpu_name) {
    const vram = hw.vram_mb ? ` · ${(hw.vram_mb / 1024).toFixed(0)} GB` : "";
    stats.push({ id: "gpu", icon: "fa-microchip", value: `${hw.gpu_name}${vram}` });
  }
  if (server?.engine) stats.push({
    id: "engine", icon: "fa-server",
    value: `${server.engine}${server.version ? ` @ ${server.version}` : ""}`,
  });
  stats.push({
    id: "cells",
    icon: "fa-list-check",
    value: `${meta.cell_count} capabilit${meta.cell_count === 1 ? "y" : "ies"} · ${meta.run_count} run${meta.run_count === 1 ? "" : "s"}${meta.partial_run_count ? ` +${meta.partial_run_count} partial` : ""}`,
  });
  if (meta.suite_seconds != null) stats.push({
    id: "suite", icon: "fa-stopwatch",
    value: `≈ ${window.BenchData.fmtDuration(meta.suite_seconds)} total`,
  });

  return (
    <div className="hero-bg relative overflow-hidden border border-me-border p-5 md:p-8 lg:p-9">
      <div className="me-eyebrow flex flex-wrap gap-x-5 gap-y-2 mb-3">
        {stats.map(s => (
          <span key={s.id} className="inline-flex items-center gap-1.5">
            <i className={`fa-solid ${s.icon} text-me-cyan`}></i> {s.value}
          </span>
        ))}
      </div>
      <h1 className="hero-title my-2">{meta.title}</h1>
      <p className="font-mono text-[13px] md:text-[15px] text-me-fg-2 mb-1 max-w-[80ch]">
        {`// ${meta.model_alias}${meta.hardware_profile && meta.hardware_profile !== "unknown" ? ` · ${meta.hardware_profile}` : ""} · ${meta.cell_count} capabilit${meta.cell_count === 1 ? "y" : "ies"} attached`}
      </p>
    </div>
  );
}

function GpuStateRibbon({ hardware }) {
  const items = [];
  if (hardware.boost_clock_mhz != null) items.push(["Boost", `${hardware.boost_clock_mhz} MHz`]);
  if (hardware.app_clock_graphics_mhz != null) items.push(["App clock", `${hardware.app_clock_graphics_mhz} MHz`]);
  if (hardware.mem_clock_max_mhz != null) items.push(["Mem max", `${hardware.mem_clock_max_mhz} MHz`]);
  if (hardware.power_limit_w != null) items.push(["Power limit", `${Number(hardware.power_limit_w).toFixed(0)} W`]);
  if (hardware.persistence_mode) items.push(["Persistence", hardware.persistence_mode]);
  if (!items.length) return null;
  return (
    <div className="mt-4 me-card p-3 md:p-4">
      <div className="me-eyebrow mb-2">
        <i className="fa-solid fa-bolt text-me-warning mr-1.5"></i> GPU state at run time
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
        {items.map(([k, v]) => (
          <div key={k} className="p-2 bg-white/[0.02] border border-me-border">
            <div className="me-label">{k}</div>
            <div className="font-mono text-[12px] text-me-fg mt-0.5">{v}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 font-mono text-[10px] text-me-fg-3">
        // shifts here mean OC profile changed
      </div>
    </div>
  );
}

function CapabilityCell({ cell, onOpenPrompts, onOpenRun }) {
  const adapter = cell.adapter || {};
  const r = cell.rollup;
  const qualityClass = qualityColor(r?.quality);
  const tpsClass = tpsColor(r?.tps);
  const qualityLabel = r?.qualityKind === "partial" ? "Partial" : "Accuracy";
  const ts = window.BenchData.fmtDateOnly(cell.latest?.timestamp);
  return (
    <div className="me-card p-4 md:p-5 transition-all hover:border-me-border-strong">
      <div className="flex items-baseline justify-between gap-2 mb-2 flex-wrap">
        <div>
          <div className="me-eyebrow">
            <i className="fa-solid fa-cube text-me-cyan mr-1.5"></i>
            {adapter.name}@{adapter.version || "v?"}{adapter.track ? ` · ${adapter.track}` : ""}
          </div>
          <h3 className="font-display text-[15px] md:text-[17px] tracking-[0.1em] uppercase m-0 mt-1 text-me-fg break-all">
            {adapter.name || "—"}
          </h3>
        </div>
        <div className="font-mono text-[10px] text-me-fg-3">{ts}</div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <div className="p-2.5 bg-white/[0.02] border border-me-border" data-tip={r?.qualityCi ? window.BenchData.fmtCi(r.qualityCi) : qualityLabel}>
          <div className="me-label">{qualityLabel}</div>
          <div className={`font-mono text-[20px] md:text-[22px] mt-0.5 ${qualityClass}`}>
            {window.BenchData.fmtQuality(r?.quality)}
          </div>
        </div>
        <div className="p-2.5 bg-white/[0.02] border border-me-border" data-tip="median tok/s, end-to-end">
          <div className="me-label">tok/s</div>
          <div className={`font-mono text-[20px] md:text-[22px] mt-0.5 ${tpsClass}`}>
            {window.BenchData.fmtTps(r?.tps)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 font-mono text-[11px]">
        <div className="p-2 bg-white/[0.02] border border-me-border">
          <div className="me-label">Items</div>
          <div className="text-me-fg mt-0.5">{r?.itemCount ?? "—"}</div>
        </div>
        <div className="p-2 bg-white/[0.02] border border-me-border">
          <div className="me-label">Median lat</div>
          <div className="text-me-fg mt-0.5">{window.BenchData.fmtSeconds(r?.latency)}</div>
        </div>
        <div
          className="p-2 bg-white/[0.02] border border-me-border"
          data-tip={r?.computeSeconds != null
            ? `compute ${window.BenchData.fmtDuration(r.computeSeconds)} · overhead ${window.BenchData.fmtDuration(Math.max(0, (r.wallSeconds || 0) - r.computeSeconds))}`
            : "wall-clock for this run"}>
          <div className="me-label">Took</div>
          <div className="text-me-fg mt-0.5">{window.BenchData.fmtDuration(r?.wallSeconds)}</div>
        </div>
        <div className="p-2 bg-white/[0.02] border border-me-border">
          <div className="me-label">Errors</div>
          <div className={`mt-0.5 ${r?.errorCount ? "text-me-danger" : "text-me-fg"}`}>{r?.errorCount ?? 0}</div>
        </div>
      </div>

      {r && (
        <div className="mt-3">
          <CleanlinessBar clean={r.cleanCount} leak={r.leakCount} empty={r.emptyCount} />
        </div>
      )}

      <div className="flex items-center justify-between mt-4">
        <div className="font-mono text-[10px] text-me-fg-3">
          key {cell.comparability_prefix} ·{" "}
          {cell.partial_only
            ? <span title="No full-suite run yet — only subset re-runs against this configuration.">partial coverage ({cell.partial_run_count})</span>
            : `${cell.run_count} run${cell.run_count === 1 ? "" : "s"}`}
        </div>
        <button
          onClick={onOpenPrompts}
          className="font-mono text-[10px] tracking-[0.16em] uppercase px-2.5 py-1 border border-me-border text-me-fg-2 hover:text-me-fg hover:border-me-cyan transition-colors">
          Prompts <i className="fa-solid fa-arrow-right ml-1"></i>
        </button>
      </div>

      {cell.run_count > 1 && (
        <CellHistoryDisclosure cell={cell} onOpenRun={onOpenRun} />
      )}
      {cell.partial_run_count > 0 && (
        <CellPartialRunsDisclosure cell={cell} onOpenRun={onOpenRun} />
      )}
    </div>
  );
}

function CellPartialRunsDisclosure({ cell, onOpenRun }) {
  const [open, setOpen] = _useState(false);
  const partials = cell.partial_runs || [];
  if (!partials.length) return null;
  const n = partials.length;
  return (
    <div className="mt-2 border-t border-me-border pt-2">
      <button
        onClick={() => setOpen(o => !o)}
        title="Subset re-runs aren't comparable to full-suite runs, so they're listed separately."
        className="font-mono text-[10px] text-me-fg-3 hover:text-me-fg cursor-pointer bg-transparent border-0 p-0">
        {open ? "▾" : "▸"} partial re-run{n === 1 ? "" : "s"} ({n})
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-1.5">
          {partials.map(p => {
            const acc = p.accuracy?.point != null
              ? (Number(p.accuracy.point) * 100).toFixed(1) + "%"
              : (p.partial?.point != null ? (Number(p.partial.point) * 100).toFixed(1) + "%" : "—");
            const items = p.item_count != null ? `${p.item_count} item${p.item_count === 1 ? "" : "s"}` : "—";
            const clickable = typeof onOpenRun === "function";
            return (
              <button
                key={p.id}
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onOpenRun(p.id)}
                className={`grid grid-cols-[auto_1fr_auto_auto] gap-3 font-mono text-[10px] text-me-fg-3 items-baseline w-full text-left bg-transparent border-0 p-1 -mx-1 ${clickable ? "hover:bg-white/[0.03] hover:text-me-fg cursor-pointer" : ""}`}>
                <span className="text-me-fg-2 whitespace-nowrap">{window.BenchData.fmtTimestamp(p.timestamp)}</span>
                <span className="truncate text-me-fg-2" title={p.subset || ""}>
                  <span className="text-me-fg-3">subset:</span> {p.subset || "—"} · {items}
                </span>
                <span className="text-me-fg-2 whitespace-nowrap">{acc}</span>
                {clickable && (
                  <span className="text-me-cyan whitespace-nowrap">open →</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CellHistoryDisclosure({ cell, onOpenRun }) {
  const [open, setOpen] = _useState(false);
  const [history, setHistory] = _useState(null);
  React.useEffect(() => {
    if (!open || history) return;
    let cancelled = false;
    (async () => {
      const runs = await window.BenchData.loadCellHistory(cell);
      if (!cancelled) setHistory(runs);
    })();
    return () => { cancelled = true; };
  }, [open, history, cell]);

  const clickable = typeof onOpenRun === "function";
  return (
    <div className="mt-3 border-t border-me-border pt-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="font-mono text-[10px] text-me-fg-3 hover:text-me-fg cursor-pointer bg-transparent border-0 p-0">
        {open ? "▾" : "▸"} history ({cell.run_count - 1} earlier run{cell.run_count - 1 === 1 ? "" : "s"})
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-1.5">
          {history === null && <div className="font-mono text-[10px] text-me-fg-3">loading…</div>}
          {history && history.map(run => {
            const summary = run.summary || {};
            const ci = summary.accuracy || summary.partial;
            const acc = ci?.point != null ? (Number(ci.point) * 100).toFixed(1) + "%" : "—";
            const tps = summary.median_tokens_per_sec != null ? Number(summary.median_tokens_per_sec).toFixed(1) : "—";
            return (
              <button
                key={run.id}
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onOpenRun(run.id)}
                title={clickable ? `Open prompts for ${run.id}` : run.id}
                className={`grid grid-cols-[1fr_auto_auto_auto] gap-3 font-mono text-[10px] text-me-fg-3 items-baseline w-full text-left bg-transparent border-0 p-1 -mx-1 ${clickable ? "hover:bg-white/[0.03] hover:text-me-fg cursor-pointer" : ""}`}>
                <span className="truncate">{window.BenchData.fmtTimestamp(run.manifest?.timestamp)}</span>
                <span className="text-me-fg-2 whitespace-nowrap">{acc}</span>
                <span className="text-me-fg-2 whitespace-nowrap">{tps} tok/s</span>
                {clickable && (
                  <span className="text-me-cyan whitespace-nowrap">open →</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CleanlinessLegend() {
  return (
    <div className="me-card p-3 md:p-4 mb-3">
      <div className="font-mono text-[11px] md:text-[12px] text-me-fg-2 leading-relaxed">
        <span className="text-me-fg-3">// </span>
        Reasoning models can dump their <code className="text-me-warning">&lt;think&gt;</code>{" "}
        scratchpad into the user-visible answer. We classify each response:
      </div>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-[11px]">
        <div className="flex items-baseline gap-2">
          <span className="me-miniflag clean">clean</span>
          <span className="text-me-fg-2">no thinking visible — answer only</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="me-miniflag leak">leak</span>
          <span className="text-me-fg-2">visible <code>&lt;think&gt;</code> block or "thinking process:" preamble</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="me-miniflag danger">empty</span>
          <span className="text-me-fg-2">no usable answer (empty think block, or all content stuck in <code>reasoning_content</code>)</span>
        </div>
      </div>
      <div className="mt-2 font-mono text-[10px] text-me-fg-3">
        // 100% clean = every prompt in this cell came back without thinking leakage. higher is better.
      </div>
    </div>
  );
}

function CleanlinessOverview({ cells }) {
  const usable = cells.filter(c => c.rollup);
  if (!usable.length) return (
    <div className="me-card p-4 font-mono text-[11px] text-me-fg-3">No data yet.</div>
  );
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {usable.map(cell => {
        const r = cell.rollup;
        return (
          <div key={cell.comparability_key} className="me-card p-3.5">
            <div className="flex items-baseline justify-between mb-2">
              <h4 className="font-mono text-[12px] m-0 text-me-fg break-all">{cell.adapter.name}</h4>
              <span className="font-mono text-[10px] text-me-fg-3">{r.totalRows} rows</span>
            </div>
            <CleanlinessBar clean={r.cleanCount} leak={r.leakCount} empty={r.emptyCount} />
            <div className="font-mono text-[11px] text-me-fg-3 mt-2">
              clean {r.cleanCount} · leak {r.leakCount} · empty {r.emptyCount}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecommendationsBlock({ leaderboards: _lb, bench: _b }) {
  // Recommendations only show value when there are 2+ benches on the same hw.
  // For a single-bench host this returns nothing — by design.
  return null;
}

function qualityColor(q) {
  const n = Number(q);
  if (!Number.isFinite(n)) return "text-me-fg-3";
  if (n >= 95) return "text-me-success";
  if (n >= 80) return "text-me-warning";
  return "text-me-danger";
}
function tpsColor(t) {
  const n = Number(t);
  if (!Number.isFinite(n)) return "text-me-fg-3";
  if (n > 100) return "text-me-cyan";
  if (n > 30) return "text-me-fg";
  return "text-me-warning";
}

/* ====================== PROMPTS ====================== */
function PromptsSection({ bench, adapterName, runId, onSwitch, onSwitchRun }) {
  const cell = bench.cells.find(c => c.adapter.name === adapterName);
  const cells = bench.cells.filter(c => c.run && c.run.results.length);
  // If a specific runId is requested and it's not the cell's preloaded latest,
  // fetch that run on demand. Covers both subset re-runs (their own
  // comparability_key) and earlier full-suite runs from the same cell's
  // history (same comparability_key, different timestamp).
  const [altRun, setAltRun] = _useState(null);
  const [altErr, setAltErr] = _useState(null);
  React.useEffect(() => {
    setAltRun(null);
    setAltErr(null);
    if (!runId || !cell) return;
    if (cell.run && runId === cell.run.id) return;
    let cancelled = false;
    (async () => {
      try {
        const run = await window.BenchData.loadRun(runId);
        if (!cancelled) {
          if (run) setAltRun(run);
          else setAltErr(`Run ${runId} not found.`);
        }
      } catch (e) {
        if (!cancelled) setAltErr(String(e?.message || e));
      }
    })();
    return () => { cancelled = true; };
  }, [runId, cell]);

  if (!cell) {
    return (
      <section data-screen-label="02 Prompts">
        <SectionHead num="03" title="Prompts" sub="// pick a capability above" />
        <CapabilityPicker cells={cells} active={adapterName} onSwitch={onSwitch} />
        <div className="me-card p-6 font-mono text-[12px] text-me-fg-3">
          No data for capability "{adapterName}".
        </div>
      </section>
    );
  }

  const wantsAlt = runId && cell.run && runId !== cell.run.id;
  const viewCell = wantsAlt
    ? (altRun ? _viewCellForRun(cell, altRun) : null)
    : cell;
  const activeRunId = viewCell?.run?.id || (wantsAlt ? runId : cell.run?.id);
  const altKind = wantsAlt ? _altRunKind(cell, runId) : null;
  const subtitle = wantsAlt
    ? `// ${_altRunSubtitle(altKind, cell, runId, altRun)}`
    : `// per-item runs from the latest ${adapterName} cell`;

  return (
    <section data-screen-label="02 Prompts">
      <SectionHead num="03" title={`Prompts · ${adapterName}`} sub={subtitle} />
      <CapabilityPicker cells={cells} active={adapterName} onSwitch={onSwitch} />
      <RunPicker cell={cell} activeRunId={activeRunId} onSwitchRun={onSwitchRun} />
      {wantsAlt && !viewCell && !altErr && (
        <div className="me-card p-6 font-mono text-[12px] text-me-fg-3">
          <i className="fa-solid fa-spinner fa-spin mr-2"></i>Loading run…
        </div>
      )}
      {altErr && (
        <div className="me-card p-6 font-mono text-[12px] text-me-danger">{altErr}</div>
      )}
      {viewCell && viewCell.run && <PromptsTable cell={viewCell} />}
      {viewCell && !viewCell.run && (
        <div className="me-card p-6 font-mono text-[12px] text-me-fg-3">
          No results recorded for this run.
        </div>
      )}
    </section>
  );
}

function _altRunKind(cell, runId) {
  if ((cell.partial_runs || []).some(p => p.id === runId)) return "partial";
  if ((cell.history_ids || []).includes(runId)) return "history";
  return "unknown";
}

function _altRunSubtitle(kind, cell, runId, altRun) {
  if (kind === "partial") {
    const p = (cell.partial_runs || []).find(r => r.id === runId);
    if (!p) return `subset re-run · ${runId}`;
    const items = p.item_count != null
      ? ` · ${p.item_count} item${p.item_count === 1 ? "" : "s"}`
      : "";
    return `subset re-run · subset: ${p.subset || "—"}${items}`;
  }
  if (kind === "history") {
    const ts = altRun?.manifest?.timestamp;
    const when = ts ? window.BenchData.fmtTimestamp(ts) : runId;
    return `earlier run · ${when}`;
  }
  return `run · ${runId}`;
}

function _viewCellForRun(cell, run) {
  // Synthetic cell wrapping a non-latest run (earlier full run from this
  // cell's history, or a subset re-run). Shape mirrors what
  // PromptsTable/PromptRow/RatingEditor read: a `run` payload and a
  // `comparability_key` to scope ratings under. The run's own key takes
  // precedence so subset re-runs (different key) keep their ratings
  // separate; earlier full runs (same key) share ratings with the latest.
  const ck = run.manifest?.comparability_key || cell.comparability_key;
  return {
    ...cell,
    run,
    comparability_key: ck,
    comparability_prefix: ck ? ck.slice(0, 8) : cell.comparability_prefix,
  };
}

function RunPicker({ cell, activeRunId, onSwitchRun }) {
  const partials = cell.partial_runs || [];
  const fullId = cell.run?.id || cell.latest?.id;
  const hasFull = !cell.partial_only && fullId;
  const fullActive = hasFull && (activeRunId === fullId || !activeRunId);
  // Show the chip row when there's something to switch between: partials,
  // or a historical full run that's not the latest (so the user always has
  // a one-click way back to the latest).
  const onHistorical = hasFull && activeRunId && activeRunId !== fullId
    && !partials.some(p => p.id === activeRunId);
  if (!partials.length && !onHistorical) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <Label>Run</Label>
      {hasFull && (
        <Chip on={fullActive} cyan onClick={() => onSwitchRun(null)}>
          Latest full run
        </Chip>
      )}
      {onHistorical && (
        <Chip on cyan title={activeRunId}>
          earlier full run
        </Chip>
      )}
      {partials.map(p => (
        <Chip
          key={p.id}
          on={activeRunId === p.id}
          cyan
          onClick={() => onSwitchRun(p.id)}
          title={p.subset || ""}>
          partial · {p.item_count ?? "?"} item{p.item_count === 1 ? "" : "s"}
        </Chip>
      ))}
    </div>
  );
}

function CapabilityPicker({ cells, active, onSwitch }) {
  if (cells.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <Label>Capability</Label>
      {cells.map(c => (
        <Chip key={c.adapter.name} on={c.adapter.name === active} cyan onClick={() => onSwitch(c.adapter.name)}>
          {c.adapter.name}
        </Chip>
      ))}
    </div>
  );
}

const PROMPTS_PAGE_SIZE = 50;

function PromptsTable({ cell }) {
  const [filter, setFilter] = _useState("all");
  const [hideThinking, setHideThinking] = _useState(false);
  const [previewHtml, setPreviewHtml] = _useState(true);
  const [open, setOpen] = _useState({});
  const [page, setPage] = _useState(0);
  // Bumped when a rating is written so child rows re-read localStorage
  // and the per-cell rating summary refreshes.
  const [ratingsVersion, setRatingsVersion] = _useState(0);
  const bumpRatings = _useCallback(() => setRatingsVersion(v => v + 1), []);

  const rows = cell.run.results;
  const cats = _useMemo(() => {
    const set = new Set();
    for (const r of rows) if (r.category) set.add(r.category);
    return ["all", ...set];
  }, [rows]);
  const filtered = filter === "all" ? rows : rows.filter(r => r.category === filter);

  // Reset to first page when the filter changes (or the underlying cell switches).
  React.useEffect(() => { setPage(0); }, [filter, cell.comparability_key]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PROMPTS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * PROMPTS_PAGE_SIZE;
  const end = Math.min(start + PROMPTS_PAGE_SIZE, filtered.length);
  const pageRows = filtered.slice(start, end);

  const ratingAgg = _useMemo(
    () => window.BenchRatings.aggregate(cell.comparability_key, rows.map(r => r.item_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cell.comparability_key, rows, ratingsVersion],
  );

  return (
    <>
      <RatingSummary aggregate={ratingAgg} totalItems={rows.length} />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Label>Category</Label>
        {cats.map(c => (
          <Chip key={c} on={filter === c} onClick={() => setFilter(c)}>{c}</Chip>
        ))}
        <span className="flex-1"></span>
        <Chip on={previewHtml} onClick={() => setPreviewHtml(v => !v)}>
          {previewHtml ? "Preview HTML on" : "Preview HTML off"}
        </Chip>
        <Chip on={hideThinking} onClick={() => setHideThinking(v => !v)}>
          {hideThinking ? "Show thinking text" : "Hide thinking text"}
        </Chip>
      </div>

      <PromptsPager
        page={safePage}
        totalPages={totalPages}
        start={start}
        end={end}
        total={filtered.length}
        onPage={setPage} />

      <div className="me-card overflow-hidden">
        <table className="prun-table">
          {/* Fixed column widths so the table layout doesn't reflow when an
              expanded row's <td colSpan="7"> contains wide content (long
              HTML lines, prose diagnostics). Without this, opening a row
              widens the whole table and the column headers misalign. */}
          <colgroup>
            <col style={{ width: 30 }} />
            <col />{/* Item id — takes remaining space */}
            <col style={{ width: 110 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 150 }} />
          </colgroup>
          <thead>
            <tr>
              <th></th>
              <th>Item</th>
              <th>Category</th>
              <th className="numeric">Latency</th>
              <th className="numeric">tok/s</th>
              <th className="numeric">Score</th>
              <th>Output</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(r => (
              <PromptRow
                key={r.item_id}
                row={r}
                cell={cell}
                isOpen={!!open[r.item_id]}
                onToggle={() => setOpen(o => ({ ...o, [r.item_id]: !o[r.item_id] }))}
                hideThinking={hideThinking}
                previewHtml={previewHtml}
                onRatingChange={bumpRatings} />
            ))}
          </tbody>
        </table>
      </div>

      <PromptsPager
        page={safePage}
        totalPages={totalPages}
        start={start}
        end={end}
        total={filtered.length}
        onPage={setPage}
        bottom />
    </>
  );
}

/* ---------- Per-row prompt panel ---------- */
function PromptRow({ row, cell, isOpen, onToggle, hideThinking, previewHtml, onRatingChange }) {
  const r = row;
  const clean = window.BenchData.classifyCleanliness(r);
  const lat = Number(r.latency_ms);
  const tps = Number(r.tokens_per_sec);
  const partial = Number(r.score?.partial);
  const correct = !!r.score?.correct;
  const kind = window.classifyRow(r);  // "ok" | "low" | "empty" | "err"

  // Lazy-mount the expanded panel: don't render its children (especially
  // the iframe) until the row has been opened at least once. After that,
  // keep it mounted so the close animation has content to collapse from.
  const [wasOpened, setWasOpened] = _useState(isOpen);
  React.useEffect(() => { if (isOpen && !wasOpened) setWasOpened(true); }, [isOpen, wasOpened]);

  return (
    <React.Fragment>
      <tr className={`toggle-row ${isOpen ? "open" : ""}`} onClick={onToggle}>
        <td></td>
        <td><span className="pn break-all">{r.item_id}</span></td>
        <td className="text-me-fg-3 font-mono text-[11px]">{r.category || "—"}</td>
        <td className="numeric">{Number.isFinite(lat) ? `${(lat / 1000).toFixed(2)} s` : "—"}</td>
        <td className="numeric">{Number.isFinite(tps) ? tps.toFixed(1) : "—"}</td>
        <td className="numeric">
          <QBar
            q={Number.isFinite(partial) ? Math.round(partial * 100) : (correct ? 100 : 0)}
            qmax={100} />
        </td>
        <td>
          <MiniFlag kind={clean === "clean" ? "clean" : clean === "empty" ? "danger" : "leak"}>
            {clean === "clean" ? "clean" : clean === "empty" ? "empty" : "thinking"}
          </MiniFlag>
          {kind === "low" && <MiniFlag kind="leak">low</MiniFlag>}
          {kind === "err" && <MiniFlag kind="danger">err</MiniFlag>}
        </td>
      </tr>
      {/* The excerpt row is always rendered; the open/close animation
          lives on the inner grid wrapper (excerpt-collapse). React
          unmount would skip the close transition. */}
      <tr className="excerpt-row">
        <td colSpan="7">
          <div className={`excerpt-collapse ${isOpen ? "open" : ""}`} aria-hidden={!isOpen}>
            <div className="excerpt-collapse-inner">
              {wasOpened && (
                <ExpandedPanel
                  row={r}
                  cell={cell}
                  hideThinking={hideThinking}
                  previewHtml={previewHtml}
                  onRatingChange={onRatingChange} />
              )}
            </div>
          </div>
        </td>
      </tr>
    </React.Fragment>
  );
}

function ExpandedPanel({ row, cell, hideThinking, previewHtml, onRatingChange }) {
  const r = row;
  const diag = window.diagnoseRow(r);
  const misses = r.score?.breakdown?.misses;
  const hits = r.score?.breakdown?.hits;
  const showMisses = Array.isArray(misses) && misses.length > 0 && Array.isArray(hits);
  const isHtml = window.looksLikeHtmlDoc(r.raw);
  return (
    <div className="excerpt-panel">
      {diag && <DiagnosticBanner diag={diag} row={r} cell={cell} />}
      {showMisses && <MissedChecksPanel hits={hits} misses={misses} />}
      <OutputArea row={r} previewHtml={previewHtml} hideThinking={hideThinking} />
      <RatingEditor cell={cell} row={r} onChange={onRatingChange} />
      <ExpandedFoot row={r} isHtml={isHtml} />
    </div>
  );
}

function DiagnosticBanner({ diag, row, cell }) {
  const tone = diag.kind === "err" ? "danger" : diag.kind === "empty" ? "warn" : "info";
  const status = Number(row.http_status);
  const lat = Number(row.latency_ms);
  const outTok = Number(row.output_tokens);
  const promTok = Number(row.prompt_tokens);
  const maxTok = Number(row.max_tokens);
  const meta = [];
  if (Number.isFinite(status) && status > 0) meta.push(`http=${status}`);
  if (Number.isFinite(lat)) meta.push(`${(lat/1000).toFixed(1)}s`);
  if (Number.isFinite(promTok)) meta.push(`prompt=${promTok.toLocaleString()} tok`);
  if (Number.isFinite(outTok) && Number.isFinite(maxTok)) {
    const hitCap = outTok >= maxTok - 4;  // within 4 of the cap = effectively hit it
    meta.push(`output=${outTok.toLocaleString()} / ${maxTok.toLocaleString()} tok${hitCap ? " (cap)" : ""}`);
  } else if (Number.isFinite(outTok)) {
    meta.push(`output=${outTok.toLocaleString()} tok`);
  }
  if (cell?.adapter?.name) meta.push(`adapter=${cell.adapter.name}`);
  return (
    <div className={`diag-banner ${tone}`}>
      <div className="diag-headline">
        <span className="diag-kind">{diag.kind.toUpperCase()}</span>
        {diag.headline}
      </div>
      <div className="diag-detail">{diag.detail}</div>
      {meta.length > 0 && <div className="diag-meta">{meta.join(" · ")}</div>}
      {row.error && (
        <details className="diag-error">
          <summary>Full error</summary>
          <pre>{String(row.error)}</pre>
        </details>
      )}
    </div>
  );
}

function MissedChecksPanel({ hits, misses }) {
  const all = [
    ...hits.map(h => ({ kind: "hit", text: typeof h === "string" ? h : JSON.stringify(h) })),
    ...misses.map(m => ({ kind: "miss", text: Array.isArray(m) ? m.join(" / ") : String(m) })),
  ];
  return (
    <div className="checks-panel">
      <div className="checks-head">Rubric checks</div>
      <ul>
        {all.map((c, i) => (
          <li key={i} className={c.kind}>
            <span className="check-mark">{c.kind === "hit" ? "✓" : "✗"}</span>
            <code>{c.text}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OutputArea({ row, previewHtml, hideThinking }) {
  const raw = row.raw || "";
  // Iframe gets the stripped HTML so prose preambles don't end up in the
  // <head>. The source-code panel below shows the FULL response so the
  // user can see whatever the model actually emitted (preamble, fence
  // language hint, closing remarks). Prism still highlights code blocks
  // inside that full text via highlightExcerpt's fence-aware rendering.
  const isHtml = window.looksLikeHtmlDoc(raw);
  if (previewHtml && isHtml) {
    const stripped = window.stripCodeFences(raw);
    return (
      <div className="excerpt-preview">
        <iframe
          title={`preview-${row.item_id}`}
          srcDoc={stripped}
          // Sandbox: allow-scripts (no allow-same-origin) keeps scripts
          // unable to escape into the parent. allow-modals lets pages
          // call alert/confirm if they want to.
          sandbox="allow-scripts allow-modals"
          // Permissions Policy: enable mic + camera + autoplay so the
          // audio-reactive prompt's getUserMedia call actually works.
          // Also enable pointer-lock for canvas demos that grab pointer.
          allow="microphone; camera; autoplay; pointer-lock; fullscreen"
          referrerPolicy="no-referrer"
          loading="lazy" />
      </div>
    );
  }
  const lang = window.detectExcerptLanguage(row.item_id, raw);
  const html = window.highlightExcerpt(raw || "(no output)", lang);
  return (
    <pre className={`excerpt-inner ${hideThinking ? "hide-thinking" : ""} ${lang ? `language-${lang}` : ""}`}
         dangerouslySetInnerHTML={{ __html: html }} />
  );
}

function RatingEditor({ cell, row, onChange }) {
  const ck = cell.comparability_key;
  const itemId = row.item_id;
  const [data, setData] = _useState(() => window.BenchRatings.read(ck, itemId) || { stars: null, note: "", tags: [] });
  const [tagDraft, setTagDraft] = _useState("");

  // If the underlying row changes (different item opened), re-read.
  React.useEffect(() => {
    setData(window.BenchRatings.read(ck, itemId) || { stars: null, note: "", tags: [] });
  }, [ck, itemId]);

  const persist = _useCallback((next) => {
    setData(next);
    window.BenchRatings.write(ck, itemId, next);
    if (onChange) onChange();
  }, [ck, itemId, onChange]);

  const setStars = (n) => persist({ ...data, stars: n });
  const setNote = (note) => persist({ ...data, note });
  const addTag = () => {
    const t = tagDraft.trim();
    if (!t || data.tags.includes(t)) { setTagDraft(""); return; }
    persist({ ...data, tags: [...data.tags, t] });
    setTagDraft("");
  };
  const removeTag = (t) => persist({ ...data, tags: data.tags.filter(x => x !== t) });

  return (
    <div className="rating-editor" onClick={(e) => e.stopPropagation()}>
      <div className="rating-row">
        <span className="rating-label">Your rating</span>
        <StarRating value={data.stars} onChange={setStars} />
        <span className="rating-spacer"></span>
        <input
          className="tag-input"
          type="text"
          placeholder="add tag"
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} />
        {data.tags.map(t => (
          <button key={t} className="rating-tag" onClick={() => removeTag(t)} title="Click to remove">
            {t} <span className="tag-x">×</span>
          </button>
        ))}
      </div>
      <textarea
        className="rating-note"
        placeholder="// optional notes"
        value={data.note || ""}
        onChange={(e) => setNote(e.target.value)}
        rows={2} />
    </div>
  );
}

function ExpandedFoot({ row, isHtml }) {
  const [copied, setCopied] = _useState(false);
  const copyPrompt = () => {
    if (!row.prompt) return;
    navigator.clipboard?.writeText(row.prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  // Open the rendered HTML in a new tab. Strips fences so prose preambles
  // ("Here is the solution: ```html …```") don't end up in the document.
  const openInTab = () => {
    if (!row.raw) return;
    const html = window.stripCodeFences(row.raw);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  // Pop the rendered HTML out into a sized, resizable browser window so the
  // user can stress-test responsiveness, use mic/camera (popup window has
  // its own top-level permissions context, unlike the sandboxed iframe),
  // and drag the window edges. Note: most browsers ignore window.open
  // sizing for tabs but honor it for explicit popup features.
  const popOut = () => {
    if (!row.raw) return;
    const html = window.stripCodeFences(row.raw);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const w = Math.min(1280, Math.round(screen.availWidth  * 0.8));
    const h = Math.min(900,  Math.round(screen.availHeight * 0.85));
    const features = `popup,width=${w},height=${h},resizable=yes,scrollbars=yes`;
    window.open(url, `bench-preview-${row.item_id}`, features);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <div className="excerpt-foot">
      <span className="raw-path">run: {row.run_id}</span>
      {row.parse_failed && <span className="text-me-warning ml-3">parse_failed</span>}
      <span className="flex-1"></span>
      {row.prompt && (
        <button onClick={copyPrompt} title="Copy the rendered prompt to clipboard">
          {copied ? "✓ copied" : "copy prompt"}
        </button>
      )}
      {isHtml && (
        <button onClick={popOut} title="Open in a resizable popup window (best for testing responsiveness, mic, camera)">
          pop out ⧉
        </button>
      )}
      {isHtml && (
        <button onClick={openInTab} title="Open the raw HTML in a new tab">
          open in tab ↗
        </button>
      )}
    </div>
  );
}

function RatingSummary({ aggregate, totalItems }) {
  if (!aggregate || aggregate.count === 0) return null;
  return (
    <div className="rating-summary">
      <span className="rating-summary-label">Your rating:</span>
      <span className="rating-summary-mean">{aggregate.mean.toFixed(1)}/5</span>
      <span className="rating-summary-count">
        across {aggregate.count}/{totalItems} items rated
      </span>
    </div>
  );
}

function PromptsPager({ page, totalPages, start, end, total, onPage, bottom }) {
  if (total <= PROMPTS_PAGE_SIZE) return null;
  const canPrev = page > 0;
  const canNext = page < totalPages - 1;
  const btn = "px-2.5 py-1 border border-me-border font-mono text-[10px] tracking-[0.16em] uppercase text-me-fg-2 hover:text-me-fg hover:border-me-border-strong disabled:opacity-30 disabled:hover:text-me-fg-2 disabled:hover:border-me-border bg-transparent transition-colors";
  return (
    <div className={`flex flex-wrap items-center gap-2 ${bottom ? "mt-3" : "mb-3"} font-mono text-[11px] text-me-fg-3`}>
      <span>showing <span className="text-me-fg">{start + 1}</span>–<span className="text-me-fg">{end}</span> of <span className="text-me-fg">{total}</span></span>
      <span className="flex-1"></span>
      <button className={btn} onClick={() => onPage(0)} disabled={!canPrev}>« first</button>
      <button className={btn} onClick={() => onPage(page - 1)} disabled={!canPrev}>‹ prev</button>
      <span className="px-1">page <span className="text-me-fg">{page + 1}</span> / {totalPages}</span>
      <button className={btn} onClick={() => onPage(page + 1)} disabled={!canNext}>next ›</button>
      <button className={btn} onClick={() => onPage(totalPages - 1)} disabled={!canNext}>last »</button>
    </div>
  );
}

/* ====================== CONFIG ====================== */
function ConfigSection({ bench, profilesSnap }) {
  const meta = bench.meta;
  const snap = (profilesSnap?.profiles || []).find(p => p.name === meta.model_profile);
  return (
    <section data-screen-label="03 Config">
      <SectionHead num="04" title="Model Config" sub={`// llama-server overlay for ${meta.model_profile}`} />
      {snap
        ? <SnapshotCard profile={snap} />
        : <div className="me-card p-6 font-mono text-[12px] text-me-fg-3">
            No snapshot found for <code>{meta.model_profile}</code>. Run <code>llms eval report</code> to refresh.
          </div>}
    </section>
  );
}

function SnapshotCard({ profile }) {
  return (
    <div className="me-card p-4 md:p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <h3 className="font-display text-[14px] md:text-[16px] tracking-[0.12em] uppercase m-0 text-me-fg break-all">{profile.name}</h3>
        {window.BenchData.extractQuant(profile.model_filename || "") && (
          <span className="font-mono text-[10px] tracking-[0.1em] uppercase px-2 py-0.5 border border-me-cyan/40 text-me-cyan">
            {window.BenchData.extractQuant(profile.model_filename || "")}
          </span>
        )}
      </div>
      <div className="font-mono text-[11px] text-me-fg-2 break-all mb-3">{profile.model_filename || profile.model_path || "—"}</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 bg-white/[0.02] border border-me-border">
          <div className="me-label">Context</div>
          <div className="font-mono text-[13px] text-me-cyan mt-0.5">{profile.context_length ?? "inherited"}</div>
        </div>
        <div className="p-2.5 bg-white/[0.02] border border-me-border">
          <div className="me-label">KV cache</div>
          <div className="font-mono text-[13px] text-me-cyan mt-0.5">{(profile.cache_type_k || "default") + "/" + (profile.cache_type_v || "default")}</div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { OverviewSection, PromptsSection, ConfigSection });
