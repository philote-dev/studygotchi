import { useMemo } from 'react'
import type { BlockoutSceneProps } from '../types'
import { forest } from './forest'
import {
  Bamboo,
  BigTrees,
  Boardwalk,
  Canoes,
  Canopy,
  Columns,
  DyeRacks,
  Farms,
  GlowPoints,
  Huts,
  Path,
  Reeds,
  River,
  RootCrownShrine,
  RootGate,
  RopeBridges,
  Slabs,
  Stairs,
  Terrain,
  TriangleProbe,
  Walkers,
  WaterPlane,
  Wheel,
  bigTreeDeckRadius,
  type BigTree,
  type BridgeSpec,
  type Hut,
} from './kit'
import { ellipseDistance, makeHeight, makeLip, makeTerrain, openGround, openSky, WATER, type LandSpec } from './land'
import { mulberry, Noise, polylineDistance, range, ring, smoothPath, smoothstep, type V2, type V3 } from './lib'
import { P } from './palette'

/**
 * Direction B, "Falls and Lagoon": the water is the spine. The 18 m fall with the 27 m bridge at
 * its lip, a chain of three pools between treehouse banks, the lagoon with the stilt hall, docks
 * and reed beds, the half-drowned Ruin Commons at its far edge, and the wheel at the outflow.
 */
const noise = new Noise(53)
const LAGOON = { x: 40, z: 8, rx: 36, rz: 28, depth: 3.4 }
const SHRINE_AT: V2 = [60, 46]
const RIVER: V2[] = [
  [24, -300],
  [22, -200],
  [22, -130],
  [22, -100],
  [24, -82],
  [22, -62],
  [26, -42],
  [34, -20],
  [40, 8],
  [66, 28],
  [86, 38],
  [112, 46],
  [160, 60],
  [300, 80],
]
const RIVERS = [smoothPath(RIVER, 4)]
const LAND: LandSpec = {
  noise,
  lip: makeLip(noise, -100),
  plateau: 18,
  shelf: false,
  rivers: RIVERS,
  riverDepth: 2.6,
  lagoons: [LAGOON],
  clearings: [
    { x: -14, z: 64, rx: 20, rz: 14 },
    { x: 100, z: 90, rx: 18, rz: 13 },
    { x: -90, z: -50, rx: 16, rz: 13 },
  ],
  knobs: [[SHRINE_AT[0], SHRINE_AT[1], 16, 6]],
  // Two 2.4 m steps between the fall and the lagoon: the river pools behind each.
  extra: (_x, z) => 2.4 * smoothstep(-46, -54, z) + 2.4 * smoothstep(-68, -76, z),
}
export const heightB = makeHeight(LAND)

const DECK = { low: 6, mid: 11.5, high: 18 } as const
const g = (x: number, z: number, h: number, r: number, crown: number, decks: number[], ladder = false): BigTree => ({ x, y: heightB(x, z) - 0.3, z, h, r, crown, decks, ladder })
const MOTHER: BigTree = { ...g(-20, -6, 32, 3.2, 15, [DECK.low, DECK.mid, DECK.high]), deckScale: 1.3 }
const WEST: BigTree[] = [MOTHER, g(-44, -24, 26, 2.3, 12, [DECK.mid], true), g(-36, 18, 25, 2.2, 12, [DECK.low, DECK.mid])]
const BANKS: BigTree[] = [
  g(6, -86, 22, 2.0, 11, [DECK.low], true),
  g(42, -78, 23, 2.0, 11, [DECK.low]),
  g(4, -58, 22, 1.9, 10, [DECK.low], true),
  g(46, -52, 24, 2.1, 11, [DECK.mid]),
  g(2, -30, 22, 1.9, 10, [DECK.low]),
  g(74, -24, 24, 2.1, 11, [DECK.low], true),
]
const GIANTS: BigTree[] = [...WEST, ...BANKS, g(-70, 40, 26, 2.3, 12, []), g(110, 10, 25, 2.2, 12, [])]
const ROOT_GATE: V2 = [78, -8]
const COURT: V2 = [90, -22]
const WHEEL_AT: V2 = [100, 42]

