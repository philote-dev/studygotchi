/**
 * Geometry for the four vistas: everything merges into one vertex-coloured buffer per landmark
 * (flat per-face colours, a baked three-step facet shade and the haze toward the sky), so each
 * place you can see but never reach costs one draw call plus its one light.
 */
import * as THREE from 'three'
import { FRONTIER_PALETTE as P } from '../../layout/biome-layout'
import { type OuterDesert, type TrestlePlan } from './desert'
import { skyColour } from './mesh'
import type { Vista } from './vistas'

const DAY_LIGHT = new THREE.Vector3(95, 88, 125).normalize()
const NIGHT_LIGHT = new THREE.Vector3(-80, 75, 40).normalize()
const FACET_STEPS: [number, number, number] = [1, 0.82, 0.62]

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()
const _n = new THREE.Vector3()
const _t = new THREE.Vector3()
const _col = new THREE.Color()
const _sky = new THREE.Color()

/** Accumulates flat-shaded triangles with per-face colours into one non-indexed buffer. */
export class Batch {
  private pos: number[] = []
  private col: number[] = []
  private readonly light: THREE.Vector3

  constructor(
    private readonly night: boolean,
    private readonly haze = 0,
  ) {
    this.light = night ? NIGHT_LIGHT : DAY_LIGHT
    _sky.set(skyColour({ night }))
    this.skyR = _sky.r
    this.skyG = _sky.g
    this.skyB = _sky.b
  }

  private readonly skyR: number
  private readonly skyG: number
  private readonly skyB: number

  get triangles(): number {
    return this.pos.length / 9
  }

  /** Push a three.js geometry (indexed or not) through `m`, flat-coloured with the facet bake; `hazeOverride` for per-place aerial perspective. */
  geo(geometry: THREE.BufferGeometry, m: THREE.Matrix4 | null, color: string, facet = true, hazeOverride?: number): void {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry
    const positions = flat.attributes.position.array
    const base = _col.set(color)
    if (this.night) base.offsetHSL(0.02, 0.02, -0.18)
    const r = base.r
    const g = base.g
    const b = base.b
    for (let i = 0; i + 8 < positions.length; i += 9) {
      _a.set(positions[i], positions[i + 1], positions[i + 2])
      _b.set(positions[i + 3], positions[i + 4], positions[i + 5])
      _c.set(positions[i + 6], positions[i + 7], positions[i + 8])
      if (m) {
        _a.applyMatrix4(m)
        _b.applyMatrix4(m)
        _c.applyMatrix4(m)
      }
      _t.subVectors(_a, _b)
      _n.subVectors(_c, _b).cross(_t)
      if (_n.lengthSq() < 1e-10) continue
      _n.normalize()
      let step = 1
      if (facet) {
        const ndl = _n.dot(this.light)
        step = ndl > 0.62 ? FACET_STEPS[0] : ndl > 0.3 ? FACET_STEPS[1] : FACET_STEPS[2]
      }
      this.pos.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _c.x, _c.y, _c.z)
      const h = hazeOverride ?? this.haze
      const cr = r * step * (1 - h) + this.skyR * h
      const cg = g * step * (1 - h) + this.skyG * h
      const cb = b * step * (1 - h) + this.skyB * h
      for (let k = 0; k < 3; k++) this.col.push(cr, cg, cb)
    }
    if (flat !== geometry) flat.dispose()
    geometry.dispose()
  }

  box(w: number, h: number, d: number, m: THREE.Matrix4 | null, color: string, facet = true, haze?: number): void {
    this.geo(new THREE.BoxGeometry(w, h, d), m, color, facet, haze)
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3))
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3))
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
    return geo
  }
}

const _e = new THREE.Euler()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()

export function place(x: number, y: number, z: number, yaw = 0, tiltX = 0, tiltZ = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  _e.set(tiltX, yaw, tiltZ, 'YXZ')
  _q.setFromEuler(_e)
  _s.set(sx, sy, sz)
  _p.set(x, y, z)
  return new THREE.Matrix4().compose(_p, _q, _s)
}

export interface Built {
  geometry: THREE.BufferGeometry
  /** Local position of the one light. */
  lamp: [number, number, number]
  lampRadius: number
}

/** Haze baked into each vista: they are 350–440 m away and must read paler than the walls in front. */
export const VISTA_HAZE = { day: 0.4, night: 0.3 } as const

