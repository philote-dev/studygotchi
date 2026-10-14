/**
 * Direction B — The Drowned Forum (water-led).
 * A turquoise lagoon fenced by a broken reef of islets fills the frame; the old forum stands
 * knee-deep in the middle (peristyle, half-ring theatre, a fallen dome), stepping-stone causeways
 * tie it to a white village on the west hill, the working quay on the north shore and a sea
 * stack carrying the archive-beacon with a stair spiralling up its flank. Horizontal, mirror-like,
 * one vertical.
 */
import {
  Bag,
  archiveBeacon,
  arcPoints,
  boat,
  causeway,
  chapel,
  colonnade,
  crates,
  cypress,
  distanceToPolyline,
  distanceToPolylines,
  domeFragment,
  footprint,
  house,
  houseSlot,
  lampPost,
  olive,
  polyWall,
  ribbon,
  scatter,
  shoreward,
  spiralStair,
  tent,
  terraceWall,
  windmill,
  yawToward,
  zigzag,
  type Point,
} from './bag'
import { buildHeightfield } from './heightfield'
import { coastClassify, finish, patchwork, type Layout, type Windmill } from './layout'
import { DEG, clamp, fbm, lerp, mulberry32, range, smoothstep, terrace } from './rng'

const L = { x: 12, z: 22 } // lagoon centre
const NW = { x: -0.34, z: -0.94 } // shore normal, pointing inland
const T = { x: 0.94, z: -0.34 } // along-shore tangent
const RIDGE_ALONG = -60 // where the village ridge is centred along the shore
const HILL2 = { x: 92, z: -100 }
const STACK = { x: 86, z: 44, y: 34 }
const FORUM = { x: 20, z: 24, w: 62, d: 46 }
const RIM = 104
const STEP = 5.5

