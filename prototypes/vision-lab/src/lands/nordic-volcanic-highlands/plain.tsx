import { useMemo } from 'react'
import { Glow, Surf } from '../../render/materials'
import type { BlockoutSceneProps, Pose } from '../types'
import { HOUSE_COLORS, PALETTE, TERRAIN_COLORS, makeClassifier, makeSkyline } from './common'
import { type XZ, alongPolyline, bowl, buildHeightfield, cone, fbm, lerp, mulberry, polar, polylineNearest, scatterDisc, shoulders, smoothstep } from './lib'
import { BasaltColumns, FishRacks, Fires, HotPools, type House, Instances, Longhouses, Longships, type Placement, RingFort, Ribbon, Sheep, Skyline, StandingStones, Steam, Terrain, TriangleReport, Water, halfPipe, unitBox } from './parts'

/**
 * Direction C: Ring Fort of the Black Plain. Sprawling: a Trelleborg-style ring fort on a low
 * rise in a black-sand plain, roads radiating to a harbour of racks and halls, a geyser field,
 * lava-tube storehouses and a quarry canyon. Breadth and rhythm instead of height.
 */

const HALF = 190
const F: XZ = [0, -10] // ring fort centre
const FORT_R = 48
const FORT_Y = 8.4
const V: XZ = [-96, -170] // volcano summit
const CALDERA: XZ = [-88, -154]
const LAVA_FLOW: XZ[] = [
  [-86, -150],
  [-72, -128],
  [-60, -110],
  [-50, -96],
  [-40, -84],
]
const LAVA_FIELD: XZ = [74, -108]
const GEYSERS: XZ = [110, -18]
const CRAG: XZ = [150, -94]
const CANYON: XZ[] = [
  [-170, -26],
  [-128, -42],
  [-96, -38],
]
const RIVER: XZ[] = [
  [14, -190],
  [22, -150],
  [34, -110],
  [60, -62],
  [66, -22],
  [60, 30],
  [52, 80],
  [42, 128],
  [40, 190],
]
const RIVER_BRAID: XZ[] = [
  [66, -22],
  [76, 10],
  [70, 50],
  [56, 86],
]

function samplePlain(x: number, z: number, seed: number) {
  const n = fbm(x, z, seed, 50)
  const moss = fbm(x, z, seed + 5, 18, 3)
  const detail = fbm(x, z, seed + 3, 12, 3)
  let tag = moss > 0.58 ? 'moss' : 'sand'

  // The plain: nearly flat black sand with moss hummocks, a low rise under the fort.
  const df = Math.hypot(x - F[0], z - F[1])
  let h = 3 + 2.4 * n + 0.6 * detail + 5 * (1 - smoothstep(44, 96, df))
  if (df < FORT_R + 9) {
    h = FORT_Y
    tag = 'turf'
  }

  // Edges: highlands north and east, the volcano north-west, the sea south.
  h = Math.max(
    h,
    shoulders(x, z, [
      [36, -192, 100, 50],
      [104, -188, 92, 44],
      [166, -164, 84, 38],
      [188, -60, 84, 36],
      [190, 44, 80, 30],
      [184, 116, 70, 22],
    ]),
    cone(x, z, V[0], V[1], 165, 88, 1.6),
    cone(x, z, -160, -112, 90, 44, 1.5),
    cone(x, z, -30, -178, 80, 40, 1.5),
  )
  h -= bowl(x, z, CALDERA[0], CALDERA[1], 20, 16)

  // Fresh flow from the caldera and the old lava field with its storehouses.
  const flow = polylineNearest(x, z, LAVA_FLOW)
  if (flow.d < 6) {
    h += 1.8 * (1 - smoothstep(3, 6, flow.d))
    tag = flow.d < 1.4 ? 'lava' : 'crust'
  }
  const field = Math.hypot(x - LAVA_FIELD[0], z - LAVA_FIELD[1])
  if (field < 46) {
    h += 2.6 * (1 - smoothstep(30, 46, field)) * (0.5 + fbm(x, z, seed + 9, 9, 2))
    tag = 'crust'
  }

  // Geyser field: a raised sinter apron with shallow terraces.
  const gey = Math.hypot((x - GEYSERS[0]) / 1.2, z - GEYSERS[1])
  if (gey < 26) {
    const apron = 4.6 + 0.8 * Math.floor(detail * 3) * (1 - smoothstep(8, 24, gey))
    h = lerp(h, apron, 1 - smoothstep(19, 26, gey))
    tag = 'sinter'
  }

  // Landmark crag.
  const crag = Math.hypot(x - CRAG[0], z - CRAG[1])
  if (crag < 28) {
    h = Math.max(h, 8 + 22 * (1 - smoothstep(6, 24, crag)) + 2 * detail)
    tag = 'rock'
  }

  // Quarry canyon west, braided river, the sea.
  const canyon = polylineNearest(x, z, CANYON)
  if (canyon.d < 10) h = lerp(-3, h, smoothstep(4, 10, canyon.d))
  const river = Math.min(polylineNearest(x, z, RIVER).d, polylineNearest(x, z, RIVER_BRAID).d)
  if (river < 9) h = lerp(-2.5, h, smoothstep(3.5, 9, river))
  h -= 36 * smoothstep(124, 172, z)
  return { h, tag }
}

