import * as THREE from 'three'
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js'

/**
 * Shared maths for the jungle blockouts: seeded randomness (procedural-gen skill: one rng per
 * field, no global random), simplex fBm for terrain warps, polyline distance for carving rivers
 * and gorges, Catmull-Rom path smoothing, and the unit geometries every instanced prop reuses.
 */
export type V2 = readonly [number, number]
export type V3 = readonly [number, number, number]
export type Rng = () => number
export type HeightFn = (x: number, z: number) => number

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** 0..1 → 0..1 as `levels` flat steps joined by short ramps (`ramp` = fraction of each step that climbs). */
export function stepped(t: number, levels: number, ramp = 0.3): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const f = t * levels
  const i = Math.floor(f)
  const climb = smoothstep(1 - ramp, 1, f - i)
  return (i + climb) / levels
}

/** Piecewise profile through `[at, value]` controls, smoothstepped between neighbours. */
export function profile(r: number, controls: readonly V2[]): number {
  if (r <= controls[0][0]) return controls[0][1]
  for (let i = 1; i < controls.length; i++) {
    const [r1, h1] = controls[i]
    if (r <= r1) {
      const [r0, h0] = controls[i - 1]
      return lerp(h0, h1, smoothstep(r0, r1, r))
    }
  }
  return controls[controls.length - 1][1]
}

export function mulberry(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const range = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo)

export class Noise {
  private readonly simplex: SimplexNoise

  constructor(seed: number) {
    this.simplex = new SimplexNoise({ random: mulberry(seed) })
  }

  /** Single octave, −1..1. */
  at(x: number, y: number): number {
    return this.simplex.noise(x, y)
  }

  /** Fractal Brownian motion, −1..1, per-octave offsets so octaves do not correlate at the origin. */
  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let total = 0
    let amp = 1
    let freq = 1
    let norm = 0
    for (let i = 0; i < octaves; i++) {
      total += amp * this.simplex.noise(x * freq + i * 5.3, y * freq + i * 9.1)
      norm += amp
      amp *= gain
      freq *= lacunarity
    }
    return total / norm
  }
}

export interface PolyHit {
  /** Distance to the nearest point of the polyline. */
  d: number
  /** Arc-length fraction 0..1 of that nearest point. */
  t: number
  /** Sign of cross(segment, point − segment start): which side of the line the point lies on. */
  side: number
}

export function polylineDistance(x: number, z: number, pts: readonly V2[]): PolyHit {
  let best = Infinity
  let bestT = 0
  let bestSide = 1
  let total = 0
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0]
    const az = pts[i - 1][1]
    const vx = pts[i][0] - ax
    const vz = pts[i][1] - az
    const len2 = vx * vx + vz * vz
    const segLen = Math.sqrt(len2)
    const u = len2 > 0 ? clamp(((x - ax) * vx + (z - az) * vz) / len2, 0, 1) : 0
    const d = Math.hypot(x - (ax + vx * u), z - (az + vz * u))
    if (d < best) {
      best = d
      bestT = total > 0 ? (acc + u * segLen) / total : 0
      bestSide = Math.sign(vx * (z - az) - vz * (x - ax)) || 1
    }
    acc += segLen
  }
  return { d: best, t: bestT, side: bestSide }
}

/** Smooth a 2D polyline with a centripetal Catmull-Rom spline and resample it every ~`step` metres. */
export function smoothPath(points: readonly V2[], step: number, closed = false): V2[] {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    closed,
    'centripetal',
  )
  const divisions = Math.max(2, Math.round(curve.getLength() / step))
  return curve.getSpacedPoints(divisions).map((p) => [p.x, p.z] as const)
}

