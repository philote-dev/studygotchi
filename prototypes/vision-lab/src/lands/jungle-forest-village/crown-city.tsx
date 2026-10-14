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
  SwayingBridge,
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
import { mulberry, Noise, polylineDistance, range, ring, smoothPath, type V2, type V3 } from './lib'
import { P } from './palette'

/**
 * Direction A, "Crown City": the village lives in the crowns. Six giant trees around the Firefly
 * clearing carry decks at three heights, joined by a rope loop above the clearing; the Mother Tree
 * is the civic hub; the 18 m fall drops past the decks into the lagoon; farms and the ruin court
 * stay on the ground. Vertical dynamics: trunks, decks, ladders, bridges.
 */
const noise = new Noise(41)
const CLEARING = { x: -4, z: 14, rx: 24, rz: 18 }
const LAGOON = { x: 34, z: -32, rx: 26, rz: 20, depth: 3.2 }
const RIVER: V2[] = [
  [28, -300],
  [26, -200],
  [24, -120],
  [26, -74],
  [29, -60],
  [32, -46],
  [34, -32],
  [48, -16],
  [66, -4],
  [88, 10],
  [112, 28],
  [150, 48],
  [230, 70],
  [300, 90],
]
const RIVERS = [smoothPath(RIVER, 4)]
const LAND: LandSpec = {
  noise,
  lip: makeLip(noise, -62, { x0: 54, x1: 78, reach: 16 }),
  plateau: 18,
  shelf: false,
  rivers: RIVERS,
  riverDepth: 2.6,
  lagoons: [LAGOON],
  clearings: [CLEARING, { x: 40, z: 62, rx: 18, rz: 13 }, { x: -80, z: -40, rx: 16, rz: 13 }],
}
export const heightA = makeHeight(LAND)

const DECK = { low: 6, mid: 11.5, high: 18 } as const
const g = (x: number, z: number, h: number, r: number, crown: number, decks: number[], ladder = false): BigTree => ({ x, y: heightA(x, z) - 0.3, z, h, r, crown, decks, ladder })
const RING: BigTree[] = [
  g(31, 23, 29, 2.2, 10, [DECK.low, DECK.mid], true),
  g(5, 49, 31, 2.4, 11, [DECK.mid, DECK.high]),
  g(-29, 39, 28, 2.1, 10, [DECK.low, DECK.mid], true),
  g(-39, 5, 30, 2.3, 10.5, [DECK.mid, DECK.high]),
  g(-13, -21, 32, 2.4, 11, [DECK.low, DECK.mid]),
  g(21, -10, 33, 2.5, 11, [DECK.mid, DECK.high], true),
]
const MOTHER: BigTree = { ...g(-46, -20, 36, 3.4, 14, [DECK.low, DECK.mid, DECK.high, 24]), deckScale: 1.35 }
const GIANTS: BigTree[] = [...RING, MOTHER, g(-70, 60, 24, 2.0, 11, []), g(102, 84, 26, 2.2, 12, [DECK.low]), g(-20, 90, 24, 2.0, 11, [])]
const SHRINE_AT: V2 = [66, -66]
const ROOT_GATE: V2 = [-60, 44]
const COURT: V2 = [-66, 64]
const WHEEL_AT: V2 = [87, 9]

const stone = (x: number, z: number) => Math.abs(x - COURT[0]) < 10 && Math.abs(z - COURT[1]) < 8
const TERRAIN = makeTerrain(LAND, heightA, stone)

