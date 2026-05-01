# local-llms v2 roadmap

What is left after the v2 push. Not a project plan, just a list so things don't slip.

## Deferred adapters

### HumanEval

Needs sandboxed python execution, which is the real complexity (the rest of the adapter is just `mmlu`-shaped).

- Source: `openai_humaneval`, split `test`, 164 problems. Each row has `prompt` (signature + docstring), `test`, `entry_point`, `canonical_solution`.
- Prompt: send signature + docstring, ask for a body. Parse first python code block (fallback: whole response is code, strip fences).
- Score: pass@1. Concatenate `prompt + completion + test`, run with a timeout, mark correct if no exception.
- Sandbox: `firejail` subprocess on Linux (works in WSL2). Forbid network, restrict writes to `/tmp`, hard timeout. Leave a `--sandbox=docker` flag stub for hardening later.
- Tests: replay a known-good completion per fixture problem to prove the sandbox + scorer agree.

### SWE-ReBench v2

The big one. Needs Docker, real test runners, log parsing.

- Source: `nebius/swe-rebench-v2`. Each task is a real GitHub issue with the failing test, repo state at the failing commit, the reference patch, and the passing test set.
- Adapter responsibilities:
  - Provision a Docker container with the right toolchain per repo (canonical SWE-bench images cover most of it).
  - Apply failing-state checkout, send issue + relevant code to the model, ask for a patch.
  - Apply the patch (fuzzy patch tools when models drift line numbers), run the test suite, score by pass count.
- Subset for v2: 50 items. Full pass is multi-hour even on a 5090.
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
- Subset for v2: 100 items. Full set is large and most of it does not discriminate among local 7B-70B models.

## Phase 7 cutover

The bash launcher and v1 unit are still authoritative. Switching to v2 is its own risk surface.

- `llms install`: copies `config/llama-server.v2.service` to `/etc/systemd/system/`, runs `daemon-reload`, stops v1, enables + starts v2. Captures `git rev-parse HEAD` from the provider checkout into a metadata file so `manifest.provider.git_commit` populates.
- `llms uninstall`: roll back to v1 cleanly. Useful for testing without bricking the GPU.
- Trim `setup.sh` to bootstrap python toolchain (uv, py 3.12) + call `llms install`. Drop the bash builder paths.
- Move v1 shell to `archive/` once their CLI replacements ship: `config/llama-launcher.sh`, `config/select-model.sh`, `scripts/benchmark.sh`, `scripts/benchmark-5090-suite.sh`, `scripts/bench.sh`.
- `.github/workflows/ci.yml`: pre-commit + pytest. Nothing GPU-dependent (eval runner uses `httpx.MockTransport`).

## Quality of life

- `llms eval run --max-items N`: currently has to be set in python by constructing the adapter.
- `llms eval run --dry-run`: render manifest, build the first prompt, print without hitting HTTP.
- `llms endpoint activate --restart`: opt-in `systemctl restart` behind a confirm prompt.
- `llms endpoint stats --endpoint <name>`: filter the stats aggregator. Currently a global rollup, loses signal with multiple endpoints.
- `llms eval list-adapters`: print the registry the CLI walks. Today the user reads source.
- Repo SHA capture in `manifest.repo_sha` uses cwd. Pin to repo root inferred from `llms.__file__` so it does not drift if the user runs from a subdirectory.
- Telemetry record's `endpoint` field stores the profile name (slicing `httpx.Client.base_url` was annoying). Plumb actual base URL through.

## Eval rigor

- Optional log-prob scoring for MCQ adapters. When the endpoint exposes `logprobs`, score by per-letter probability instead of parsed-letter match. Drops parse-failure noise. Gate on capability: only some llama.cpp / ik_llama.cpp builds expose log-probs.
- Parse-retry policy: when a deterministic adapter flags parse-failure, optionally retry the same prompt at higher temperature. The bash harness did this informally with the "reasoning fallback" flag.
- Adapter shuffle policy: MCQ adapters benefit from shuffling choice order to dodge position bias. Add a Protocol method `shuffle(items, seed) -> items` with a no-op default; adapters opt in.
- SQLite index for eval runs: `llms eval list` walks the filesystem and parses every `manifest.json`. Cheap for tens, painful for thousands.
- `llms eval prune --older-than 30d`. Once you accumulate runs the hub gets noisy.

## Operations gaps

- Provider git commit capture: `manifest.provider.git_commit` is None in every shipped run. Fix is `llms provider install` (does not exist yet) writing `git rev-parse HEAD` to the install dir during build.
- `llms config lint --with-files`: optionally check `model_path` and `mmproj_path` exist. Default off because configs are typically authored on a host that does not hold the models.

## Known parity gap with bash launcher

- Float formatting: python renders `temperature: 1.0` as `--temp 1`. Bash kept the literal `1.0`. `llama-server` accepts both. Only matters for diffing journalctl across the cutover.

## Test gaps

- Eval CLI integration: only thinly tested. Add a test that invokes `llms eval run mmlu --endpoint chat-default` end-to-end through `httpx.MockTransport`.
- Wheel build: editable install resolves bundled `prompts/local_smoke/v1.json` correctly via `importlib.resources`. Wheel build inclusion not verified. Add a CI step that builds the wheel and runs `python -m llms eval run local_smoke --base-url http://stub` against a fixture.
- Snapshot regen: command-renderer snapshots in `tests/serving/snapshots/` regenerate via `pytest --snapshot-update`. Document the workflow.

## Stale docs to update post-cutover

- `AGENTS.md` lists `config/llama-launcher.sh` and the `.conf` files as the source of truth.
- `docs/CONFIGURATION.md` describes v1 shell config layering.
- `docs/BENCHMARKING.md` describes the bash harness.
- `docs/SETUP.md` references `setup.sh` flows that change.
- `README.md` claims the project is "shell-native".
