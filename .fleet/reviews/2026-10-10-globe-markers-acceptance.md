# Globe markers: readability and acceptance review

Date: 2026-10-10. Reviewer: Readability & Acceptance (review panel lens 2 of 3). Inputs: `/tmp/marker-shots` (17 markers, 4 props, day/night, 512/96/48), `/tmp/marker-shots-p2` (2 props: ice-town, wildwest, forest). Colour numbers computed with the lab's `deltaE2000` / `hexToLab`.

Method: 48 px reads made on 4×/6× nearest-neighbour upscales. The review cell is a 94×94 content square; day bg `#dbd9de`, night bg `#181430`. "Night points" are 8-connected clusters that did not darken at night (truly emissive surfaces).

## 1. Per-marker table

| marker | 48 px read (vs roster phrase) | night points 96 / 48 | scale h% 96 / 48 | verdict |
|---|---|---|---|---|
| ice-town | pale white/blue cluster with **two** red patches (lighthouse cap + house roof); no cone reads. WEAK | 8 / 3, distinct | 62 / 61 | WEAK |
| ink-world | white disc, black brush splashes, red seal dot. PASS | 0 / 0, no glow | 64 / 57 | PASS |
| celestial-garden | pale arc + yellow spot over an indigo disc; ring reads as an arc. WEAK | 2 / 2 + dim rim studs | 60 / 57 | PASS- |
| heavy-industry | mauve-grey boxy machine, orange cab top-left, blue pipe; no T. WEAK | 1 / 1 | 64 / 61 | WEAK |
| future-utopia | pale mint haze, almost invisible; no spire. FAIL | 11 / 6 cyan specks, body keeps 0.66–0.69 of day L | 62 / **52** | FAIL |
| harbor-town | grey-blue disc, cream sail + yellow stripe, diagonal mast/crane. PASS | 2 / 0 (windows not declared) | 64 / 61 | PASS |
| academy-town | brick blocks, round green tree, white cupola. PASS | 3 / 2 | 68 / 61 | PASS |
| wildwest | orange butte with pale cap, green cactus. PASS | 2 / 2 (windows not declared) | 62 / 61 | PASS |
| volcanic | dark mass, orange-red cone, bright orange top. PASS | 7 / 2 | 64 / 61 | PASS |
| egyptian-desert | cream triangle + tan obelisk; low contrast. WEAK | 0 / 0 | 64 / 61 | WEAK |
| alpine | grey spike + brown chalet + white specks on green; no cable. WEAK | 2 / 1 (windows not declared) | 62 / 61 | WEAK |
| swamp | tall olive blob, brown trunk, pink + yellow dots. PASS | 3 / 2 | 64 / 61 | PASS |
| jungle | green umbrella canopy, cyan stripe, tan ruin. PASS | 5 / 1 | 64 / 61 | PASS |
| forest | big green ball on green disc, salmon mushroom. PASS | 2 / 2 (windows not declared) | 64 / 61 | PASS |
| city | pale lilac/white blocks + green dot; tower not separable. WEAK | 12 / 3 (facets merge at 48) | 64 / 61 | WEAK |
| whimsical-land | pastel confetti; no tower. FAIL | 1 / 1 (window not declared), body 0.60 | 60 / 57 | FAIL |
| fractal-recursion | grey-lavender static with pink specks. FAIL | 0 / 0, body 0.49 | 66 / 65 | FAIL |

Tally at 48 px: 9 PASS, 5 WEAK, 3 FAIL (future-utopia, whimsical-land, fractal-recursion). Night: no non-emissive family glows; nothing merges at 96 px; at 48 px city's tower windows merge and volcanic loses 5 of 7 points.

## 2. Scale check

All 17 sit in a tight band (height 60–68 % of the cell, no bbox touches an edge). Outlier: future-utopia at 48 px is 52 % (too small). Consistency is fine; absolute size is not: §4 asks for the disc at 80 % of frame height, the lab cell has the whole marker at ~62 %, so every 48 px read is being done on a ~28 px tall object.

## 3. Colour acceptance

Acceptance 3 (top ΔE < 12 and same P1 category): 0 failures.

Acceptance 2 (side ΔE < 20 and top ΔE < 20): 12 flagged pairs. Worst: harbor-town / fractal-recursion 8.0 / 5.4; jungle / forest 10.4 / 7.3; heavy-industry / harbor-town 12.1 / 9.3; ink-world / future-utopia 12.5 / 8.6; heavy-industry / fractal-recursion 13.4 / 11.5; ink-world / heavy-industry 15.8 / 14.1; city / fractal-recursion 17.0 / 14.1; ice-town / harbor-town 15.4 / 17.3; ice-town / future-utopia 17.5 / 6.5; ice-town / fractal-recursion 18.1 / 17.8; swamp / jungle 19.0 / 16.6; ink-world / egyptian-desert 19.3 / 14.7. With the lip admitted as a third channel only four pairs stay under 20 on all three.

Lip vs side ΔE (threshold 12): FAIL jungle 0.0 (lip = side), egyptian-desert 7.9, alpine 8.6. Marginal: harbor-town 12.4, forest 13.4, future-utopia 17.4.

Pedestal vs the day cell background: ink-world 9.5 / 8.5, ice-town 18.7 / 7.0, future-utopia 13.6 / 11.2, heavy-industry 17.4 / 10.3, whimsical-land 15.5 / 18.4, fractal-recursion 21.7 / 12.7, city 24.8 / 10.9. These are exactly the WEAK/FAIL rows.

## 4. Progression (2 vs 4 props)

Pixels differing at 48 px: ice-town 63 %, wildwest 37 %, forest 35 %. All three distinguishable. The pedestal never changes between states, so the tier half of acceptance 4 is untested; only the prop count carries the progression. 2-prop ice-town (cone + lighthouse) matches the roster phrase better than the 4-prop version.

## 5. Prioritised fixes

1. Framing (all markers): raise the review/globe pose so the pedestal disc hits 80 % of frame height per §4.
2. future-utopia: side `#8fcdb8`, top `#c9eedd`; clamp glass albedo at night so body L ≤ 0.5 of day.
3. whimsical-land: one dark anchor (tower body raspberry `#d6567f` or deep cyan `#3fa0c9`), lip stripe `#5fa8c8`.
4. fractal-recursion: side `#7a6f9e`, top `#a99fc9`; dark trunk `#3a2f45` on the Pythagoras tree.
5. ice-town: houses reuse the accent red; recolour house walls teal only, snow roofs white.
6. jungle lip = side: lip → fruit-gold `#f2b84f` or darker vine `#2f6b4a`.
7. egyptian-desert lip `#e2b98a` → `#b8824a`; alpine lip `#a9aeb5` → snow `#eef4f7`.
8. Grey cluster (heavy-industry / harbor-town / ink-world): amend acceptance 2 to max(side, top, lip) > 20 rather than chasing 20/20.
9. city at 48 px: light every other floor so there is a ≥ 1 px dark gap.
10. Data drift: warehouse-row, saloon, chalet, mushroom-cottage, upside-down-house render lit windows but carry no `emissive` in `markers.ts`.
11. volcanic at 48 px: raise forge door / ember rock emissive so 2–3 points survive.
