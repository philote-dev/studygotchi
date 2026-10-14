/**
 * The world-building harness as it actually stands: every principle and check we build against,
 * with where it lives and how hard it is enforced. Rendered by the review page's Harness tab.
 *
 *   test   = a vitest/Playwright check fails when the rule is broken
 *   review = a human/agent review lens with a filed note; it catches, it does not block
 *   brief  = words in a brief, sheet or charter; followed by convention only
 */
export type Enforcement = 'test' | 'review' | 'brief'

export interface HarnessRule {
  rule: string
  how: Enforcement
  /** Repo paths (relative to the repo root) or skill paths that carry the rule. */
  source: string
}

export interface HarnessSection {
  id: string
  title: string
  summary: string
  rules: readonly HarnessRule[]
}

export const HARNESS: readonly HarnessSection[] = [
  {
    id: 'world',
    title: 'World principles',
    summary: 'What a land is for and how it is composed. These are the oldest rules and the least mechanised.',
    rules: [
      { rule: 'Nothing is random: every object has exactly one parent (road, plaza, shore, cluster); placement takes a parent, never a free position.', how: 'brief', source: 'docs/design/world/00-world-bible.md §1' },
      { rule: 'One marker per idea, then empty space: one grand landmark per topic, 3–5 dense clusters, bare ground between (Kirby pedestals, Penguin Isle).', how: 'brief', source: 'docs/design/world/00-world-bible.md §1' },
      { rule: 'Built, not grown: terraces near anything man-made, roads as ribbons, plazas as flat caps; no mounds, no speckle.', how: 'brief', source: 'docs/design/world/00-world-bible.md §1' },
      { rule: 'Progress is architecture: learning adds tiers, buildings, lit windows, creatures; never palette or camera.', how: 'brief', source: 'docs/design/world/00-world-bible.md §1, biome-world-structure.md §8' },
      { rule: 'A biome is a self-contained world for one course (Odyssey kingdom): expansive, sectioned by topic, vertical, alive, with legible growth.', how: 'brief', source: 'docs/design/world/biome-world-structure.md §1' },
      { rule: 'Elevation is the main compositional axis: regions stack from sea level to a summit; the landmark sits at the top or the heart, never in a flat field.', how: 'brief', source: 'docs/design/world/biome-world-structure.md §1' },
      { rule: 'Every building touches a road; ≥ 3 empty regions wider than 4 m; no two identical props within 1 m at the same scale (screenshot acceptance).', how: 'review', source: 'docs/design/world/00-world-bible.md §7, 01-layout-grammar.md Acceptance' },
      { rule: 'Same seed and inputs give byte-identical placement.', how: 'test', source: 'every lab and land: *.test.ts determinism rows' },
    ],
  },
  {
    id: 'look',
    title: 'Aesthetic contract (toybox low-poly)',
    summary: 'The look every artisan builds to. Enforced partly by code, mostly by review.',
    rules: [
      { rule: 'Chunky faceted low-poly geometry (facets are a feature), one exaggerated identifying feature per object, 2–3 flat colours plus one accent, no outlines in 3D, soft 3-step toon shading, readable at 48 px.', how: 'review', source: '.fleet/org.md Aesthetic contract' },
      { rule: 'One shared toon material cache (`Surf`, `Glow`); every mesh takes a colour, never its own material.', how: 'test', source: 'prototypes/marker-lab/src/render/materials.test.ts; vision-lab src/render/materials.tsx' },
      { rule: 'Night is the one palette exception: only window/lamp materials go emissive (`Glow on={night}`).', how: 'brief', source: '.fleet/org.md; 00-world-bible.md §6' },
      { rule: 'Globe markers: one 12-facet plinth, four slots (hero, front-left, back-right, front-right), outward lean 0.14–0.22, crowns overhang; per-biome Props and Rim, no generic props.', how: 'test', source: 'prototypes/marker-lab/src/scene/biomes/biomes.test.ts, bouquetGeometry.ts' },
      { rule: 'Roster colours stay distinguishable: plinth side vs lip ΔE and cross-biome collision pairs.', how: 'test', source: 'prototypes/marker-lab/src/markers.test.ts' },
      { rule: 'GLB outputs: +Y up, +Z front, feet on y = 0, flat baseColorFactor, triangle budgets (creature < 1500, landmark stages < 400/900/1600, prop < 300).', how: 'test', source: '.fleet/org.md Technical contract; tools/qa/check_glb.py' },
      { rule: 'Pixel look is RenderPixelatedPass with a resolution-independent pixel size; shadows updated once per frame, not per pass.', how: 'brief', source: '.cursor/rules/creative-tooling.mdc; vision-lab src/render/PixelComposer.tsx' },
    ],
  },
  {
    id: 'refs',
    title: 'Reference discipline',
    summary: 'Where each land\u2019s identity comes from. This is the layer the ice and jungle rounds skipped, and it is now the first step of every brief.',
    rules: [
      { rule: 'Each land has a biome sheet: Mood, reference synthesis (take / leave per image), palette, fixed land and water, routes, districts with 48 px anchors, landmark stages.', how: 'brief', source: 'docs/design/world/biomes/<land>.md' },
      { rule: 'Each land has a reference ledger: provenance, licence, one "take" clause and one "leave" clause per image, written before analysis.', how: 'brief', source: 'docs/design/world/refs/biome-library/<land>/LEDGER.md; docs/design/world/refs/*' },
      { rule: 'Briefs start from the land\u2019s references and attach the images to the artist; named examples map to lands (Minas Tirith = medieval, Ilios = coastal, "ice, next level" = the existing ice identity at scale).', how: 'review', source: 'producer rule (agent notes, 2026-10-10)' },
      { rule: 'Off-reference work goes back to the artist before Philote sees a comparison sheet.', how: 'review', source: 'producer rule (agent notes, 2026-10-10)' },
    ],
  },
  {
    id: 'composition',
    title: 'Composition harness (vision lab)',
    summary: 'What a blockout must satisfy before it can appear on a comparison sheet.',
    rules: [
      { rule: 'Three directions a / b / c per land with distinct names and different dynamics (vertical, water-led, sprawling).', how: 'test', source: 'prototypes/vision-lab/src/lands/vision.test.ts' },
      { rule: 'Review notes per direction: lineage ≥ 16 chars, pitch ≥ 120 chars, ≥ 3 strengths, ≥ 2 risks.', how: 'test', source: 'prototypes/vision-lab/src/lands/vision.test.ts' },
      { rule: 'Four cinematic poses (hero, walk, overview, reverse) with sane distances; the walk camera is below 14 m (character eye height).', how: 'test', source: 'prototypes/vision-lab/src/lands/vision.test.ts' },
      { rule: 'The land file is a real blockout, not the shared stub.', how: 'test', source: 'prototypes/vision-lab/src/lands/vision.test.ts' },
      { rule: 'Every scene ≤ 80k triangles, deterministic per seed, instances inside the land and above the water table, real relief / water / roads / districts.', how: 'test', source: 'vision-lab src/lands/{ice-town/blockouts,medieval-meadow-kingdom/medieval,coastal-ruins/budget}.test.ts (the other three lands count by script only)' },
      { rule: 'All of the land\u2019s districts and its landmark site are housed in every direction (course topics map onto districts).', how: 'brief', source: 'vision briefs; docs/design/world/biomes/<land>.md districts table' },
      { rule: 'One slow `useFrame` per scene; shared geometries and cached materials survive unmounts.', how: 'brief', source: 'vision briefs; ~/.agents/skills/r3f-fundamentals/SKILL.md' },
    ],
  },
  {
    id: 'terrain',
    title: 'Terrain, world edge and expanse (product lands)',
    summary: 'The rules from the edge lab that every land now ships with: an endless outer world plus natural barriers with vista windows.',
    rules: [
      { rule: 'The overview pose is pixel-identical with and without the outer world: nothing in the authored frame changes (diff at the animation noise floor).', how: 'test', source: 'frontend/components/world/biomes/ice-town/edge/endless/back-of-range.test.ts; capture diffs per land' },
      { rule: 'Seam continuity: the outer heightfield meets the plate within 1.5 m (ice) / exactly at y = 0 (meadow) on all four edges.', how: 'test', source: '<land>/edge/*/outer-mesh.test.ts, back-of-range.test.ts' },
      { rule: 'LOD rings are watertight and T-junction free; ring boundaries snap; lattice jittered so no straight leads run to the horizon.', how: 'test', source: '<land>/edge/*/outer-mesh.test.ts' },
      { rule: 'No cliff teeth or sea behind a mountain range; back slopes ≥ 97 % under 35°, none over 45°; coasts ramp only where the overview cannot see them (exact frustum test).', how: 'test', source: 'ice-town/edge/endless/back-of-range.test.ts' },
      { rule: 'Barriers stand in the shelf, seated on the terrain, ≥ 40 m off every coast, never inside the reachable camera range; vista windows on the outward rays frame one landmark each with a clear sightline.', how: 'test', source: '<land>/edge/barriers/geography.test.ts, build.test.ts; ice-town/edge/combined.test.ts' },
      { rule: 'Clouds never cross a 12° eye line from any lab pose; outward frames have no district under the camera.', how: 'test', source: 'medieval-meadow-kingdom/layout/terrain (cloudPlacements) tests' },
      { rule: 'Fog near stays at the authored value; only fog far moves; storm/event fog is untouched.', how: 'test', source: 'ice-town/edge/endless (endlessFog) tests' },
      { rule: 'Free camera: full orbit, pitch 12–64°, 40–380/470 m, look box = land, camera box ±460 m; shipped stations unchanged.', how: 'test', source: 'frontend/components/world/biomes/camera-contract.test.ts; <land>/camera/stations.test.ts' },
      { rule: 'Terrain relief rule for backdrops: no single flat facet over ~12 m of rise, contours curve, risers read as a darker stripe, crests are soft (coastal: facet rise tested < 6.5 m).', how: 'test', source: 'coastal-ruins/layout/escarpment.test.ts' },
      { rule: 'Seeded relief: fBm with per-octave offsets and redistribution (flat valleys, sharp peaks), terrace quantisation, rejection or jittered-grid scatter, rng threaded through every choice.', how: 'brief', source: '~/.agents/skills/procedural-gen/SKILL.md (+ references/noise.md)' },
    ],
  },
  {
    id: 'budget',
    title: 'Performance budgets',
    summary: 'The pixel pass draws every triangle twice (beauty + normals), so budgets are tight and measured from built geometry.',
    rules: [
      { rule: 'Outer world ≤ 120k triangles per land (ice 71k, coastal 79k, medieval 95k after the tree LOD pass).', how: 'test', source: '<land>/edge/outer/budget.test.ts; reports' },
      { rule: 'No synchronous build step over 60 ms on land open; world builds are chunked one ring/step per frame with readiness waiting for the last step.', how: 'test', source: 'medieval edge/outer/build.ts + budget.test.ts; ice buildOuterWorldSteps test; coastal ring steps' },
      { rule: 'Blockouts ≤ 80k triangles; instanced where repeated; 3-level tree LOD (full / lollipop / cross) beyond 120 m and 400 m.', how: 'test', source: 'vision-lab budget tests; medieval outer trees' },
      { rule: 'One `useFrame` per scene, no per-frame allocations, reduced motion respected.', how: 'review', source: '.fleet/reviews/2026-10-10-ice-edge-lab-technical.md' },
    ],
  },
  {
    id: 'collision',
    title: 'Collision and residents',
    summary: 'Structures are real entities: a deterministic 2.5D XZ collider world that walkers cannot phase through.',
    rules: [
      { rule: 'Colliders (circles, oriented boxes) in a spatial hash; `resolveCircle`, `sweepCircle` (substepped, no tunnelling), `steerAround` (whiskers with hysteresis), `separateCircles`; hash answers match brute force on 500 colliders / 2000 queries.', how: 'test', source: 'frontend/components/world/biomes/collision/colliders.test.ts' },
      { rule: 'Footprints derive from placement data (buildings, props, trees, landmark stages, terrain features), unique ids, full coverage at 100 % progress.', how: 'test', source: '<land>/collision/footprints.test.ts' },
      { rule: 'Walker simulations (60 s / 1500 frames) end with zero penetration and no two agents overlapping.', how: 'test', source: '<land>/scene/walkers.test.ts, collision/walkers.test.ts' },
      { rule: 'Residents steer, sweep and separate on the shared API; debug overlay `?colliders=1`.', how: 'brief', source: 'frontend/components/world/biomes/collision/ColliderRegistry.tsx, ColliderDebug.tsx' },
    ],
  },
  {
    id: 'capture',
    title: 'Capture and review loop',
    summary: 'How work is looked at before it is called done.',
    rules: [
      { rule: 'Fixed poses from identical cameras for every variant: edge lab 8 poses × day/night × technique; vision lab 4 poses × day/night × direction; contact sheets composed per land.', how: 'test', source: 'tools/edge-lab/capture.mjs; prototypes/vision-lab/scripts/capture.mjs' },
      { rule: 'Readiness flags (`data-edge-ready`, `data-vision-ready`) gate every screenshot; captures clip the full stage so no frame is cropped.', how: 'test', source: 'CameraRig.tsx, App.tsx PoseCamera, publish-shots.mjs aspect check' },
      { rule: 'Artists iterate ≥ 3 rounds against their own captures before reporting, with the question "would Philote say this is his world, bigger?".', how: 'review', source: 'vision briefs; artist reports' },
      { rule: 'Review panel lenses: world director (composition, expanse, cracks), technical (budget, allocations, stalls), art director (identity, palette), acceptance (48 px), code/perf; notes filed with concrete parameter changes.', how: 'review', source: '.fleet/reviews/2026-10-10-*.md; .fleet/org.md Loop' },
      { rule: 'Catastrophes and feedback use layered, proportional juice: trauma-based shake, hit-stop, squash-and-stretch with overshoot, never linear tweens.', how: 'brief', source: '~/.agents/skills/game-feel/SKILL.md; biome-world-structure.md §8.4' },
    ],
  },
  {
    id: 'gaps',
    title: 'Not enforced yet (proposed harness rows)',
    summary: 'Honest gaps. Each of these let something through this week; each has a mechanical check we can add.',
    rules: [
      { rule: 'Reference conformance: a direction must cite ≥ 2 ledger rows of its land by file name, and a reviewer confirms the borrowed motifs are visible in the hero frame.', how: 'brief', source: 'proposed: vision.test.ts row + review checklist' },
      { rule: 'Walk-pose clearance: ray from camera to target unobstructed, camera not inside any mesh, ≥ 2 m clear in front (frontier, coastal C, ice C and nordic A all failed this by eye).', how: 'brief', source: 'proposed: Playwright depth probe or scene raycast test' },
      { rule: 'Overview occupancy: from the overview pose, settlement pixels ≥ N % and canopy must not hide the decks (jungle).', how: 'brief', source: 'proposed: capture-time colour-bucket count' },
      { rule: 'Palette conformance: hero-frame histogram within the sheet palette ± tolerance; one accent dominant.', how: 'brief', source: 'proposed: capture-time histogram vs docs/design/world/biomes/<land>.md palette' },
      { rule: '48 px legibility: thumbnails of the three directions must differ (ΔE between downsampled hero frames) and the land must be identifiable from its thumbnail alone.', how: 'brief', source: 'proposed: marker-lab style thumbnail diff' },
      { rule: 'Silhouette memorability is still a human call; the harness can only make sure the human sees the right frames.', how: 'review', source: 'this page' },
    ],
  },
]
