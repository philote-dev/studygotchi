# QA gate (`tools/qa/`)

Deterministic quality gate for every StudyGotchi asset, modelled on the technical contract in
`.fleet/org.md`. Every GLB must pass `check_glb.py` before it is "done"; `run_all.sh` runs every check
that has inputs and writes the fleet-facing report `assets/QA.md`. Nothing here modifies assets.

```bash
bash tools/qa/run_all.sh                       # everything (~20 s for 180 GLBs + 180 wavs, incl. Blender)
SKIP_SILHOUETTES=1 bash tools/qa/run_all.sh    # GLB + audio only, no Blender (~2 s)
```

Exit code 1 when any first-party GLB or wav fails. Outputs: `tools/qa/out/*.json` (machine),
`tools/qa/out/silhouettes-<set>.png` (grids), `assets/QA.md` (summary, worst offenders, blockers).

## Tools

### `check_glb.py` (Python 3, stdlib only)

Minimal glTF 2.0 parser: GLB header + JSON + BIN chunks (also `.gltf` with data: or side-car buffers),
accessors (all component types, strides, normalized, sparse), node TRS/matrix hierarchy, default
scene, skins (bind-pose linear blend skinning), animations, materials, extensions.

```bash
python3 tools/qa/check_glb.py assets/creatures/generated --kind creature
python3 tools/qa/check_glb.py assets/creatures/animated --kind creature --expect-clips idle,walk,happy,sad,sleep --exclude "*_input_snapshot*"
python3 tools/qa/check_glb.py "assets/creatures/cc0/**/*.glb" --third-party -v
python3 tools/qa/check_glb.py assets/landmarks --kind auto --json-out tools/qa/out/glb-landmarks.json
python3 tools/qa/check_glb.py some.glb --json          # JSON on stdout
```

| Check | Rule (FAIL unless noted) | Why |
|---|---|---|
| container | `glTF` magic, version 2, chunk lengths consistent, `asset.version` 2.x, accessors inside their buffers, indices inside `POSITION` | corrupt or truncated exports |
| triangles | per kind: creature < 1500, landmark-s1 < 400, landmark-s2 < 900, landmark-s3 < 1600, prop < 300 (org.md), terrain < 2500, growth < 2500, construction < 800, ruin < 600, scaffold < 400, hero < 2500, shared < 300 | runtime budget |
| manifest | `--manifest manifest.json`: kind from `kind`/`stage`/`variant` (`landmark` + stage 2 or variant `b` -> landmark-s2; `growth` keeps stage g0-g3; `catastrophe`/`decor` -> prop budget; `terrain`, `construction`, `ruin`, `scaffold`, `hero`, `shared` as named), `tags`, `family`/`biome`; a listed file missing on disk FAILs | workers cannot "finish" with text only |
| contrast | creatures: WCAG contrast of the GLB `<id>-body` material against the family ground from `--catalog assets/biomes/catalog.json` (`palette.ground`; `moon` -> `space`); < 1.4 FAILs (`--min-contrast`). The manifest's own `contrast_vs_ground` (number or `{ratio}`) is recorded and warned about if it differs by > 0.15; without a catalogue it is the fallback | Art Director contrast rule |
| animation contract | `--expect-clip-durations idle=2.0,walk=0.8,...` (+-`--clip-tol` 0.05 s), `--expect-nodes Root,Body`, `--static-nodes Root` (no channel may target it) | placement node stays still, clips are interchangeable |
| extensions | `extensionsUsed`/`extensionsRequired` must be empty (`--allow-ext a,b` to tolerate some); Draco / meshopt / basisu called out by name | R3F `useGLTF` gets plain meshes |
| textures | no `textures`/`images` and no `*Texture` material slots unless `--allow-textures`; external image URIs must exist beside the file | flat `baseColorFactor` materials, recolourable in code |
| materials | roughness outside 0.4-0.8, metallic > 0.05, missing `baseColorFactor`: WARN | contract says roughness ~0.6, non-metallic |
| min y | world-space bbox min y within +-0.005 m of 0 | feet/base on the ground plane |
| origin | bbox centre x and z within 25 % of the footprint of (0, 0) | origin at the base centre |
| height | creature 0.69-0.91 m (generator convention 0.70-0.90); landmark s1 0.30-0.70, s2 0.70-1.30, s3 1.40-2.20 (Brief 4: ~0.5 / 1.0 / 1.8 m); prop 0.01-1.50; terrain <= 3.0; growth (g0-g3) <= 5.0; construction <= 3.0; ruin <= 1.2; scaffold <= 1.3; hero <= 5.0; shared <= 3.0 (signpost <= 2.0 by name) | scale consistency in the world |
| front | creatures only: eye centroid z > 0. Eyes = vertices of the darkest flat material that are off the x axis (mirrored pair) and above the lowest quarter (legs). n/a (WARN) when no material is clearly darkest | +Z is the face |
| animations | clip names + durations; `--expect-clips` names must exist; names outside idle/walk/happy/sad/sleep: WARN; zero-length: WARN | animation contract |
| size | above the soft budget (creature 512 KB, landmarks 256/384/512 KB, prop 128 KB): WARN | download weight |
| units | largest extent > 50: WARN "probably not in metres" | third-party packs in cm |

