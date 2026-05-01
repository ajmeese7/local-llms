#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="$ROOT_DIR/config"
RESULTS_ROOT="$ROOT_DIR/benchmark-results"
SERVICE_NAME="${LLAMA_SERVICE_NAME:-llama-server}"
PROVIDER_HELPERS="$CONFIG_DIR/provider-common.sh"
LLAMA_PROVIDER="${LLAMA_PROVIDER:-llama.cpp}"
LLAMA_SERVER_BIN="${LLAMA_SERVER_BIN:-}"
BASE_URL="${BASE_URL:-http://127.0.0.1:9999/v1}"
API_TIMEOUT="${API_TIMEOUT:-180}"
READY_TIMEOUT="${READY_TIMEOUT:-900}"
TIMEOUT_FAILURE_LIMIT="${TIMEOUT_FAILURE_LIMIT:-1}"
RUN_DIR=""
SKIP_DOWNLOADS=0
PROFILE_FILTER=""

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

note() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

usage() {
    cat <<'EOF'
Usage:
  scripts/benchmark-5090-suite.sh [options]

Options:
  --run-dir PATH          Write results to PATH instead of benchmark-results/...
  --profiles "A B C"      Space-separated profile list; default: RTX 5090 supported profiles
  --provider NAME         Backend provider: llama.cpp or ik_llama.cpp
  --llama-server PATH     Explicit llama-server binary; overrides --provider binary path
  --skip-downloads        Do not download missing model/projector artifacts
  --api-timeout SEC       Per-request API timeout, default: 180
  --ready-timeout SEC     Per-profile startup wait timeout, default: 900
  --timeout-failures N    Abort the current profile after N timed-out prompts, default: 1
  -h, --help              Show this help

The script stops the llama-server systemd service while benchmarking, launches
each profile directly from an isolated config directory, and restarts the
service at the end if it was active before the run.
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --run-dir) RUN_DIR="$2"; shift 2 ;;
        --profiles) PROFILE_FILTER="$2"; shift 2 ;;
        --provider) LLAMA_PROVIDER="$2"; shift 2 ;;
        --llama-server) LLAMA_SERVER_BIN="$2"; shift 2 ;;
        --skip-downloads) SKIP_DOWNLOADS=1; shift ;;
        --api-timeout) API_TIMEOUT="$2"; shift 2 ;;
        --ready-timeout) READY_TIMEOUT="$2"; shift 2 ;;
        --timeout-failures) TIMEOUT_FAILURE_LIMIT="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown option: $1" ;;
    esac
done

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

require_cmd curl
require_cmd python3
require_cmd systemctl
require_cmd nvidia-smi
require_cmd sudo

# shellcheck source=/dev/null
source "$PROVIDER_HELPERS"
LLAMA_PROVIDER="$(llama_provider_normalize "$LLAMA_PROVIDER")" || die "unsupported provider: $LLAMA_PROVIDER"
BENCHMARK_PROVIDER="$LLAMA_PROVIDER"
[ -n "$LLAMA_SERVER_BIN" ] || LLAMA_SERVER_BIN="$(llama_provider_server_bin "$LLAMA_PROVIDER")"
[ -x "$LLAMA_SERVER_BIN" ] || die "llama-server not executable: $LLAMA_SERVER_BIN"
[ -f "$CONFIG_DIR/rtx-5090.conf" ] || die "missing config/rtx-5090.conf"

if [ -z "$RUN_DIR" ]; then
    RUN_DIR="$RESULTS_ROOT/5090-suite-$(date +%Y%m%d-%H%M%S)"
fi

PROMPT_DIR="$RUN_DIR/prompts"
RAW_DIR="$RUN_DIR/raw"
PROFILE_DIR="$RUN_DIR/profiles"
LOG_DIR="$RUN_DIR/logs"
mkdir -p "$PROMPT_DIR" "$RAW_DIR" "$PROFILE_DIR" "$LOG_DIR"

MANIFEST="$RUN_DIR/manifest.tsv"
RESULTS_JSONL="$RUN_DIR/results.jsonl"
REPORT_MD="$RUN_DIR/report.md"
REPORT_HTML="$RUN_DIR/report.html"
ACTIVE_SERVER_PID=""
SERVICE_WAS_ACTIVE=0

