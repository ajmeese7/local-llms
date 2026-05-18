/* ============================================================
   home.jsx — Hub home.

   Flat bench grid by default (one card per (hardware, model, backend)).
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

  // Loaded benches (with cell.run.results) are eagerly fetched for the
  // leaderboards block. Reuse them here so each BenchCard can roll up the
  // per-prompt rating aggregate without firing its own fetch.
  const loadedById = _hUseM(() => {
    const m = new Map();
    for (const lb of (leaderboards?._loadedBenches || [])) m.set(lb.bench.id, lb);
    return m;
  }, [leaderboards]);

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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {visible.map(b => (
              <BenchCard
                key={b.id}
                bench={b}
                loaded={loadedById.get(b.id) || null}
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
        // one card per (hardware, model, backend). each card carries every capability you've thrown at it.
      </p>
      <FastAnswerTrackNote />
    </div>
  );
}

// Banner explaining the global enable_thinking=false setting. Dismissable
// per-browser via localStorage so returning users aren't stuck reading it
// every time. The state key is namespaced so it can be reset by clearing
// `bench:dismissed:fast-answer-track`.
const FAST_ANSWER_DISMISS_KEY = "bench:dismissed:fast-answer-track";

function FastAnswerTrackNote() {
  const [dismissed, setDismissed] = _hUseS(() => {
    try { return localStorage.getItem(FAST_ANSWER_DISMISS_KEY) === "1"; }
    catch { return false; }
  });
  if (dismissed) return null;
  const onDismiss = (e) => {
    e.stopPropagation();
    try { localStorage.setItem(FAST_ANSWER_DISMISS_KEY, "1"); } catch { /* quota / privacy */ }
    setDismissed(true);
  };
  return (
    <div className="mt-4 max-w-[80ch] p-3 pr-9 border border-me-warning/40 bg-me-warning/5 font-mono text-[12px] text-me-fg-2 relative">
      <span className="text-me-warning font-bold">FAST-ANSWER TRACK · </span>
      scores are recorded with <code className="text-me-cyan">enable_thinking=false</code> so adapters with tight token budgets (mmlu, niah) do not get starved by hidden reasoning. A separate reasoning-on track is planned; expect Qwen3-family numbers to shift materially when it lands. See <code className="text-me-cyan">docs/ROADMAP.md</code>.
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss fast-answer track note"
        title="Dismiss"
        className="absolute top-1.5 right-1.5 w-6 h-6 inline-flex items-center justify-center text-me-fg-3 hover:text-me-fg hover:bg-white/[0.04] border border-transparent hover:border-me-border transition-colors">
        <i className="fa-solid fa-xmark text-[12px]"></i>
      </button>
    </div>
  );
}

