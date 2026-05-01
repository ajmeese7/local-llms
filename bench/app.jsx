/* ============================================================
   app.jsx
   v2 hub shell. Hash routing:
     #/                 home (run list)
     #/run/<id>         run detail
   ============================================================ */

const { useState: useS, useEffect: useE, useCallback: useC } = React;

function parseHash(h) {
  const s = (h || "").replace(/^#\/?/, "");
  if (!s) return { view: "home" };
  const parts = s.split("/").filter(Boolean);
  if (parts[0] === "run" && parts[1]) {
    return { view: "run", id: decodeURIComponent(parts[1]) };
  }
  return { view: "home" };
}

function buildHash(route) {
  if (route.view === "run") return `#/run/${encodeURIComponent(route.id)}`;
  return "#/";
}

function App() {
  const [route, setRoute] = useS(() => parseHash(location.hash));
  const [reports, setReports] = useS([]);
  const [generatedAt, setGeneratedAt] = useS(null);
  const [activeRun, setActiveRun] = useS(null);
  const [loading, setLoading] = useS(false);
  const [error, setError] = useS(null);

  useE(() => {
    const onHash = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function navigate(r) {
    location.hash = buildHash(r);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  const refresh = useC(async () => {
    const reg = await window.BenchData.loadIndex();
    setReports(reg.reports || []);
    setGeneratedAt(reg.generated_at || null);
  }, []);

  useE(() => { refresh(); }, [refresh]);

  useE(() => {
    if (route.view !== "run") {
      setActiveRun(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      const run = await window.BenchData.loadRun(route.id);
      if (!run) {
        setError(`Run not found: ${route.id}`);
        setActiveRun(null);
      } else {
        setActiveRun(run);
      }
      setLoading(false);
    })();
  }, [route.view, route.id]);

  return (
    <>
      <nav className="sticky top-0 z-50 h-14 bg-me-bg/85 backdrop-blur border-b border-me-border flex items-center px-4 nav:px-8 gap-3">
        <a
          href="#/"
          onClick={(e) => { e.preventDefault(); navigate({ view: "home" }); }}
          className="nav-logo text-[18px] nav:text-[22px] tracking-[0.08em] uppercase select-none cursor-pointer">
          local-llms · bench
        </a>
        <div className="ml-auto font-mono text-[11px] text-me-fg-3 flex items-center gap-3">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-me-success [box-shadow:0_0_6px_var(--me-success)]"></span>
          {reports.length} run{reports.length === 1 ? "" : "s"}
        </div>
      </nav>

      <div className="max-w-[1366px] mx-auto px-4 md:px-8 pt-6 md:pt-10 pb-24">
        {error && (
          <div className="border border-me-danger bg-me-danger/10 p-4 mb-6 font-mono text-[12px] text-me-danger">
            <strong>{error}</strong>
            <div className="mt-2"><a href="#/" onClick={(e) => { e.preventDefault(); navigate({ view: "home" }); }}>back to home</a></div>
          </div>
        )}

        {route.view === "home" && (
          <HomePage
            reports={reports}
            generatedAt={generatedAt}
            onOpen={(id) => navigate({ view: "run", id })}
            onRefresh={refresh} />
        )}

        {route.view === "run" && loading && (
          <div className="me-card p-8 text-center font-mono text-me-fg-3">
            <i className="fa-solid fa-spinner fa-spin mr-2"></i> loading run...
          </div>
        )}

        {route.view === "run" && activeRun && !loading && (
          <RunDetail run={activeRun} onBack={() => navigate({ view: "home" })} />
        )}

        <footer className="mt-16 pt-6 border-t border-me-border font-mono text-[10px] md:text-[11px] text-me-fg-3 text-center tracking-wider">
          local-llms hub · v2 schema
        </footer>
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