const PATHS: V2[][] = [
  ring(CLEARING.x, CLEARING.z, CLEARING.rx + 4, CLEARING.rz + 4, 22),
  [
    [18, 26],
    [36, 20],
    [50, 4],
    [60, -10],
  ],
  [
    [-26, 24],
    [-48, 36],
    [-60, 48],
    [-66, 58],
  ],
  [
    [8, 32],
    [30, 44],
    [52, 48],
    [70, 34],
    [84, 18],
  ],
  [
    [-24, 2],
    [-40, -8],
    [-60, -16],
    [-80, -36],
  ],
  [
    [10, -4],
    [20, -14],
  ],
]
const FALLS_STAIR: V2[] = [
  [48, -44],
  [50, -56],
  [50, -68],
  [54, -80],
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
  const rng = mulberry(seed * 7919 + 101)
  const accept = (x: number, z: number): number => {
    if (openGround(LAND, heightA, x, z) === 0) return 0
    if (GIANTS.some((t) => Math.hypot(x - t.x, z - t.z) < bigTreeDeckRadius(t) + 2)) return 0
    for (const path of PATHS) if (polylineDistance(x, z, path).d < 3.5) return 0
    if (Math.hypot(x - SHRINE_AT[0], z - SHRINE_AT[1]) < 14) return 0
    if (Math.hypot(x - ROOT_GATE[0], z - ROOT_GATE[1]) < 10 || Math.hypot(x - COURT[0], z - COURT[1]) < 14) return 0
    if (x > 56 && x < 104 && z > 16 && z < 60) return 0.05
    if (ellipseDistance(x, z, CLEARING) < 1.9) return 0.35
    if (Math.hypot(x, z) > 165) return 0.92
    return noise.fbm(x / 34 + 20, z / 34 + 20) > 0.46 ? 0.1 : 0.84
  }
  const trees = openSky(forest({ seed, height: heightA, accept, emergentChance: 0.07 }), CLEARING.x, CLEARING.z, 84)

  const pods: Hut[] = []
  for (const tree of GIANTS) {
    const R = bigTreeDeckRadius(tree)
    for (const d of tree.decks ?? []) {
      const count = tree === MOTHER ? 3 : 2
      for (let k = 0; k < count; k++) {
        const a = rng() * Math.PI * 2
        const r = R * 0.55
        const pod = rng() < 0.6
        // Keep the walk pose's tree (south-east) clear on the side the camera stands.
        if (tree === RING[0] && Math.cos(a - Math.PI * 1.25) > 0.1) continue
        pods.push({ x: tree.x + Math.cos(a) * r, y: tree.y + d + 0.5, z: tree.z + Math.sin(a) * r, yaw: -a, w: 3.6, d: 3.4, h: 2.8, pod })
      }
    }
  }
  const hutAt = (x: number, z: number, yaw: number, w = 5.4, d = 4.8, h = 3.3): Hut => ({ x, y: heightA(x, z) - 0.15, z, yaw, w, d, h })
  const huts: Layout['huts'] = {
    falls: [
      [44, -82, 0.2, 4.4, 4, 2.8],
      [52, -86, -0.3, 4.4, 4, 2.8],
      [12, -82, 0.4, 4.4, 4, 2.8],
      [6, -90, -0.2, 4.4, 4, 2.8],
      [10, -50, 0.3, 4.4, 4, 2.8],
    ].map(([x, z, yaw, w, d, h]) => hutAt(x, z, yaw, w, d, h)),
    ruins: [
      [-48, 56, 0.3],
      [-52, 72, -0.4],
      [-78, 48, 0.5],
      [-80, 74, 0.1, 7, 6, 4],
    ].map(([x, z, yaw, w, d, h]) => hutAt(x, z, yaw, w, d, h)),
    riverworks: [
      [66, 24, 0.2],
      [96, 28, -0.4],
      [78, 44, 0.6],
      [60, 40, 0.1],
    ].map(([x, z, yaw]) => hutAt(x, z, yaw)),
  }
  const stiltHuts: Hut[] = [{ x: 46, y: 1.1, z: -16, yaw: -0.5, w: 18, d: 9, h: 4.2, ground: -3.2 }]
  for (const [x, z] of [
    [58, -36],
    [56, -24],
    [12, -40],
    [24, -50],
    [60, -48],
  ]) stiltHuts.push({ x, y: 1.1, z, yaw: Math.atan2(LAGOON.x - x, LAGOON.z - z) + range(rng, -0.4, 0.4), w: range(rng, 4.4, 5.4), d: range(rng, 4, 5), h: 3.1, ground: Math.min(heightA(x, z), 0.4) })

  const bridges: BridgeSpec[] = []
  for (let i = 0; i < RING.length; i++) {
    const a = RING[i]
    const b = RING[(i + 1) % RING.length]
    bridges.push({ a: deckEdge(a, DECK.mid, towards(a, b)), b: deckEdge(b, DECK.mid, towards(b, a)), planks: 16, sag: 0.06 })
  }
  bridges.push({ a: deckEdge(RING[3], DECK.high, towards(RING[3], MOTHER)), b: deckEdge(MOTHER, DECK.high, towards(MOTHER, RING[3])), planks: 12, sag: 0.06 })
  bridges.push({ a: deckEdge(RING[1], DECK.high, towards(RING[1], RING[5])), b: deckEdge(RING[5], DECK.high, towards(RING[5], RING[1])), planks: 24, sag: 0.05 })
  bridges.push({ a: [14, 18.6, -78], b: [41, 18.6, -76], planks: 14, sag: 0.05 })
  bridges.push({ a: deckEdge(GIANTS[8], DECK.low, towards(GIANTS[8], RING[0])), b: deckEdge(RING[0], DECK.low, towards(RING[0], GIANTS[8])), planks: 20, sag: 0.06 })

  const columns: Layout['columns'] = []
  for (let i = 0; i < 4; i++) {
    for (const dz of [-6, 6]) {
      const x = COURT[0] - 7.5 + i * 5
      columns.push({ x, y: heightA(x, COURT[1] + dz) - 0.2, z: COURT[1] + dz, h: rng() < 0.4 ? range(rng, 2, 4) : 6.5 })
    }
  }
  const torches: V3[] = ring(CLEARING.x, CLEARING.z, CLEARING.rx + 2, CLEARING.rz + 2, 10).map(([x, z]) => [x, heightA(x, z) + 2.4, z])
  for (const [x, z] of [
    [-72, 56],
    [-60, 70],
    [40, -84],
    [50, -90],
  ]) torches.push([x, heightA(x, z) + 2.4, z])
  const canoes: V2[] = [
    [30, -26],
    [40, -38],
    [22, -34],
    [50, -28],
    [36, -18],
  ]
  const reeds = ring(LAGOON.x, LAGOON.z, LAGOON.rx * 0.96, LAGOON.rz * 0.96, 14).filter((_, i) => i % 3 !== 0)
  const bamboo: V2[] = [
    [8, -28],
    [62, -14],
    [60, -40],
    [10, -56],
    [46, -60],
    [-16, 44],
    [38, 72],
  ]
  const walkers: V3[] = [
    [-4, heightA(-4, 14) + 0.4, 14],
    [6, heightA(6, 20) + 0.4, 20],
    [-14, heightA(-14, 6) + 0.4, 6],
    [20, heightA(20, 26) + 0.4, 26],
    deckEdge(RING[0], DECK.mid, 2.2, 3),
    deckEdge(MOTHER, DECK.mid, 0.8, 4),
    deckEdge(RING[5], DECK.high, 4.0, 3),
    [40, 1.3, -10],
    [-66, heightA(-66, 64) + 0.4, 64],
  ]
  return { trees, pods, huts, stiltHuts, bridges, columns, torches, canoes, reeds, bamboo, walkers }
}

