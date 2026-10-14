/**
 * Shared geography and population helpers for the three Ice blockouts. Pure data (no three.js
 * scene objects) so every world can be built and measured in node:
 *  - plates: pale rounded ice plates at authored heights (Penguin Isle), with wobbled outlines;
 *  - bumps: soft rounded snow mountains (the winter-valley reference), never sharp peaks;
 *  - lanes: winding packed-snow lanes with cabins on both sides (the snowy fishing village);
 *  - drifts of pines, penguin groups, piers with boats, floes, cracked-ice leads (Voronoi).
 */
import { clamp, fbm, hash2, lerp, polylineDistance, smoothstep } from './noise'
import type { Heightfield } from './terrain'

export const SEA_FLOOR = -8

export interface Placement {
  x: number
  y: number
  z: number
  ry?: number
  rx?: number
  rz?: number
  sx?: number
  sy?: number
  sz?: number
  /** Orient the local +z axis toward this point (tilted decks and stairs). */
  lookAt?: readonly [number, number, number]
}

export interface Cabin {
  x: number
  y: number
  z: number
  /** Yaw of the gable front (local +z). */
  ry: number
  w: number
  d: number
  h: number
  color: string
  chimney?: boolean
}

export interface Pine {
  x: number
  y: number
  z: number
  r: number
  h: number
}

export interface Boat {
  x: number
  z: number
  ry: number
  color: string
}

export interface WorldData {
  field: Heightfield
  height: (x: number, z: number) => number
  cabins: Cabin[]
  pines: Pine[]
  lamps: Placement[]
  boats: Boat[]
  decks: Placement[]
  posts: Placement[]
  steps: Placement[]
  floes: Placement[]
  shards: Placement[]
  crystals: Placement[]
  pinnacles: Placement[]
  igloos: Placement[]
  tents: Placement[]
  penguins: Placement[]
  seals: Placement[]
  modules: Placement[]
  tanks: Placement[]
  vehicles: Placement[]
  fences: Placement[]
}

export function emptyWorld(field: Heightfield, height: (x: number, z: number) => number): WorldData {
  return {
    field,
    height,
    cabins: [],
    pines: [],
    lamps: [],
    boats: [],
    decks: [],
    posts: [],
    steps: [],
    floes: [],
    shards: [],
    crystals: [],
    pinnacles: [],
    igloos: [],
    tents: [],
    penguins: [],
    seals: [],
    modules: [],
    tanks: [],
    vehicles: [],
    fences: [],
  }
}

/* ---------- geography ---------- */

export interface Plate {
  x: number
  z: number
  r: number
  y: number
  /** 2 = round, 4+ = squarish slab. */
  power?: number
  /** Outline wobble as a fraction of r (default 0.14). */
  wobble?: number
}

/** Signed inside distance to a plate's wobbled outline (positive inside). */
export function plateInside(p: Plate, x: number, z: number, seed: number): number {
  const dx = x - p.x
  const dz = z - p.z
  const n = p.power ?? 2
  const dist = n === 2 ? Math.hypot(dx, dz) : Math.pow(Math.pow(Math.abs(dx), n) + Math.pow(Math.abs(dz), n), 1 / n)
  const a = Math.atan2(dx, dz)
  const w = (fbm(Math.cos(a) * 2.2 + 11 + p.x * 0.01, Math.sin(a) * 2.2 + 11 + p.z * 0.01, seed + 3, 3) - 0.5) * 2 * (p.wobble ?? 0.14) * p.r
  return p.r + w - dist
}

/** Highest plate under (x, z), or null. */
export function plateAt(plates: readonly Plate[], x: number, z: number, seed: number): Plate | null {
  let best: Plate | null = null
  for (const p of plates) {
    if (plateInside(p, x, z, seed) > 0 && (!best || p.y > best.y)) best = p
  }
  return best
}

export interface Bump {
  x: number
  z: number
  r: number
  h: number
}

/** Soft rounded mountain: a smooth bump, never a cone. */
export function bumpHeight(bumps: readonly Bump[], x: number, z: number): number {
  let m = 0
  for (const b of bumps) {
    const d = Math.hypot(x - b.x, z - b.z) / b.r
    if (d < 1) {
      const k = 1 - d * d
      m = Math.max(m, b.h * k * k)
    }
  }
  return m
}