const classify = makeClassifier({ snowLine: 60, ashLine: 30, shoreLine: 1.0 })
/** Pale gravel so the roads read against black sand. */
const PLAIN_ROAD = '#a39780'

function buildPlain(seed: number) {
  const rng = mulberry(seed * 3301 + 29)
  const ground = (x: number, z: number) => samplePlain(x, z, seed).h
  const houses: House[] = []
  const fires: Placement[] = []
  const stones: Placement[] = []
  const racks: Placement[] = []
  const posts: Placement[] = []
  let colorIndex = Math.floor(rng() * HOUSE_COLORS.length)

  // Inside the ring: four quadrants, each a square of four longhouses around a yard (Trelleborg).
  for (const bearing of [45, 135, 225, 315]) {
    const [qx, qz] = polar(F[0], F[1], 25, bearing)
    for (const [dx, dz, yaw] of [
      [0, -11, 0],
      [0, 11, 0],
      [-11, 0, Math.PI / 2],
      [11, 0, Math.PI / 2],
    ]) {
      houses.push({ x: qx + dx, z: qz + dz, y: FORT_Y, yaw: yaw + (rng() - 0.5) * 0.06, length: 15 + rng() * 2, width: 6.6, wall: 2.7, roof: 3.8, color: HOUSE_COLORS[colorIndex++ % HOUSE_COLORS.length] })
    }
  }
  // The law rock and great fire on the central mound; a stone ring around it.
  stones.push({ x: F[0] + 2, y: FORT_Y + 2.4, z: F[1] - 1, yaw: 0.4, roll: 0.12, sx: 1.6, sy: 6.5, sz: 2.6 })
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2
    stones.push({ x: F[0] + Math.cos(a) * 11, y: FORT_Y, z: F[1] + Math.sin(a) * 11, yaw: a, sx: 1.3, sy: 2.6 + rng() * 1.2, sz: 0.9 })
  }
  fires.push({ x: F[0] - 3, y: FORT_Y + 2.9, z: F[1] + 2, sx: 1.4, sy: 1.2, sz: 1.4 })
  for (const bearing of [0, 90, 180, 270]) {
    for (const side of [-1, 1]) {
      const [x, z] = polar(F[0], F[1], FORT_R - 7, bearing + side * 6)
      fires.push({ x, y: FORT_Y + 0.4, z, sx: 0.6, sy: 0.55, sz: 0.6 })
    }
  }

  // Harbour: two long halls parallel to the shore, boat sheds, a rack grid, a T-quay, longships.
  houses.push({ x: -16, z: 108, y: ground(-16, 108), yaw: 0.05, length: 26, width: 9, wall: 3.2, roof: 5, color: PALETTE.darkTimber })
  houses.push({ x: 18, z: 104, y: ground(18, 104), yaw: -0.08, length: 22, width: 8, wall: 3, roof: 4.6, color: PALETTE.red })
  for (const x of [-42, -32, -22]) houses.push({ x, z: 120, y: ground(x, 120), yaw: Math.PI / 2, length: 9, width: 5, wall: 2.2, roof: 2.8, color: x === -32 ? PALETTE.ochre : PALETTE.darkTimber })
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) racks.push({ x: 34 + i * 8, y: ground(34 + i * 8, 112 + j * 5), z: 112 + j * 5, yaw: 0, sx: 7, sy: 2.8 })
  const ships = [
    { x: -6, y: 0, z: 140, yaw: 0.1, length: 18, sail: PALETTE.red },
    { x: 6, y: 0, z: 146, yaw: -0.15, length: 16, sail: null },
    { x: -4, y: 0, z: 154, yaw: 0.3, length: 17, sail: PALETTE.cream },
    { x: 24, y: 0, z: 142, yaw: Math.PI / 2 + 0.1, length: 15, sail: null },
    { x: -30, y: ground(-30, 126) - 0.3, z: 126, yaw: Math.PI / 2, length: 15, sail: null },
    { x: 80, y: 0, z: 160, yaw: -0.6, length: 19, sail: PALETTE.red },
  ]
  fires.push({ x: -2, y: ground(-2, 112) + 0.4, z: 112, sx: 0.7, sy: 0.6, sz: 0.7 }, { x: 2, y: 1.6, z: 150, sx: 0.6, sy: 0.5, sz: 0.6 })
  for (const p of alongPolyline(
    [
      [0, 128],
      [0, 152],
    ],
    4,
    0,
    0,
  )) {
    for (const side of [-1.8, 1.8]) posts.push({ x: p.x + side, y: -2, z: p.z, sx: 0.6, sy: 3.8, sz: 0.6 })
  }

  // Standing-stone avenue down the south road.
  for (let z = 44; z <= 96; z += 9) {
    for (const side of [-1, 1]) stones.push({ x: side * 5.5 + (rng() - 0.5), y: ground(side * 5.5, z) - 0.2, z, yaw: (rng() - 0.5) * 0.4, roll: (rng() - 0.5) * 0.1, sx: 1.2, sy: 2.6 + rng() * 1.4, sz: 0.9 })
  }

  // Geyser field: pools, one true geyser, fumaroles, a bath shed.
  const pools = [
    { x: 100, z: -30, r: 4 },
    { x: 116, z: -22, r: 3 },
    { x: 106, z: -8, r: 3.4 },
    { x: 122, z: -6, r: 2.4 },
    { x: 96, z: -14, r: 2.2 },
    { x: 114, z: 4, r: 3 },
  ].map((p) => ({ ...p, y: 4.9 }))
  const vents = [
    { x: 110, y: 5.2, z: -18, scale: 1.1, geyser: true },
    ...pools.slice(0, 4).map((p) => ({ x: p.x, y: p.y, z: p.z, scale: 0.6 })),
    { x: CALDERA[0], y: 72, z: CALDERA[1], scale: 2.6 },
  ]
  houses.push({ x: 130, z: -30, y: ground(130, -30), yaw: 0.5, length: 10, width: 5.5, wall: 2.4, roof: 3.2, color: PALETTE.cream })
  fires.push({ x: 126, y: ground(126, -36) + 0.4, z: -36, sx: 0.6, sy: 0.5, sz: 0.6 })

  // Lava-tube storehouses: half-pipe mounds in two rows with lit doors.
  const mounds: Placement[] = []
  const doors: Placement[] = []
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 4; i++) {
      const x = LAVA_FIELD[0] - 24 + i * 16 + row * 6
      const z = LAVA_FIELD[1] - 10 + row * 20
      const y = ground(x, z) - 0.6
      mounds.push({ x, y, z, yaw: 0.2, sx: 13, sy: 4.4, sz: 3.6 })
      doors.push({ x: x + 6.4 * Math.cos(0.2), y: y + 0.4, z: z - 6.4 * Math.sin(0.2), yaw: 0.2, sx: 0.3, sy: 2.4, sz: 2.2 })
    }
  }
  fires.push({ x: LAVA_FIELD[0], y: ground(LAVA_FIELD[0], LAVA_FIELD[1]) + 0.4, z: LAVA_FIELD[1], sx: 0.7, sy: 0.6, sz: 0.7 })

  // Quarry canyon: basalt organ pipes along the north lip, forge, gantry.
  const columns: Placement[] = []
  for (const p of alongPolyline(CANYON, 2.4, -8, 1)) {
    for (let k = 0; k < 2; k++) {
      columns.push({ x: p.x - Math.sin(p.yaw) * k * 2.2, y: ground(p.x, p.z) - 6, z: p.z - Math.cos(p.yaw) * k * 2.2, yaw: rng(), sx: 1.15, sy: 8 + rng() * 5 + k * 2, sz: 1.15 })
    }
  }
  houses.push({ x: -112, z: -22, y: ground(-112, -22), yaw: 0.35, length: 13, width: 6.5, wall: 2.8, roof: 3.4, color: PALETTE.darkTimber })
  fires.push({ x: -105, y: ground(-105, -24) + 0.4, z: -24, sx: 0.8, sy: 0.7, sz: 0.8 })

  // Hamlet south-west, pasture north with walls and a flock.
  const hamlet: XZ = [-78, 62]
  for (const [x, z] of scatterDisc(rng, hamlet[0], hamlet[1], 24, 7, 12)) {
    houses.push({ x, z, y: ground(x, z), yaw: rng() * Math.PI, length: 11 + rng() * 5, width: 6, wall: 2.5, roof: 3.4, color: HOUSE_COLORS[colorIndex++ % HOUSE_COLORS.length] })
  }
  fires.push({ x: hamlet[0], y: ground(hamlet[0], hamlet[1]) + 0.4, z: hamlet[1], sx: 0.7, sy: 0.6, sz: 0.7 })
  const flock: Placement[] = scatterDisc(rng, -40, -90, 34, 44, 3.2, (x, z) => polylineNearest(x, z, LAVA_FLOW).d > 14).map(([x, z]) => ({ x, y: ground(x, z), z, yaw: rng() * Math.PI, sx: 1.1, sy: 0.7, sz: 0.6 }))
  const wall: Placement[] = alongPolyline(
    [
      [-80, -70],
      [-56, -118],
      [-18, -122],
      [-4, -92],
      [-30, -66],
    ],
    4.2,
    0,
    2,
  ).map((p) => ({ x: p.x, y: ground(p.x, p.z) - 0.2, z: p.z, yaw: p.yaw, sx: 4.4, sy: 1.3, sz: 0.7 }))

  // Landmark crag: cairn ring and beacon.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const x = CRAG[0] + Math.cos(a) * 6
    const z = CRAG[1] + Math.sin(a) * 6
    stones.push({ x, y: ground(x, z) - 0.3, z, yaw: a, sx: 1.2, sy: 2.2 + rng(), sz: 0.9 })
  }
  posts.push({ x: CRAG[0], y: ground(CRAG[0], CRAG[1]), z: CRAG[1], sx: 0.9, sy: 14, sz: 0.9 })
  fires.push({ x: CRAG[0], y: ground(CRAG[0], CRAG[1]) + 14.6, z: CRAG[1], sx: 1.1, sy: 1, sz: 1.1 })

  // Roads: four from the gates, a ring road, the harbour quay, the river bridge.
  const south: XZ[] = [[0, FORT_R - 2 + F[1]], [0, 70], [-4, 100], [0, 126]]
  const east: XZ[] = [[FORT_R - 2, F[1]], [64, -18], [84, -18], [100, -18]]
  const northEast: XZ[] = [[0, F[1] - FORT_R + 2], [18, -78], [44, -94], [LAVA_FIELD[0] - 10, LAVA_FIELD[1]]]
  const west: XZ[] = [[-(FORT_R - 2), F[1]], [-80, -14], [-106, -28]]
  const ringRoad: XZ[] = []
  for (let b = 0; b <= 360; b += 10) ringRoad.push(polar(F[0], F[1], FORT_R + 12, b))
  const hamletLane: XZ[] = [[-4, 100], [-40, 84], hamlet]
  const cragLane: XZ[] = [[100, -18], [130, -56], CRAG]
  const bridge: XZ[] = [[52, -18], [76, -18]]
  const skyline = makeSkyline(seed, 190, 350, 17, 256)

  return { houses, fires, stones, racks, posts, ships, pools, vents, mounds, doors, columns, flock, wall, roads: [south, east, northEast, west, hamletLane, cragLane], ringRoad, bridge, skyline, ground }
}

