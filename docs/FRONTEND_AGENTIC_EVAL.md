# Front-end + Agentic Eval Suite (v1)

A 17-prompt suite patterned after Kyle Hessling's Qwopus3.6 evaluations, rewritten from
scratch for this repo. Probes one-shot front-end (HTML/CSS/JS), creative canvas/WebGL,
and agentic reasoning. Designed to run against any local OpenAI-compatible endpoint via
the existing eval harness.

- **5 web design** — single-file HTML, must validate top-to-bottom on first turn
- **6 canvas / WebGL** — single-file `<canvas>` or `three.js` runtime, must run without console errors
- **6 agentic** — code debug, self-critique, multi-step planning, tool-use JSON, structured extraction (thinking + nothink)

Sampling defaults: design/canvas at temperature **0.75 / top-p 0.95**; agentic at
**0.3 / top-p 0.9**. Override per-prompt via the harness profile.

---

## Web design (5)

### 1. `design_saas_landing` — Helix observability landing page

```
You are designing the landing page for "Helix" — a developer-tool startup that ships
distributed-tracing infrastructure for streaming-data pipelines. Audience: senior data
engineers and SRE leads.

Output ONE complete, self-contained HTML5 document. No external CSS or JS files. Inline
everything. No image URLs — use CSS gradients, SVG, or canvas for any visual interest.

Required sections, in order:
  1. Sticky top nav (logo wordmark + 4 links + a "Book demo" CTA).
  2. Hero with a one-line headline, a two-line sub-headline, primary + secondary CTA,
     and a live-looking animated terminal panel on the right showing fake trace events
     scrolling. The terminal must actually animate (CSS or JS).
  3. Three-up "why teams switch" feature grid with custom inline-SVG icons.
  4. A one-sentence customer logo strip (SVG-only logos invented by you, 5 of them).
  5. A 30-second product tour broken into 4 vertically-stacked steps with screenshots
     drawn in pure CSS/SVG (no real images).
  6. Pricing teaser linking to /pricing (just an anchor, no real route).
  7. Footer with 4 link columns + a small status-page badge ("All systems normal").

Visual language: dark (#0a0c12 base), one cool accent (cyan or indigo), generous
whitespace, system font stack, and one tasteful micro-interaction per section.
Total page should feel production-ready, not scaffolded.
```

### 2. `design_analytics_dashboard` — Operations dashboard, light theme

```
Build a single-file HTML analytics dashboard for an internal "OpsPulse" tool that
tracks request latency, error rate, and queue depth across 12 microservices.

Light theme. Emerald primary accent. System font stack.

Layout:
  - Left rail with 6 nav items and a collapsed-state toggle.
  - Top bar with environment switcher (prod / staging / dev) and a date range picker.
  - 4-tile KPI strip across the top (p50, p99, error rate, in-flight requests),
    each with a small inline sparkline.
  - One large chart area (line chart, 24h window) drawn in pure SVG with axis labels,
    gridlines, and hover-on-line tooltips. Use hardcoded sample data.
  - One service health table below: 12 rows, columns for service name, status pill,
    p99 latency, error rate, deploy time. Sortable column headers (JS).

No external dependencies. All hover and toggle states must be wired and visible.
```

### 3. `design_designer_portfolio` — Solo designer portfolio, kinetic typography

```
Single-file HTML portfolio for "Ines Marchetti" — a freelance product designer based
in Lisbon. Tone: confident, minimal, slightly editorial.

Hero must be kinetic typography — animated word swap or CSS-driven text reveal — not
a static headline. No images: every visual is CSS, SVG, or canvas.

Sections:
  1. Hero with kinetic headline + tiny intro paragraph + scroll cue.
  2. Selected work grid (4 cards). Each card has an invented project name, year, role,
     and a CSS-only thumbnail (gradient + shape composition).
  3. About section with a left column of prose and a right column listing 6 clients.
  4. A single testimonial block, large pull-quote style.
  5. Contact section with email mailto and 3 social SVG icons.
  6. Footer with copyright and a one-line colophon.

Dark background, off-white text, one warm accent (amber or coral). Page must feel
intentional and quiet, not crowded. End with </html>.
```

