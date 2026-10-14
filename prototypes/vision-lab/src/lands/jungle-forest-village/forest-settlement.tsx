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
  Galleries,
  GlowPoints,
  Huts,
  Path,
  Reeds,
  River,
  RootCrownShrine,
  RootGate,
  RopeBridges,
  Slabs,
  Smoke,
  Stairs,
  Terrain,
  TriangleProbe,
  TrunkTowers,
  Walkers,
  WaterPlane,
  Wheel,
  bigTreeDeckRadius,
  towerTop,
  type BigTree,
  type BridgeSpec,
  type GallerySpec,
  type Hut,
  type TowerSpec,
} from './kit'
import { makeHeight, makeLip, makeTerrain, openGround, WATER, type LandSpec } from './land'
import { mulberry, Noise, polylineDistance, range, ring, smoothPath, type V2, type V3 } from './lib'
import { P } from './palette'

/**
 * Direction C, "Forest Settlement": reference 04's settlement scale, kept wood and open. A civic
 * core of trunk towers and covered galleries under giant trunks, clusters of chimney houses in and
 * between broad clearings, the ruin court, the lagoon at the east side, the fall in the north.
 */
const noise = new Noise(67)
const LAGOON = { x: 96, z: 16, rx: 28, rz: 22, depth: 3.2 }
const SHRINE_AT: V2 = [118, 44]
const RIVER: V2[] = [
  [22, -300],
  [22, -160],
  [22, -112],
  [20, -80],
  [26, -50],
  [40, -22],
  [60, -2],
  [80, 10],
  [96, 16],
  [130, 30],
  [200, 50],
  [300, 70],
]
const RIVERS = [smoothPath(RIVER, 4)]
const FIREFLY = { x: -4, z: 46, rx: 26, rz: 16 }
const SUNBREAK = { x: 62, z: 44, rx: 20, rz: 14 }
const LAND: LandSpec = {
  noise,
  lip: makeLip(noise, -110),
  plateau: 18,
  shelf: false,
  rivers: RIVERS,
  riverDepth: 2.6,
  lagoons: [LAGOON],
  clearings: [FIREFLY, SUNBREAK, { x: -84, z: -60, rx: 18, rz: 14 }],
  knobs: [[SHRINE_AT[0], SHRINE_AT[1], 15, 5]],
}
export const heightC = makeHeight(LAND)

const TOWERS: TowerSpec[] = [
  { x: -17, z: -10, floors: 4, radius: 6, roof: P.jewel.canopy, crown: 13 },
  { x: 15, z: -15, floors: 3, radius: 5.4, roof: P.jewel.canopy, crown: 12 },
  { x: 19, z: 13, floors: 4, radius: 5.6, roof: P.jewel.canopy, crown: 12 },
  { x: -13, z: 17, floors: 3, radius: 5.2, roof: P.jewel.canopy, crown: 11 },
  { x: -60, z: -36, floors: 3, radius: 4.8, roof: P.jewel.ruins, crown: 11 },
  { x: 48, z: -44, floors: 3, radius: 4.8, roof: P.jewel.falls, crown: 11 },
].map((t) => ({ ...t, y: heightC(t.x, t.z) - 0.2 }))

const g = (x: number, z: number, h: number, r: number, crown: number, decks: number[] = [], ladder = false): BigTree => ({ x, y: heightC(x, z) - 0.3, z, h, r, crown, decks, ladder })
const MOTHER: BigTree = { ...g(-2, -40, 32, 3.4, 16, [6, 11.5, 18]), deckScale: 1.35 }
const GIANTS: BigTree[] = [
  MOTHER,
  g(-46, -4, 40, 3.6, 17),
  g(44, 10, 42, 3.8, 18),
  g(-30, 76, 38, 3.4, 16, [6], true),
  g(36, 74, 40, 3.5, 16),
  g(-78, 24, 36, 3.2, 15, [6], true),
  g(70, -24, 38, 3.4, 16),
  g(-60, -84, 42, 3.8, 17),
  g(90, 60, 36, 3.2, 15),
  g(-104, 60, 40, 3.5, 16),
  g(24, -70, 36, 3.2, 15, [6], true),
]
const ROOT_GATE: V2 = [-66, 48]
const COURT: V2 = [-74, 66]
const WHEEL_AT: V2 = [70, 4]

const stone = (x: number, z: number) => Math.abs(x - COURT[0]) < 10 && Math.abs(z - COURT[1]) < 8
const TERRAIN = makeTerrain(LAND, heightC, stone)

