/* ============================================================
   guide.jsx
   Reading guide for GGUF filenames, quant labels, and runtime
   knobs. Renders on the home page below the runs list.

   Reads `reports/profiles.json` to render real model cards from
   the active config tree.
   ============================================================ */

const { useMemo: _guideUseMemo } = React;
const {
  SectionHead: GuideSectionHead,
  Label: GuideLabel,
  MiniFlag: GuideMiniFlag,
} = window;

const QUANT_ROWS = [
  ["F16 / BF16", "16-bit weights", "Highest fidelity, largest files, high VRAM use. Usually a baseline or conversion source, not the practical local daily-driver format."],
  ["Q8", "8-bit quant", "Large, close to full precision for many uses, but often not worth the VRAM if Q5/Q6 are good enough."],
  ["Q6", "6-bit quant", "High-quality local choice when the model fits comfortably and you want less quality loss than Q4/Q5."],
  ["Q5", "5-bit quant", "Common balance point: meaningfully smaller than Q6/Q8 while often preserving enough quality for coding and assistant work."],
  ["Q4", "4-bit quant", "Usually the first size that makes bigger models practical on consumer GPUs. Can be fast and useful, but quality and stability vary more."],
  ["IQ / i-quant", "Importance-weighted quant family", "Can be very space-efficient for a given quality target, but compatibility and performance depend more on the backend build."],
];

const SUFFIX_ROWS = [
  ["K", "Modern K-quants", "A GGML/llama.cpp quantization family with mixed block formats. In practice, K-quants are the common Q4/Q5/Q6 files you see shared for local inference."],
  ["S / M / L", "Size-quality tiers", "Usually small, medium, or large variants within the same quant family. Larger generally means more bits or better fidelity, not a bigger base model."],
  ["XL", "Extra-large quant variant", "Often a higher-fidelity variant inside a quant family. Expect more VRAM than the same headline Q level without XL."],
  ["P", "Provider/converter-specific variant", "Used by some model publishers for newer or experimental quant recipes. Treat it as part of the exact artifact identity, then benchmark it on your backend."],
  ["UD", "Unsloth dynamic quant marker", "Common on Unsloth GGUF releases. It usually means the publisher used a dynamic quantization recipe instead of a plain one-size-fits-all quant."],
  ["A3B / A4B", "Active-parameter hint", "For MoE-style models, this usually indicates the approximate active parameters per token, not the full stored parameter count."],
];

const RUNTIME_ROWS = [
  ["Context", "`-c` / `context_length`", "The maximum prompt plus generated-token window. Bigger context consumes more KV cache memory and can reduce practical throughput."],
  ["KV cache", "`--cache-type-k/v`", "Memory used to remember previous tokens. Lower-bit KV cache can unlock long context, but may affect quality or stability."],
  ["GPU layers", "`-ngl` / `gpu_layers`", "How much of the model runs on GPU. More GPU layers usually means faster inference until VRAM runs out."],
  ["Parallel slots", "`-np` / `parallel_slots`", "How many requests the server can process in parallel. Higher values divide memory and can change latency."],
  ["Jinja", "`--jinja`", "Uses the model's chat template. Many modern Qwen-style GGUFs need this for prompt formatting to match the model's training format."],
  ["mmproj", "`--mmproj`", "A multimodal projector file that lets a text model accept image embeddings when the model family supports it."],
  ["Speculation", "`ngram-mod`, draft flags", "A speed trick that drafts likely repeated tokens. It works best on repeated long-context workloads and can be backend-specific."],
  ["Provider", "endpoint `provider`", "The backend binary doing inference. The same GGUF can behave differently across llama.cpp and ik_llama.cpp, so compatibility belongs in the profile."],
];

function guideTokensForProfile(profile) {
  const tokens = [];
  const file = profile.model_filename || "";
  const quant = window.BenchData.extractQuant(file);
  const active = file.match(/(\d+B)-A(\d+B)/i);
  const family = file.replace(/\.gguf$/i, "").split(/-(?=(?:UD-)?(?:IQ?\d+_|Q\d+_|F16|F32|BF16))/i)[0];

  if (family) tokens.push(["Family", family]);
  if (active) tokens.push(["MoE hint", `${active[1]} total line, about ${active[2]} active`]);
  if (/UD-/i.test(file)) tokens.push(["Recipe", "UD dynamic quant"]);
  if (quant) tokens.push(["Quant", quant]);
  if (profile.has_mmproj) tokens.push(["Projector", "multimodal companion file"]);
  tokens.push(["Format", "GGUF"]);
  return tokens;
}

