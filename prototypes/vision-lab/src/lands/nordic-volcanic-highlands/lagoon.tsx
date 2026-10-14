import { useMemo } from 'react'
import { Glow, Surf } from '../../render/materials'
import type { BlockoutSceneProps, Pose } from '../types'
import { HOUSE_COLORS, PALETTE, TERRAIN_COLORS, makeClassifier, makeSkyline } from './common'
import { type XZ, alongPolyline, bowl, buildHeightfield, cone, fbm, lerp, mulberry, polylineNearest, scatterDisc, shoulders, smoothstep } from './lib'
import { Bergs, DriftingShip, FishRacks, Fires, HotPools, type House, Instances, Longhouses, Longships, type Placement, Ribbon, Sheep, Skyline, StandingStones, StaveChurch, Terrain, TriangleReport, Water, puff, unitBox } from './parts'

/**
 * Direction B: Lagoon of the Stave Skerry. Water-led: a glacier calves into a round lagoon, a
 * stave church stands on a skerry at the end of a long causeway, longhouses crescent the black
 * beach, hot springs steam on the east shore. The volcano wears the glacier like a scarf.
 */

const HALF = 190
const L: XZ = [10, -20] // lagoon centre
const RX = 86
const RZ = 68
const V: XZ = [30, -175] // volcano summit
const CALDERA: XZ = [26, -158]
const SKERRY: XZ = [4, 8]
const GLACIER: XZ[] = [
  [-48, -170],
  [-42, -140],
  [-34, -112],
  [-22, -88],
]
const CANYON: XZ[] = [
  [-150, -70],
  [-112, -42],
  [-80, -18],
]
const OUTLET: XZ[] = [
  [-50, 18],
  [-58, 60],
  [-50, 110],
  [-46, 192],
]
const ISLETS: XZ[] = [
  [118, 122],
  [142, 142],
  [102, 154],
]
const CRAG: XZ = [140, -96]

/** Elliptical lagoon coordinate: 1 at the shoreline. */
function rho(x: number, z: number) {
  return Math.hypot((x - L[0]) / RX, (z - L[1]) / RZ)
}

/** A point on the lagoon's elliptical ring at bearing b (0 = east, 90 = south) and radial factor p. */
function ring(p: number, bearingDeg: number): XZ {
  const a = (bearingDeg * Math.PI) / 180
  return [L[0] + p * RX * Math.cos(a), L[1] + p * RZ * Math.sin(a)]
}

function ringYaw(bearingDeg: number) {
  const a = (bearingDeg * Math.PI) / 180
  return Math.atan2(RZ * Math.cos(a), -RX * Math.sin(a))
}

