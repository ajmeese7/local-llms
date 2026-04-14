#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS_ROOT_DEFAULT="$ROOT_DIR/benchmark-results"

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

note() {
    printf '%s\n' "$*"
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

timestamp() {
    date +%Y%m%d-%H%M%S
}

make_run_dir() {
    local label="$1"
    local run_dir="${RESULTS_ROOT:-$RESULTS_ROOT_DEFAULT}/$(timestamp)-$label"
    mkdir -p "$run_dir"
    printf '%s\n' "$run_dir"
}

strip_trailing_slash() {
    local value="$1"
    printf '%s\n' "${value%/}"
}

usage() {
    cat <<'EOF'
Usage:
  scripts/benchmark.sh api [options]
  scripts/benchmark.sh llama-bench [options]
  scripts/benchmark.sh lm-eval [options]
  scripts/benchmark.sh compare [options]

Subcommands:
  api
    Run repeated timing tests against an OpenAI-compatible endpoint and save
    raw responses plus a TSV summary.

    Options:
      --base-url URL         Base API URL, default: http://127.0.0.1:8000/v1
      --model NAME           Model name reported by the API
      --mode MODE            completions or chat, default: completions
      --prompt TEXT          Inline prompt text
      --prompt-file PATH     Read prompt text from a file
      --iterations N         Number of requests, default: 5
      --max-tokens N         Max output tokens, default: 256
      --temperature FLOAT    Sampling temperature, default: 0
      --api-key KEY          Bearer token, default: API_KEY or OPENAI_API_KEY
      --label NAME           Optional label for results directory

  llama-bench
    Run llama.cpp's llama-bench multiple times and store each run log.

    Options:
      --model-file PATH      GGUF model path
      --runs N               Number of runs, default: 3
      --llama-bench PATH     Path to llama-bench binary
      --label NAME           Optional label for results directory
      --extra-arg ARG        Extra argument passed through to llama-bench

  lm-eval
    Run EleutherAI lm-eval against a local OpenAI-compatible endpoint.

    Options:
      --base-url URL         Base API URL, default: http://127.0.0.1:8000/v1/completions
      --model NAME           Model name reported by the API
      --tasks LIST           Comma-separated task list
      --backend NAME         local-completions or local-chat-completions,
                             default: local-completions
      --num-concurrent N     Request concurrency, default: 1
      --batch-size N         Batch size, default: 1
      --limit N              Optional sample limit for quick comparisons
      --api-key KEY          Bearer token, default: API_KEY or OPENAI_API_KEY
      --label NAME           Optional label for results directory
      --extra-model-arg ARG  Extra model_args fragment, may be repeated
      --extra-arg ARG        Extra lm_eval CLI arg, may be repeated

  compare
    Build a Markdown comparison table from saved API benchmark runs.

    Options:
      --run-dir PATH         Benchmark run directory from `api`, may be repeated
      --output PATH          Optional Markdown output file
EOF
}

build_request_body() {
    local mode="$1"
    local model="$2"
    local prompt="$3"
    local max_tokens="$4"
    local temperature="$5"

    python3 - "$mode" "$model" "$prompt" "$max_tokens" "$temperature" <<'PY'
import json
import sys

mode, model, prompt, max_tokens, temperature = sys.argv[1:]
payload = {
    "model": model,
    "max_tokens": int(max_tokens),
    "temperature": float(temperature),
}

if mode == "chat":
    payload["messages"] = [{"role": "user", "content": prompt}]
elif mode == "completions":
    payload["prompt"] = prompt
else:
    raise SystemExit(f"unsupported mode: {mode}")

print(json.dumps(payload))
PY
}

append_api_row() {
    local tsv_file="$1"
    local run_id="$2"
    local http_code="$3"
    local time_total="$4"
    local time_starttransfer="$5"
    local response_file="$6"
    local mode="$7"

    python3 - "$tsv_file" "$run_id" "$http_code" "$time_total" "$time_starttransfer" "$response_file" "$mode" <<'PY'
import json
import sys
from pathlib import Path

tsv_path = Path(sys.argv[1])
run_id = sys.argv[2]
http_code = sys.argv[3]
time_total = float(sys.argv[4])
time_starttransfer = float(sys.argv[5])
response_path = Path(sys.argv[6])
mode = sys.argv[7]

prompt_tokens = ""
completion_tokens = ""
total_tokens = ""
output_chars = ""
tokens_per_sec = ""

if response_path.exists():
    try:
        data = json.loads(response_path.read_text())
        usage = data.get("usage") or {}
        prompt_tokens = usage.get("prompt_tokens", "")
        completion_tokens = usage.get("completion_tokens", "")
        total_tokens = usage.get("total_tokens", "")

        text = ""
        choices = data.get("choices") or []
        if choices:
            choice = choices[0]
            if mode == "chat":
                message = choice.get("message") or {}
                content = message.get("content", "")
                if isinstance(content, list):
                    text = "".join(
                        part.get("text", "")
                        for part in content
                        if isinstance(part, dict)
                    )
                else:
                    text = str(content)
            else:
                text = str(choice.get("text", ""))
        output_chars = len(text)

        if completion_tokens not in ("", None) and time_total > 0:
            tokens_per_sec = round(float(completion_tokens) / time_total, 3)
    except Exception:
        pass

with tsv_path.open("a", encoding="utf-8") as handle:
    handle.write(
        "\t".join(
            [
                run_id,
                http_code,
                f"{time_total:.3f}",
                f"{time_starttransfer:.3f}",
                str(prompt_tokens),
                str(completion_tokens),
                str(total_tokens),
                str(output_chars),
                str(tokens_per_sec),
            ]
        )
        + "\n"
    )
PY
}

summarize_api_runs() {
    local tsv_file="$1"
    local summary_file="$2"

    python3 - "$tsv_file" "$summary_file" <<'PY'
import csv
import statistics
import sys
from pathlib import Path

tsv_path = Path(sys.argv[1])
summary_path = Path(sys.argv[2])

rows = []
with tsv_path.open(encoding="utf-8") as handle:
    reader = csv.DictReader(handle, delimiter="\t")
    for row in reader:
        rows.append(row)

if not rows:
    raise SystemExit("no API benchmark rows found")

ok_rows = [row for row in rows if row["http_code"] == "200"]

def avg_float(key):
    values = [float(row[key]) for row in ok_rows if row[key]]
    return statistics.mean(values) if values else None

def avg_int(key):
    values = [int(float(row[key])) for row in ok_rows if row[key]]
    return statistics.mean(values) if values else None

lines = []
lines.append(f"runs: {len(rows)}")
lines.append(f"successful_runs: {len(ok_rows)}")

if ok_rows:
    avg_total = avg_float("time_total")
    avg_ttft = avg_float("time_starttransfer")
    avg_prompt_tokens = avg_int("prompt_tokens")
    avg_completion_tokens = avg_int("completion_tokens")
    avg_total_tokens = avg_int("total_tokens")
    avg_tokens_per_sec = avg_float("tokens_per_sec")

    if avg_total is not None:
        lines.append(f"avg_time_total_sec: {avg_total:.3f}")
    if avg_ttft is not None:
        lines.append(f"avg_ttft_sec: {avg_ttft:.3f}")
    if avg_prompt_tokens is not None:
        lines.append(f"avg_prompt_tokens: {avg_prompt_tokens:.1f}")
    if avg_completion_tokens is not None:
        lines.append(f"avg_completion_tokens: {avg_completion_tokens:.1f}")
    if avg_total_tokens is not None:
        lines.append(f"avg_total_tokens: {avg_total_tokens:.1f}")
    if avg_tokens_per_sec is not None:
        lines.append(f"avg_completion_tokens_per_sec: {avg_tokens_per_sec:.3f}")

summary_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("\n".join(lines))
PY
}

run_api_benchmark() {
    require_cmd curl
    require_cmd python3

    local base_url="http://127.0.0.1:8000/v1"
    local model=""
    local mode="completions"
    local prompt="Summarize why consistent benchmark settings matter in one paragraph."
    local prompt_file=""
    local iterations=5
    local max_tokens=256
    local temperature=0
    local api_key="${API_KEY:-${OPENAI_API_KEY:-}}"
    local label="api"

    while [ "$#" -gt 0 ]; do
        case "$1" in
            --base-url) base_url="$2"; shift 2 ;;
            --model) model="$2"; shift 2 ;;
            --mode) mode="$2"; shift 2 ;;
            --prompt) prompt="$2"; shift 2 ;;
            --prompt-file) prompt_file="$2"; shift 2 ;;
            --iterations) iterations="$2"; shift 2 ;;
            --max-tokens) max_tokens="$2"; shift 2 ;;
            --temperature) temperature="$2"; shift 2 ;;
            --api-key) api_key="$2"; shift 2 ;;
            --label) label="$2"; shift 2 ;;
            -h|--help) usage; exit 0 ;;
            *) die "unknown api option: $1" ;;
        esac
    done

    [ -n "$model" ] || die "--model is required"
    case "$mode" in
        completions|chat) ;;
        *) die "--mode must be completions or chat" ;;
    esac

    if [ -n "$prompt_file" ]; then
        [ -f "$prompt_file" ] || die "prompt file not found: $prompt_file"
        prompt="$(cat "$prompt_file")"
    fi

    local endpoint="/completions"
    if [ "$mode" = "chat" ]; then
        endpoint="/chat/completions"
    fi

    local run_dir
    run_dir="$(make_run_dir "$label")"
    local url
    url="$(strip_trailing_slash "$base_url")$endpoint"
    local tsv_file="$run_dir/summary.tsv"
    local summary_file="$run_dir/summary.txt"
    local headers_file="$run_dir/request.txt"

    printf 'run\thttp_code\ttime_total\ttime_starttransfer\tprompt_tokens\tcompletion_tokens\ttotal_tokens\toutput_chars\ttokens_per_sec\n' >"$tsv_file"
    {
        printf 'url=%s\n' "$url"
        printf 'model=%s\n' "$model"
        printf 'mode=%s\n' "$mode"
        printf 'iterations=%s\n' "$iterations"
        printf 'max_tokens=%s\n' "$max_tokens"
        printf 'temperature=%s\n' "$temperature"
    } >"$headers_file"

    local auth_header=()
    if [ -n "$api_key" ]; then
        auth_header=(-H "Authorization: Bearer $api_key")
    fi

    local request_body
    request_body="$(build_request_body "$mode" "$model" "$prompt" "$max_tokens" "$temperature")"

    local i
    for ((i = 1; i <= iterations; i++)); do
        local response_file="$run_dir/response-$i.json"
        local metrics_file="$run_dir/metrics-$i.txt"
        note "api run $i/$iterations -> $response_file"

        curl -sS \
            "${auth_header[@]}" \
            -H "Content-Type: application/json" \
            -o "$response_file" \
            -w 'http_code=%{http_code}\ntime_total=%{time_total}\ntime_starttransfer=%{time_starttransfer}\n' \
            -d "$request_body" \
            "$url" >"$metrics_file"

        local http_code
        local time_total
        local time_starttransfer
        http_code="$(awk -F= '$1=="http_code"{print $2}' "$metrics_file")"
        time_total="$(awk -F= '$1=="time_total"{print $2}' "$metrics_file")"
        time_starttransfer="$(awk -F= '$1=="time_starttransfer"{print $2}' "$metrics_file")"

        append_api_row "$tsv_file" "$i" "$http_code" "$time_total" "$time_starttransfer" "$response_file" "$mode"
    done

    summarize_api_runs "$tsv_file" "$summary_file"
    note "saved API benchmark results to: $run_dir"
}