/** Fades a back range into the sea before the grid ends so no cut wall is visible. */
export function backFade(y: number, z: number, from = -160, to = -192): number {
  return lerp(SEA_FLOOR, y, 1 - smoothstep(from, to, z))
}

export interface Lane {
  points: ReadonlyArray<readonly [number, number]>
  width: number
}

export function laneDistance(lanes: readonly Lane[], x: number, z: number): { d: number; lane: Lane | null } {
  let best = Number.POSITIVE_INFINITY
  let lane: Lane | null = null
  for (const l of lanes) {
    const d = polylineDistance(l.points, x, z) - l.width / 2
    if (d < best) {
      best = d
      lane = l
    }
  }
  return { d: best, lane }
}

/** Cracked sea ice: F2 − F1 of a jittered Voronoi lattice; small values are the dark leads. */
export function crackGap(x: number, z: number, cell: number, seed: number): number {
  const ix = Math.floor(x / cell)
  const iz = Math.floor(z / cell)
  let f1 = Number.POSITIVE_INFINITY
  let f2 = Number.POSITIVE_INFINITY
  for (let oz = -1; oz <= 1; oz++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = (ix + ox + hash2(ix + ox, iz + oz, seed)) * cell
      const cz = (iz + oz + hash2(ix + ox, iz + oz, seed + 13)) * cell
      const d = Math.hypot(cx - x, cz - z)
      if (d < f1) {
        f2 = f1
        f1 = d
      } else if (d < f2) f2 = d
    }
  }
  return f2 - f1
}

/* ---------- population ---------- */

export type Rng = () => number
export const pick = <T,>(rnd: Rng, list: readonly T[]) => list[Math.floor(rnd() * list.length)]

export const CABIN_PALETTE = ['#c8524a', '#c8524a', '#5a86b0', '#5f9ea8', '#e08a4f', '#f4e9d2'] as const

export interface LaneCabinOptions {
  spacing?: number
  setback?: number
  /** Return false to skip a candidate spot (water, slope, exclusion zones). */
  ok?: (x: number, z: number) => boolean
  palette?: readonly string[]
  sizes?: { w: [number, number]; d: [number, number]; h: [number, number] }
  chimneyEvery?: number
  lampEvery?: number
}

/** Cabins on both sides of a lane, gable fronts facing it; lamps along one side. */
export function laneCabins(world: WorldData, lane: Lane, rnd: Rng, options: LaneCabinOptions = {}) {
  const spacing = options.spacing ?? 9
  const setback = options.setback ?? lane.width / 2 + 3.6
  const palette = options.palette ?? CABIN_PALETTE
  const sizes = options.sizes ?? { w: [4.6, 6], d: [4.8, 6], h: [3.6, 5] }
  const chimneyEvery = options.chimneyEvery ?? 3
  const lampEvery = options.lampEvery ?? 16
  let walked = 0
  let lampWalked = 0
  let index = 0
  for (let i = 0; i + 1 < lane.points.length; i++) {
    const [ax, az] = lane.points[i]
    const [bx, bz] = lane.points[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    const ux = (bx - ax) / len
    const uz = (bz - az) / len
    const nx = -uz
    const nz = ux
    for (let s = 0; s < len; s += 0.5) {
      walked += 0.5
      lampWalked += 0.5
      const x = ax + ux * s
      const z = az + uz * s
      if (lampWalked >= lampEvery) {
        lampWalked = 0
        const lx = x + nx * (lane.width / 2 + 0.8)
        const lz = z + nz * (lane.width / 2 + 0.8)
        if (!options.ok || options.ok(lx, lz)) world.lamps.push({ x: lx, y: world.height(lx, lz), z: lz })
      }
      if (walked < spacing) continue
      walked = 0
      for (const side of [-1, 1]) {
        if (rnd() < 0.12) continue
        const off = setback + rnd() * 1.6
        const cx = x + nx * off * side + ux * (rnd() - 0.5) * 2
        const cz = z + nz * off * side + uz * (rnd() - 0.5) * 2
        if (options.ok && !options.ok(cx, cz)) continue
        if (world.cabins.some((c) => Math.hypot(c.x - cx, c.z - cz) < 5.6)) continue
        const y = world.height(cx, cz)
        const w = lerp(sizes.w[0], sizes.w[1], rnd())
        const d = lerp(sizes.d[0], sizes.d[1], rnd())
        const h = lerp(sizes.h[0], sizes.h[1], rnd())
        world.cabins.push({ x: cx, y: y - 0.3, z: cz, ry: Math.atan2(-nx * side, -nz * side), w, d, h, color: pick(rnd, palette), chimney: index % chimneyEvery === 0 })
        index++
      }
    }
  }
}

/** Infill cabins scattered in a disc, off the lanes, facing the nearest lane. */
export function scatterCabins(world: WorldData, lanes: readonly Lane[], cx: number, cz: number, r: number, n: number, rnd: Rng, ok?: (x: number, z: number) => boolean, palette: readonly string[] = CABIN_PALETTE) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2
    const d = Math.sqrt(rnd()) * r
    const x = cx + Math.cos(a) * d
    const z = cz + Math.sin(a) * d
    if (ok && !ok(x, z)) continue
    const { d: laneD, lane } = laneDistance(lanes, x, z)
    if (laneD < 2.2) continue
    if (world.cabins.some((c) => Math.hypot(c.x - x, c.z - z) < 5.6)) continue
    let ry = rnd() * Math.PI * 2
    if (lane) {
      // Face the closest lane vertex.
      let best = Number.POSITIVE_INFINITY
      for (const [px, pz] of lane.points) {
        const dd = Math.hypot(px - x, pz - z)
        if (dd < best) {
          best = dd
          ry = Math.atan2(px - x, pz - z)
        }
      }
    }
    world.cabins.push({ x, y: world.height(x, z) - 0.3, z, ry, w: 4.6 + rnd() * 1.4, d: 4.8 + rnd() * 1.2, h: 3.6 + rnd() * 1.4, color: pick(rnd, palette), chimney: i % 3 === 0 })
  }
}