World-space geometry applies the node hierarchy; skinned meshes are posed by their joints' rest TRS x
inverse bind matrices (what a viewer shows with no clip playing). Third-party files whose rest pose
differs from their bind pose therefore measure differently from Blender's forced bind pose; the
first-party pipeline (Blender export) has identical rest and bind poses and matches Blender to the mm.

`--kind auto` takes the budget from the manifest when `--manifest` is given and falls back to the path
(`creatures/`, `landmarks/` + `s1|s2|s3|stage1..3` in the file name, `props/`, `terrain/`). Paths containing a `cc0` folder are auto-tagged `third-party` (reported, never
fail; `--strict-third-party` to change that). Exit 1 when a first-party file fails.

### `silhouette_test.py` (Blender 5.2 headless)

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --python tools/qa/silhouette_test.py -- \
  --in assets/creatures/generated --set creatures-generated [--family archetype|biome|folder|all] [--cols 8]
```

Imports each GLB, clears imported animation (rest pose), hides the importer's bone-shape helper
objects, fits an orthographic 3/4 camera (azimuth 34 deg, elevation 22 deg, same angle as the contact
sheets, 4 % margin) to the evaluated bounding box and renders the alpha mask at 96 px and 48 px
(EEVEE, `film_transparent`, alpha > 0.5). Pixel work is numpy on `bpy.data.images` (no PIL).

| Metric | Rule | Meaning |
|---|---|---|
| `fill` | 0.25-0.75 of the silhouette's own bounding rectangle (aspect-neutral) | < 0.25 spindly, vanishes at 48 px; > 0.75 featureless block |
| `frame_fill` | reported only | share of the fitted square (penalises elongated shapes, so not thresholded) |
| `components` | exactly 1 at 96 px and at 48 px. A detached part counts when >= 2 % of the body at 96 px or >= 3 px at 48 px; smaller specks are WARN | floating antenna balls, stick-leg feet, whisker dashes |
| `distinctness` | mean per-pixel difference of the 48 px mask against every other member of the family; < 0.05 WARN "samey" | low = the family reads the same at icon size; the nearest sibling is named |

Family = archetype token of `<archetype>-<biome>-<seed>.glb` by default (`--family biome|folder|all`).
With `--manifest`, items tagged `decor` (ground rocks, lake discs) skip the fill and distinctness rules
(warn only) but must still be one connected component; they are marked `decor` in the grid cell.
Grid `tools/qa/out/silhouettes-<set>.png`: per cell the 96 px mask, the 48 px mask shown 2x, the id and
`f<fill> c<components96>/<components48> d<distinctness>`, green/red border. JSON beside it.

### `check_audio.py` (Python 3, stdlib `wave`)

```bash
python3 tools/qa/check_audio.py assets/audio [-v] [--kind sfx|voice|music|any] [--json-out tools/qa/out/audio-audio.json]
```

PCM 8/16/24/32-bit WAV only (float WAV fails as unreadable). Per file: duration, sample rate, channels,
bits, peak dBFS, RMS dBFS, silence share, leading/trailing silence, DC offset.

| Rule | FAIL / WARN |
|---|---|
| peak > -1 dBFS | FAIL (clipping risk) |
| peak <= -60 dBFS | FAIL, except pause tokens (`comma`, `period`, `question`, `pause`, `space`, `rest`, `silence`, `gap`) which WARN |
| duration outside the kind band: sfx 0.02-3 s, voice 0.05-10 s, music 1-600 s (kind inferred from the folder) | FAIL |
| channels not 1 or 2 | FAIL |
| sample rate not in 22050/24000/32000/44100/48000 | WARN |
| leading silence > 100 ms, DC offset > 2 %, peak < -12 dBFS | WARN |

### `run_all.sh` and `write_report.py`

`run_all.sh` discovers the sets (`assets/creatures/generated`, `assets/creatures/animated` minus
`_input_snapshot`, `assets/creatures/cc0`, `assets/landmarks`, `assets/growth`, `assets/props`,
`assets/audio`), passes each set's `manifest.json` and the biome catalogue when present, applies the
animation contract to the animated set (`EXPECT_CLIPS`, `CLIP_DURATIONS`), runs the gates that have
inputs, renders silhouettes for every GLB set and calls `write_report.py`, which
aggregates `tools/qa/out/*.json` into `assets/QA.md`: asset-set inventory (missing/empty folders are
blockers), per-set summary tables with triangle and height ranges, worst offenders with reasons, the
silhouette grids embedded, audio table, and the "Blockers for integration" list (every first-party
failure plus missing sets). Environment: `BLENDER`, `SKIP_SILHOUETTES=1`, `EXPECT_CLIPS`, `PYTHON`.

Mid-write detection: the script snapshots every set's manifest mtime and GLB count at start and again at
least 30 s later (after the gates). A set whose snapshot moved is **PENDING**: its numbers are kept as a
snapshot in `assets/QA.md`, its failures are not blockers and do not set the exit code, and
`tools/qa/out/run-meta.json` lists it. Re-run when the worker is done.

## Adding a rule

1. `check_glb.py`: compute the value inside `inspect()` and store it on `rec` (it lands in the JSON),
   then call `fail("reason")` for a contract break or `warn("...")` for a soft rule. Budgets live in
   `KINDS`; thresholds in the constants at the top (`MIN_Y_TOL`, `ORIGIN_FRAC`, `ROUGHNESS_BAND`).
   Add the column to `print_table()` if it should show in the terminal table.
2. `silhouette_test.py`: metrics are computed on the boolean masks in `main()` next to `tight_fill` /
   `components`; add a field to `rec`, append to `rec["reasons"]`, and extend the `metrics` string if
   it should appear in the grid cell.
3. `check_audio.py`: same pattern in `inspect()`; constants at the top.
4. `write_report.py`: new fields appear in the JSON automatically; add a column to the relevant table
   if the producer should see it in `assets/QA.md`.
5. Prove the rule bites: make a broken copy in `/tmp` (e.g. rotate a node 180 deg, add
   `extensionsUsed`) and check it fails; the negative cases used so far were a rotated, a lifted and a
   Draco-tagged `blob-city-1.glb`.

Conventions: stdlib only outside Blender; Blender scripts take their arguments after `--`; every tool
writes JSON with `tool`, `set`, `generated_at`, `summary`, `files[]` so `write_report.py` can stay dumb.

## Stage verification (`tools/qa/stage/`)

The gate for the persistent stage canvas: the only globe path (plan task S2-2, gate 1, 2026-10-13: "just don't forget
that it's pixelated") and, since gates 2-4 the same day, the only path for every hop (pull-back, galaxy, bead click,
Courses, the cloud dive and rise). Headless Playwright only (SwiftShader, no window), Playwright from
`prototypes/marker-lab`, PNGs through `constellation/png.mjs`; nothing added to `frontend/package.json` dependencies.

```bash
# dev server on http://localhost:3000 in mock mode — do not start a second one
cd frontend && npm run qa:stage                       # helper tests + verify.mjs -> tools/qa/out/stage (~4 min)
node tools/qa/stage/verify.mjs --only grain,diff      # subset: grain, diff, inert, interact, dive
node tools/qa/stage/verify.mjs --baseline /tmp/stage-s2   # folder with the approved S2 preview captures
```

| check | what it measures | passes when |
|---|---|---|
| `grain-dpr1` / `grain-dpr2` | **pixelation guarantee**: default `/earth` (dark, reduced motion), the globe region's middle half; share of aligned `cell`×`cell` device-px blocks that are one colour (`block-constancy.mjs`), cell 2 at dpr 1 and 4 at dpr 2; one stage canvas, no globe canvas; `globe-limb-4x-dpr*.png` crops for eyes | ≥ 99 % (2026-10-13 after consolidation: 99.67 % / 99.38 %, unchanged) |
| `diff-vs-s2-preview` | default `/earth` against the approved `?stage=planet` captures in the baseline folder, live and reduced motion, with the noise floors (two reduced captures from the baseline folder; two live frames 3 s apart) | reduced-motion diff within 3× its noise floor + 1 (2026-10-13 consolidation: 0.90 % vs a 0.59 % floor; live 9.7 % vs a 9.4 % floor, the page's own ships / walkers / twinkle) |
| `inert-params` | every former stage flag is inert: `?stage=planet`, `?stage=noplanet,nosky,planet=0`, `?stage=planet=1&sky=0`, `?stage=twin,galaxy,world,hop`, `?stage=notwin,nogalaxy,noworld,nohop&stage=twin=0`: same DOM shape (canvas counts, stage z-index, host) and reduced-motion diff vs the default | shape identical and ≤ 2 % (2026-10-13: 0.62–0.84 %; `frontend/lib/stage/params.test.ts` pins the parser side) |
| `interact` | wheel over the globe → settle → flag panel visible; hover scan for towns, click a non-active landmark → the flag follows | flag visible after both, a pick found (2026-10-13: wheel landed on 6.1400, pick moved to 6.1210) |
| `dive-rise` | the Land button runs the **cloud dive** on the director (gate 4): the land route at the press, then every animation frame of the flight is sampled (`dive-samples.json`): `min(planetFade, worldFade) > 0` only under the whole deck (`clouds` 1), a hold (`held`) only inside the deck and only while the land is not ready, rest on the world with the land open through the stage (`[data-land-mount][data-stage]`) and the stage still running; then "The planet" runs the rise back (`rise-samples.json`, same invariant), rest on the planet with the flag back, no globe canvas; then Land again from the planet (`warm`: the second visit) | every invariant holds (2026-10-13 under SwiftShader: dive 12.0 s with a 2.2 s hold inside the deck while the ice land built and compiled, 0 overlap frames in the clear; rise 5.0 s, no hold, 0 overlap frames). **Dive hold, 2026-10-14** (the land build moved into a Worker from the hover prefetch, `frontend/lib/world/land-build*.ts`): `holdMs` (deck whole → land ready) under SwiftShader, 3 runs, load 40–70: cold 556 / 727 / 926 ms, warm 415 / 434 / 479 ms; with the real GPU headless (`--use-angle=metal`, the same hop driven by `__stageHop.land`), 3 runs: cold 465 / 484 / 538 ms, warm first visit 214 / 217 / 219 ms, warm revisit 163 / 164 / 164 ms (before: 2 102 ms warm). Targets: ≤ 300 ms warm, ≤ 800 ms cold on the GPU. |

`tools/qa/out/stage/report.json` holds every number; `block-constancy.test.mjs` (`node --test`) pins the helper on synthetic
images (2 px cells → 100 % at cell 2 and ~50 % at cell 4; 4 px cells → 100 % at both; noise → ~0 %).

Hop timing at real cadence is not part of the gate (SwiftShader is software GL); it is measured with the new headless
Chromium on the GPU (`channel: "chromium"`, `--use-angle=metal`, CDP `Page.startScreencast`, an in-page rAF logger), see
the consolidation report of 2026-10-13 (`/tmp/consolidation/hops-report.json`, `*-frames.csv`, `*.webm`).

## Constellation self-regression (`tools/qa/constellation/`)

The gate for the knowledge constellation's renderer, the WebGL twin (`frontend/components/stage/layers/constellation/`).
It was built as a parity harness (plan tasks T-1 / T-6): `capture.mjs` photographed the Canvas2D constellation in every
meaningful state and `compare.mjs` pixel-diffed the twin against it (0.00 % noise floor across two 2D runs, worst twin
diff 0.40 % at `dark/hover@2x`, mean 0.09 %, the residue anti-aliasing along lit edges and sub-device-pixel DOM text at
dpr 2). On 2026-10-13 (gate 2, "phenomenal") the twin became the one renderer and the Canvas2D drawing path was deleted
(`KnowledgeCanvas` now only owns the d3 layout); the 2D baseline went with it, and **the twin's approved captures are the
golden snapshots**: `tools/qa/out/constellation-twin/<course>/<theme>/<state>[@2x].png`, 28 images (7 states × dark /
light × dpr 1 / 2), the same 28 states the parity gate measured. A run captures the twin again into
`constellation-twin/_run` and diffs it against the golden tree. Dependency-free: Playwright is resolved from
`prototypes/marker-lab` like `tools/edge-lab`, PNGs are read and written with `png.mjs` (node `zlib`), the diff is a
pixelmatch-style YIQ distance in `diff.mjs`. Nothing is added to `frontend/package.json`.

```bash
# dev server on http://localhost:3000 in mock mode (NEXT_PUBLIC_USE_MOCK_DATA, the default) — do not start a second one
cd frontend && npm run qa:constellation                                   # capture -> constellation-twin/_run, compare vs the golden tree (~4 min)
node tools/qa/constellation/capture.mjs --golden                          # regenerate the golden tree after an INTENDED visual change
node tools/qa/constellation/capture.mjs --out tools/qa/out/constellation-twin/_run2   # second run for the noise floor
node tools/qa/constellation/compare.mjs --self                            # golden vs _run2 -> constellation-twin/_self/report.html
node --test tools/qa/constellation/*.test.mjs                             # codec + diff + report tests
```

`capture.mjs` options: `--golden` (write the golden tree itself), `--out <dir>`, `--courses 8.223,6.1400` (fixture course
codes; default `8.223`), `--themes dark,light`, `--dpr 1,2`, `--states zoomed-out,hover` (subset), `--url` /
`CONSTELLATION_URL`, `--target .sg-twin`, `--keep <selectors>`, `--query condense=0` (extra page query, e.g. the T-4 dev
params). `compare.mjs` options: `--baseline <dir>` (default the golden `tools/qa/out/constellation-twin`), `--candidate
<dir>` (default `<baseline>/_run`) or `--self`, `--threshold 0.015` (max share of differing pixels per image, exit 1
above it), `--pixel-threshold 0.1` (pixelmatch colour threshold; 0 = exact), `--report <file>` (default
`<candidate>/report.html`, heat maps under `<report dir>/diff/`), `--courses/--themes/--dpr/--states` to narrow,
`--include-page` to also diff the page shots.

Result 2026-10-13 after the consolidation (the 2D path deleted, the twin always on, no `?stage=` flags): all 28 images
**0.00 %** against the golden tree captured before the deletion (`_run/report.html`): removing the hidden 2D canvas and
the flag plumbing changed no pixel of the twin.

### Output layout

`tools/qa/out/constellation-twin/<course>/<theme>/<state>[@2x].png` is the regression target: the `.sg-twin` element
alone (its transparent WebGL canvas and its DOM label layer, rasterised together), every DOM sibling on its path to
`<body>` hidden (`visibility: hidden`), so it is the constellation over the page background colour. `<state>[@2x].page.png`
is the full 1440×900 viewport with toolbar, docks, tooltip and concept panel for human review; it is **not** diffed by
default because the stage sky and the sound chip animate. `<state>[@2x].json` is `window.__constellation.getLayout()`
plus the state's steps and `ui` (`lens`, `filesOpen`, `tooltip`): camera, label layer, every node (`id`, `kind`,
`label`, `weight`, `radius`, `x`, `y`, cluster fields), links, `buildSpaceClusters` output, the cluster-label hit boxes of
the frame, hovered / selected / route / arriving / weak-trace ids, arrival ages and the frozen clock. `manifest.json`
summarises anchors, cameras and cluster lists per course. Byte-identical JSON across runs is part of the determinism claim.

### States (course 8.223 "Classical Mechanics II", graph hash `0b652e13`, 205 nodes = 186 concepts + 19 resources, 343 links, 8 clusters)

Viewport 1440×900, canvas 1440×900 CSS px (2880×1800 at `@2x`), world → screen `sx = (x − cam.x)·k + 720`,
`sy = (y − cam.y)·k + 450`. Draw clock frozen at `FROZEN_MS = 100000` for every capture. Fit camera for this fixture:
`{ x: 1.5610567079311295, y: -65.408665115551, k: 0.31169780713658707 }` (cluster layer, `FIT_CLUSTER_ZOOM` cap 0.81).
Hover anchor world position `(549.5203099929662, 498.41207769041335)`.

| state | steps (`states.mjs`) | camera `{x, y, k}` | ids |
|---|---|---|---|
| `zoomed-out` | `fit` | fit camera above | cluster labels: Constrained motion (37), Hamiltonian mechanics (33), Lagrangian mechanics (32), Oscillations (23), Orbital motion (20), Conserved quantities (17), Rigid body motion (16), Electromagnetism (8) |
| `zoomed-in` | camera at the hover anchor, k 2.0 | `{ 549.5203099929662, 498.41207769041335, 2.0 }` | centre node `0240617f-dc4b-4c3f-8107-8c9eb5143998` "Canonical Transformation" |
| `hover` | camera at the hover anchor, k 1.6; real `pointermove` on it | `{ 549.5203099929662, 498.41207769041335, 1.6 }` | hovered `0240617f-dc4b-4c3f-8107-8c9eb5143998`; focus set = node + adjacency, rest at alpha 0.14, edges 0.08; tooltip at the canvas centre (DOM) |
| `selected` | `fit`; `select` | fit camera | selected `085699dc-1387-441b-87ae-78f0951e3757` "Euler-Lagrange Equation" (ring, forced label, concept panel open) |
| `weak-areas` | lens `weak`; `fit` | fit camera | `weakTraceIds` from `weakTraceIdsForLens("weak", pickWeakSequences(...))` (listed in the JSON); dashed `[5, 9]`, dash offset `−(100000 / 86)`, pulse at rest (age 1600 ms → alpha 0.78); weak dock open |
| `files` | Files pill on; `fit` | fit camera | canvas identical to `zoomed-out` by construction; the dock is in the page shot |
| `route` | route + arriving override; `fit` | fit camera | route `0240617f-… → 9953f723-14f2-40c6-b5c8-d54c8e1c3cc3 ("Hamilton's Equations") → 085699dc-… → 1fb35d8d-8921-4f3f-8d2e-a0282052886d ("Equations of Motion for Coupled Oscillators")`; arriving = last two, born 208 ms before the frozen clock (pop phase 0.4 → scale 1.073, active glow) |

Anchors come from `window.__constellation.anchors()`: the two heaviest concepts (`weight` desc, id asc) and a walk from the
first to the heaviest unvisited concept neighbour (≤ 5 nodes; this fixture dead-ends at 4). Both themes use the same
cameras and ids. All 14 states × 2 dpr = 28 canvas PNGs, 28 page PNGs, 28 JSON files per course.

### Determinism and the noise floor

The layout was already deterministic (`forceLayout.ts` seeds positions from the node id; d3-force 3 jiggles with a fixed
LCG). What was not fixed was *time*: the capture freezes it.

| noise source | where | how it is frozen |
|---|---|---|
| asynchronous reheat | `KnowledgeCanvas` (the layout owner) layout memo: the fixture has 343 links but 340 distinct link ids, so every data arrival (seeded graph → mock graph → resources → identity → Clerk) takes the `syncLayout` reheat path; ~340 ticks of real frames, timing-dependent if a tick lands between two arrivals. In development React StrictMode runs the memo twice and the discarded second pass reheats the kept layout too | `whenQuiet(3000)` then `relayout()`: fresh seeded `createLayout` + synchronous 420-tick `settle` from the final model; the harness memo path returns that layout untouched on the StrictMode second pass; positions are re-read 2.5 s later and the loop repeats (≤ 6×) if anything moved; every state asserts the layout is still the settled one |
| box measured | the twin sizes itself from its own `getBoundingClientRect()`; the entrance keyframe that used to inflate it (`sg-galaxy-arrive`) is gone (the hop driver writes the chrome's opacity instead) | the measured size is asserted to be 1440×900 |
| camera tweens (380 / 420 / 900 ms) | `animateTo` | every state ends on `fit(0)` or `setCamera`, both instant; waits of 700 ms absorb tweens scheduled by lens / dock clicks |
| weak-trace dash offset and pulse | `lineDashOffset = −(now / 86)`, `weakPulse` over 1600 ms | `freezeTime(100000)` pins `now`; the pulse start is pinned to `now − 1600` (at rest) |
| arriving pops (520 ms) | `arrivingAtRef` births | births pinned to `now − 0.4·520` when the override is set and whenever `freezeTime` runs |
| web fonts | canvas text falls back until `Zen Maru Gothic` / `Instrument Sans` are loaded | `document.fonts.load` for both faces, then a repaint before every capture |
| CSS entrance / reveal animations | `.sg-constellation` arrive, dock reveal | `document.getAnimations()` finished + Playwright `animations: "disabled"` |
| WebGL stage behind the page | `StageCanvas` (sky, planet point, scenery) | the `.sg-twin` isolation (the stage is a sibling on the way to `<body>`); still visible in `*.page.png`, which is why page shots are excluded from the gate |
| GPU rasterisation | Chromium | headless shell + `--use-angle=swiftshader`: software Skia, same on every run |

Noise floor measured 2026-10-13 on the 2D renderer with two full runs and `compare.mjs --self`: **0.00 % on all 28
images**, byte-identical PNGs and JSON; the twin's own golden-vs-run on the same day is 0.00 % on all 28 too. The gate
is 1.5 % per image (`npm run qa:constellation`); anything above ~0.3 % is a real change.

### `window.__constellation` (development builds, or `?qa=1` in production)

Contract in `frontend/lib/graph/parity/dev-api.ts` (`ConstellationDevApi`); installed by the twin
(`twin-dev-api.ts`, `renderer: "twin"`) while it is mounted. The layout-side members (`ready`, `whenQuiet`,
`whenSettled`, `relayout`, `settled`) delegate to the layout owner's `LayoutControl` on `lib/graph/twin/bridge.ts`,
installed by `KnowledgeCanvas`.

| member | effect |
|---|---|
| `ready` | fonts loaded, then layout settled and unchanged for 800 ms (slow under software GL because of the reheat above) |
| `whenQuiet(ms)` / `relayout()` / `whenSettled(ms)` / `settled()` | data quiet → deterministic reseed + settle → settled snapshot |
| `getCamera()` / `setCamera({x, y, k})` / `fit(duration = 0)` / `fitTo(ids, duration = 0)` | camera; `setCamera` cancels any tween and clamps `k` to [0.18, 3.2] |
| `hover(id \| null)` | dispatches a real `pointermove` on the twin at the node's projected position (pick, focus set, tooltip, audio event); `null` clears like `pointerleave` |
| `select(id \| null)` | the store selection (`onSelect`), as a click would |
| `setLens("all" \| "mine" \| "weak")`, `toggleWeak(on)`, `toggleFiles(on)` | click the toolbar buttons (`data-lens`, `data-dock="files"`), so the page's own handlers run |
| `setRouteArriving(on, { route?, arriving?, phase? })` | QA override of the `routeIds` / `arrivingIds` props (defaults from `anchors()`), births pinned for the pop phase |
| `freezeTime(ms \| null)` | fixes the draw clock; pins arrival births and the weak pulse to it |
| `setCourse(codeOrId)` | `selectCourse` on the identity store (the store reloads; follow with `whenQuiet` + `relayout`) |
| `anchors()` / `ids()` / `screenFromWorld(x, y)` / `getLayout()` | the fixed nodes, id lists, the 2D projection, the full snapshot described above |

Production behaviour is unchanged: the override state is never set, `qaRelayout` stays 0 and the draw clock is
`performance.now()` unless `freezeTime` was called; the only markup additions are `data-lens` / `data-dock` attributes.

### Condensation and the layout Worker (T-4)

`node tools/qa/constellation/condense.mjs [--out /tmp/stage-t4]` writes stills of the twin at `condense` 0 / 0.25 / 0.5 / 0.75 / 1,
one at `enter` 0.5, and a 6 s webm driving condense 0 → 1 → 0 (`lib/graph/twin/condense.ts`: smoothstep blends, cluster labels
gone by 0.2, node labels by 0.3, edges by 0.6, dust by 0.85, stars to a one-cell core inside the course's galaxy bead radius; `?condense=`,
`?enter=`, `?anchor=x,y,r` dev params, `window.__constellation.twin.*` setters). `longtask.mjs` reads the settle path of each fresh
layout from `window.__constellationBridge.layouts.history` (`sync <ms>` / `worker (worker <ms>)` / `cache`): the d3 settle runs in
`lib/graph/worker/forceLayout.worker.ts`, positions are cached by layout hash in memory + `sessionStorage`
(`layout-cache.ts`, 2 MB cap), and the synchronous `settle` stays the fallback (SSR, tests, no Worker). `--gpu` uses the new
headless Chromium on the GPU (no window).
