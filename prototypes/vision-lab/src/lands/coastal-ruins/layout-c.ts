/**
 * Direction C — Aqueduct Bay (sprawling).
 * A 300 m crescent bay: a harbour with a long mole in the middle, the town climbing gentle
 * terraces behind it, an aqueduct marching eleven arches down from the east ridge into a
 * castellum tower above the blue cistern court, olive terraces and windmills on the east slopes,
 * and the acropolis on the west headland — a long stoa and the archive-beacon over a drowned
 * forum at the cliff foot. One civilisation along one shore.
 */
import {
  Bag,
  archiveBeacon,
  boat,
  chapel,
  colonnade,
  columnRing,
  contourPath,
  crates,
  cypress,
  distanceToPolyline,
  distanceToPolylines,
  footprint,
  house,
  houseSlot,
  lampPost,
  olive,
  polyWall,
  ribbon,
  samplePolyline,
  scatter,
  tent,
  terraceWall,
  windmill,
  yawToward,
  zigzag,
  type Point,
} from './bag'
import { buildHeightfield, type HeightFn } from './heightfield'
import { coastClassify, finish, patchwork, type Layout, type Windmill } from './layout'
import { DEG, fbm, lerp, mulberry32, range, smoothstep, terrace } from './rng'

const ACRO = { x: -108, z: -14, y: 36 }
const RIDGE = { x: 112, z: -78 }
const AGORA = { x: -62, z: 4 }
const CISTERN = { x: -8, z: -46 }
const QUAY = { x0: -34, x1: 26, z0: 8, z1: 24 }
const CHANNEL_Y = 38
const BAY_FOCUS: Point = [0, 70]
const STEP = 3.6

/** East–west contour across a slope that rises northward: bisection along z for each x. */
function contourX(height: HeightFn, level: number, x0: number, x1: number, steps: number, zLo: number, zHi: number, inset: number): Point[] {
  const points: Point[] = []
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps
    const f = (z: number) => height(x, z) - level
    let lo = zLo
    let hi = zHi
    let flo = f(lo)
    if (flo * f(hi) > 0) continue
    for (let k = 0; k < 20; k++) {
      const mid = (lo + hi) / 2
      const fm = f(mid)
      if (fm < 0 === flo < 0) {
        lo = mid
        flo = fm
      } else hi = mid
    }
    points.push([x, (lo + hi) / 2 + inset])
  }
  return points
}

/** The town's stair-street from the quay up to the cistern court; fixed across seeds. */
export function stairPathC(): Point[] {
  return zigzag([2, 6], [CISTERN.x - 1, CISTERN.z + 10], 5, 5)
}

