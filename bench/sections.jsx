/* ============================================================
   sections.jsx
   Run-detail view: summary cards, by-category breakdown, per-item
   table, manifest disclosure, link to standalone report.
   ============================================================ */

const { useState: useDetailS, useMemo: useDetailM } = React;

function RunDetail({ run, onBack }) {
  const m = run.manifest;
  const a = m.adapter || {};
  const p = m.model || {};
  const cards = useDetailM(() => window.BenchData.summaryCards(run), [run]);
  const byCategory = run.summary && run.summary.by_category ? run.summary.by_category : {};
  const categoryRows = Object.entries(byCategory);

  return (
    <>
      <header className="mb-6 md:mb-8">
        <button
          onClick={onBack}
          className="font-mono text-[10px] text-me-fg-3 hover:text-me-fg uppercase tracking-[0.18em] mb-3">
          <i className="fa-solid fa-arrow-left mr-1.5"></i> all runs
        </button>
        <Eyebrow>// {a.track || "track"} · {a.name || "adapter"}@{a.version || "?"}</Eyebrow>
        <h1 className="font-display text-[22px] md:text-[30px] tracking-[0.05em] uppercase mt-1.5 mb-2 break-all">
          {run.id}
        </h1>
        <div className="font-mono text-[11px] text-me-fg-3 flex flex-wrap gap-x-4 gap-y-1">
          <span>endpoint: <span className="text-me-fg-2">{m.endpoint_name || "—"}</span></span>
          <span>profile: <span className="text-me-fg-2">{p.profile || "—"}</span></span>
          <span>provider: <span className="text-me-fg-2">{m.provider?.name || "—"}</span></span>
          <span>{window.BenchData.fmtTimestamp(m.timestamp)}</span>
          <a href={`${run.base}report.html`} target="_blank" rel="noreferrer">standalone report</a>
        </div>
        {m.notes && (
          <p className="font-mono text-[11px] text-me-fg-2 mt-3 max-w-[80ch]">{m.notes}</p>
        )}
      </header>

      <SummaryGrid cards={cards} />

      {categoryRows.length > 1 && <ByCategory rows={categoryRows} />}

      <PerItemTable results={run.results} />

      <ManifestPanel manifest={m} />
    </>
  );
}

function SummaryGrid({ cards }) {
  return (
    <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 mb-8">
      {cards.map(c => (
        <div key={c.label} className="me-card p-3.5">
          <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-me-fg-3 mb-1.5">{c.label}</div>
          <div className="font-display text-[18px] text-me-fg break-words">{c.value}</div>
        </div>
      ))}
    </section>
  );
}

