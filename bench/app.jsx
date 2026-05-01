/* ============================================================
   app.jsx — Hub SPA shell.
   Hash routing:
     #/                   → home
     #/run/<id>           → report (Summary tab)
     #/run/<id>/<tab>     → report, specific tab
   ============================================================ */

const { useState: useS, useEffect: useE, useMemo: useM, useCallback: useC } = React;

function parseHash(h) {
  const s = (h || "").replace(/^#\/?/, "");
  if (!s) return { view: "home" };
  const parts = s.split("/").filter(Boolean);
  if (parts[0] === "run" && parts[1]) {
    return { view: "report", id: decodeURIComponent(parts[1]), tab: parts[2] || "summary" };
  }
  return { view: "home" };
}

function buildHash(route) {
  if (route.view === "home") return "#/";
  if (route.view === "report") return `#/run/${encodeURIComponent(route.id)}/${route.tab || "summary"}`;
  return "#/";
}

function App() {
  const [route, setRoute] = useS(() => parseHash(location.hash));
  const [reports, setReports] = useS([]);  // [{id, meta, dataset, source, ...}]
  const [activeReport, setActiveReport] = useS(null);
  const [activeProfiles, setActiveProfiles] = useS(null);
  const [drawerOpen, setDrawerOpen] = useS(false);
  const [error, setError] = useS(null);

  /* ---- Hash routing ---- */
  useE(() => {
    const onHash = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function navigate(r) {
    location.hash = buildHash(r);
    setDrawerOpen(false);
    window.scrollTo({top: 0, behavior: "instant"});
  }

  /* ---- Initial load: bundled registry + localStorage runs ---- */
  const refresh = useC(async () => {
    const reg = await window.BenchData.loadRegistry();
    const bundled = await Promise.all((reg.reports || []).map(async id => {
      try { return await window.BenchData.loadReportSummary(id); }
      catch (e) { return null; }
    }));
    const local = window.BenchData.listMyRuns().map(r => {
      try {
        const ds = window.BenchData.loadMyRunDataset(r.id);
        return ds ? { id: r.id, meta: r.meta, dataset: ds.dataset, source: "local" } : null;
      } catch { return null; }
    });
    setReports([...bundled, ...local].filter(Boolean));
  }, []);

  useE(() => { refresh(); }, [refresh]);

  /* ---- Active report load on route change ---- */
  useE(() => {
    if (route.view !== "report") { setActiveReport(null); setActiveProfiles(null); return; }
    setError(null);

    (async () => {
      // Find in already-loaded reports
      let r = reports.find(x => x.id === route.id);
      if (!r) {
        // Try bundled fetch
        try { r = await window.BenchData.loadReportSummary(route.id); }
        catch { r = window.BenchData.loadMyRunDataset(route.id); }
        if (!r) { setError(`Run not found: ${route.id}`); return; }
      }
      setActiveReport(r);

      // Load profile .conf files (bundled) or use embedded confs (local)
      if (r.source === "local") {
        const ds = window.BenchData.loadMyRunDataset(r.id);
        setActiveProfiles({ confs: ds.confs, bundle: ds.bundle });
      } else {
        const profiles = await window.BenchData.loadProfilesForReport(r);
        setActiveProfiles(profiles);
      }
    })();
  }, [route.view, route.id, reports]);

  /* ---- Tabs (only in report view) ---- */
  const tabs = [
    ["summary", "Summary"],
    ["profiles", "Profiles"],
    ["prompts", "Prompts"],
    ["configs", "Configs"],
    ["guide", "Guide"],
    ["methodology", "Methodology"],
  ];

  const inReport = route.view === "report" && activeReport;

  /* ---- Build copy + recommendations only when active report ready ---- */
  const copy = useM(() => inReport && activeReport.dataset ? window.BenchData.generateNarrative(activeReport.dataset, activeReport.meta) : null, [activeReport]);
  const recs = useM(() => inReport && activeReport.dataset && copy ? window.BenchData.generateRecommendations(activeReport.dataset, copy) : [], [activeReport, copy]);

  return (
    <>
      <nav className="sticky top-0 z-50 h-14 bg-me-bg/85 backdrop-blur border-b border-me-border flex items-center px-4 nav:px-8 gap-3 nav:gap-6">
        <a href="#/" onClick={(e) => { e.preventDefault(); navigate({view:"home"}); }}
           className="nav-logo text-[18px] nav:text-[22px] tracking-[0.08em] uppercase select-none flex-shrink-0 cursor-pointer">
          Meese · Bench
        </a>

        {inReport && (
          <span className="hidden md:inline-flex items-center gap-2 ml-1 font-mono text-[11px] text-me-fg-3 max-w-[40ch] truncate" title={activeReport.meta.title}>
            <i className="fa-solid fa-chevron-right text-[8px]"></i>
            <span className="text-me-fg-2 truncate">{activeReport.meta.title || activeReport.meta.id}</span>
          </span>
        )}

        <button className="nav:hidden ml-auto w-9 h-8 inline-flex items-center justify-center border border-me-border text-me-fg hover:border-me-magenta-60 transition-colors text-sm"
                aria-label="Menu" onClick={() => setDrawerOpen(d => !d)}>
          <i className="fa-solid fa-bars"></i>
        </button>

        {inReport ? (
          <div className={`${drawerOpen ? "flex" : "hidden"} nav:flex nav:ml-auto nav:gap-1 nav:static fixed top-14 left-0 right-0 flex-col nav:flex-row bg-me-bg/95 nav:bg-transparent backdrop-blur nav:backdrop-blur-0 border-b border-me-border nav:border-0 p-2 nav:p-0`}>
            {tabs.map(([k, label]) => (
              <button key={k}
                      onClick={() => navigate({view:"report", id: route.id, tab: k})}
                      className={`nav-tab relative bg-transparent border-0 font-display text-[12px] tracking-[0.18em] uppercase px-3.5 py-2.5 nav:py-2 cursor-pointer text-left nav:text-center w-full nav:w-auto border-b nav:border-b-0 border-me-border transition-colors hover:text-me-fg ${route.tab === k ? "active text-me-fg" : "text-me-fg-2"}`}>
                {label}
              </button>
            ))}
            <button onClick={() => navigate({view:"home"})}
                    className="nav:ml-2 px-3.5 py-2.5 nav:py-1.5 font-mono text-[10px] tracking-[0.18em] uppercase text-me-fg-3 border border-me-border hover:text-me-fg hover:border-me-border-strong transition-colors text-left nav:text-center">
              <i className="fa-solid fa-arrow-left mr-1.5"></i> All runs
            </button>
          </div>
        ) : (
          <div className="hidden nav:flex ml-auto items-center gap-3 font-mono text-[11px] text-me-fg-3">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-me-success [box-shadow:0_0_6px_var(--me-success)]"></span>
            {reports.length} run{reports.length === 1 ? "" : "s"} loaded
          </div>
        )}
      </nav>

      <div className="max-w-[1366px] mx-auto px-4 md:px-8 pt-6 md:pt-10 pb-24">
        {error && (
          <div className="border border-me-danger bg-me-danger/10 p-4 mb-6 font-mono text-[12px] text-me-danger">
            <strong>{error}</strong>
            <div className="mt-2"><a href="#/" onClick={(e) => { e.preventDefault(); navigate({view:"home"}); }}>← Back to home</a></div>
          </div>
        )}

        {route.view === "home" && (
          <HomePage reports={reports}
                    onOpen={(id) => navigate({view:"report", id, tab:"summary"})}
                    onRefresh={refresh} />
        )}

        {inReport && activeReport.dataset && copy && (
          <>
            <div style={{display: route.tab === "summary" ? "block" : "none"}}>
              <SummarySection data={activeReport.dataset} meta={activeReport.meta} copy={copy} recommendations={recs} />
            </div>
            <div style={{display: route.tab === "profiles" ? "block" : "none"}}>
              <ProfilesSection data={activeReport.dataset} meta={activeReport.meta} profiles={activeProfiles} />
            </div>
            <div style={{display: route.tab === "prompts" ? "block" : "none"}}>
              <PromptsSection data={activeReport.dataset} />
            </div>
            <div style={{display: route.tab === "configs" ? "block" : "none"}}>
              <ConfigsSection data={activeReport.dataset} profiles={activeProfiles} />
            </div>
            <div style={{display: route.tab === "guide" ? "block" : "none"}}>
              <GuideSection profiles={activeProfiles} />
            </div>
            <div style={{display: route.tab === "methodology" ? "block" : "none"}}>
              <MethodologySection copy={copy} />
            </div>
          </>
        )}

        {inReport && !activeReport.dataset && (
          <div className="border border-me-danger bg-me-danger/10 p-4 font-mono text-[12px] text-me-danger">
            Run loaded but contains no parseable data.
          </div>
        )}

        {route.view === "report" && !activeReport && !error && (
          <div className="border border-me-border bg-me-bg-alt p-8 text-center font-mono text-me-fg-3">
            <i className="fa-solid fa-spinner fa-spin mr-2"></i> Loading run…
          </div>
        )}

        <footer className="mt-16 pt-6 border-t border-me-border font-mono text-[10px] md:text-[11px] text-me-fg-3 text-center tracking-wider">
          <span className="font-logo tracking-wider text-me-fg-2">MEESE · ENTERPRISES</span>
          &nbsp;//&nbsp; benchmark hub v1 &nbsp;//&nbsp;
          <a href="#" onClick={e => { e.preventDefault(); navigator.clipboard.writeText(location.href); }}>copy permalink</a>
        </footer>
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
