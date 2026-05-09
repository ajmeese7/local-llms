/* ============================================================
   sections.jsx — Overview / Prompts / Config sections.
   Methodology lives in methodology.jsx as a top-level page.

   Inputs: the bench-shaped { bench, meta, cells } produced by
   data.jsx#loadBench. Each cell has `run` (manifest+summary+
   results) and `rollup` (headline metrics + cleanliness counts).
   ============================================================ */

const { useState: _useState, useMemo: _useMemo } = React;

/* ====================== OVERVIEW ====================== */
function OverviewSection({ bench, leaderboards, onOpenPrompts }) {
  const meta = bench.meta;
  const cells = bench.cells;
  return (
    <section data-screen-label="01 Overview">
      <BenchHero meta={meta} />

      {meta.hardware && <GpuStateRibbon hardware={meta.hardware} />}

      <SectionHead num="01" title="Capabilities" sub={`// ${cells.length} cell${cells.length === 1 ? "" : "s"} · ${meta.run_count} run${meta.run_count === 1 ? "" : "s"} accumulated`} />
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
              onOpenPrompts={() => onOpenPrompts(cell.adapter.name)} />
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
  stats.push({ id: "cells", icon: "fa-list-check", value: `${meta.cell_count} capabilit${meta.cell_count === 1 ? "y" : "ies"} · ${meta.run_count} run${meta.run_count === 1 ? "" : "s"}` });
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

function CapabilityCell({ cell, onOpenPrompts }) {
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
          key {cell.comparability_prefix} · {cell.run_count} run{cell.run_count === 1 ? "" : "s"}
        </div>
        <button
          onClick={onOpenPrompts}
          className="font-mono text-[10px] tracking-[0.16em] uppercase px-2.5 py-1 border border-me-border text-me-fg-2 hover:text-me-fg hover:border-me-cyan transition-colors">
          Prompts <i className="fa-solid fa-arrow-right ml-1"></i>
        </button>
      </div>

      {cell.run_count > 1 && <CellHistoryDisclosure cell={cell} />}
    </div>
  );
}

function CellHistoryDisclosure({ cell }) {
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
              <div key={run.id} className="grid grid-cols-[1fr_auto_auto] gap-3 font-mono text-[10px] text-me-fg-3">
                <span className="truncate" title={run.id}>{window.BenchData.fmtTimestamp(run.manifest?.timestamp)}</span>
                <span className="text-me-fg-2">{acc}</span>
                <span className="text-me-fg-2">{tps} tok/s</span>
              </div>
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
function PromptsSection({ bench, adapterName, onSwitch }) {
  const cell = bench.cells.find(c => c.adapter.name === adapterName);
  const cells = bench.cells.filter(c => c.run && c.run.results.length);
  if (!cell || !cell.run) {
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
  return (
    <section data-screen-label="02 Prompts">
      <SectionHead num="03" title={`Prompts · ${adapterName}`} sub={`// per-item runs from the latest ${adapterName} cell`} />
      <CapabilityPicker cells={cells} active={adapterName} onSwitch={onSwitch} />
      <PromptsTable cell={cell} />
    </section>
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
  const [open, setOpen] = _useState({});
  const [page, setPage] = _useState(0);

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

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Label>Category</Label>
        {cats.map(c => (
          <Chip key={c} on={filter === c} onClick={() => setFilter(c)}>{c}</Chip>
        ))}
        <span className="flex-1"></span>
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
          <thead>
            <tr>
              <th style={{ width: 30 }}></th>
              <th>Item</th>
              <th>Category</th>
              <th className="numeric">Latency</th>
              <th className="numeric">tok/s</th>
              <th className="numeric">Score</th>
              <th>Output</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(r => {
              const isOpen = !!open[r.item_id];
              const clean = window.BenchData.classifyCleanliness(r);
              const lat = Number(r.latency_ms);
              const tps = Number(r.tokens_per_sec);
              const partial = Number(r.score?.partial);
              const correct = !!r.score?.correct;
              const excerpt = r.raw || "(no output)";
              return (
                <React.Fragment key={r.item_id}>
                  <tr className={`toggle-row ${isOpen ? "open" : ""}`} onClick={() => setOpen(o => ({ ...o, [r.item_id]: !o[r.item_id] }))}>
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
                      {!correct && Number.isFinite(partial) && partial < 1 && <MiniFlag kind="leak">low</MiniFlag>}
                      {r.error && <MiniFlag kind="danger">err</MiniFlag>}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="excerpt-row">
                      <td colSpan="7">
                        <div className={`excerpt-inner ${hideThinking ? "hide-thinking" : ""}`}
                             dangerouslySetInnerHTML={{ __html: highlightThinking(excerpt) }} />
                        <div className="excerpt-foot">
                          <span className="raw-path">run: {r.run_id}</span>
                          {r.parse_failed && <span className="text-me-warning ml-3">parse_failed</span>}
                          {r.error && <span className="text-me-danger ml-3">{String(r.error).slice(0, 80)}</span>}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
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
