import type { GeoKey } from './geometries'
import { TRIANGLES } from './geometries'
import type { HeightFn } from './heightfield'
import type { ColorKey } from './palette'
import { DEG, range, smoothstep, type Rng } from './rng'

/** One instance: metres, radians; sx/sy/sz are the primitive's size (sy = height for grounded shapes). */
export interface Placed {
  x: number
  y: number
  z: number
  yaw?: number
  pitch?: number
  roll?: number
  sx?: number
  sy?: number
  sz?: number
}

export interface Batch {
  geo: GeoKey
  color: ColorKey
  glow: boolean
  shadow: boolean
  items: Placed[]
}

/** Collects instances into (geometry, colour, glow) batches; one InstancedMesh per batch. */
export class Bag {
  readonly batches: Batch[] = []
  private readonly index = new Map<string, Batch>()

  put(geo: GeoKey, color: ColorKey, item: Placed, options: { glow?: boolean; shadow?: boolean } = {}): void {
    const glow = options.glow ?? false
    const shadow = options.shadow ?? true
    const key = `${geo}|${color}|${glow ? 1 : 0}|${shadow ? 1 : 0}`
    let batch = this.index.get(key)
    if (!batch) {
      batch = { geo, color, glow, shadow, items: [] }
      this.index.set(key, batch)
      this.batches.push(batch)
    }
    batch.items.push(item)
  }

  triangles(): number {
    return this.batches.reduce((sum, batch) => sum + batch.items.length * TRIANGLES[batch.geo], 0)
  }
}

export type Point = readonly [number, number]

/** Local (lx, lz) in a yawed frame → world; local +z is the "front" of every prop. */
export function toWorld(x: number, z: number, yaw: number, lx: number, lz: number): [number, number] {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [x + lx * c + lz * s, z - lx * s + lz * c]
}

/** Yaw that points a prop's front (+z) at a target. */
export function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z)
}

export function distanceToPolyline(x: number, z: number, line: readonly Point[]): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i]
    const [bx, bz] = line[i + 1]
    const dx = bx - ax
    const dz = bz - az
    const len2 = dx * dx + dz * dz || 1
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2))
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z))
  }
  return best
}

export function distanceToPolylines(x: number, z: number, lines: readonly (readonly Point[])[]): number {
  let best = Number.POSITIVE_INFINITY
  for (const line of lines) best = Math.min(best, distanceToPolyline(x, z, line))
  return best
}

/** Blue-noise-ish scatter: rejection sampling with a minimum spacing and a bounded attempt budget (the sampler owns the RNG). */
export function scatter(
  count: number,
  sample: () => Point,
  accept: (x: number, z: number) => boolean,
  minDist: number,
  attempts = count * 30,
): Point[] {
  const out: Point[] = []
  const min2 = minDist * minDist
  for (let a = 0; a < attempts && out.length < count; a++) {
    const [x, z] = sample()
    if (!accept(x, z)) continue
    let ok = true
    for (const [px, pz] of out) {
      const dx = px - x
      const dz = pz - z
      if (dx * dx + dz * dz < min2) {
        ok = false
        break
      }
    }
    if (ok) out.push([x, z])
  }
  return out
}

/** Terrain heights under a rotated footprint; houses only land where the terrace is flat enough. */
export function footprint(height: HeightFn, x: number, z: number, yaw: number, w: number, d: number): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const [lx, lz] of [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [-w / 2, d / 2],
    [w / 2, d / 2],
    [0, 0],
  ] as const) {
    const [wx, wz] = toWorld(x, z, yaw, lx, lz)
    const h = height(wx, wz)
    if (h < min) min = h
    if (h > max) max = h
  }
  return { min, max }
}

/**
 * Places a house on a terrace the way cliff towns do: the front half must be flat, the back may
 * dig into the riser behind it. Returns the base height or null when the slot does not work.
 */
