# Ice edge lab: World Director review

Date: 2026-10-10. Reviewer: World Director (edge review panel, lens 1 of 2). Subject: six edge techniques in `frontend/components/world/biomes/ice-town/edge/` captured from eight fixed poses, day and night (`/tmp/edge-final`). Overview pose: all six are pixel-identical to the baseline, day and night.

| technique | edge-free | expanse | composition | coherence | best shot | worst shot | one change |
|---|---|---|---|---|---|---|---|
| none (baseline) | 1 | 1 | 1 | — | overview-day | zoom-max-day (fog soup) | — |
| endless | 4 | 5 | 2 | 3 | horizon-max-day | west-out-day (straight lead = LOD ring seam) | Drop 3–4 landmarks into the pack at 500–900 m; break the ring boundaries so no straight channel |
| parallax | 2 | 2 | 3 | 3 | horizon-max-night | north-out-day (identical to baseline) | Push scene fog to ~1.5 km so the rings show; rings lower-contrast than the authored range |
| curvature | 3 | 1 | 1 | 3 | north-out-day | east-out-day (planet horizon, blank sky) | Halve k; use only as a far-field roll under another technique |
| barriers | 2 | 2 | 5 | 2 | south-out-day (icebreaker in the gate) | horizon-max-day (berg + spire in the foreground) | Ring radius ≥ 420 m (beyond max camera distance), walls paler `#d9e4ee`/`#a9cfe8` and lower |
| sea | 2 | 4 | 3 | 4 | horizon-max-day | north-out-day (deep teal sea in the notches) | Raise the north apron into a ridge; fade pixel-pass outlines with the haze |
| cloudsea | 2 | 3 | 3 | 2 | horizon-max-day (far peaks + observatory) | zoom-max-day (straight cut in the deck) | Continuous opaque deck with smooth normals; darker at night |

## Ranking

1. **Endless shelf.** Removes the fog band from all eight horizon shots; north notches fill with further ranges; land crisp at zoom-max. Faults: nothing beyond is a place; outer tint lavender-pink against the grey-white authored peaks at the seam; pixel-pass outlines on every far facet; LOD ring boundary shows as a long straight lead (west-out, day and night).
2. **Living sea horizon.** Best horizon lift when it works; mirages too small to register; disqualifying: deep teal sea in every north notch by day.
3. **Barriers and vistas.** The only composed, legible places, one light each at night. Ring at 225–320 m sits inside the 380 m camera limit (foreground berg and spire at horizon-max; teal slab over the glacier at low-horizon); walls saturated and slab-flat; hard haze/sky seam in the north gap. Keep the vistas, lose the ring.
4. **Cloud sea.** Far peaks and sister plateau are the biggest distant places in the lab; the deck reads as berg rubble, brightest thing at night; straight deck cut at zoom-max.
5. **Painted horizon.** Six of eight shots identical to baseline (rings beyond the fog). As a sky treatment with pushed-out fog it has a role.
6. **World curvature.** Clean but reads as a small planet with an empty sky; works against expanse. Possibly a quarter-strength far-field roll under another technique.

## Recommended combination (ice)

Plate: endless (outer rings, continued back land, fog at ~1.5 km). Horizon: barriers' four vistas placed in the pack at 600–900 m with no wall ring (or two low pale headlands), with sea's haze lift at the sea/sky join. Sky: parallax's dome (gradient + shader aurora, replacing the aurora quads) and its 2100 m great range behind endless's third row. Optional life layer from sea (icebreaker, whale spouts).

## Must fix before shipping

1. sea: deep teal sea in the north notches by day (`sea-north-out-day`, `sea-zoom-max-day`).
2. barriers: ring inside camera max distance (`barriers-horizon-max-*`); haze/sky seam and cyan sea patches in the north gap (`barriers-north-out-*`); teal wall slab over the glacier (`barriers-low-horizon-day`).
3. endless: straight diagonal lead along the LOD boundary (`endless-west-out-*`); grey box berg east (`endless-east-out-day`); pixel-pass outlines and seam tint mismatch (`endless-horizon-max-day`).
4. cloudsea: straight deck cut (`cloudsea-zoom-max-day`); deck brighter than sky at night.
5. parallax: baseline notch failure untouched; depth inversion at horizon-max.
6. curvature: curved horizon under an empty sky in the outward poses.
7. Common to every column: the plate's straight east cliff cut (`*-horizon-max-day`, x≈930–1020) and the glacier shelf's straight west cut (`*-west-out-*`); the baseline aurora is a hard-edged quad in every `*-horizon-max-night`. Any winner needs aprons on the east and west cuts too.
8. Far-geometry pops must be checked in motion (endless LOD rings; barriers vistas under the fog).