run_llama_bench() {
    require_cmd python3

    local model_file=""
    local runs=3
    local llama_bench_bin="$HOME/.local/share/llama.cpp/build/bin/llama-bench"
    local label="llama-bench"
    local -a extra_args=()

    while [ "$#" -gt 0 ]; do
        case "$1" in
            --model-file) model_file="$2"; shift 2 ;;
            --runs) runs="$2"; shift 2 ;;
            --llama-bench) llama_bench_bin="$2"; shift 2 ;;
            --label) label="$2"; shift 2 ;;
            --extra-arg) extra_args+=("$2"); shift 2 ;;
            -h|--help) usage; exit 0 ;;
            *) die "unknown llama-bench option: $1" ;;
        esac
    done

    [ -n "$model_file" ] || die "--model-file is required"
    [ -f "$model_file" ] || die "model file not found: $model_file"
    [ -x "$llama_bench_bin" ] || die "llama-bench binary not executable: $llama_bench_bin"

    local run_dir
    run_dir="$(make_run_dir "$label")"
    local tsv_file="$run_dir/runs.tsv"
    printf 'run\telapsed_sec\tstatus\tlog_file\n' >"$tsv_file"

    local i
    for ((i = 1; i <= runs; i++)); do
        local log_file="$run_dir/run-$i.log"
        note "llama-bench run $i/$runs -> $log_file"
        local start_ts
        local end_ts
        local elapsed
        local status

        start_ts="$(date +%s.%N)"
        set +e
        "$llama_bench_bin" -m "$model_file" "${extra_args[@]}" 2>&1 | tee "$log_file"
        status=${PIPESTATUS[0]}
        set -e
        end_ts="$(date +%s.%N)"
        elapsed="$(python3 - "$start_ts" "$end_ts" <<'PY'
