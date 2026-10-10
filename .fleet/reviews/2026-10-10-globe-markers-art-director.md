# Globe marker review: Art Director pass

Date: 2026-10-10. Reviewer: Art Director (review panel lens 1 of 3). Subject: the 17 landscape-bouquet markers in `prototypes/marker-lab/src/scene/biomes/`, captures of 2026-10-10 16:50 in `/tmp/marker-shots` (512/96/48 px, day + night, three sheets). Scores 1–5. "Change" lines are parameters for the builders to apply verbatim; "redo" means re-compose the bouquet, not retune it.

| marker | identity | grammar | craft | verdict | changes |
|---|---|---|---|---|---|
| ice-town | 5 | 4 | 5 | keep (reference) | Hero is wrong: the house pair reads as P1, the mountain is a thin pale spike behind it. Mountain `spread` 13.2→17, `capHeightRatio` 0.48→0.62, back peak +4 m; houses scale 0.9 and move +2 m toward front-right; darken plinth side `#8fbfdc`→`#7fb0d0` so the "blue cliff" of the roster phrase actually shows (today the plinth is white-on-white). |
| ink-world | 4 | 3 | 3 | change | Peak is excellent. Pavilion is a white box with a scribbled Z: replace with 4 ink posts + 2 clean ink roof lines, 0.5 m thick. Lantern is a blank white drum (reads as a paper roll): halve diameter to 3 m, add 3 ink hoops + a dark cap. Stamp 2×2→3×3 m, centre it on facet 0. Night is dead (nothing emits): lantern paper `#ffe9a8`×0.6, the only glow. |
| celestial-garden | 5 | 4 | 4 | keep | Ring + gold star over indigo reads at 48. Gazebo currently carries the moon-pond on top and reads as a water tower: drop pond to terrain level at front-right, 4 m wide × 1.2 m. Night: bloom is flat cream, not a point; bloom emissive ×1.6, gazebo light-lines thin to 0.3 m and ×0.8 so the star wins. Ring shouldn't brighten at night; check it is not picking up emissive. |
| heavy-industry | 4 | 3 | 3 | change | Two accents: the `#4f8fb0` pipe run is as big and saturated as the cab. Pipe → `#6b5f7a` steel with one `#4f8fb0` valve wheel, or scale 0.6. Cab is a thin yellow frame; make it a solid `#e8a13a` box 6×5×5 m with one dark window. Plinth is a flat grey slab with an invisible rim: height 2.4→3.2 m, rim band 0.9 m, chevrons 1.5 m long. Smoke puff ×1.5. |
| future-utopia | 2 | 3 | 2 | **redo** | White-on-mint: at 96 px it is a faint ring, at 48 px nothing. The standing transit loop is the read, not the needle → ring collision with celestial-garden. Loop → flat horizontal oval (monorail), scale 0.6, below spire mid-height. Spire base 6→9 m, bands 1.2 m thick and `#3fd1c9` by day too. Glass side `#c7dfd6`→`#a9cfc4`, tile `#e3f2ec`→`#d4e8df`. Garden dome canopy 12 m so there is one solid colour mass. Keep rim strip emissive (roster allows) but it is the only rim exception besides volcanic. |
| harbor-town | 4 | 3 | 4 | change | Hull is hidden behind the warehouse row, so the mast reads as a flagpole with banners. Warehouse row 28→20 m, shift +3 m right-front; mast +4 m; show prow at front-left. Sail: one marigold stripe, not two (one accent object: buoy keeps `#f0b429`). Jib and buoy are good. Night OK. |
| academy-town | 5 | 4 | 4 | keep | Brick renders salmon; darken one step. Library pediment (28 m) rivals the tower: library 28→22 m. Tower 32→35 m so the cupola clears the row. Oak +2 m outward front-right so the lawn top shows a band. Night: six dorm windows fine. Closest to Ice fidelity. |
| wildwest | 5 | 4 | 4 | keep | Butte + cactus reads unmistakably at 48. Perched boulder is orange and reads as fruit: `#a0522d`, scale 0.5. Saloon sign is an off-palette navy block: `#c2925a` plank. Saguaro: +1 arm. Nothing else. |
| volcanic | 4 | 4 | 3 | change | Cone is a near-cylinder with an orange lid: reads as a flower pot / tiki mug. Base radius ×1.5, top radius ×0.6, keep torus. Smoke puff scale 0.6; at night it is a pale blob that reads as a second glow — tint `#3a2f45` shade at night. Forge house is buried: +2 m outward back-right, door glow ×1.6. Columns and ember cracks are right. |
| egyptian-desert | 3 | 3 | 3 | change (borderline redo) | "Fat four-step pyramid" is tall and narrow: reads as pagoda/ziggurat tower. Base width = 1.4× height (≈24 m at 17 m tall) or drop to 26 m tall; four risers each 25 %. Pylon gate stands in front hiding the base: rotate 90°, move to front-right slot, scale 0.75. Bring pool to front-left so the teal accent reads. Night dead; acceptable per roster, but a pool shimmer `#4fb0b8`×0.5 would help. |
| alpine | 3 | 4 | 3 | change | Peaks render near-white → snow cones → ice-town collision at 48. Granite `#8d9299` must read as `#6f757d` on the lit face; snow caps top 20 % only. The roster's diagonal cable (the family's signature) is not visible: draw it 0.4 m thick pylon-head → peak shoulder. Gondola +20 %. Chalet and firs fine. |
| swamp | 4 | 4 | 4 | keep | Lantern is the best accent object on the sheet. Cypress crown is a flat pancake → shape collision with jungle's umbrella: three stacked crown tiers 0.8/0.6/0.4 width, +2 moss curtains. Lilies are a second saturated accent: scale 0.5, `#d66fa8`→`#b58aa8`. |
| jungle | 3 | 4 | 3 | change | One green: canopy, palm, cliff, plinth and vines are the same value, so the waterfall is the only read. Canopy `#4f8a4a` and dome it (height 0.5× width, 2 lobes), plinth top `#6fae6a`, cliff `#4f8a4a`, fronds `#6fae6a`. Ruin stack `#c7b8a0`. Night violation: rim fruit dots glow — only the torch flame emits; torch ×1.3. Palm 28→24 m so it stays secondary (W4 drift). |
| forest | 5 | 4 | 4 | keep | One big ball over a green disc: works at 48. Fern reads as agave: scale 0.6. Log bigger than the tree pair: log 0.75, tree pair +15 %. Cottage door/window hidden behind the fern — expose them (they are the anti-W1 evidence). Night: cottage window ×1.6. |
| city | 4 | 4 | 3 | keep | Pastel but legible; clock face reads. Tower block merges into clock tower: clock tower +2 m outward left. Roof plates `#b98bb0`→`#a57aa0`. Night: twelve lit facets blob at 48 — light 6 of 12 (checker). Awning accent correct. |
| whimsical-land | 2 | 2 | 2 | **redo** | Spiral tower is a pink/blue banded tower with a blue cone cap = a lighthouse (ice-town owns it; collision at 48). Upside-down house reads right-side-up. Checker spiral is three loose cubes. Scallop rim is a pile of hex plates engulfing the plinth; no plinth band visible. Pastel → smudge at 96. Tower: stacked discs of decreasing radius, 12° lean, no cap, top disc past the rim. House: ridge on terrain, chimney down, door upside-down and visible. Checker: continuous ribbon, 0.6 m high, 1.5 turns. Rim: 14 flat scallops in the plinth plane. Plinth side `#f7c8d8`→`#e8a9c0`; stripe `#8fc9d8` is the one accent. |
| fractal-recursion | 2 | 2 | 2 | **redo** (R&D, lowest priority) | Grey smear at 96 and 48. No plinth band: the three sub-pedestals sit in front and read as tiers (grammar says no tiers). Pythagoras tree reads as a crown of diamonds. Night violation: sub-pedestal lips (pedestal) glow. Values: side `#6f7690`, top `#a8b0c4`, tree squares alternate `#dfe3ff`/`#8a90a8` by depth. Sub-pedestals: 2 not 3, on the rim at ±120°, scale 1/4, lips not emissive, lip ring thickness ×2. Marker copy +6 m on its stalk. |