/** A drift of pines around a centre; `ok` rejects spots (water, cabins, lanes). */
export function pineDrift(world: WorldData, cx: number, cz: number, r: number, n: number, rnd: Rng, ok?: (x: number, z: number) => boolean, size = 1) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2
    const d = Math.sqrt(rnd()) * r
    const x = cx + Math.cos(a) * d
    const z = cz + Math.sin(a) * d
    if (ok && !ok(x, z)) continue
    if (world.pines.some((p) => Math.hypot(p.x - x, p.z - z) < 2.6)) continue
    world.pines.push({ x, y: world.height(x, z) - 0.3, z, r: (1.6 + rnd() * 1.2) * size, h: (6 + rnd() * 5) * size })
  }
}

/** Penguins as dots: a loose group, optionally a gathering ring. */
export function penguinGroup(world: WorldData, cx: number, cz: number, r: number, n: number, rnd: Rng, ring = false) {
  for (let i = 0; i < n; i++) {
    const a = ring ? (i / n) * Math.PI * 2 : rnd() * Math.PI * 2
    const d = ring ? r : Math.sqrt(rnd()) * r
    const x = cx + Math.cos(a) * d
    const z = cz + Math.sin(a) * d
    const y = world.height(x, z)
    if (y < 0.3) continue
    world.penguins.push({ x, y, z, ry: ring ? a + Math.PI : rnd() * Math.PI * 2, sy: 0.8 + rnd() * 0.5 })
  }
}

/** Plank deck between two points (level or tilted), with posts down to `postBottom`. */
export function deck(world: WorldData, ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, postEvery = 8, postBottom = -2) {
  const dx = bx - ax
  const dz = bz - az
  const len = Math.hypot(dx, dz, by - ay)
  world.decks.push({
    x: (ax + bx) / 2,
    y: (ay + by) / 2 - 0.25,
    z: (az + bz) / 2,
    sx: width,
    sy: 0.5,
    sz: len,
    lookAt: [bx, by - 0.25, bz],
  })
  const flat = Math.hypot(dx, dz) || 1
  const n = Math.max(1, Math.round(flat / postEvery))
  const px = (-dz / flat) * (width / 2 - 0.3)
  const pz = (dx / flat) * (width / 2 - 0.3)
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = ax + dx * t
    const z = az + dz * t
    const y = lerp(ay, by, t)
    const ground = Math.max(postBottom, world.height(x, z) - 0.5)
    if (y - ground < 0.6) continue
    for (const s of [-1, 1]) world.posts.push({ x: x + px * s, y: ground, z: z + pz * s, sx: 0.4, sy: y - ground, sz: 0.4 })
  }
}