### 4. `design_pricing_page` — Three-tier pricing with billing toggle

```
Single-file HTML pricing page for "Conduit" — a B2B integration platform.

Three pricing tiers: Starter ($0), Team ($29/mo per user), Scale (Contact us).
Annual / monthly toggle that updates the displayed prices live (JS), with the annual
view showing a "save 20%" badge on the Team tier.

Each tier card lists:
  - Price (animated when toggled).
  - One-line positioning sentence.
  - 6-item feature checklist (custom inline SVG checkmarks).
  - A primary CTA, with "Most popular" tag on the Team tier (rotating conic-gradient
    border or equivalent flair — actually animated, not a static stripe).

Below the cards: a 6-row feature comparison table with collapsible category groups.

Below that: a 5-question FAQ accordion (one open by default, the rest closed,
keyboard-accessible toggle).

Footer with the standard nav + status pill. Dark theme, indigo accent. End with </html>.
```

### 5. `design_mobile_app_marketing` — App marketing page with CSS-only phone mock

```
Single-file HTML marketing page for "Tide" — a mobile journaling app focused on
end-of-day reflection. No real images: build the phone mockup in pure CSS (rounded
rectangle device, notch, status bar, in-app screen content). The in-app screen must
show a believable "today's reflection" UI with at least 3 interactive-looking elements.

Sections:
  1. Hero: left column has copy + App Store / Play Store SVG-mock badges; right
     column has the CSS phone mock. The mock must subtly animate (gentle float or
     a breathing 4-7-8 cadence indicator inside the app screen).
  2. Three feature cards, each with an SVG icon.
  3. A "your reflection week" panel showing a 7-day grid of mood pills.
  4. A pricing strip — single row, free + premium ($4.99/mo).
  5. Footer with privacy, terms, support links.

Calm aesthetic, off-black background, soft teal accent, generous spacing. End with </html>.
```

---

## Canvas / WebGL (6)

### 6. `canvas_particle_attractor` — Mouse-driven fluid swarm

```
Single-file HTML page. Full-window <canvas>. JS only, no libraries.

Simulate ~3000 particles in a fluid-looking swarm. Each particle has position and
velocity. Particles are gently attracted to the mouse pointer (or to the center if the
mouse hasn't moved). Apply mild damping so the system doesn't blow up.

Use additive blending (`globalCompositeOperation = "lighter"`) and a low alpha trail
(don't fully clear the canvas each frame) for a glowing motion-trail look. Background
near-black. Particles a single cool color with slight per-particle hue jitter.

Use requestAnimationFrame, handle window resize, and devicePixelRatio scaling. The
animation must run cleanly with no console errors.
```

### 7. `canvas_generative_flowfield` — Ink-line agents on simplex noise

```
Single-file HTML. Full-window <canvas>, no libraries (inline a tiny simplex/perlin noise
function — Stefan Gustavson-style is fine, write it inline).

Simulate ~200 long-lived agents. Each agent reads a 2D noise field for its heading and
walks one pixel per frame, drawing a faint ink-line trail. Agents that leave the canvas
respawn at a random edge. The noise field should slowly evolve over time (3rd dim = t).

Aesthetic: warm off-white paper background, soft black ink with low alpha. The image
should accumulate and look like a generative ink drawing after a few seconds.

Handle resize and DPR. No console errors.
```

### 8. `canvas_three_scene` — Transmissive crystals with bloom