const PATHS: V2[][] = [
  ring(1, 0, 30, 28, 20),
  [
    [0, 28],
    [-6, 46],
    [-30, 56],
    [-56, 50],
    [-70, 60],
  ],
  [
    [28, 10],
    [48, 24],
    [62, 42],
    [74, 60],
  ],
  [
    [30, -8],
    [52, -10],
    [70, -4],
    [86, 2],
  ],
  [
    [-28, -12],
    [-50, -22],
    [-72, -50],
    [-84, -60],
  ],
  [
    [0, -28],
    [12, -60],
    [20, -84],
    [30, -100],
  ],
  [
    [-20, 30],
    [-48, 36],
    [-78, 28],
    [-100, 50],
  ],
]
const FALLS_STAIR: V2[] = [
  [40, -96],
  [44, -108],
  [44, -118],
  [42, -128],
]

interface Layout {
  trees: ReturnType<typeof forest>
  pods: Hut[]
  houses: Hut[]
  huts: Record<'falls' | 'ruins' | 'riverworks' | 'market', Hut[]>
  stiltHuts: Hut[]
  bridges: BridgeSpec[]
  galleries: GallerySpec[]
  columns: { x: number; y: number; z: number; h: number }[]
  torches: V3[]
  chimneys: V3[]
  canoes: V2[]
  reeds: V2[]
  bamboo: V2[]
  walkers: V3[]
}

function deckEdge(tree: BigTree, deck: number, angle: number, inset = 1.4): V3 {
  const R = bigTreeDeckRadius(tree) - inset
  return [tree.x + Math.cos(angle) * R, tree.y + deck + 0.3, tree.z + Math.sin(angle) * R]
}

function towerEdge(tower: TowerSpec, floor: number, angle: number): V3 {
  const fh = tower.floorHeight ?? 4.2
  const R = tower.radius * (1 - floor * 0.07) - 0.4
  return [tower.x + Math.cos(angle) * R, tower.y + floor * fh + 0.5, tower.z + Math.sin(angle) * R]
}