const stone = (x: number, z: number) => Math.abs(x - COURT[0]) < 10 && Math.abs(z - COURT[1]) < 8
const TERRAIN = makeTerrain(LAND, heightB, stone)

const PATHS: V2[][] = [
  [
    [-4, 60],
    [10, 44],
    [14, 36],
  ],
  [
    [-30, 60],
    [-46, 40],
    [-56, 10],
    [-50, -20],
    [-30, -40],
    [-6, -50],
  ],
  [
    [60, 48],
    [86, 50],
    [104, 60],
    [120, 80],
  ],
  [
    [62, -36],
    [78, -30],
    [96, -14],
  ],
  [
    [8, -40],
    [6, -62],
    [10, -84],
  ],
]
const FALLS_STAIR: V2[] = [
  [40, -84],
  [44, -96],
  [44, -106],
  [42, -118],
]

interface Layout {
  trees: ReturnType<typeof forest>
  pods: Hut[]
  huts: Record<'falls' | 'ruins' | 'riverworks', Hut[]>
  stiltHuts: Hut[]
  bridges: BridgeSpec[]
  columns: { x: number; y: number; z: number; h: number }[]
  torches: V3[]
  canoes: V2[]
  reeds: V2[]
  bamboo: V2[]
  walkers: V3[]
}

function deckEdge(tree: BigTree, deck: number, angle: number, inset = 1.4): V3 {
  const R = bigTreeDeckRadius(tree) - inset
  return [tree.x + Math.cos(angle) * R, tree.y + deck + 0.3, tree.z + Math.sin(angle) * R]
}

function towards(a: BigTree, b: BigTree): number {
  return Math.atan2(b.z - a.z, b.x - a.x)
}