/** Inverse of the Hermite smoothstep on [0, 1], by bisection. */
function invSmoothstep(s: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2
    if (mid * mid * (3 - 2 * mid) < s) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export const RIDGE_ALONG_B = RIDGE_ALONG

/** Shore frame → world: `land` metres inland from the mean shoreline, `along` metres along it. */
export function shorePoint(land: number, along: number): Point {
  const u = land + 58
  return [NW.x * u + T.x * along, NW.z * u + T.z * along]
}

/** Terrain only (cheap): shared by the layout and the pose table. */
export function terrainB(seed: number) {
  const raw = (x: number, z: number): number => {
    const u = NW.x * x + NW.z * z
    const along = T.x * x + T.z * z
    const land = u - 58 + (fbm(x * 0.012 + 3, z * 0.012 + 9, seed, 3) - 0.5) * 22
    // The village ridge: an even slope facing the lagoon, 20 m over 60 m, fading out along the shore.
    const ridge = 20 * clamp(land / 60, 0, 1) * smoothstep(80, 28, Math.abs(along - RIDGE_ALONG))
    const hillB = 16 * smoothstep(60, 10, Math.hypot(x - HILL2.x, z - HILL2.z))
    const hLand = 2 + 0.14 * Math.max(0, land) + ridge + hillB

    const rl = Math.hypot(x - L.x, z - L.z)
    const al = Math.atan2(z - L.z, x - L.x)
    const inside = smoothstep(RIM + 6, RIM - 8, rl)
    // Lagoon floor: sand bars and deeper channels, so the water grades from aqua to teal.
    let sea = lerp(-9.5 - 2 * fbm(x * 0.02, z * 0.02, seed + 5, 2), -3.8 + 2.8 * fbm(x * 0.03 + 2, z * 0.03 + 7, seed + 9, 3), inside)
    // Reef rim: islets with gaps, from east-north-east round the south to west-south-west.
    const rimBand = Math.max(0, 1 - Math.abs(rl - RIM) / 13)
    const sector = smoothstep(-0.55, -0.25, al) * smoothstep(2.75, 2.45, al)
    const rimTop = Math.min(11, (fbm(Math.cos(al) * 4 + 3, Math.sin(al) * 4 + 5, seed + 13, 3) - 0.38) * 36)
    sea = Math.max(sea, lerp(-12, rimTop, rimBand * sector))
    // Sea stack and its companion rock.
    const ds = Math.hypot(x - STACK.x, z - STACK.z) + 2.5 * (fbm(x * 0.08, z * 0.08, seed + 17, 2) - 0.5)
    sea = Math.max(sea, lerp(-4, STACK.y, smoothstep(14, 5, ds)))
    sea = Math.max(sea, lerp(-4, 7, smoothstep(10, 3, Math.hypot(x - 104, z - 30))))
    // Forum floor: a drowned plaza 1.3 m under the surface.
    const fd = Math.max(Math.abs(x - FORUM.x) - FORUM.w / 2, Math.abs(z - FORUM.z) - FORUM.d / 2)
    sea = Math.max(sea, -1.3 - 6 * smoothstep(0, 10, fd))

    let h = lerp(sea, hLand, smoothstep(-5, 4, land))
    if (h > 2 && h < 30) h = 2 + terrace(h - 2, STEP, 0.78)
    else if (h >= 30) h += 4 * (fbm(x * 0.05 + 3, z * 0.05 + 1, seed + 21, 3) - 0.4)
    return h
  }
  const [hillX, hillZ] = shorePoint(64, RIDGE_ALONG)
  const HILL = { x: hillX, z: hillZ }
  const hilltopY = 2 + Math.floor((raw(HILL.x, HILL.z) - 2) / STEP) * STEP
  const quayPad = { x: 24, z: -66 }
  const digPad = { x: -30, z: -60, y: 3.6 }
  const height = (x: number, z: number): number => {
    let h = raw(x, z)
    h = lerp(h, STACK.y, smoothstep(9, 5.5, Math.hypot(x - STACK.x, z - STACK.z)))
    h = lerp(h, hilltopY, smoothstep(13, 8, Math.hypot(x - HILL.x, z - HILL.z)))
    h = Math.max(h, 2 - 10 * smoothstep(0.9, 1.15, Math.hypot((x - quayPad.x) / 18, (z - quayPad.z) / 8)))
    h = lerp(h, digPad.y, smoothstep(16, 11, Math.hypot(x - digPad.x, z - digPad.z)))
    const edge = Math.hypot(x, z) + (fbm(x * 0.015 + 9, z * 0.015 + 2, seed + 11, 2) - 0.5) * 30
    return lerp(-12, h, smoothstep(214, 176, edge))
  }
  return { height, HILL, hilltopY, quayPad, digPad }
}

/** The village stair-street: causeway landing → zigzag up the slope → summit chapel. */
export function stairPathB(seed: number): { stair: Point[]; landing: Point } {
  const { height, HILL } = terrainB(seed)
  const toward = Math.atan2(-NW.z, -NW.x)
  const landing = shoreward(height, [HILL.x, HILL.z], shorePoint(-30, RIDGE_ALONG), 0.6)
  const summitEdge: Point = [HILL.x + Math.cos(toward) * 9, HILL.z + Math.sin(toward) * 9]
  return { stair: zigzag(landing, summitEdge, 5, 7), landing }
}

export function layoutB(seed: number): Layout {
  const rng = mulberry32(seed * 7919 + 202)
  const { height, HILL, hilltopY, quayPad, digPad } = terrainB(seed)
  const zone = (x: number, z: number, y: number) => {
    if (y < 0.2 && Math.abs(x - FORUM.x) < FORUM.w / 2 && Math.abs(z - FORUM.z) < FORUM.d / 2) return 'floor' as const
    if (Math.hypot(x - STACK.x, z - STACK.z) < 5.5) return 'plaza' as const
    if (Math.hypot(x - digPad.x, z - digPad.z) < 11) return 'plaza' as const
    // Farmland on the hinterland plain, behind the village ridge and the quay.
    const u = NW.x * x + NW.z * z - 58
    const along = T.x * x + T.z * z
    const village = Math.abs(along - RIDGE_ALONG) < 82 && u < 74
    if (y > 1.8 && y < 26 && u > 12 && !village && Math.hypot(x - HILL2.x, z - HILL2.z) > 48) return patchwork(x, z, seed)
    return null
  }
  const field = buildHeightfield(height, coastClassify(zone, 25), 480, 184)

  const bag = new Bag()
  const avoid: Point[][] = []

  // Village stair from the causeway landing straight up the lagoon-facing slope to the chapel.
  const toward = Math.atan2(-NW.z, -NW.x) // downhill, toward the lagoon
  const { stair, landing } = stairPathB(seed)
  ribbon(bag, stair, height, { width: 3.2, spacing: 1.3, color: 'stair' })
  avoid.push(stair)
  // Contour lanes run along the shore frame: bisection on `land` for each `along`.
  for (const level of [7.5, 13, 18.5, 24]) {
    const path: Point[] = []
    for (let i = 0; i <= 64; i++) {
      const along = RIDGE_ALONG - 72 + (144 * i) / 64
      const f = (land: number) => height(...shorePoint(land, along)) - (level - 0.3)
      let lo = 0
      let hi = 76
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
      path.push(shorePoint((lo + hi) / 2 + 1.2, along))
    }
    if (path.length > 6) {
      ribbon(bag, path, height, { width: 2.2, spacing: 2.2, color: 'lane' })
      avoid.push(path)
    }
  }

  // Causeways: village → forum, forum → sea stack, quay → forum.
  const forumWest: Point = [FORUM.x - FORUM.w / 2 - 2, FORUM.z]
  const forumEast: Point = [FORUM.x + FORUM.w / 2 + 2, FORUM.z + 4]
  const forumNorth: Point = [FORUM.x + 2, FORUM.z - FORUM.d / 2 - 2]
  const offshore: Point = [landing[0] + Math.cos(toward) * 3, landing[1] + Math.sin(toward) * 3]
  const stackDir = Math.atan2(forumEast[1] - STACK.z, forumEast[0] - STACK.x)
  const stackBase: Point = [STACK.x + Math.cos(stackDir) * 16.5, STACK.z + Math.sin(stackDir) * 16.5]
  causeway(bag, [offshore, forumWest])
  causeway(bag, [forumEast, stackBase])
  causeway(bag, [[quayPad.x - 10, quayPad.z + 7], forumNorth])
  // Mosaic path across the drowned floor.
  ribbon(bag, [forumWest, [FORUM.x, FORUM.z + 2], forumEast], height, { width: 2.6, spacing: 2.4, color: 'lane', lift: 0.12 })

  // The forum: peristyle platform, half-ring theatre, fallen dome, stumps.
  const fy = -1.3
  bag.put('box', 'ruin', { x: FORUM.x + 4, y: fy, z: FORUM.z - 2, yaw: 0.15, sx: 27, sy: 1.7, sz: 17 })
  const py = fy + 1.7
  for (const [lx, lz, yaw, count, spacing] of [
    [0, 6.6, 0.15, 6, 4.6],
    [0, -6.6, 0.15, 6, 4.6],
    [-11.8, 0, 0.15 + Math.PI / 2, 3, 4.6],
    [11.8, 0, 0.15 + Math.PI / 2, 3, 4.6],
  ] as const) {
    const c = Math.cos(0.15)
    const s = Math.sin(0.15)
    colonnade(bag, rng, FORUM.x + 4 + lx * c + lz * s, py, FORUM.z - 2 - lx * s + lz * c, yaw, count, spacing, 7.5, 0.3, 0.62)
  }
  for (let k = 0; k < 5; k++) {
    const r = 8 + k * 2.3
    polyWall(bag, arcPoints(-2, 8, r, 150 * DEG, 310 * DEG, 12), fy + k * 0.7, 0.9, 2.3, 'ruin')
  }
  domeFragment(bag, 44, -2.8, 40, 5.5, 0.4, 0.5)
  for (let i = 0; i < 16; i++) {
    const x = FORUM.x + range(rng, -28, 28)
    const z = FORUM.z + range(rng, -20, 20)
    if (Math.abs(x - (FORUM.x + 4)) < 15 && Math.abs(z - (FORUM.z - 2)) < 10) continue
    bag.put('column', 'stone', { x, y: fy, z, sx: 0.6, sy: range(rng, 0.8, 2.6), sz: 0.6 }, { shadow: false })
  }

  // Sea stack: spiral stair up the flank, the archive-beacon on top.
  const radiusAt = (y: number) => 14 - 9 * invSmoothstep(Math.min(0.999, Math.max(0.001, (y + 4) / 38))) + 1.3
  spiralStair(bag, STACK.x, STACK.z, radiusAt, STACK.y - 0.6, 1.15, stackDir, 64)
  const lamp = archiveBeacon(bag, STACK.x, STACK.y, STACK.z, yawToward(STACK.x, STACK.z, L.x, L.z), 1.5)

  // Village houses on the west hill; fronts to the lagoon; chapel on the summit.
  const landmarks: Point[] = [[HILL.x, HILL.z]]
  chapel(bag, HILL.x, hilltopY, HILL.z, yawToward(HILL.x, HILL.z, L.x, L.z), 1.1)
  for (let i = 0; i < 5; i++) {
    const a = toward + Math.PI + (i - 2) * 0.5
    const x = HILL.x + Math.cos(a) * 7.5
    const z = HILL.z + Math.sin(a) * 7.5
    cypress(bag, x, height(x, z), z, range(rng, 7, 9.5))
  }
  const inVillage = (x: number, z: number) => {
    const h = height(x, z)
    return h > 1.9 && h < 27
  }
  const homes = scatter(
    170,
    () => shorePoint(range(rng, 1, 70), RIDGE_ALONG + range(rng, -82, 82)),
    (x, z) =>
      inVillage(x, z) && distanceToPolylines(x, z, avoid) > 2.6 && distanceToPolyline(x, z, stair) > 5.5 && landmarks.every(([lx, lz]) => Math.hypot(x - lx, z - lz) > 9),
    5.5,
    16000,
  )
  const housePoints: Point[] = []
  for (const [x, z] of homes) {
    const yaw = yawToward(x, z, L.x, L.z) + range(rng, -0.25, 0.25)
    const w = range(rng, 5, 8.2)
    const d = range(rng, 4.6, 6.8)
    const storeys = rng() < 0.45 ? 2 : 1
    const h = storeys === 2 ? range(rng, 6.2, 7.4) : range(rng, 3.5, 4.4)
    const base = houseSlot(height, x, z, yaw, w, d, h)
    if (base === null) continue
    house(bag, rng, x, base, z, yaw, { w, d, storeys, h, blue: rng() < 0.1 })
    housePoints.push([x, z])
  }
  for (const [dx, dz] of [[-5, 4], [5, -2], [0, 7]] as const) boat(bag, rng, offshore[0] + dx, 0, offshore[1] + dz, range(rng, 0, Math.PI), 1)

  // Working quay on the north shore: L-quay, sheds, ramp, lamps, skiffs.
  polyWall(bag, [[6, -58.5], [42, -58.5]], -1.5, 3.7, 2, 'ruin')
  polyWall(bag, [[42, -58.5], [42, -48]], -1.5, 3.7, 2, 'ruin')
  for (const x of [10, 20, 30, 40]) house(bag, rng, x, 2, -69, yawToward(x, -69, L.x, L.z), { w: 8, d: 5.5, storeys: 1, blue: x === 30 })
  bag.put('box', 'stone', { x: 0, y: -1.2, z: -57, pitch: -0.16, sx: 6, sy: 0.5, sz: 10 }, { shadow: false })
  for (const x of [8, 18, 28, 38]) lampPost(bag, x, 2.1, -60.5)
  for (const x of [10, 17, 24, 31, 38]) boat(bag, rng, x, 0, -54, range(rng, -0.3, 0.3), range(rng, 0.9, 1.15))

  // Archaeology dig on the north-west shore: dry colonnade comb, tents, crates.
  colonnade(bag, rng, digPad.x, digPad.y, digPad.z, 30 * DEG, 6, 3.4, 8, 0.3, 0.6)
  for (const [dx, dz] of [[-7, 6], [1, 8], [8, 4]] as const) tent(bag, digPad.x + dx, digPad.y, digPad.z + dz)
  crates(bag, rng, digPad.x - 6, digPad.y, digPad.z - 4, 5)
  lampPost(bag, digPad.x + 5, digPad.y, digPad.z - 6)

  // Olive hill in the north-east: terrace crescents, groves, two windmills, a hamlet.
  for (const r of [16, 26, 36]) terraceWall(bag, arcPoints(HILL2.x, HILL2.z, r, 95 * DEG, 200 * DEG, 16), height, 1.5)
  const groves = scatter(
    70,
    () => {
      const a = range(rng, 0, Math.PI * 2)
      const r = Math.sqrt(rng()) * 46
      return [HILL2.x + Math.cos(a) * r, HILL2.z + Math.sin(a) * r]
    },
    (x, z) => {
      const h = height(x, z)
      return h > 2.5 && h < 17
    },
    4.4,
    3000,
  )
  for (const [x, z] of groves) olive(bag, rng, x, height(x, z), z)
  const windmills: Windmill[] = []
  for (const [dx, dz] of [[-7, 2], [7, -3]] as const) {
    const x = HILL2.x + dx
    const z = HILL2.z + dz
    windmills.push(windmill(bag, x, height(x, z), z, yawToward(x, z, L.x, L.z)))
  }
  for (const [x, z] of [[62, -92], [70, -84], [78, -78]] as const) {
    const yaw = yawToward(x, z, L.x, L.z)
    const fp = footprint(height, x, z, yaw, 6, 5)
    if (fp.max - fp.min < 2.5) house(bag, rng, x, fp.min - 0.1, z, yaw, { w: 6, d: 5, storeys: 1 })
  }

  // Trees along the stair and on the hill.
  const trees = scatter(
    26,
    () => shorePoint(range(rng, 1, 72), RIDGE_ALONG + range(rng, -76, 76)),
    (x, z) => inVillage(x, z) && distanceToPolylines(x, z, avoid) > 2 && housePoints.every(([hx, hz]) => Math.hypot(x - hx, z - hz) > 4.6),
    5,
    2000,
  )
  for (const [x, z] of trees) cypress(bag, x, height(x, z), z, range(rng, 6, 9))
  for (const [dx, dz] of [[-3, -3], [3, 2]] as const) cypress(bag, STACK.x + dx, STACK.y, STACK.z + dz, range(rng, 5, 6.5))

  return finish(field, bag, windmills, lamp, { cx: 30, cz: 74, radius: 24, speed: 0.07, phase: 1.1 })
}
