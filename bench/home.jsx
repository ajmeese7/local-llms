/* ============================================================
   home.jsx
   Hub home: a flat run list with adapter / track filters and a
   small comparability grouping aside, then the model reading guide.
   ============================================================ */

const { useState: useHomeS, useMemo: useHomeM } = React;

function HomePage({ reports, profilesSnapshot, onOpen, onRefresh, generatedAt }) {
  const [adapterFilter, setAdapterFilter] = useHomeS(null);
  const [trackFilter, setTrackFilter] = useHomeS(null);

  const adapters = useHomeM(() => window.BenchData.listAdapters(reports), [reports]);
  const tracks = useHomeM(() => window.BenchData.listTracks(reports), [reports]);

  const filtered = useHomeM(() => {
    return reports.filter(r => {
      const a = r.adapter || {};
      if (adapterFilter && a.name !== adapterFilter) return false;
      if (trackFilter && a.track !== trackFilter) return false;
      return true;
    });
  }, [reports, adapterFilter, trackFilter]);

  const buckets = useHomeM(
    () => window.BenchData.groupByComparability(filtered),
    [filtered],
  );

  return (
    <>
      <header className="mb-8 md:mb-10">
        <Eyebrow>// Meese · Bench</Eyebrow>
        <h1 className="font-display text-[28px] md:text-[40px] tracking-[0.06em] uppercase mt-1.5 mb-3">
          Eval runs
        </h1>
        <div className="font-mono text-[12px] text-me-fg-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>{reports.length} run{reports.length === 1 ? "" : "s"} indexed</span>
          {generatedAt && <span>registry generated {window.BenchData.fmtTimestamp(generatedAt)}</span>}
          <button
            onClick={onRefresh}
            className="me-chip text-[10px] px-2 py-0.5"
            title="Reload reports.json from disk">
            <i className="fa-solid fa-rotate mr-1"></i> refresh
          </button>
        </div>
      </header>

      <FilterRow
        label="adapter"
        options={adapters}
        active={adapterFilter}
        onChange={setAdapterFilter} />
      <FilterRow
        label="track"
        options={tracks}
        active={trackFilter}
        onChange={setTrackFilter} />

      {filtered.length === 0 ? (
        <EmptyState reports={reports} onClear={() => { setAdapterFilter(null); setTrackFilter(null); }} />
      ) : (
        <RunsTable reports={filtered} onOpen={onOpen} />
      )}

      <ComparabilityIndex buckets={buckets} onOpen={onOpen} />

      <GuideSection profilesSnapshot={profilesSnapshot} />
    </>
  );
}

function FilterRow({ label, options, active, onChange }) {
  if (!options.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 font-mono text-[10px] text-me-fg-3">
      <span className="w-16 uppercase tracking-[0.18em]">{label}:</span>
      <button
        className={`me-chip ${active == null ? "on" : ""}`}
        onClick={() => onChange(null)}>all</button>
      {options.map(opt => (
        <button
          key={opt}
          className={`me-chip ${active === opt ? "on" : ""}`}
          onClick={() => onChange(active === opt ? null : opt)}>{opt}</button>
      ))}
    </div>
  );
}