/** Terrain only (cheap): shared by the layout and the pose table. */
export function terrainC(seed: number) {
  // A true crescent: the headlands reach 60 m further south than the inner bay.
  const shoreAt = (x: number) => 14 + 62 * (x / 130) ** 2 + (fbm(x * 0.01 + 5, 0.7, seed, 3) - 0.5) * 16

  const raw = (x: number, z: number): number => {
    const d = shoreAt(x) - z
    const dl = Math.max(0, d)
    // The town climbs 15 m in its first 70 m (four terraces), then the plain rises slowly inland.
    let hLand = 1.5 + 14 * smoothstep(0, 70, dl) + 0.06 * dl + 0.0003 * dl * dl
    const ax = x - ACRO.x
    const az = z - ACRO.z
    hLand += 16 * smoothstep(56, 12, Math.hypot(ax, az * (az > 0 ? 2 : 1.1)))
    hLand += 14 * smoothstep(72, 14, Math.hypot((x - RIDGE.x) * 0.85, z - RIDGE.z))
    // Backdrop range along the north with a broken crest.
    hLand += 26 * smoothstep(-96, -160, z) * (0.45 + 1.1 * fbm(x * 0.018 + 1, z * 0.018 + 8, seed + 3, 3))
    let sea = -1.4 - 11 * smoothstep(0, 42, -d) - 1.5 * fbm(x * 0.03, z * 0.03, seed + 5, 2)
    sea = Math.max(sea, -1.3 - 6 * smoothstep(0, 12, Math.hypot(x + 62, z - 32) - 14))
    let h = lerp(sea, hLand, smoothstep(-4, 3, d))
    if (h > 2 && h < 40) h = 2 + terrace(h - 2, STEP, 0.78)
    return h
  }
  const snap = (h: number) => 2 + Math.floor((h - 2) / STEP) * STEP
  const agoraY = Math.max(2, snap(raw(AGORA.x, AGORA.z)))
  const cisternY = Math.max(2, snap(raw(CISTERN.x, CISTERN.z)))
  const height = (x: number, z: number): number => {
    let h = raw(x, z)
    h = lerp(h, ACRO.y, smoothstep(27, 19, Math.hypot(x - ACRO.x, (z - ACRO.z) * 1.3)))
    h = lerp(h, agoraY, smoothstep(17, 12, Math.hypot(x - AGORA.x, z - AGORA.z)))
    h = lerp(h, cisternY, smoothstep(13, 9, Math.hypot(x - CISTERN.x, z - CISTERN.z)))
    const qd = Math.max(Math.abs(x - (QUAY.x0 + QUAY.x1) / 2) - (QUAY.x1 - QUAY.x0) / 2, Math.abs(z - (QUAY.z0 + QUAY.z1) / 2) - (QUAY.z1 - QUAY.z0) / 2)
    h = Math.max(h, 2 - 10 * smoothstep(0, 4, qd))
    const edge = Math.hypot(x, z) + (fbm(x * 0.015 + 9, z * 0.015 + 2, seed + 11, 2) - 0.5) * 34
    return lerp(-12, h, smoothstep(214, 176, edge))
  }
  return { height, agoraY, cisternY }
}