cleanup() {
    local status=$?
    if [ -n "${ACTIVE_SERVER_PID:-}" ] && kill -0 "$ACTIVE_SERVER_PID" 2>/dev/null; then
        note "Stopping benchmark llama-server pid $ACTIVE_SERVER_PID"
        kill "$ACTIVE_SERVER_PID" 2>/dev/null || true
        wait "$ACTIVE_SERVER_PID" 2>/dev/null || true
    fi
    if [ "$SERVICE_WAS_ACTIVE" -eq 1 ]; then
        note "Restarting $SERVICE_NAME"
        sudo systemctl restart "$SERVICE_NAME" || true
    fi
    exit "$status"
}
trap cleanup EXIT INT TERM

model_file_state() {
    local path="$1"
    if [ -s "$path" ]; then
        printf 'installed\n'
    elif [ -e "$path" ]; then
        printf 'empty\n'
    else
        printf 'missing\n'
    fi
}

load_profile() {
    local profile="$1"
    API_KEY=""
    MODEL=""
    MMPROJ=""
    HF_REPO=""
    HF_FILE=""
    MMPROJ_HF_REPO=""
    MMPROJ_HF_FILE=""
    ALIAS=""
    HOST=""
    PORT=""
    GPU_LAYERS=""
    CONTEXT_LENGTH=""
    PARALLEL_SLOTS=""
    FLASH_ATTENTION=""
    CACHE_TYPE_K=""
    CACHE_TYPE_V=""
    JINJA=""
    KV_UNIFIED=""
    SPEC_DEFAULT=""
    SPEC_TYPE=""
    SPEC_NGRAM_SIZE_N=""
    SPEC_NGRAM_SIZE_M=""
    SPEC_NGRAM_MIN_HITS=""
    DRAFT_MAX=""
    DRAFT_MIN=""
    TEMPERATURE=""
    TOP_P=""
    TOP_K=""
    MIN_P=""
    PRESENCE_PENALTY=""
    REPEAT_PENALTY=""
    PROVEN_LLAMA_PROVIDERS=""
    BLOCKED_LLAMA_PROVIDERS=""
    PROVIDER_COMPATIBILITY_NOTES=""

    # shellcheck source=/dev/null
    source "$CONFIG_DIR/rtx-5090.conf"
    LLAMA_PROVIDER="$BENCHMARK_PROVIDER"
    [ -f "$CONFIG_DIR/$profile.conf" ] || die "profile overlay not found: $profile"
    # shellcheck source=/dev/null
    source "$CONFIG_DIR/$profile.conf"
    LLAMA_PROVIDER="$BENCHMARK_PROVIDER"
    [ -n "$MODEL" ] || die "MODEL missing for profile: $profile"
    [ -n "$ALIAS" ] || die "ALIAS missing for profile: $profile"
}

download_artifact() {
    local label="$1"
    local path="$2"
    local repo="$3"
    local file="$4"

    case "$(model_file_state "$path")" in
        installed)
            note "$label already installed: $path"
            return 0
            ;;
        empty)
            note "$label is empty and will be re-downloaded: $path"
            rm -f "$path"
            ;;
        missing)
            note "$label missing: $path"
            ;;
    esac

    [ "$SKIP_DOWNLOADS" -eq 0 ] || die "$label missing and --skip-downloads was set: $path"
    [ -n "$repo" ] || die "$label missing but repo metadata is empty"
    [ -n "$file" ] || die "$label missing but file metadata is empty"

    mkdir -p "$(dirname "$path")"
    note "Downloading $label from $repo/$file"
    curl -L --fail --continue-at - --progress-bar \
        "https://huggingface.co/${repo}/resolve/main/${file}" \
        -o "$path"
    [ -s "$path" ] || die "download completed but artifact is unavailable: $path"
}

ensure_profile_artifacts() {
    local profile="$1"
    local mmproj_repo

    load_profile "$profile"
    download_artifact "$profile model" "$MODEL" "$HF_REPO" "$HF_FILE"

    if [ -n "$MMPROJ" ]; then
        mmproj_repo="${MMPROJ_HF_REPO:-$HF_REPO}"
        download_artifact "$profile mmproj" "$MMPROJ" "$mmproj_repo" "$MMPROJ_HF_FILE"
    fi
}

profile_provider_skip_reason() {
    if llama_profile_provider_is_blocked "$BENCHMARK_PROVIDER"; then
        printf 'provider-blocked'
        [ -z "${PROVIDER_COMPATIBILITY_NOTES:-}" ] || printf ': %s' "$PROVIDER_COMPATIBILITY_NOTES"
        printf '\n'
        return 0
    fi

    if ! llama_profile_provider_is_proven "$BENCHMARK_PROVIDER"; then
        printf 'provider-unproven: proven providers: %s\n' "${PROVEN_LLAMA_PROVIDERS:-none}"
        return 0
    fi

    return 1
}