import sys
start_value = float(sys.argv[1])
end_value = float(sys.argv[2])
print(f"{end_value - start_value:.3f}")
PY
)"

        printf '%s\t%s\t%s\t%s\n' "$i" "$elapsed" "$status" "$log_file" >>"$tsv_file"

        [ "$status" -eq 0 ] || die "llama-bench failed on run $i"
    done

    note "saved llama-bench logs to: $run_dir"
    note "inspect the pp/tg rows in each log for prompt and generation throughput"
}

run_lm_eval() {
    require_cmd lm_eval

    local base_url="http://127.0.0.1:8000/v1/completions"
    local model=""
    local tasks=""
    local backend="local-completions"
    local num_concurrent=1
    local batch_size=1
    local limit=""
    local api_key="${API_KEY:-${OPENAI_API_KEY:-}}"
    local label="lm-eval"
    local -a extra_model_args=()
    local -a extra_args=()

    while [ "$#" -gt 0 ]; do
        case "$1" in
            --base-url) base_url="$2"; shift 2 ;;
            --model) model="$2"; shift 2 ;;
            --tasks) tasks="$2"; shift 2 ;;
            --backend) backend="$2"; shift 2 ;;
            --num-concurrent) num_concurrent="$2"; shift 2 ;;
            --batch-size) batch_size="$2"; shift 2 ;;
            --limit) limit="$2"; shift 2 ;;
            --api-key) api_key="$2"; shift 2 ;;
            --label) label="$2"; shift 2 ;;
            --extra-model-arg) extra_model_args+=("$2"); shift 2 ;;
            --extra-arg) extra_args+=("$2"); shift 2 ;;
            -h|--help) usage; exit 0 ;;
            *) die "unknown lm-eval option: $1" ;;
        esac
    done

    [ -n "$model" ] || die "--model is required"
    [ -n "$tasks" ] || die "--tasks is required"
    [ -n "$api_key" ] || die "set --api-key or API_KEY/OPENAI_API_KEY for lm-eval"

    local run_dir
    run_dir="$(make_run_dir "$label")"
    local log_file="$run_dir/lm-eval.log"
    local args_file="$run_dir/command.txt"
    local -a eval_cmd

    local model_args="model=$model,base_url=$(strip_trailing_slash "$base_url"),num_concurrent=$num_concurrent,max_retries=3,tokenized_requests=False,batch_size=$batch_size"
    local fragment
    for fragment in "${extra_model_args[@]}"; do
        model_args="$model_args,$fragment"
    done

    {
        printf 'backend=%s\n' "$backend"
        printf 'tasks=%s\n' "$tasks"
        printf 'model_args=%s\n' "$model_args"
    } >"$args_file"

    eval_cmd=(
        lm_eval
        --model "$backend"
        --tasks "$tasks"
        --model_args "$model_args"
    )

    if [ -n "$limit" ]; then
        eval_cmd+=(--limit "$limit")
    fi

    if [ "${#extra_args[@]}" -gt 0 ]; then
        eval_cmd+=("${extra_args[@]}")
    fi

    note "lm-eval -> $log_file"
    OPENAI_API_KEY="$api_key" "${eval_cmd[@]}" 2>&1 | tee "$log_file"

    note "saved lm-eval output to: $run_dir"
}

