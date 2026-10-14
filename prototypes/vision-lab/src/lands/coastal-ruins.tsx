import { useMemo } from 'react'
import { Blockout } from './coastal-ruins/Blockout'
import type { Layout } from './coastal-ruins/layout'
import { samplePolyline, type Point } from './coastal-ruins/bag'
import type { HeightFn } from './coastal-ruins/heightfield'
import { layoutA, stairPathA, terrainA, WELL_A } from './coastal-ruins/layout-a'
import { layoutB, stairPathB, terrainB } from './coastal-ruins/layout-b'
import { layoutC, stairPathC, terrainC } from './coastal-ruins/layout-c'
import type { BlockoutSceneProps, Direction, LandVision } from './types'

/**
 * Walk cameras stand at eye height on the stair-street of the default seed's terrain, on the
 * first step whose terrace lies in the given height band (always below the 14 m ceiling).
 */
const WALK_SEED = 7
const EYE = 1.7
function onStair(stair: readonly Point[], height: HeightFn, lo: number, hi: number, side = 0): readonly [number, number, number] {
  const steps = samplePolyline(stair, 1.5)
  const spot =
    steps.find((p) => {
      const h = height(p.x, p.z)
      return h > lo && h < hi
    }) ?? steps[0]
  // `side` shifts the eye across the stair (local x), e.g. away from the cypress row.
  const x = spot.x + Math.cos(spot.yaw) * side
  const z = spot.z - Math.sin(spot.yaw) * side
  return [x, Math.min(13.5, height(x, z) + EYE), z] as const
}
const walkA = onStair(stairPathA(), terrainA(WALK_SEED).height, 9, 11.5, -1.4)
const walkB = onStair(stairPathB(WALK_SEED).stair, terrainB(WALK_SEED).height, 7, 9.5)
// C: at the foot of the stair-street on the quay, looking up the street to the castellum and aqueduct.
const walkC = (() => {
  const [x, z] = stairPathC()[0]
  return [x + 1.5, terrainC(WALK_SEED).height(x + 1.5, z + 3) + EYE, z + 3] as const
})()

/** Layouts are deterministic per seed; the lab remounts the canvas per pose, so cache them. */
const CACHE = new Map<string, Layout>()
function cached(key: string, build: () => Layout): Layout {
  let layout = CACHE.get(key)
  if (!layout) {
    layout = build()
    CACHE.set(key, layout)
  }
  return layout
}

function SceneA({ night, seed }: BlockoutSceneProps) {
  const layout = useMemo(() => cached(`a:${seed}`, () => layoutA(seed)), [seed])
  return <Blockout layout={layout} night={night} />
}

function SceneB({ night, seed }: BlockoutSceneProps) {
  const layout = useMemo(() => cached(`b:${seed}`, () => layoutB(seed)), [seed])
  return <Blockout layout={layout} night={night} />
}

function SceneC({ night, seed }: BlockoutSceneProps) {
  const layout = useMemo(() => cached(`c:${seed}`, () => layoutC(seed)), [seed])
  return <Blockout layout={layout} night={night} />
}

const hangingWell: Direction = {
  id: 'a',
  name: 'The Hanging Well',
  lineage:
    'Ilios Well turned vertical: the deep well plaza is kept but hung half-way up a Santorini-caldera amphitheatre, stacked like Minas Tirith; the stair-street replaces Ilios’s flat lanes.',
  pitch:
    'A limestone amphitheatre wraps a round cove and climbs seventy metres in whitewashed terraces, warm cliff bands between them. One stair-street zigzags from the working quay through the cliff village to a well plaza that juts out of the slope like a belvedere, its black shaft open to the sky, then on to the archaeologists’ colonnade on the plateau skyline. The archive-beacon perches on the west horn over the cove mouth, three windmills step down the east horn through the olive terraces, and the drowned forum sits in the turquoise shelf below the town. Every district is a tier; every character walk is a climb.',
  strengths: [
    'Elevation is the composition: all five districts read at once as stacked tiers, which is the Minas Tirith promise.',
    'The well plaza is a real Ilios moment reinterpreted: a hole in a terrace with the whole cove below it.',
    'The cove gives a natural stage; the amphitheatre hides its own edges and frames the sea in every pose.',
    'Night reads as a cascade of windows above a dark harbour, with the beacon as the single high lamp.',
  ],
  risks: [
    'Steep terraces leave little flat ground; houses dig into risers and resident paths need stair logic everywhere.',
    'The back of the massif is dead space from the default camera; the plateau districts rely on the overview and reverse poses.',
    'Heightfield risers at 3 m cells read soft; the product build needs sharper quantised cliffs or stepped meshes.',
  ],
  Scene: SceneA,
  poses: [
    { id: 'hero', position: [60, 20, 215], target: [-24, 34, -40], fov: 36 },
    { id: 'walk', position: walkA, target: [WELL_A.x, WELL_A.y + 3, WELL_A.z], fov: 46 },
    { id: 'overview', position: [10, 300, 330], target: [0, 10, -20], fov: 36 },
    { id: 'reverse', position: [-70, 150, -228], target: [10, 10, 50], fov: 34 },
  ],
}