/** Flat strip along a 3D centreline, `width` wide, wound counter-clockwise seen from above. */
export function ribbonGeometry(points: readonly V3[], width: number): THREE.BufferGeometry {
  const n = points.length
  const left: number[][] = []
  const right: number[][] = []
  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)]
    const next = points[Math.min(n - 1, i + 1)]
    let dx = next[0] - prev[0]
    let dz = next[2] - prev[2]
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    const px = (-dz * width) / 2
    const pz = (dx * width) / 2
    left.push([points[i][0] + px, points[i][1], points[i][2] + pz])
    right.push([points[i][0] - px, points[i][1], points[i][2] - pz])
  }
  const positions = new Float32Array((n - 1) * 18)
  let o = 0
  const put = (p: number[]) => {
    positions[o++] = p[0]
    positions[o++] = p[1]
    positions[o++] = p[2]
  }
  for (let i = 0; i < n - 1; i++) {
    put(left[i])
    put(left[i + 1])
    put(right[i + 1])
    put(left[i])
    put(right[i + 1])
    put(right[i])
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

/** Jittered-grid scatter (blue-noise-ish spacing without clumps); `accept` returns a keep probability. */
export function jitteredGrid(rng: Rng, half: number, spacing: number, accept: (x: number, z: number) => number): V2[] {
  const out: V2[] = []
  for (let gz = -half; gz < half; gz += spacing) {
    for (let gx = -half; gx < half; gx += spacing) {
      const x = gx + rng() * spacing
      const z = gz + rng() * spacing
      const roll = rng()
      const p = accept(x, z)
      if (p > 0 && roll < p) out.push([x, z])
    }
  }
  return out
}

/** Points around an ellipse (used for ring roads and shorelines). */
export function ring(cx: number, cz: number, rx: number, rz: number, count: number, from = 0, to = Math.PI * 2): V2[] {
  const closed = to - from >= Math.PI * 2 - 1e-6
  const denominator = closed ? count : Math.max(1, count - 1)
  const out: V2[] = []
  for (let i = 0; i < count; i++) {
    const a = from + ((to - from) * i) / denominator
    out.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz])
  }
  return out
}

const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _e = new THREE.Euler()
const _m = new THREE.Matrix4()
const _up = new THREE.Vector3(0, 1, 0)

export function placeMatrix(m: THREE.Matrix4, x: number, y: number, z: number, yaw = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  _p.set(x, y, z)
  _e.set(0, yaw, 0)
  _q.setFromEuler(_e)
  _s.set(sx, sy, sz)
  return m.compose(_p, _q, _s)
}

/** A unit box stretched along the segment `from → to` (local +z), `width` across, `thickness` tall. */
export function segmentMatrix(m: THREE.Matrix4, from: THREE.Vector3, to: THREE.Vector3, width: number, thickness: number, lengthScale = 1): THREE.Matrix4 {
  const len = from.distanceTo(to)
  _p.copy(from).add(to).multiplyScalar(0.5)
  _m.lookAt(to, from, _up)
  _q.setFromRotationMatrix(_m)
  _s.set(width, thickness, len * lengthScale)
  return m.compose(_p, _q, _s)
}

export function mats(count: number, fill: (index: number, m: THREE.Matrix4) => void): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = []
  for (let i = 0; i < count; i++) {
    const m = new THREE.Matrix4()
    fill(i, m)
    out.push(m)
  }
  return out
}

function based<T extends THREE.BufferGeometry>(geometry: T): T {
  geometry.translate(0, 0.5, 0)
  return geometry
}

/** Unit geometries shared by every instanced prop (never disposed; a few hundred bytes each). */
export const G = {
  /** Centred unit box. */
  boxC: new THREE.BoxGeometry(1, 1, 1),
  /** Unit box with its base on y = 0. */
  boxB: based(new THREE.BoxGeometry(1, 1, 1)),
  /** 20-facet blob for canopies, foam, creatures. */
  ico: new THREE.IcosahedronGeometry(1, 0),
  /** Tapered five-sided trunk, base on y = 0. */
  trunkB: based(new THREE.CylinderGeometry(0.72, 1, 1, 5, 1, true)),
  /** Six-sided column, base on y = 0. */
  columnB: based(new THREE.CylinderGeometry(1, 1, 1, 6, 1, false)),
  /** Four-sided stilt, open, base on y = 0. */
  stiltB: based(new THREE.CylinderGeometry(1, 1, 1, 4, 1, true)),
  /** Square pyramid roof, base on y = 0, faces aligned to a box. */
  roofB: based(new THREE.ConeGeometry(1, 1, 4, 1, false).rotateY(Math.PI / 4)),
  /** Eight-sided disc for decks and wheels (centred). */
  disc: new THREE.CylinderGeometry(1, 1, 1, 8, 1, false),
  /** Eight-sided open wall ring for tower floors, base on y = 0. */
  wall8: based(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true)),
  /** Eight-sided open cone for tower roofs and pod caps, base on y = 0. */
  cone8: based(new THREE.ConeGeometry(1, 1, 8, 1, true)),
  /** Glow point. */
  glow: new THREE.OctahedronGeometry(1, 0),
}

/** A unit box leaning `lean` radians off vertical (about its local z) then yawed; base at the given point. */
export function leanMatrix(m: THREE.Matrix4, x: number, y: number, z: number, yaw: number, lean: number, sx: number, sy: number, sz: number): THREE.Matrix4 {
  _p.set(x, y, z)
  _e.set(0, yaw, lean)
  _q.setFromEuler(_e)
  _s.set(sx, sy, sz)
  return m.compose(_p, _q, _s)
}
