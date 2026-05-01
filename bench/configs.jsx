/* ============================================================
   configs.jsx — Configs tab with auto-detected family diff view.
   Reads the profile bundle attached to the active report.
   ============================================================ */

const { useState: _csUseState, useMemo: _csUseMemo, useEffect: _csUseEffect } = React;

/* ---------- Field grouping for display order ---------- */
const FIELD_GROUPS = [
  { id: "model",    title: "Model",        fields: ["MODEL", "ALIAS", "HF_REPO", "HF_FILE", "JINJA"] },
  { id: "context",  title: "Context",      fields: ["CONTEXT_LENGTH", "PARALLEL_SLOTS"] },
  { id: "kv",       title: "KV Cache",     fields: ["CACHE_TYPE_K", "CACHE_TYPE_V", "KV_UNIFIED"] },
  { id: "spec",     title: "Speculation",  fields: ["SPEC_TYPE", "SPEC_DEFAULT", "SPEC_NGRAM_SIZE_N", "DRAFT_MAX", "DRAFT_MIN"] },
  { id: "sampling", title: "Sampling",     fields: ["TEMPERATURE", "TOP_P", "TOP_K", "MIN_P", "PRESENCE_PENALTY"] },
  { id: "mmproj",   title: "Multimodal",   fields: ["MMPROJ", "MMPROJ_HF_FILE"] },
];
const HEADLINE_FIELDS = ["MODEL", "CONTEXT_LENGTH"]; // surfaced as big metrics

function groupFieldsFor(conf) {
  const seen = new Set();
  const groups = FIELD_GROUPS.map(g => {
    const present = g.fields.filter(f => conf.fields[f] != null);
    present.forEach(f => seen.add(f));
    return { ...g, present };
  }).filter(g => g.present.length);
  // Catch-all for unknown keys
  const extras = Object.keys(conf.fields).filter(k => !seen.has(k));
  if (extras.length) groups.push({ id: "other", title: "Other", present: extras });
  return groups;
}

