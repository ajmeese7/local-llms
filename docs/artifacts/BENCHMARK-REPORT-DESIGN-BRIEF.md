# RTX 5090 Local LLM Benchmark Report Design Brief

## Status

👎🏼 - replaced by Claude Design implementation of this doc, using the Meese Enterprises design system

## Goal

Create a polished, shareable benchmark report page for comparing local LLM profiles running on an RTX 5090 through `llama.cpp` / `llama-server`.

The page should be useful to two audiences:

- **Human readers online:** quickly understand which model profile is fastest, which is most useful, and what tradeoffs matter.
- **Technical readers and agents:** inspect exact profiles, prompts, metrics, caveats, and raw result paths.

The report should feel like a serious technical benchmark, not a raw log dump.

## Core Story

The main takeaway from the current benchmark run is:

> The experimental `qwen36-35B-A3B-q4-ngram` profile is dramatically faster, but `qwen36-35B-A3B` appears to be the better balanced default for coding and general usefulness because it keeps high quality while still being much faster than the 27B profiles.

The page should make this obvious in the first viewport.

Recommended top-level ranking:

| Role | Profile | Reason |
|---|---|---|
| Best balanced | `qwen36-35B-A3B` | Strong quality score, high coding usefulness, much faster than 27B profiles |
| Fastest | `qwen36-35B-A3B-q4-ngram` | Highest throughput and lowest latency, but lower coding rubric score |
| Most stable baseline | `qwen36-27b` | Strong quality, known default, slower |
| Creative/alternative | `mythos` | Solid quality, distinct output style, moderate speed |
| Experimental uncensored 27B | `qwen36-27B-AEON` | Strong quality, but slowest generation profile in this run |

## Source Data

Use the benchmark output from:

```text
benchmark-results/5090-suite-20260428-151710/
```

Important files:

```text
report.md
report.html
results.jsonl
manifest.tsv
raw/<profile>/*.response.json
raw/<profile>/*.result.json
prompts/prompts.json
run-info.txt
```

## Summary Metrics To Display

Use these aggregate results from the completed run:

| Profile | Success | Avg Latency | Avg Output tok/s | Quality Heuristic |
|---|---:|---:|---:|---:|
| `qwen36-35B-A3B-q4-ngram` | 5/5 | 5.29s | 151.68 | 81.3% |
| `qwen36-35B-A3B` | 5/5 | 11.95s | 86.28 | 96.7% |
| `mythos` | 5/5 | 21.93s | 43.29 | 93.3% |
| `qwen36-27b` | 5/5 | 30.26s | 35.96 | 96.7% |
| `qwen36-27B-AEON` | 5/5 | 27.49s | 32.58 | 96.7% |

Important caveat: the existing report labels `time_starttransfer` as TTFT, but because the benchmark used non-streaming `/chat/completions`, that value is effectively full response latency, not true first-token latency. The redesigned page should either omit TTFT or label it clearly as non-streaming response time.

## Page Structure

### 1. Hero / Executive Summary

First viewport should include:

- Title: `RTX 5090 Local LLM Benchmark`
- Subtitle: local `llama.cpp` profiles tested through OpenAI-compatible `llama-server`
- Hardware/context callout: RTX 5090, local inference, API benchmark, 5 prompts per profile
- Three clear result badges:
  - `Best balanced: qwen36-35B-A3B`
  - `Fastest: qwen36-35B-A3B-q4-ngram`
  - `Best quality tie: qwen36-35B-A3B / qwen36-27b / qwen36-27B-AEON`
- One short narrative paragraph explaining the speed/quality tradeoff.

Avoid a marketing-style hero. This is a technical report, so the first screen should be dense, useful, and scannable.

### 2. Recommendation Cards

Show 3-5 cards, each with a practical recommendation:

- **Use for coding:** `qwen36-35B-A3B`
- **Use for maximum speed:** `qwen36-35B-A3B-q4-ngram`
- **Use as conservative default:** `qwen36-27b`
- **Use for alternative style:** `mythos`

Each card should include:

- Profile name
- Best use case
- Speed metric
- Quality metric
- One-sentence tradeoff

### 3. Visual Comparison

Include charts that make tradeoffs obvious:

- Bar chart: average output tokens/sec by profile
- Bar chart: average latency by profile
- Scatter plot: quality vs throughput
- Optional small multiples: per-category quality or latency

The scatter plot is probably the most useful visual:

- X-axis: output tok/s
- Y-axis: quality %
- Bigger/focused point for recommended profile
- Label each point directly; do not require a legend to understand it