function BenchCard({ bench, loaded, onOpen }) {
  const hw = bench.hardware;
  const gpu = hw?.gpu_name ? window.BenchData.gpuShort(hw.gpu_name) : (bench.hardware_profile || null);
  const engine = bench.server_engine || bench.server?.engine || null;
  const cellPreview = (bench.cells || []).slice(0, 6);
  const overflow = (bench.cells || []).length - cellPreview.length;

  // Subscribe to rating writes so this card refreshes when the user edits
  // a bench note or prompt rating elsewhere in the SPA.
  const [ratingsVersion, setRatingsVersion] = _hUseS(0);
  React.useEffect(
    () => window.BenchRatings.subscribe(() => setRatingsVersion(v => v + 1)),
    [],
  );
  const note = _hUseM(
    () => window.BenchRatings.readBenchNote(bench.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bench.id, ratingsVersion],
  );
  // Per-prompt aggregate over every rated item in every *rateable* cell of
  // this bench. Objective adapters (mmlu, gsm8k, niah) are excluded: their
  // outputs are right/wrong, not subjective, so a star rating is nonsense
  // and including them dilutes the count. Requires `loaded` because results
  // are not in the registry index; until leaderboards finish loading the
  // row stays in its initial state rather than flashing in.
  const promptAgg = _hUseM(() => {
    if (!loaded) return { mean: null, count: 0, total: 0 };
    let sum = 0, count = 0, total = 0;
    for (const c of loaded.cells || []) {
      if (!window.BenchData.isRateableAdapter(c.adapter)) continue;
      const ids = (c.run?.results || []).map(r => r.item_id);
      total += ids.length;
      const agg = window.BenchRatings.aggregate(c.comparability_key, ids);
      if (agg.count > 0) {
        sum += agg.mean * agg.count;
        count += agg.count;
      }
    }
    return { mean: count > 0 ? sum / count : null, count, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, ratingsVersion]);

  return (
    <div
      className="me-card p-4 md:p-5 transition-all hover:-translate-y-0.5 hover:border-me-border-strong cursor-pointer"
      onClick={onOpen}
      role="button">
      <div className="flex items-baseline justify-between gap-2 mb-2 flex-wrap">
        <div className="me-eyebrow flex items-center gap-2">
          {gpu && gpu !== "unknown" && (
            <>
              <i className="fa-solid fa-microchip text-me-cyan text-[10px]"></i>
              <span>{gpu}</span>
            </>
          )}
          {gpu && gpu !== "unknown" && engine && <span className="text-me-fg-3">·</span>}
          {engine && (
            <>
              <i className="fa-solid fa-server text-me-magenta text-[10px]"></i>
              <span className="text-me-magenta">{engine}</span>
            </>
          )}
        </div>
        <div className="font-mono text-[10px] text-me-fg-3">
          {window.BenchData.fmtDateOnly(bench.latest_timestamp)}
        </div>
      </div>

      <h3 className="font-display text-[18px] md:text-[20px] tracking-[0.08em] uppercase m-0 mb-2 text-me-fg break-words">
        {bench.model_alias}
      </h3>

      <BenchCardRating note={note} promptAgg={promptAgg} />

      <div className="grid grid-cols-2 gap-2 mb-3 font-mono text-[11px]">
        <div className="p-2 bg-white/[0.02] border border-me-border min-w-0">
          <div className="me-label">Capabilities</div>
          <div className="text-me-fg text-[14px] mt-0.5">{bench.cell_count}</div>
        </div>
        <div className="p-2 bg-white/[0.02] border border-me-border min-w-0">
          <div className="me-label">Runs</div>
          <div className="text-me-fg text-[14px] mt-0.5">{bench.run_count}</div>
          {bench.partial_run_count > 0 && (
            <div className="font-mono text-[9px] tracking-[0.08em] uppercase text-me-fg-3 mt-1"
                 title="Subset re-runs aren't comparable to full runs, so they're counted separately.">
              + {bench.partial_run_count} partial
            </div>
          )}
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

// Compact rating row under the bench title on the home grid. Prefers the
// bench note (deliberate verdict); falls back to the per-prompt aggregate
// (empirical roll-up); shows "unrated" otherwise so cards stay vertically
// aligned in the grid instead of jumping.
function BenchCardRating({ note, promptAgg }) {
  const hasNote = note?.stars != null;
  const hasPromptAgg = promptAgg.count > 0 && Number.isFinite(promptAgg.mean);

  // Same pink `data-tip` on the stars in every branch (note, prompt
  // aggregate, unrated) so the hover UX is constant across cards.
  const ratedSummary = promptAgg.total > 0
    ? `${promptAgg.count}/${promptAgg.total} prompt${promptAgg.total === 1 ? "" : "s"} rated`
    : "no rateable prompts in this bench";

  if (!hasNote && !hasPromptAgg) {
    return (
      <div className="mb-3 flex items-center gap-2 font-mono text-[11px] text-me-fg-3"
           title="No bench note or prompt ratings yet. Open the bench to add one.">
        <span className="text-me-fg-3 cursor-help" data-tip={ratedSummary} aria-hidden="true">
          ☆☆☆☆☆
        </span>
        <span className="italic">unrated</span>
      </div>
    );
  }

  // Card root is `role="button"` with an onClick. Note text overflows into
  // a native `title` tooltip on the row so long notes don't push card height.
  const rowTooltip = hasNote ? (note.text || "Your overall rating for this bench") : undefined;
  return (
    <div className="mb-3 flex items-center gap-2 font-mono text-[11px] min-w-0" title={rowTooltip}>
      {hasNote ? (
        <>
          <span className="text-me-warning shrink-0 cursor-help"
                data-tip={ratedSummary}
                aria-label={`${note.stars} of 5 stars`}>
            {"★".repeat(note.stars)}
            <span className="text-me-fg-3">{"★".repeat(5 - note.stars)}</span>
          </span>
          <span className="text-me-fg shrink-0">{note.stars}/5</span>
          {note.text && (
            <span className="text-me-fg-3 italic truncate min-w-0">· {note.text}</span>
          )}
        </>
      ) : (
        <>
          <span className="text-me-warning shrink-0 cursor-help"
                data-tip={ratedSummary}
                aria-label={`${promptAgg.mean.toFixed(1)} of 5 stars`}>
            {"★".repeat(Math.round(promptAgg.mean))}
            <span className="text-me-fg-3">{"★".repeat(5 - Math.round(promptAgg.mean))}</span>
          </span>
          <span className="text-me-fg shrink-0">{promptAgg.mean.toFixed(1)}/5</span>
          <span className="text-me-fg-3 shrink-0">· {promptAgg.count}/{promptAgg.total} rated</span>
        </>
      )}
    </div>
  );
}

/* ---------- Leaderboards ---------- */
// Each per-adapter card owns its own Auto/You toggle (when the adapter is
// rateable). Keeps the toggle adjacent to the rows it controls instead of
// dangling at the top of the column like a global setting it isn't.
function LeaderboardsBlock({ leaderboards, onOpen }) {
  const adapterNames = leaderboards._adapterNames || Object.keys(leaderboards.perAdapter || {});
  const loaded = leaderboards._loadedBenches || [];

  const tpsRows = (leaderboards.tps && leaderboards.tps.length > 1)
    ? leaderboards.tps.slice(0, 5) : null;

  // Probe each adapter to see if either mode has anything renderable; used
  // only to decide whether to bail out of the whole block.
  const anyAdapterRenders = adapterNames.some(a => {
    const auto = (leaderboards.perAdapter || {})[a] || [];
    if (auto.length >= 2) return true;
    if (!window.BenchData.isRateableAdapter({ name: a })) return false;
    return (window.BenchData.rankCellsByUser(loaded, a) || []).length >= 2;
  });

  if (!tpsRows && !anyAdapterRenders) return null;
  return (
    <div className="flex flex-col gap-3">
      {tpsRows && (
        <LeaderboardCard
          icon="fa-bolt"
          title="Top tok/s"
          sub="any capability"
          rows={tpsRows}
          fmt={r => window.BenchData.fmtTps(r.value)}
          onOpen={onOpen} />
      )}
      {adapterNames.map(a => (
        <PerAdapterLeaderboardCard
          key={a}
          adapter={a}
          autoRows={(leaderboards.perAdapter || {})[a] || []}
          loaded={loaded}
          onOpen={onOpen} />
      ))}
    </div>
  );
}

// One per-adapter leaderboard with a self-contained Auto/You toggle when the
// adapter is rateable. Renders nothing when neither mode has enough rows so
// stale adapters don't crowd the column.
function PerAdapterLeaderboardCard({ adapter, autoRows, loaded, onOpen }) {
  const rateable = window.BenchData.isRateableAdapter({ name: adapter });
  const [mode, setMode] = _hUseS("auto");
  // Re-read user ratings when localStorage changes elsewhere in the SPA.
  const [, bump] = _hUseS(0);
  React.useEffect(() => window.BenchRatings.subscribe(() => bump(v => v + 1)), []);

  const userRows = rateable ? window.BenchData.rankCellsByUser(loaded, adapter) : [];
  const autoOk = (autoRows || []).length >= 2;
  const userOk = userRows.length >= 2;
  if (!autoOk && !userOk) return null;

  const showToggle = rateable && (autoOk || userOk);
  // When the inactive mode has no data we still let the user flip back, so
  // both chips stay clickable. The empty state explains what to do.
  const activeRows = mode === "user" ? userRows : autoRows;
  const fmt = mode === "user"
    ? r => `${r.userMean.toFixed(1)}/5`
    : r => `${Number(r.value).toFixed(1)}%`;
  const sublineFor = mode === "user"
    ? r => `${r.adapter?.name || "-"} · ${r.userCount}/${r.userTotal} rated`
    : r => `${r.adapter?.name || "-"} · ${r.hardwareProfile}`;

  return (
    <div className="me-card p-4 md:p-5">
      <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
        <h3 className="font-display text-[12px] tracking-[0.18em] uppercase m-0 text-me-fg">
          <i className="fa-solid fa-list-check text-me-warning mr-2"></i> Top {adapter}
        </h3>
        {showToggle ? (
          <div className="inline-flex items-center gap-1">
            <Chip on={mode === "auto"} cyan={mode === "auto"} onClick={() => setMode("auto")}>Auto</Chip>
            <Chip on={mode === "user"} cyan={mode === "user"} onClick={() => setMode("user")}>You</Chip>
          </div>
        ) : (
          <span className="font-mono text-[10px] text-me-fg-3">quality</span>
        )}
      </div>
      {activeRows.length < 2 ? (
        <div className="font-mono text-[11px] text-me-fg-3">
          {mode === "user"
            ? "Rate at least two cells in different benches to populate this list."
            : "Not enough auto-scored runs yet."}
        </div>
      ) : (
        <LeaderboardRows rows={activeRows.slice(0, 5)} fmt={fmt} sublineFor={sublineFor} onOpen={onOpen} />
      )}
    </div>
  );
}

// Plain (non-toggle) leaderboard card. Used for tok/s and anything else
// that has no per-user equivalent.
function LeaderboardCard({ icon, title, sub, rows, fmt, sublineFor, onOpen }) {
  return (
    <div className="me-card p-4 md:p-5">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-display text-[12px] tracking-[0.18em] uppercase m-0 text-me-fg">
          <i className={`fa-solid ${icon} text-me-warning mr-2`}></i> {title}
        </h3>
        <span className="font-mono text-[10px] text-me-fg-3">{sub}</span>
      </div>
      <LeaderboardRows rows={rows} fmt={fmt} sublineFor={sublineFor} onOpen={onOpen} />
    </div>
  );
}

function LeaderboardRows({ rows, fmt, sublineFor, onOpen }) {
  return (
    <div className="flex flex-col gap-1">
      {rows.map((r, i) => (
        <button
          key={`${r.benchId}-${r.adapter?.name || ""}-${r.comparabilityPrefix || i}`}
          onClick={() => onOpen(r.benchId)}
          className="grid grid-cols-[18px_1fr_70px] gap-2 items-center text-[11px] font-mono text-left bg-transparent border-0 px-1 py-0.5 cursor-pointer hover:text-me-fg">
          <span className={`text-[10px] ${i < 3 ? "text-me-warning" : "text-me-fg-3"}`}>{i + 1}</span>
          <div className="min-w-0">
            <div className="text-me-fg truncate" title={r.benchTitle}>{r.modelAlias}</div>
            <div className="text-me-fg-3 text-[10px] truncate">
              {sublineFor ? sublineFor(r) : `${r.adapter?.name || "-"} · ${r.hardwareProfile}`}
            </div>
          </div>
          <div className="text-right text-me-cyan">{fmt(r)}</div>
        </button>
      ))}
    </div>
  );
}

function RatingsImportExportCard() {
  const fileRef = React.useRef(null);
  const [msg, setMsg] = _hUseS(null);
  const flash = (m, ms = 2500) => { setMsg(m); setTimeout(() => setMsg(null), ms); };

  const onExport = () => {
    const blob = new Blob([window.BenchRatings.exportAll()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // Filename matches the repo's expected path so the user can drop it
    // straight into bench/reports/ on commit.
    a.download = "ratings.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    flash("exported as ratings.json");
  };
  const onImportClick = () => fileRef.current?.click();
  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const n = window.BenchRatings.importAll(text, "overwrite");
    flash(n > 0 ? `imported ${n}` : "no ratings imported");
    e.target.value = "";  // allow re-picking same file
  };
  const onReloadFromRepo = async () => {
    const n = await window.BenchRatings.loadFromRepo("overwrite");
    flash(
      n > 0
        ? `pulled ${n} entries from bench/reports/ratings.json`
        : "no ratings.json in bench/reports/",
      4000,
    );
  };

  return (
    <div className="me-card p-4 md:p-5">
      <h3 className="font-display text-[12px] tracking-[0.18em] uppercase m-0 mb-3 text-me-fg">
        <i className="fa-solid fa-star text-me-warning mr-2"></i> Your ratings
      </h3>
      <p className="font-mono text-[11px] text-me-fg-3 mb-3">
        Ratings are stored in your browser. Export saves <code>ratings.json</code>; drop it in <code>bench/reports/</code> and commit to sync across machines.
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
          Import file
        </button>
        <button
          onClick={onReloadFromRepo}
          title="Overwrite local ratings with bench/reports/ratings.json"
          className="px-3 py-1.5 border border-me-border font-mono text-[11px] tracking-[0.06em] text-me-fg-2 hover:text-me-fg hover:border-me-border-strong bg-transparent cursor-pointer">
          Reload from repo
        </button>
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={onImportFile} />
      </div>
      {msg && <div className="mt-2 font-mono text-[11px] text-me-cyan">{msg}</div>}
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
