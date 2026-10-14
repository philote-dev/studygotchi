/**
 * Direction A — The Hanging Well (vertical).
 * A limestone amphitheatre wraps a round cove and climbs 70 m in whitewashed terraces; a deep
 * well plaza juts out of the slope half-way up, the archive-beacon perches on the west horn over
 * the cove mouth, windmills step down the east horn, and one stair-street zigzags from the
 * working quay through the town to the well and on to the archaeologists' colonnade on the top.
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
  distanceToPolylines,
  domeFragment,
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
  vineCanopy,
  well,
  windmill,
  yawToward,
  type Point,
} from './bag'
import { buildHeightfield } from './heightfield'
import { coastClassify, finish, type Layout, type Windmill } from './layout'
import { DEG, clamp, fbm, lerp, mulberry32, range, smoothstep, terrace } from './rng'

const C = { x: 6, z: 28 } // cove centre
const WELL = { x: 4, z: -72, y: 34 }
const BEACON = { x: -84, z: 66 }
const QUAY = { x: -50, z: 6, a: -160 * DEG }
const STEP = 8

export const polar = (a: number, r: number): Point => [C.x + Math.cos(a) * r, C.z + Math.sin(a) * r]
export const WELL_A = WELL

/** The stair-street's plan, quay apron to the well plaza; fixed across seeds. */
export function stairPathA(): Point[] {
  return [polar(-150 * DEG, 70), polar(-125 * DEG, 76), polar(-142 * DEG, 85), polar(-115 * DEG, 92), polar(-130 * DEG, 98), [WELL.x - 10, WELL.z + 9]]
}

const quayRadial = [Math.cos(QUAY.a), Math.sin(QUAY.a)] as const
const quayTangent = [-quayRadial[1], quayRadial[0]] as const

/** Terrain only (cheap): used by the layout and by the pose table to stand the walk camera on the stair. */
export function terrainA(seed: number) {
  const raw = (x: number, z: number): number => {
    const dx = x - C.x
    const dz = z - C.z
    const r = Math.hypot(dx, dz)
    const ang = Math.atan2(dz, dx)
    const south = r > 1 ? dz / r : 0
    const wobble = (fbm(Math.cos(ang) * 1.9 + 7.3, Math.sin(ang) * 1.9 + 2.1, seed, 3) - 0.5) * 20
    const gain = 1 + 0.24 * Math.cos(ang - Math.PI)
    // Even slope so the terraces come out the same width; the plateau above is roughed up below.
    let h = Math.min(62, lerp(-11, 64, clamp((r + wobble - 34) / 122, 0, 1)) * gain)
    const mouth = smoothstep(0.2, 0.92, south)
    h = lerp(h, -7 - 5 * smoothstep(40, 90, r), mouth)
    // Shallow shelf in the cove for the drowned forum.
    if (h < 0) h = Math.max(h, -1.4 - 8 * smoothstep(13, 30, Math.hypot(x - 38, z - 50)))
    // Working-quay apron on the inner west shore.
    const qx = x - QUAY.x
    const qz = z - QUAY.z
    const u = (qx * quayTangent[0] + qz * quayTangent[1]) / 24
    const v = (qx * quayRadial[0] + qz * quayRadial[1]) / 11
    h = Math.max(h, 2.2 - 14 * smoothstep(0.85, 1.15, Math.hypot(u, v)))
    if (h > 2 && h < 56) h = 2 + terrace(h - 2, STEP, 0.78)
    // Crags on the plateau: the skyline above the last terrace is broken limestone, not a dome.
    if (h > 54) h += 16 * smoothstep(54, 60, h) * (fbm(x * 0.05 + 1, z * 0.05 + 4, seed + 3, 3) - 0.3)
    return h
  }
  const beaconY = Math.max(26, 2 + Math.round((raw(BEACON.x, BEACON.z) - 2) / STEP) * STEP)
  const height = (x: number, z: number): number => {
    let h = raw(x, z)
    h = lerp(h, WELL.y, smoothstep(19, 13.5, Math.hypot(x - WELL.x, z - WELL.z)))
    h = lerp(h, beaconY, smoothstep(17, 11, Math.hypot(x - BEACON.x, z - BEACON.z)))
    const r0 = Math.hypot(x, z)
    // The back of the massif is ridged limestone running down to the sea, not a smooth dome.
    if (h > 3) h += 18 * smoothstep(136, 168, r0) * (0.9 - 2 * Math.abs(fbm(x * 0.035 + 2, z * 0.035 + 6, seed + 17, 3) - 0.5) - 0.45)
    const edge = r0 + (fbm(x * 0.015 + 9, z * 0.015 + 2, seed + 11, 2) - 0.5) * 30
    return lerp(-12, h, smoothstep(206, 164, edge))
  }
  return { height, beaconY }
}

