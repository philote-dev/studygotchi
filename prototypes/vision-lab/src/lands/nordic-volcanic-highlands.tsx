import { CitadelScene, citadelPoses } from './nordic-volcanic-highlands/citadel'
import { LagoonScene, lagoonPoses } from './nordic-volcanic-highlands/lagoon'
import { PlainScene, plainPoses } from './nordic-volcanic-highlands/plain'
import type { LandVision } from './types'

/**
 * Nordic Volcanic Highlands: three composition blockouts with different dynamics.
 *   A  vertical   Hall of a Thousand Steps: a terraced fjord citadel under the volcano.
 *   B  water-led  Lagoon of the Stave Skerry: glacier, bergs, a church on an island, hot springs.
 *   C  sprawling  Ring Fort of the Black Plain: a Trelleborg ring, roads, geysers, a racked harbour.
 * Every direction still houses the five districts of the v4 plan (fjord village + quay, basalt
 * canyon + forge, highland hamlet + pasture, geothermal farms, lava archipelago) plus the course
 * landmark slot; what changes is where the eye goes first and how the ground carries it.
 */
export const nordicVolcanicHighlands: LandVision = {
  id: 'nordic-volcanic-highlands',
  name: 'Nordic Volcanic Highlands',
  story: 'A fjord settlement under a volcano: longhouses, basalt cliffs, hot springs, glaciers, black sand.',
  directions: [
    {
      id: 'a',
      name: 'Hall of a Thousand Steps',
      lineage:
        'Minas Tirith’s tiered spur + Geirangerfjord + Reynisfjara basalt organ pipes. Unlike Minas Tirith the tiers are natural basalt shelves with turf-roof timber, not white stone, and the crown is a great hall, not a tower.',
      pitch:
        'The east bank of the fjord is a basalt headland cut into four terraces, each one a street of longhouses, and one straight stair bores up the middle of them from the quay to the door of the great hall on the plateau. Behind the hall a spur climbs to the volcano, whose notched caldera glows at night above a frozen lava flow that runs down to the water. Quay and boathouses on the sand ring at the foot, the hamlet and pastures across the fjord on the gentle west bank, a bridge of basalt columns tying them together, the forge canyon in the west moor, and three black islets at the fjord mouth. Characters walk the terrace lanes with the hall above them and the water below.',
      strengths: [
        'Real verticality: 38 m of inhabited relief read from every pose, with the hall silhouette on top and the volcano behind it as a second, larger silhouette.',
        'One processional axis (quay → stair → Þing ring → hall) gives the camera a spine and gives progress a natural climb: fill the tiers bottom-up as the course advances.',
        'Districts map cleanly to tiers and banks, so each topic has a visible home with a different height.',
        'The fjord stays the largest negative space, as the brief requires, and the terraces give it a cliff to reflect off.',
      ],
      risks: [
        'Camera: the walk pose on a terrace sees cliff faces; the lower tiers can occlude the quay from some orbits.',
        'Cost: the terraced heightfield is the densest of the three (~45 k tris at this cell size) and residents need stair pathing between tiers.',
        'Progress bands: an empty upper tier at 0 % reads as ruins unless the plateau hall exists from the start.',
      ],
      Scene: CitadelScene,
      poses: citadelPoses,
    },
    {
      id: 'b',
      name: 'Lagoon of the Stave Skerry',
      lineage:
        'Jökulsárlón glacier lagoon + Borgund stave church + Overwatch Ilios Well, where a body of water is the hub and one landmark sits on an island in it. Unlike Ilios it is black sand, turf and dark timber, and the bergs do the white.',
      pitch:
        'A round glacial lagoon fills the middle of the land. A glacier tongue steps down the volcano’s flank and calves into it, so white bergs drift past a stave church standing on a rocky skerry, reached by a 40 m plank causeway from the black beach. Longhouses crescent the south-east shore with boat sheds and longships hauled up between them; a longship rows a slow loop on the water. Hot springs steam on the east shore under a sinter apron, the meltwater canyon with its forge cuts in from the west, the hamlet and pastures sit on the south-west moor, and the outlet river runs south to the sea where the lava islets smoulder. Characters walk the beach with the church ahead and ice behind it.',
      strengths: [
        'Water is unambiguously the largest field, and the composition is a ring around it: every district faces the same centre, so the overview reads at 48 px as blue disc, white glacier, dark crescent.',
        'The church-on-skerry plus causeway is a silhouette nobody else in the world has, and it photographs from every bearing.',
        'Verticality comes free from the 15 m ice front and the 100 m volcano behind it, without putting houses on cliffs.',
        'Ambient life is built in: drifting ship, calving-sized bergs, steam, sheep.',
      ],
      risks: [
        'Gameplay fit: the settlement is a thin crescent, so dense population bands need the second row and the shore sheds to avoid feeling like a strip.',
        'Camera: from low walk poses the lagoon is mostly empty water; bergs must be scaled to fill it or the middle reads as a void.',
        'Cost: bergs and causeway posts add instances, and the ice needs its own two tones to not read as snow.',
      ],
      Scene: LagoonScene,
      poses: lagoonPoses,
    },
    {
      id: 'c',
      name: 'Ring Fort of the Black Plain',
      lineage:
        'Trelleborg’s geometric ring fortress + Þingvellir’s law rock + the Ilios Ruins idea of a civilisation laid out in the open with the sea at its edge. Unlike Trelleborg the ring sits in a living black-sand plain with geysers, lava tubes and a racked fishing harbour around it.',
      pitch:
        'A black-sand plain spreads from the volcano in the north-west to the sea in the south, mottled with moss and braided by a glacial river. On a low rise at its centre stands a perfect ring fort, 96 m across: earth rampart, palisade, four gate houses, four quadrants of longhouses around yards, and a law rock with a great fire on the mound in the middle. Four roads radiate through the gates, lined with standing stones, to a harbour of drying racks, long halls and a T-quay with longships; to a steaming geyser field; to a row of lava-tube storehouses in the old lava field; and to the quarry canyon with its basalt organ pipes and forge. Characters walk inside the ring with the mound ahead and the gate houses on the skyline.',
      strengths: [
        'A silhouette you remember from the air: the circle in the black plain with smoke rising from its centre, the volcano on the diagonal behind it.',
        'Sprawl with rhythm: roads, stone avenues and rack grids give the eye repeated beats across 300 m without any one object needing detail.',
        'Districts are spatially generous (harbour, geysers, lava tubes, quarry, hamlet) so progress can light up whole regions, and residents have long walks past things.',
        'Cheapest terrain of the three; the ring and gate houses carry the hero read.',
      ],
      risks: [
        'Verticality is modest (8 m ring, 7 m gate houses) so the land relies on the volcano and the crag for height; low walk poses see mostly flat ground.',
        'Camera: the ring only reads as a circle from the overview; at the hero pose it is an arc, so the gate houses and central fire must do the work.',
        'Progress bands: a 0 % ring with empty quadrants reads as a sports ground until the quadrant halls arrive.',
      ],
      Scene: PlainScene,
      poses: plainPoses,
    },
  ],
}