function sampleLagoon(x: number, z: number, seed: number) {
  const n = fbm(x, z, seed, 55)
  const detail = fbm(x, z, seed + 3, 12, 3)
  let tag = 'turf'

  // Moor rising to walls east and west, the volcano north.
  let h = 3 + 6.5 * n + 2 * detail
  h = Math.max(
    h,
    shoulders(x, z, [
      [-180, -64, 92, 56],
      [-184, 40, 84, 44],
      [-172, 132, 72, 30],
      [184, -44, 92, 52],
      [180, 52, 84, 40],
      [176, 124, 72, 28],
    ]),
    cone(x, z, V[0], V[1], 140, 108, 1.9),
    cone(x, z, 128, -170, 100, 46, 1.5),
    cone(x, z, -130, -150, 90, 52, 1.5),
  )
  h -= bowl(x, z, CALDERA[0], CALDERA[1], 22, 20)

  // Glacier valley: a trough down the volcano's flank, filled with stepped ice.
  const glacier = polylineNearest(x, z, GLACIER)
  const halfWidth = lerp(40, 24, glacier.t)
  if (glacier.d < halfWidth + 22) h -= 16 * (1 - glacier.t) * (1 - smoothstep(halfWidth, halfWidth + 22, glacier.d))
  if (glacier.d < halfWidth) {
    const surface = lerp(50, 15, Math.pow(glacier.t, 0.85)) + 3 * (fbm(x, z, seed + 21, 9, 2) - 0.5)
    const stepped = Math.floor(surface / 3) * 3 + 0.4 * detail
    h = Math.max(h, stepped)
    tag = 'ice'
  }

  // Landmark crag on the east headland and the geothermal sinter apron.
  const crag = Math.hypot(x - CRAG[0], z - CRAG[1])
  if (crag < 30) {
    h = Math.max(h, 10 + 24 * (1 - smoothstep(6, 26, crag)) + 2 * detail)
    tag = 'rock'
  }
  const sinter = Math.hypot((x - 100) / 1.3, z - 2)
  if (sinter < 22) {
    h = Math.max(h, 2.6 + 0.8 * detail)
    h = lerp(h, 2.6 + 0.8 * detail, 1 - smoothstep(14, 22, sinter))
    tag = 'sinter'
  }

  // The lagoon basin with its black beach, and the skerry inside it. The shoreline wanders.
  const p = rho(x, z) + 0.13 * (fbm(x, z, seed + 7, 48, 3) - 0.5)
  if (p < 1.35) {
    const beach = 1.6 + 1.2 * smoothstep(1.02, 1.35, p)
    const land = lerp(beach, h, smoothstep(1.08, 1.35, p))
    if (tag === 'ice') {
      h = lerp(-10, h, smoothstep(0.9, 0.97, p))
    } else {
      h = lerp(-10, land, smoothstep(0.86, 1.0, p))
      if (p < 1.12 && tag !== 'sinter') tag = 'sand'
    }
  }
  const sk = Math.hypot(x - SKERRY[0], z - SKERRY[1])
  if (sk < 18) {
    h = Math.max(h, 6 * (1 - smoothstep(9, 17, sk)) + 1.2 * detail)
    tag = 'rock'
  }

  // Meltwater canyon from the west highlands into the lagoon.
  const canyon = polylineNearest(x, z, CANYON)
  if (canyon.d < 9 && p > 0.95) h = lerp(-3, h, smoothstep(3.5, 9, canyon.d))

  // Outlet river to the sea, and the sea itself.
  const outlet = polylineNearest(x, z, OUTLET)
  if (outlet.d < 12 && p > 0.9) h = lerp(-3, h, smoothstep(4.5, 12, outlet.d))
  h -= 36 * smoothstep(132, 180, z)
  for (const islet of ISLETS) {
    const d = Math.hypot(x - islet[0], z - islet[1])
    if (d < 16) {
      h = Math.max(h, 7 * (1 - smoothstep(5, 15, d)) + 2 * detail)
      tag = d < 3 ? 'lava' : 'crust'
    }
  }
  return { h, tag }
}

const classify = makeClassifier({ snowLine: 68, ashLine: 40 })

