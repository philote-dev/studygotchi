import { useMemo } from 'react'
import { Glow, Surf } from '../../render/materials'
import type { BlockoutSceneProps, Pose } from '../types'
import { HOUSE_COLORS, PALETTE, TERRAIN_COLORS, makeClassifier, makeSkyline } from './common'
import { type XZ, alongPolyline, bowl, buildHeightfield, cone, fbm, lerp, mulberry, polar, polylineNearest, scatterDisc, shoulders, smoothstep } from './lib'
import { BasaltColumns, FishRacks, Fires, GreatHall, HotPools, type House, Longhouses, Longships, type Placement, Ribbon, Sheep, Skyline, StandingStones, Steam, Terrain, TriangleReport, Water, unitBox } from './parts'

/**
 * Direction A: Hall of a Thousand Steps. A fjord citadel: four basalt terraces climb the east
 * bank from the quay to a great hall, one straight stair bores up the middle of them, and the
 * volcano shoulders the whole thing from behind. Vertical dynamics.
 */

const HALF = 190
const C: XZ = [116, -28] // citadel centre: the terraces are arcs around it
const V: XZ = [100, -178] // volcano summit
const CALDERA: XZ = [94, -168]
/** Outer radius and shelf height of each tier, plateau first. The riser below tier i spans r..r+RISER. */
const TIERS = [
  { r: 26, y: 38 },
  { r: 50, y: 29 },
  { r: 74, y: 20 },
  { r: 98, y: 11 },
] as const
const RISER = 4
const QUAY_Y = 2.4
const STAIR_BEARING = 160
const LAVA_FLOW: XZ[] = [
  [92, -164],
  [78, -140],
  [60, -118],
  [46, -100],
  [30, -88],
  [4, -84],
]
const CANYON: XZ[] = [
  [-170, -74],
  [-130, -56],
  [-98, -42],
]
const ISLETS: XZ[] = [
  [62, 150],
  [86, 166],
  [44, 176],
]

function fjordCentre(z: number) {
  return -18 + 16 * Math.sin((z + 30) / 95)
}
function fjordHalfWidth(z: number) {
  return 24 + 16 * smoothstep(70, 180, z)
}
function fjordEastEdge(z: number) {
  return fjordCentre(z) + fjordHalfWidth(z)
}

/** Shelf/riser profile by radius; the stair corridor uses a long riser so the steps can climb it. */
function terraceHeight(r: number, riser = RISER) {
  let terrace = QUAY_Y
  for (let i = TIERS.length - 1; i >= 0; i--) {
    const tier = TIERS[i]
    const below = i === TIERS.length - 1 ? QUAY_Y : TIERS[i + 1].y
    if (r < tier.r + riser) terrace = lerp(tier.y, below, smoothstep(tier.r, tier.r + riser, r))
  }
  return terrace
}

const STAIR_RISER = 11
const STAIR_HALF_WIDTH = 3.2
const STAIR_DIR: XZ = [Math.cos((STAIR_BEARING * Math.PI) / 180), Math.sin((STAIR_BEARING * Math.PI) / 180)]

/** Distance along the stair axis from C and perpendicular distance from it. */
function stairFrame(x: number, z: number) {
  const vx = x - C[0]
  const vz = z - C[1]
  return { along: vx * STAIR_DIR[0] + vz * STAIR_DIR[1], perp: Math.abs(vx * STAIR_DIR[1] - vz * STAIR_DIR[0]) }
}

