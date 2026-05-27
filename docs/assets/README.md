# docs/assets — branding & README graphics

Source of truth for the visual identity used by the top-level README and the GitHub repo card. Not user-facing; if you are reading this you are either adding/updating an asset or rasterizing one for upload.

## Files

| File | Role | Where it appears |
|---|---|---|
| `hero.svg` | Top-of-README banner. Chromatic-split wordmark + tagline + feature pill strip, all inside one scanline frame. Single image so the pills don't drift from the hero with paragraph margins. | `README.md` (top) |
| `architecture.svg` | Five-layer stack diagram: clients → API → systemd → backend → hardware. | `README.md` ("How it fits together") |
| `social-card.svg` | 1280x640 GitHub social preview. Stat-card layout. | Uploaded via repo Settings → Social preview |
| `social-card.png` | Rasterized `social-card.svg` for the GitHub upload (PNG required). | Same as above |

## Palette (kept in sync with `bench/assets/colors_and_type.css`)

| Token | Hex | Use |
|---|---|---|
| bg | `#050505` | base |
| surface | `#0A0A0A` | card fill |
| magenta | `#D600FF` | primary accent (llama.cpp lineage, "process" layer) |
| cyan | `#00B8FF` | secondary accent (ik_llama lineage, "client" layer) |
| success | `#19F0A8` | OpenAI-compat / hub accent |
| warning | `#FFC857` | hardware accent |
| fg | `#FFFFFF` / `#C9C9D1` / `#7A7A85` | primary / secondary / meta |

Font: `JetBrains Mono` with `Fira Code`, `SF Mono`, `Consolas`, `Monaco`, `monospace` as fallbacks. GitHub renders SVG via `<img>`, so the fallback chain matters (GitHub doesn't ship the font).

## Rasterization

Requires `librsvg2-bin` (apt: `sudo apt install librsvg2-bin`). Provides `rsvg-convert`.

Re-rasterize the social card after edits:

```sh
cd docs/assets
rsvg-convert -w 1280 -h 640 social-card.svg -o social-card.png
```

The hero and architecture SVGs are embedded directly in the README and don't need rasterization. Only the social card needs a PNG (GitHub's social-preview upload accepts PNG/JPG, not SVG).

## Uploading the social preview

1. Re-rasterize if `social-card.svg` changed.
2. GitHub → repo Settings → general → "Social preview" → upload `social-card.png`.
3. Verify by sharing the repo URL in a chat client; the OG image should appear.

## When to update

| Change | Update |
|---|---|
| New backend supported | `architecture.svg` (L4), `hero.svg` (pill strip), `social-card.svg` (backends count) |
| New eval adapter shipped | `architecture.svg` (L1), `social-card.svg` (eval suites count) |
| Palette change in the hub | `colors_and_type.css` first, then mirror tokens here |
| Project rename | every SVG (wordmark + ARIA `aria-label`) |

Keep ARIA `aria-label`s descriptive; they are read aloud by screen readers and indexed by image search.