function buildLagoon(seed: number) {
  const rng = mulberry(seed * 4201 + 5)
  const ground = (x: number, z: number) => sampleLagoon(x, z, seed).h
  const houses: House[] = []
  const fires: Placement[] = []
  const racks: Placement[] = []
  const posts: Placement[] = []
  let colorIndex = Math.floor(rng() * HOUSE_COLORS.length)

  // The crescent: longhouses along the south-east beach terrace, gable ends to the water.
  for (let b = 42; b <= 128; b += 8.6) {
    const bearing = b + (rng() - 0.5) * 3
    const [x, z] = ring(1.17 + (rng() - 0.5) * 0.03, bearing)
    houses.push({ x, z, y: ground(x, z), yaw: ringYaw(bearing) + (rng() - 0.5) * 0.2, length: 12 + rng() * 5, width: 6.4, wall: 2.6, roof: 3.6, color: HOUSE_COLORS[colorIndex++ % HOUSE_COLORS.length] })
  }
  // Second, looser row behind.
  for (let b = 52; b <= 120; b += 15) {
    const bearing = b + (rng() - 0.5) * 5
    const [x, z] = ring(1.3, bearing)
    houses.push({ x, z, y: ground(x, z), yaw: ringYaw(bearing) + Math.PI / 2 + (rng() - 0.5) * 0.4, length: 10 + rng() * 4, width: 6, wall: 2.5, roof: 3.3, color: HOUSE_COLORS[colorIndex++ % HOUSE_COLORS.length] })
  }
  // Boat sheds at the water line, longships hauled up between them.
  const ships = [] as Array<{ x: number; y: number; z: number; yaw: number; length: number; sail: string | null }>
  for (const b of [66, 82, 98, 114]) {
    const [x, z] = ring(1.07, b)
    houses.push({ x, z, y: ground(x, z), yaw: ringYaw(b) + Math.PI / 2, length: 10, width: 5, wall: 2.2, roof: 2.8, color: b === 82 ? PALETTE.ochre : PALETTE.darkTimber })
    const [sx, sz] = ring(1.035, b + 5)
    ships.push({ x: sx, y: ground(sx, sz) - 0.4, z: sz, yaw: ringYaw(b + 5) + Math.PI / 2, length: 15 + rng() * 3, sail: null })
  }
  ships.push({ ...(() => {
    const [x, z] = ring(0.9, 100)
    return { x, z }
  })(), y: 0, yaw: ringYaw(100) + 0.3, length: 18, sail: PALETTE.red })
  ships.push({ ...(() => {
    const [x, z] = ring(0.86, 62)
    return { x, z }
  })(), y: 0, yaw: ringYaw(62) - 0.2, length: 16, sail: PALETTE.cream })
  for (const b of [58, 74, 90, 106, 122]) {
    const [x, z] = ring(1.11, b)
    racks.push({ x, y: ground(x, z), z, yaw: ringYaw(b) + Math.PI / 2, sx: 7, sy: 2.8 })
  }
  for (const b of [70, 110]) {
    const [x, z] = ring(1.1, b)
    fires.push({ x, y: ground(x, z) + 0.4, z, sx: 0.7, sy: 0.6, sz: 0.7 })
  }

  // Causeway from the beach to the skerry: posts under a plank deck.
  const head = ring(1.02, 92)
  const causeway: XZ[] = [head, [SKERRY[0] + 1, SKERRY[1] + 16]]
  for (const p of alongPolyline(causeway, 4, 0, 0)) {
    for (const side of [-1.6, 1.6]) {
      posts.push({ x: p.x + Math.sin(p.yaw) * side, y: -2, z: p.z + Math.cos(p.yaw) * side, sx: 0.6, sy: 3.6, sz: 0.6 })
    }
  }
  fires.push({ x: SKERRY[0] - 6, y: 6.6, z: SKERRY[1] + 9, sx: 0.8, sy: 0.7, sz: 0.8 })

  // Hot springs on the east shore: pools, a bathhouse, a steam tripod, static plumes.
  const pools = [
    { x: 94, z: -14, r: 4 },
    { x: 104, z: -2, r: 3 },
    { x: 90, z: 2, r: 2.6 },
    { x: 108, z: 10, r: 3.6 },
    { x: 96, z: 14, r: 2.2 },
  ].map((p) => ({ ...p, y: 2.7 }))
  houses.push({ x: 112, z: -14, y: 2.7, yaw: 0.3, length: 12, width: 6.5, wall: 2.6, roof: 3.6, color: PALETTE.cream })
  houses.push({ x: 84, z: 20, y: ground(84, 20), yaw: -0.6, length: 9, width: 5.5, wall: 2.4, roof: 3.2, color: PALETTE.red })
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    posts.push({ x: 100 + Math.cos(a) * 4, y: 2.7, z: -8 + Math.sin(a) * 4, yaw: -a, roll: 0.26, sx: 0.5, sy: 14, sz: 0.5 })
  }
  const plumes: Placement[] = pools.flatMap((p) =>
    [0, 1].map((k) => {
      const s = 0.9 + k * 0.7 + rng() * 0.4
      return { x: p.x + (rng() - 0.5) * 1.5 * k, y: p.y + 1.6 + k * 2.6, z: p.z + (rng() - 0.5) * 1.5 * k, sx: s, sy: s * 0.8, sz: s }
    }),
  )
  plumes.push({ x: CALDERA[0], y: 78, z: CALDERA[1], sx: 6, sy: 4.5, sz: 6 }, { x: CALDERA[0] + 3, y: 86, z: CALDERA[1] - 2, sx: 8, sy: 6, sz: 8 })

  // Highland hamlet on the south-west moor with pasture walls and a flock.
  const hamlet: XZ = [-84, 74]
  for (const [x, z] of scatterDisc(rng, hamlet[0], hamlet[1], 24, 7, 12)) {
    houses.push({ x, z, y: ground(x, z), yaw: rng() * Math.PI, length: 11 + rng() * 5, width: 6, wall: 2.5, roof: 3.4, color: HOUSE_COLORS[colorIndex++ % HOUSE_COLORS.length] })
  }
  fires.push({ x: hamlet[0], y: ground(hamlet[0], hamlet[1]) + 0.4, z: hamlet[1], sx: 0.7, sy: 0.6, sz: 0.7 })
  const flock: Placement[] = scatterDisc(rng, -60, 110, 32, 40, 3.2, (x, z) => rho(x, z) > 1.4 && polylineNearest(x, z, OUTLET).d > 16).map(([x, z]) => ({ x, y: ground(x, z), z, yaw: rng() * Math.PI, sx: 1.1, sy: 0.7, sz: 0.6 }))
  const wall: Placement[] = alongPolyline(
    [
      [-120, 96],
      [-100, 84],
      [-78, 96],
      [-66, 118],
      [-90, 134],
      [-116, 124],
    ],
    4.2,
    0,
    2,
  ).map((p) => ({ x: p.x, y: ground(p.x, p.z) - 0.2, z: p.z, yaw: p.yaw, sx: 4.4, sy: 1.3, sz: 0.7 }))

  // Forge and gantry at the meltwater canyon.
  houses.push({ x: -108, z: -56, y: ground(-108, -56), yaw: 0.4, length: 13, width: 6.5, wall: 2.8, roof: 3.4, color: PALETTE.darkTimber })
  fires.push({ x: -101, y: ground(-101, -58) + 0.4, z: -58, sx: 0.8, sy: 0.7, sz: 0.8 })

  // Landmark crag: cairn ring and beacon mast.
  const stones: Placement[] = []
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    stones.push({ x: CRAG[0] + Math.cos(a) * 6, y: ground(CRAG[0] + Math.cos(a) * 6, CRAG[1] + Math.sin(a) * 6) - 0.3, z: CRAG[1] + Math.sin(a) * 6, yaw: a, sx: 1.2, sy: 2.2 + rng(), sz: 0.9 })
  }
  posts.push({ x: CRAG[0], y: ground(CRAG[0], CRAG[1]), z: CRAG[1], sx: 0.9, sy: 14, sz: 0.9 })
  fires.push({ x: CRAG[0], y: ground(CRAG[0], CRAG[1]) + 14.6, z: CRAG[1], sx: 1.1, sy: 1, sz: 1.1 })
  fires.push({ x: ISLETS[1][0] + 4, y: 8, z: ISLETS[1][1] - 3, sx: 0.7, sy: 0.6, sz: 0.7 })

  // Bergs: calved ice drifting across the lagoon, biggest near the glacier front.
  const bergs: Placement[] = []
  const nearCauseway = (x: number, z: number) => Math.abs(x - SKERRY[0]) < 7 && z > SKERRY[1] && z < 60
  for (const [x, z] of scatterDisc(rng, L[0], L[1], RX, 40, 7, (x, z) => rho(x, z) < 0.84 && Math.hypot(x - SKERRY[0], z - SKERRY[1]) > 24 && !nearCauseway(x, z))) {
    const toward = 1 - smoothstep(10, 120, Math.hypot(x - GLACIER[3][0], z - GLACIER[3][1]))
    const s = 1.8 + rng() * 2.6 + toward * 6
    bergs.push({ x, y: -s * 0.35, z, yaw: rng() * Math.PI, pitch: (rng() - 0.5) * 0.3, sx: s * (0.8 + rng() * 0.6), sy: s * 0.8, sz: s })
  }

  // Paths: the shore lane along the crescent, lanes to the springs, hamlet, crag and canyon.
  const shoreLane: XZ[] = []
  for (let b = 30; b <= 136; b += 6) shoreLane.push(ring(1.13, b))
  const springsLane: XZ[] = [ring(1.13, 30), [92, -6], [104, 4]]
  const hamletLane: XZ[] = [ring(1.13, 136), [-40, 72], [-70, 70], hamlet]
  const cragLane: XZ[] = [[112, -20], [128, -56], CRAG]
  const canyonLane: XZ[] = [ring(1.13, 136), [-40, 40], [-60, 10], [-86, -24], [-100, -44]]
  const riverBridge: XZ[] = [
    [-46, 70],
    [-70, 70],
  ]
  const skyline = makeSkyline(seed, 196, 352, 17, 252)

  return { houses, fires, racks, posts, ships, pools, plumes, flock, wall, stones, bergs, causeway, shoreLane, springsLane, hamletLane, cragLane, canyonLane, riverBridge, skyline, ground }
}

