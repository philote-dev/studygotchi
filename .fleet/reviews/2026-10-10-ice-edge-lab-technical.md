# Ice edge lab: technical review

Date: 2026-10-10 (measured 18:55–19:31). Reviewer: Technical (edge review panel, lens 2 of 2). Harness: Playwright on headless Chromium, ANGLE Metal (Apple M4 Pro), 1280×720; `renderer.info` read through the R3F store; WebGL `draw*` wrapped as a cross-check (matched exactly). Full report with raw JSON: `/tmp/edge-review/REPORT.md`. Caveat: the tree changed during the review (endless and barriers builders, `layout/terrain.ts` + `scene/Terrain.tsx` at 19:11–19:12 for the back-of-range fix).

## 1. Cost (pixel pass on: every triangle drawn twice)

| technique | own draws (south-out) | tris/frame Δ | scene tris / meshes / instances | JS ms Δ | programs | build→ready cold / warm (max rAF gap) |
|---|---|---|---|---|---|---|
| none | 406 | 506k | — | 8.5 / 2.6 abs | 12 | 131–181 |
| endless | +30…+40 | +106k…+143k (+21–28 %) | 53k / 15 / 574 | +0.1…+0.8 | 13 | 475 (378) / 471 (364) |
| parallax | +12 | +46k (+9 %) | 23k / 5 / 0 | +0.0…+0.5 | 14 | 227 (93) / 196 (79) |
| curvature | +0 | +19k (+4 %) | patches 1767 materials | +0.1…+1.2 | 22 (+10) | **1164 (983)** / 274 (154) |
| barriers | +10 | +30k (+6 %) | 25k / 12 / 205 | +0.2…+1.5 | 23 (+11) | 357 (227) / 359 (201) |
| sea | +26 (≤ +21 more with ship/whales) | +51k (+10 %) | 26k / 24 / 232 | +0.2…+1.9 | 28 (+16) | **907 (647)** / 264 (131) |
| cloudsea | +8 | +116k (+22 %) | 57k / 7 / 1168 | +0.3…+1.8 | 25 (+13) | 619 (468) / 416 (293) |

rAF is vsync-bound (17–19 ms mean) for everything including the baseline; read the JS and build columns. Sea and curvature are shader-compile bound cold; endless and cloudsea geometry-build bound.

## 2. Crack hunt (266 shots: 8 poses + 11 reachable extremes × 7 × day/night; `/tmp/edge-review/sweep/`)

- Rig, all techniques: the plate's straight north cut and vertical cut face are in frame from the NW/NE corners (380 m, 12°) for none, endless, parallax, curvature, barriers; only sea's north apron hides it. The baseline `Aurora` ribbon crosses the foreground mountains from the corners at night.
- endless: pack plates have long axis-aligned straight edges (lattice tiles); far-ring leads alias into dark horizontal streaks at the horizon; cut face exposed at the corners.
- parallax: invisible by day (rings behind fogFar 640; 0–3 % of upper-frame pixels differ from baseline); reads at night and at horizon-max only.
- curvature: town untouched; sea rolls cleanly; cut face exposed at the corners (bend starts at 160 m, cut at 170 m).
- barriers: camera leaves the fence beyond ~300 m (ring between camera and town at horizon-max, zoom-max, all corners); dark sea band between the peaks at north-out; transient `Invalid array length` crash mid-edit.
- sea: removes the straight cut (north apron); saturated teal wedges between the peaks at north-out; moon path renders as a bright blotch.
- cloudsea: cut face becomes a ruler-straight cliff line into cloud; aurora planes hard-edged; deck rim a hard line at night.
- Scan: 0 one-px sky/sea seams, 0 true background leaks in 266 shots.

## 3. Reversibility

Top-60 % pixel diff after technique → none: 0 px at south-out for all six; overview 0 px outside the ambient cloud band. State over 3 mount cycles: endless, parallax, barriers, cloudsea return programs/geometries/materials exactly; fog 220/640 restored; dev hooks deleted; water disc restored. curvature retains +8 compiled programs (bounded); sea +1 (pixel-pass normal material instance-colour variant).

## 4. Pixel pass

No shimmer attributable to any technique (200 ms diffs under reduced motion equal baseline). Candidates for normal-edge outlines: barriers sweep cone, sea whale puff, cloudsea aurora planes and night points. Parallax dome (BackSide, no depth write) is correct for the pass.

## 5. Code findings

1. Territory: endless rewrote `layout/terrain.ts` and `scene/Terrain.tsx` (sanctioned for the back-of-range fix; must be reviewed as a product change). `barriers.tsx` imports `createOuterWorld` from `endless/` (cross-technique coupling).
2. Tests mid-edit were red (barriers build/geography, combined, endless outer-mesh); re-run before merge.
3. curvature: `needsUpdate` on all 1767 materials at install and uninstall (983 ms cold hitch, doubled by StrictMode); full traverse every 15 frames; strong refs until unmount.
4. sea: whole-scene traverse every 90 frames forever; 4 allocations per frame.
5. cloudsea: 1168 instance matrix writes per frame; unnamed root group.
6. parallax: copies scene fog, hence invisible by day.
7. endless: mount build on the main thread (364–378 ms stall); `endlessFog` 260/1700 retunes the town's fog as well; storm fog overridden (catastrophe reads thinner) — also sea and cloudsea.
8. barriers: no `camera` override although the ring sits inside maxDistance 380.
9. No `Math.random`; seeds via props; disposal correct in all six.

## 6. Robustness

0 page errors, 0 console errors for all 7 states × {mount, dark, 3 rapid theme flips, blizzard → ruin, theme flip in ruin, technique remount in ruin, recover}.

## 7. Ranked risks and fixes

- endless: land the terrain/Terrain change as a reviewed product change behind a flag; jitter or rotate the tile lattice per ring and fade lead colour to sky in the far ring; build rings across frames or in a worker; keep fogNear 220 and only push fogFar; aprons on the east and west cuts.
- sea: share one patched toon material per role and precompile at idle; stop the traverse after the first read; clamp the moon path near the horizon; desaturate the annulus toward the apron.
- curvature: patch only materials that can reach r > 160 m; compile lazily; pair with an apron.
- barriers: `camera.maxDistance` ≈ 300 or ring beyond ~400 m; finish the refactor; move the shared heightfield interface to `edge/shared/`.
- cloudsea: sway via a vertex-shader uniform or update heads in frustum only; soft-alpha aurora ribbon; name the root group.
- parallax: own fog in `sky` (fogFar ≥ 1200) or skerries inside 600 m; otherwise the cheapest technique.
- rig: the free camera exposes the cut face and the Aurora plane from the corners; every shipping combination needs aprons on all cuts and should replace or gate the ambient Aurora quad.