export function houseSlot(height: HeightFn, x: number, z: number, yaw: number, w: number, d: number, h: number): number | null {
  const sample = (lx: number, lz: number) => {
    const [wx, wz] = toWorld(x, z, yaw, lx, lz)
    return height(wx, wz)
  }
  const front = [sample(-w / 2, d / 2), sample(w / 2, d / 2), sample(0, d / 2), sample(0, 0)]
  const back = [sample(-w / 2, -d / 2), sample(w / 2, -d / 2)]
  const base = Math.min(...front)
  if (Math.max(...front) - base > 1.5) return null
  if (Math.min(...back) < base - 0.9) return null
  if (Math.max(...back) > base + h * 0.85) return null
  return base - 0.1
}

/** Follows a height level around a centre by bisection along rays; `inset` moves the result toward the centre. */
export function contourPath(
  height: HeightFn,
  level: number,
  cx: number,
  cz: number,
  a0: number,
  a1: number,
  steps: number,
  rMin: number,
  rMax: number,
  inset = 0,
): Point[] {
  const points: Point[] = []
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const f = (r: number) => height(cx + ca * r, cz + sa * r) - level
    let lo = rMin
    let hi = rMax
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
    const r = (lo + hi) / 2 - inset
    points.push([cx + ca * r, cz + sa * r])
  }
  return points
}

/** A zigzag of `legs` straight runs between two points, offset alternately sideways by `amplitude`. */
export function zigzag(from: Point, to: Point, legs: number, amplitude: number): Point[] {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const len = Math.hypot(dx, dz) || 1
  const nx = -dz / len
  const nz = dx / len
  const points: Point[] = [from]
  for (let i = 1; i < legs; i++) {
    const t = i / legs
    const side = i % 2 ? 1 : -1
    points.push([from[0] + dx * t + nx * amplitude * side, from[1] + dz * t + nz * amplitude * side])
  }
  points.push(to)
  return points
}

/** Marches from a point toward a direction until the terrain drops below `level`; returns the crossing. */
export function shoreward(height: HeightFn, from: Point, towards: Point, level = 0.6, step = 1): Point {
  const dx = towards[0] - from[0]
  const dz = towards[1] - from[1]
  const len = Math.hypot(dx, dz) || 1
  const ux = dx / len
  const uz = dz / len
  let x = from[0]
  let z = from[1]
  for (let s = 0; s < 400; s++) {
    if (height(x, z) < level) return [x - ux * step, z - uz * step]
    x += ux * step
    z += uz * step
  }
  return [x, z]
}

export function samplePolyline(line: readonly Point[], spacing: number): Array<{ x: number; z: number; yaw: number }> {
  const out: Array<{ x: number; z: number; yaw: number }> = []
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i]
    const [bx, bz] = line[i + 1]
    const dx = bx - ax
    const dz = bz - az
    const len = Math.hypot(dx, dz)
    const n = Math.max(1, Math.round(len / spacing))
    const yaw = Math.atan2(dx, dz)
    for (let k = 0; k < n || (i + 2 === line.length && k === n); k++) {
      const t = k / n
      out.push({ x: ax + dx * t, z: az + dz * t, yaw })
    }
  }
  return out
}

/** Path / stair ribbon: slabs that each sit on the terrain, so on a slope they become steps. */
export function ribbon(
  bag: Bag,
  line: readonly Point[],
  height: HeightFn,
  options: { width: number; spacing: number; color: ColorKey; lift?: number; thick?: number; shadow?: boolean },
): void {
  const lift = options.lift ?? 0.18
  const thick = options.thick ?? 0.5
  for (const p of samplePolyline(line, options.spacing)) {
    const y = height(p.x, p.z) + lift
    bag.put('box', options.color, { x: p.x, y: y - thick, z: p.z, yaw: p.yaw, sx: options.width, sy: thick, sz: options.spacing * 1.2 }, { shadow: options.shadow ?? false })
  }
}

/** Stepping-stone causeway across water. */
export function causeway(bag: Bag, line: readonly Point[], spacing = 4.2, size = 3.2): void {
  for (const p of samplePolyline(line, spacing)) bag.put('box', 'stone', { x: p.x, y: -0.4, z: p.z, yaw: p.yaw + 0.3, sx: size, sy: 1.05, sz: size * 0.9 })
}