/** Short stair of step boxes between two plate heights. */
export function stairs(world: WorldData, ax: number, az: number, ay: number, bx: number, bz: number, by: number, width = 3) {
  const n = Math.max(2, Math.round(Math.abs(by - ay) / 1.1))
  const dx = bx - ax
  const dz = bz - az
  const ry = Math.atan2(dx, dz)
  const len = Math.hypot(dx, dz)
  for (let i = 0; i < n; i++) {
    const t0 = i / n
    const t1 = (i + 1) / n
    const yTop = lerp(ay, by, (i + 1) / n)
    const yBase = Math.min(ay, by) - 0.2
    world.steps.push({ x: ax + dx * (t0 + t1) * 0.5, y: yBase, z: az + dz * (t0 + t1) * 0.5, ry, sx: width, sy: yTop - yBase, sz: len / n + 0.1 })
  }
}

/** A pier out from a shore point in direction (dx, dz), with lamps at the end and boats alongside. */
export function pier(world: WorldData, rnd: Rng, ax: number, az: number, dx: number, dz: number, len: number, y = 1.9, boats = 3) {
  const l = Math.hypot(dx, dz) || 1
  const ux = dx / l
  const uz = dz / l
  const bx = ax + ux * len
  const bz = az + uz * len
  deck(world, ax, y, az, bx, y, bz, 3, 7, -2.5)
  world.lamps.push({ x: bx, y, z: bz })
  for (let i = 0; i < boats; i++) {
    const side = i % 2 === 0 ? 1 : -1
    const t = 0.35 + rnd() * 0.6
    world.boats.push({ x: ax + ux * len * t - uz * side * 4, z: az + uz * len * t + ux * side * 4, ry: Math.atan2(ux, uz) + (rnd() - 0.5) * 0.4, color: pick(rnd, ['#c8524a', '#5a86b0', '#f4e9d2', '#e08a4f']) })
  }
}

/** Floes scattered over open water inside a box, skipping land. */
export function floeField(world: WorldData, rnd: Rng, xMin: number, xMax: number, zMin: number, zMax: number, n: number, ok?: (x: number, z: number) => boolean) {
  for (let i = 0; i < n; i++) {
    const x = lerp(xMin, xMax, rnd())
    const z = lerp(zMin, zMax, rnd())
    if (world.height(x, z) > -1.5) continue
    if (ok && !ok(x, z)) continue
    const s = 1.6 + rnd() * 4
    world.floes.push({ x, y: -0.3, z, sx: s, sy: 0.8, sz: s * (0.6 + rnd() * 0.6), ry: rnd() * Math.PI })
    if (rnd() < 0.2) world.seals.push({ x: x + (rnd() - 0.5), y: 0.5, z: z + (rnd() - 0.5), ry: rnd() * Math.PI * 2 })
  }
}

/** Ice-block shards along a plate's rim (Penguin Isle's edge stacks). */
export function rimShards(world: WorldData, rnd: Rng, p: Plate, seed: number, n: number) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2
    let r = p.r
    // walk inward until on the plate
    for (let k = 0; k < 8; k++) {
      const x = p.x + Math.sin(a) * r
      const z = p.z + Math.cos(a) * r
      if (plateInside(p, x, z, seed) > 1.5) {
        const s = 1 + rnd() * 1.8
        world.shards.push({ x, y: p.y - 0.2, z, sx: s, sy: s * (0.6 + rnd()), sz: s * 0.8, ry: rnd() * Math.PI })
        break
      }
      r -= 1.2
    }
  }
}

