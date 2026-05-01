/* ============================================================
   home.jsx — Hub home page.
   Hero (latest run) + recent runs grid + leaderboard + import.
   ============================================================ */

const { useState: _hUseS, useEffect: _hUseE, useMemo: _hUseM, useCallback: _hUseC, useRef: _hUseR } = React;

/* ---------- Date helpers ---------- */
function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function fmtRunId(id) {
  // Strip date suffix for display where the meta has a real title already.
  return id;
}

/* ---------- Sparkline component ---------- */
function Sparkline({ values, max, color = "var(--me-cyan)" }) {
  if (!values || !values.length) return null;
  const W = 80, H = 18;
  const m = max || Math.max(...values);
  const step = W / Math.max(values.length - 1, 1);
  const pts = values.map((v, i) => `${i * step},${H - (v / m) * H}`).join(" ");
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} />
      {values.map((v, i) => (
        <circle key={i} cx={i * step} cy={H - (v / m) * H} r="1.5" fill={color} />
      ))}
    </svg>
  );
}

/* ---------- Hero (latest run) ---------- */
function HomeHero({ report, onOpen }) {
  const d = report.dataset;
  if (!d) return null;
  const meta = report.meta;
  return (
    <div className="hero-bg relative overflow-hidden border border-me-border p-5 md:p-8 lg:p-9 mb-8">
      <div className="me-eyebrow flex flex-wrap gap-x-5 gap-y-2 mb-3">
        <span className="inline-flex items-center gap-1.5 text-me-magenta">
          <i className="fa-solid fa-circle-dot"></i> Latest run
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="fa-regular fa-calendar text-me-cyan"></i> {fmtDate(meta.date)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="fa-solid fa-microchip text-me-cyan"></i> {meta.hardware?.gpu || "—"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="fa-solid fa-server text-me-cyan"></i> {meta.server?.engine || "llama.cpp"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="fa-solid fa-list-check text-me-cyan"></i> {d.profiles.length} profiles · {d.totalRuns} runs
        </span>
      </div>
      <h1 className="hero-title my-2">{meta.title || meta.id}</h1>
      {meta.subtitle && (
        <p className="font-mono text-[13px] md:text-[15px] text-me-fg-2 mb-6 max-w-[80ch]">
          {meta.subtitle}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6 lg:gap-8 items-start">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <HeroStat label="Balanced" value={d.balanced.profile} sub={`${d.balanced.tps.toFixed(1)} tok/s · ${d.balanced.quality.toFixed(1)}%`} accent="magenta" />
          {d.fastest !== d.balanced && (
            <HeroStat label="Fastest" value={d.fastest.profile} sub={`${d.fastest.tps.toFixed(1)} tok/s`} accent="cyan" />
          )}
          <HeroStat label="Top quality" value={d.topQuality.profile} sub={`${d.topQuality.quality.toFixed(1)}%`} accent="warning" />
        </div>
        <div className="flex flex-col gap-2.5 lg:items-end">
          <button
            onClick={() => onOpen(meta.id)}
            className="font-display text-[13px] tracking-[0.16em] uppercase px-5 py-3 border border-me-magenta-60 text-me-fg bg-me-magenta/10 hover:bg-me-magenta/20 transition-all hover:[box-shadow:0_0_18px_rgba(214,0,255,0.4)]">
            Open report &nbsp;<i className="fa-solid fa-arrow-right"></i>
          </button>
          <div className="font-mono text-[10px] text-me-fg-3 lg:text-right">
            id: {meta.id}
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroStat({ label, value, sub, accent }) {
  const accentBorder = { magenta: "border-l-me-magenta", cyan: "border-l-me-cyan", warning: "border-l-me-warning" }[accent];
  const accentText = { magenta: "text-me-magenta", cyan: "text-me-cyan", warning: "text-me-warning" }[accent];
  return (
    <div className={`bg-me-bg-alt/60 border border-me-border border-l-[3px] ${accentBorder} p-3`}>
      <div className="me-label">{label}</div>
      <div className={`font-mono text-[13px] mt-1 break-all ${accentText}`}>{value}</div>
      <div className="font-mono text-[10px] text-me-fg-3 mt-0.5">{sub}</div>
    </div>
  );
}

/* ---------- Run card ---------- */
function RunCard({ report, onOpen, onDelete }) {
  const d = report.dataset;
  const meta = report.meta;
  const sparkValues = d ? [...d.profiles].sort((a, b) => b.tps - a.tps).map(p => p.tps).slice(0, 8) : [];
  const isLocal = report.source === "local";

  return (
    <div className="me-card p-4 md:p-5 transition-all hover:-translate-y-0.5 hover:border-me-border-strong">
      <div className="flex items-baseline justify-between gap-2 mb-2 flex-wrap">
        <div className="me-eyebrow flex items-center gap-2">
          {isLocal
            ? <span className="text-me-cyan"><i className="fa-solid fa-hard-drive mr-1"></i> Local</span>
            : <span className="text-me-fg-3"><i className="fa-solid fa-folder-tree mr-1"></i> Bundled</span>}
          <span className="text-me-fg-3">·</span>
          <span>{fmtDate(meta.date)}</span>
        </div>
        {isLocal && (
          <button onClick={() => onDelete(meta.id)}
                  className="font-mono text-[10px] text-me-fg-3 hover:text-me-danger" title="Remove">
            <i className="fa-regular fa-trash-can"></i>
          </button>
        )}
      </div>

      <h3 className="font-display text-[14px] md:text-[16px] tracking-[0.08em] uppercase m-0 mb-2 text-me-fg break-words">
        {meta.title || meta.id}
      </h3>

      {meta.subtitle && (
        <p className="text-[12px] text-me-fg-2 leading-relaxed mb-3 line-clamp-2">{meta.subtitle}</p>
      )}

      {d ? (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3 font-mono text-[11px]">
            <div className="p-2 bg-white/[0.02] border border-me-border">
              <div className="me-label">Backend</div>
              <div className="text-me-fg text-[13px] mt-0.5 truncate" title={meta.server?.engine || "llama.cpp"}>
                {meta.server?.engine || "llama.cpp"}
              </div>
            </div>
            <div className="p-2 bg-white/[0.02] border border-me-border">
              <div className="me-label">Top tok/s</div>
              <div className="text-me-success text-[14px] mt-0.5">{d.fastest.tps.toFixed(0)}</div>
            </div>
            <div className="p-2 bg-white/[0.02] border border-me-border">
              <div className="me-label">Top quality</div>
              <div className="text-me-warning text-[14px] mt-0.5">{d.topQuality.quality.toFixed(0)}%</div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="font-mono text-[10px] text-me-fg-3">tok/s spread</div>
            <Sparkline values={sparkValues} />
          </div>
        </>
      ) : (
        <div className="font-mono text-[11px] text-me-danger mb-3">Failed to load run data.</div>
      )}

      <button
        onClick={() => onOpen(meta.id)}
        className="w-full font-display text-[11px] tracking-[0.16em] uppercase px-3 py-2 border border-me-border text-me-fg-2 hover:text-me-fg hover:border-me-cyan hover:[box-shadow:inset_0_0_0_1px_var(--me-cyan-60)] transition-all">
        Open <i className="fa-solid fa-arrow-right ml-1"></i>
      </button>
    </div>
  );
}

/* ---------- Leaderboard ---------- */
function Leaderboard({ entries }) {
  if (!entries.length) return null;
  const maxTps = Math.max(...entries.map(e => e.tps));
  return (
    <div className="me-card p-4 md:p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-display text-[12px] tracking-[0.18em] uppercase m-0">
          <i className="fa-solid fa-trophy text-me-warning mr-2"></i> Cross-run leaderboard
        </h3>
        <span className="font-mono text-[10px] text-me-fg-3">best tok/s per model/backend</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {entries.slice(0, 10).map((e, i) => (
          <div key={`${e.alias}-${e.backend}`} className="grid grid-cols-[20px_1fr_60px] gap-2 items-center text-[11px] font-mono">
            <span className={`text-[10px] ${i < 3 ? "text-me-warning" : "text-me-fg-3"}`}>{i + 1}.</span>
            <div className="min-w-0">
              <div className="text-me-fg truncate" title={e.alias}>{e.alias}</div>
              <div className="text-me-fg-3 text-[10px] truncate" title={`${e.backend} · ${e.runTitle}`}>
                {e.backend} · {e.runTitle}
              </div>
            </div>
            <div className="text-right">
              <div className="text-me-cyan">{e.tps.toFixed(1)}</div>
              <div className="h-0.5 bg-white/5 mt-0.5 relative overflow-hidden">
                <div className="absolute inset-y-0 left-0 bg-me-cyan" style={{width: `${(e.tps / maxTps) * 100}%`}}></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Hardware / Server / About sidebar ---------- */
function SidebarInfoCard({ icon, title, lines }) {
  return (
    <div className="me-card p-4 md:p-5">
      <h3 className="font-display text-[12px] tracking-[0.18em] uppercase m-0 mb-3 text-me-fg">
        <i className={`fa-solid ${icon} text-me-cyan mr-2`}></i> {title}
      </h3>
      <div className="flex flex-col gap-1.5">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[80px_1fr] gap-2 items-baseline">
            <span className="me-label">{l[0]}</span>
            <span className="font-mono text-[11px] text-me-fg break-all">{l[1]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Drop-zone ---------- */
function DropZone({ onImport }) {
  const [drag, setDrag] = _hUseS(false);
  const [stage, setStage] = _hUseS(null); // null | "form" | "saving"
  const [files, setFiles] = _hUseS([]);
  const [meta, setMeta] = _hUseS({ id: "", title: "", subtitle: "", date: "" });
  const inputRef = _hUseR(null);

  function pickFiles(list) {
    const arr = [...list];
    setFiles(arr);
    const jsonl = arr.find(f => f.name.endsWith(".jsonl"));
    if (jsonl) {
      // Suggest id/title from filename
      const base = jsonl.name.replace(/\.jsonl$/, "");
      setMeta(m => ({ ...m, id: m.id || base, title: m.title || base, date: m.date || new Date().toISOString().slice(0, 10) }));
    }
    setStage("form");
  }

  function onDrop(e) {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files?.length) pickFiles(e.dataTransfer.files);
  }

  async function save() {
    setStage("saving");
    const jsonlFile = files.find(f => f.name.endsWith(".jsonl"));
    if (!jsonlFile) { setStage("form"); return; }
    const jsonl = await jsonlFile.text();

    const confFiles = files.filter(f => f.name.endsWith(".conf"));
    const confs = await Promise.all(confFiles.map(async f => ({
      filename: f.name,
      text: await f.text(),
    })));

    const metaFile = files.find(f => f.name === "meta.json");
    let metaJson = {};
    if (metaFile) try { metaJson = JSON.parse(await metaFile.text()); } catch {}

    const id = meta.id || `local-${Date.now()}`;
    const run = {
      id,
      jsonl,
      confs,
      meta: {
        id,
        title: meta.title || metaJson.title || id,
        subtitle: meta.subtitle || metaJson.subtitle || "",
        date: meta.date || metaJson.date || new Date().toISOString(),
        hardware: metaJson.hardware,
        server: metaJson.server,
        notes: metaJson.notes,
      },
      savedAt: Date.now(),
    };
    window.BenchData.saveMyRun(run);
    setStage(null);
    setFiles([]);
    setMeta({ id: "", title: "", subtitle: "", date: "" });
    onImport();
  }

  return (
    <div className="me-card p-4 md:p-5">
      <h3 className="font-display text-[12px] tracking-[0.18em] uppercase m-0 mb-3 text-me-fg">
        <i className="fa-solid fa-cloud-arrow-up text-me-cyan mr-2"></i> Import a run
      </h3>

      {!stage && (
        <div
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${drag ? "border-me-cyan bg-me-cyan/5" : "border-me-border hover:border-me-border-strong"}`}>
          <i className="fa-solid fa-file-arrow-up text-me-cyan text-2xl mb-2"></i>
          <div className="font-mono text-[12px] text-me-fg-2">Drop your <code className="text-me-fg">results.jsonl</code> here</div>
          <div className="font-mono text-[10px] text-me-fg-3 mt-1.5">+ optional <code>.conf</code> profiles · <code>meta.json</code></div>
          <input ref={inputRef} type="file" multiple accept=".jsonl,.conf,.json" className="hidden"
                 onChange={e => e.target.files?.length && pickFiles(e.target.files)} />
        </div>
      )}

      {stage === "form" && (
        <div className="flex flex-col gap-3">
          <div className="font-mono text-[11px] text-me-fg-2">
            <i className="fa-solid fa-check text-me-success mr-1.5"></i>
            {files.length} file{files.length === 1 ? "" : "s"} selected
            <ul className="list-disc list-inside mt-1.5 text-me-fg-3">
              {files.map(f => <li key={f.name} className="break-all">{f.name}</li>)}
            </ul>
          </div>
          <Field label="ID" value={meta.id} onChange={v => setMeta(m => ({...m, id: v}))} placeholder="run identifier" mono />
          <Field label="Title" value={meta.title} onChange={v => setMeta(m => ({...m, title: v}))} placeholder="Display name" />
          <Field label="Date" value={meta.date} onChange={v => setMeta(m => ({...m, date: v}))} placeholder="YYYY-MM-DD" mono />
          <Field label="Notes" value={meta.subtitle} onChange={v => setMeta(m => ({...m, subtitle: v}))} placeholder="One-line summary" textarea />
          <div className="flex gap-2 mt-2">
            <button onClick={save} disabled={!meta.id}
                    className="flex-1 font-display text-[11px] tracking-[0.16em] uppercase px-3 py-2 border border-me-cyan text-me-bg bg-me-cyan hover:bg-white transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              Save run
            </button>
            <button onClick={() => { setStage(null); setFiles([]); }}
                    className="font-display text-[11px] tracking-[0.16em] uppercase px-3 py-2 border border-me-border text-me-fg-2 hover:text-me-fg">
              Cancel
            </button>
          </div>
        </div>
      )}

      {stage === "saving" && (
        <div className="text-center font-mono text-[12px] text-me-fg-3 p-4">
          <i className="fa-solid fa-spinner fa-spin mr-1.5"></i> Saving…
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, mono, textarea }) {
  const inputCls = `w-full bg-me-bg-alt border border-me-border focus:border-me-cyan outline-none px-2.5 py-2 text-me-fg ${mono ? "font-mono text-[12px]" : "text-[13px]"}`;
  return (
    <label className="flex flex-col gap-1.5">
      <span className="me-label">{label}</span>
      {textarea
        ? <textarea className={inputCls} rows="2" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}></textarea>
        : <input  className={inputCls} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />}
    </label>
  );
}

/* ---------- Top-level home page ---------- */
function HomePage({ reports, onOpen, onRefresh }) {
  const sorted = _hUseM(() => {
    return [...reports].sort((a, b) => {
      const da = new Date(a.meta?.date || 0).getTime();
      const db = new Date(b.meta?.date || 0).getTime();
      return db - da;
    });
  }, [reports]);

  const [latest, ...rest] = sorted;
  const leaderboard = _hUseM(() => window.BenchData.buildLeaderboard(reports), [reports]);

  const hw = latest?.meta?.hardware || {};
  const srv = latest?.meta?.server || {};

  return (
    <>
      {latest ? (
        <HomeHero report={latest} onOpen={onOpen} />
      ) : (
        <div className="hero-bg relative overflow-hidden border border-me-border p-8 mb-8">
          <h1 className="hero-title my-2">Meese · Bench</h1>
          <p className="font-mono text-[13px] text-me-fg-2 max-w-[60ch]">
            // No bundled reports found. Drop a <code>results.jsonl</code> on the right to import your first run.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6 lg:gap-8">
        {/* Main column — runs grid */}
        <div>
          <div className="me-section-head">
            <h2><span className="num">A</span>All Runs</h2>
            <span className="sub">// {sorted.length} report{sorted.length === 1 ? "" : "s"} · click to open</span>
          </div>
          {sorted.length === 0 && (
            <div className="me-card p-6 text-center font-mono text-[12px] text-me-fg-3">
              Nothing here yet.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {sorted.map(r => (
              <RunCard
                key={r.id}
                report={r}
                onOpen={onOpen}
                onDelete={(id) => { window.BenchData.deleteMyRun(id); onRefresh(); }}
              />
            ))}
          </div>

          <div className="me-section-head">
            <h2><span className="num">B</span>Methodology</h2>
            <span className="sub">// what these numbers mean — and what they don't</span>
          </div>
          <div className="me-card p-5 md:p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <MethodCol icon="fa-stopwatch" title="Timings" body="End-to-end latency through llama-server's /chat/completions endpoint with stream:false. The raw ttft_sec column is curl's time_starttransfer; for non-streaming requests this equals total time, so it isn't shown separately." />
              <MethodCol icon="fa-list-check" title="Quality" body="Lightweight automated keyword/requirement rubric scored per prompt with a max that varies by prompt. Quality % is the average ratio across all prompts a profile ran." />
              <MethodCol icon="fa-broom" title="Cleanliness" body="Each response is classified clean / leak / empty. Leak = visible <think> block or 'thinking process' preamble in the content field. Empty = answer placed in reasoning_content with no visible content." />
            </div>
            <div className="mt-5 text-[12px] text-me-fg-3 font-mono">
              Open any individual run for the full methodology + per-prompt drilldown.
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-4">
          <DropZone onImport={onRefresh} />
          {leaderboard.length > 0 && <Leaderboard entries={leaderboard} />}
          {(hw.gpu || hw.cpu) && (
            <SidebarInfoCard
              icon="fa-microchip"
              title="Hardware"
              lines={[
                hw.gpu && ["GPU", hw.gpu],
                hw.vram_gb && ["VRAM", `${hw.vram_gb} GB`],
                hw.cpu && ["CPU", hw.cpu],
                hw.ram_gb && ["RAM", `${hw.ram_gb} GB`],
              ].filter(Boolean)}
            />
          )}
          {(srv.engine || srv.binary) && (
            <SidebarInfoCard
              icon="fa-server"
              title="Server"
              lines={[
                srv.engine && ["Engine", srv.engine],
                srv.binary && ["Binary", srv.binary],
                srv.api && ["API", srv.api],
                srv.stream != null && ["Stream", srv.stream ? "true" : "false"],
              ].filter(Boolean)}
            />
          )}
        </div>
      </div>
    </>
  );
}

function MethodCol({ icon, title, body }) {
  return (
    <div>
      <h4 className="font-display text-[13px] tracking-[0.16em] uppercase m-0 mb-2 text-me-fg">
        <i className={`fa-solid ${icon} text-me-cyan mr-2`}></i> {title}
      </h4>
      <p className="text-[12px] leading-relaxed text-me-fg-2">{body}</p>
    </div>
  );
}

Object.assign(window, { HomePage });