/** A wall of boxes along a polyline, one per segment (moles, quays, parapets, retaining walls). */
export function polyWall(bag: Bag, line: readonly Point[], yBase: number, h: number, width: number, color: ColorKey): void {
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i]
    const [bx, bz] = line[i + 1]
    const dx = bx - ax
    const dz = bz - az
    const len = Math.hypot(dx, dz)
    bag.put('box', color, { x: (ax + bx) / 2, y: yBase, z: (az + bz) / 2, yaw: Math.atan2(dx, dz), sx: width, sy: h, sz: len + width * 0.6 })
  }
}

export function arcPoints(cx: number, cz: number, radius: number, a0: number, a1: number, segments: number): Point[] {
  const points: Point[] = []
  for (let i = 0; i <= segments; i++) {
    const a = a0 + ((a1 - a0) * i) / segments
    points.push([cx + Math.cos(a) * radius, cz + Math.sin(a) * radius])
  }
  return points
}

/** Retaining wall that follows the terrain along a path (terrace crescents). */
export function terraceWall(bag: Bag, line: readonly Point[], height: HeightFn, h = 1.6, color: ColorKey = 'cliff'): void {
  for (const p of samplePolyline(line, 3)) bag.put('box', color, { x: p.x, y: height(p.x, p.z) - 0.4, z: p.z, yaw: p.yaw, sx: 0.9, sy: h + 0.4, sz: 3.6 })
}

/* ---------- props ---------- */

export function house(
  bag: Bag,
  rng: Rng,
  x: number,
  y: number,
  z: number,
  yaw: number,
  options: { blue?: boolean; storeys?: 1 | 2; w?: number; d?: number; h?: number } = {},
): void {
  const w = options.w ?? range(rng, 5, 8.5)
  const d = options.d ?? range(rng, 4.6, 7)
  const storeys = options.storeys ?? (rng() < 0.45 ? 2 : 1)
  const h = options.h ?? (storeys === 2 ? range(rng, 6.2, 7.4) : range(rng, 3.5, 4.4))
  const wall: ColorKey = options.blue ? 'blue' : 'white'
  bag.put('box', wall, { x, y: y - 0.7, z, yaw, sx: w, sy: h + 0.7, sz: d })
  const doorSide = rng() < 0.5 ? -1 : 1
  const [dx, dz] = toWorld(x, z, yaw, doorSide * w * 0.22, d / 2 + 0.07)
  bag.put('box', 'blue', { x: dx, y, z: dz, yaw, sx: 1.1, sy: 2.2, sz: 0.14 }, { shadow: false })
  const window = (lx: number, ly: number) => {
    const [wx, wz] = toWorld(x, z, yaw, lx, d / 2 + 0.07)
    bag.put('box', 'window', { x: wx, y: y + ly, z: wz, yaw, sx: 0.9, sy: 1.05, sz: 0.12 }, { glow: true, shadow: false })
  }
  window(-doorSide * w * 0.24, 1.5)
  if (storeys === 2) {
    window(-w * 0.26, h - 2.4)
    window(w * 0.26, h - 2.4)
    if (rng() < 0.4) {
      const [ux, uz] = toWorld(x, z, yaw, 0, -d * 0.12)
      bag.put('box', wall, { x: ux, y: y + h, z: uz, yaw, sx: w * 0.55, sy: 2.4, sz: d * 0.62 })
    }
  }
}

export function chapel(bag: Bag, x: number, y: number, z: number, yaw: number, s = 1): void {
  bag.put('box', 'white', { x, y: y - 0.5, z, yaw, sx: 7 * s, sy: 5 * s + 0.5, sz: 5.5 * s })
  bag.put('dome', 'blue', { x, y: y + 5 * s, z, sx: 2.9 * s, sy: 2.5 * s, sz: 2.9 * s })
  const [bx, bz] = toWorld(x, z, yaw, -3.1 * s, 0)
  bag.put('box', 'white', { x: bx, y: y + 5 * s, z: bz, yaw, sx: 0.7 * s, sy: 3.2 * s, sz: 2.4 * s })
  bag.put('dome', 'blue', { x: bx, y: y + 8.2 * s, z: bz, sx: 0.9 * s, sy: 0.7 * s, sz: 0.9 * s })
  const [wx, wz] = toWorld(x, z, yaw, 1.4 * s, 2.75 * s + 0.07)
  bag.put('box', 'window', { x: wx, y: y + 2 * s, z: wz, yaw, sx: 0.8, sy: 1.6 * s, sz: 0.12 }, { glow: true, shadow: false })
  const [ex, ez] = toWorld(x, z, yaw, -1 * s, 2.75 * s + 0.07)
  bag.put('box', 'blue', { x: ex, y, z: ez, yaw, sx: 1.2, sy: 2.6 * s, sz: 0.14 }, { shadow: false })
}

