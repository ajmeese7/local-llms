/* ============================================================
   configs.jsx — single-profile ConfigCard.

   In the bench-shaped model each bench has exactly one model
   profile, so the family-diff view from the older suite layout
   doesn't apply here. We keep ConfigCard for use by ConfigSection.
   ============================================================ */

const { useMemo: _csUseMemo } = React;

const FIELD_GROUPS = [
  { id: "model",    title: "Model",        fields: ["MODEL", "ALIAS", "HF_REPO", "HF_FILE", "JINJA"] },
  { id: "context",  title: "Context",      fields: ["CONTEXT_LENGTH", "PARALLEL_SLOTS"] },
  { id: "kv",       title: "KV Cache",     fields: ["CACHE_TYPE_K", "CACHE_TYPE_V", "KV_UNIFIED"] },
  { id: "spec",     title: "Speculation",  fields: ["SPEC_TYPE", "SPEC_DEFAULT", "SPEC_NGRAM_SIZE_N", "DRAFT_MAX", "DRAFT_MIN"] },
  { id: "sampling", title: "Sampling",     fields: ["TEMPERATURE", "TOP_P", "TOP_K", "MIN_P", "PRESENCE_PENALTY"] },
  { id: "mmproj",   title: "Multimodal",   fields: ["MMPROJ", "MMPROJ_HF_FILE"] },
];

function groupFieldsFor(conf) {
  const seen = new Set();
  const groups = FIELD_GROUPS.map(g => {
    const present = g.fields.filter(f => conf.fields[f] != null);
    present.forEach(f => seen.add(f));
    return { ...g, present };
  }).filter(g => g.present.length);
  const extras = Object.keys(conf.fields).filter(k => !seen.has(k));
  if (extras.length) groups.push({ id: "other", title: "Other", present: extras });
  return groups;
}

function shortPath(v) {
  if (!v || v.length < 50) return v;
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
      return (
        <span className="font-mono text-[12px] text-me-fg">
          {fmt} <span className="text-me-fg-3">({n.toLocaleString()})</span>
        </span>
      );
    }
  }
  return <span className="font-mono text-[12px] text-me-fg break-all">{v}</span>;
}

function ConfigCard({ conf }) {
  const groups = _csUseMemo(() => groupFieldsFor(conf), [conf]);
  return (
    <div className="me-card p-4 md:p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <h3 className="font-display text-[14px] md:text-[16px] tracking-[0.12em] uppercase m-0 text-me-fg break-all">
          {conf.profile_id}
        </h3>
        {conf.derived.quant && (
          <span className="font-mono text-[10px] tracking-[0.1em] uppercase px-2 py-0.5 border border-me-cyan/40 text-me-cyan">
            {conf.derived.quant}
          </span>
        )}
      </div>

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
        {groups.map(g => (
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
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { ConfigCard });