export function layoutC(seed: number): Layout {
  const rng = mulberry32(seed * 7919 + 303)
  const { height, agoraY, cisternY } = terrainC(seed)
  const zone = (x: number, z: number, y: number) => {
    if (Math.hypot(x - ACRO.x, (z - ACRO.z) * 1.3) < 19) return 'plaza' as const
    if (Math.hypot(x - AGORA.x, z - AGORA.z) < 12) return 'plaza' as const
    if (y < 0 && Math.hypot(x + 62, z - 32) < 13) return 'floor' as const
    // Farmland patchwork on the open plain, outside the town and the two hills.
    const inTownRect = x > -62 && x < 72 && z > -84 && z < 14
    if (y > 2.5 && y < 27 && !inTownRect && Math.hypot(x - ACRO.x, z - ACRO.z) > 40) return patchwork(x, z, seed)
    return null
  }
  const field = buildHeightfield(height, coastClassify(zone, 30), 480, 184)

  const bag = new Bag()
  const avoid: Point[][] = []

  // Aqueduct line is reserved before anything else is placed.
  const aqFrom: Point = [126, -88]
  const aqTo: Point = [CISTERN.x + 5, CISTERN.z + 2]
  avoid.push([aqFrom, aqTo])

  // Town stair from the quay to the cistern, contour lanes across the terraces.
  const townStair = stairPathC()
  ribbon(bag, townStair, height, { width: 3.4, spacing: 1.3, color: 'stair' })
  avoid.push(townStair)
  for (const level of [5.6, 9.2, 12.8, 16.4]) {
    const path = contourX(height, level - 0.3, -56, 66, 48, -80, 22, -1.6)
    if (path.length > 6) {
      ribbon(bag, path, height, { width: 2.4, spacing: 2.5, color: 'lane' })
      avoid.push(path)
    }
  }

  // Acropolis stair from the agora up the east flank of the headland.
  const acroStair = zigzag([AGORA.x - 10, AGORA.z - 2], [ACRO.x + 17, ACRO.z + 2], 4, 6)
  ribbon(bag, acroStair, height, { width: 3.2, spacing: 1.3, color: 'stair' })
  avoid.push(acroStair)

  // Harbour: quay wall, warehouses, mole with its chapel, lamps, boats.
  polyWall(bag, [[QUAY.x0, QUAY.z1 + 0.5], [QUAY.x1, QUAY.z1 + 0.5]], -2, 4.3, 2.2, 'ruin')
  polyWall(bag, [[QUAY.x1, QUAY.z1 + 0.5], [QUAY.x1, QUAY.z0]], -2, 4.3, 2.2, 'ruin')
  const mole: Point[] = [[QUAY.x1, QUAY.z1], [40, 34], [50, 48], [54, 62]]
  polyWall(bag, mole, -3.5, 5.5, 4, 'ruin')
  chapel(bag, 54, 2, 65, Math.PI, 0.9)
  lampPost(bag, 52, 2, 60)
  for (const x of [-28, -16, 14, 24]) house(bag, rng, x, 2, 12, range(rng, -0.15, 0.15), { w: 9, d: 6, storeys: 1, blue: x === 14 })
  for (const x of [-30, -18, -6, 6, 18]) lampPost(bag, x, 2.1, QUAY.z1 - 1.5)
  for (let i = 0; i < 10; i++) boat(bag, rng, range(rng, -30, 22), 0, range(rng, 28, 46), range(rng, 0, Math.PI), range(rng, 0.9, 1.2))
  for (const [x, z] of [[-24, 92], [66, 112], [116, 74]] as const) boat(bag, rng, x, 0, z, range(rng, 0, Math.PI), 1.25)

  // Agora at the foot of the acropolis: colonnade comb, tents, crates.
  colonnade(bag, rng, AGORA.x, agoraY, AGORA.z + 5, 10 * DEG, 6, 3.4, 8, 0.35, 0.6)
  tent(bag, AGORA.x - 7, agoraY, AGORA.z - 5)
  tent(bag, AGORA.x + 2, agoraY, AGORA.z - 7)
  crates(bag, rng, AGORA.x + 7, agoraY, AGORA.z - 2, 4)
  lampPost(bag, AGORA.x + 9, agoraY, AGORA.z + 7)

  // Acropolis: stoa along the south edge, the archive-beacon at the west end, chapel at the east.
  colonnade(bag, rng, ACRO.x + 2, ACRO.y, ACRO.z + 10, 0, 13, 3.2, 7.5, 0.08, 0.6)
  bag.put('box', 'white', { x: ACRO.x + 2, y: ACRO.y, z: ACRO.z + 5.6, sx: 42, sy: 6.2, sz: 1.2 })
  bag.put('box', 'ruin', { x: ACRO.x + 2, y: ACRO.y + 7.6, z: ACRO.z + 8, sx: 43, sy: 0.7, sz: 7.6 })
  for (const dx of [-16, -8, 0, 8, 16]) bag.put('box', 'window', { x: ACRO.x + 2 + dx, y: ACRO.y + 2, z: ACRO.z + 6.25, sx: 1, sy: 1.4, sz: 0.12 }, { glow: true, shadow: false })
  const lamp = archiveBeacon(bag, ACRO.x - 12, ACRO.y, ACRO.z - 7, yawToward(ACRO.x - 12, ACRO.z - 7, BAY_FOCUS[0], BAY_FOCUS[1]), 1.6)
  chapel(bag, ACRO.x + 15, ACRO.y, ACRO.z - 9, yawToward(ACRO.x + 15, ACRO.z - 9, BAY_FOCUS[0], BAY_FOCUS[1]), 1.1)
  for (const dx of [-18, -12, -6, 0, 6, 12, 18]) cypress(bag, ACRO.x + 2 + dx, ACRO.y, ACRO.z + 1, range(rng, 7, 9.5))
  for (const [dx, dz] of [[-16, -12], [6, -14]] as const) lampPost(bag, ACRO.x + dx, ACRO.y, ACRO.z + dz)

  // Aqueduct: level channel at 28 m on arches whose piers grow as the ground falls toward the town.
  const aqLen = Math.hypot(aqTo[0] - aqFrom[0], aqTo[1] - aqFrom[1])
  const ux = (aqTo[0] - aqFrom[0]) / aqLen
  const uz = (aqTo[1] - aqFrom[1]) / aqLen
  const aqYaw = Math.atan2(-uz, ux)
  const bays = Math.floor(aqLen / 10)
  const moduleBase = CHANNEL_Y - 1.4 - 7.5
  for (let i = 0; i < bays; i++) {
    const s = (i + 0.5) * 10
    const x = aqFrom[0] + ux * s
    const z = aqFrom[1] + uz * s
    const ground = Math.min(height(x - ux * 4.2, z - uz * 4.2), height(x, z), height(x + ux * 4.2, z + uz * 4.2))
    if (ground > moduleBase + 4) continue
    if (ground > moduleBase - 1) {
      bag.put('box', 'stone', { x, y: ground - 0.6, z, yaw: aqYaw, sx: 10.2, sy: CHANNEL_Y - 1.4 - ground + 0.6, sz: 2.8 })
    } else {
      bag.put('arch', 'stone', { x, y: moduleBase, z, yaw: aqYaw })
      for (const side of [-4.15, 4.15]) {
        const px = x + ux * side
        const pz = z + uz * side
        const g = height(px, pz) - 0.6
        bag.put('box', 'stone', { x: px, y: g, z: pz, yaw: aqYaw, sx: 1.7, sy: moduleBase - g, sz: 3.2 })
      }
    }
    bag.put('box', 'ruin', { x, y: CHANNEL_Y - 1.4, z, yaw: aqYaw, sx: 10.2, sy: 1.4, sz: 3.4 })
  }
  // Castellum tower and the blue cistern court where the water arrives.
  bag.put('box', 'stone', { x: aqTo[0] - ux * 2, y: cisternY - 0.5, z: aqTo[1] - uz * 2, yaw: aqYaw, sx: 9, sy: CHANNEL_Y + 1.6 - cisternY, sz: 9 })
  bag.put('box', 'window', { x: aqTo[0] - ux * 2, y: CHANNEL_Y - 4, z: aqTo[1] - uz * 2 + 4.6, sx: 1.2, sy: 1.6, sz: 0.12 }, { glow: true, shadow: false })
  bag.put('box', 'ruin', { x: CISTERN.x - 6, y: cisternY - 0.3, z: CISTERN.z + 5, sx: 14, sy: 1.6, sz: 14 })
  bag.put('box', 'blue', { x: CISTERN.x - 6, y: cisternY + 0.9, z: CISTERN.z + 5, sx: 12, sy: 0.5, sz: 12 }, { shadow: false })
  for (const [dx, dz] of [[-8, -3], [8, -3]] as const) lampPost(bag, CISTERN.x + dx, cisternY, CISTERN.z + dz)

  // Town houses on the terraces behind the harbour, fronts to the sea, three domes among them.
  const landmarks: Point[] = [[CISTERN.x - 6, CISTERN.z + 5], [-30, -22], [34, -14]]
  for (const [cx, cz] of landmarks.slice(1)) {
    const fp = footprint(height, cx, cz, 0, 7, 5.5)
    chapel(bag, cx, fp.min, cz, range(rng, -0.1, 0.1), 1)
  }
  const inTown = (x: number, z: number) => {
    const h = height(x, z)
    return h > 1.9 && h < 22
  }
  const homes = scatter(
    240,
    () => [range(rng, -60, 70), range(rng, -80, 10)],
    (x, z) =>
      inTown(x, z) &&
      distanceToPolylines(x, z, avoid) > 2.8 &&
      distanceToPolyline(x, z, townStair) > 6.5 &&
      landmarks.every(([lx, lz]) => Math.hypot(x - lx, z - lz) > 10) &&
      Math.hypot(x - AGORA.x, z - AGORA.z) > 16 &&
      Math.hypot(x - CISTERN.x, z - CISTERN.z) > 11,
    5.8,
    14000,
  )
  const housePoints: Point[] = []
  for (const [x, z] of homes) {
    const yaw = range(rng, -0.3, 0.3)
    const w = range(rng, 5, 8.5)
    const d = range(rng, 4.6, 7)
    const storeys = rng() < 0.45 ? 2 : 1
    const h = storeys === 2 ? range(rng, 6.2, 7.4) : range(rng, 3.5, 4.4)
    const base = houseSlot(height, x, z, yaw, w, d, h)
    if (base === null) continue
    house(bag, rng, x, base, z, yaw, { w, d, storeys, h, blue: rng() < 0.1 })
    housePoints.push([x, z])
  }

  // Drowned forum at the foot of the acropolis cliff.
  columnRing(bag, rng, -62, -1.3, 32, 10, 12, 5.5, 0.4, 2)
  bag.put('box', 'ruin', { x: -62, y: -2.3, z: 32, yaw: 0.4, sx: 9, sy: 1.5, sz: 9 }, { shadow: false })

  // Olive terraces and windmills on the east slopes.
  for (const level of [9.2, 12.8, 16.4, 20, 23.6]) {
    const path = contourPath(height, level + 0.5, RIDGE.x, RIDGE.z, 95 * DEG, 215 * DEG, 46, 12, 95, -2.2)
    if (path.length > 6) terraceWall(bag, path, height, 1.4, 'ruin')
  }
  const groves = scatter(
    170,
    () => [range(rng, 52, 150), range(rng, -112, 12)],
    (x, z) => {
      const h = height(x, z)
      return h > 3 && h < 36 && distanceToPolylines(x, z, avoid) > 6 && housePoints.every(([hx, hz]) => Math.hypot(x - hx, z - hz) > 4.5)
    },
    5,
    7000,
  )
  for (const [x, z] of groves) olive(bag, rng, x, height(x, z), z)
  const windmills: Windmill[] = []
  for (const [x, z] of [[122, -60], [132, -78], [116, -94]] as const) windmills.push(windmill(bag, x, height(x, z), z, yawToward(x, z, BAY_FOCUS[0], BAY_FOCUS[1])))

  // Cypresses: along the acropolis stair, scattered through the town, and a few by the aqueduct.
  for (const p of samplePolyline(acroStair, 7)) {
    const x = p.x + Math.cos(p.yaw) * 2.8
    const z = p.z - Math.sin(p.yaw) * 2.8
    cypress(bag, x, height(x, z), z, range(rng, 5.5, 8))
  }
  const trees = scatter(
    30,
    () => [range(rng, -50, 60), range(rng, -64, 8)],
    (x, z) =>
      inTown(x, z) && distanceToPolylines(x, z, avoid) > 2.2 && distanceToPolyline(x, z, townStair) > 7 && housePoints.every(([hx, hz]) => Math.hypot(x - hx, z - hz) > 4.6),
    5,
    2500,
  )
  for (const [x, z] of trees) cypress(bag, x, height(x, z), z, range(rng, 6, 9.5))
  for (let i = 1; i < bays; i += 2) {
    const s = i * 10
    const x = aqFrom[0] + ux * s - uz * 5
    const z = aqFrom[1] + uz * s + ux * 5
    const h = height(x, z)
    if (h > 2 && h < moduleBase - 1) cypress(bag, x, h, z, range(rng, 6, 8))
  }

  return finish(field, bag, windmills, lamp, null)
}
