/* ============================================================
   sections.jsx — Summary / Profiles / Prompts / Methodology
   ============================================================ */

const { useState: _useState, useMemo: _useMemo } = React;

/* ====================== SUMMARY ====================== */
function formatHardware(meta) {
  const hw = meta?.hardware || {};
  return [hw.gpu, hw.vram_gb ? `${hw.vram_gb} GB` : null].filter(Boolean).join(" · ") || "Hardware unknown";
}

function formatServer(meta) {
  const srv = meta?.server || {};
  return [srv.engine, srv.binary].filter(Boolean).join(" / ") || srv.api || "Server unknown";
}

function formatContext(value) {
  const n = parseInt(value, 10);
  if (isNaN(n)) return "—";
  return n >= 1000 ? `${Math.round(n / 1024)}k` : String(n);
}

function profileMeta(meta, profile) {
  return (meta?.profiles || []).find(p => p.profile === profile) || {};
}

function SummarySection({ data, meta, copy, recommendations }) {
  return (
    <section id="summary" data-screen-label="01 Summary">
      <div className="hero-bg relative overflow-hidden border border-me-border p-5 md:p-8 lg:p-9">
        <div className="me-eyebrow grid grid-cols-2 sm:flex sm:flex-wrap gap-y-2 gap-x-5 mb-3">
          <span className="inline-flex items-center gap-1.5"><i className="fa-solid fa-microchip text-me-cyan"></i> {formatHardware(meta)}</span>
          <span className="inline-flex items-center gap-1.5"><i className="fa-solid fa-server text-me-cyan"></i> {formatServer(meta)}</span>
          <span className="inline-flex items-center gap-1.5"><i className="fa-solid fa-bolt text-me-cyan"></i> {meta?.server?.api || "OpenAI-compatible API"}</span>
          <span className="inline-flex items-center gap-1.5"><i className="fa-solid fa-list-check text-me-cyan"></i> {data.prompts.length} prompts × {data.profiles.length} profiles</span>
          <span className="inline-flex items-center gap-1.5 col-span-2 sm:col-auto"><i className="fa-regular fa-folder text-me-cyan"></i> {data.runDir}</span>
        </div>

        <h1 className="hero-title my-2"><Txt id="hero.title">{copy["hero.title"]}</Txt></h1>

        <Txt id="hero.subtitle" as="p" className="font-mono text-[13px] md:text-[15px] text-me-fg-2 [letter-spacing:-0.5px] mb-6 whitespace-pre-line">
          {copy["hero.subtitle"]}
        </Txt>

        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6 lg:gap-8 items-start">
          <Txt id="hero.body" as="div" className="text-[14px] md:text-[15px] leading-relaxed text-me-fg-2 max-w-[62ch] whitespace-pre-line">
            {copy["hero.body"]}
          </Txt>

          <div className="flex flex-col gap-2.5">
            <BadgeRow label="Balanced" value={data.balanced.profile} accent="magenta" />
            {data.fastest !== data.balanced && <BadgeRow label="Fastest" value={data.fastest.profile} accent="cyan" />}
            <BadgeRow label="Top Quality" value={`${data.topQuality.profile} · ${data.topQuality.quality.toFixed(1)}%`} accent="warning" />
          </div>
        </div>
      </div>

      <SectionHead num="01" title="Recommendations" sub="// pick a profile by job, not by name" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {recommendations.map(r => <RecCard key={r.id} rec={r} />)}
      </div>

      <SectionHead num="02" title="Visual Comparison" sub="// throughput vs latency vs quality" />
      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4">
        <BarChart profiles={data.profiles} />
        <Scatter profiles={data.profiles} />
      </div>

      <SectionHead num="03" title="Output Cleanliness" sub={copy["summary.cleanliness.note"]} />
      <CleanlinessGrid profiles={data.profiles} prompts={data.prompts} />
      <div className="flex flex-wrap gap-3.5 mt-4 font-mono text-[10px] text-me-fg-3">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 inline-block bg-me-success/40 border border-me-success"></span> clean visible answer</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 inline-block bg-me-warning/40 border border-me-warning"></span> visible thinking preamble</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 inline-block bg-me-danger/40  border border-me-danger"></span> empty content · reasoning_content fallback</span>
      </div>
    </section>
  );
}