function buildLayout(seed: number): Layout {
  const rng = mulberry(seed * 6151 + 11)
  const accept = (x: number, z: number): number => {
    if (openGround(LAND, heightC, x, z) === 0) return 0
    if (GIANTS.some((t) => Math.hypot(x - t.x, z - t.z) < Math.max(10, bigTreeDeckRadius(t) + 2))) return 0
    if (TOWERS.some((t) => Math.hypot(x - t.x, z - t.z) < t.radius + 6)) return 0
    for (const path of PATHS) if (polylineDistance(x, z, path).d < 3.5) return 0
    if (Math.hypot(x - SHRINE_AT[0], z - SHRINE_AT[1]) < 14) return 0
    if (Math.hypot(x - ROOT_GATE[0], z - ROOT_GATE[1]) < 10 || Math.hypot(x - COURT[0], z - COURT[1]) < 14) return 0
    if (Math.hypot(x, z) < 42) return 0
    if (Math.hypot(x, z) < 100) return noise.fbm(x / 30 + 20, z / 30 + 20) > 0.3 ? 0.4 : 0.06
    if (Math.hypot(x, z) > 165) return 0.92
    return noise.fbm(x / 34 + 20, z / 34 + 20) > 0.46 ? 0.1 : 0.8
  }
  const trees = forest({ seed, height: heightC, accept, emergentChance: 0.06 })

  const pods: Hut[] = []
  for (const tree of GIANTS) {
    const R = bigTreeDeckRadius(tree)
    for (const d of tree.decks ?? []) {
      const count = tree === MOTHER ? 3 : 2
      for (let k = 0; k < count; k++) {
        const a = rng() * Math.PI * 2
        pods.push({ x: tree.x + Math.cos(a) * R * 0.55, y: tree.y + d + 0.5, z: tree.z + Math.sin(a) * R * 0.55, yaw: -a, w: 3.6, d: 3.4, h: 2.8, pod: rng() < 0.6 })
      }
    }
  }
  const hutAt = (x: number, z: number, yaw: number, w = 5.4, d = 4.8, h = 3.3): Hut => ({ x, y: heightC(x, z) - 0.15, z, yaw, w, d, h })
  // House clusters around the core (ref 04 scale), spaced off the paths and towers.
  const houses: Hut[] = []
  const clusters: [number, number, number][] = [
    [-40, -40, 7],
    [-52, 10, 6],
    [34, -32, 6],
    [56, 22, 5],
    [10, 70, 6],
    [-30, 28, 5],
    [-96, -10, 4],
    [88, -40, 4],
  ]
  for (const [cx, cz, count] of clusters) {
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + rng()
      const r = 8 + rng() * 10
      const x = cx + Math.cos(a) * r
      const z = cz + Math.sin(a) * r * 0.8
      if (openGround(LAND, heightC, x, z) === 0) continue
      if (GIANTS.some((t) => Math.hypot(x - t.x, z - t.z) < t.r * 2.5)) continue
      if (TOWERS.some((t) => Math.hypot(x - t.x, z - t.z) < t.radius + 3)) continue
      houses.push(hutAt(x, z, rng() * Math.PI, range(rng, 4.6, 6.4), range(rng, 4.2, 5.4), range(rng, 3, 3.8)))
    }
  }
  const huts: Layout['huts'] = {
    market: ring(1, 0, 20, 18, 7).map(([x, z], i) => hutAt(x, z, i * 0.9, 4.2, 3.6, 2.6)),
    falls: [
      [40, -130, 0.2, 4.4, 4, 2.8],
      [48, -134, -0.3, 4.4, 4, 2.8],
      [6, -130, 0.4, 4.4, 4, 2.8],
      [0, -136, -0.2, 4.4, 4, 2.8],
      [38, -98, 0.3, 4.4, 4, 2.8],
    ].map(([x, z, yaw, w, d, h]) => hutAt(x, z, yaw, w, d, h)),
    ruins: [
      [-56, 60, 0.3],
      [-62, 78, -0.4],
      [-86, 52, 0.5],
      [-90, 78, 0.1, 7, 6, 4],
    ].map(([x, z, yaw, w, d, h]) => hutAt(x, z, yaw, w, d, h)),
    riverworks: [
      [58, 58, 0.2],
      [74, 54, -0.4],
      [50, 30, 0.6],
    ].map(([x, z, yaw]) => hutAt(x, z, yaw)),
  }
  const stiltHuts: Hut[] = [{ x: 100, y: 1.1, z: 22, yaw: -0.3, w: 18, d: 9, h: 4.2, ground: -3.2 }]
  for (const [x, z] of [
    [76, 8],
    [82, 30],
    [112, 2],
    [120, 20],
    [92, 38],
  ]) stiltHuts.push({ x, y: 1.1, z, yaw: Math.atan2(LAGOON.x - x, LAGOON.z - z) + range(rng, -0.4, 0.4), w: range(rng, 4.4, 5.4), d: range(rng, 4, 5), h: 3.1, ground: Math.min(heightC(x, z), 0.4) })

  const galleries: GallerySpec[] = []
  const ringOrder = [0, 1, 2, 3]
  for (let i = 0; i < 4; i++) {
    const a = TOWERS[ringOrder[i]]
    const b = TOWERS[ringOrder[(i + 1) % 4]]
    const ang = Math.atan2(b.z - a.z, b.x - a.x)
    galleries.push({ a: towerEdge(a, 2, ang), b: towerEdge(b, 2, ang + Math.PI) })
  }
  galleries.push({ a: towerEdge(TOWERS[0], 2, Math.atan2(MOTHER.z - TOWERS[0].z, MOTHER.x - TOWERS[0].x)), b: deckEdge(MOTHER, 11.5, Math.atan2(TOWERS[0].z - MOTHER.z, TOWERS[0].x - MOTHER.x)) })
  const bridges: BridgeSpec[] = [
    { a: [8, 18.6, -126], b: [35, 18.6, -123], planks: 14, sag: 0.05 },
    { a: deckEdge(MOTHER, 18, Math.atan2(TOWERS[1].z - MOTHER.z, TOWERS[1].x - MOTHER.x)), b: [TOWERS[1].x, towerTop(TOWERS[1]) + 0.2, TOWERS[1].z], planks: 12, sag: 0.06 },
    { a: deckEdge(GIANTS[3], 6, Math.atan2(TOWERS[3].z - GIANTS[3].z, TOWERS[3].x - GIANTS[3].x)), b: towerEdge(TOWERS[3], 1, Math.atan2(GIANTS[3].z - TOWERS[3].z, GIANTS[3].x - TOWERS[3].x)), planks: 22, sag: 0.05 },
  ]

  const columns: Layout['columns'] = []
  for (let i = 0; i < 4; i++) {
    for (const dz of [-6, 6]) {
      const x = COURT[0] - 7.5 + i * 5
      columns.push({ x, y: heightC(x, COURT[1] + dz) - 0.2, z: COURT[1] + dz, h: rng() < 0.4 ? range(rng, 2, 4) : 6.5 })
    }
  }
  const torches: V3[] = ring(1, 0, 26, 24, 12).map(([x, z]) => [x, heightC(x, z) + 2.4, z])
  for (const [x, z] of [
    [-70, 56],
    [-78, 76],
    [40, -128],
    [50, -134],
    [60, 50],
    [-8, 40],
  ]) torches.push([x, heightC(x, z) + 2.4, z])
  const chimneys: V3[] = []
  for (const hut of [...houses, ...huts.market].filter((_, i) => i % 3 === 0)) chimneys.push([hut.x + hut.w * 0.28, hut.y + hut.h * 1.75, hut.z - hut.d * 0.2])
  for (const t of TOWERS.slice(0, 4)) chimneys.push([t.x + 2, towerTop(t) + 2, t.z - 2])
  const canoes: V2[] = [
    [92, 10],
    [104, 28],
    [86, 24],
    [108, 8],
  ]
  const reeds = ring(LAGOON.x, LAGOON.z, LAGOON.rx * 0.97, LAGOON.rz * 0.97, 16).filter((_, i) => i % 4 !== 1)
  const bamboo: V2[] = [
    [70, 20],
    [112, -8],
    [26, -96],
    [-20, 60],
    [48, 60],
    [-90, 40],
  ]
  const walkers: V3[] = [
    [1, heightC(1, 0) + 0.4, 0],
    [8, heightC(8, 6) + 0.4, 6],
    [-10, heightC(-10, -4) + 0.4, -4],
    [-6, heightC(-6, 46) + 0.4, 46],
    [60, heightC(60, 44) + 0.4, 44],
    [-70, heightC(-70, 62) + 0.4, 62],
    deckEdge(MOTHER, 11.5, 2.4, 3.5),
    [96, 1.3, 36],
    [36, heightC(36, -130) + 0.4, -130],
  ]
  return { trees, pods, houses, huts, stiltHuts, bridges, galleries, columns, torches, chimneys, canoes, reeds, bamboo, walkers }
}