run_compare() {
    require_cmd python3

    local output=""
    local -a run_dirs=()

    while [ "$#" -gt 0 ]; do
        case "$1" in
            --run-dir) run_dirs+=("$2"); shift 2 ;;
            --output) output="$2"; shift 2 ;;
            -h|--help) usage; exit 0 ;;
            *) die "unknown compare option: $1" ;;
        esac
    done

    [ "${#run_dirs[@]}" -gt 0 ] || die "at least one --run-dir is required"

    python3 - "$output" "${run_dirs[@]}" <<'PY'
import csv
import statistics
import sys
from pathlib import Path

output_path = sys.argv[1]
run_dirs = [Path(value) for value in sys.argv[2:]]


def parse_request_file(path: Path) -> dict:
    data = {}
    if not path.exists():
        return data
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip()
    return data


def mean(values):
    return statistics.mean(values) if values else None


rows = []
for run_dir in run_dirs:
    summary_tsv = run_dir / "summary.tsv"
    request_txt = run_dir / "request.txt"

    if not summary_tsv.exists():
        raise SystemExit(f"run directory is missing summary.tsv: {run_dir}")

    request_meta = parse_request_file(request_txt)

    with summary_tsv.open(encoding="utf-8") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        records = list(reader)

    if not records or "time_total" not in records[0]:
        raise SystemExit(
            f"run directory does not look like an API benchmark result: {run_dir}"
        )

    ok_records = [record for record in records if record["http_code"] == "200"]

    avg_total = mean([float(record["time_total"]) for record in ok_records if record["time_total"]])
    avg_ttft = mean(
        [
            float(record["time_starttransfer"])
            for record in ok_records
            if record["time_starttransfer"]
        ]
    )
    avg_tok_s = mean(
        [float(record["tokens_per_sec"]) for record in ok_records if record["tokens_per_sec"]]
    )
    avg_completion_tokens = mean(
        [
            float(record["completion_tokens"])
            for record in ok_records
            if record["completion_tokens"]
        ]
    )
    success_rate = (
        (len(ok_records) / len(records)) * 100.0
        if records
        else 0.0
    )

    rows.append(
        {
            "label": run_dir.name,
            "model": request_meta.get("model", ""),
            "mode": request_meta.get("mode", ""),
            "iterations": request_meta.get("iterations", str(len(records))),
            "avg_total": avg_total,
            "avg_ttft": avg_ttft,
            "avg_tok_s": avg_tok_s,
            "avg_completion_tokens": avg_completion_tokens,
            "success_rate": success_rate,
            "path": str(run_dir),
        }
    )

