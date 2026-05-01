# Local LLMs v2 Redesign Plan

## Goal

Build a clean, reproducible, production-oriented local LLM platform with:

- **Reliable OpenAI-compatible endpoint management** (create/switch/canary/rollback).
- **Capability-aware runtime orchestration** for multiple providers (`llama.cpp`, `ik_llama.cpp`).
- **High-signal benchmarking and evaluation** with reproducible manifests and rigorous scoring.
- **Clear quality + performance release gates** so model/profile changes are safe and measurable.

---

## 1) External Evaluation Sources to Integrate (with links)

Use each source as an **adapter pattern** (not as one blended score):

- **SciCode** (scientific/code tasks): <https://github.com/scicode-bench/SciCode>
- **tau2-bench** (agentic/code-like workflows): <https://github.com/sierra-research/tau2-bench>
- **OpenAI simple-evals** (lightweight eval harness patterns): <https://github.com/openai/simple-evals>
- **MMMU** (multimodal reasoning): <https://github.com/MMMU-Benchmark/MMMU>
- **HLE** (high-level capability/safety-ish evaluation framing): <https://github.com/centerforaisafety/hle>
- **Confabulations** (hallucination/confabulation-focused tasks): <https://github.com/lechmazur/confabulations>
- **EQBench long-form context**: <http://eqbench.com/about.html#long>
- **SimpleBench** (broad benchmark framing): <https://github.com/simple-bench/SimpleBench>
- **SWE-ReBench site**: <https://swe-rebench.com/>
- **SWE-ReBench v2 datasets**: <https://huggingface.co/collections/nebius/swe-rebench-v2>

### Integration policy

1. Keep each benchmark in a **separate track**.
2. Track-specific prompts/scorers only.
3. Publish a matrix report (track-by-track), not a single vanity score.
4. Add a weighted aggregate only for internal ranking and always show component tracks.

---

## 2) Target v2 Architecture

### Two-plane model

1. **Serving Plane (`service/`)**
   - Endpoint lifecycle API
   - Provider/runtime orchestration
   - Routing, health, rollback, telemetry

2. **Evaluation Plane (`eval/`)**
   - Dataset adapters
   - Prompt templates and policies
   - Scoring + confidence intervals
   - Run manifests and reporting

### Why this matters

- Removes coupling between deployment logic and research/eval scripts.
- Enables API-first testing against stable contracts.
- Makes model quality decisions auditable and reproducible.

---

## 3) Repository Layout (proposed)

```text
local-llms-v2/
├─ docs/
├─ schemas/
├─ config/
├─ service/
├─ eval/
├─ scripts/
├─ ci/
└─ examples/
```

Recommended details are already covered in the earlier draft; implement this as a strict module boundary:

- `service/` cannot import benchmark-specific code.
- `eval/` talks to `service/` only via OpenAI-compatible HTTP.

---

## 4) Serving Plane: Complete Implementation Plan

### 4.1 Control plane API (source of truth)

Implement endpoint lifecycle APIs:

- `POST /endpoints`
- `PATCH /endpoints/{id}`
- `POST /endpoints/{id}/activate`
- `POST /endpoints/{id}/canary`
- `POST /endpoints/{id}/rollback`
- `GET /endpoints/{id}/revisions`
- `GET /health/endpoints`

#### Requirements

- DB-backed state (SQLite initially; Postgres-ready abstraction).
- Idempotent state transitions.
- Full revision history with actor + timestamp + reason.
- Rollback pointer for every activation.

### 4.2 Provider capability model

Define provider capabilities (example flags):

- `supports_jinja`
- `supports_mmproj`
- `supports_ngram_mod`
- `supports_spec_default`
- `supports_context_length_limit_override`

#### Requirements

- Capability check before launch.
- Helpful errors (e.g., profile requires unsupported `ngram-mod`).
- Launch command renderer tested with snapshots.

### 4.3 Typed configuration

Replace ad hoc config behavior with schema-driven config:

- `model_profile.schema.json`
- `provider.schema.json`
- `hardware_class.schema.json`
- `endpoint.schema.json`

Merge precedence:

1. global defaults
2. hardware class
3. provider defaults
4. model profile
5. endpoint overrides
6. emergency env override (must be logged)

### 4.4 Operational safety

- Canary traffic splitting
- Automatic rollback on SLO breach
- Startup preflight:
  - binary exists
  - model file exists
  - VRAM estimate pass
  - context length sanity
- Health policy:
  - liveness
  - readiness
  - warmup complete

### 4.5 Security + resource controls

- API key auth
- Rate limiting
- Max input/output token caps
- Request size limits
- Endpoint-level quotas

### 4.6 Telemetry

Capture per request:

- TTFT
- end-to-end latency
- output tokens/sec
- errors (typed)
- retries
- GPU memory headroom (if available)

---

## 5) Evaluation Plane: Complete Implementation Plan

### 5.1 Benchmark taxonomy (fixed)

Create tracks:

1. `code_agentic`
   - SciCode
   - tau2-style
   - SWE-ReBench v2
2. `multimodal_reasoning`
   - MMMU
3. `general_capability`
   - simple-evals patterns
   - SimpleBench patterns
4. `reliability_factuality`
   - HLE-style tasks
   - Confabulations
   - EQBench-inspired long context behavior

### 5.2 Adapter contract per benchmark family

Each adapter must define:

- dataset normalization
- prompt policy
- output schema
- parser
- scorer
- failure handling

No adapter = no run.

### 5.3 Prompt governance

Store prompts as versioned assets with metadata:

- template ID (`track/name/vN`)
- changelog
- expected JSON schema
- anti-leak constraints
- intended benchmark(s)

Prompt QA gates:

1. template render tests
2. schema parse tests
3. small canary (e.g., 20 items)
4. drift check vs prior version
5. manual approval if drift > threshold