function vistaHaze(night: boolean): number {
  return night ? VISTA_HAZE.night : VISTA_HAZE.day
}

/* ---------- north: mesa-top settlement with a water tower ---------- */

/** Local frame: origin at the table top, +z toward the camera. */
export function buildMesaTown(night: boolean): Built {
  const batch = new Batch(night, vistaHaze(night))
  const houses: Array<[number, number, number, number, number, string, string]> = [
    // x, z, w, d, h, wall, roof
    [-14, 4, 7, 5.5, 4.2, P.sage, P.timberDark],
    [-5, 8, 6, 5, 3.8, P.timber, P.timberDark],
    [4, 6, 8, 6, 5.0, P.teal, P.oxblood],
    [13, 1, 6.5, 5, 4.0, P.timber, P.timberDark],
    [-10, -8, 6, 5, 3.6, P.canvas, P.timberDark],
    [8, -9, 7, 5.5, 4.4, P.sage, P.timberDark],
  ]
  for (const [x, z, w, d, h, wall, roof] of houses) {
    batch.box(w, h, d, place(x, h / 2, z, 0.12 * Math.sin(x)), wall)
    batch.box(w + 0.6, 0.5, d + 0.6, place(x, h + 0.25, z, 0.12 * Math.sin(x)), roof)
    batch.box(w * 0.9, 1.1, 0.4, place(x, h + 1.0, z + d / 2 + 0.1, 0.12 * Math.sin(x)), wall)
  }
  // Water tower: four legs, bands, tank and cap; the lamp box on the tank.
  const tx = 0
  const tz = -2
  for (const dx of [-1.6, 1.6]) for (const dz of [-1.6, 1.6]) batch.geo(new THREE.CylinderGeometry(0.22, 0.3, 9, 6), place(tx + dx, 4.5, tz + dz), P.timberDark)
  for (const y of [3, 6]) batch.box(4.2, 0.2, 4.2, place(tx, y, tz), P.timber, false)
  batch.geo(new THREE.CylinderGeometry(2.6, 2.6, 3.6, 10), place(tx, 10.8, tz), P.teal)
  batch.geo(new THREE.ConeGeometry(2.95, 1.1, 10), place(tx, 13.15, tz), P.oxblood)
  // Corral and a wind pump at the edge.
  batch.geo(new THREE.TorusGeometry(5, 0.12, 4, 14), place(-16, 1, -4, 0, Math.PI / 2), P.timber, false)
  batch.geo(new THREE.CylinderGeometry(0.16, 0.2, 8, 5), place(16, 4, -6), P.timberDark)
  batch.geo(new THREE.TorusGeometry(1.8, 0.14, 4, 10), place(16, 8.2, -5), P.canvas, false)
  return { geometry: batch.build(), lamp: [tx, 10.8, tz + 2.75], lampRadius: 0.55 }
}

/* ---------- east: timber trestle across the gorge, and the far train ---------- */

export interface TrestleBuilt {
  geometry: THREE.BufferGeometry
  /** Unit axis direction (near → far) in world xz. */
  dir: [number, number]
  /** World start / end of the rail line the train runs on (start inside the rail yard's engine shed, end inside the portal). */
  runStart: [number, number]
  runEnd: [number, number]
  /** Rail-top height every `profileStep` metres from `runStart`, for the train to follow. */
  profile: Float32Array
  profileStep: number
  deckY: number
}

/** Height along the run `s` metres from its start. */
export function runHeight(built: TrestleBuilt, s: number): number {
  const k = Math.max(0, Math.min(built.profile.length - 1.001, s / built.profileStep))
  const i = Math.floor(k)
  const t = k - i
  return built.profile[i] + (built.profile[i + 1] - built.profile[i]) * t
}

/**
 * World coordinates: the deck across the gorge with bents down to the heightfield, and the rails
 * following the ground from `yardStart` (inside the rail yard's engine shed) down the climbing
 * cutting, over the deck and into the portal rock.
 */