/** Row of columns with capitals and lintels over every unbroken pair. `ruin` is the broken fraction. */
export function colonnade(
  bag: Bag,
  rng: Rng,
  x: number,
  y: number,
  z: number,
  yaw: number,
  count: number,
  spacing: number,
  h: number,
  ruin: number,
  radius = 0.55,
): void {
  let previousStanding = false
  for (let i = 0; i < count; i++) {
    const lx = (i - (count - 1) / 2) * spacing
    const [wx, wz] = toWorld(x, z, yaw, lx, 0)
    const broken = rng() < ruin
    const ch = broken ? range(rng, 1.2, h * 0.55) : h
    bag.put('column', 'stone', { x: wx, y, z: wz, sx: radius, sy: ch, sz: radius })
    if (!broken) {
      bag.put('box', 'stone', { x: wx, y: y + ch, z: wz, yaw, sx: radius * 2.6, sy: 0.5, sz: radius * 2.6 })
      if (previousStanding) {
        const [mx, mz] = toWorld(x, z, yaw, lx - spacing / 2, 0)
        bag.put('box', 'ruin', { x: mx, y: y + ch + 0.5, z: mz, yaw, sx: spacing + radius, sy: 0.8, sz: radius * 2.2 })
      }
    }
    previousStanding = !broken
  }
}

/** Ring (or arc) of columns; broken ones are stumps, `fallen` of them lie on the floor. */
export function columnRing(
  bag: Bag,
  rng: Rng,
  cx: number,
  y: number,
  cz: number,
  radius: number,
  count: number,
  h: number,
  ruin: number,
  fallen = 0,
  a0 = 0,
  a1 = Math.PI * 2,
  colRadius = 0.6,
): void {
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6
  const n = full ? count : count - 1
  let previousStanding = false
  for (let i = 0; i < count; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    const x = cx + Math.cos(a) * radius
    const z = cz + Math.sin(a) * radius
    if (i < fallen) {
      const yaw = a + Math.PI / 2 + range(rng, -0.4, 0.4)
      bag.put('column', 'stone', { x, y: y + colRadius, z, yaw, pitch: Math.PI / 2 - 0.05, sx: colRadius, sy: h * 0.8, sz: colRadius })
      previousStanding = false
      continue
    }
    const broken = rng() < ruin
    const ch = broken ? range(rng, 0.8, h * 0.5) : h
    bag.put('column', 'stone', { x, y, z, sx: colRadius, sy: ch, sz: colRadius })
    if (!broken) {
      bag.put('box', 'stone', { x, y: y + ch, z, yaw: -a, sx: colRadius * 2.6, sy: 0.5, sz: colRadius * 2.6 })
      if (previousStanding) {
        const am = a - (a1 - a0) / n / 2
        const chord = 2 * radius * Math.sin((a1 - a0) / n / 2)
        bag.put('box', 'ruin', { x: cx + Math.cos(am) * radius, y: y + ch + 0.5, z: cz + Math.sin(am) * radius, yaw: -am, sx: colRadius * 2.2, sy: 0.8, sz: chord + colRadius })
      }
    }
    previousStanding = !broken
  }
}

export function lampPost(bag: Bag, x: number, y: number, z: number): void {
  bag.put('box', 'ruinDark', { x, y, z, sx: 0.2, sy: 3.1, sz: 0.2 }, { shadow: false })
  bag.put('blob', 'window', { x, y: y + 3.3, z, sx: 0.36, sy: 0.36, sz: 0.36 }, { glow: true, shadow: false })
}

export function cypress(bag: Bag, x: number, y: number, z: number, h: number): void {
  bag.put('cone', 'cypress', { x, y: y - 0.2, z, sx: h * 0.17, sy: h, sz: h * 0.17 })
}