export function layoutA(seed: number): Layout {
  const rng = mulberry32(seed * 7919 + 101)
  const { height, beaconY } = terrainA(seed)
  const zone = (x: number, z: number, y: number) => {
    if (Math.hypot(x - WELL.x, z - WELL.z) < 13.8) return 'plaza' as const
    if (Math.hypot(x - BEACON.x, z - BEACON.z) < 11) return 'plaza' as const
    if (y < 0 && Math.hypot(x - 38, z - 50) < 13) return 'floor' as const
    return null
  }
  const field = buildHeightfield(height, coastClassify(zone, 61), 480, 184)

  const bag = new Bag()
  const avoid: Point[][] = []

  // Stair-street: quay apron → zigzag through the terraces → well plaza → plateau colonnade.
  const stair = stairPathA()
  const upper: Point[] = [[WELL.x - 4, WELL.z - 12.5], polar(-104 * DEG, 120), polar(-96 * DEG, 130), polar(-104 * DEG, 140)]
  ribbon(bag, stair, height, { width: 3.4, spacing: 1.3, color: 'stair' })
  ribbon(bag, upper, height, { width: 3, spacing: 1.3, color: 'stair' })
  avoid.push(stair, upper)

  // Contour lanes hugging the outer edge of each terrace (the cliff-town street with a parapet view).
  for (const level of [10, 18, 26, 42, 50]) {
    const path = contourPath(height, level - 0.3, C.x, C.z, -178 * DEG, -2 * DEG, 110, 50, 156, -1.2)
    if (path.length > 6) {
      ribbon(bag, path, height, { width: 2.4, spacing: 2.2, color: 'lane' })
      avoid.push(path)
    }
  }

  // Hero pieces first so houses keep clear of them.
  const landmarks: Point[] = [[WELL.x, WELL.z], [BEACON.x, BEACON.z]]
  const chapels: Point[] = [[WELL.x + 11, WELL.z + 3], polar(-123 * DEG, 78), polar(-22 * DEG, 98)]
  for (const [cx, cz] of chapels) {
    const y = footprint(height, cx, cz, 0, 7, 5.5).min
    chapel(bag, cx, y, cz, yawToward(cx, cz, C.x, C.z), 1)
    landmarks.push([cx, cz])
  }

  // Houses: whitewash on every flat terrace, fronts to the cove, backs dug into the riser, one in nine cobalt.
  const inTown = (x: number, z: number) => {
    const h = height(x, z)
    return h > 1.9 && h < 54
  }
  const homes = scatter(
    260,
    () => polar(range(rng, -190 * DEG, 10 * DEG), range(rng, 64, 136)),
    (x, z) => {
      if (!inTown(x, z) || distanceToPolylines(x, z, avoid) < 2.6 || distanceToPolylines(x, z, [stair, upper]) < 5.5) return false
      if (Math.hypot(x - WELL.x, z - WELL.z) < 17.5 || Math.hypot(x - BEACON.x, z - BEACON.z) < 15) return false
      for (const [lx, lz] of landmarks) if (Math.hypot(x - lx, z - lz) < 8) return false
      const ang = Math.atan2(z - C.z, x - C.x)
      return !(ang > -35 * DEG && rng() < 0.6)
    },
    5.8,
    14000,
  )
  const housePoints: Point[] = []
  for (const [x, z] of homes) {
    const yaw = yawToward(x, z, C.x, C.z) + range(rng, -0.22, 0.22)
    const w = range(rng, 5, 8.5)
    const d = range(rng, 4.6, 7)
    const storeys = rng() < 0.45 ? 2 : 1
    const h = storeys === 2 ? range(rng, 6.2, 7.4) : range(rng, 3.5, 4.4)
    const base = houseSlot(height, x, z, yaw, w, d, h)
    if (base === null) continue
    house(bag, rng, x, base, z, yaw, { w, d, storeys, h, blue: rng() < 0.11 })
    housePoints.push([x, z])
  }

  // The well plaza: shaft, parapet, exedra of columns on the uphill side, a vine court, cypresses.
  well(bag, WELL.x, WELL.y, WELL.z, 4.2)
  columnRing(bag, rng, WELL.x, WELL.y, WELL.z, 12, 9, 7.5, 0.12, 0, -170 * DEG, -10 * DEG)
  vineCanopy(bag, WELL.x - 9, WELL.y, WELL.z + 4, 7, 5)
  for (let i = 0; i < 6; i++) {
    const a = -150 * DEG + i * (24 * DEG)
    const x = WELL.x + Math.cos(a) * 15.2
    const z = WELL.z + Math.sin(a) * 15.2
    cypress(bag, x, height(x, z), z, range(rng, 7, 9.5))
  }

  // Archive-beacon on the west horn, facing the cove.
  const lamp = archiveBeacon(bag, BEACON.x, beaconY, BEACON.z, yawToward(BEACON.x, BEACON.z, C.x, C.z), 1.8)
  for (const [a, r] of [[-2.6, 9.5], [0.6, 10], [1.9, 9]] as const) {
    const x = BEACON.x + Math.cos(a) * r
    const z = BEACON.z + Math.sin(a) * r
    cypress(bag, x, height(x, z), z, range(rng, 6, 8))
  }

  // Windmills stepping down the east horn (dry terraces).
  const windmills: Windmill[] = []
  for (const [a, r] of [[10 * DEG, 100], [24 * DEG, 96], [36 * DEG, 106]] as const) {
    const [x, z] = polar(a, r)
    windmills.push(windmill(bag, x, height(x, z), z, yawToward(x, z, C.x, C.z)))
  }

  // Archaeology ridge: the six-tooth colonnade comb on the plateau skyline, tents, crates.
  const [arX, arZ] = polar(-104 * DEG, 140)
  const arY = height(arX, arZ)
  colonnade(bag, rng, arX, arY, arZ, 20 * DEG, 7, 3.6, 8.5, 0.3, 0.62)
  for (const [dx, dz] of [[-9, 7], [-2, 9], [7, 6]] as const) tent(bag, arX + dx, height(arX + dx, arZ + dz), arZ + dz)
  crates(bag, rng, arX + 3, height(arX + 3, arZ + 12), arZ + 12, 5)

  // Working quay: apron, sheds, quay wall, mole, lamps, moored boats.
  const quayPoint = (u: number, v: number): Point => [QUAY.x + quayTangent[0] * u + quayRadial[0] * v, QUAY.z + quayTangent[1] * u + quayRadial[1] * v]
  for (const u of [-15, -5, 5, 15]) {
    const [x, z] = quayPoint(u, 4.5)
    house(bag, rng, x, 2.2, z, yawToward(x, z, C.x, C.z), { w: 8.5, d: 5.5, storeys: 1, blue: u === 5 })
  }
  polyWall(bag, [quayPoint(-24, -9.5), quayPoint(24, -9.5)], -1.6, 4, 2, 'ruin')
  polyWall(bag, [quayPoint(-24, -9.5), quayPoint(-24, 2)], -1.6, 4, 2, 'ruin')
  polyWall(bag, [quayPoint(-25, -10), quayPoint(-22, -22), quayPoint(-12, -34), quayPoint(2, -40)], -2.6, 4.4, 3.6, 'ruin')
  for (const u of [-18, -9, 0, 9, 18]) {
    const [x, z] = quayPoint(u, -8.2)
    lampPost(bag, x, 2.3, z)
  }
  for (const u of [-19, -12, -4, 4, 12, 19]) {
    const [x, z] = quayPoint(u, -13.5)
    boat(bag, rng, x, 0, z, Math.atan2(quayRadial[0], quayRadial[1]) + range(rng, -0.2, 0.2), range(rng, 0.9, 1.15))
  }
  boat(bag, rng, -4, 0, 40, range(rng, 0, Math.PI), 1.2)
  boat(bag, rng, 18, 0, 70, range(rng, 0, Math.PI), 1)

  // Drowned forum on the cove shelf.
  columnRing(bag, rng, 38, -1.3, 50, 11, 14, 5.5, 0.4, 2)
  bag.put('box', 'ruin', { x: 38, y: -2.4, z: 50, yaw: 0.3, sx: 12, sy: 1.6, sz: 12 }, { shadow: false })
  domeFragment(bag, 47, -2.4, 58, 5, 0.6, 0.5)

  // Scale cues: cypresses along the stair and on the terraces, olives on the east horn.
  for (const p of samplePolyline(stair, 14)) {
    const x = p.x + Math.cos(p.yaw) * 2.9
    const z = p.z - Math.sin(p.yaw) * 2.9
    if (inTown(x, z)) cypress(bag, x, height(x, z), z, range(rng, 5.5, 8))
  }
  const trees = scatter(
    48,
    () => polar(range(rng, -185 * DEG, 5 * DEG), range(rng, 64, 136)),
    (x, z) => inTown(x, z) && distanceToPolylines(x, z, avoid) > 2 && housePoints.every(([hx, hz]) => Math.hypot(x - hx, z - hz) > 4.6) && Math.hypot(x - WELL.x, z - WELL.z) > 16,
    5,
    3000,
  )
  for (const [x, z] of trees) cypress(bag, x, height(x, z), z, range(rng, 6, 9.5))
  const groves = scatter(
    90,
    () => polar(range(rng, -40 * DEG, 20 * DEG), range(rng, 66, 130)),
    (x, z) => {
      const h = height(x, z)
      return h > 5 && h < 42 && distanceToPolylines(x, z, avoid) > 2 && housePoints.every(([hx, hz]) => Math.hypot(x - hx, z - hz) > 4.2)
    },
    4.2,
    4000,
  )
  for (const [x, z] of groves) olive(bag, rng, x, height(x, z), z)

  return finish(field, bag, windmills, lamp, null)
}
