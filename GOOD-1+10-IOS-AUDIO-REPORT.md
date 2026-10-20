# good-1+10 — iOS sound (procedural WebAudio)

Base: `6e59a1a` (good-1+9). No audio files are shipped: every sound is synthesized with WebAudio.

## What
New `public/js/audio.js` (`GameAudio`), wired into `main.js` (created in the Game constructor, `update(dt)` each frame), `missions.js` (stings), `drive.js` (`audio: {state, muted}` in `/api/status` payload), `index.html` + `style.css` (pause-menu Sound toggle + silent-switch note).

- **Engine** — two detuned oscillators → lowpass → gain, pitch from speed through a simulated gearbox; per-type voice (sedan / van / scooter / plane / heli rotor thump via LFO on gain).
- **Footsteps** — filtered-noise tick per stride, rate from ground speed; new nodes per event, disconnected on `ended`.
- **Siren** — wanted ≥ 1 and a pursuit unit within 80 m; wail at 1–3★, yelp at 4–5★; gain by distance.
- **Stings** — mission complete (rising major arpeggio), mission fail (falling minor).
- **Ambience** — looped noise "surf" with a slow swell + "breeze"; birds by day, crickets by night (follows the game clock).
- **Mute** — pause-menu toggle, persisted in `localStorage['bto.muted']`; ramps master gain to 0.
- **Silent-switch hint** — on iOS UAs, a one-time toast after the first unlock (`localStorage['bto.audioHint']`); a static note under the toggle as well.
- `?audio=0` disables audio entirely.

## How the iOS unlock works
1. No `AudioContext` exists before a gesture (verified: state `none` on load).
2. Capture-phase listeners on `touchend`, `pointerup`, `keydown`, `click`, and the START button's click handler call `unlock()` **synchronously**: it constructs `window.AudioContext || window.webkitAudioContext` (falling back to the bare constructor if the options bag is rejected on old WebKit), plays a silent 1-sample buffer, and calls `resume()` — no `await` or promise hop before `resume()`. `resume()`/`suspend()` are wrapped to tolerate old WebKit returning no Promise.
3. When the context reports `running` (iOS does this asynchronously), the first-gesture listeners are dropped; one light listener stays to re-unlock from a fresh gesture if the context is ever not running (iOS sometimes needs a gesture after an interruption).
4. `visibilitychange → hidden` suspends the context; `visibilitychange → visible`, `pageshow` (incl. bfcache), and `focus` resume it. A `statechange` to `interrupted` (calls, Siri, other apps) or `suspended` while visible schedules a resume 300 ms later.
5. The HTMLAudioElement silent-loop trick (to play through the ringer switch) was deliberately skipped: not trivial to do well, and the hint covers it.

## Verification
| Test | Chromium 130 | WebKit (Playwright webkit-2370, WPE) |
|---|---|---|
| `tools/audio-test.js` (13 steps, iPhone UA 390×844, touch) | 13/13 OK, 0 errors | 13/13 OK, 0 errors |
| unlockInsideGesture (spy on constructor + `resume()`, records `window.event`) | created in trusted `pointerup`, already `running` | created `suspended` in trusted `pointerup`; first `resume()` in that same `pointerup` (stateBefore `suspended`); → `running`; 0 resume calls outside a gesture at unlock |
| suspend on hidden / resume on visible / pageshow / auto-resume after OS suspend | OK | OK |
| engine pitch by speed (idle → fast) | 78 → 127.3 Hz, RMS 0.076–0.107 | 78 → 127.2 Hz, RMS 0.080–0.107 |
| footsteps / sting / ambience day-night / siren / mute / hint-once | OK | OK |
| `tools/game-smoke.js male` | 0 errors | — |
| `tools/game-smoke.js female` | 0 errors | — |
| `tools/hud-layout-test.js` (7 layouts) | 0 overlaps, 0 outside | 0 overlaps, 0 outside |

The smoke "missing" list (`404 /api/state-sync`, `404 /api/drive/poll`) is the static test server not serving the API, unchanged from earlier baselines. WebKit produced real audio (non-zero RMS on an analyser on the master bus) once `GST_PLUGIN_PATH=/workspace/work/.wklibs/gst-plugins` was exported in `.wklibs/env.sh`. Artifacts: `docs/fidelity/good-1+10/` (`audio_{chromium,webkit}.json` incl. the full constructor/resume/state log, `*_sting.png`, `*_pause_mute.png`, `hud/`, `smoke_{male,female}.txt`).

## Limits
- Headless WebKit (WPE on Linux) is not iOS Safari: it does not enforce iOS's exact autoplay policy, the ringer switch, the `interrupted` state, or real backgrounding. Visibility/pageshow were simulated by overriding `document.visibilityState` and dispatching events; the interruption path was simulated with `ctx.suspend()` while visible.
- Sound content (mix, character of the synth voices) has not been judged by ear on a phone.
- With the silent switch on, iOS mutes Web Audio; only the hint addresses this (no HTMLAudioElement workaround).
- Not deployed.

## Manual iPhone test checklist
1. Ringer/silent switch **off silent** (ringer on), volume up.
2. Open the game in Safari, tap **START** → within ~1 s hear the surf/breeze ambience (birds by day). On first run a toast mentions the silent switch.
3. Walk → footstep ticks. Enter a car and accelerate → engine pitch rises with speed. Get wanted → siren as police close in.
4. Complete or fail a mission → sting.
5. Pause → **Sound: On/Off** toggles silence; reload → setting persists.
6. Swipe home (background) for ~10 s, return → sound resumes without tapping (if not, one tap anywhere should bring it back).
7. Receive a call or trigger Siri mid-game, then return → sound resumes.
8. Flip the silent switch on → game goes quiet (expected, iOS behaviour).
9. Repeat 2 and 6 as a Home Screen web app if installed.