export function buildTrestle(desert: OuterDesert, plan: TrestlePlan, night: boolean, yardStart?: [number, number]): TrestleBuilt {
  const batch = new Batch(night, vistaHaze(night) * 0.8)
  const b = (plan.bearingDeg * Math.PI) / 180
  const dx = Math.sin(b)
  const dz = Math.cos(b)
  const yaw = Math.atan2(dx, dz)
  const deckY = plan.deckY
  const intoPortal = 14
  const start: [number, number] = yardStart ?? [plan.far[0] + dx * 110, plan.far[1] + dz * 110]
  const end: [number, number] = [plan.near[0] - dx * intoPortal, plan.near[1] - dz * intoPortal]
  const total = Math.hypot(end[0] - start[0], end[1] - start[1])
  // Along the run (0 at the start), where the deck span begins and ends.
  const sFar = Math.hypot(plan.far[0] - start[0], plan.far[1] - start[1])
  const sNear = sFar + plan.length
  const railTop = (s: number): number => {
    if (s >= sFar - 3 && s <= sNear + 3) return deckY + 0.42
    const x = start[0] + ((end[0] - start[0]) * s) / total
    const z = start[1] + ((end[1] - start[1]) * s) / total
    // The embankment carries the rails level from the near abutment into the portal.
    if (s > sNear) return Math.max(deckY + 0.42, desert.heightAt(x, z) + 0.32)
    return desert.heightAt(x, z) + 0.32
  }
  // Rails as 8 m segments that follow the rail-top profile; sleepers under them.
  const seg = 8
  for (let s = 0; s < total; s += seg) {
    const s1 = Math.min(total, s + seg)
    const y0 = railTop(s)
    const y1 = railTop(s1)
    const len = Math.hypot(s1 - s, y1 - y0)
    const pitch = -Math.atan2(y1 - y0, s1 - s)
    const mx = start[0] + ((end[0] - start[0]) * (s + s1)) / 2 / total
    const mz = start[1] + ((end[1] - start[1]) * (s + s1)) / 2 / total
    for (const side of [-0.72, 0.72]) batch.box(0.26, 0.26, len + 0.3, place(mx + Math.cos(yaw) * side, (y0 + y1) / 2, mz - Math.sin(yaw) * side, yaw, pitch), '#55483f', false)
    for (let k = 0; k < (s1 - s) / 2.4; k++) {
      const ss = s + k * 2.4
      const x = start[0] + ((end[0] - start[0]) * ss) / total
      const z = start[1] + ((end[1] - start[1]) * ss) / total
      batch.box(2.6, 0.18, 0.5, place(x, railTop(ss) - 0.2, z, yaw), P.timberDark, false)
    }
  }
  // Embankment from the near abutment to the portal.
  const embLen = total - sNear + 2
  batch.box(4.2, deckY, embLen, place(end[0] + dx * (embLen / 2 - 1), deckY / 2, end[1] + dz * (embLen / 2 - 1), yaw), P.strata, false)
  // Deck over the gorge only (the cutting and the yard carry the rails on the ground).
  const centre: [number, number] = [plan.x, plan.z]
  batch.box(3.2, 0.4, plan.length + 6, place(centre[0], deckY, centre[1], yaw), P.timber)
  for (const side of [-1.1, 1.1]) batch.box(0.5, 0.6, plan.length + 6, place(centre[0] + Math.cos(yaw) * side, deckY - 0.5, centre[1] - Math.sin(yaw) * side, yaw), P.timberDark, false)
  // Bents every 8 m: three posts to the ground, a sill, a cap and a cross brace.
  const bents = Math.floor(plan.length / 8)
  for (let i = 0; i <= bents; i++) {
    const t = -plan.length / 2 + i * 8
    const px = centre[0] + dx * t
    const pz = centre[1] + dz * t
    const ground = desert.heightAt(px, pz) - 1.5
    const h = deckY - 0.8 - ground
    if (h < 1.5) continue
    for (const side of [-1.3, 0, 1.3]) {
      const splay = side * (1 + h * 0.012)
      const cx = px + Math.cos(yaw) * splay
      const cz = pz - Math.sin(yaw) * splay
      batch.box(0.42, h, 0.42, place(cx, ground + h / 2, cz, yaw, 0, 0), P.timberDark, false)
    }
    batch.box(3.6, 0.36, 0.5, place(px, deckY - 0.95, pz, yaw), P.timber, false)
    for (let y = ground + 4; y < deckY - 2; y += 6) batch.box(3.2 + (deckY - y) * 0.03, 0.3, 0.3, place(px, y, pz, yaw, 0, 0.5), P.timber, false)
  }
  // The train's height table along the run.
  const profileStep = 2
  const profile = new Float32Array(Math.floor(total / profileStep) + 2)
  for (let i = 0; i < profile.length; i++) profile[i] = railTop(Math.min(total, i * profileStep)) + 0.1
  return { geometry: batch.build(), dir: [dx, dz], runStart: start, runEnd: end, profile, profileStep, deckY }
}