function BadgeRow({ label, value, accent }) {
  const accentCls = {
    magenta: "border-l-me-magenta", cyan: "border-l-me-cyan", warning: "border-l-me-warning",
  }[accent];
  const textCls = {
    magenta: "text-me-magenta [text-shadow:0_0_6px_var(--me-magenta-60)]",
    cyan:    "text-me-cyan [text-shadow:0_0_6px_var(--me-cyan-60)]",
    warning: "text-me-warning",
  }[accent];
  return (
    <div className={`flex items-center gap-3 px-3.5 py-3 border border-me-border border-l-[3px] ${accentCls} bg-me-bg-alt/60 font-mono text-[12px]`}>
      <div className="me-label w-[78px] md:w-[92px] flex-shrink-0">{label}</div>
      <div className={`${textCls} font-medium break-all`}>{value}</div>
    </div>
  );
}

function RecCard({ rec }) {
  const accent = rec.highlight
    ? "border-me-magenta-60 [box-shadow:0_0_24px_rgba(214,0,255,0.18),inset_0_0_0_1px_rgba(214,0,255,0.18)]"
    : rec.cyan ? "border-me-border hover:border-me-cyan-60"
               : "border-me-border hover:border-me-border-strong";
  const tagColor = rec.highlight ? "text-me-magenta" : rec.cyan ? "text-me-cyan" : "text-me-fg-3";
  return (
    <div className={`bg-me-bg-alt border ${accent} p-4 md:p-5 transition-all hover:-translate-y-0.5`}>
      <div className={`font-mono text-[10px] tracking-[0.2em] uppercase ${tagColor}`}>{rec.tag}</div>
      <div className="font-mono text-[15px] md:text-[17px] my-2 mb-3.5 text-me-fg break-all">{rec.profile}</div>
      <div className="grid grid-cols-2 gap-2 mb-3.5">
        <div className="p-2.5 bg-white/[0.02] border border-me-border" data-tip="end-to-end /chat/completions">
          <Label>Speed</Label>
          <div className="font-mono text-me-success text-[16px] md:text-[18px] mt-0.5">{rec.metric_speed}</div>
        </div>
        <div className="p-2.5 bg-white/[0.02] border border-me-border" data-tip="rubric hit-rate over prompts">
          <Label>Quality</Label>
          <div className="font-mono text-me-warning text-[16px] md:text-[18px] mt-0.5">{rec.metric_quality}</div>
        </div>
      </div>
      <Txt id={`${rec.id}.tradeoff`} as="div" className="text-[12px] md:text-[13px] leading-relaxed text-me-fg-2">
        {rec.tradeoff}
      </Txt>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {rec.flags.map((f, i) => <Flag key={i} kind={f[0]}>{f[1]}</Flag>)}
      </div>
    </div>
  );
}