const drownedForum: Direction = {
  id: 'b',
  name: 'The Drowned Forum',
  lineage:
    'The Ruins map and Atlantis postcards, but horizontal and inhabited: Ilios’s white town is pushed to one shoulder so the lagoon, not the street, is the stage; the well becomes a sea stack with a stair.',
  pitch:
    'A turquoise lagoon fenced by a broken reef of islets fills the frame. The old forum stands knee-deep in the middle, a peristyle on its platform, a half-ring theatre whose lower seats are underwater, a dome that rolled off and sank, column stumps everywhere, a mosaic path visible through the water. Stepping-stone causeways tie it to the white village on the west hill, to the working quay on the north shore, and to a sea stack where the archive-beacon stands at the top of a stair that spirals up the rock. A skiff circles the south lagoon all day. The dynamic is mirror-flat with one vertical.',
  strengths: [
    'Unmistakable from the other lands: no other biome is mostly water with ruins standing in it.',
    'The causeways are literal progress ribbons; a student can watch a route to the beacon fill in stone by stone.',
    'Shallow-to-deep water, submerged floors and half-sunk columns are cheap to build and read beautifully in the pixel pass.',
    'The sea stack gives the beacon a true silhouette against sky from every low camera.',
  ],
  risks: [
    'Less buildable land: the village hill and the quay carry almost all houses, so population growth has fewer slots.',
    'Walking across water needs causeway pathing and the camera can look empty if the lagoon is framed without a vertical.',
    'Transparent water and submerged geometry cost fill rate and need care with the depth-edge outline.',
  ],
  Scene: SceneB,
  poses: [
    { id: 'hero', position: [-36, 12, 135], target: [36, 16, 6], fov: 40 },
    { id: 'walk', position: walkB, target: [30, 10, 20], fov: 44 },
    { id: 'overview', position: [20, 330, 330], target: [0, 0, -10], fov: 36 },
    { id: 'reverse', position: [150, 70, -150], target: [-20, 8, 20], fov: 34 },
  ],
}

const aqueductBay: Direction = {
  id: 'c',
  name: 'Aqueduct Bay',
  lineage:
    'The huge-civilisation reading of Ilios and the Ruins map: not one street but a whole Mediterranean shore, with a Segovia aqueduct and an acropolis stoa as the long horizontal and the one high note.',
  pitch:
    'A 300 m crescent bay seen from the water. In the middle a harbour with a long mole and a dome at its tip; the town climbs gentle terraces behind it under an aqueduct that marches eleven arches down from the east ridge into a castellum tower above a blue cistern court. Olive terraces and three windmills hold the east slopes. On the west headland the acropolis: a 40 m stoa, a chapel and the archive-beacon over a cliff, with a drowned forum in the shallows at its foot and the agora dig below. The stair-street climbs from the agora to the stoa. Sprawl with a skyline.',
  strengths: [
    'Breadth: five districts spread along one shore with real distance between them, so the land feels like a civilisation.',
    'Two hero silhouettes, aqueduct and acropolis, give the overview and the hero very different pictures.',
    'The most buildable land of the three: hundreds of house slots, terraces for olives, a harbour basin for boats.',
    'The aqueduct is a natural progress ribbon: arches can appear one bay at a time toward the town.',
  ],
  risks: [
    'Gentle slopes can read flat at the default pitch; the composition leans on the headland and the aqueduct to stay vertical.',
    'A 300 m shore needs more camera travel between districts than the stacked directions.',
    'Many small masses (olives, houses) compete with the big silhouettes at 48 px; the marker must simplify hard.',
  ],
  Scene: SceneC,
  poses: [
    { id: 'hero', position: [-30, 24, 220], target: [-8, 20, -24], fov: 36 },
    { id: 'walk', position: walkC, target: [-5, 25, -44], fov: 46 },
    { id: 'overview', position: [0, 290, 350], target: [0, 0, -10], fov: 36 },
    { id: 'reverse', position: [120, 70, -150], target: [-30, 10, 20], fov: 34 },
  ],
}

export const coastalRuins: LandVision = {
  id: 'coastal-ruins',
  name: 'Coastal Ruins',
  story: 'Limestone headlands over a bright sea: an archive-beacon, ruined columns, fishing harbour, terraces.',
  directions: [hangingWell, drownedForum, aqueductBay],
}
