# eval module

`eval/` is a first-class evaluation module.

## Stable interface to service

`eval/` interacts with runtimes strictly through an OpenAI-compatible API (`/v1/models`, `/v1/chat/completions`). It does **not** shell into launcher/provider scripts.

## CLI

- `eval/bin/eval.sh list-models`
- `eval/bin/eval.sh chat-smoke <model>`
- `eval/bin/benchmark.sh ...`

## Config

- Module defaults: `eval/config/eval.conf`
- Environment overrides: `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `REQUEST_TIMEOUT_SECONDS`.

## Versioning

- Independent semantic version in `eval/VERSION`.

## Tests

- `eval/tests/test_cli.sh`
- `scripts/check-syntax.sh`