## Three worst (redo before next sheet)

1. **whimsical-land**: lighthouse-shaped hero, invisible plinth, pastel wash. Placeholder per roster, but it is on the globe now.
2. **fractal-recursion**: no identity below 512 px; the only marker that breaks "one plinth, no tiers" and "pedestal never emits".
3. **future-utopia**: contrast failure; its loop collides with celestial-garden and its needle vanishes at 48.

Borderline: egyptian-desert (pyramid is a tower) and heavy-industry (two accents, no rim).

## Three best

1. **ice-town**: still the fidelity bar (windows, chimneys, attic light, snow caps per element); only the hero hierarchy needs fixing.
2. **forest**: the one marker that reads from its P1 alone at 48; faceted ball is pure toybox.
3. **wildwest**: 70 % cap mesa + green saguaro is unmistakable; cleanest single accent after swamp's lantern.

Close behind: academy-town, swamp, celestial-garden.

## Cross-family collisions (sheet-96-day / sheet-48-day)

- **future-utopia ↔ celestial-garden**: both a pale standing ring over a disc. Fix on utopia (flat loop).
- **alpine ↔ ice-town**: near-white spikes + green conifers + house on a pale disc = the ice-town prop set at 48. Fix on alpine (darker granite, visible cable).
- **jungle ↔ swamp**: flat disc crown on a trunk over a green/olive disc. Fix both (domed canopy; tiered cypress).
- **whimsical-land ↔ ice-town**: banded cone-capped tower = lighthouse. Fix on whimsical (disc stack, no cap).
- **egyptian-desert ↔ wildwest** (mild, 48 px): ochre disc with tan + brown uprights. Widening the pyramid resolves it.
- Pale-blob class at 48: future-utopia, whimsical-land, fractal-recursion are indistinguishable from each other. All three are in the redo list.

