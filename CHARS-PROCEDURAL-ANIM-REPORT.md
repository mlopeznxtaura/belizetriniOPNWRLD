# Procedural walk / run / idle for the iter2 characters (build_characters iter2, live GLBs from 838b703)

The live `male.glb` / `female.glb` / `player.glb` are static (181 / 223 flat meshes, no skin, no clips).
They are **not modified**. Animation is built at load time in the browser.

## Rig (public/js/char_rig.js + public/js/char_rig_data.js)
- `tools/marco_char_delta/gen_rig_map.py` reads Marco's raw `*_build_v2.glb` (which still contain the
  build_characters.py joint tree), fits them onto the live GLBs (least squares, residual 0.00 mm) and
  writes `char_rig_data.js`: 17 joints (Hips, Spine, Chest, Neck, Head, UpperArm/LowerArm/Hand L/R,
  UpperLeg/LowerLeg/Foot L/R) with their positions, plus a mesh -> joint map for every mesh
  (fingers on Hand, backpack on Chest, tank/crop pieces on Spine/Chest, boots on Foot, and so on).
- `ProceduralRig.create()` builds a pivot Object3D per joint at the anatomical joint position and
  re-parents each mesh under its joint (a rigid-part rig). Small skin-coloured joint spheres fill the
  elbow and wrist creases; the authored knee/shoulder balls already cover those joints.
- One gait phase is shared by both legs. Stride length grows with speed and cadence = speed / stride,
  so stance feet stay planted (measured slip <= 0.1 cm). Each foot follows a heel-strike -> flat -> toe-off
  path, with the exact lowest boot vertex on the ground at every pitch (soles within 0.02 cm of y=0).
  Swing lifts the foot (with a heel kick when running). Legs use exact 2-bone IK against the real
  hip-joint position, and thigh/foot orientations are set relative to the hips, so pelvis twist, roll and lean never lift or sink the feet.
- Idle: breathing (chest/shoulders), slow weight shift with planted feet, head look drift.
- Walk (2.6 m/s): hip bob and drop, lateral sway, pelvis roll, pelvis yaw with chest counter-twist,
  arms counter-swing about 18 deg with a relaxed elbow.
- Run/sprint (9 m/s, Shift): flight phase, shorter ground contact, forward lean of about 11 deg plus
  acceleration lean, banking into turns, knees driving high, arms pumping about 45 deg at about 85 deg elbow bend.
- Walk and run blend continuously by ground speed. Walls reduce the real ground speed, so the gait slows too.
- Seated: the scooter and car have their own seated poses (thighs forward, knees bent, hands forward
  on the bars or wheel); the hips joint sits on the seat. It blends in and out on enter/exit.
  Riders were facing backwards since v3; this is fixed with a seat yaw of pi.

## Movement (public/js/player.js)
- Acceleration (walk 9, sprint 12 m/s^2) and deceleration (14 m/s^2); a full sprint stops in about 0.8 s.
- Walk 2.6 m/s by default; hold Shift to sprint at 9 m/s (the old walk pace). Mobile stick: a light push
  walks, a full push sprints.
- The character's facing (`heading`) is separate from the camera yaw and turns smoothly toward the
  move direction (rate-limited, slower when sprinting; sharp turns bleed speed).
- On-foot follow camera: damped position and target. It drifts back behind the player while moving
  after about 0.9 s without mouse input, pulls back a little and widens FOV 60->64 while sprinting, and
  snaps on teleport. The vehicle camera and vehicle physics are unchanged.

## Verification (headless, real Player / Vehicle code)
- `node tools/rig-capture.js` writes `tools/marco_char_delta/anim_verify/SHEET_anim.png`
  (male and female: idle, walk heel strike, walk passing, sprint flight, sprint stance),
  `SHEET_seated.png` (joint close-up, scooter, sedan) and `metrics.json`.
- `node tools/game-smoke.js male|female` loads the real index.html, walks, sprints, turns, stops,
  enters, drives and exits a car. No JS errors.
- Metrics (both characters): foot slip in stance <= 0.1 cm, lowest sole -0.02 cm, knees never
  hyperextend (min +2 deg), elbows never bend backwards, the nose is always ahead of the head (faces the
  move direction), walk cadence 1.76 Hz, sprint 2.56 Hz.

## Known limits
- Parts are rigid; nothing deforms. Joints are covered by overlap and filler spheres, not skinning.
- The leg IK is planar (legs swing forward/back; no side-stepping or strafing animation).
- Car bodies are opaque, so sedan and van riders are mostly hidden; the scooter rider is fully visible.
- Walking is now slower (2.6 m/s). Sprint equals the old walk speed, so cops feel faster on foot.
- The GLBs still have no authored clips. If Marco ships skinned clips later, the Mixamo mixer path in
  player.js takes over automatically.
- `tools/marco_char_delta/normalize_export.py` now points at the iter2 build_v2 sources (no more silent
  lowpoly rebuild). It was not re-run.

## Shipped
- Code commit `9aedc1fc78aa0cc98f1340d2addfc03bf77fc45d`, pushed to main before the deploy.
- Cloudflare Worker `nextaura-app13-us` version `58baf82f-a4e4-421d-a234-e2f5a29bdddc` (2026-09-24, PT).
- Live check: https://app13.nextaura.us/js/{player,char_rig,char_rig_data}.js are byte-identical to
  `git show 9aedc1f:public/js/...`. The live male/female/player.glb are unchanged (same blobs as 838b703).
