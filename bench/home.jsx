/* ============================================================
   home.jsx — Hub home.

   Flat bench grid by default (one card per (hardware, model)).
   When >=2 distinct hardware profiles are present, a hardware
   filter chip row appears above the grid. Sidebar surfaces
   per-metric leaderboards across all benches.
   ============================================================ */

const { useState: _hUseS, useMemo: _hUseM } = React;

function HomePage({ index, profilesSnap, leaderboards, onOpen }) {
  const benches = index?.benches || [];
  const reports = index?.reports || [];

  const hwProfiles = _hUseM(() => {
    const set = new Set();
    for (const b of benches) set.add(b.hardware_profile || "unknown");
    return [...set].sort();
  }, [benches]);

  const [hwFilter, setHwFilter] = _hUseS("all");
  const visible = hwFilter === "all"
    ? benches
    : benches.filter(b => (b.hardware_profile || "unknown") === hwFilter);

  if (!index) {
    return (
      <div className="me-card p-8 text-center font-mono text-me-fg-3">
        <i className="fa-solid fa-spinner fa-spin mr-2"></i> Loading registry…
      </div>
    );
  }

  if (!benches.length) return <EmptyState reports={reports} />;

  return (
    <>
      <HomeHero benches={benches} />

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6 lg:gap-8">
        <div>
          <div className="me-section-head">
            <h2><span className="num">A</span>All Benches</h2>
            <span className="sub">
              // {benches.length} bench{benches.length === 1 ? "" : "es"} · {reports.length} run{reports.length === 1 ? "" : "s"}
            </span>
          </div>
          {hwProfiles.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Label>Hardware</Label>
              <Chip on={hwFilter === "all"} cyan onClick={() => setHwFilter("all")}>All</Chip>
              {hwProfiles.map(hw => (
                <Chip key={hw} on={hwFilter === hw} onClick={() => setHwFilter(hw)}>
                  {hw}
                </Chip>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {visible.map(b => (
              <BenchCard
                key={b.id}
                bench={b}
                showHwPill={hwProfiles.length > 1}
                onOpen={() => onOpen(b.id)} />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {leaderboards && <LeaderboardsBlock leaderboards={leaderboards} onOpen={onOpen} />}
          <RatingsImportExportCard />
          {profilesSnap && <ProfilesSnapshotCard snapshot={profilesSnap} />}
          <NextStepsCard />
        </div>
      </div>
    </>
  );
}

function EmptyState({ reports }) {
  return (
    <div className="hero-bg relative overflow-hidden border border-me-border p-8 mb-8">
      <h1 className="hero-title my-2">Meese · Bench</h1>
      <p className="font-mono text-[13px] md:text-[15px] text-me-fg-2 mb-4 max-w-[64ch]">
        // No benches yet. Run an adapter at least once and the hub will pick it up automatically.
      </p>
      <div className="me-card p-4 md:p-5 max-w-[64ch]">
        <Label>Quick start</Label>
        <pre className="font-mono text-[12px] md:text-[13px] text-me-cyan mt-2 whitespace-pre-wrap">
{`# from the repo root
just bench-run            # any adapter
llms eval report          # rebuilds bench/reports/reports.json`}
        </pre>
        {reports.length > 0 && (
          <div className="mt-3 font-mono text-[11px] text-me-warning">
            {reports.length} run{reports.length === 1 ? "" : "s"} present but didn't group — re-run <code>llms eval report</code>.
          </div>
        )}
      </div>
    </div>
  );
}

function HomeHero({ benches }) {
  const totalCells = benches.reduce((acc, b) => acc + (b.cell_count || 0), 0);
  const totalRuns = benches.reduce((acc, b) => acc + (b.run_count || 0), 0);
  const latestStamp = benches[0]?.latest_timestamp;
  return (
    <div className="hero-bg relative overflow-hidden border border-me-border p-5 md:p-8 lg:p-9 mb-8">
      <div className="me-eyebrow flex flex-wrap gap-x-5 gap-y-2 mb-3">
        <span className="inline-flex items-center gap-1.5 text-me-magenta">
          <i className="fa-solid fa-circle-dot"></i> Bench hub
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="fa-solid fa-cubes-stacked text-me-cyan"></i>
          {benches.length} bench{benches.length === 1 ? "" : "es"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="fa-solid fa-list-check text-me-cyan"></i>
          {totalCells} capabilit{totalCells === 1 ? "y" : "ies"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="fa-solid fa-rotate text-me-cyan"></i>
          {totalRuns} run{totalRuns === 1 ? "" : "s"} accumulated
        </span>
        {latestStamp && (
          <span className="inline-flex items-center gap-1.5">
            <i className="fa-regular fa-clock text-me-cyan"></i>
            last: {window.BenchData.fmtTimestamp(latestStamp)}
          </span>
        )}
      </div>
      <h1 className="hero-title my-2">Meese · Bench</h1>
      <p className="font-mono text-[13px] md:text-[15px] text-me-fg-2 max-w-[80ch]">
        // one card per (hardware, model). each card carries every capability you've thrown at it.
      </p>
    </div>
  );
}

function BenchCard({ bench, showHwPill, onOpen }) {
  const hw = bench.hardware;
  const cellPreview = (bench.cells || []).slice(0, 6);
  const overflow = (bench.cells || []).length - cellPreview.length;

  return (
    <div
      className="me-card p-4 md:p-5 transition-all hover:-translate-y-0.5 hover:border-me-border-strong cursor-pointer"
      onClick={onOpen}
      role="button">
      <div className="flex items-baseline justify-between gap-2 mb-2 flex-wrap">
        <div className="me-eyebrow flex items-center gap-2">
          <i className="fa-solid fa-cube text-me-cyan"></i>
          <span>{bench.model_alias}</span>
        </div>
        <div className="font-mono text-[10px] text-me-fg-3">
          {window.BenchData.fmtDateOnly(bench.latest_timestamp)}
        </div>
      </div>

      <h3 className="font-display text-[14px] md:text-[16px] tracking-[0.08em] uppercase m-0 mb-3 text-me-fg break-words">
        {bench.title}
      </h3>

      {showHwPill && (
        <div className="mb-3">
          <span className="font-mono text-[10px] tracking-[0.1em] uppercase px-2 py-0.5 border border-me-cyan/40 text-me-cyan">
            {hw?.gpu_name ? window.BenchData.gpuShort(hw.gpu_name) : (bench.hardware_profile || "unknown")}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mb-3 font-mono text-[11px]">
        <div className="p-2 bg-white/[0.02] border border-me-border min-w-0">
          <div className="me-label">Capabilities</div>
          <div className="text-me-fg text-[14px] mt-0.5">{bench.cell_count}</div>
        </div>
        <div className="p-2 bg-white/[0.02] border border-me-border min-w-0">
          <div className="me-label">Runs</div>
          <div className="text-me-fg text-[14px] mt-0.5">{bench.run_count}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2">
        {cellPreview.map(c => (
          <span key={c.comparability_key}
                className="font-mono text-[10px] tracking-[0.06em] uppercase px-2 py-0.5 border border-me-border text-me-fg-2">
            {c.adapter.name}
          </span>
        ))}
        {overflow > 0 && <span className="font-mono text-[10px] text-me-fg-3 px-1.5 py-0.5">+{overflow}</span>}
      </div>

      {bench.suite_seconds != null && (
        <div className="flex items-center gap-1.5 mb-3 font-mono text-[10px] text-me-fg-3">
          <i className="fa-solid fa-stopwatch text-me-fg-3"></i>
          ≈ {window.BenchData.fmtDuration(bench.suite_seconds)} per full suite
        </div>
      )}

      <div className="w-full font-display text-[11px] tracking-[0.16em] uppercase px-3 py-2 border border-me-border text-me-fg-2 hover:text-me-fg hover:border-me-cyan hover:[box-shadow:inset_0_0_0_1px_var(--me-cyan-60)] transition-all text-center">
        Open <i className="fa-solid fa-arrow-right ml-1"></i>
      </div>
    </div>
  );
}

/* ---------- Leaderboards ---------- */
function LeaderboardsBlock({ leaderboards, onOpen }) {
  const [mode, setMode] = _hUseS("auto"); // "auto" | "user"
  // Subscribe to ratings changes so toggling to "user" reflects the latest
  // localStorage state without a manual refresh.
  const [, bump] = _hUseS(0);
  React.useEffect(() => window.BenchRatings.subscribe(() => bump(v => v + 1)), []);

  const adapterNames = leaderboards._adapterNames || Object.keys(leaderboards.perAdapter || {});
  const loaded = leaderboards._loadedBenches || [];

  const blocks = [];
  // Top tok/s — always auto, no user-rating equivalent.
  if (leaderboards.tps && leaderboards.tps.length > 1) {
    blocks.push({
      id: "tps",
      icon: "fa-bolt",
      title: "Top tok/s",
      sub: "any capability",
      rows: leaderboards.tps.slice(0, 5),
      fmt: r => window.BenchData.fmtTps(r.value),
    });
  }
  // Per-adapter quality leaderboards — switch between auto and user mode.
  for (const adapter of adapterNames) {
    const rows = mode === "user"
      ? window.BenchData.rankCellsByUser(loaded, adapter)
      : (leaderboards.perAdapter || {})[adapter] || [];
    if (!rows || rows.length < 2) continue;
    blocks.push({
      id: `q-${adapter}-${mode}`,
      icon: "fa-list-check",
      title: `Top ${adapter}`,
      sub: mode === "user" ? "your rating" : "quality",
      rows: rows.slice(0, 5),
      fmt: mode === "user"
        ? r => `${r.userMean.toFixed(1)}/5`
        : r => `${Number(r.value).toFixed(1)}%`,
      sublineFor: mode === "user"
        ? r => `${r.adapter?.name || "—"} · ${r.userCount}/${r.userTotal} rated`
        : r => `${r.adapter?.name || "—"} · ${r.hardwareProfile}`,
    });
  }
  // No quality blocks at all? Don't render anything (the toggle would be lonely).
  const hasQualityBlocks = blocks.some(b => b.id.startsWith("q-"));
  if (!blocks.length) return null;
  return (
    <div className="flex flex-col gap-3">
      {hasQualityBlocks && (
        <div className="flex items-center gap-2">
          <Label>Quality source</Label>
          <Chip on={mode === "auto"} cyan={mode === "auto"} onClick={() => setMode("auto")}>Auto</Chip>
          <Chip on={mode === "user"} cyan={mode === "user"} onClick={() => setMode("user")}>You</Chip>
        </div>
      )}
      {blocks.map(b => (
        <div key={b.id} className="me-card p-4 md:p-5">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="font-display text-[12px] tracking-[0.18em] uppercase m-0 text-me-fg">
              <i className={`fa-solid ${b.icon} text-me-warning mr-2`}></i> {b.title}
            </h3>
            <span className="font-mono text-[10px] text-me-fg-3">{b.sub}</span>
          </div>
          <div className="flex flex-col gap-1">
            {b.rows.map((r, i) => (
              <button
                key={`${r.benchId}-${r.adapter?.name || ""}-${r.comparabilityPrefix || i}`}
                onClick={() => onOpen(r.benchId)}
                className="grid grid-cols-[18px_1fr_70px] gap-2 items-center text-[11px] font-mono text-left bg-transparent border-0 px-1 py-0.5 cursor-pointer hover:text-me-fg">
                <span className={`text-[10px] ${i < 3 ? "text-me-warning" : "text-me-fg-3"}`}>{i + 1}</span>
                <div className="min-w-0">
                  <div className="text-me-fg truncate" title={r.benchTitle}>{r.modelAlias}</div>
                  <div className="text-me-fg-3 text-[10px] truncate">
                    {b.sublineFor ? b.sublineFor(r) : `${r.adapter?.name || "—"} · ${r.hardwareProfile}`}
                  </div>
                </div>
                <div className="text-right text-me-cyan">{b.fmt(r)}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RatingsImportExportCard() {
  const fileRef = React.useRef(null);
  const [msg, setMsg] = _hUseS(null);
  const onExport = () => {
    const blob = new Blob([window.BenchRatings.exportAll()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bench-ratings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setMsg("exported");
    setTimeout(() => setMsg(null), 2000);
  };
  const onImportClick = () => fileRef.current?.click();
  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const n = window.BenchRatings.importAll(text);
    setMsg(n > 0 ? `imported ${n}` : "no ratings imported");
    setTimeout(() => setMsg(null), 3000);
    e.target.value = "";  // allow re-picking same file
  };
  return (
    <div className="me-card p-4 md:p-5">
      <h3 className="font-display text-[12px] tracking-[0.18em] uppercase m-0 mb-3 text-me-fg">
        <i className="fa-solid fa-star text-me-warning mr-2"></i> Your ratings
      </h3>
      <p className="font-mono text-[11px] text-me-fg-3 mb-3">
        Manual ratings are stored locally per browser. Export to share between machines or commit to the repo.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onExport}
          className="px-3 py-1.5 border border-me-border font-mono text-[11px] tracking-[0.06em] text-me-fg-2 hover:text-me-fg hover:border-me-border-strong bg-transparent cursor-pointer">
          Export
        </button>
        <button
          onClick={onImportClick}
          className="px-3 py-1.5 border border-me-border font-mono text-[11px] tracking-[0.06em] text-me-fg-2 hover:text-me-fg hover:border-me-border-strong bg-transparent cursor-pointer">
          Import
        </button>
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={onImportFile} />
        {msg && <span className="font-mono text-[11px] text-me-cyan self-center">{msg}</span>}
      </div>
    </div>
  );
}

function ProfilesSnapshotCard({ snapshot }) {
  const profiles = snapshot.profiles || [];
  const providers = snapshot.providers || [];
  if (!profiles.length && !providers.length) return null;
  return (
    <div className="me-card p-4 md:p-5">
      <h3 className="font-display text-[12px] tracking-[0.18em] uppercase m-0 mb-3 text-me-fg">
        <i className="fa-solid fa-folder-tree text-me-cyan mr-2"></i> Config snapshot
      </h3>
      <div className="grid grid-cols-2 gap-2 mb-3 font-mono text-[11px]">
        <div className="p-2 bg-white/[0.02] border border-me-border">
          <div className="me-label">Profiles</div>
          <div className="text-me-fg text-[14px] mt-0.5">{profiles.length}</div>
        </div>
        <div className="p-2 bg-white/[0.02] border border-me-border">
          <div className="me-label">Providers</div>
          <div className="text-me-fg text-[14px] mt-0.5">{providers.length}</div>
        </div>
      </div>
      <div className="font-mono text-[10px] text-me-fg-3 break-all">
        {profiles.slice(0, 8).map(p => p.name).join(" · ")}
        {profiles.length > 8 && ` · +${profiles.length - 8}`}
      </div>
    </div>
  );
}

function NextStepsCard() {
  return (
    <div className="me-card p-4 md:p-5">
      <h3 className="font-display text-[12px] tracking-[0.18em] uppercase m-0 mb-3 text-me-fg">
        <i className="fa-solid fa-circle-info text-me-cyan mr-2"></i> Add a capability
      </h3>
      <div className="text-[12px] text-me-fg-2 leading-relaxed">
        Run another adapter against an existing model and a new cell appears on its bench card. Re-run an adapter and the cell keeps its history.
      </div>
      <pre className="font-mono text-[11px] text-me-cyan mt-3 whitespace-pre-wrap">
{`just bench-run mmlu profile=qwen36-27b
just bench-run gsm8k profile=qwen36-27b`}
      </pre>
    </div>
  );
}

Object.assign(window, { HomePage });