```
Single-file HTML, full-window canvas. Use three.js loaded from a single CDN <script>
tag (esm.sh or unpkg) — the only allowed external resource.

Scene: 7 floating low-poly crystal shards (icosahedrons or similar) drifting around a
center point with gentle rotation and bobbing. Material is MeshPhysicalMaterial with
high transmission, low roughness, ior ~1.5, and a faint colored tint per shard.
Add an EffectComposer with a UnrealBloomPass for bloom on the highlights.

Lighting: one directional key, one cool fill, plus an environment map built from a
single PMREMGenerator + RoomEnvironment for nice reflections.

Camera: slow orbit. Background: very dark, slight gradient. Handle resize. No errors.
```

### 9. `canvas_webgl_shader` — Raymarched signed-distance scene

```
Single-file HTML. Full-window <canvas>. Pure WebGL2 — write the vertex and fragment
shaders inline as string literals. No three.js, no libraries.

Render a fullscreen quad. In the fragment shader, raymarch a signed-distance scene:
the smooth-min union of a slowly morphing sphere and a torus, plus a ground plane with
a subtle checker. Use a basic Lambert + spec lighting model with one moving directional
light. Animate the morph and light direction off `iTime`.

Provide proper shader compile/link error handling — if compilation fails, write the info
log to the console and to an on-page <pre> tag so failures are visible. Handle DPR and
resize. The page must show a moving 3D-looking image, not a black canvas.
```

### 10. `canvas_physics_sandbox` — Verlet soft-body cloth

```
Single-file HTML, full-window <canvas>, no libraries.

Implement Verlet integration to simulate a 24x16 grid of point masses connected by
distance constraints (a hanging cloth). Pin the top row. Apply gravity. Iterate the
constraint solver ~6 times per frame for stability.

Mouse interaction: dragging tugs nearby points. Right-click (or Shift+click) cuts the
nearest constraint, letting the cloth tear.

Render as a thin line mesh with a subtle gradient fill per quad. Background dark.
Handle resize and DPR. Must run stably for at least 60 seconds with no NaN explosions
and no console errors.
```

### 11. `canvas_audio_reactive` — Mic-input audio visualizer

```
Single-file HTML, full-window <canvas>, no libraries.

Use the WebAudio API + getUserMedia to capture microphone input and run it through an
AnalyserNode (FFT size 1024). Render a radial frequency-bar visualizer: 64 bars in a
circle, each bar's length driven by a frequency bin, colored by frequency (hue
gradient). Add a smooth bass-pumped scale on the whole ring.

CRITICAL: the AudioContext must only be created/resumed inside a user-gesture handler
(click anywhere). Show a clearly visible "Click to start" overlay until the user
gestures, then fade it out. If mic permission is denied, fall back to a synthesized
1Hz sine + slow noise so the page still animates and isn't black.

Handle resize, DPR, no console errors on the happy path.
```

---

## Agentic reasoning (6)

### 12. `agentic_multi_step_planning` — Webhook receiver deploy plan

```
Plan the deploy of a small Python webhook-receiver service. The plan is for a developer
to execute by hand on a fresh Ubuntu 24.04 box.

Constraints:
  - Service: FastAPI app with a single POST /events endpoint that validates an HMAC
    signature header and persists each event to SQLite.
  - Tests: pytest, must run before container build.
  - Container: Dockerfile (python:3.12-slim base), exposed on :8080.
  - Process: systemd unit running the container under a non-root user.
  - Verification: a final curl call from another shell that posts a signed payload.

Output a numbered plan of shell + tool calls, max 18 steps. Each step is one specific
command or one specific file path being created (not "set up the project"). DO NOT write
the application source code itself — only the deploy and verification steps. Available
tools: `shell(cmd=...)`, `write_file(path, contents)`, `http_request(method, url, headers, body)`.
```

### 13. `agentic_self_critique` — Sliding-window maximum