/** Local frame: the train runs along +z (front at +z); wheels on y = 0. ~34 m long. */
export function buildTrain(night: boolean): Built {
  const batch = new Batch(night, vistaHaze(night) * 0.8)
  // Locomotive: boiler, cab, chimney, cowcatcher, wheels.
  batch.geo(new THREE.CylinderGeometry(1.4, 1.4, 7, 10), place(0, 2.2, 10.5, 0, Math.PI / 2), P.ink)
  batch.box(3.2, 4, 3.4, place(0, 2.6, 5.6), P.oxblood)
  batch.box(3.6, 0.4, 3.8, place(0, 4.75, 5.6), P.ink, false)
  batch.geo(new THREE.CylinderGeometry(0.45, 0.6, 2.4, 8), place(0, 4.6, 12.6), P.ink)
  batch.box(2.6, 1.2, 1.2, place(0, 0.9, 14.5, 0, 0.6), P.timberDark)
  batch.box(3.4, 0.7, 11, place(0, 0.75, 8.5), P.ink, false)
  // Tender and two cars.
  batch.box(3.0, 2.4, 5, place(0, 1.9, 1), P.ink)
  batch.box(3.2, 3.4, 8.6, place(0, 2.4, -4.6), P.teal)
  batch.box(3.2, 3.4, 8.6, place(0, 2.4, -14), P.mustard)
  for (const z of [-4.6, -14]) batch.box(3.4, 0.4, 8.8, place(0, 4.3, z), P.ink, false)
  for (const z of [-16, -12, -6.4, -2.8, 0.6, 2.4, 7, 9.6, 12]) batch.box(3.3, 1.2, 0.6, place(0, 0.6, z), P.ink, false)
  return { geometry: batch.build(), lamp: [0, 3.2, 14.1], lampRadius: 0.5 }
}

/* ---------- south: mission across the dry lake ---------- */

/** Local frame: origin on the ground, +z toward the camera. */
export function buildMission(night: boolean): Built {
  const batch = new Batch(night, vistaHaze(night))
  const adobe = '#efe0bd'
  const adobeShade = '#dcc8a2'
  // Nave with a stepped bell gable facing the camera, and the tower beside it.
  batch.box(14, 6, 24, place(0, 3, -6), adobe)
  batch.box(14.6, 0.5, 24.6, place(0, 6.15, -6), adobeShade, false)
  batch.box(15, 8.5, 1.2, place(0, 4.25, 6.4), adobe)
  batch.box(9, 2.4, 1.2, place(0, 9.7, 6.4), adobe)
  batch.box(4, 2.0, 1.2, place(0, 11.9, 6.4), adobe)
  batch.box(0.4, 1.6, 0.4, place(0, 13.6, 6.4), P.timberDark, false)
  batch.box(1.4, 0.3, 0.3, place(0, 13.9, 6.4), P.timberDark, false)
  batch.box(2.6, 4, 0.6, place(0, 2, 7.1), P.oxblood, false)
  // Tower: shaft, belfry openings, cupola.
  batch.box(5, 18, 5, place(10.5, 9, 2), adobe)
  batch.box(5.6, 0.6, 5.6, place(10.5, 18.3, 2), adobeShade, false)
  for (const [ox, oz, w, d] of [
    [0, 2.6, 2.2, 0.5],
    [2.6, 0, 0.5, 2.2],
    [-2.6, 0, 0.5, 2.2],
  ]) batch.box(w, 3.2, d, place(10.5 + ox, 15.5, 2 + oz), P.ink, false)
  batch.box(3.4, 1.2, 3.4, place(10.5, 19.2, 2), adobe)
  batch.geo(new THREE.ConeGeometry(2.4, 2.4, 8), place(10.5, 21, 2), P.oxblood)
  batch.box(0.3, 1.4, 0.3, place(10.5, 22.6, 2), P.timberDark, false)
  // Courtyard wall, a well, three cottonwoods.
  batch.box(0.8, 2.2, 22, place(-9.5, 1.1, 0), adobeShade)
  batch.box(20, 2.2, 0.8, place(-0.5, 1.1, -19), adobeShade)
  batch.geo(new THREE.CylinderGeometry(1.4, 1.5, 1.2, 8), place(-4, 0.6, 12), P.strata)
  for (const [x, z, s] of [
    [-14, 8, 1.1],
    [-17, -4, 0.9],
    [17, -8, 1.2],
  ]) {
    batch.geo(new THREE.CylinderGeometry(0.4 * s, 0.55 * s, 5 * s, 5), place(x, 2.5 * s, z), P.timberDark)
    batch.geo(new THREE.DodecahedronGeometry(3.6 * s, 0), place(x, 7 * s, z, x), '#5f7d4a')
    batch.geo(new THREE.DodecahedronGeometry(2.6 * s, 0), place(x + 2 * s, 5.6 * s, z + 1.2 * s, z), '#6b8a52')
  }
  return { geometry: batch.build(), lamp: [10.5, 15.5, 4.9], lampRadius: 0.55 }
}