export function PlainScene({ night, seed }: BlockoutSceneProps) {
  const field = useMemo(() => buildHeightfield({ half: HALF, cells: 136, seed, dropBelow: -1.5, sample: (x, z) => samplePlain(x, z, seed), classify }), [seed])
  const built = useMemo(() => buildPlain(seed), [seed])
  const bridgeDeck = useMemo(() => {
    const ground = built.ground
    return (x: number, z: number) => Math.max(ground(x, z) + 0.3, 4.6 * (1 - smoothstep(72, 78, x)) * smoothstep(50, 56, x))
  }, [built])
  const quayLevel = useMemo(() => () => 1.8, [])
  const quay = useMemo<XZ[]>(
    () => [
      [0, 124],
      [0, 154],
    ],
    [],
  )
  const quayBar = useMemo<XZ[]>(
    () => [
      [-14, 152],
      [14, 152],
    ],
    [],
  )
  return (
    <group>
      <Terrain field={field} colors={TERRAIN_COLORS} night={night} lavaColor={PALETTE.lavaGlow} />
      <Water y={0} color={PALETTE.water} />
      <Skyline near={built.skyline.near} far={built.skyline.far} nearColor={PALETTE.skylineNear} farColor={PALETTE.skylineFar} />
      <RingFort x={F[0]} y={FORT_Y} z={F[1]} radius={FORT_R} />
      <mesh position={[F[0], FORT_Y, F[1]]} castShadow receiveShadow>
        <cylinderGeometry args={[9, 11, 2.6, 10]} />
        <Surf color={PALETTE.turf} />
      </mesh>
      {built.roads.map((road, i) => (
        <Ribbon key={i} points={road} width={3.6} heightAt={built.ground} color={PLAIN_ROAD} lift={0.4} />
      ))}
      <Ribbon points={built.ringRoad} width={3} heightAt={built.ground} color={PLAIN_ROAD} lift={0.4} smooth={1} />
      <Ribbon points={built.bridge} width={4} heightAt={bridgeDeck} color={PALETTE.plank} lift={0} step={2} smooth={0} />
      <Ribbon points={quay} width={4.4} heightAt={quayLevel} color={PALETTE.plank} lift={0} step={2} smooth={0} />
      <Ribbon points={quayBar} width={4.4} heightAt={quayLevel} color={PALETTE.plank} lift={0} step={2} smooth={0} />
      <Longhouses houses={built.houses} night={night} />
      <Instances placements={built.mounds} geometry={halfPipe()} receiveShadow>
        <Surf color={PALETTE.turfRoof} />
      </Instances>
      <Instances placements={built.doors} geometry={unitBox()} castShadow={false}>
        <Glow color={PALETTE.window} on={night} intensity={1.8} offColor="#8a6a4a" />
      </Instances>
      <StandingStones stones={built.stones} />
      <StandingStones stones={built.wall} color="#6a6b66" />
      <StandingStones stones={built.posts} color={PALETTE.plank} />
      <BasaltColumns columns={built.columns} />
      <FishRacks racks={built.racks} />
      <Sheep flock={built.flock} />
      <HotPools pools={built.pools} night={night} />
      <Steam vents={built.vents} />
      <Fires fires={built.fires} night={night} />
      <Longships ships={built.ships} />
      {/* Gantry over the quarry canyon. */}
      <mesh geometry={unitBox()} position={[-120, built.ground(-120, -40) + 1.4, -40]} rotation={[0, 1.2, 0]} scale={[18, 0.7, 3]} castShadow>
        <Surf color={PALETTE.plank} />
      </mesh>
      {/* Lava lake in the caldera notch. */}
      <mesh position={[CALDERA[0], 71.5, CALDERA[1]]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[7, 10]} />
        <Glow color={PALETTE.lavaGlow} on={night} intensity={1.6} offColor={PALETTE.lava} />
      </mesh>
      <TriangleReport label="plain" />
    </group>
  )
}

export const plainPoses: readonly Pose[] = [
  { id: 'hero', position: [84, 78, 238], target: [-14, -4, -18], fov: 34 },
  { id: 'walk', position: [0, 10.6, 34], target: [6, 12, -30], fov: 48 },
  { id: 'overview', position: [4, 232, 300], target: [4, 0, -12], fov: 36 },
  { id: 'reverse', position: [-124, 84, -140], target: [20, -14, 64], fov: 36 },
]