export function LagoonScene({ night, seed }: BlockoutSceneProps) {
  const field = useMemo(() => buildHeightfield({ half: HALF, cells: 136, seed, dropBelow: -1.5, sample: (x, z) => sampleLagoon(x, z, seed), classify }), [seed])
  const built = useMemo(() => buildLagoon(seed), [seed])
  const deck = useMemo(() => () => 1.6, [])
  const bridgeDeck = useMemo(() => {
    const ground = built.ground
    return (x: number, z: number) => Math.max(ground(x, z) + 0.3, 3.2 * (1 - smoothstep(-50, -47, x)) * smoothstep(-69, -66, x))
  }, [built])
  return (
    <group>
      <Terrain field={field} colors={TERRAIN_COLORS} night={night} lavaColor={PALETTE.lavaGlow} />
      <Water y={0} color={PALETTE.lagoon} />
      <Skyline near={built.skyline.near} far={built.skyline.far} nearColor={PALETTE.skylineNear} farColor={PALETTE.skylineFar} />
      <Ribbon points={built.riverBridge} width={3.4} heightAt={bridgeDeck} color={PALETTE.plank} lift={0} step={2} smooth={0} />
      <Ribbon points={built.shoreLane} width={3.2} heightAt={built.ground} color={PALETTE.road} smooth={1} />
      <Ribbon points={built.springsLane} width={3} heightAt={built.ground} color={PALETTE.road} />
      <Ribbon points={built.hamletLane} width={3} heightAt={built.ground} color={PALETTE.road} />
      <Ribbon points={built.cragLane} width={2.6} heightAt={built.ground} color={PALETTE.road} />
      <Ribbon points={built.canyonLane} width={3} heightAt={built.ground} color={PALETTE.road} />
      <Ribbon points={built.causeway} width={4} heightAt={deck} color={PALETTE.plank} lift={0} step={2} smooth={0} />
      <StaveChurch x={SKERRY[0]} y={6.2} z={SKERRY[1]} yaw={-Math.PI / 2} night={night} />
      <Longhouses houses={built.houses} night={night} />
      <StandingStones stones={built.posts} color={PALETTE.plank} />
      <StandingStones stones={built.stones} />
      <StandingStones stones={built.wall} color="#6a6b66" />
      <FishRacks racks={built.racks} />
      <Sheep flock={built.flock} />
      <HotPools pools={built.pools} night={night} />
      <Instances placements={built.plumes} geometry={puff()} castShadow={false}>
        <Surf color="#eef2f3" transparent opacity={0.55} />
      </Instances>
      <Fires fires={built.fires} night={night} />
      <Longships ships={built.ships} />
      <DriftingShip cx={30} cz={-30} rx={38} rz={26} y={0} length={18} sail={PALETTE.red} period={140} />
      <Bergs bergs={built.bergs} />
      {/* Gantry over the canyon slit. */}
      <mesh geometry={unitBox()} position={[-104, built.ground(-104, -36) + 1.4, -36]} rotation={[0, -0.6, 0]} scale={[18, 0.7, 3]} castShadow>
        <Surf color={PALETTE.plank} />
      </mesh>
      {/* Lava lake in the caldera notch. */}
      <mesh position={[CALDERA[0], 75.5, CALDERA[1]]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[8, 10]} />
        <Glow color={PALETTE.lavaGlow} on={night} intensity={1.6} offColor={PALETTE.lava} />
      </mesh>
      <TriangleReport label="lagoon" />
    </group>
  )
}

export const lagoonPoses: readonly Pose[] = [
  { id: 'hero', position: [156, 54, 176], target: [-8, 2, -42], fov: 34 },
  { id: 'walk', position: [34.9, 3.6, 48.6], target: [4, 10, 8], fov: 46 },
  { id: 'overview', position: [12, 228, 300], target: [10, 0, -24], fov: 36 },
  { id: 'reverse', position: [-40, 70, -118], target: [26, -6, 40], fov: 36 },
]
