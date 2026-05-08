/* ============================================================
   methodology.jsx — top-level Methodology page.

   Generic guidance: scoring, GGUF/quant labels, runtime knobs.
   Lives at #/methodology, accessible from the nav. Not scoped
   to any individual bench because the explanations are.
   ============================================================ */

const METHOD_QUANT_ROWS = [
  ["F16 / BF16", "16-bit weights", "Highest fidelity, largest files, high VRAM use. Usually a baseline or conversion source, not the practical local daily-driver format."],
  ["Q8", "8-bit quant", "Large, close to full precision for many uses, but often not worth the VRAM if Q5/Q6 are good enough."],
  ["Q6", "6-bit quant", "High-quality local choice when the model fits comfortably and you want less quality loss than Q4/Q5."],
  ["Q5", "5-bit quant", "Common balance point: meaningfully smaller than Q6/Q8 while often preserving enough quality for coding and assistant work."],
  ["Q4", "4-bit quant", "Usually the first size that makes bigger models practical on consumer GPUs. Can be fast and useful, but quality and stability vary more."],
  ["IQ / i-quant", "Importance-weighted quant family", "Can be very space-efficient for a given quality target, but compatibility and performance depend more on the backend build."],
];

const METHOD_RUNTIME_ROWS = [
  ["Context", "`-c` / `context_length`", "Maximum prompt + generated-token window. Bigger context costs KV cache memory and can reduce throughput."],
  ["KV cache", "`--cache-type-k/v`", "Memory used to remember previous tokens. Lower-bit KV cache can unlock long context, but may affect quality."],
  ["GPU layers", "`-ngl` / `gpu_layers`", "How much of the model runs on GPU. More GPU layers usually means faster inference until VRAM runs out."],
  ["Parallel slots", "`-np` / `parallel_slots`", "How many requests the server can process in parallel. Higher values divide memory and shift latency."],
  ["Jinja", "`--jinja`", "Uses the model's chat template. Many modern Qwen-style GGUFs need this for prompt formatting to match training."],
  ["Speculation", "`ngram-mod`, draft flags", "A speed trick that drafts likely repeated tokens. Backend-specific and most useful on long-context workloads."],
];

function MethodologyPage({ profilesSnap }) {
  const cards = [
    { id: "method.scoring",    icon: "fa-list-check", title: "Scoring",            body: "Hard-graded adapters (mmlu, gsm8k, niah) report accuracy with a 95% bootstrap CI. Rubric adapters (local_smoke) report partial-credit means. The hub picks whichever is appropriate per cell as the headline 'Quality' number." },
    { id: "method.timings",    icon: "fa-stopwatch",  title: "Timings",            body: "Latency is end-to-end /chat/completions response time with stream:false. Throughput is output_tokens divided by latency. Both are medians across the items in a cell, not means, so a single hung request doesn't dominate." },
    { id: "method.cleanliness",icon: "fa-broom",      title: "Reasoning leakage",  body: "Each response is classified clean / leak / empty by inspecting the raw model output. Leak = visible <think> block or 'thinking process:' preamble. Empty = no usable content (an empty think block, or content placed in reasoning_content with no answer)." },
    { id: "method.compare",    icon: "fa-code-compare", title: "Comparability",    body: "Two cells are apples-to-apples when they share a comparability_key (SHA-256 of model + provider + decode + dataset + adapter). Re-runs across hardware OC profiles produce the same key but the GPU state ribbon will differ — read it before treating two runs as equivalent." },
  ];

  const profiles = (profilesSnap?.profiles || []);

  return (
    <section data-screen-label="Methodology">
      <a
        href="#/"
        onClick={(e) => { e.preventDefault(); location.hash = "#/"; }}
        className="inline-flex items-center gap-1.5 mb-4 px-3 py-1.5 font-mono text-[10px] tracking-[0.18em] uppercase text-me-fg-3 border border-me-border hover:text-me-fg hover:border-me-border-strong transition-colors">
        <i className="fa-solid fa-arrow-left"></i> All benches
      </a>
      <div className="hero-bg relative overflow-hidden border border-me-border p-5 md:p-8 lg:p-9 mb-6">
        <div className="me-eyebrow mb-3">
          <i className="fa-solid fa-book-open text-me-cyan mr-1.5"></i> Methodology
        </div>
        <h1 className="hero-title my-2">How the numbers are made</h1>
        <p className="font-mono text-[13px] md:text-[15px] text-me-fg-2 max-w-[80ch]">
          // generic to the harness — not scoped to any one bench
        </p>
      </div>

      <SectionHead num="01" title="Scoring & Cleanliness" sub="// what a cell's headline numbers actually report" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.id} className="me-card p-4 md:p-5">
            <h3 className="font-display text-[13px] md:text-[14px] tracking-[0.18em] uppercase mt-0 mb-3 text-me-fg">
              <i className={`fa-solid ${c.icon} text-me-cyan mr-2`}></i> {c.title}
            </h3>
            <p className="text-[13px] leading-relaxed text-me-fg-2 m-0">{c.body}</p>
          </div>
        ))}
      </div>

      <SectionHead num="02" title="Reading GGUF" sub="// quant labels you'll see in this repo" />
      <MethodTable rows={METHOD_QUANT_ROWS} />

      <SectionHead num="03" title="Runtime knobs" sub="// the filename is only half the story" />
      <MethodTable rows={METHOD_RUNTIME_ROWS} />

      {profiles.length > 0 && (
        <>
          <SectionHead num="04" title="Profiles in this repo" sub="// from config/profiles/*.conf" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {profiles.map(p => <MethodProfileCard key={p.name} profile={p} />)}
          </div>
        </>
      )}
    </section>
  );
}