export function CrownCityScene({ night, seed }: BlockoutSceneProps) {
  const layout = useMemo(() => buildLayout(seed), [seed])
  const hero = useMemo<BridgeSpec>(
    () => ({ a: deckEdge(RING[4], DECK.mid, towards(RING[4], MOTHER)), b: deckEdge(MOTHER, DECK.mid, towards(MOTHER, RING[4])), planks: 14, sag: 0.06 }),
    [],
  )
  return (
    <group>
      <Terrain spec={TERRAIN} />
      <WaterPlane level={WATER} night={night} />
      <River points={RIVER} height={heightA} width={9.5} night={night} hero />
      <Canopy trees={layout.trees} />
      <BigTrees trees={GIANTS} night={night} />
      <Huts huts={layout.pods} night={night} roof={P.jewel.canopy} />
      <Huts huts={layout.huts.falls} night={night} roof={P.jewel.falls} />
      <Huts huts={layout.huts.ruins} night={night} roof={P.jewel.ruins} />
      <Huts huts={layout.huts.riverworks} night={night} roof={P.jewel.riverworks} />
      <Huts huts={layout.stiltHuts} night={night} roof={P.jewel.lagoon} />
      <RopeBridges bridges={layout.bridges} night={night} />
      <SwayingBridge {...hero} night={night} />
      {PATHS.map((points, i) => (
        <Path key={i} points={points} width={2.8} height={heightA} closed={i === 0} />
      ))}
      <Stairs points={FALLS_STAIR} width={2.6} height={heightA} />
      <Boardwalk
        points={[
          [40, -12],
          [34, -22],
          [28, -30],
        ]}
        width={2.4}
        y={0.9}
        ground={-3}
      />
      <Boardwalk
        points={[
          [56, -22],
          [48, -30],
        ]}
        width={2.2}
        y={0.9}
        ground={-3}
      />
      <Canoes items={layout.canoes} y={WATER + 0.15} />
      <Reeds clumps={layout.reeds} y={WATER + 0.2} />
      <Bamboo clumps={layout.bamboo} height={heightA} />
      <RootGate x={ROOT_GATE[0]} y={heightA(ROOT_GATE[0], ROOT_GATE[1])} z={ROOT_GATE[1]} yaw={0.3} />
      <Slabs items={[[COURT[0], heightA(COURT[0], COURT[1]) - 0.9, COURT[1], 20, 1.1, 16]]} />
      <Columns items={layout.columns} />
      <Farms
        plots={[
          [66, 36, 12, 8, 0.2],
          [80, 32, 10, 8, 0.2],
          [72, 50, 14, 8, -0.1],
          [92, 46, 10, 7, 0.3],
        ]}
        height={heightA}
      />
      <DyeRacks
        racks={[
          [58, 30, 0.3],
          [62, 48, -0.2],
          [100, 38, 0.6],
        ]}
        height={heightA}
        color={P.jewel.riverworks}
      />
      <Wheel x={WHEEL_AT[0]} y={heightA(WHEEL_AT[0], WHEEL_AT[1]) + 3.4} z={WHEEL_AT[1]} radius={6} yaw={0.55} />
      <RootCrownShrine x={SHRINE_AT[0]} y={heightA(SHRINE_AT[0], SHRINE_AT[1])} z={SHRINE_AT[1]} night={night} />
      <GlowPoints points={layout.torches} night={night} />
      <Walkers items={layout.walkers} />
      <TriangleProbe />
    </group>
  )
}
