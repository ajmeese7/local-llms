/* ============================================================
   app.jsx — Hub SPA shell.
   Hash routing:
     #/                                    → home
     #/bench/<id>                          → bench overview
     #/bench/<id>/prompts/<adapter>        → prompts drilldown for a capability
     #/bench/<id>/config                   → model profile config
     #/methodology                         → top-level methodology page
   A `bench` is one (hardware_profile, model_profile) pair.
   data.jsx#findBench tolerates renames/legacy ids gracefully.
   ============================================================ */

const { useState: useS, useEffect: useE, useMemo: useM, useCallback: useC } = React;

function parseHash(h) {
  const s = (h || "").replace(/^#\/?/, "");
  if (!s) return { view: "home" };
  const parts = s.split("/").filter(Boolean);
  if (parts[0] === "bench" && parts[1]) {
    const id = decodeURIComponent(parts[1]);
    if (parts[2] === "prompts" && parts[3]) {
      return { view: "bench", id, tab: "prompts", adapter: decodeURIComponent(parts[3]) };
    }
    if (parts[2] === "config") {
      return { view: "bench", id, tab: "config" };
    }
    return { view: "bench", id, tab: "overview" };
  }
  if (parts[0] === "methodology") return { view: "methodology" };
  return { view: "home" };
}

function buildHash(route) {
  if (route.view === "bench") {
    if (route.tab === "prompts" && route.adapter) {
      return `#/bench/${encodeURIComponent(route.id)}/prompts/${encodeURIComponent(route.adapter)}`;
    }
    if (route.tab === "config") {
      return `#/bench/${encodeURIComponent(route.id)}/config`;
    }
    return `#/bench/${encodeURIComponent(route.id)}`;
  }
  if (route.view === "methodology") return "#/methodology";
  return "#/";
}

function App() {
  const [route, setRoute] = useS(() => parseHash(location.hash));
  const [index, setIndex] = useS(null);
  const [profilesSnap, setProfilesSnap] = useS(null);
  const [active, setActive] = useS(null);            // { bench, meta, cells }
  const [leaderboards, setLeaderboards] = useS(null);
  const [drawerOpen, setDrawerOpen] = useS(false);
  const [error, setError] = useS(null);
  const [loading, setLoading] = useS(false);

  useE(() => {
    const onHash = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function navigate(r) {
    location.hash = buildHash(r);
    setDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  const refresh = useC(async () => {
    const [idx, snap] = await Promise.all([
      window.BenchData.loadIndex(),
      window.BenchData.loadProfilesSnapshot(),
    ]);
    setIndex(idx);
    setProfilesSnap(snap);
  }, []);
  useE(() => { refresh(); }, [refresh]);

  // On first load, merge any repo-committed ratings into localStorage. Merge
  // strategy (not overwrite) means local edits made since the last commit
  // stay intact; new ratings from a colleague's commit show up.
  useE(() => {
    let cancelled = false;
    (async () => {
      const n = await window.BenchRatings.loadFromRepo("merge");
      if (!cancelled && n > 0) console.info(`bench: seeded ${n} ratings from bench/reports/ratings.json`);
    })();
    return () => { cancelled = true; };
  }, []);

  // Lazy-load leaderboards once we have an index (so home + bench both can use them).
  useE(() => {
    let cancelled = false;
    if (!index) { setLeaderboards(null); return; }
    (async () => {
      const lb = await window.BenchData.loadLeaderboards(index);
      if (!cancelled) setLeaderboards(lb);
    })();
    return () => { cancelled = true; };
  }, [index]);

  useE(() => {
    if (route.view !== "bench") {
      setActive(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setError(null);
    setLoading(true);
    (async () => {
      const loaded = await window.BenchData.loadBench(route.id);
      if (cancelled) return;
      if (!loaded) {
        setError(`Bench not found: ${route.id}`);
        setActive(null);
        setLoading(false);
        return;
      }
      setActive(loaded);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [route.view, route.id]);

  const inBench = route.view === "bench" && active;

  const tabs = useM(() => {
    if (!inBench) return [];
    return [
      { key: "overview", label: "Overview", kind: "overview" },
      { key: "config", label: "Config", kind: "config" },
    ];
  }, [active, inBench]);

  const currentTab = useM(() => {
    if (!inBench) return null;
    // Prompts drilldown still highlights Overview in the topbar; the cell row owns capability-switching.
    if (route.tab === "prompts") return "overview";
    return route.tab;
  }, [route, inBench]);

  return (
    <>
      <nav className="sticky top-0 z-50 h-14 bg-me-bg/85 backdrop-blur border-b border-me-border flex items-center px-4 nav:px-8 gap-3 nav:gap-6">
        <a
          href="#/"
          onClick={(e) => { e.preventDefault(); navigate({ view: "home" }); }}
          className="nav-logo text-[18px] nav:text-[22px] tracking-[0.08em] uppercase select-none flex-shrink-0 cursor-pointer">
          Meese · Bench
        </a>

        {inBench && (
          <span
            className="hidden md:inline-flex items-center gap-2 ml-1 font-mono text-[11px] text-me-fg-3 max-w-[40ch] truncate"
            title={active.meta.title}>
            <i className="fa-solid fa-chevron-right text-[8px]"></i>
            <span className="text-me-fg-2 truncate">{active.meta.title}</span>
          </span>
        )}

        <button
          className="nav:hidden ml-auto w-9 h-8 inline-flex items-center justify-center border border-me-border text-me-fg hover:border-me-magenta-60 transition-colors text-sm"
          aria-label="Menu"
          onClick={() => setDrawerOpen(d => !d)}>
          <i className="fa-solid fa-bars"></i>
        </button>

        {inBench ? (
          <div className={`${drawerOpen ? "flex" : "hidden"} nav:flex nav:ml-auto nav:gap-1 nav:static fixed top-14 left-0 right-0 flex-col nav:flex-row bg-me-bg/95 nav:bg-transparent backdrop-blur nav:backdrop-blur-0 border-b border-me-border nav:border-0 p-2 nav:p-0`}>
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => navigate({ view: "bench", id: route.id, tab: t.kind === "overview" ? "overview" : t.key })}
                className={`nav-tab relative bg-transparent border-0 font-display text-[12px] tracking-[0.18em] uppercase px-3.5 py-2.5 nav:py-2 cursor-pointer text-left nav:text-center w-full nav:w-auto border-b nav:border-b-0 border-me-border transition-colors hover:text-me-fg ${currentTab === t.key ? "active text-me-fg" : "text-me-fg-2"}`}>
                {t.label}
              </button>
            ))}
            <button
              onClick={() => navigate({ view: "home" })}
              className="nav:ml-2 px-3.5 py-2.5 nav:py-1.5 font-mono text-[10px] tracking-[0.18em] uppercase text-me-fg-3 border border-me-border hover:text-me-fg hover:border-me-border-strong transition-colors text-left nav:text-center">
              <i className="fa-solid fa-arrow-left mr-1.5"></i> All benches
            </button>
          </div>
        ) : (
          <div className="hidden nav:flex ml-auto items-center gap-4 font-mono text-[11px] text-me-fg-3">
            <a href="#/methodology" onClick={(e) => { e.preventDefault(); navigate({ view: "methodology" }); }}
               className={`tracking-[0.16em] uppercase ${route.view === "methodology" ? "text-me-fg" : "text-me-fg-2 hover:text-me-fg"}`}>
              Methodology
            </a>
            {route.view === "methodology" && (
              <button
                onClick={() => navigate({ view: "home" })}
                className="px-3 py-1.5 font-mono text-[10px] tracking-[0.18em] uppercase text-me-fg-3 border border-me-border hover:text-me-fg hover:border-me-border-strong transition-colors">
                <i className="fa-solid fa-arrow-left mr-1.5"></i> All benches
              </button>
            )}
            {route.view !== "methodology" && (
              <>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-me-success [box-shadow:0_0_6px_var(--me-success)]"></span>
                {(index?.benches?.length || 0)} bench{(index?.benches?.length || 0) === 1 ? "" : "es"} · {(index?.reports?.length || 0)} run{(index?.reports?.length || 0) === 1 ? "" : "s"}
              </>
            )}
          </div>
        )}
      </nav>

      <div className="max-w-[1366px] mx-auto px-4 md:px-8 pt-6 md:pt-10 pb-24 min-h-screen">
        {error && (
          <div className="border border-me-danger bg-me-danger/10 p-4 mb-6 font-mono text-[12px] text-me-danger">
            <strong>{error}</strong>
            <div className="mt-2">
              <a href="#/" onClick={(e) => { e.preventDefault(); navigate({ view: "home" }); }}>← Back to home</a>
            </div>
          </div>
        )}

        {route.view === "home" && (
          <HomePage
            index={index}
            profilesSnap={profilesSnap}
            leaderboards={leaderboards}
            onOpen={(id) => navigate({ view: "bench", id, tab: "overview" })} />
        )}

        {route.view === "methodology" && (
          <MethodologyPage profilesSnap={profilesSnap} />
        )}

        {inBench && (
          <>
            {route.tab === "overview" && (
              <OverviewSection
                bench={active}
                leaderboards={leaderboards}
                onOpenPrompts={(adapter) => navigate({ view: "bench", id: route.id, tab: "prompts", adapter })} />
            )}
            {route.tab === "prompts" && route.adapter && (
              <PromptsSection
                bench={active}
                adapterName={route.adapter}
                onSwitch={(adapter) => navigate({ view: "bench", id: route.id, tab: "prompts", adapter })} />
            )}
            {route.tab === "config" && (
              <ConfigSection bench={active} profilesSnap={profilesSnap} />
            )}
          </>
        )}

        {route.view === "bench" && !active && !error && (
          <div className="border border-me-border bg-me-bg-alt p-8 text-center font-mono text-me-fg-3">
            <i className="fa-solid fa-spinner fa-spin mr-2"></i>
            {loading ? "Loading bench…" : "Resolving bench…"}
          </div>
        )}

        <footer className="mt-16 pt-6 border-t border-me-border font-mono text-[10px] md:text-[11px] text-me-fg-3 text-center tracking-wider">
          <span className="font-logo tracking-wider text-me-fg-2">MEESE · ENTERPRISES</span>
          &nbsp;//&nbsp; benchmark hub v2 &nbsp;//&nbsp;
          <a href="#/methodology" onClick={(e) => { e.preventDefault(); navigate({ view: "methodology" }); }}>methodology</a>
          &nbsp;//&nbsp;
          <a href="#" onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(location.href); }}>copy permalink</a>
        </footer>
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
