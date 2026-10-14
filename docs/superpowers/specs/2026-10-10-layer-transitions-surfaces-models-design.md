# Layer transitions, surfaces and models

Date: 2026-10-10
Revised: 2026-10-11 (the model changed after Philote's review of the labs; the plan was re-cut into five product slices plus a constellation-twin lane)
Status: design accepted; the canvases and the lab hold the beat tables, recipes and measurements; this note pins the decisions the plan builds on.

## Where the design lives

| Topic | Source | What to read it for |
|---|---|---|
| Stage v2 spring, altitude axis, fades, composer, prewarm, perf statistics (measured: 0 flips, 0 compiles, vsync-locked) | `frontend/components/lab/space/stage2/**`, `/lab/space` | The product director and composer are these files moved, not rewritten |
| Hop choreography constants (`GALACTIC`, `CHAINED`, `MERGED`), ladder curves, gate | `frontend/components/lab/space/stage/director.ts`, `ladder.ts` | Pull-back and merged-rise timings; supersede the 2026-10-10 beat tables |
| Galaxy recipe, kinematics, light module, outer-zone layout, gravity objects, object gallery | `frontend/components/lab/cosmos/**`, `/lab/cosmos/*` | Top rung, backdrop galaxy, scenery objects, lens pass |
| Beat sheets, surfaces recipe, models pipeline, performance budget (2026-10-10) | `~/.cursor/projects/Users-philote-projects-local-StudyGotchi/canvases/layer-transitions-and-surfaces-plan.canvas.tsx` | W2 and W3 still argue from the `recipe` and `budgets` tables; the beat sheets are historical |
| Galaxy five-cloud recipe, black-hole parts and LensPass GLSL | `canvases/galaxy-and-black-hole-references.canvas.tsx` | Palette and structure notes; the lab implements them |
| Integration map (revised 2026-10-11) | `canvases/integration-map.canvas.tsx` | Navigation, stage layers, rollout, file map in one view |
| Tooling | `canvases/creative-tooling-scout-2026-10.canvas.tsx` | Tripo rig `v2.5-20260210`, Meshy 7.1, Poly Pizza, `mcp-for-blender`, img2threejs (r3f-vfx / quarks rejected) |
| Palettes for space | `docs/design/world/refs/space/LEDGER.md` | Swatches and the credit lines that travel with reuse |
| Camera stations and the dive | `docs/design/world/biome-world-structure.md` §6, `ice-town/camera/stations.ts` | `divePose`, `poseFor`, FOV 26, lab contract |
| Day / night, toon ramp, fog | `docs/design/world/00-world-bible.md` §1, §6 | The light table W2 follows |
| The 2D constellation's rules | `frontend/components/graph/KnowledgeCanvas.tsx`, `lib/constellationLabels.ts`, `lib/graphTheme.ts`, `lib/weak-sequences.ts`, `lib/forceLayout.ts` | The twin ports these; they are the parity target |

## What this project changes

Today a stage hop tears one WebGL context down and builds another behind a CSS zoom; the constellation settles 420 d3 ticks on mount; the sky is a 2D star canvas with a spinning 64 px spiral in the corner; the cargo ship is a box with a wedge.

After this project:

1. One persistent `StageCanvas` in `ProductShell`. The lab's space (parallax star field, far galaxy, dark and light) is the backdrop at every rung. A spring on an altitude `L` moves the camera between planet (1), constellation (2) and galaxy (3), with the world (0) under its clouds. Visibility is an altitude ramp, never a mount. The header keeps its two pills; Information climbs the ladder for the active course, Courses returns to the planet.
2. The constellation stays the real graph and migrates its renderer into the stage as a WebGL twin (full-resolution overlay pass, DOM labels), pixel-diffed against the 2D canvas state by state, so it can condense continuously into its bead during the pull-back. The 2D canvas remains the flagged and reduced-motion fallback until sign-off; d3 moves to a Worker.
3. The polished galaxy holds every course on its arms from the layout generator; clicking a cluster drops into that course's constellation. Scenery objects live on every rung, seeded per student, meaning nothing yet.
4. Surfaces read as materials at 2 px (tinted ramp, dithered fog, quantised triplanar, depth-fade water, bevel + AO, globe shallows and terminator). Models flow source → Blender → `gltf-transform optimize` → QA → `useGLTF`; the container ship is a lofted hull; buddies walk.

## Decisions (Philote, 2026-10-10)

- One persistent `StageCanvas` with visibility-gated layers. Plan B (two stacked canvases) rejected.
- Constellation: Canvas2D now, sky objects to 3D. (Partly superseded 2026-10-11: the renderer migrates as a twin; the 2D canvas stays as the fallback.)
- VFX hand-rolled `InstancedMesh` / `Points` only; no `r3f-vfx`, no `three.quarks`.
- Generator credits: no new spend. "Just spend what I have, if I don't have it then hand build it." Balance check, fail closed, `--confirm`, hand-built fallbacks.
- Meshopt: yes; `optimized/` served copies, source GLBs plain.
- Preview gate: "do what you think but always remember to let me see things first before you mess with our app." Flags default OFF; captures before any flip.

## Decisions (Philote, 2026-10-11)

**Navigation.**
- The two header pills stay: Courses and Information. No altitude ladder in the header; the `/lab/shell` LadderNav prototype is rejected for the product (its indicator math may be reused internally only).
- Information is a ladder keyed to the active course: on the planet (settled on a class, which it auto-locks to) → that class's constellation; in a constellation → the galaxy; in the galaxy → does nothing.
- In the galaxy, clicking any course's cluster drops into that course's constellation. Cycling between courses at galaxy level (like the planet's settle) is deferred until after the migration.
- Courses: from a constellation → the planet locked on that landmark; from the galaxy → the planet on the most recent or default course.
- From inside a world, Information rises through the clouds, past the planet and up into the constellation as one motion (the lab's merged hop); per-world masks replace the cloud layer later.

**Visuals.**
- Planet → constellation is the lab pull-back (Stage v2 spring / altitude / streaks), the planet shrinking to a centred point rather than becoming a star object; exact end state settled in the lab.
- The constellation stays the real one: same data, d3 layout, clustering, colours, label rules, weak-area sequences, files and click behaviours; only the rendering migrates from Canvas2D to WebGL inside the persistent stage ("WebGL twin" first, finishing into a full port with d3 in a Worker) so the graph can condense continuously into its bead.
- Parity gate: capture the current 2D constellation in every state (zoomed out with cluster names, zoomed in, hover, selected node, weak areas on, files, light and dark) and pixel-diff the twin against them; the graph renders full-resolution in its own pass composited over the pixelated stage (never pixelated); DOM text for labels; the 2D canvas stays as fallback behind a flag and under reduced motion until Philote signs off.
- The lab's `Cluster2` / `cluster-spec` are discarded (only the sprite shader may be reused for node glyphs).
- Galaxy-level clusters: build both "every course as its real tiny graph" and "real graph for the current course, beads for the rest" and A/B them in the lab.
- The corner spiral (`GeneratedPixelSpiral` / `SkySpiral`) is temporary and goes away; the new space (lab star field + far galaxy + parallax depths, dark and light) is the backdrop at every rung; the full polished galaxy (`cosmos/galaxy` + light module + layout generator with real courses) is the top.
- Space objects live on every rung (planet: moons, station, passing comet; constellation: nebula, black hole and so on; galaxy: scenery between clusters), seeded per student so no two students share a sky; scenery first, meanings later; one seeded placement generator per rung.

**Process.**
- Five product slices, each behind a flag defaulting OFF with a captured preview before it flips: S1 new space backdrop replacing the corner spiral on `/earth` and `/knowledge` (no motion change yet), the first layer of the persistent `StageCanvas` in `ProductShell`; S2 planet → constellation pull-back with the WebGL constellation twin; S3 constellation → galaxy with real courses on the arms (plus the A/B); S4 world → constellation merged rise; S5 cleanup (demo keybinds 1/2/3/F/P and demo-only paths, CSS hop keyframes except under reduced motion, `GeneratedPixelSpiral` / `SkySpiral`).
- Hardware bar: Philote's laptop, vsync-locked; no mobile requirement now. Nothing in the galaxy objects carries meaning yet.

## Design decisions carried from the labs and canvases

- Pixel grain stays 2 px at rest for the stage layers; integer multiples only during motion; the constellation overlay pass is excluded from pixelation.
- Prewarm at mount (every layer's materials compiled, one offscreen render each); nothing compiles after a request. A hop passes when the lab's perf statistics report 0 dropped frames.
- Audio leads the picture: the swell starts with the request, the streak bed follows `|v|`, the bed cross-fade lands at rest.
- `prefers-reduced-motion`: no camera travel, 100 ms dissolve, the 2D constellation, CSS keyframes kept.
- Source GLBs stay extension-free; served copies are meshopt-compressed into `optimized/` and gated with `--allow-ext EXT_meshopt_compression`.
- Keys live in env only; no script spends credits without a balance check and `--confirm`.

## Non-goals

- R3F 10, drei 11, WebGPU, TSL.
- Redesigning biome layouts, districts or growth rules.
- A different constellation (new layout, new clustering, new colours). Only the renderer changes.
- Meanings on space objects; course cycling at galaxy level; mobile performance.
- A ladder, indicator or rung sublabels in the header.

## Acceptance criteria

1. With every flag off, every route renders and behaves as it does today; `npm test`, `npm run typecheck`, `npm run build` pass.
2. **S1.** With `stage-backdrop`, `/earth` and `/knowledge` show the lab backdrop (parallax stars, far galaxy) in both themes with no corner spiral and no 2D star canvas; planet-rung scenery differs between two student seeds; the 2D constellation's edges still read over it; rest-state perf shows 0 dropped frames.
   Preview gate: `/lab/space?pane=backdrop`, both routes with and without the flag, the backdrop capture sheet (routes × themes × two seeds), rest perf.
3. **T.** With `stage-twin`, the real graph renders in WebGL through the overlay pass with DOM labels, and every state in the parity set (zoomed out with cluster names, zoomed in, hover, selected, weak areas, files, route; light and dark) diffs under the agreed threshold against the committed 2D captures; every click behaviour and every `emit` matches the 2D canvas; reduced motion and flag off still render the 2D canvas.
   Preview gate: `tools/qa/out/constellation-parity/report.html` and a recording of hover / select / weak / files on the twin.
4. **S2.** With `stage-pullback`, Information from the planet pulls back on the lab spring: the planet shrinks to a centred point, the constellation expands from its bead, the camera rests on the constellation rung with 0 dropped frames and 0 compiles; Courses returns to the planet locked on the same landmark; URLs mirror the rung at rest.
   Preview gate: `/lab/space?study=point` end-state study, the pull-back frame sheet, both-direction recordings, perf.
5. **S3.** With `stage-galaxy`, Information from a constellation rises to the polished galaxy with the student's real courses on the arms; Information at the top does nothing; clicking a cluster drops into that course's constellation; Courses from the galaxy returns to the planet on the most recent or default course; the A/B of cluster rendering is decided on the lab's side-by-side.
   Preview gate: `/lab/space?ab=graphs|beads` with real courses, the galaxy scenery sheet (two seeds, both themes), a round-trip recording.
6. **S4.** With `stage-merged`, Information from inside the biome rises through the clouds, past the planet, into the constellation as one motion; Courses from the world rises to the planet; 0 dropped frames.
   Preview gate: the merged frame sheet, a harbour-station recording, perf.
7. **S5.** No demo keybinds or demo-only paths remain; CSS hop keyframes exist only under reduced motion; `GeneratedPixelSpiral` / `SkySpiral` and the rejected lab pieces are deleted; shipped flags removed after their sign-offs.
   Preview gate: a full run-through recording with the flags gone and green `test` / `typecheck` / `build`.
8. **Surfaces.** The capture sheet at 2 px shows the tinted shade step, dithered fog bands, a one-to-two-cell foam ring, texel-stable ground under a 10 s pan, bevel highlights, a shallows band and a dithered terminator; draw calls under 300 per layer at rest.
   Preview gate: `/design/stage?layer=world|planet`, the surfaces sheets, budget JSON, pan recording.
9. **Models.** The container ship reads as a ship at 20 px and 240 px; every served GLB passes `tools/qa/check_glb.py` with its kind; at least one buddy walks via `useAnimations` with a 0.8 s `walk` clip (Tripo if the balance covers it, else hand-built).
   Preview gate: `/design/ships`, Blender look sheets, `assets/QA.md`, a walking recording.
10. No flag defaults ON and no product file changes default behaviour until the matching preview gate has been shown to Philote and the sign-off date recorded in the plan's Rollout table.