function buildLayout(seed: number): Layout {
  const rng = mulberry(seed * 4409 + 3)
  const accept = (x: number, z: number): number => {
    if (openGround(LAND, heightB, x, z) === 0) return 0
    if (GIANTS.some((t) => Math.hypot(x - t.x, z - t.z) < bigTreeDeckRadius(t) + 2)) return 0
    for (const path of PATHS) if (polylineDistance(x, z, path).d < 3.5) return 0
    if (Math.hypot(x - SHRINE_AT[0], z - SHRINE_AT[1]) < 14) return 0
    if (Math.hypot(x - ROOT_GATE[0], z - ROOT_GATE[1]) < 10 || Math.hypot(x - COURT[0], z - COURT[1]) < 14) return 0
    if (x > 84 && x < 130 && z > 50 && z < 84) return 0.05
    if (ellipseDistance(x, z, LAGOON) < 1.7) return 0.12
    if (z < -30 && z > -100 && Math.abs(x - 24) < 22) return 0.08
    if (Math.hypot(x, z) > 165) return 0.92
    return noise.fbm(x / 34 + 20, z / 34 + 20) > 0.46 ? 0.1 : 0.84
  }
  const trees = openSky(forest({ seed, height: heightB, accept, emergentChance: 0.07 }), 28, -40, 70)

  const pods: Hut[] = []
  for (const tree of GIANTS) {
    const R = bigTreeDeckRadius(tree)
    for (const d of tree.decks ?? []) {
      const count = tree === MOTHER ? 3 : 1 + Math.round(rng())
      for (let k = 0; k < count; k++) {
        const a = rng() * Math.PI * 2
        pods.push({ x: tree.x + Math.cos(a) * R * 0.55, y: tree.y + d + 0.5, z: tree.z + Math.sin(a) * R * 0.55, yaw: -a, w: 3.6, d: 3.4, h: 2.8, pod: rng() < 0.6 })
      }
    }
  }
  const hutAt = (x: number, z: number, yaw: number, w = 5.4, d = 4.8, h = 3.3): Hut => ({ x, y: heightB(x, z) - 0.15, z, yaw, w, d, h })
  const huts: Layout['huts'] = {
    falls: [
      [40, -120, 0.2, 4.4, 4, 2.8],
      [48, -124, -0.3, 4.4, 4, 2.8],
      [8, -120, 0.4, 4.4, 4, 2.8],
      [0, -126, -0.2, 4.4, 4, 2.8],
      [40, -88, 0.3, 4.4, 4, 2.8],
    ].map(([x, z, yaw, w, d, h]) => hutAt(x, z, yaw, w, d, h)),
    ruins: [
      [100, -30, 0.3],
      [84, -36, -0.4],
      [104, -10, 0.5, 7, 6, 4],
    ].map(([x, z, yaw, w, d, h]) => hutAt(x, z, yaw, w, d, h)),
    riverworks: [
      [96, 60, 0.2],
      [116, 56, -0.4],
      [88, 72, 0.6],
    ].map(([x, z, yaw]) => hutAt(x, z, yaw)),
  }
  const stiltHuts: Hut[] = [{ x: 48, y: 1.1, z: 14, yaw: 0.35, w: 18, d: 9, h: 4.2, ground: -3.4 }]
  for (const [x, z] of [
    [6, 20],
    [26, 32],
    [60, 32],
    [72, 18],
    [12, -8],
    [22, 6],
    [66, -12],
    [46, 36],
  ]) stiltHuts.push({ x, y: 1.1, z, yaw: Math.atan2(LAGOON.x - x, LAGOON.z - z) + range(rng, -0.4, 0.4), w: range(rng, 4.4, 5.4), d: range(rng, 4, 5), h: 3.1, ground: Math.min(heightB(x, z), 0.4) })

  const bridges: BridgeSpec[] = [
    { a: [8, 18.6, -116], b: [35, 18.6, -113], planks: 14, sag: 0.05 },
    { a: deckEdge(MOTHER, DECK.mid, towards(MOTHER, WEST[1])), b: deckEdge(WEST[1], DECK.mid, towards(WEST[1], MOTHER)), planks: 12, sag: 0.06 },
    { a: deckEdge(MOTHER, DECK.mid, towards(MOTHER, WEST[2])), b: deckEdge(WEST[2], DECK.mid, towards(WEST[2], MOTHER)), planks: 12, sag: 0.06 },
    { a: deckEdge(BANKS[2], DECK.low, towards(BANKS[2], BANKS[3])), b: deckEdge(BANKS[3], DECK.low + 0.2, towards(BANKS[3], BANKS[2]), 1.4), planks: 18, sag: 0.06 },
    { a: deckEdge(BANKS[0], DECK.low, towards(BANKS[0], BANKS[1])), b: deckEdge(BANKS[1], DECK.low, towards(BANKS[1], BANKS[0])), planks: 16, sag: 0.06 },
    { a: deckEdge(MOTHER, DECK.low, towards(MOTHER, BANKS[4])), b: deckEdge(BANKS[4], DECK.low, towards(BANKS[4], MOTHER)), planks: 10, sag: 0.07 },
  ]

  const columns: Layout['columns'] = []
  for (let i = 0; i < 5; i++) {
    const x = 66 + i * 5
    const z = -2 + i * 1.5
    columns.push({ x, y: Math.min(heightB(x, z), -1.5), z, h: rng() < 0.4 ? range(rng, 3, 4.5) : 6.5 })
  }
  for (let i = 0; i < 4; i++) {
    for (const dz of [-6, 6]) {
      const x = COURT[0] - 7.5 + i * 5
      columns.push({ x, y: heightB(x, COURT[1] + dz) - 0.2, z: COURT[1] + dz, h: rng() < 0.4 ? range(rng, 2, 4) : 6.5 })
    }
  }
  const torches: V3[] = [
    [10, 2.9, 40],
    [20, 2.9, 44],
    [32, 2.9, 44],
    [-8, heightB(-8, 60) + 2.4, 60],
    [-20, heightB(-20, 68) + 2.4, 68],
    [34, heightB(34, -122) + 2.4, -122],
    [48, heightB(48, -116) + 2.4, -116],
    [88, heightB(88, -16) + 2.4, -16],
    [96, heightB(96, 64) + 2.4, 64],
  ]
  const canoes: V2[] = [
    [30, 4],
    [52, 0],
    [40, 20],
    [26, -12],
    [58, 22],
    [36, 30],
    [18, 12],
  ]
  const reeds = ring(LAGOON.x, LAGOON.z, LAGOON.rx * 0.97, LAGOON.rz * 0.97, 22).filter((_, i) => i % 4 !== 1)
  const bamboo: V2[] = [
    [0, 30],
    [14, -24],
    [70, 34],
    [84, 4],
    [14, -70],
    [36, -62],
    [-30, 44],
    [10, -92],
  ]
  const walkers: V3[] = [
    [36, 1.3, 36.5],
    [27, 1.3, 38],
    [44, 1.3, 30],
    deckEdge(MOTHER, DECK.mid, 1.2, 3.5),
    deckEdge(BANKS[2], DECK.low, 0.4, 2.5),
    [40, heightB(40, -112) + 0.4, -112],
    [-10, heightB(-10, 62) + 0.4, 62],
    [94, heightB(94, -18) + 0.4, -18],
  ]
  return { trees, pods, huts, stiltHuts, bridges, columns, torches, canoes, reeds, bamboo, walkers }
}

