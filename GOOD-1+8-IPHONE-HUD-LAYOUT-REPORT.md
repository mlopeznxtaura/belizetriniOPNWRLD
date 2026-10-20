# good-1+8: iPhone HUD layout (portrait + landscape, safe areas, no overlaps)

- **Goal:** fix the iPhone HUD overlaps. In portrait the mission card sat over the clock, and the minimap sat behind the F/Brake touch buttons. Use `env(safe-area-inset-*)`, stack the clock and mission card without overlap in portrait, and move the minimap clear of the touch controls.
  - This goal was inserted by the user after good-1+7, which is why it takes this number.
- **Base:** `4977aa3` (good-1+7)
- **Deployed:** no

## What was wrong (good-1+7, measured)
`tools/hud-layout-test.js` found **25 overlapping HUD box pairs per engine** across the 4 phone layouts (`hud_before_{chromium,webkit}.json`, `before_*.png`):

| overlap | where |
|---|---|
| mission card ↔ clock | every portrait layout; SE landscape too |
| mission card ↔ wanted stars / health bar | portrait |
| mission card ↔ cash / pause button | SE |
| cash and wanted stars ↔ the **II** pause button | every touch layout |
| **minimap ↔ F and Brake** (64×64 each) | every touch layout |

## What changed
### `public/index.html`
- `viewport-fit=cover`. Without it, iOS Safari reports zero safe-area insets.

### `public/css/style.css`
- `:root` variables `--sat/--sar/--sab/--sal` = `env(safe-area-inset-*, 0px)`.
- **Every edge-anchored HUD element** adds its inset: stats, mission card, clock, minimap, district label, prompt, stick, F, Brake and pause.
- **`html.touch` (all orientations):**
  - The stats column (cash, stars, health) moves left of the pause button (`right: 62px + inset`).
  - The **minimap leaves the bottom-right corner**: it now sits under the stats (104 px), so the F/Brake corner is free.
  - The mission text is slightly smaller.
  - The district label gets a dark pill so it reads against the sky.
- **Portrait:**
  - clock top-left, stats top-right (row 1)
  - **mission card stacked below them** (top 96 px + inset), spanning to the left of the minimap
  - district label under the minimap
  - toast at 46 %
- **Landscape:**
  - mission card limited to `min(320px, 50vw − 80px)`, so it stays left of the centred clock (the SE landscape overlap)
  - district label centred under the clock
  - minimap 96 px, which clears F on a 375-px-tall SE
  - toast narrowed so it misses the card and the minimap
- **Desktop / non-touch is unchanged:** the only change there is the `+ inset` terms, which are 0.

### `public/js/main.js`
- `_bindMobile()` adds `html.touch` when it reveals the touch controls.

## Verification (`docs/fidelity/good-1+8/`)
**The test.** `tools/hud-layout-test.js` (new) runs in Chromium and WebKit. It forces the **worst case on screen**:
- the longest mission brief (Rival Intercept)
- a prompt
- a toast
- 5 stars

It then measures the bounding boxes of 13 HUD elements: clock, mission card, cash, stars, health, minimap, district, prompt, toast, pause, stick, F, Brake. Any pair intersecting by more than 0.5 px counts as an overlap, and so does any box that leaves the viewport or the safe area.

Headless engines report `env()` = 0, so the two `_insets` layouts inject the real iPhone 15 insets through the CSS variables:
- portrait: 59 top / 34 bottom
- landscape: 59 left / 59 right / 21 bottom

| layout | before (good-1+7) Chromium / WebKit | **after** Chromium / WebKit |
|---|---|---|
| iPhone 15 portrait 390×844 @3 | 7 / 7 | **0 / 0** |
| iPhone SE portrait 375×667 @2 | 9 / 9 | **0 / 0** |
| iPhone 15 landscape 844×390 @3 | 4 / 4 | **0 / 0** |
| iPhone SE landscape 667×375 @2 | 5 / 5 | **0 / 0** |
| iPhone 15 portrait + notch insets | – | **0 / 0** (all inside the safe area) |
| iPhone 15 landscape + notch insets | – | **0 / 0** |
| desktop 1280×720 | 0 / 0 | **0 / 0** |
| **total** | **25 / 25** | **0 / 0** |
| page errors | 0 | **0** |

**Files**
- Data: `hud_{chromium,webkit}.json` (every box, every layout).
- Screenshots: `{chromium,webkit}_*.png`.
- `compare_portrait.png`: before, after 390×844, after SE, after + notch insets. Also copied to `/workspace/work/app13-good1-8.png`.
- `compare_landscape.png`: before / after.

I looked at the screenshots:
- The clock pill, stats and pause button share the top row without touching.
- The mission card sits below with the minimap beside it.
- F and Brake are alone in their corner.
- The prompt and toast are clear of everything.

**Regression:** `gfx-robust-test` on WebKit iPhone: 0 uncaught, 0 console errors, 0 shader warnings; the stick moves the player (`regress/`).

## Known limits
- **Insets are checked by injection, not by a real notch.** Headless engines cannot emulate `env(safe-area-inset-*)`; the values used are the iPhone 15 ones. Dynamic Island and home-indicator placement still needs a look on a device.
- **The minimap is smaller on phones** (104 px portrait, 96 px landscape, down from 160). The canvas is still drawn at 160 px and scaled down.
- **The ?debug=1 overlay (good-1+6) is not part of the check.** It is debug-only and can sit over the prompt.