function MethodTable({ rows }) {
  return (
    <div className="me-card overflow-hidden">
      <table className="w-full" style={{ borderCollapse: "collapse" }}>
        <tbody>
          {rows.map(([term, meaning, why]) => (
            <tr key={term}>
              <td className="p-3 md:p-4 border-b border-me-border/60 align-top w-[120px] md:w-[160px]">
                <div className="font-mono text-[12px] md:text-[13px] text-me-cyan break-all">{term}</div>
              </td>
              <td className="p-3 md:p-4 border-b border-me-border/60 align-top w-[150px] md:w-[220px]">
                <div className="font-mono text-[11px] md:text-[12px] text-me-fg">{meaning}</div>
              </td>
              <td className="p-3 md:p-4 border-b border-me-border/60 align-top">
                <div className="text-[12px] md:text-[13px] leading-relaxed text-me-fg-2">{why}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MethodProfileCard({ profile }) {
  const file = profile.model_filename || profile.model_path;
  const quant = window.BenchData.extractQuant(file || "");
  return (
    <div className="me-card p-4 md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
        <div>
          <div className="me-eyebrow mb-1">{profile.name}</div>
          <h3 className="font-display text-[14px] md:text-[16px] tracking-[0.12em] uppercase m-0 text-me-fg">{profile.alias}</h3>
        </div>
        <div className="flex flex-wrap gap-1">
          {quant && <MiniFlag kind="clean">{quant}</MiniFlag>}
          {profile.has_mmproj && <MiniFlag>mmproj</MiniFlag>}
          {profile.kv_unified && <MiniFlag>kv unified</MiniFlag>}
        </div>
      </div>
      <div className="font-mono text-[11px] text-me-fg-2 break-all mb-4" title={profile.model_path}>
        {file || "—"}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="p-2.5 bg-white/[0.02] border border-me-border">
          <Label>Context</Label>
          <div className="font-mono text-[13px] text-me-cyan mt-1">{profile.context_length ?? "inherited"}</div>
        </div>
        <div className="p-2.5 bg-white/[0.02] border border-me-border">
          <Label>KV cache</Label>
          <div className="font-mono text-[13px] text-me-cyan mt-1">
            {(profile.cache_type_k || "default") + "/" + (profile.cache_type_v || "default")}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { MethodologyPage });