export function FallsLagoonScene({ night, seed }: BlockoutSceneProps) {
  const layout = useMemo(() => buildLayout(seed), [seed])
  return (
    <group>
      <Terrain spec={TERRAIN} />
      <WaterPlane level={WATER} night={night} />
      <River points={RIVER} height={heightB} width={9.5} night={night} hero />
      <Canopy trees={layout.trees} />
      <BigTrees trees={GIANTS} night={night} />
      <Huts huts={layout.pods} night={night} roof={P.jewel.canopy} />
      <Huts huts={layout.huts.falls} night={night} roof={P.jewel.falls} />
      <Huts huts={layout.huts.ruins} night={night} roof={P.jewel.ruins} />
      <Huts huts={layout.huts.riverworks} night={night} roof={P.jewel.riverworks} />
      <Huts huts={layout.stiltHuts} night={night} roof={P.jewel.lagoon} />
      <RopeBridges bridges={layout.bridges} night={night} />
      {PATHS.map((points, i) => (
        <Path key={i} points={points} width={2.8} height={heightB} />
      ))}
      <Stairs points={FALLS_STAIR} width={2.6} height={heightB} />
      <Boardwalk
        points={[
          [14, 40],
          [26, 38],
          [38, 36],
          [48, 26],
        ]}
        width={2.6}
        y={1.0}
        ground={-3.2}
      />
      <Boardwalk
        points={[
          [26, 38],
          [30, 24],
          [34, 12],
        ]}
        width={2.2}
        y={1.0}
        ground={-3.2}
      />
      <Boardwalk
        points={[
          [68, 28],
          [62, 16],
          [58, 6],
        ]}
        width={2.2}
        y={1.0}
        ground={-3.2}
      />
      <Boardwalk
        points={[
          [60, 40],
          [60, 48],
        ]}
        width={2.4}
        y={1.0}
        ground={-3.2}
      />
      <Canoes items={layout.canoes} y={WATER + 0.15} />
      <Reeds clumps={layout.reeds} y={WATER + 0.2} />
      <Bamboo clumps={layout.bamboo} height={heightB} />
      <RootGate x={ROOT_GATE[0]} y={heightB(ROOT_GATE[0], ROOT_GATE[1])} z={ROOT_GATE[1]} yaw={-0.6} />
      <Slabs items={[[COURT[0], heightB(COURT[0], COURT[1]) - 0.9, COURT[1], 20, 1.1, 16]]} />
      <Columns items={layout.columns} />
      <Farms
        plots={[
          [100, 72, 12, 8, 0.2],
          [114, 68, 10, 8, 0.2],
          [106, 86, 14, 8, -0.1],
        ]}
        height={heightB}
      />
      <DyeRacks
        racks={[
          [90, 60, 0.3],
          [120, 76, -0.2],
        ]}
        height={heightB}
        color={P.jewel.riverworks}
      />
      <Wheel x={WHEEL_AT[0]} y={heightB(WHEEL_AT[0], WHEEL_AT[1]) + 3.4} z={WHEEL_AT[1]} radius={6} yaw={0.4} />
      <RootCrownShrine x={SHRINE_AT[0]} y={heightB(SHRINE_AT[0], SHRINE_AT[1])} z={SHRINE_AT[1]} night={night} />
      <GlowPoints points={layout.torches} night={night} />
      <Walkers items={layout.walkers} />
      <TriangleProbe />
    </group>
  )
}
