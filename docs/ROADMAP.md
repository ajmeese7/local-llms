# Roadmap

What is left after the current push. Not a project plan, just a list so things don't slip.

## Deferred adapters

### HumanEval

Needs sandboxed python execution, which is the real complexity (the rest of the adapter is just `mmlu`-shaped).

- Source: `openai_humaneval`, split `test`, 164 problems. Each row has `prompt` (signature + docstring), `test`, `entry_point`, `canonical_solution`.
- Prompt: send signature + docstring, ask for a body. Parse first python code block (fallback: whole response is code, strip fences).
- Score: pass@1. Concatenate `prompt + completion + test`, run with a timeout, mark correct if no exception.
- Sandbox: `firejail` subprocess on Linux (works in WSL2). Forbid network, restrict writes to `/tmp`, hard timeout. Leave a `--sandbox=docker` flag stub for hardening later.
- Tests: replay a known-good completion per fixture problem to prove the sandbox + scorer agree.

### SWE-ReBench

The big one. Needs Docker, real test runners, log parsing.

- Source: `nebius/swe-rebench-v2`. Each task is a real GitHub issue with the failing test, repo state at the failing commit, the reference patch, and the passing test set.
- Adapter responsibilities:
  - Provision a Docker container with the right toolchain per repo (canonical SWE-bench images cover most of it).
  - Apply failing-state checkout, send issue + relevant code to the model, ask for a patch.
  - Apply the patch (fuzzy patch tools when models drift line numbers), run the test suite, score by pass count.
- Subset target: 50 items. Full pass is multi-hour even on a 5090.
- Robust patch extraction matters: models emit chat-formatted diffs (markdown fences, line annotations) that need cleanup.
- Defer until HumanEval is green; sandbox patterns carry over.

### MMMU

- Source: `lmms-lab/MMMU`. 12k multimodal MCQs across academic subjects.
- Each item: question text + 1-7 inline images + 4 choices.
- Adapter:
  - Refuse to run unless active profile sets `mmproj_path` (graceful skip).
  - Render OpenAI chat content as `[{type:"text", ...}, {type:"image_url", image_url:{url:"data:image/png;base64,..."}}]`.
  - Encode HF images to base64 PNG.
- Otherwise identical MCQ pattern to MMLU.
- Subset target: 100 items. Full set is large and most of it does not discriminate among local 7B-70B models.

## Quality of life

- `llms eval run --dry-run`: render manifest, build the first prompt, print without hitting HTTP.
- `llms endpoint activate --restart`: opt-in `systemctl restart` behind a confirm prompt.
- `llms endpoint stats --endpoint <name>`: filter the stats aggregator. Currently a global rollup, loses signal with multiple endpoints.
- `llms eval list-adapters`: print the registry the CLI walks. Today the user reads source.
- Telemetry record's `endpoint` field stores the profile name (slicing `httpx.Client.base_url` was annoying). Plumb actual base URL through.

## Eval rigor

### Thinking-mode track

The eval pipeline disables Qwen3-style chain-of-thought by default (`chat_template_kwargs: {enable_thinking: false}` in `llms/eval/http_client.py`). That keeps tight-budget adapters (mmlu max_tokens=8, niah=64, gsm8k=512) from getting starved by hidden reasoning, but it means the shipped suite measures the "fast answer" track only. Adding a parallel reasoning-on track lets users see both numbers and pick the right profile for their workload.

Why a separate track and not just a flag: a model can score 0.80 on MMLU with thinking off and 0.92 with thinking on; those are different evaluations, not different seeds. They need different budgets, different parsing rules, and a distinct comparability key so they do not group together in the hub.

Design sketch:

- **Prompt flag.** Add `enable_thinking: bool | None = None` to `Prompt` (in `llms/eval/types.py`). `None` means "use the eval-pipeline default" (currently off). The HTTP client passes the kwarg through unchanged when set, omits it when None.
- **Adapter opt-in.** Each adapter declares its preferred mode in its constructor or `track`. Default stays "fast answer" so existing comparisons do not silently drift. Reasoning track is a separate track value (e.g. `general_capability_reasoning`) so the comparability key splits the two.
- **Budget overrides.** Reasoning budgets need to be 8-50x bigger. Pin them per-adapter at the reasoning-track default: mmlu 1024, niah 512, gsm8k 4096, local_smoke 4096. Bake into the adapter, not the CLI, so a "reasoning gsm8k" run is reproducible without invocation flags.
- **Parser change.** When thinking is on, the HTTP client must surface both `content` and `reasoning_content`. Extend `CompletionResult` with a `reasoning_text: str | None` field. Adapters can then choose: (a) score `content` only (strict — what would a UI user see), (b) score `reasoning_text + content` concatenated (lenient — give credit for showing the work). gsm8k probably wants (b); mmlu probably wants (a) since the answer letter is supposed to land in `content`. Document the choice per adapter.
- **Throughput accounting.** Reasoning tokens count toward latency but not toward "useful output." Track `reasoning_tokens` separately in `summary.json` and the manifest. The hub should show `total tok/s` and `useful tok/s` as distinct columns so a model that thinks for 3000 tokens to answer "B" does not look fast.
- **Comparability key.** Add `enable_thinking` to the decode fingerprint hash. A reasoning run and a non-reasoning run of the same adapter must not group together; they are different evaluations, not different seeds.
- **Hub UX.** A track filter chip ("fast answer" vs "reasoning") on the home page. Two adapter rows per dataset is fine; users will want to compare them side-by-side for the same model.
- **Reporting.** `report.md` and `report.html` should call out thinking-on runs explicitly in the header so readers do not silently compare apples to oranges.

Open questions to decide before implementing:

- Whether to keep "fast answer" and "reasoning" as separate adapters (`mmlu`, `mmlu_reasoning`) or one adapter with a `--mode` flag. Separate adapters are clearer in the registry; a flag is fewer files. Lean toward separate adapters; the budgets and parsers genuinely diverge.
- Whether to add a `gpt-oss` style "harmony" channel adapter alongside Qwen3-style thinking. The mechanism is similar (separate channel for reasoning) but the wire format differs. Probably one abstraction (`reasoning_text`) covers both, with the HTTP client normalizing.
- Whether to enforce a wall-clock cap. A reasoning run can balloon. `--max-wall-seconds` on the CLI lets users bound a long run instead of discovering at item 80/100 that they have an hour to go.

Tests:
- `httpx.MockTransport` fixture that returns a payload with both `content` and `reasoning_content`. Verify the lenient parser concatenates and the strict parser ignores reasoning.
- Manifest snapshot test that confirms the comparability key changes when `enable_thinking` flips.

- Optional log-prob scoring for MCQ adapters. When the endpoint exposes `logprobs`, score by per-letter probability instead of parsed-letter match. Drops parse-failure noise. Gate on capability: only some llama.cpp / ik_llama.cpp builds expose log-probs.
- Parse-retry policy: when a deterministic adapter flags parse-failure, optionally retry the same prompt at higher temperature. The bash harness did this informally with the "reasoning fallback" flag.
- Adapter shuffle policy: MCQ adapters benefit from shuffling choice order to dodge position bias. Add a Protocol method `shuffle(items, seed) -> items` with a no-op default; adapters opt in.
- SQLite index for eval runs: `llms eval list` walks the filesystem and parses every `manifest.json`. Cheap for tens, painful for thousands.
- `llms eval prune --older-than 30d`. Once you accumulate runs the hub gets noisy.

## Operations gaps

- Provider git commit capture is best-effort today (walks up from the server binary to find a `.git` checkout). System-installed providers or prebuilt tarballs still record `null`. A real `llms provider install` would pin the commit at build time.
- `llms config lint --with-files`: optionally check `model_path` and `mmproj_path` exist. Default off because configs are typically authored on a host that does not hold the models.
- Port `scripts/provider.sh` to `llms provider install|build|list`. The shell script is the only remaining build path that does not have a python equivalent.

## Test gaps

- Eval CLI integration: only thinly tested. Add a test that invokes `llms eval run mmlu --endpoint chat-default` end-to-end through `httpx.MockTransport`.
- Wheel build: editable install resolves bundled `prompts/local_smoke/v1.json` correctly via `importlib.resources`. Wheel build inclusion not verified. Add a CI step that builds the wheel and runs `python -m llms eval run local_smoke --base-url http://stub` against a fixture.
- Snapshot regen: command-renderer snapshots in `tests/serving/snapshots/` regenerate via `pytest --snapshot-update`. Document the workflow.

## CI

- `.github/workflows/ci.yml`: pre-commit + pytest. Nothing GPU-dependent (eval runner uses `httpx.MockTransport`).