export function ForestSettlementScene({ night, seed }: BlockoutSceneProps) {
  const layout = useMemo(() => buildLayout(seed), [seed])
  return (
    <group>
      <Terrain spec={TERRAIN} />
      <WaterPlane level={WATER} night={night} />
      <River points={RIVER} height={heightC} width={9.5} night={night} />
      <Canopy trees={layout.trees} />
      <BigTrees trees={GIANTS} night={night} />
      <TrunkTowers towers={TOWERS} night={night} />
      <Galleries items={layout.galleries} height={heightC} />
      <Huts huts={layout.pods} night={night} roof={P.jewel.canopy} />
      <Huts huts={layout.houses} night={night} roof={P.thatch} />
      <Huts huts={layout.huts.market} night={night} roof={P.jewel.canopy} />
      <Huts huts={layout.huts.falls} night={night} roof={P.jewel.falls} />
      <Huts huts={layout.huts.ruins} night={night} roof={P.jewel.ruins} />
      <Huts huts={layout.huts.riverworks} night={night} roof={P.jewel.riverworks} />
      <Huts huts={layout.stiltHuts} night={night} roof={P.jewel.lagoon} />
      <RopeBridges bridges={layout.bridges} night={night} />
      {PATHS.map((points, i) => (
        <Path key={i} points={points} width={2.8} height={heightC} closed={i === 0} />
      ))}
      <Stairs points={FALLS_STAIR} width={2.6} height={heightC} />
      <Boardwalk
        points={[
          [80, 36],
          [90, 30],
          [98, 24],
        ]}
        width={2.4}
        y={1.0}
        ground={-3}
      />
      <Boardwalk
        points={[
          [118, 40],
          [116, 30],
        ]}
        width={2.4}
        y={1.0}
        ground={-3}
      />
      <Canoes items={layout.canoes} y={WATER + 0.15} />
      <Reeds clumps={layout.reeds} y={WATER + 0.2} />
      <Bamboo clumps={layout.bamboo} height={heightC} />
      <RootGate x={ROOT_GATE[0]} y={heightC(ROOT_GATE[0], ROOT_GATE[1])} z={ROOT_GATE[1]} yaw={0.4} />
      <Slabs items={[[COURT[0], heightC(COURT[0], COURT[1]) - 0.9, COURT[1], 20, 1.1, 16]]} />
      <Columns items={layout.columns} />
      <Farms
        plots={[
          [-14, 44, 14, 8, 0.1],
          [4, 50, 12, 8, 0.1],
          [-6, 36, 10, 6, 0.1],
          [62, 40, 14, 8, 0.2],
          [70, 50, 10, 7, 0.2],
          [54, 50, 10, 7, 0.2],
        ]}
        height={heightC}
      />
      <DyeRacks
        racks={[
          [50, 38, 0.3],
          [76, 42, -0.2],
          [12, 40, 0.6],
        ]}
        height={heightC}
        color={P.jewel.riverworks}
      />
      <Wheel x={WHEEL_AT[0]} y={heightC(WHEEL_AT[0], WHEEL_AT[1]) + 3.4} z={WHEEL_AT[1]} radius={6} yaw={0.5} />
      <RootCrownShrine x={SHRINE_AT[0]} y={heightC(SHRINE_AT[0], SHRINE_AT[1])} z={SHRINE_AT[1]} night={night} />
      <GlowPoints points={layout.torches} night={night} />
      <Smoke chimneys={layout.chimneys} />
      <Walkers items={layout.walkers} />
      <TriangleProbe />
    </group>
  )
}