header = [
    "Run",
    "Model",
    "Mode",
    "Iterations",
    "Success %",
    "Avg latency (s)",
    "Avg TTFT (s)",
    "Avg output tok/s",
    "Avg completion toks",
]

lines = []
lines.append("| " + " | ".join(header) + " |")
lines.append("|" + "|".join(["---"] * len(header)) + "|")

for row in rows:
    lines.append(
        "| "
        + " | ".join(
            [
                row["label"],
                row["model"],
                row["mode"],
                row["iterations"],
                f'{row["success_rate"]:.1f}',
                "" if row["avg_total"] is None else f'{row["avg_total"]:.3f}',
                "" if row["avg_ttft"] is None else f'{row["avg_ttft"]:.3f}',
                "" if row["avg_tok_s"] is None else f'{row["avg_tok_s"]:.3f}',
                ""
                if row["avg_completion_tokens"] is None
                else f'{row["avg_completion_tokens"]:.1f}',
            ]
        )
        + " |"
    )

lines.append("")
for row in rows:
    lines.append(f'- `{row["label"]}` source: `{row["path"]}`')

markdown = "\n".join(lines) + "\n"

if output_path:
    Path(output_path).write_text(markdown, encoding="utf-8")

print(markdown, end="")
PY
}

main() {
    [ "$#" -gt 0 ] || {
        usage
        exit 1
    }

    local command="$1"
    shift

    case "$command" in
        api) run_api_benchmark "$@" ;;
        llama-bench) run_llama_bench "$@" ;;
        lm-eval) run_lm_eval "$@" ;;
        compare) run_compare "$@" ;;
        -h|--help|help) usage ;;
        *) die "unknown subcommand: $command" ;;
    esac
}

main "$@"