export function olive(bag: Bag, rng: Rng, x: number, y: number, z: number): void {
  const s = range(rng, 2.1, 3.1)
  bag.put('box', 'timber', { x, y: y - 0.2, z, sx: 0.45, sy: 1.6, sz: 0.45 }, { shadow: false })
  bag.put('blob', 'olive', { x, y: y + 1.1 + s * 0.6, z, yaw: rng() * Math.PI, sx: s, sy: s * 0.72, sz: s })
}

export function tent(bag: Bag, x: number, y: number, z: number): void {
  bag.put('cone', 'white', { x, y: y - 0.1, z, yaw: 0.3, sx: 3.2, sy: 2.6, sz: 3.2 })
}

export function crates(bag: Bag, rng: Rng, x: number, y: number, z: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const s = range(rng, 0.9, 1.5)
    bag.put('box', 'timber', { x: x + range(rng, -3, 3), y, z: z + range(rng, -3, 3), yaw: rng() * 1.5, sx: s, sy: s, sz: s }, { shadow: false })
  }
}

export function boat(bag: Bag, rng: Rng, x: number, y: number, z: number, yaw: number, s = 1): void {
  bag.put('box', 'white', { x, y: y - 0.3, z, yaw, sx: 1.6 * s, sy: 1.0 * s, sz: 4.4 * s }, { shadow: false })
  bag.put('box', 'blue', { x, y: y + 0.42 * s, z, yaw, sx: 1.7 * s, sy: 0.24 * s, sz: 4.5 * s }, { shadow: false })
  const [bx, bz] = toWorld(x, z, yaw, 0, 2.5 * s)
  bag.put('box', 'white', { x: bx, y: y - 0.2, z: bz, yaw: yaw + Math.PI / 4, sx: 1.1 * s, sy: 0.9 * s, sz: 1.1 * s }, { shadow: false })
  if (rng() < 0.6) {
    bag.put('box', 'timber', { x, y: y + 0.6, z, yaw, sx: 0.14, sy: 4.6 * s, sz: 0.14 }, { shadow: false })
    const [sx, sz] = toWorld(x, z, yaw, 0, -0.9 * s)
    bag.put('box', 'white', { x: sx, y: y + 1.6, z: sz, yaw, sx: 0.08, sy: 3.1 * s, sz: 1.7 * s }, { shadow: false })
  }
}

/** Windmill tower; returns the sail hub so the renderer can spin the sails. */
export function windmill(bag: Bag, x: number, y: number, z: number, yaw: number): { x: number; y: number; z: number; yaw: number } {
  bag.put('cylinder', 'white', { x, y: y - 0.6, z, sx: 3.4, sy: 10.6, sz: 3.4 })
  bag.put('cone', 'ruinDark', { x, y: y + 10, z, yaw, sx: 4, sy: 3.2, sz: 4 })
  const [dx, dz] = toWorld(x, z, yaw, 1.2, 3.42)
  bag.put('box', 'blue', { x: dx, y, z: dz, yaw, sx: 1.2, sy: 2.4, sz: 0.14 }, { shadow: false })
  const [hx, hz] = toWorld(x, z, yaw, 0, 4.2)
  bag.put('box', 'timber', { x: (x + hx) / 2, y: y + 8.8, z: (z + hz) / 2, yaw, sx: 0.36, sy: 0.36, sz: 4.4 }, { shadow: false })
  return { x: hx, y: y + 8.95, z: hz, yaw }
}

