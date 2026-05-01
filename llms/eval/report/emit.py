"""Per-run report emitters: markdown + a minimal self-contained HTML page.

The fancy multi-run dashboard is the React hub under `bench/` (Phase 6 will
wire that to the v2 manifest schema). This module produces just enough for
a single run to be readable on its own.
"""

from __future__ import annotations

import html
import json
from dataclasses import asdict
from pathlib import Path

from llms.eval.manifest import Manifest
from llms.eval.scoring import ConfidenceInterval, RunSummary


def emit(*, manifest: Manifest, summary: RunSummary, run_dir: Path) -> tuple[Path, Path]:
    """Write report.md and report.html into `run_dir`. Returns their paths."""
    run_dir.mkdir(parents=True, exist_ok=True)
    md_path = run_dir / "report.md"
    html_path = run_dir / "report.html"
    md_path.write_text(_render_markdown(manifest, summary))
    html_path.write_text(_render_html(manifest, summary))
    return md_path, html_path


def _fmt_ci(ci: ConfidenceInterval | None) -> str:
    if ci is None:
        return "—"
    return f"{ci.point:.3f} (95% CI {ci.lo:.3f}-{ci.hi:.3f})"


def _fmt_ms(value: float | None) -> str:
    return "—" if value is None else f"{value:.0f} ms"


def _fmt_tps(value: float | None) -> str:
    return "—" if value is None else f"{value:.1f} tok/s"


def _render_markdown(manifest: Manifest, summary: RunSummary) -> str:
    lines: list[str] = []
    a = manifest.adapter
    m = manifest.model
    lines.append(f"# {a.name} run {manifest.run_id}")
    lines.append("")
    lines.append(f"- track: `{a.track}`  ·  adapter: `{a.name}@{a.version}`")
    lines.append(f"- endpoint: `{manifest.endpoint_name}`  ·  profile: `{m.profile}`")
    lines.append(f"- provider: `{manifest.provider.name}`")
    lines.append(f"- comparability: `{manifest.comparability_key[:12]}…`")
    lines.append(f"- timestamp: {manifest.timestamp}")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append("| Metric | Value |")
    lines.append("|---|---|")
    lines.append(f"| items | {summary.item_count} |")
    lines.append(f"| correct | {summary.correct_count} |")
    lines.append(f"| parse failures | {summary.parse_failure_count} |")
    lines.append(f"| errors | {summary.error_count} |")
    lines.append(f"| accuracy | {_fmt_ci(summary.accuracy)} |")
    lines.append(f"| partial mean | {_fmt_ci(summary.partial)} |")
    lines.append(f"| median latency | {_fmt_ms(summary.median_latency_ms)} |")
    lines.append(f"| median ttft | {_fmt_ms(summary.median_ttft_ms)} |")
    lines.append(f"| median throughput | {_fmt_tps(summary.median_tokens_per_sec)} |")
    lines.append("")
    if summary.by_category:
        lines.append("## By category")
        lines.append("")
        lines.append("| Category | Items | Correct | Accuracy | Partial mean |")
        lines.append("|---|---|---|---|---|")
        for cat, stats in sorted(summary.by_category.items()):
            lines.append(
                f"| {cat} | {stats.item_count} | {stats.correct_count} | "
                f"{stats.accuracy:.3f} | {stats.partial_mean:.3f} |"
            )
        lines.append("")
    return "\n".join(lines)


def _render_html(manifest: Manifest, summary: RunSummary) -> str:
    """Self-contained HTML — readable without the React hub."""
    safe_md = html.escape(_render_markdown(manifest, summary))
    manifest_blob = json.dumps(asdict(manifest), indent=2, sort_keys=True)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{html.escape(manifest.run_id)}</title>
<style>
  body {{ font: 14px/1.5 system-ui, sans-serif; max-width: 980px; margin: 2rem auto; padding: 0 1rem; }}
  pre {{ background: #f6f8fa; padding: 1rem; overflow: auto; border-radius: 6px; }}
  table {{ border-collapse: collapse; width: 100%; margin: 1rem 0; }}
  th, td {{ border: 1px solid #d0d7de; padding: 0.4rem 0.6rem; text-align: left; }}
  details {{ margin: 1rem 0; }}
</style>
</head>
<body>
<pre>{safe_md}</pre>
<details><summary>Manifest</summary><pre>{html.escape(manifest_blob)}</pre></details>
</body>
</html>
"""


__all__ = ["emit"]