write_prompts() {
    python3 - "$PROMPT_DIR" <<'PY'
from pathlib import Path
import json
import sys

prompt_dir = Path(sys.argv[1])
prompt_dir.mkdir(parents=True, exist_ok=True)

long_filler = "\n".join(
    f"Reference block {i:03d}: maintainers should preserve config layering, benchmark repeatability, and concise operational notes."
    for i in range(1, 190)
)

prompts = [
    {
        "id": "coding_bugfix",
        "category": "coding",
        "temperature": 0,
        "max_tokens": 1000,
        "prompt": """You are reviewing this Python function for production use:

def add_tag(tag, tags=[]):
    tags.append(tag)
    return tags

Explain the bug, provide a corrected implementation, and include one minimal pytest test that proves the fix. Keep the answer practical.""",
        "checks": [
            ["mutable default", "default argument"],
            ["None"],
            ["is None"],
            ["pytest", "def test_"],
            ["append"],
        ],
    },
    {
        "id": "coding_shell",
        "category": "coding",
        "temperature": 0,
        "max_tokens": 900,
        "prompt": """Write a Bash function named wait_for_http_ok that accepts a URL, max attempts, and sleep seconds. It should use curl with a connect timeout, return 0 on HTTP 200, return non-zero after exhausting attempts, and avoid printing noisy output on success. Include the function only, plus a very short explanation.""",
        "checks": [
            ["wait_for_http_ok"],
            ["curl"],
            ["--connect-timeout", "connect-timeout"],
            ["http_code", "%{http_code}"],
            ["return 0"],
            ["return 1", "return \"$status\"", "return $status"],
        ],
    },
    {
        "id": "assistant_ops",
        "category": "assistant",
        "temperature": 0,
        "max_tokens": 900,
        "prompt": """A local llama.cpp OpenAI-compatible server on a 32 GB NVIDIA GPU sometimes fails when switching to a larger model. Give a prioritized troubleshooting checklist for a developer. Focus on concrete commands and configuration knobs, not generic advice.""",
        "checks": [
            ["journalctl", "systemctl status"],
            ["nvidia-smi"],
            ["context", "CONTEXT_LENGTH"],
            ["KV", "cache"],
            ["quant", "Q4", "Q5"],
            ["GPU_LAYERS", "ngl"],
        ],
    },
    {
        "id": "creative_constraints",
        "category": "creative",
        "temperature": 0.7,
        "max_tokens": 700,
        "prompt": """Write a 180-240 word micro-scene about a systems engineer alone in a server room at 2 AM. Constraints: include exactly one line of terminal output, avoid explaining the theme, and end with an unresolved choice.""",
        "checks": [
            ["server room"],
            ["2 AM", "2 a.m."],
            ["$ ", "ERROR", "OK", "systemctl", "curl"],
            ["choice", "choose", "decision"],
        ],
    },
    {
        "id": "long_context_recall",
        "category": "long-context",
        "temperature": 0,
        "max_tokens": 500,
        "prompt": f"""You will receive a long operational note. Extract only the requested facts.

Important fact A: project codename is Atlas-17.
Important fact B: rollback window is 42 minutes.

{long_filler}

Important fact C: API port is 48129.
Important fact D: database table is ledger_events.

Return compact JSON with keys codename, rollback_window_minutes, api_port, database_table. Do not add commentary.""",
        "checks": [
            ["Atlas-17"],
            ["42"],
            ["48129"],
            ["ledger_events"],
        ],
    },
]

for item in prompts:
    (prompt_dir / f"{item['id']}.txt").write_text(item["prompt"], encoding="utf-8")

(prompt_dir / "prompts.json").write_text(json.dumps(prompts, indent=2), encoding="utf-8")
PY
}

json_payload() {
    local model="$1"
    local prompt_file="$2"
    local max_tokens="$3"
    local temperature="$4"

    python3 - "$model" "$prompt_file" "$max_tokens" "$temperature" <<'PY'
import json
import sys
from pathlib import Path

model, prompt_file, max_tokens, temperature = sys.argv[1:]
prompt = Path(prompt_file).read_text(encoding="utf-8")
payload = {
    "model": model,
    "messages": [{"role": "user", "content": prompt}],
    "max_tokens": int(max_tokens),
    "temperature": float(temperature),
    "stream": False,
}
print(json.dumps(payload))
PY
}