function RunsTable({ reports, onOpen }) {
  return (
    <div className="me-card overflow-x-auto">
      <table className="w-full font-mono text-[12px]">
        <thead>
          <tr className="text-left text-me-fg-3 border-b border-me-border">
            <th className="px-3 py-2.5">Run</th>
            <th className="px-3 py-2.5">Adapter</th>
            <th className="px-3 py-2.5">Endpoint</th>
            <th className="px-3 py-2.5">Profile</th>
            <th className="px-3 py-2.5 text-right">Items</th>
            <th className="px-3 py-2.5">Accuracy</th>
            <th className="px-3 py-2.5 text-right">Latency</th>
            <th className="px-3 py-2.5 text-right">Throughput</th>
            <th className="px-3 py-2.5">Compat</th>
            <th className="px-3 py-2.5">Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {reports.map(r => {
            const a = r.adapter || {};
            const accLabel = window.BenchData.fmtAccuracy(r.accuracy);
            const accCi = window.BenchData.fmtCi(r.accuracy);
            const failBadge = (r.parse_failure_count || 0) + (r.error_count || 0);
            return (
              <tr
                key={r.id}
                className="border-b border-me-border last:border-0 hover:bg-me-surface cursor-pointer"
                onClick={() => onOpen(r.id)}>
                <td className="px-3 py-2.5 text-me-fg">
                  <div className="truncate max-w-[28ch]" title={r.id}>{r.id}</div>
                  {r.notes && <div className="text-me-fg-3 line-clamp-2 max-w-[28ch]">{r.notes}</div>}
                </td>
                <td className="px-3 py-2.5">
                  <div>{a.name}@{a.version}</div>
                  <div className="text-me-fg-3 text-[10px]">{a.track || "—"}</div>
                </td>
                <td className="px-3 py-2.5">
                  <div>{r.endpoint || "—"}</div>
                  <div className="text-me-fg-3 text-[10px]">{r.provider || ""}</div>
                </td>
                <td className="px-3 py-2.5">
                  {r.profile || "—"}
                </td>
                <td className="px-3 py-2.5 text-right">{r.item_count ?? "—"}</td>
                <td className="px-3 py-2.5">
                  <div className="text-me-fg">{accLabel}</div>
                  <div className="text-me-fg-3 text-[10px]" title={accCi}>{accCi !== accLabel ? accCi : ""}</div>
                  {failBadge > 0 && (
                    <span className="me-miniflag leak mt-1 inline-block">{failBadge} failed</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">{window.BenchData.fmtMs(r.median_latency_ms)}</td>
                <td className="px-3 py-2.5 text-right">{window.BenchData.fmtTps(r.median_tokens_per_sec)}</td>
                <td className="px-3 py-2.5">
                  {r.comparability_key ? (
                    <code
                      className="text-me-fg-2 cursor-pointer hover:text-me-fg"
                      title={`${r.comparability_key}\n(click to copy)`}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard?.writeText(r.comparability_key);
                      }}>
                      {r.comparability_prefix}
                    </code>
                  ) : (
                    <code className="text-me-fg-2">—</code>
                  )}
                </td>
                <td className="px-3 py-2.5 text-me-fg-3">
                  {window.BenchData.fmtTimestamp(r.timestamp)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ComparabilityIndex({ buckets, onOpen }) {
  const groups = [...buckets.entries()].filter(([, runs]) => runs.length > 1);
  if (!groups.length) return null;
  return (
    <section className="mt-12">
      <SectionHead num="//" title="Comparable groups" sub="runs sharing a comparability key, same model, provider, decode, prompt, dataset, scorer" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {groups.map(([key, runs]) => {
          const sample = runs[0];
          return (
            <div key={key} className="me-card p-4">
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <div className="font-mono text-[11px] text-me-fg-2">
                  {sample.adapter?.name}@{sample.adapter?.version}
                  <span className="text-me-fg-3"> · {key.slice(0, 12)}…</span>
                </div>
                <div className="font-mono text-[10px] text-me-fg-3">{runs.length} runs</div>
              </div>
              <ul className="space-y-1">
                {runs.map(r => (
                  <li key={r.id}>
                    <button
                      onClick={() => onOpen(r.id)}
                      className="font-mono text-[11px] text-me-fg-2 hover:text-me-fg text-left w-full">
                      <span className="text-me-cyan">{window.BenchData.fmtAccuracy(r.accuracy)}</span>
                      &nbsp;&nbsp;
                      <span className="text-me-fg-3">{window.BenchData.fmtTimestamp(r.timestamp)}</span>
                      &nbsp;&nbsp;
                      <span>{r.endpoint || r.id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EmptyState({ reports, onClear }) {
  if (reports.length === 0) {
    return (
      <div className="me-card p-8 text-center">
        <i className="fa-solid fa-folder-open text-[28px] text-me-fg-3 mb-3"></i>
        <div className="font-mono text-[12px] text-me-fg-2 mb-1">No runs indexed.</div>
        <div className="font-mono text-[11px] text-me-fg-3">
          Run <code>llms eval run &lt;adapter&gt; --endpoint &lt;name&gt;</code>, then{" "}
          <code>llms eval report</code> to refresh the index.
        </div>
      </div>
    );
  }
  return (
    <div className="me-card p-6 text-center">
      <div className="font-mono text-[12px] text-me-fg-2 mb-2">No runs match the selected filters.</div>
      <button onClick={onClear} className="me-chip">clear filters</button>
    </div>
  );
}

window.HomePage = HomePage;