/** The Archive-Beacon (s3): plinth, three-bay arcade, map room, asymmetric two-prong mast, shielded lamp. */
export function archiveBeacon(bag: Bag, x: number, y: number, z: number, yaw: number, s: number): [number, number, number] {
  const put = (geo: GeoKey, color: ColorKey, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, glow = false) => {
    const [wx, wz] = toWorld(x, z, yaw, lx * s, lz * s)
    bag.put(geo, color, { x: wx, y: y + ly * s, z: wz, yaw, sx: sx * s, sy: sy * s, sz: sz * s }, { glow, shadow: !glow })
  }
  put('cylinder', 'cliff', 0, -1.2, 0, 7.4, 1.9, 7.4)
  put('cylinder', 'cap', 0, 0.6, 0, 7, 0.3, 7)
  put('box', 'ruin', 0, 0.85, 0, 9, 0.8, 7)
  put('box', 'white', -1.1, 3.7, -3.3, 6.2, 0.6, 0.8)
  put('box', 'white', 1.3, 4.5, 3.4, 5.6, 0.6, 0.8)
  for (const cx of [-3.2, 0, 3.2]) {
    for (const cz of [-1.9, 1.9]) put('column', 'white', cx, 1.6, cz, 0.6, 7.3, 0.6)
    put('box', 'ruin', cx, 8.9, 0, 2.8, 0.6, 4.8)
    put('box', 'window', cx, 5, 2.2, 1.1, 1.5, 0.12, true)
  }
  put('box', 'white', 0, 9.5, 0, 7.2, 2.6, 5.2)
  for (const cx of [-2, 0, 2]) put('box', 'window', cx, 10.3, 2.66, 1, 0.9, 0.12, true)
  put('box', 'blue', -1.7, 12.1, 0, 0.7, 5.2, 0.7)
  put('box', 'ruinDark', 1.7, 12.1, 0, 0.7, 6.4, 0.7)
  put('box', 'ruinDark', 1.7, 18.3, 0, 1.6, 0.25, 1.6)
  put('blob', 'window', 1.7, 19.1, 0, 0.8, 0.8, 0.8, true)
  const [lx, lz] = toWorld(x, z, yaw, 1.7 * s, 0)
  return [lx, y + 19.1 * s, lz]
}

/** Deep well: dark shaft disc, parapet ring, four lamp posts. */
export function well(bag: Bag, x: number, y: number, z: number, radius: number): void {
  bag.put('cylinder', 'dark', { x, y: y - 0.3, z, sx: radius, sy: 0.42, sz: radius }, { shadow: false })
  bag.put('ring', 'stone', { x, y: y - 0.1, z, sx: radius + 0.7, sy: 1.1, sz: radius + 0.7 })
  bag.put('ring', 'stone', { x, y: y + 1.0, z, sx: radius + 1.0, sy: 0.3, sz: radius + 1.0 })
  for (let i = 0; i < 4; i++) {
    const a = i * (Math.PI / 2) + Math.PI / 4
    lampPost(bag, x + Math.cos(a) * (radius + 3.5), y, z + Math.sin(a) * (radius + 3.5))
  }
}

export function vineCanopy(bag: Bag, x: number, y: number, z: number, w: number, d: number): void {
  for (const [lx, lz] of [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [-w / 2, d / 2],
    [w / 2, d / 2],
  ] as const) bag.put('box', 'timber', { x: x + lx, y, z: z + lz, sx: 0.22, sy: 3.2, sz: 0.22 }, { shadow: false })
  bag.put('blob', 'vine', { x, y: y + 3.6, z, sx: w * 0.6, sy: 0.9, sz: d * 0.6 })
  bag.put('blob', 'vine', { x: x + w * 0.22, y: y + 3.5, z: z - d * 0.18, yaw: 0.7, sx: w * 0.42, sy: 0.8, sz: d * 0.5 })
}

/** Tilted hemisphere, mostly submerged: a dome that fell off a drowned forum chapel. */
export function domeFragment(bag: Bag, x: number, y: number, z: number, radius: number, yaw: number, pitch: number): void {
  bag.put('dome', 'ruin', { x, y, z, yaw, pitch, sx: radius, sy: radius * 0.9, sz: radius })
}

/** Spiral stair hugging a sea stack whose rock radius shrinks with height. */
export function spiralStair(bag: Bag, cx: number, cz: number, radiusAt: (y: number) => number, top: number, turns: number, a0: number, steps: number): void {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const y = t * top
    const a = a0 + t * turns * Math.PI * 2
    const r = radiusAt(y) + 1.1
    bag.put('box', 'stair', { x: cx + Math.cos(a) * r, y: y - 0.3, z: cz + Math.sin(a) * r, yaw: -a, sx: 2.6, sy: 0.5, sz: 1.5 }, { shadow: false })
  }
}

export { DEG, smoothstep }