score_response() {
    local prompt_id="$1"
    local response_file="$2"

    python3 - "$PROMPT_DIR/prompts.json" "$prompt_id" "$response_file" <<'PY'
import json
import re
import sys
from pathlib import Path

prompts = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
prompt_id = sys.argv[2]
response_path = Path(sys.argv[3])
prompt = next(item for item in prompts if item["id"] == prompt_id)

try:
    data = json.loads(response_path.read_text(encoding="utf-8"))
except Exception:
    print(json.dumps({"score": 0, "max_score": len(prompt["checks"]), "text": ""}))
    raise SystemExit

content = ""
choices = data.get("choices") or []
if choices:
    message = choices[0].get("message") or {}
    value = message.get("content", "")
    if isinstance(value, list):
        content = "".join(part.get("text", "") for part in value if isinstance(part, dict))
    else:
        content = str(value)
    reasoning = message.get("reasoning_content", "")
    if not content and reasoning:
        content = str(reasoning)

normalized = content.lower()
score = 0
hits = []
for group in prompt["checks"]:
    matched = any(str(term).lower() in normalized for term in group)
    hits.append(matched)
    score += 1 if matched else 0

word_count = len(re.findall(r"\b\w+\b", content))
print(json.dumps({
    "score": score,
    "max_score": len(prompt["checks"]),
    "hits": hits,
    "word_count": word_count,
    "used_reasoning_fallback": bool(choices and not (choices[0].get("message") or {}).get("content") and (choices[0].get("message") or {}).get("reasoning_content")),
    "text": content,
}))
PY
}

append_result_json() {
    local result_file="$1"
    python3 - "$result_file" "$RESULTS_JSONL" <<'PY'
import json
import sys
from pathlib import Path

result = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
with Path(sys.argv[2]).open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(result, ensure_ascii=False) + "\n")
PY
}