function ByCategory({ rows }) {
  return (
    <section className="mt-2 mb-8">
      <SectionHead num="//" title="By category" sub="per-subtask accuracy and partial-credit means" />
      <div className="me-card overflow-x-auto">
        <table className="w-full font-mono text-[12px]">
          <thead>
            <tr className="text-left text-me-fg-3 border-b border-me-border">
              <th className="px-3 py-2.5">Category</th>
              <th className="px-3 py-2.5 text-right">Items</th>
              <th className="px-3 py-2.5 text-right">Correct</th>
              <th className="px-3 py-2.5 text-right">Accuracy</th>
              <th className="px-3 py-2.5 text-right">Partial mean</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([cat, stats]) => (
              <tr key={cat} className="border-b border-me-border last:border-0">
                <td className="px-3 py-2.5 text-me-fg">{cat}</td>
                <td className="px-3 py-2.5 text-right">{stats.item_count}</td>
                <td className="px-3 py-2.5 text-right">{stats.correct_count}</td>
                <td className="px-3 py-2.5 text-right">{(stats.accuracy * 100).toFixed(1)}%</td>
                <td className="px-3 py-2.5 text-right">{(stats.partial_mean * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PerItemTable({ results }) {
  const [open, setOpen] = useDetailS(null);
  if (!results || results.length === 0) {
    return (
      <section className="mt-2 mb-8">
        <SectionHead num="//" title="Per-item results" sub="results.jsonl was empty or missing" />
      </section>
    );
  }
  return (
    <section className="mt-2 mb-8">
      <SectionHead num="//" title="Per-item results" sub={`${results.length} items`} />
      <div className="me-card overflow-x-auto">
        <table className="w-full font-mono text-[11px]">
          <thead>
            <tr className="text-left text-me-fg-3 border-b border-me-border">
              <th className="px-3 py-2.5">Item</th>
              <th className="px-3 py-2.5">Category</th>
              <th className="px-3 py-2.5">Score</th>
              <th className="px-3 py-2.5 text-right">Latency</th>
              <th className="px-3 py-2.5 text-right">Tokens</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Excerpt</th>
            </tr>
          </thead>
          <tbody>
            {results.map(r => {
              const isOpen = open === r.item_id;
              const score = r.score || {};
              const ok = score.correct === true;
              const partial = (score.partial != null ? Number(score.partial) : 0).toFixed(2);
              const flag = r.parse_failed ? "leak" : r.error ? "danger" : ok ? "clean" : "";
              const flagText = r.parse_failed ? "parse fail" : r.error ? "error" : ok ? "correct" : "wrong";
              return (
                <React.Fragment key={r.item_id}>
                  <tr
                    className={`border-b border-me-border last:border-0 cursor-pointer hover:bg-me-surface ${isOpen ? "bg-me-surface" : ""}`}
                    onClick={() => setOpen(isOpen ? null : r.item_id)}>
                    <td className="px-3 py-2 text-me-fg">{r.item_id}</td>
                    <td className="px-3 py-2">{r.category || "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`me-miniflag ${flag}`}>{flagText}</span>
                      <span className="ml-1 text-me-fg-3">{partial}</span>
                    </td>
                    <td className="px-3 py-2 text-right">{window.BenchData.fmtMs(r.latency_ms)}</td>
                    <td className="px-3 py-2 text-right">{r.output_tokens ?? "—"}</td>
                    <td className="px-3 py-2">{r.http_status ?? "—"}</td>
                    <td className="px-3 py-2 truncate max-w-[40ch] text-me-fg-3">
                      {(r.raw || "").slice(0, 80) || "—"}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-me-border last:border-0 bg-me-surface">
                      <td colSpan={7} className="px-3 py-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <Excerpt label="response" body={r.raw} />
                          <Excerpt label="score breakdown" body={score.breakdown ? JSON.stringify(score.breakdown, null, 2) : "—"} />
                        </div>
                        {r.error && (
                          <div className="mt-2 font-mono text-[11px] text-me-danger">error: {r.error}</div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Excerpt({ label, body }) {
  return (
    <div>
      <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-me-fg-3 mb-1.5">{label}</div>
      <pre className="font-mono text-[11px] text-me-fg-2 whitespace-pre-wrap break-words bg-me-bg p-3 border border-me-border max-h-[300px] overflow-auto">
        {body || "—"}
      </pre>
    </div>
  );
}

function ManifestPanel({ manifest }) {
  const [show, setShow] = useDetailS(false);
  return (
    <section className="mt-2">
      <SectionHead num="//" title="Manifest" sub="reproducibility-critical fingerprint" />
      <div className="me-card p-4">
        <div className="font-mono text-[11px] text-me-fg-3 mb-2">
          comparability key:&nbsp;
          <code className="text-me-fg-2">{manifest.comparability_key}</code>
        </div>
        <button
          className="me-chip mt-1"
          onClick={() => setShow(s => !s)}>
          {show ? "hide manifest json" : "show manifest json"}
        </button>
        {show && (
          <pre className="mt-3 font-mono text-[11px] text-me-fg-2 whitespace-pre-wrap break-words bg-me-bg p-3 border border-me-border max-h-[400px] overflow-auto">
            {JSON.stringify(manifest, null, 2)}
          </pre>
        )}
      </div>
    </section>
  );
}

window.RunDetail = RunDetail;