function sampleCitadel(x: number, z: number, seed: number) {
  const n = fbm(x, z, seed, 60)
  const detail = fbm(x, z, seed + 3, 14, 3)
  let tag = 'turf'

  // Low plain around the citadel, rolling moor further out, mountain walls west and north.
  const rc = Math.hypot(x - C[0], z - C[1])
  const moorAmp = smoothstep(104, 150, rc)
  const moor = 2.5 + (1.5 + 6 * n + 2.5 * detail) * moorAmp
  let h = Math.max(
    moor,
    shoulders(x, z, [
      [-186, -24, 92, 46],
      [-182, 84, 80, 34],
      [-172, -124, 96, 54],
      [-96, -188, 100, 62],
      [-16, -192, 90, 52],
    ]),
  )

  // The citadel: terraced arcs around C, edges eroded by noise, a black-sand quay ring at the foot.
  // Along the stair bearing a straight corridor replaces the short risers with long ramps.
  const r = rc + 6 * (fbm(x, z, seed + 11, 30) - 0.5)
  const stair = stairFrame(x, z)
  if (r < TIERS[TIERS.length - 1].r + RISER || (stair.along > 0 && stair.along < 116 && stair.perp < STAIR_HALF_WIDTH + 2)) {
    const corridor = stair.along > 0 ? 1 - smoothstep(STAIR_HALF_WIDTH, STAIR_HALF_WIDTH + 2, stair.perp) : 0
    h = lerp(terraceHeight(Math.min(r, 115)), terraceHeight(stair.along, STAIR_RISER), corridor)
    if (r > TIERS[TIERS.length - 1].r + RISER) tag = 'sand'
  } else if (r < 116) {
    h = lerp(QUAY_Y, moor, smoothstep(102, 116, r))
    tag = 'sand'
  }

  // Volcano and the spur ridge that ties the plateau to its flank.
  h = Math.max(h, cone(x, z, V[0], V[1], 175, 105, 1.7))
  const spur = polylineNearest(x, z, [C, [108, -120]])
  h = Math.max(h, lerp(38, 56, spur.t) * (1 - smoothstep(12, 36, spur.d)))

  // Caldera notch facing the camera, with a frozen flow running down to the fjord.
  h -= bowl(x, z, CALDERA[0], CALDERA[1], 24, 20)
  const flow = polylineNearest(x, z, LAVA_FLOW)
  if (flow.d < 5.5 && flow.t < 0.985) {
    h += 1.6 * (1 - smoothstep(2.5, 5.5, flow.d))
    tag = flow.d < 1.3 ? 'lava' : 'crust'
  }

  // Basalt canyon on the west moor: a water-floored slit with a forge beside it.
  const canyon = polylineNearest(x, z, CANYON)
  if (canyon.d < 9) h = lerp(-3, h, smoothstep(3.5, 9, canyon.d))

  // The fjord (gentle west bank, cliffed east bank) and the open sea to the south.
  const edge = Math.abs(x - fjordCentre(z)) - fjordHalfWidth(z)
  const bank = x < fjordCentre(z) ? 24 : 7
  if (edge < bank) h = lerp(-9, h, smoothstep(0, bank, edge))
  h -= 36 * smoothstep(138, 185, z)
  for (const islet of ISLETS) {
    const d = Math.hypot(x - islet[0], z - islet[1])
    if (d < 16) {
      h = Math.max(h, 7 * (1 - smoothstep(5, 15, d)) + 2 * detail)
      tag = d < 3 ? 'lava' : 'crust'
    }
  }
  return { h, tag }
}

const classify = makeClassifier({ snowLine: 72, ashLine: 44 })

function yawToward(bearingDeg: number) {
  return -((bearingDeg * Math.PI) / 180)
}

function shelfRadius(tierIndex: number) {
  return (TIERS[tierIndex - 1].r + RISER + TIERS[tierIndex].r) / 2
}