launch_profile_server() {
    local profile="$1"
    local temp_config="$PROFILE_DIR/$profile/config"
    local server_log="$PROFILE_DIR/$profile/server.log"

    mkdir -p "$temp_config"
    cp "$CONFIG_DIR"/*.conf "$temp_config/"
    cp "$CONFIG_DIR/runtime-common.sh" "$temp_config/"
    cp "$CONFIG_DIR/provider-common.sh" "$temp_config/"
    printf '\nLLAMA_PROVIDER="%s"\n' "$BENCHMARK_PROVIDER" >> "$temp_config/rtx-5090.conf"
    printf 'MODEL_PROFILE=%s\n' "$profile" > "$temp_config/active-model.conf"

    note "Launching $profile"
    LLAMA_CONFIG_DIR="$temp_config" LLAMA_SERVER_BIN="$LLAMA_SERVER_BIN" \
        "$CONFIG_DIR/llama-launcher.sh" >"$server_log" 2>&1 &
    ACTIVE_SERVER_PID=$!

    local start
    start="$(date +%s)"
    while true; do
        if ! kill -0 "$ACTIVE_SERVER_PID" 2>/dev/null; then
            note "Server for $profile exited during startup"
            return 1
        fi

        if curl -sS --fail --noproxy "*" --connect-timeout 2 --max-time 5 \
            "$BASE_URL/models" >/dev/null 2>&1; then
            note "$profile API ready"
            return 0
        fi

        if [ $(( $(date +%s) - start )) -ge "$READY_TIMEOUT" ]; then
            note "$profile did not become ready within ${READY_TIMEOUT}s"
            return 1
        fi
        sleep 3
    done
}

stop_profile_server() {
    if [ -n "${ACTIVE_SERVER_PID:-}" ] && kill -0 "$ACTIVE_SERVER_PID" 2>/dev/null; then
        kill "$ACTIVE_SERVER_PID" 2>/dev/null || true
        wait "$ACTIVE_SERVER_PID" 2>/dev/null || true
    fi
    ACTIVE_SERVER_PID=""
}

run_prompt() {
    local profile="$1"
    local alias="$2"
    local prompt_id="$3"
    local category="$4"
    local max_tokens="$5"
    local temperature="$6"

    local prompt_file="$PROMPT_DIR/$prompt_id.txt"
    local profile_raw="$RAW_DIR/$profile"
    local response_file="$profile_raw/$prompt_id.response.json"
    local metrics_file="$profile_raw/$prompt_id.metrics.txt"
    local score_file="$profile_raw/$prompt_id.score.json"
    local result_file="$profile_raw/$prompt_id.result.json"
    mkdir -p "$profile_raw"

    local payload
    payload="$(json_payload "$alias" "$prompt_file" "$max_tokens" "$temperature")"

    note "Running $profile / $prompt_id"
    local curl_status
    set +e
    curl -sS --noproxy "*" \
        --connect-timeout 5 \
        --max-time "$API_TIMEOUT" \
        -H "Content-Type: application/json" \
        -o "$response_file" \
        -w 'http_code=%{http_code}\ntime_total=%{time_total}\ntime_starttransfer=%{time_starttransfer}\n' \
        -d "$payload" \
        "$BASE_URL/chat/completions" >"$metrics_file"
    curl_status=$?
    set -e

    local http_code time_total time_starttransfer
    http_code="$(awk -F= '$1=="http_code"{print $2}' "$metrics_file" 2>/dev/null || true)"
    time_total="$(awk -F= '$1=="time_total"{print $2}' "$metrics_file" 2>/dev/null || true)"
    time_starttransfer="$(awk -F= '$1=="time_starttransfer"{print $2}' "$metrics_file" 2>/dev/null || true)"
    [ -n "$http_code" ] || http_code="000"
    [ -n "$time_total" ] || time_total="0"
    [ -n "$time_starttransfer" ] || time_starttransfer="0"

    score_response "$prompt_id" "$response_file" > "$score_file"

    python3 - "$profile" "$alias" "$prompt_id" "$category" "$max_tokens" "$temperature" "$BENCHMARK_PROVIDER" \
        "$http_code" "$time_total" "$time_starttransfer" "$response_file" "$score_file" "$result_file" <<'PY'
import json
import sys
from pathlib import Path

profile, alias, prompt_id, category, max_tokens, temperature, provider = sys.argv[1:8]
http_code, time_total, ttft = sys.argv[8:11]
response_path = Path(sys.argv[11])
score_path = Path(sys.argv[12])
result_path = Path(sys.argv[13])

score = json.loads(score_path.read_text(encoding="utf-8"))
usage = {}
try:
    response = json.loads(response_path.read_text(encoding="utf-8"))
    usage = response.get("usage") or {}
except Exception:
    response = {}

completion_tokens = usage.get("completion_tokens") or usage.get("completion_tokens_details") or ""
if isinstance(completion_tokens, dict):
    completion_tokens = ""
prompt_tokens = usage.get("prompt_tokens", "")
total_tokens = usage.get("total_tokens", "")

try:
    tok_s = float(completion_tokens) / float(time_total) if completion_tokens and float(time_total) > 0 else None
except Exception:
    tok_s = None

text = score.get("text", "")
result = {
    "profile": profile,
    "provider": provider,
    "alias": alias,
    "prompt_id": prompt_id,
    "category": category,
    "http_code": http_code,
    "time_total_sec": round(float(time_total), 3),
    "ttft_sec": round(float(ttft), 3),
    "prompt_tokens": prompt_tokens,
    "completion_tokens": completion_tokens,
    "total_tokens": total_tokens,
    "tokens_per_sec": round(tok_s, 3) if tok_s is not None else None,
    "quality_score": score.get("score", 0),
    "quality_max": score.get("max_score", 0),
    "quality_ratio": round(score.get("score", 0) / score.get("max_score", 1), 3),
    "word_count": score.get("word_count", 0),
    "used_reasoning_fallback": score.get("used_reasoning_fallback", False),
    "response_file": str(response_path),
    "excerpt": text[:600],
}
result_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
PY
    append_result_json "$result_file"

    if [ "$curl_status" -eq 28 ]; then
        note "$profile / $prompt_id timed out after ${API_TIMEOUT}s"
        return 124
    fi
    return 0
}

record_profile_manifest() {
    local profile="$1"
    local status="$2"
    local reason="${3:-}"

    load_profile "$profile"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$profile" "$status" "$reason" "$ALIAS" "$MODEL" "${MMPROJ:-}" \
        "${CONTEXT_LENGTH:-}" "${PARALLEL_SLOTS:-}" "${CACHE_TYPE_K:-}" "${CACHE_TYPE_V:-}" \
        "${PROVEN_LLAMA_PROVIDERS:-}" "${BLOCKED_LLAMA_PROVIDERS:-}" "${PROVIDER_COMPATIBILITY_NOTES:-}" \
        >> "$MANIFEST"
}

generate_reports() {
    python3 - "$RUN_DIR" "$MANIFEST" "$RESULTS_JSONL" "$REPORT_MD" "$REPORT_HTML" <<'PY'
import html
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

run_dir = Path(sys.argv[1])
manifest_path = Path(sys.argv[2])
results_path = Path(sys.argv[3])
report_md = Path(sys.argv[4])
report_html = Path(sys.argv[5])

manifest = []
if manifest_path.exists():
    lines = manifest_path.read_text(encoding="utf-8").splitlines()
    header = lines[0].split("\t") if lines else []
    for line in lines[1:]:
        values = line.split("\t")
        manifest.append(dict(zip(header, values)))

results = []
if results_path.exists():
    for line in results_path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            results.append(json.loads(line))

by_profile = defaultdict(list)
for item in results:
    by_profile[item["profile"]].append(item)

def mean(values):
    values = [value for value in values if value is not None and value != ""]
    return statistics.mean(values) if values else None

summary = []
for profile, items in sorted(by_profile.items()):
    ok = [item for item in items if item.get("http_code") == "200"]
    summary.append({
        "profile": profile,
        "alias": items[0].get("alias", ""),
        "runs": len(items),
        "success": len(ok),
        "avg_latency": mean([item.get("time_total_sec") for item in ok]),
        "avg_ttft": mean([item.get("ttft_sec") for item in ok]),
        "avg_tok_s": mean([item.get("tokens_per_sec") for item in ok]),
        "avg_quality": mean([item.get("quality_ratio") for item in ok]),
    })

def fmt(value, digits=2):
    if value is None:
        return ""
    return f"{value:.{digits}f}"

md = []
md.append("# RTX 5090 Local LLM Benchmark Report")
md.append("")
md.append(f"Run directory: `{run_dir}`")
md.append("")
md.append("## Summary")
md.append("")
md.append("| Profile | Success | Avg Latency (s) | Avg TTFT (s) | Avg Output tok/s | Avg Quality % |")
md.append("|---|---:|---:|---:|---:|---:|")
for row in summary:
    md.append(
        f"| `{row['profile']}` | {row['success']}/{row['runs']} | "
        f"{fmt(row['avg_latency'])} | {fmt(row['avg_ttft'])} | "
        f"{fmt(row['avg_tok_s'])} | {fmt((row['avg_quality'] or 0) * 100, 1)} |"
    )

md.append("")
md.append("## Visual Comparison")
md.append("")
md.append("### Output Throughput")
md.append("")
md.append("```mermaid")
md.append("xychart-beta")
md.append('  title "Average Output Tokens per Second"')
md.append("  x-axis [" + ", ".join('"' + row["profile"] + '"' for row in summary) + "]")
md.append("  y-axis \"tok/s\" 0 --> " + str(max([int((row["avg_tok_s"] or 0) + 5) for row in summary] or [10])))
md.append("  bar [" + ", ".join(str(round(row["avg_tok_s"] or 0, 2)) for row in summary) + "]")
md.append("```")
md.append("")
md.append("### Quality Heuristic")
md.append("")
md.append("```mermaid")
md.append("xychart-beta")
md.append('  title "Prompt Rubric Hit Rate"')
md.append("  x-axis [" + ", ".join('"' + row["profile"] + '"' for row in summary) + "]")
md.append('  y-axis "quality %" 0 --> 100')
md.append("  bar [" + ", ".join(str(round((row["avg_quality"] or 0) * 100, 1)) for row in summary) + "]")
md.append("```")
md.append("")

md.append("## Per-Prompt Results")
md.append("")
md.append("| Profile | Prompt | Category | HTTP | Latency (s) | tok/s | Quality | Excerpt |")
md.append("|---|---|---|---:|---:|---:|---:|---|")
for item in results:
    excerpt = item.get("excerpt", "").replace("\n", " ")
    if len(excerpt) > 160:
        excerpt = excerpt[:157] + "..."
    md.append(
        f"| `{item['profile']}` | `{item['prompt_id']}` | {item['category']} | "
        f"{item['http_code']} | {fmt(item.get('time_total_sec'))} | "
        f"{fmt(item.get('tokens_per_sec'))} | "
        f"{item.get('quality_score')}/{item.get('quality_max')} | "
        f"{excerpt.replace('|', '&#124;')} |"
    )

md.append("")
md.append("## Profile Manifest")
md.append("")
md.append("| Profile | Status | Alias | Model | Provider compatibility | Context | Parallel | KV K/V |")
md.append("|---|---|---|---|---|---:|---:|---|")
for row in manifest:
    provider_bits = []
    if row.get("proven_providers"):
        provider_bits.append(f"proven: `{row.get('proven_providers')}`")
    if row.get("blocked_providers"):
        provider_bits.append(f"blocked: `{row.get('blocked_providers')}`")
    if row.get("provider_notes"):
        provider_bits.append(row.get("provider_notes"))
    md.append(
        f"| `{row.get('profile','')}` | {row.get('status','')} | "
        f"{row.get('alias','')} | `{Path(row.get('model','')).name}` | "
        f"{'<br>'.join(provider_bits) if provider_bits else ''} | "
        f"{row.get('context','')} | {row.get('parallel','')} | "
        f"{row.get('cache_k','')}/{row.get('cache_v','')} |"
    )

md.append("")
md.append("## Notes")
md.append("")
md.append("- Quality is a lightweight automated rubric, not a replacement for human review.")
md.append("- If a model returned empty visible `content`, the report falls back to `reasoning_content` for excerpts and rubric checks.")
md.append("- API timings include prompt processing, generation, server overhead, and the active profile configuration.")
md.append("- Raw responses are stored under `raw/` for manual inspection.")
report_md.write_text("\n".join(md) + "\n", encoding="utf-8")

max_tok = max([row["avg_tok_s"] or 0 for row in summary] or [1])
max_quality = 1.0

cards = []
for row in summary:
    tok_pct = 0 if max_tok == 0 else ((row["avg_tok_s"] or 0) / max_tok) * 100
    q_pct = (row["avg_quality"] or 0) / max_quality * 100
    cards.append(f"""
      <section class="card">
        <h2>{html.escape(row['profile'])}</h2>
        <div class="metric"><span>Success</span><strong>{row['success']}/{row['runs']}</strong></div>
        <div class="metric"><span>Latency</span><strong>{fmt(row['avg_latency'])}s</strong></div>
        <div class="metric"><span>TTFT</span><strong>{fmt(row['avg_ttft'])}s</strong></div>
        <div class="bar-label">Output throughput: {fmt(row['avg_tok_s'])} tok/s</div>
        <div class="bar"><div style="width:{tok_pct:.1f}%"></div></div>
        <div class="bar-label">Rubric score: {fmt((row['avg_quality'] or 0) * 100, 1)}%</div>
        <div class="bar quality"><div style="width:{q_pct:.1f}%"></div></div>
      </section>
    """)

rows_html = []
for item in results:
    rows_html.append(
        "<tr>"
        f"<td>{html.escape(item['profile'])}</td>"
        f"<td>{html.escape(item['prompt_id'])}</td>"
        f"<td>{html.escape(item['category'])}</td>"
        f"<td>{html.escape(str(item['http_code']))}</td>"
        f"<td>{fmt(item.get('time_total_sec'))}</td>"
        f"<td>{fmt(item.get('tokens_per_sec'))}</td>"
        f"<td>{item.get('quality_score')}/{item.get('quality_max')}</td>"
        f"<td>{html.escape(item.get('excerpt','')[:220])}</td>"
        "</tr>"
    )

html_doc = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RTX 5090 Local LLM Benchmark</title>
  <style>
    :root {{ color-scheme: dark; --bg:#101214; --panel:#1a1f24; --text:#e7ecef; --muted:#9da8b0; --line:#303942; --accent:#48b6a3; --quality:#d6a84f; }}
    body {{ margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:var(--bg); color:var(--text); }}
    header {{ padding:32px 5vw 18px; border-bottom:1px solid var(--line); }}
    h1 {{ margin:0 0 8px; font-size:clamp(28px,4vw,48px); }}
    p {{ color:var(--muted); }}
    main {{ padding:24px 5vw 48px; }}
    .grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:16px; }}
    .card {{ background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:18px; }}
    .card h2 {{ margin:0 0 14px; font-size:18px; }}
    .metric {{ display:flex; justify-content:space-between; gap:16px; padding:6px 0; border-bottom:1px solid rgba(255,255,255,.06); }}
    .metric span, .bar-label {{ color:var(--muted); }}
    .bar-label {{ margin-top:14px; font-size:14px; }}
    .bar {{ height:12px; background:#0c0f11; border-radius:999px; overflow:hidden; margin-top:6px; }}
    .bar div {{ height:100%; background:var(--accent); }}
    .bar.quality div {{ background:var(--quality); }}
    table {{ width:100%; border-collapse:collapse; margin-top:18px; font-size:14px; }}
    th, td {{ border-bottom:1px solid var(--line); padding:10px; text-align:left; vertical-align:top; }}
    th {{ color:#cfd6dc; background:#15191d; position:sticky; top:0; }}
    code {{ color:#f2d27c; }}
  </style>
</head>
<body>
  <header>
    <h1>RTX 5090 Local LLM Benchmark</h1>
    <p>Run directory: <code>{html.escape(str(run_dir))}</code></p>
  </header>
  <main>
    <div class="grid">{''.join(cards)}</div>
    <h2>Per-Prompt Results</h2>
    <table>
      <thead><tr><th>Profile</th><th>Prompt</th><th>Category</th><th>HTTP</th><th>Latency</th><th>tok/s</th><th>Quality</th><th>Excerpt</th></tr></thead>
      <tbody>{''.join(rows_html)}</tbody>
    </table>
  </main>
</body>
</html>
"""
report_html.write_text(html_doc, encoding="utf-8")
PY
}

write_prompts

# shellcheck source=/dev/null
source "$CONFIG_DIR/rtx-5090.conf"
LLAMA_PROVIDER="$BENCHMARK_PROVIDER"
if [ -n "$PROFILE_FILTER" ]; then
    PROFILES="$PROFILE_FILTER"
else
    PROFILES="$SUPPORTED_MODEL_PROFILES"
fi

{
    printf 'profile\tstatus\treason\talias\tmodel\tmmproj\tcontext\tparallel\tcache_k\tcache_v\tproven_providers\tblocked_providers\tprovider_notes\n'
} > "$MANIFEST"
: > "$RESULTS_JSONL"

{
    printf 'started_at=%s\n' "$(date --iso-8601=seconds)"
    printf 'provider=%s\n' "$BENCHMARK_PROVIDER"
    printf 'base_url=%s\n' "$BASE_URL"
    printf 'llama_server_bin=%s\n' "$LLAMA_SERVER_BIN"
    nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader 2>/dev/null | sed 's/^/gpu=/'
} > "$RUN_DIR/run-info.txt"

if systemctl is-active --quiet "$SERVICE_NAME"; then
    SERVICE_WAS_ACTIVE=1
    note "Stopping $SERVICE_NAME for benchmark run"
    sudo systemctl stop "$SERVICE_NAME"
fi

for profile in $PROFILES; do
    note "=== Profile: $profile ==="
    mkdir -p "$PROFILE_DIR/$profile"

    load_profile "$profile"
    if skip_reason="$(profile_provider_skip_reason)"; then
        note "Skipping $profile for provider $BENCHMARK_PROVIDER: $skip_reason"
        record_profile_manifest "$profile" "provider-skipped" "$skip_reason"
        continue
    fi

    if ! ensure_profile_artifacts "$profile"; then
        record_profile_manifest "$profile" "artifact-failed" "download-or-artifact-check-failed"
        continue
    fi

    load_profile "$profile"
    record_profile_manifest "$profile" "started" ""

    if ! launch_profile_server "$profile"; then
        record_profile_manifest "$profile" "startup-failed" "server-not-ready"
        stop_profile_server
        continue
    fi

    python3 - "$PROMPT_DIR/prompts.json" <<'PY' > "$PROFILE_DIR/$profile/prompt-plan.tsv"
import json
import sys
from pathlib import Path
for item in json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")):
    print("\t".join([item["id"], item["category"], str(item["max_tokens"]), str(item["temperature"])]))
PY

    profile_status="completed"
    profile_reason=""
    timeout_failures=0
    while IFS=$'\t' read -r prompt_id category max_tokens temperature; do
        set +e
        run_prompt "$profile" "$ALIAS" "$prompt_id" "$category" "$max_tokens" "$temperature"
        prompt_status=$?
        set -e
        if [ "$prompt_status" -ne 0 ]; then
            if [ "$prompt_status" -eq 124 ]; then
                timeout_failures=$((timeout_failures + 1))
                if [ "$timeout_failures" -ge "$TIMEOUT_FAILURE_LIMIT" ]; then
                    note "Aborting remaining prompts for $profile after $timeout_failures timeout(s)"
                    profile_status="timeout-aborted"
                    profile_reason="prompt-timeout"
                    break
                fi
            fi
        fi
    done < "$PROFILE_DIR/$profile/prompt-plan.tsv"

    stop_profile_server
    record_profile_manifest "$profile" "$profile_status" "$profile_reason"
    generate_reports
done

generate_reports
printf 'finished_at=%s\n' "$(date --iso-8601=seconds)" >> "$RUN_DIR/run-info.txt"

note "Benchmark suite complete"
note "Markdown report: $REPORT_MD"
note "HTML report: $REPORT_HTML"
note "Bench hub package: $ROOT_DIR/scripts/bench.sh add $RUN_DIR"
