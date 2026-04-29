#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH_DIR_DEFAULT="$ROOT_DIR/bench"
CONFIG_DIR="$ROOT_DIR/config"

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

note() {
    printf '%s\n' "$*"
}

usage() {
    cat <<'EOF'
Usage:
  scripts/bench.sh add RUN_DIR [options]
  scripts/bench.sh validate [options]
  scripts/bench.sh serve [options]

Subcommands:
  add
    Package a benchmark run directory for the static benchmark hub.

    Options:
      --bench-dir PATH       Benchmark app directory, default: ./bench
      --id ID                Report id, default: basename of RUN_DIR
      --title TEXT           Report title, default: derived from id
      --subtitle TEXT        Report subtitle
      --date ISO_DATE        Report date, default: started_at from run-info.txt

  validate
    Validate reports/reports.json plus each listed report's meta.json and
    results.jsonl.

    Options:
      --bench-dir PATH       Benchmark app directory, default: ./bench

  serve
    Serve the benchmark hub locally.

    Options:
      --bench-dir PATH       Benchmark app directory, default: ./bench
      --host HOST            Host, default: 127.0.0.1
      --port PORT            Port, default: 8765
EOF
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

json_escape() {
    python3 -c 'import json, sys; print(json.dumps(sys.stdin.read()))'
}

normalize_id() {
    local raw="$1"
    printf '%s\n' "$raw" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//'
}

title_from_id() {
    python3 - "$1" <<'PY'
import sys

raw = sys.argv[1].replace("_", " ").replace("-", " ")
print(" ".join(part.upper() if part.lower() in {"rtx", "gpu", "api"} else part.capitalize() for part in raw.split()))
PY
}

read_info_value() {
    local file="$1"
    local key="$2"
    [ -f "$file" ] || return 0
    awk -F= -v key="$key" '$1 == key { sub("^[^=]*=", ""); print; exit }' "$file"
}

copy_profile_confs() {
    local run_dir="$1"
    local report_dir="$2"
    local manifest="$run_dir/manifest.tsv"
    local profile
    local copied=0

    mkdir -p "$report_dir/profiles"

    if [ -f "$manifest" ]; then
        while IFS=$'\t' read -r profile status _rest; do
            [ "$profile" != "profile" ] || continue
            [ "$status" = "completed" ] || continue
            [ -n "$profile" ] || continue

            if [ -f "$run_dir/profiles/$profile/config/$profile.conf" ]; then
                cp "$run_dir/profiles/$profile/config/$profile.conf" "$report_dir/profiles/$profile.conf"
                copied=$((copied + 1))
            elif [ -f "$CONFIG_DIR/$profile.conf" ]; then
                cp "$CONFIG_DIR/$profile.conf" "$report_dir/profiles/$profile.conf"
                copied=$((copied + 1))
            fi
        done < "$manifest"
    fi

    if [ "$copied" -eq 0 ] && [ -d "$run_dir/profiles" ]; then
        find "$run_dir/profiles" -path '*/config/*.conf' -type f \
            ! -name 'rtx-*.conf' ! -name 'runtime-common.sh' ! -name 'active-model.conf' \
            -exec cp {} "$report_dir/profiles/" \;
    fi
}

write_meta() {
    local run_dir="$1"
    local report_dir="$2"
    local id="$3"
    local title="$4"
    local subtitle="$5"
    local date="$6"

    python3 - "$run_dir" "$report_dir/meta.json" "$id" "$title" "$subtitle" "$date" <<'PY'
import csv
import json
import re
import sys
from pathlib import Path

run_dir = Path(sys.argv[1])
out = Path(sys.argv[2])
report_id, title, subtitle, date = sys.argv[3:7]

info = {}
info_path = run_dir / "run-info.txt"
if info_path.exists():
    for line in info_path.read_text(encoding="utf-8").splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            info[k] = v

if not date:
    date = info.get("started_at", "")

gpu_raw = info.get("gpu", "")
gpu_parts = [part.strip() for part in gpu_raw.split(",")]
gpu_name = gpu_parts[0] if gpu_parts and gpu_parts[0] else ""
vram_gb = None
if len(gpu_parts) >= 3:
    m = re.search(r"(\d+)", gpu_parts[2])
    if m:
        vram_gb = round(int(m.group(1)) / 1024)

profiles = []
manifest = run_dir / "manifest.tsv"
if manifest.exists():
    with manifest.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        seen = set()
        for row in reader:
            if row.get("status") != "completed":
                continue
            profile = row.get("profile") or ""
            if not profile or profile in seen:
                continue
            seen.add(profile)
            profiles.append({
                "profile": profile,
                "alias": row.get("alias") or profile,
                "model_file": Path(row.get("model") or "").name,
                "context_length": int(row["context"]) if (row.get("context") or "").isdigit() else None,
                "parallel_slots": int(row["parallel"]) if (row.get("parallel") or "").isdigit() else None,
                "cache_type_k": row.get("cache_k") or None,
                "cache_type_v": row.get("cache_v") or None,
                "has_mmproj": bool(row.get("mmproj")),
            })

meta = {
    "id": report_id,
    "title": title or report_id,
    "subtitle": subtitle,
    "date": date,
    "hardware": {
        "gpu": gpu_name or None,
        "vram_gb": vram_gb,
    },
    "server": {
        "engine": "llama.cpp",
        "binary": Path(info.get("llama_server_bin") or "llama-server").name,
        "api": "OpenAI-compatible /chat/completions",
        "stream": False,
        "base_url": info.get("base_url") or None,
    },
    "profiles": profiles,
    "notes": "Packaged from benchmark-results for the static benchmark hub.",
}

out.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
PY
}

update_registry() {
    local bench_dir="$1"
    local id="$2"

    mkdir -p "$bench_dir/reports"
    python3 - "$bench_dir/reports/reports.json" "$id" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
new_id = sys.argv[2]

if path.exists():
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        data = {"reports": []}
else:
    data = {"reports": []}

reports = [r for r in data.get("reports", []) if r != new_id]
reports.insert(0, new_id)
path.write_text(json.dumps({"reports": reports}, indent=2) + "\n", encoding="utf-8")
PY
}

cmd_add() {
    require_cmd python3

    [ "$#" -gt 0 ] || die "add requires RUN_DIR"
    local run_dir="$1"
    shift

    local bench_dir="$BENCH_DIR_DEFAULT"
    local id=""
    local title=""
    local subtitle=""
    local date=""

    while [ "$#" -gt 0 ]; do
        case "$1" in
            --bench-dir) bench_dir="$2"; shift 2 ;;
            --id) id="$2"; shift 2 ;;
            --title) title="$2"; shift 2 ;;
            --subtitle) subtitle="$2"; shift 2 ;;
            --date) date="$2"; shift 2 ;;
            -h|--help) usage; exit 0 ;;
            *) die "unknown add option: $1" ;;
        esac
    done

    [ -d "$run_dir" ] || die "run directory not found: $run_dir"
    [ -f "$run_dir/results.jsonl" ] || die "missing results.jsonl in run directory: $run_dir"
    [ -d "$bench_dir" ] || die "bench app directory not found: $bench_dir"

    if [ -z "$id" ]; then
        id="$(normalize_id "$(basename "$run_dir")")"
    else
        id="$(normalize_id "$id")"
    fi
    [ -n "$id" ] || die "report id resolved to empty value"
    [ -n "$title" ] || title="$(title_from_id "$id")"
    if [ -z "$date" ]; then
        date="$(read_info_value "$run_dir/run-info.txt" "started_at" || true)"
    fi

    local report_dir="$bench_dir/reports/$id"
    rm -rf "$report_dir"
    mkdir -p "$report_dir"

    cp "$run_dir/results.jsonl" "$report_dir/results.jsonl"
    copy_profile_confs "$run_dir" "$report_dir"
    write_meta "$run_dir" "$report_dir" "$id" "$title" "$subtitle" "$date"
    update_registry "$bench_dir" "$id"

    note "packaged report: $report_dir"
}