/** Research station: red modules on stilts joined by walkways, tanks and vehicles. */
export function station(world: WorldData, rnd: Rng, cx: number, cy: number, cz: number, ry: number, modules = 5) {
  const cos = Math.cos(ry)
  const sin = Math.sin(ry)
  const place = (ox: number, oz: number): [number, number] => [cx + ox * cos + oz * sin, cz - ox * sin + oz * cos]
  for (let i = 0; i < modules; i++) {
    const ox = (i - (modules - 1) / 2) * 9
    const oz = (i % 2) * 6 - 3
    const [x, z] = place(ox, oz)
    world.modules.push({ x, y: cy + 2.6, z, ry, sx: 7, sy: 3.4, sz: 4.4 })
    for (const [sx, sz] of [[-2.6, -1.6], [2.6, -1.6], [-2.6, 1.6], [2.6, 1.6]] as const) {
      const [px, pz] = place(ox + sx, oz + sz)
      world.posts.push({ x: px, y: cy - 0.2, z: pz, sx: 0.45, sy: 2.9, sz: 0.45 })
    }
  }
  // One raised walkway spine the modules straddle.
  const [wx, wz] = place(0, 0)
  world.decks.push({ x: wx, y: cy + 2.4, z: wz, ry: ry + Math.PI / 2, sx: 2.4, sy: 0.3, sz: modules * 9 })
  for (let i = 0; i < 3; i++) {
    const [x, z] = place(-modules * 4.5 - 6, -6 + i * 4)
    world.tanks.push({ x, y: cy, z, sx: 1.8, sy: 2.8, sz: 1.8 })
  }
  for (let i = 0; i < 3; i++) {
    const [x, z] = place(-10 + rnd() * 24, 9 + rnd() * 6)
    world.vehicles.push({ x, y: cy, z, ry: ry + rnd() * Math.PI, sx: 2.2, sy: 1.8, sz: 4 })
  }
  for (const [ox, oz] of [[-modules * 4.5, 12], [modules * 4.5, 12], [0, -12]] as const) {
    const [x, z] = place(ox, oz)
    world.lamps.push({ x, y: cy, z })
  }
}

/** Camp: igloos with entry tunnels, a few tents, a lamp. */
export function camp(world: WorldData, rnd: Rng, cx: number, cz: number, igloos: number, tents: number) {
  for (let i = 0; i < igloos; i++) {
    const a = (i / igloos) * Math.PI * 2 + rnd() * 0.5
    const r = 6 + rnd() * 8
    const x = cx + Math.cos(a) * r
    const z = cz + Math.sin(a) * r
    const s = 2.2 + rnd() * 1.2
    world.igloos.push({ x, y: world.height(x, z) - 0.3, z, sx: s, sy: s * 0.72, sz: s, ry: rnd() * Math.PI * 2 })
  }
  for (let i = 0; i < tents; i++) {
    const a = rnd() * Math.PI * 2
    const r = 10 + rnd() * 8
    const x = cx + Math.cos(a) * r
    const z = cz + Math.sin(a) * r
    world.tents.push({ x, y: world.height(x, z) - 0.2, z, sx: 3.2, sy: 3, sz: 3.2, ry: rnd() * Math.PI })
  }
  world.lamps.push({ x: cx, y: world.height(cx, cz), z: cz })
}

export function crystalCluster(world: WorldData, rnd: Rng, cx: number, cz: number, r: number, n: number, tall = 1) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2
    const d = Math.sqrt(rnd()) * r
    const x = cx + Math.cos(a) * d
    const z = cz + Math.sin(a) * d
    const s = 0.9 + rnd() * 1.1
    world.crystals.push({ x, y: world.height(x, z) - 0.6, z, sx: s, sy: (4 + rnd() * 7) * tall, sz: s, rx: (rnd() - 0.5) * 0.35, rz: (rnd() - 0.5) * 0.35, ry: rnd() * Math.PI })
  }
}

export function pinnacleCluster(world: WorldData, rnd: Rng, cx: number, cz: number, r: number, n: number, height: [number, number]) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2
    const d = Math.sqrt(rnd()) * r
    const x = cx + Math.cos(a) * d
    const z = cz + Math.sin(a) * d
    const s = 2 + rnd() * 3
    world.pinnacles.push({ x, y: world.height(x, z) - 1, z, sx: s, sy: lerp(height[0], height[1], rnd()), sz: s, rx: (rnd() - 0.5) * 0.16, rz: (rnd() - 0.5) * 0.16, ry: rnd() * Math.PI })
  }
}

export function fenceRun(world: WorldData, points: ReadonlyArray<readonly [number, number]>, y: (x: number, z: number) => number) {
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, az] = points[i]
    const [bx, bz] = points[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    const n = Math.max(1, Math.round(len / 2.4))
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n
      const x = lerp(ax, bx, t)
      const z = lerp(az, bz, t)
      world.fences.push({ x, y: y(x, z), z, ry: Math.atan2(bx - ax, bz - az), sx: 0.2, sy: 1.1, sz: len / n })
    }
  }
}

export const within = (x: number, z: number, cx: number, cz: number, r: number) => Math.hypot(x - cx, z - cz) < r
export { clamp }