/* ---------- west: radio mast on a butte ---------- */

/** Local frame: origin on the butte top, +z toward the camera. The mast is `height` tall. */
export function buildMast(height: number, night: boolean): Built {
  const batch = new Batch(night, vistaHaze(night))
  const steel = '#4a3c36'
  const baseHalf = 3.2
  const topHalf = 0.7
  const segments = Math.max(4, Math.round(height / 4.5))
  for (let s = 0; s < segments; s++) {
    const y0 = (s / segments) * height
    const y1 = ((s + 1) / segments) * height
    const r0 = baseHalf + (topHalf - baseHalf) * (s / segments)
    const r1 = baseHalf + (topHalf - baseHalf) * ((s + 1) / segments)
    for (const [cx, cz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const x0 = cx * r0
      const z0 = cz * r0
      const x1 = cx * r1
      const z1 = cz * r1
      const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0)
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1), new THREE.Vector3(0, 1, 0))
      m.setPosition((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
      batch.geo(new THREE.BoxGeometry(0.28, 0.28, len), m, steel, false)
    }
    // Horizontal ring and one diagonal per face at the top of the segment.
    for (const face of [0, 1, 2, 3]) {
      const yaw = (face * Math.PI) / 2
      batch.box(r1 * 2, 0.2, 0.2, place(Math.sin(yaw) * r1, y1, Math.cos(yaw) * r1, yaw), steel, false)
      const diag = Math.hypot(r1 * 2, y1 - y0)
      batch.box(diag, 0.16, 0.16, place(Math.sin(yaw) * (r0 + r1) / 2, (y0 + y1) / 2, Math.cos(yaw) * (r0 + r1) / 2, yaw, 0, Math.atan2(y1 - y0, r1 * 2) * (face % 2 ? -1 : 1)), steel, false)
    }
  }
  // Dish and antenna at the top, the hut and a fuel tank at the foot, a guy wire each side.
  batch.geo(new THREE.CylinderGeometry(1.6, 0.4, 0.9, 8), place(1.8, height * 0.78, 0, 0, 0, Math.PI / 2 - 0.5), '#9a9a9a')
  batch.box(0.3, 4, 0.3, place(0, height + 2, 0), steel, false)
  batch.box(5, 3, 4, place(-7, 1.5, 3), P.teal)
  batch.box(5.4, 0.5, 4.4, place(-7, 3.2, 3), P.timberDark, false)
  batch.geo(new THREE.CylinderGeometry(1.1, 1.1, 3, 8), place(7, 1.5, 4, 0, 0, Math.PI / 2), '#8a8a8a')
  for (const side of [-1, 1]) {
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(side * 14, 0, -6), new THREE.Vector3(0, height * 0.75, 0), new THREE.Vector3(0, 1, 0))
    m.setPosition(side * 7, height * 0.375, -3)
    batch.geo(new THREE.BoxGeometry(0.12, 0.12, Math.hypot(14, height * 0.75, 6)), m, steel, false)
  }
  return { geometry: batch.build(), lamp: [0, height + 4.2, 0], lampRadius: 0.7 }
}