## Protected-silhouette drift (Kirby W1–W9)

No marker reproduces a Kirby prop set. Closest: **forest** (W1 toadstool + W5 round canopies; keep the cottage door/window exposed and the spots absent), **egyptian-desert** (W2; the obelisk, palms and pylon keep it clear), **jungle** (W4; the leaning palm is the W4 read, demote it to 24 m). Volcanic vs W8 is clear thanks to columns and the puff. Whimsical's new disc-stack tower must not become W9's star or W1's spotted domes.

## Night pass

- Distinct points, nothing else glows: ice-town, academy-town, wildwest, swamp, city (blob risk), harbor-town, heavy-industry, volcanic (crater + cracks, roster-sanctioned).
- Dead at night (no emissive at all): ink-world, egyptian-desert, alpine's cable/gondola. Ink gets the lantern; egypt may stay dark.
- Violations of "pedestal never emits": **jungle** rim fruit dots, **fractal** sub-pedestal lips. Future-utopia's rim strip and volcanic's cracks are roster-sanctioned exceptions; log them in `globe-markers.md` §2 so the rule stops reading as absolute.
- Weak emissive: celestial bloom (flat cream), forest cottage window.

## Fidelity vs the Ice reference

At Ice's detail density: academy-town, harbor-town, city, swamp, wildwest, forest. Below it: future-utopia, fractal-recursion, whimsical-land (no per-element detail), ink-world (pavilion), jungle (monochrome), egyptian-desert (no bands except the obelisk). Heavy-industry and volcanic are mid: good forms, thin plinths.