```
Implement, then critique, then improve a Python function:

    def max_in_windows(nums: list[int], k: int) -> list[int]:
        """Return the maximum of every contiguous window of size k."""

Output exactly three sections, in this order, with these literal headings:

INITIAL: a working but naive implementation with a one-paragraph note on its time
complexity.

CRITIQUE: a numbered list of three concrete weaknesses (correctness, performance,
or edge cases) — be specific, not generic.

IMPROVED: a corrected implementation that is O(n) using a monotonic deque, plus a
two-sentence rationale and one example showing input and output.

No other prose. No code fences around section headings, only around code.
```

### 14. `agentic_code_debug` — Buggy `count_inversions`

```
The following Python function is supposed to count inversions in a list (pairs (i, j)
with i < j and nums[i] > nums[j]). It has multiple bugs.

    def count_inversions(nums):
        count = 0
        for i in range(0, len(nums)):
            for j in range(0, i):
                if nums[i] > nums[j]:
                    count =+ 1
        return count + 1

Identify every bug as a numbered list with a one-sentence reason for each. Then output
a corrected implementation. Then output one minimal pytest test (`def test_...`) that
would have caught at least two of the original bugs at once.

Be precise: do not flag style issues as bugs.
```

### 15. `agentic_structured_extraction` (thinking on)

```
You are given a meeting note. Extract structured JSON.

------ MEETING NOTE ------
Date written: 2026-04-21 (a Monday). Author: Priya.

Got the team sync done. Karen is taking lead on Aurora and Lumen now that Dan is
rotating onto on-call. Priya stays on Meridian. Karen's email is karen@northwind.io,
phone +1 415 555 0144, role Staff Engineer. Dan is dan@northwind.io, role Senior
Engineer; he didn't share a phone. Priya is priya@northwind.io, +1 510 555 0102,
Engineering Manager.

Aurora's next checkpoint is next Tuesday at 14:30 Pacific. Lumen demo is the Friday
after that, same time. Meridian's design review slid to the Monday after the Lumen
demo, 10:00 Pacific.
------ END NOTE ------

Output a single JSON object, no commentary, with this schema:

{
  "people": [
    {"name": "...", "email": "...", "phone": "..."|null, "role": "..."}
  ],
  "projects": [
    {"name": "...", "lead": "...", "next_event_utc": "YYYY-MM-DDTHH:MM:00Z"}
  ]
}

Resolve all relative dates against the document date 2026-04-21. Convert all event times
from Pacific (PDT, UTC-7) to UTC. Sort `people` by name. Sort `projects` by next_event_utc.
```

### 16. `agentic_structured_extraction_nothink`

```
[Same prompt body as #15 — `agentic_structured_extraction` — run with thinking turned
OFF. Used to compare reasoning-on vs reasoning-off behavior on the same task.]
```

### 17. `agentic_tool_use_json` — Trip planner tool sequence

```
You have these tools:

  search_flights(origin: str, dest: str, date: str (YYYY-MM-DD), max_price_usd: int)
  book_hotel(city: str, checkin: str, checkout: str, guests: int, max_price_usd_per_night: int)
  get_weather(city: str, units: "metric"|"imperial")

User request: "I'm going from Chicago to Reykjavík for a long weekend, leaving Friday
2026-09-18, returning Monday 2026-09-21. Two of us. I'd like to keep flights under
$900 total per person and a hotel under $220 per night. I want the forecast in Celsius."

Output ONLY a JSON array of tool calls in the order they should be executed. Each
element is an object with keys "tool" and "args". No prose, no code fences, no commentary.
```

---

## Sampling and harness notes

| Category | Temperature | Top-p | Max tokens |
|---|---|---|---|
| design (1–5) | 0.75 | 0.95 | 32000 |
| canvas (6–11) | 0.75 | 0.95 | 12000 |
| agentic (12–17) | 0.3 | 0.9 | 8000 |

For the JSON harness file, design/canvas validation is loose — the harness substring
checks can only confirm `<!DOCTYPE html>`, `</html>`, and a few requested keywords; visual
quality requires manual review. Agentic prompts validate cleanly with substring checks
over the expected reasoning artifacts.