function buildCitadel(seed: number) {
  const rng = mulberry(seed * 7919 + 17)
  const ground = (x: number, z: number) => sampleCitadel(x, z, seed).h
  const houses: House[] = []
  const fires: Placement[] = []
  const stones: Placement[] = []
  const racks: Placement[] = []
  const posts: Placement[] = []

  // Terrace rows: tiers 1..3 hold longhouse rows; the stair bearing is kept clear.
  const rows = [
    { tier: 1, from: 102, to: 222, step: 24, length: [12, 15], width: 6.4 },
    { tier: 2, from: 94, to: 230, step: 17, length: [12, 16], width: 6.6 },
    { tier: 3, from: 90, to: 234, step: 14, length: [11, 15], width: 6.2 },
  ]
  let colorIndex = Math.floor(rng() * HOUSE_COLORS.length)
  for (const row of rows) {
    const tier = TIERS[row.tier]
    const radius = shelfRadius(row.tier) + 1
    for (let b = row.from; b <= row.to; b += row.step) {
      if (Math.abs(b - STAIR_BEARING) < row.step * 0.75) continue
      const bearing = b + (rng() - 0.5) * 6
      const [x, z] = polar(C[0], C[1], radius + (rng() - 0.5) * 3, bearing)
      houses.push({
        x,
        z,
        y: tier.y,
        yaw: yawToward(bearing + 90 + (rng() - 0.5) * 14),
        length: lerp(row.length[0], row.length[1], rng()),
        width: row.width,
        wall: 2.6,
        roof: 3.6,
        color: HOUSE_COLORS[colorIndex++ % HOUSE_COLORS.length],
      })
    }
  }

  // Plateau: flanking halls either side of the great hall.
  for (const bearing of [62, 258]) {
    const [x, z] = polar(C[0], C[1], 15, bearing)
    houses.push({ x, z, y: TIERS[0].y, yaw: yawToward(bearing + 90), length: 16, width: 7, wall: 3, roof: 4.4, color: PALETTE.darkTimber })
  }

  // Quay: boathouses gable-on to the water, racks, braziers.
  for (const bearing of [150, 171, 192, 208]) {
    const [x, z] = polar(C[0], C[1], 106, bearing)
    houses.push({ x, z, y: QUAY_Y, yaw: yawToward(bearing), length: 9, width: 5, wall: 2.2, roof: 2.8, color: bearing === 171 ? PALETTE.ochre : PALETTE.darkTimber })
  }
  for (const bearing of [157, 164, 180, 186, 200]) {
    const [x, z] = polar(C[0], C[1], 103, bearing)
    racks.push({ x, y: QUAY_Y, z, yaw: yawToward(bearing + 90), sx: 7, sy: 2.8 })
  }

  // Þing ring where the stair crosses tier 1's shelf, and braziers at each landing.
  const ring = polar(C[0], C[1], shelfRadius(1), STAIR_BEARING)
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2
    stones.push({ x: ring[0] + Math.cos(a) * 7.5, y: TIERS[1].y, z: ring[1] + Math.sin(a) * 7.5, yaw: a, sx: 1.4, sy: 3 + rng() * 1.4, sz: 0.9, roll: (rng() - 0.5) * 0.12 })
  }
  for (const [radius, y] of [
    [104, QUAY_Y],
    [shelfRadius(3) + 2, TIERS[3].y],
    [shelfRadius(2) + 2, TIERS[2].y],
    [shelfRadius(1) + 2, TIERS[1].y],
  ] as const) {
    for (const side of [-1, 1]) {
      const [x, z] = polar(C[0], C[1], radius, STAIR_BEARING + side * (radius > 60 ? 4 : 6))
      fires.push({ x, y: y + 0.4, z, sx: 0.6, sy: 0.55, sz: 0.6 })
    }
  }
  const forecourt = polar(C[0], C[1], 23, STAIR_BEARING)
  fires.push({ x: forecourt[0], y: TIERS[0].y + 0.4, z: forecourt[1], sx: 1, sy: 0.9, sz: 1 })

  // Beacon mast at the plateau's south lip (the course landmark's slot).
  const beacon = polar(C[0], C[1], 23, 112)
  posts.push({ x: beacon[0], y: TIERS[0].y, z: beacon[1], sx: 0.9, sy: 15, sz: 0.9 })
  fires.push({ x: beacon[0], y: TIERS[0].y + 15.6, z: beacon[1], sx: 1.1, sy: 1, sz: 1.1 })

  // West bank hamlet, pasture walls, sheep.
  const hamlet: XZ = [-78, 16]
  for (const [x, z] of scatterDisc(rng, hamlet[0], hamlet[1], 24, 7, 12)) {
    houses.push({ x, z, y: ground(x, z), yaw: rng() * Math.PI, length: 11 + rng() * 5, width: 6, wall: 2.5, roof: 3.4, color: HOUSE_COLORS[colorIndex++ % HOUSE_COLORS.length] })
  }
  fires.push({ x: hamlet[0], y: ground(hamlet[0], hamlet[1]) + 0.4, z: hamlet[1], sx: 0.7, sy: 0.6, sz: 0.7 })
  const flock: Placement[] = scatterDisc(rng, -96, 54, 30, 42, 3.2, (x, z) => Math.abs(x - fjordCentre(z)) > fjordHalfWidth(z) + 24).map(([x, z]) => ({ x, y: ground(x, z), z, yaw: rng() * Math.PI, sx: 1.1, sy: 0.7, sz: 0.6 }))
  const wall: Placement[] = alongPolyline(
    [
      [-118, 30],
      [-100, 24],
      [-82, 38],
      [-74, 56],
      [-94, 72],
      [-118, 62],
    ],
    4.2,
    0,
    2,
  ).map((p) => ({ x: p.x, y: ground(p.x, p.z) - 0.2, z: p.z, yaw: p.yaw, sx: 4.4, sy: 1.3, sz: 0.7 }))

  // Forge by the canyon.
  houses.push({ x: -112, z: -30, y: ground(-112, -30), yaw: yawToward(20), length: 13, width: 6.5, wall: 2.8, roof: 3.4, color: PALETTE.darkTimber })
  fires.push({ x: -105, y: ground(-105, -33) + 0.4, z: -33, sx: 0.8, sy: 0.7, sz: 0.8 })

  // Islet beacon.
  fires.push({ x: ISLETS[1][0] + 4, y: 8, z: ISLETS[1][1] - 3, sx: 0.7, sy: 0.6, sz: 0.7 })

  // Bridge of basalt columns across the fjord at z = -6, deck at y 7.
  const columns: Placement[] = []
  for (let x = -58; x <= 8; x += 2.6) {
    for (const dz of [-1.5, 1.5]) {
      columns.push({ x, y: -9.5, z: -6 + dz, yaw: rng() * 0.5, sx: 1.25, sy: 16.2 + (rng() - 0.5) * 0.4, sz: 1.25 })
    }
  }
  // Natural organ pipes along the east bank cliffs north of the bridge.
  for (let z = -16; z > -72; z -= 2.4) {
    const ex = fjordEastEdge(z) + 1.2
    for (let k = 0; k < 2; k++) {
      columns.push({ x: ex + k * 2.3 + (rng() - 0.5), y: -2, z: z + (rng() - 0.5) * 1.2, yaw: rng(), sx: 1.2, sy: 4 + rng() * 6 + k * 1.5, sz: 1.2 })
    }
  }

  // Hot pools on the geothermal shelf of tier 2 (south arc), a steam tripod, the caldera fumarole.
  const pools = [
    { b: 100, r: 3.4 },
    { b: 109, r: 2.6 },
    { b: 117, r: 3.8 },
  ].map(({ b, r }) => {
    const [x, z] = polar(C[0], C[1], shelfRadius(2) + (rng() - 0.5) * 6, b)
    return { x, y: TIERS[2].y, z, r }
  })
  const vents = [...pools.map((p) => ({ x: p.x, y: p.y, z: p.z, scale: 0.7 })), { x: CALDERA[0], y: 74, z: CALDERA[1], scale: 2.6 }]
  const tripodBase = polar(C[0], C[1], shelfRadius(2) - 4, 108)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    posts.push({ x: tripodBase[0] + Math.cos(a) * 4, y: TIERS[2].y, z: tripodBase[1] + Math.sin(a) * 4, yaw: -a, roll: 0.26, sx: 0.5, sy: 14, sz: 0.5 })
  }

  // Longships moored along the quay and one far out at the mouth.
  const ships = [
    { x: fjordEastEdge(-34) - 5, y: 0, z: -34, yaw: Math.PI / 2 + 0.1, length: 17, sail: PALETTE.red },
    { x: fjordEastEdge(-12) - 4.5, y: 0, z: -12, yaw: Math.PI / 2 - 0.05, length: 15, sail: null },
    { x: fjordEastEdge(10) - 6, y: 0, z: 10, yaw: Math.PI / 2 + 0.2, length: 18, sail: PALETTE.cream },
    { x: -2, y: 0, z: 96, yaw: -0.35, length: 19, sail: PALETTE.red },
  ]

  // The thousand steps: pale blocks climbing every corridor ramp, plus a ribbon over the shelves.
  const steps: Placement[] = []
  for (let i = 0; i < TIERS.length; i++) {
    const tier = TIERS[i]
    const below = i === TIERS.length - 1 ? QUAY_Y : TIERS[i + 1].y
    const count = Math.round((tier.y - below) / 0.55)
    for (let k = 0; k <= count; k++) {
      const along = tier.r + STAIR_RISER * (1 - k / count)
      const [x, z] = polar(C[0], C[1], along, STAIR_BEARING)
      steps.push({ x, y: terraceHeight(along, STAIR_RISER) - 0.5, z, yaw: yawToward(STAIR_BEARING), sx: 1.5, sy: 0.8, sz: STAIR_HALF_WIDTH * 2 })
    }
  }
  const stair: XZ[] = []
  for (let r = 112; r >= 14; r -= 4) stair.push(polar(C[0], C[1], r, STAIR_BEARING))
  const stairGround = (x: number, z: number) => terraceHeight(stairFrame(x, z).along, STAIR_RISER)
  const lanes: XZ[][] = [1, 2, 3].map((i) => {
    const radius = shelfRadius(i) - 6
    const pts: XZ[] = []
    for (let b = 92; b <= 232; b += 6) pts.push(polar(C[0], C[1], radius, b))
    return pts
  })
  const quayWalk: XZ[] = []
  for (let z = 18; z >= -62; z -= 8) quayWalk.push([fjordEastEdge(z) - 1, z])
  const hamletLane: XZ[] = [hamlet, [-66, 2], [-62, -6]]
  const forgeLane: XZ[] = [hamlet, [-96, -8], [-110, -26]]

  const skyline = makeSkyline(seed, 196, 352, 17, 252)

  return { houses, fires, stones, racks, posts, flock, wall, columns, pools, vents, ships, steps, stair, stairGround, lanes, quayWalk, hamletLane, forgeLane, skyline, ground }
}