### 4. Profile Table

A sortable/filterable table should include:

- Profile
- Model artifact / quant
- Context length
- Parallel slots
- KV cache type
- Special flags
- Avg latency
- Avg output tok/s
- Quality %
- Completion status

Known profile configuration:

| Profile | Quant / Artifact | Context | Parallel | KV | Special |
|---|---|---:|---:|---|---|
| `qwen36-27b` | Q5_K_XL | 262144 | 1 | q8_0/q4_0 | Jinja |
| `qwen36-27B-AEON` | Q6_K | 262144 | 1 | q8_0/q4_0 | Jinja |
| `qwen36-35B-A3B` | Q5_K_P | 131072 | 1 | q8_0/q4_0 | Jinja, mmproj |
| `qwen36-35B-A3B-q4-ngram` | Q4_K_P | 262144 | 4 | f16/f16 | Jinja, unified KV, ngram-mod |
| `mythos` | PRISM-DQ GGUF | 131072 | 1 | q8_0/q4_0 | baseline profile |

### 5. Prompt-Level Drilldown

The current report exposes excerpts, but they are too noisy. The redesigned page should support drilldown without overwhelming the reader.

Prompt categories:

- Coding bugfix
- Coding shell function
- Assistant troubleshooting
- Creative constraints
- Long-context recall

For each prompt, show:

- Prompt category
- Short prompt description
- Per-profile latency and tok/s
- Rubric score
- Expandable response excerpt
- Link/path to raw response JSON

Use tabs or filters so readers can focus on:

- `Coding`
- `Assistant`
- `Creative`
- `Long-context`
- `All`

### 6. Reasoning Leakage / Output Cleanliness

This deserves its own visible metric. Many responses contained visible thinking text such as:

- `Here's a thinking process:`
- `<think>`
- empty `content` with useful text in `reasoning_content`

The report should not hide this. It affects real usefulness.

Add an “Output cleanliness” or “Reasoning leakage” metric:

- Clean visible answer
- Visible `<think>` / thinking preamble
- Empty `content`, fallback to `reasoning_content`

This can be shown as:

- badge on each profile card
- warning row in the table
- per-prompt indicator in drilldown

Suggested interpretation:

- `qwen36-35B-A3B` had the cleanest coding bugfix answer.
- Several profiles leaked reasoning text on other prompts.
- `qwen36-35B-A3B-q4-ngram` is extremely fast, but its lower score and thinking leakage should be visible.

### 7. Methodology And Caveats

Include a compact methodology section:

- All profiles were tested through `llama-server` OpenAI-compatible `/chat/completions`.
- Five benchmark prompts were used: coding, shell scripting, assistant troubleshooting, creative writing, and long-context recall.
- Quality is a lightweight rubric based on expected keyword/requirement hits.
- Quality score is not a full human evaluation.
- Timings are end-to-end non-streaming response timings.
- Raw responses are available for audit.

Make caveats prominent but not apologetic. They increase credibility.

## Interaction Requirements

The HTML report should be a single self-contained file that can be shared online.

Required interactions:

- Sort table by speed, latency, quality, or profile name
- Filter results by prompt category
- Toggle between `Summary`, `Profiles`, `Prompt drilldown`, and `Methodology`
- Expand/collapse raw excerpts
- Highlight recommended profile

Nice-to-have interactions:

- Hover tooltip explaining each metric
- Toggle to hide/show reasoning text in excerpts
- Toggle chart metric: tok/s, latency, quality
- Copy raw artifact path

Avoid requiring a build step or external server for the generated artifact.

## Visual Direction

Preferred feel:

- dark technical dashboard
- dense but readable
- polished enough to share on social media or in a blog post
- clear visual hierarchy
- no decorative blobs/orbs
- no generic SaaS landing page

Suggested palette:

- background: near-black charcoal
- panels: dark neutral gray
- primary accent: teal/green for speed
- secondary accent: amber for quality
- warning accent: red/orange for reasoning leakage or caveats

Use restrained cards, compact tables, and clear charts. Cards should summarize; tables should support inspection.

## End Result

The final page should let a reader understand the benchmark in under 30 seconds:

1. `qwen36-35B-A3B-q4-ngram` is the speed monster.
2. `qwen36-35B-A3B` is the practical balanced winner.
3. The 27B profiles are high quality but much slower in this run.
4. Output cleanliness/reasoning leakage matters and should be considered alongside speed.
5. The raw data is available and auditable.

The Markdown report should remain agent-friendly and complete, but the HTML report should become the primary human-facing artifact.