### 5.4 Reproducibility via run manifests

Create immutable manifest objects containing:

- model ID, quant, model file hash
- provider and binary version
- decode params
- prompt template versions
- dataset versions/commits
- adapter/scorer versions
- random seeds
- repo commit SHA
- execution timestamp

Rule: **No manifest, no eval run.**

### 5.5 Scoring rigor

Required outputs:

- primary metrics per track
- category/subtask breakdown
- parse-failure rates
- bootstrap confidence intervals
- contamination/leakage flags
- comparability status (comparable/not comparable)

### 5.6 Reporting

Per run report sections:

1. run metadata and comparability
2. quality matrix by track
3. uncertainty intervals
4. performance/SLO metrics
5. failures and error buckets
6. baseline deltas and regression calls

---

## 6) CI/CD and Release Gates

### 6.1 PR checks (fast)

- type/lint/unit tests
- schema/config lint
- command-render snapshot tests
- tiny smoke eval

### 6.2 Nightly checks (medium)

- broader track matrix
- trend updates
- automatic regression notifications

### 6.3 Release-candidate checks (full)

- full benchmark matrix
- load/perf SLO validation
- quality threshold gates
- human approval if any critical regression

### 6.4 Gate design suggestions

- Encode thresholds in versioned policy files (`ci/policies/thresholds.yaml`).
- Keep per-track thresholds separate from platform SLO thresholds.
- Add an explicit override workflow with reason and expiry.

---

## 7) Concrete Step-by-Step Implementation Roadmap

## Phase 0 — Foundation (1–2 days)

1. Create v2 repo/module structure.
2. Add schema scaffolding for config and manifests.
3. Add baseline CLI entry points (`llmctl`, `evalctl`).

## Phase 1 — Config + provider core (3–5 days)

1. Build schema validator and deterministic merge logic.
2. Implement provider capability interface + two providers.
3. Add launch command renderer tests.

## Phase 2 — Control plane MVP (5–7 days)

1. Add DB models and migrations.
2. Implement endpoint CRUD/activate/rollback APIs.
3. Wire runtime launcher and health checks.
4. Add telemetry collection and basic dashboards/log exports.

## Phase 3 — Eval MVP (5–8 days)

1. Implement run manifest builder/validator.
2. Build at least two adapters (`code_agentic`, `general_capability`).
3. Add prompt versioning + render/parse tests.
4. Produce first matrix report with confidence intervals.

## Phase 4 — Hardened release flow (4–6 days)

1. Implement PR/nightly/release CI pipelines.
2. Add regression detection and gating policies.
3. Add canary deployment and auto-rollback triggers.

## Phase 5 — Expansion (ongoing)

1. Add multimodal and reliability tracks.
2. Integrate additional benchmark families and datasets.
3. Improve contamination checks and stratified analysis.
4. Add richer HTML dashboards.

---

## 8) Suggestions to Meet Requirements Reliably

### Requirement: clean endpoint management

- Keep endpoint state in DB revisions, not only file writes.
- Require preflight validation before activation.
- Make rollback one command/API call and test it in CI.

### Requirement: trustworthy benchmark outputs

- Enforce manifest pinning for every run.
- Separate prompt versions per benchmark track.
- Include uncertainty intervals and failure rates in all reports.

### Requirement: stable comparisons over time

- Add comparability checks (same dataset version, scorer version, prompt version family, provider mode).
- Mark non-comparable runs loudly in reports.

### Requirement: avoid accidental metric gaming

- Keep hidden canary subsets.
- Prevent prompt leakage via explicit anti-leak rules.
- Track long-term trend and variance, not only single wins.

### Requirement: practical operations

- Define SLOs before production use.
- Tie canary auto-rollback directly to SLO breach + error-rate spikes.
- Document incident playbooks in `docs/runbooks/`.

---

## 9) Definition of Done (DoD)

You can consider v2 successful when:

1. New model profile can be added without changing launcher core code.
2. Endpoint switch + rollback is revisioned, auditable, and scripted.
3. Eval runs are reproducible from manifest alone.
4. Reports include quality + performance + uncertainty + failure analysis.
5. CI blocks releases on configurable regressions.
6. Track-level scorecard is available and comparable across runs.

---

## 10) Starter Backlog (copy into issues)

1. Implement JSON schemas for profile/provider/manifest.
2. Build `llmctl config lint` command.
3. Build provider capability registry and validators.
4. Build endpoint revision table + activate/rollback endpoints.
5. Add launch preflight validator (model path/VRAM/context).
6. Implement run manifest object and storage.
7. Implement adapter base interface.
8. Add first `code_agentic` adapter (SWE-ReBench path).
9. Add first `general_capability` adapter (simple-evals style).
10. Add prompt template versioning + tests.
11. Add bootstrap CI computation for metrics.
12. Generate markdown + HTML reports.
13. Add comparability checker.
14. Add PR smoke eval pipeline.
15. Add release gate policy runner.

---

## 11) Minimal commands to target in v2

- `llmctl config lint`
- `llmctl endpoint create -f config/endpoints/chat-default.yaml`
- `llmctl endpoint activate chat-default`
- `llmctl endpoint rollback chat-default --to-revision <n>`
- `evalctl manifest create -f examples/eval-manifest-full.yaml`
- `evalctl run --manifest <id>`
- `evalctl rerun --manifest <id>`
- `evalctl diff --run <a> --run <b>`
- `evalctl report --run <id> --format html`

---

## 12) Final Notes

- Prioritize architecture and reproducibility over maximizing benchmark counts early.
- Benchmark breadth can expand later; non-reproducible results are a dead end.
- Preserve explicit model/profile ownership: model behavior in overlays, runtime behavior in provider capability/rendering layers.