export function CitadelScene({ night, seed }: BlockoutSceneProps) {
  const field = useMemo(() => buildHeightfield({ half: HALF, cells: 136, seed, dropBelow: -1.5, sample: (x, z) => sampleCitadel(x, z, seed), classify }), [seed])
  const built = useMemo(() => buildCitadel(seed), [seed])
  const deck = useMemo(() => {
    const ground = built.ground
    return (x: number, z: number) => Math.max(7 * (1 - smoothstep(6, 18, x)) * (1 - smoothstep(-58, -66, x)), ground(x, z) + 0.2)
  }, [built])
  const quayLevel = useMemo(() => () => QUAY_Y + 0.3, [])
  const hall = polar(C[0], C[1], 3, STAIR_BEARING)
  const bridgePoints = useMemo<XZ[]>(
    () => [
      [-68, -6],
      [18, -6],
    ],
    [],
  )
  return (
    <group>
      <Terrain field={field} colors={TERRAIN_COLORS} night={night} lavaColor={PALETTE.lavaGlow} />
      <Water y={0} color={PALETTE.water} />
      <Skyline near={built.skyline.near} far={built.skyline.far} nearColor={PALETTE.skylineNear} farColor={PALETTE.skylineFar} />
      <Ribbon points={built.stair} width={STAIR_HALF_WIDTH * 2} heightAt={built.stairGround} color="#a89c86" lift={0.3} step={2} smooth={0} />
      <StandingStones stones={built.steps} color="#b9ad96" />
      {built.lanes.map((lane, i) => (
        <Ribbon key={i} points={lane} width={3} heightAt={built.ground} color={PALETTE.road} lift={0.3} step={3} smooth={1} />
      ))}
      <Ribbon points={built.quayWalk} width={5} heightAt={quayLevel} color={PALETTE.plank} lift={0} smooth={1} />
      <Ribbon points={built.hamletLane} width={3} heightAt={built.ground} color={PALETTE.road} />
      <Ribbon points={built.forgeLane} width={3} heightAt={built.ground} color={PALETTE.road} />
      <Ribbon points={bridgePoints} width={5} heightAt={deck} color={PALETTE.plank} lift={0} step={2} smooth={0} />
      <BasaltColumns columns={built.columns} />
      <Longhouses houses={built.houses} night={night} />
      <GreatHall x={hall[0]} y={TIERS[0].y} z={hall[1]} yaw={yawToward(STAIR_BEARING)} length={36} roof={10} night={night} />
      <StandingStones stones={built.stones} />
      <StandingStones stones={built.wall} color="#6a6b66" />
      <StandingStones stones={built.posts} color={PALETTE.plank} />
      <FishRacks racks={built.racks} />
      <Sheep flock={built.flock} />
      <HotPools pools={built.pools} night={night} />
      <Steam vents={built.vents} />
      <Fires fires={built.fires} night={night} />
      <Longships ships={built.ships} />
      {/* Gantry over the canyon slit. */}
      <mesh geometry={unitBox()} position={[-128, built.ground(-128, -55) + 1.4, -55]} rotation={[0, 0.5, 0]} scale={[18, 0.7, 3]} castShadow>
        <Surf color={PALETTE.plank} />
      </mesh>
      {/* Lava lake in the caldera notch. */}
      <mesh position={[CALDERA[0], 74.2, CALDERA[1]]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[9, 10]} />
        <Glow color={PALETTE.lavaGlow} on={night} intensity={1.6} offColor={PALETTE.lava} />
      </mesh>
      <TriangleReport label="citadel" />
    </group>
  )
}

export const citadelPoses: readonly Pose[] = [
  { id: 'hero', position: [-14, 62, 198], target: [96, 12, -36], fov: 34 },
  { id: 'walk', position: [27, 13.2, -29.6], target: [-30, 2, -2], fov: 48 },
  { id: 'overview', position: [-6, 226, 296], target: [16, 8, -22], fov: 36 },
  { id: 'reverse', position: [150, 95, -120], target: [20, 0, 60], fov: 36 },
]