/* ====================== PROFILES ====================== */
function ProfilesSection({ data, meta }) {
  const [sortKey, setSortKey] = _useState("quality");
  const [sortDir, setSortDir] = _useState(-1);
  const [highlight, setHighlight] = _useState("balanced");

  function sortValue(profile, key) {
    const pm = profileMeta(meta, profile.profile);
    if (key === "context") return pm.context_length || 0;
    if (key === "parallel") return pm.parallel_slots || 0;
    if (key === "kv") return `${pm.cache_type_k || ""}/${pm.cache_type_v || ""}`;
    return profile[key];
  }

  const rows = _useMemo(() => {
    const sorted = [...data.profiles].sort((a, b) => {
      const av = sortValue(a, sortKey), bv = sortValue(b, sortKey);
      if (typeof av === "string") return av.localeCompare(bv) * sortDir;
      return ((av || 0) - (bv || 0)) * sortDir;
    });
    return sorted;
  }, [data.profiles, meta, sortKey, sortDir]);

  function clickSort(k) {
    if (sortKey === k) setSortDir(d => -d);
    else { setSortKey(k); setSortDir(typeof sortValue(data.profiles[0], k) === "number" ? -1 : 1); }
  }

  function cleanSummary(p) {
    const cls = p.emptyCount ? "danger" : (p.cleanCount >= p.leakCount ? "clean" : "leak");
    return <MiniFlag kind={cls}>{p.cleanCount}c · {p.leakCount}l{p.emptyCount ? ` · ${p.emptyCount}e` : ""}</MiniFlag>;
  }

  const headers = [
    ["profile", "Profile", false], ["alias", "Model", false],
    ["context", "Ctx", true], ["parallel", "Par", true], ["kv", "KV", false],
    ["latency", "Avg Lat", true], ["tps", "tok/s", true],
    ["quality", "Quality", true], ["runCount", "Runs", true],
    ["cleanCount", "Output", true],
  ];

  return (
    <section id="profiles" data-screen-label="02 Profiles">
      <SectionHead num="04" title="Profile Manifest" sub={`// click any header to sort · ${data.profiles.length} profiles · ${data.totalRuns}/${data.totalRuns} runs`} />

      <div className="me-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-me-border">
          <Label className="mr-1">Highlight</Label>
          <Chip on={highlight === "balanced"} cyan onClick={() => setHighlight("balanced")}>Balanced winner</Chip>
          <Chip on={highlight === "fastest"} onClick={() => setHighlight("fastest")}>Fastest</Chip>
          <Chip on={highlight === "none"} onClick={() => setHighlight("none")}>None</Chip>
        </div>
        <table className="me-table">
          <thead>
            <tr>
              {headers.map(([k, label, num]) => (
                <th key={k}
                    className={`${num ? "numeric" : ""} ${sortKey === k ? "sorted" : ""} ${sortKey === k && sortDir === 1 ? "asc" : ""}`}
                    onClick={() => clickSort(k)}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(p => {
              const pm = profileMeta(meta, p.profile);
              let rowCls = "";
              if (highlight === "balanced" && p.role === "balanced") rowCls = "highlight";
              else if (highlight === "fastest" && p.role === "fastest") rowCls = "fastest-row";
              return (
                <tr key={p.profile} className={rowCls}>
                  <td data-label="Profile"><span className="pn">{p.profile}</span></td>
                  <td data-label="Model">
                    <div>{p.alias}</div>
                    {pm.model_file && <div className="text-me-fg-3 text-[10px] mt-1 break-all">{pm.model_file}</div>}
                  </td>
                  <td data-label="Ctx" className="numeric">{formatContext(pm.context_length)}</td>
                  <td data-label="Par" className="numeric">{pm.parallel_slots || "—"}</td>
                  <td data-label="KV">{pm.cache_type_k && pm.cache_type_v ? `${pm.cache_type_k}/${pm.cache_type_v}` : "—"}</td>
                  <td data-label="Latency" className="numeric"
                      style={{color: p.latency < 12 ? "var(--me-success)" : p.latency < 25 ? "var(--me-warning)" : "var(--me-danger)"}}>
                    {p.latency.toFixed(2)} s
                  </td>
                  <td data-label="tok/s" className="numeric"
                      style={{color: p.tps > 100 ? "var(--me-cyan)" : "var(--me-fg)"}}>
                    {p.tps.toFixed(2)}
                  </td>
                  <td data-label="Quality" className="numeric"
                      style={{color: p.quality >= 95 ? "var(--me-success)" : p.quality >= 90 ? "var(--me-warning)" : "var(--me-danger)"}}>
                    {p.quality.toFixed(1)}%
                  </td>
                  <td data-label="Runs" className="numeric">{p.runCount}/{p.runCount}</td>
                  <td data-label="Output">{cleanSummary(p)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-6 p-4 me-card font-mono text-[11px] text-me-fg-3 leading-relaxed">
        <div><Label>Run dir</Label><div className="text-me-fg break-all">{data.runDir}</div></div>
        <div><Label>Hardware</Label><div className="text-me-fg">{formatHardware(meta)}</div></div>
        <div><Label>Server</Label><div className="text-me-fg">{formatServer(meta)}</div></div>
        <div><Label>Prompts</Label><div className="text-me-fg">{data.prompts.length}</div></div>
        <div><Label>Total runs</Label><div className="text-me-fg">{data.totalRuns} · {data.okRuns}/{data.totalRuns} OK</div></div>
        <div><Label>Profiles</Label><div className="text-me-fg">{data.profiles.length}</div></div>
      </div>
    </section>
  );
}

/* ====================== PROMPTS ====================== */
function PromptsSection({ data }) {
  const [filter, setFilter] = _useState("all");
  const [hideThinking, setHideThinking] = _useState(false);
  const [open, setOpen] = _useState({});  // key = prompt:profile

  const cats = _useMemo(() => {
    const set = new Set(data.prompts.map(p => p.category));
    return ["all", ...set];
  }, [data.prompts]);

  const filtered = filter === "all" ? data.prompts : data.prompts.filter(p => p.category === filter);

  return (
    <section id="prompts" data-screen-label="03 Prompts">
      <SectionHead num="05" title="Prompt Drilldown" sub="// each prompt × each profile · click a row to expand the excerpt" />

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

      <div className="flex flex-col gap-3">
        {filtered.map(p => (
          <PromptCard
            key={p.id} prompt={p}
            open={open} setOpen={setOpen}
            hideThinking={hideThinking}
          />
        ))}
      </div>
    </section>
  );
}

function PromptCard({ prompt, open, setOpen, hideThinking }) {
  const runs = _useMemo(() => [...prompt.runs].sort((a, b) => a.time_total_sec - b.time_total_sec), [prompt.runs]);
  return (
    <div className="me-card">
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_auto] gap-3 md:gap-4 p-3.5 md:p-4 border-b border-me-border items-start md:items-center">
        <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-me-cyan">
          {prompt.category}
          <span className="block text-me-fg text-[12px] md:text-[13px] tracking-[0.04em] normal-case mt-1">{prompt.id}</span>
        </div>
        <div className="text-[12px] md:text-[13px] text-me-fg-2 leading-relaxed">
          <Txt id={`prompt.${prompt.id}.desc`}>{prompt.id.replace(/_/g, " ")}</Txt>
        </div>
        <div className="font-mono text-[10px] md:text-[11px] text-me-fg-3 md:text-right">
          {runs.length} profiles · sorted by latency ↑
        </div>
      </div>
      <table className="prun-table">
        <thead>
          <tr>
            <th style={{width: 30}}></th>
            <th>Profile</th>
            <th className="numeric">Latency</th>
            <th className="numeric">tok/s</th>
            <th className="numeric">Quality</th>
            <th>Output</th>
          </tr>
        </thead>
        <tbody>
          {runs.map(r => {
            const key = `${prompt.id}:${r.profile}`;
            const isOpen = !!open[key];
            const clean = window.BenchData.classifyCleanliness(r);
            return (
              <React.Fragment key={key}>
                <tr className={`toggle-row ${isOpen ? "open" : ""}`}
                    onClick={() => setOpen(o => ({...o, [key]: !o[key]}))}>
                  <td></td>
                  <td><span className="pn">{r.profile}</span></td>
                  <td className="numeric">{r.time_total_sec.toFixed(2)} s</td>
                  <td className="numeric">{r.tokens_per_sec.toFixed(1)}</td>
                  <td className="numeric"><QBar q={r.quality_score} qmax={r.quality_max} /></td>
                  <td>
                    <MiniFlag kind={clean === "clean" ? "clean" : clean === "empty" ? "danger" : "leak"}>
                      {clean === "clean" ? "clean" : clean === "empty" ? "empty" : "thinking"}
                    </MiniFlag>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="excerpt-row">
                    <td colSpan="6">
                      <div className={`excerpt-inner ${hideThinking ? "hide-thinking" : ""}`}
                           dangerouslySetInnerHTML={{__html: highlightThinking(r.excerpt || "(no excerpt)")}} />
                      <div className="excerpt-foot">
                        <span className="raw-path">{r.response_file}</span>
                        <CopyBtn text={r.response_file} />
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
  );
}

function CopyBtn({ text }) {
  const [copied, setCopied] = _useState(false);
  return (
    <button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
      <i className={copied ? "fa-solid fa-check" : "fa-regular fa-copy"}></i> {copied ? "copied" : "copy path"}
    </button>
  );
}

/* ====================== METHODOLOGY ====================== */
function MethodologySection({ copy }) {
  const cards = [
    { id: "methodology.timings",      icon: "fa-stopwatch", title: "Timings",          body: copy["methodology.timings"], note: copy["methodology.ttft"] },
    { id: "methodology.rubric",       icon: "fa-list-check", title: "Quality rubric",   body: copy["methodology.rubric"] },
    { id: "methodology.cleanliness",  icon: "fa-broom", title: "Reasoning leakage", body: copy["methodology.cleanliness"] },
  ];
  return (
    <section id="methodology" data-screen-label="04 Methodology">
      <SectionHead num="06" title="Methodology & Caveats" sub="// how the numbers were produced — and what they don't mean" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {cards.map(c => (
          <div key={c.id} className="me-card p-4 md:p-5">
            <h3 className="font-display text-[13px] md:text-[14px] tracking-[0.18em] uppercase mt-0 mb-3 text-me-fg">
              <i className={`fa-solid ${c.icon} text-me-cyan mr-2`}></i> {c.title}
            </h3>
            <Txt id={c.id} as="p" className="text-[13px] leading-relaxed text-me-fg-2 mb-2.5">{c.body}</Txt>
            {c.note && (
              <div className="border-l-[3px] border-me-warning bg-me-warning/5 p-2.5 text-[12px] text-me-fg-2">
                <strong>TTFT caveat.</strong> <Txt id="methodology.ttft.note">{c.note}</Txt>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

Object.assign(window, { SummarySection, ProfilesSection, PromptsSection, MethodologySection });