function GuideInfoTable({ rows }) {
  return (
    <div className="me-card overflow-hidden">
      <table className="w-full" style={{borderCollapse: "collapse"}}>
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

function ReadingCard({ title, children, accent = "cyan" }) {
  const cls = accent === "magenta" ? "border-l-me-magenta" : accent === "warning" ? "border-l-me-warning" : "border-l-me-cyan";
  return (
    <div className={`me-card border-l-[3px] ${cls} p-4 md:p-5`}>
      <h3 className="font-display text-[13px] md:text-[15px] tracking-[0.14em] uppercase m-0 mb-3">{title}</h3>
      <div className="text-[13px] md:text-[14px] leading-relaxed text-me-fg-2">{children}</div>
    </div>
  );
}

function ProfileCard({ profile }) {
  const tokens = guideTokensForProfile(profile);
  const compat = profile.provider_compat || {};
  const compatLabel = [
    compat.proven?.length ? `proven on ${compat.proven.join(", ")}` : null,
    compat.blocked?.length ? `blocked on ${compat.blocked.join(", ")}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="me-card p-4 md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
        <div>
          <div className="me-eyebrow mb-1">{profile.name}</div>
          <h3 className="font-display text-[14px] md:text-[16px] tracking-[0.12em] uppercase m-0 text-me-fg">{profile.alias}</h3>
        </div>
        <div className="flex flex-wrap gap-1">
          {tokens.slice(-3).map(([label, value]) => (
            <GuideMiniFlag key={`${label}-${value}`} kind={label === "Quant" ? "clean" : ""}>{value}</GuideMiniFlag>
          ))}
        </div>
      </div>

      <div className="font-mono text-[11px] text-me-fg-2 break-all mb-4" title={profile.model_path}>
        {profile.model_filename || profile.model_path}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
        <div className="p-2.5 bg-white/[0.02] border border-me-border">
          <GuideLabel>Context</GuideLabel>
          <div className="font-mono text-[13px] text-me-cyan mt-1">{profile.context_length ?? "inherited"}</div>
        </div>
        <div className="p-2.5 bg-white/[0.02] border border-me-border">
          <GuideLabel>KV cache</GuideLabel>
          <div className="font-mono text-[13px] text-me-cyan mt-1">
            {(profile.cache_type_k || "default") + "/" + (profile.cache_type_v || "default")}
          </div>
        </div>
      </div>

      <div className="border-t border-me-border">
        {tokens.map(([label, value]) => (
          <div key={`${label}-${value}`} className="grid grid-cols-[96px_1fr] gap-3 py-2 border-b border-me-border/50">
            <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-me-fg-3">{label}</span>
            <span className="font-mono text-[11px] text-me-fg break-all">{value}</span>
          </div>
        ))}
      </div>

      {compatLabel && (
        <div className="mt-3 font-mono text-[10px] text-me-fg-3">{compatLabel}</div>
      )}
      {compat.notes && (
        <div className="mt-1 text-[11px] text-me-fg-3 leading-relaxed">{compat.notes}</div>
      )}
    </div>
  );
}

function GuideSection({ profilesSnapshot }) {
  const profiles = (profilesSnapshot && profilesSnapshot.profiles) || [];

  return (
    <section id="guide" className="mt-16">
      <GuideSectionHead num="//" title="Model Reading Guide" sub="// decode GGUF names, quant labels, and runtime knobs" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ReadingCard title="The Short Version" accent="magenta">
          <p className="mb-3">A GGUF filename is not just a name. It usually tells you the model family, sometimes the active-parameter shape, the quantization recipe, and the file format.</p>
          <p>For daily use, the useful question is not &quot;what is the biggest model?&quot; It is &quot;which quant and backend give enough quality at the latency and context size I can tolerate?&quot;</p>
        </ReadingCard>
        <ReadingCard title="How To Read Q5_K_P" accent="cyan">
          <p className="mb-3"><code>Q5</code> means a 5-bit weight quantization family. <code>K</code> means the modern K-quant family. <code>P</code> is a publisher/converter-specific variant marker.</p>
          <p>That suffix is an artifact identity, not a universal quality guarantee. Compare it on your hardware before treating it as better than another Q5.</p>
        </ReadingCard>
        <ReadingCard title="Why It Matters" accent="warning">
          <p className="mb-3">Quantization controls the model file size, VRAM pressure, load feasibility, and often output quality. Runtime flags control how much memory the context and server behavior consume.</p>
          <p>The same model file can be good on one backend and unusable on another, which is why this repo records provider compatibility in the profile.</p>
        </ReadingCard>
      </div>

      <GuideSectionHead num="//" title="Quant Levels" sub="// rough local-inference tradeoffs" />
      <GuideInfoTable rows={QUANT_ROWS} />

      <GuideSectionHead num="//" title="Suffixes & Markers" sub="// common patterns, not universal laws" />
      <GuideInfoTable rows={SUFFIX_ROWS} />

      <GuideSectionHead num="//" title="Runtime Knobs" sub="// the filename is only half the story" />
      <GuideInfoTable rows={RUNTIME_ROWS} />

      {profiles.length > 0 && (
        <>
          <GuideSectionHead num="//" title="Profiles In This Repo" sub="// parsed from the active config tree" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {profiles.map(profile => <ProfileCard key={profile.name} profile={profile} />)}
          </div>
        </>
      )}

      <GuideSectionHead num="//" title="Practical Rules" sub="// fast interpretation while picking a profile" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <ReadingCard title="Start At Q5" accent="cyan">
          Q5 is often the first comparison point for a daily driver. Move down to Q4 when the model does not fit or latency matters more; move up to Q6/Q8 when quality matters and you have headroom.
        </ReadingCard>
        <ReadingCard title="Context Is Memory" accent="magenta">
          A 262k context window is not free. Long context increases KV cache memory, and parallel slots multiply the pressure. Reduce context before assuming the model itself is impossible.
        </ReadingCard>
        <ReadingCard title="Backend Is Part Of The Profile" accent="warning">
          llama.cpp and ik_llama.cpp can disagree on flags, templates, speed, and even basic compatibility. Treat provider results as separate benchmark evidence.
        </ReadingCard>
        <ReadingCard title="Benchmark The Exact File" accent="cyan">
          Small suffix changes can reflect different quantizers or recipes. <code>Q5_K_M</code>, <code>Q5_K_XL</code>, and <code>Q5_K_P</code> should be compared as exact artifacts, not as interchangeable Q5 labels.
        </ReadingCard>
      </div>
    </section>
  );
}

window.GuideSection = GuideSection;
