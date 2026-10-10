# Globe markers: code and performance review

Date: 2026-10-10. Reviewer: Code & Performance (review panel lens 3 of 3). Scope: the 17 bouquet files in `prototypes/marker-lab/src/scene/biomes/`, the shared lab files, the sheet renderer and the planet belt. Harness: `npx vitest run` 100 tests green, `oxlint src` clean, `tsc -b` clean.

Method: a Vite-SSR census renders every family's `Props` and `BouquetBase` with the fiber mocked and instantiates every geometry with three for exact mesh/triangle counts; a Playwright probe wraps `WebGL2RenderingContext.draw*` and samples rAF for 5 s (headless SwiftShader, compare relatively).

## 1. Per-family census (props = 4)

| family | meshes props / +base | tris props / +base | GL draws · tris per frame (512 px) | useFrame alloc-free? | notes |
|---|---|---|---|---|---|
| ice-town (ref) | 65 / 88 | 1140 / 2880 | 336 · 11.1k | 1, clean | 1 `meshBasicMaterial` light cone (allowed) |
| ink-world | 45 / 76 | 1010 / 2618 | 258 · 8.6k | none | 18-flap deckle rim |
| celestial-garden | 36 / 60 | 2140 / **3352** | 224 · 12.3k | 1, clean | three 8×24 / 6×24 tori; local `Bloom` wrapper |
| heavy-industry | 42 / 75 | 1100 / 2540 | 286 · 9.7k | 1, clean | |
| future-utopia | 37 / 46 | 2053 / **3061** | 162 · 10.6k | 1, clean | local `CyanLight`; `Rim(_props)` ignores lip colour |
| harbor-town | 50 / 71 | 1256 / 2936 | 270 · 11.4k | 1, clean | `Gable` duplicated from academy-town |
| academy-town | 44 / 66 | 766 / 2110 | 236 · 8.0k | 1, clean | |
| wildwest | 45 / 59 | 944 / 2156 | 228 · 8.4k | 1, clean | |
| volcanic | 41 / 64 | 1328 / 2540 | 228 · 9.7k | 1, clean | local `Lava` wrapper |
| egyptian-desert | 45 / 59 | 628 / 1840 | 210 · 6.9k | none | cheapest family |
| alpine | 46 / 81 | 840 / 2484 | 310 · 9.7k | 1, clean | heaviest rim (24 meshes) |
| swamp | 51 / 82 | 1148 / 2700 | 304 · 10.1k | 1, clean | local `Accent`; `export function Rim` |
| jungle | 48 / 83 | 1164 / 2960 | 314 · 11.4k | 1, clean | `RimFruit` emissive on the rim; local `Accent` |
| forest | 31 / 60 | 1106 / 2510 | 226 · 9.7k | none | |
| city | 50 / 83 | 756 / 2052 | 282 · 7.4k | 1, clean | 24-box cobble rim |
| whimsical-land | 44 / 67 | 1260 / 2812 | 262 · 11.1k | 1, clean | rim string still says "placeholder" |
| fractal-recursion | 59 / 79 | 1636 / **3388** | 294 · 13.0k | none | 11 spheres 7×5 + 6 tori |

Totals: 779 prop meshes (1199 with bases), 20.3k prop tris (44.9k with bases). No `Math.random`; no circular imports; hooks correct; no direct standard/basic materials in biome files; all spec strings filled.

## 2. Frame cost (SwiftShader, 1440×1000)

| scene | frame ms mean / p50 / p95 | draws / frame | tris / frame |
|---|---|---|---|
| review, ice-town | 26.5 / 33.3 / 33.4 | 336 per canvas | 11.1k |
| planet, 17 bouquets | **90.2 / 83.3 / 100.1** | 4500 | 175k |
| planet, props = 2 | 66.0 / 66.7 / 83.3 | 3070 | 138k |
| sheet | `data-sheet-render-ms` 5259 for 17 | | |

Why 336 draws for 88 meshes: `RenderPixelatedPass` renders twice (beauty + normal) and the shadow map re-renders in both. Every `<Surf>` instantiates its own `MeshToonMaterial` (1199 materials on the planet) so nothing batches.

## 3. `Glow offColor`

`Glow({ color, on, intensity, offColor })` now exists in both trees. Switch and delete the local wrappers: `volcanic.tsx` `Lava`, `future-utopia.tsx` `CyanLight`, `jungle.tsx` and `swamp.tsx` `Accent`, `celestial-garden.tsx` `Bloom`.

## 4. Port checklist (frontend `components/world/globe/bouquet/`)

1. Copy the lab `bouquetGeometry.ts` (slot ids, `placementFor`) and `IceProps.tsx` over the frontend copies.
2. Replace frontend `BouquetBase.tsx` and `WorldProps.tsx` with the lab versions; do not port `GenericProps.tsx`.
3. Copy `biomes/*.tsx`, `index.ts`, `types.ts` into `bouquet/biomes/` with `../materials`, `../bouquetGeometry`, `../markers`, `../bouquet-state`, `../iceBouquet`, `../IceProps` paths; add `"use client"`.
4. `markers.ts` must be re-synced (lab roster was re-tinted after this review).
5. `castShadow` flags are inert in production (no `shadows` on the canvas).

## 5. Prioritised fixes

1. Shared: cache materials by (color, emissive, intensity, transparent, opacity, side) in `materials.tsx`; memoise geometries; in the port, merge static bouquet geometry into 1–3 draws.
2. Lab `PixelComposer.tsx`: `shadowMap.autoUpdate = false` + `needsUpdate = true` once per frame.
3. Switch the five local emissive wrappers to `Glow offColor`.
4. Trim the three > 3000-tri families: celestial tori 8×24 → 6×16; fractal spheres 7×5 → 5×4 and tori 6×12 → 4×10; utopia hover-lamp tori 5×14 → 4×10.
5. Roster discipline: window emissives on warehouse-row, saloon, chalet, mushroom-cottage, upside-down-house are now declared in `markers.ts`; jungle `RimFruit` and fractal lips must not emit.
6. Copy: whimsical rim string; utopia `Rim` drops the lip colour.
7. Hygiene: dedupe `Gable`; drop `export` from `Rim` in jungle/swamp; `MarkerSheet` hoists the composer above the keyed child; ref write during render in `MarkerSheet.tsx`.