/* ---------- Pretty value rendering ---------- */
function shortPath(v) {
  if (!v || v.length < 50) return v;
  // Trim $HOME and middle of long paths
  const home = v.replace(/^\$HOME\//, "~/");
  if (home.length < 60) return home;
  const parts = home.split("/");
  if (parts.length > 4) return `${parts[0]}/…/${parts.slice(-2).join("/")}`;
  return home;
}

function ValueCell({ k, v }) {
  if (v == null) return <span className="text-me-fg-3">—</span>;
  if (k === "MODEL" || k === "MMPROJ") {
    return (
      <span className="font-mono text-[12px] text-me-fg-2 break-all" title={v}>
        {shortPath(v)}
      </span>
    );
  }
  if (k === "HF_REPO") {
    return (
      <a className="font-mono text-[12px] text-me-cyan break-all"
         href={`https://huggingface.co/${v}`} target="_blank" rel="noopener">
        {v}
      </a>
    );
  }
  if (k === "CONTEXT_LENGTH") {
    const n = parseInt(v, 10);
    if (!isNaN(n)) {
      const fmt = n >= 1000 ? `${(n / 1000).toFixed(0)}k` : n;
      return <span className="font-mono text-[12px] text-me-fg">{fmt} <span className="text-me-fg-3">({n.toLocaleString()})</span></span>;
    }
  }
  return <span className="font-mono text-[12px] text-me-fg break-all">{v}</span>;
}

/* ---------- Single profile config card ---------- */
function ConfigCard({ conf, showAll, isFamily }) {
  const groups = _csUseMemo(() => groupFieldsFor(conf), [conf]);
  const headlineGroups = ["model", "context"];

  return (
    <div className="me-card p-4 md:p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <h3 className="font-display text-[14px] md:text-[16px] tracking-[0.12em] uppercase m-0 text-me-fg break-all">
          {conf.profile_id}
        </h3>
        <div className="flex gap-1.5">
          {conf.derived.quant && (
            <span className="font-mono text-[10px] tracking-[0.1em] uppercase px-2 py-0.5 border border-me-cyan/40 text-me-cyan">
              {conf.derived.quant}
            </span>
          )}
          {isFamily && (
            <span className="font-mono text-[10px] tracking-[0.1em] uppercase px-2 py-0.5 border border-me-magenta-60 text-me-magenta">
              family
            </span>
          )}
        </div>
      </div>

      {/* Headline strip — model file + context length */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
        <div className="p-2.5 bg-white/[0.02] border border-me-border">
          <div className="me-label">Model file</div>
          <div className="font-mono text-[11px] text-me-fg-2 mt-1 break-all" title={conf.derived.model_file}>
            {conf.derived.model_file || "—"}
          </div>
        </div>
        <div className="p-2.5 bg-white/[0.02] border border-me-border">
          <div className="me-label">Context</div>
          <div className="font-mono text-[14px] text-me-cyan mt-0.5">
            {conf.fields.CONTEXT_LENGTH
              ? `${(parseInt(conf.fields.CONTEXT_LENGTH, 10) / 1000).toFixed(0)}k`
              : "—"}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {groups.map(g => {
          if (!showAll && !headlineGroups.includes(g.id)) return null;
          return (
            <div key={g.id}>
              <div className="me-label mb-1.5">{g.title}</div>
              <div className="border-t border-me-border">
                {g.present.map(f => (
                  <div key={f} className="grid grid-cols-[120px_1fr] gap-3 py-1.5 border-b border-me-border/50 items-baseline">
                    <span className="font-mono text-[10px] tracking-[0.06em] uppercase text-me-fg-3">{f}</span>
                    <ValueCell k={f} v={conf.fields[f]} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Family diff: a table comparing N members ---------- */
function FamilyDiff({ family }) {
  const [onlyDiffs, setOnlyDiffs] = _csUseState(true);

  const allKeys = _csUseMemo(() => {
    const set = new Set();
    family.members.forEach(m => Object.keys(m.fields).forEach(k => set.add(k)));
    return [...set];
  }, [family]);

  const rows = _csUseMemo(() => {
    return allKeys.map(k => {
      const values = family.members.map(m => m.fields[k] ?? null);
      const distinct = new Set(values.map(v => v ?? "—"));
      return { key: k, values, differs: distinct.size > 1 };
    }).sort((a, b) => (b.differs - a.differs) || a.key.localeCompare(b.key));
  }, [allKeys, family]);

  const visible = onlyDiffs ? rows.filter(r => r.differs) : rows;
  const repoUrl = family.repo.startsWith("__solo__") ? null : `https://huggingface.co/${family.repo}`;

  return (
    <div className="me-card overflow-hidden">
      <div className="p-4 md:p-5 border-b border-me-border flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="me-eyebrow mb-1">
            <i className="fa-solid fa-code-compare mr-1.5 text-me-magenta"></i>
            Family · {family.members.length} profiles
          </div>
          <div className="font-mono text-[13px] md:text-[14px] text-me-fg break-all">
            {repoUrl ? <a href={repoUrl} target="_blank" rel="noopener">{family.repo}</a> : family.repo}
          </div>
        </div>
        <Chip on={onlyDiffs} cyan onClick={() => setOnlyDiffs(v => !v)}>
          {onlyDiffs ? "Showing diffs only" : "Showing all keys"}
        </Chip>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full" style={{borderCollapse: "collapse"}}>
          <thead>
            <tr>
              <th className="font-mono text-[10px] tracking-[0.16em] uppercase text-me-fg-3 text-left p-3 border-b border-me-border whitespace-nowrap" style={{width: 160}}>Field</th>
              {family.members.map(m => (
                <th key={m.profile_id}
                    className="font-mono text-[10px] tracking-[0.06em] uppercase text-me-fg p-3 border-b border-me-border text-left whitespace-nowrap">
                  {m.profile_id}
                  {m.derived.quant && <span className="ml-2 text-me-cyan">{m.derived.quant}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={family.members.length + 1} className="p-6 text-center font-mono text-[11px] text-me-fg-3">
                  All fields identical between these profiles.
                </td>
              </tr>
            )}
            {visible.map(r => (
              <tr key={r.key} className={r.differs ? "bg-me-magenta/[0.04]" : ""}>
                <td className="p-3 border-b border-me-border/60 font-mono text-[10px] tracking-[0.06em] uppercase text-me-fg-3 whitespace-nowrap align-top">
                  {r.key}
                  {r.differs && <span className="ml-1.5 text-me-magenta">●</span>}
                </td>
                {r.values.map((v, i) => (
                  <td key={i} className="p-3 border-b border-me-border/60 align-top">
                    <ValueCell k={r.key} v={v} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Top-level Configs section ---------- */
function ConfigsSection({ data, profiles }) {
  const [showAll, setShowAll] = _csUseState(false);
  const bundle = profiles?.bundle;

  if (!bundle || bundle.confs.length === 0) {
    return (
      <section data-screen-label="06 Configs">
        <SectionHead num="06" title="Profile Configs" sub="// llama-server overlays per profile" />
        <div className="me-card p-8 text-center font-mono text-[12px] text-me-fg-3">
          No profile <code>.conf</code> files were found for this run.
          <div className="mt-2 text-me-fg-3">Drop them next to <code>results.jsonl</code> in <code>profiles/&lt;profile&gt;.conf</code>, or include them with the run when importing.</div>
        </div>
      </section>
    );
  }

  const families = bundle.families.filter(f => f.isFamily);
  const solos = bundle.confs.filter(c =>
    !families.some(f => f.members.some(m => m.profile_id === c.profile_id))
  );

  return (
    <section data-screen-label="06 Configs">
      <SectionHead
        num="06"
        title="Profile Configs"
        sub={`// ${bundle.confs.length} llama-server overlays · ${families.length} model families auto-detected`} />

      {families.length > 0 && (
        <>
          <div className="me-eyebrow mb-3">
            <i className="fa-solid fa-code-compare mr-1.5 text-me-magenta"></i>
            Family Diffs
          </div>
          <div className="flex flex-col gap-4 mb-8">
            {families.map(f => <FamilyDiff key={f.repo} family={f} />)}
          </div>
        </>
      )}

      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div className="me-eyebrow">All Profiles</div>
        <Chip on={showAll} cyan onClick={() => setShowAll(v => !v)}>
          {showAll ? "Show summary only" : "Show all fields"}
        </Chip>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {bundle.confs.map(c => (
          <ConfigCard
            key={c.profile_id}
            conf={c}
            showAll={showAll}
            isFamily={families.some(f => f.members.some(m => m.profile_id === c.profile_id))}
          />
        ))}
      </div>
    </section>
  );
}

Object.assign(window, { ConfigsSection, ConfigCard, FamilyDiff });