cmd_validate() {
    require_cmd python3

    local bench_dir="$BENCH_DIR_DEFAULT"
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --bench-dir) bench_dir="$2"; shift 2 ;;
            -h|--help) usage; exit 0 ;;
            *) die "unknown validate option: $1" ;;
        esac
    done

    python3 - "$bench_dir" <<'PY'
import json
import sys
from pathlib import Path

bench_dir = Path(sys.argv[1])
registry_path = bench_dir / "reports" / "reports.json"
if not registry_path.exists():
    raise SystemExit(f"missing registry: {registry_path}")

registry = json.loads(registry_path.read_text(encoding="utf-8"))
reports = registry.get("reports")
if not isinstance(reports, list):
    raise SystemExit("reports/reports.json must contain a reports array")

errors = []
for report_id in reports:
    report_dir = bench_dir / "reports" / report_id
    meta_path = report_dir / "meta.json"
    results_path = report_dir / "results.jsonl"
    if not meta_path.exists():
        errors.append(f"{report_id}: missing meta.json")
        continue
    if not results_path.exists():
        errors.append(f"{report_id}: missing results.jsonl")
        continue
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        errors.append(f"{report_id}: invalid meta.json: {exc}")
        continue
    if meta.get("id") != report_id:
        errors.append(f"{report_id}: meta id does not match registry id")
    rows = 0
    for index, line in enumerate(results_path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(f"{report_id}: invalid results.jsonl line {index}: {exc}")
            continue
        for key in ("profile", "prompt_id", "time_total_sec", "tokens_per_sec", "quality_score", "quality_max"):
            if key not in row:
                errors.append(f"{report_id}: line {index} missing {key}")
        rows += 1
    if rows == 0:
        errors.append(f"{report_id}: results.jsonl has no rows")

if errors:
    for error in errors:
        print(error, file=sys.stderr)
    raise SystemExit(1)

print(f"validated {len(reports)} report(s)")
PY
}

cmd_serve() {
    require_cmd python3

    local bench_dir="$BENCH_DIR_DEFAULT"
    local host="127.0.0.1"
    local port="8765"

    while [ "$#" -gt 0 ]; do
        case "$1" in
            --bench-dir) bench_dir="$2"; shift 2 ;;
            --host) host="$2"; shift 2 ;;
            --port) port="$2"; shift 2 ;;
            -h|--help) usage; exit 0 ;;
            *) die "unknown serve option: $1" ;;
        esac
    done

    [ -f "$bench_dir/index.html" ] || die "bench app not found: $bench_dir/index.html"
    note "serving $bench_dir at http://$host:$port/"
    cd "$bench_dir"
    python3 -m http.server "$port" --bind "$host"
}

main() {
    [ "$#" -gt 0 ] || { usage; exit 0; }
    local cmd="$1"
    shift

    case "$cmd" in
        add) cmd_add "$@" ;;
        validate) cmd_validate "$@" ;;
        serve) cmd_serve "$@" ;;
        -h|--help|help) usage ;;
        *) die "unknown subcommand: $cmd" ;;
    esac
}

main "$@"
