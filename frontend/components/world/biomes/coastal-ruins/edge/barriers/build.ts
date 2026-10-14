/**
 * Geometry for the barriers: everything is merged into a handful of vertex-coloured buffers so
 * the whole enclosure costs a few draw calls. Flat (per-face) normals and a baked three-step facet
 * shade, like the land's toon ramp, so the pale limestone keeps its facets under the haze.
 */
import * as THREE from 'three'
import { COASTAL_PALETTE as P, seeded } from '../../layout/biome-layout'
import type { BarrierPlan, Massif, Vista } from './geography'

const DAY_LIGHT = new THREE.Vector3(80, 120, 75).normalize()
const NIGHT_LIGHT = new THREE.Vector3(-60, 80, 35).normalize()
/** Baked facet shade (lit / half / shade), read at 250–500 m through the haze. */
const FACET_STEPS: [number, number, number] = [1, 0.84, 0.66]
/** Cream tops keep more of their light on the shade side. */
const TOP_STEPS: [number, number, number] = [1, 0.92, 0.8]

/** Roots: every wall continues this far under the water so no base ever floats. */
export const ROOT_DEPTH = 8

/** The coast's flat colours: warm limestone, a paler weathered face, the cream cap, scrub, the wet band. */
export const TONE = {
  warm: P.cliff,
  pale: '#cfa987',
  top: P.ground,
  scrub: P.olive,
  deep: '#8a6a52',
  ruin: P.ruin,
  plaster: P.plaster,
} as const

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()
const _n = new THREE.Vector3()
const _t = new THREE.Vector3()
const _e = new THREE.Euler()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const _col = new THREE.Color()

/** Accumulates flat-shaded triangles with per-face colours into one non-indexed buffer. */
export class Batch {
  private pos: number[] = []
  private col: number[] = []
  private readonly light: THREE.Vector3
  private readonly haze: THREE.Color

  /**
   * `hazeAmount` bakes atmosphere into the colours (lerp toward the sky): the vistas are far places.
   * `hazeByY` replaces it with a per-face amount from the face's height (a skyline that dissolves upward).
   */
  constructor(
    private readonly night: boolean,
    private readonly hazeAmount = 0,
    private hazeByY: ((y: number) => number) | null = null,
  ) {
    this.light = night ? NIGHT_LIGHT : DAY_LIGHT
    this.haze = new THREE.Color(night ? P.skyNight : P.sky)
  }

  /** Switch the height-driven haze on or off for the parts pushed after this call. */
  hazeGradient(fn: ((y: number) => number) | null): void {
    this.hazeByY = fn
  }

  get triangles(): number {
    return this.pos.length / 9
  }

  /** Push raw local-space triangles (9 floats each) through `m`, coloured flat with the facet bake. */
  tris(positions: ArrayLike<number>, m: THREE.Matrix4 | null, color: string, facet = true): void {
    const base = _col.set(color)
    if (this.night) base.offsetHSL(0.02, -0.08, -0.27)
    const r = base.r
    const g = base.g
    const b = base.b
    const steps = color === TONE.top || color === TONE.plaster ? TOP_STEPS : FACET_STEPS
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
        step = ndl > 0.62 ? steps[0] : ndl > 0.3 ? steps[1] : steps[2]
      }
      this.pos.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _c.x, _c.y, _c.z)
      const h = this.hazeByY ? this.hazeByY((_a.y + _b.y + _c.y) / 3) : this.hazeAmount
      const cr = r * step * (1 - h) + this.haze.r * h
      const cg = g * step * (1 - h) + this.haze.g * h
      const cb = b * step * (1 - h) + this.haze.b * h
      for (let k = 0; k < 3; k++) this.col.push(cr, cg, cb)
    }
  }

  /** Push a three.js geometry (indexed or not) through `m`. */
  geo(geometry: THREE.BufferGeometry, m: THREE.Matrix4 | null, color: string, facet = true): void {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry
    this.tris(flat.attributes.position.array, m, color, facet)
    if (flat !== geometry) flat.dispose()
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

export function place(x: number, y: number, z: number, yaw = 0, tiltX = 0, tiltZ = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  _e.set(tiltX, yaw, tiltZ, 'YXZ')
  _q.setFromEuler(_e)
  _s.set(sx, sy, sz)
  _p.set(x, y, z)
  return new THREE.Matrix4().compose(_p, _q, _s)
}

/** Push triangle (a, b, c), flipped if its normal points away from `outward`. */
function pushTri(out: number[], a: number[], b: number[], c: number[], outward: number[]): void {
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const uz = b[2] - a[2]
  const vx = c[0] - a[0]
  const vy = c[1] - a[1]
  const vz = c[2] - a[2]
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const flip = nx * outward[0] + ny * outward[1] + nz * outward[2] < 0
  if (flip) out.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2])
  else out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
}

/* ---------- faceted prisms ---------- */

export interface PrismSpec {
  sides: number
  rx: number
  rz: number
  /** Top polygon as a fraction of the base. */
  taper: number
  y0: number
  y1: number
  /** Per-corner radial jitter (0 = regular polygon). */
  jitter: number
  /** Lean of the top polygon, local metres. */
  lean?: [number, number]
  rng: () => number
  /** Skip the top cap (a stack with a slab over it). */
  open?: boolean
}

/** Irregular faceted prism around the local origin: sides plus a fan top. Returns local triangles. */
export function prism(spec: PrismSpec): number[] {
  const { sides, rx, rz, taper, y0, y1, jitter, rng } = spec
  const lean = spec.lean ?? [0, 0]
  const base: Array<[number, number]> = []
  const top: Array<[number, number]> = []
  const phase = rng() * Math.PI * 2
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * Math.PI * 2 + (rng() - 0.5) * (Math.PI / sides) * 0.8
    const jb = 1 + (rng() - 0.5) * 2 * jitter
    const jt = 1 + (rng() - 0.5) * 2 * jitter * 0.7
    base.push([Math.cos(a) * rx * jb, Math.sin(a) * rz * jb])
    top.push([Math.cos(a) * rx * taper * jt + lean[0], Math.sin(a) * rz * taper * jt + lean[1]])
  }
  const out: number[] = []
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    const b0 = [base[i][0], y0, base[i][1]]
    const b1 = [base[j][0], y0, base[j][1]]
    const t0 = [top[i][0], y1, top[i][1]]
    const t1 = [top[j][0], y1, top[j][1]]
    const outward = [(b0[0] + b1[0] + t0[0] + t1[0]) / 4 - lean[0] / 2, 0, (b0[2] + b1[2] + t0[2] + t1[2]) / 4 - lean[1] / 2]
    pushTri(out, b0, t1, t0, outward)
    pushTri(out, b0, b1, t1, outward)
  }
  if (!spec.open && taper > 0.02) {
    let cx = 0
    let cz = 0
    for (const [x, z] of top) {
      cx += x / sides
      cz += z / sides
    }
    const up = [0, 1, 0]
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides
      pushTri(out, [cx, y1, cz], [top[j][0], y1, top[j][1]], [top[i][0], y1, top[i][1]], up)
    }
  }
  return out
}

/* ---------- the ring ---------- */

function scrubTufts(batch: Batch, m: THREE.Matrix4, count: number, spread: number, y: number, rng: () => number): void {
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2
    const d = rng() * spread
    const tuft = new THREE.DodecahedronGeometry(0.9 + rng() * 1.1, 0)
    const local = place(Math.cos(a) * d, y + 0.5, Math.sin(a) * d, rng() * 3, 0, 0, 1, 0.55, 1)
    batch.geo(tuft, local.premultiply(m), TONE.scrub)
    tuft.dispose()
  }
}

function massifInto(batch: Batch, m: Massif, rng: () => number): void {
  const body = m.tone === 0 ? TONE.warm : TONE.pale
  const at = place(m.x, 0, m.z, m.yaw, m.tilt, (rng() - 0.5) * 0.05)
  switch (m.kind) {
    case 'arch': {
      const span = m.span ?? 22
      const R = span / 2
      const tube = Math.min(4.2, m.height * 0.22)
      const crownY = m.height - R - tube
      const torus = new THREE.TorusGeometry(R, tube, 5, 9, Math.PI)
      batch.geo(torus, place(m.x, Math.max(2, crownY), m.z, m.yaw, 0, 0), body)
      torus.dispose()
      for (const side of [-1, 1]) {
        const leg = place(m.x + Math.cos(m.yaw) * side * R, 0, m.z - Math.sin(m.yaw) * side * R, m.yaw)
        batch.tris(prism({ sides: 7, rx: tube * 1.3, rz: tube * 1.15, taper: 0.8, y0: -ROOT_DEPTH, y1: Math.max(2, crownY) + 1, jitter: 0.12, rng }), leg, body)
        batch.tris(prism({ sides: 6, rx: tube * 1.35, rz: tube * 1.2, taper: 0.98, y0: -ROOT_DEPTH, y1: 1.1, jitter: 0.08, rng, open: true }), leg, TONE.deep, false)
      }
      // Cream cap along the crown and a scrub tuft on each shoulder.
      const crown = new THREE.TorusGeometry(R + 0.3, tube * 0.55, 4, 9, Math.PI * 0.7)
      batch.geo(crown, place(m.x, Math.max(2, crownY) + tube * 0.4, m.z, m.yaw, 0, Math.PI * 0.15), TONE.top)
      crown.dispose()
      return
    }
    case 'cape': {
      batch.tris(prism({ sides: m.sides, rx: m.rx, rz: m.rz, taper: m.taper, y0: -ROOT_DEPTH, y1: m.height, jitter: 0.08, rng, open: true }), at, body)
      batch.tris(prism({ sides: m.sides, rx: m.rx * m.taper * 1.03, rz: m.rz * m.taper * 1.03, taper: 0.94, y0: m.height - 0.3, y1: m.height + 0.9, jitter: 0.05, rng }), at, TONE.top)
      const knoll = place(m.x + Math.cos(m.yaw) * m.rx * 0.4, 0, m.z - Math.sin(m.yaw) * m.rx * 0.4, m.yaw + 0.4)
      batch.tris(prism({ sides: 6, rx: m.rx * 0.3, rz: m.rz * 0.5, taper: 0.5, y0: m.height, y1: m.height + 2 + m.height * 0.2, jitter: 0.15, rng }), knoll, body)
      batch.tris(prism({ sides: m.sides, rx: m.rx * 1.04, rz: m.rz * 1.04, taper: 0.98, y0: -ROOT_DEPTH, y1: 1.1, jitter: 0.08, rng, open: true }), at, TONE.deep, false)
      scrubTufts(batch, at, 5, m.rx * 0.6, m.height + 0.6, rng)
      return
    }
    case 'islet': {
      batch.tris(prism({ sides: m.sides, rx: m.rx, rz: m.rz, taper: m.taper, y0: -ROOT_DEPTH, y1: m.height, jitter: 0.1, rng, open: true }), at, body)
      batch.tris(prism({ sides: m.sides, rx: m.rx * m.taper * 1.02, rz: m.rz * m.taper * 1.02, taper: 0.95, y0: m.height - 0.3, y1: m.height + 0.7, jitter: 0.05, rng }), at, TONE.top)
      batch.tris(prism({ sides: m.sides, rx: m.rx * 1.04, rz: m.rz * 1.04, taper: 0.98, y0: -ROOT_DEPTH, y1: 0.9, jitter: 0.08, rng, open: true }), at, TONE.deep, false)
      scrubTufts(batch, at, 3, m.rx * 0.5, m.height + 0.4, rng)
      return
    }
    case 'needle': {
      batch.tris(prism({ sides: m.sides, rx: m.rx, rz: m.rz, taper: m.taper, y0: -ROOT_DEPTH, y1: m.height, jitter: 0.16, rng, lean: [(rng() - 0.5) * m.rx * 0.8, (rng() - 0.5) * m.rz * 0.8] }), at, body)
      const sh = place(m.x + Math.cos(m.yaw) * m.rx * 1.1, 0, m.z - Math.sin(m.yaw) * m.rx * 1.1, m.yaw - 0.5)
      batch.tris(prism({ sides: 6, rx: m.rx * 0.8, rz: m.rz * 0.8, taper: 0.4, y0: -ROOT_DEPTH, y1: m.height * 0.4, jitter: 0.2, rng }), sh, TONE.pale)
      return
    }
    default: {
      // Stack: a faceted column, a cream slab on top with scrub, a wet band at the waterline.
      batch.tris(prism({ sides: m.sides, rx: m.rx, rz: m.rz, taper: m.taper, y0: -ROOT_DEPTH, y1: m.height, jitter: 0.18, rng, open: true, lean: [(rng() - 0.5) * 1.5, (rng() - 0.5) * 1.5] }), at, body)
      if (m.cap) {
        batch.tris(prism({ sides: m.sides, rx: m.rx * m.taper * 1.1, rz: m.rz * m.taper * 1.1, taper: 0.8, y0: m.height - 0.2, y1: m.height + 0.8 + m.height * 0.03, jitter: 0.1, rng }), at, TONE.top)
        scrubTufts(batch, at, 2, m.rx * m.taper * 0.5, m.height + 0.6, rng)
      }
      batch.tris(prism({ sides: m.sides, rx: m.rx * 1.05, rz: m.rz * 1.05, taper: 0.98, y0: -ROOT_DEPTH, y1: 1.0, jitter: 0.12, rng, open: true }), at, TONE.deep, false)
    }
  }
}

export function buildRing(plan: BarrierPlan, seed: number, night: boolean): THREE.BufferGeometry {
  const batch = new Batch(night)
  const rng = seeded(seed * 29 + 3)
  for (const m of plan.ring) massifInto(batch, m, rng)
  return batch.build()
}

/* ---------- vistas ---------- */

export interface VistaBuild {
  geometry: THREE.BufferGeometry
  /** Local position of the one light. */
  lamp: [number, number, number]
  lampRadius: number
}

/** Local frame: +z toward the pose camera, x across the view, y up; the sea at y = 0. */
export function buildVista(vista: Vista, night: boolean, seed: number, groundHeight = 0): VistaBuild {
  const batch = new Batch(night, vista.kind === 'harbour-city' ? 0.5 : night ? 0.28 : 0.3)
  const rng = seeded(seed * 7 + vista.id.length * 31 + Math.round(vista.distance))
  const H = vista.height
  switch (vista.kind) {
    case 'acropolis': {
      // A terraced pale hill rising from the plain (three steps, cream treads, warm risers), a
      // stylobate on top, a broken colonnade, cypresses. Broad and stepped so it never reads as a cone.
      const hillTop = H - 7
      const steps: Array<[number, number, number]> = [
        [68, 52, groundHeight + (hillTop - groundHeight) * 0.36],
        [54, 42, groundHeight + (hillTop - groundHeight) * 0.7],
        [38, 30, hillTop],
      ]
      let y0 = groundHeight - 7
      for (const [rx, rz, y1] of steps) {
        batch.tris(prism({ sides: 8, rx, rz, taper: 0.86, y0, y1, jitter: 0.1, rng, open: true, lean: [1.5, -2] }), place(0, 0, 0, 0.15), TONE.pale)
        batch.tris(prism({ sides: 8, rx: rx * 0.88, rz: rz * 0.88, taper: 0.98, y0: y1 - 0.3, y1: y1 + 0.5, jitter: 0.05, rng, lean: [1.5, -2] }), place(0, 0, 0, 0.15), TONE.top)
        y0 = y1
      }
      batch.tris(prism({ sides: 6, rx: 30, rz: 24, taper: 0.5, y0: groundHeight - 6, y1: groundHeight + (hillTop - groundHeight) * 0.5, jitter: 0.14, rng }), place(-62, 0, 14, -0.3), TONE.pale)
      scrubTufts(batch, place(0, 0, 0), 9, 50, groundHeight + (hillTop - groundHeight) * 0.36 + 0.4, rng)
      scrubTufts(batch, place(0, 0, 0), 5, 36, groundHeight + (hillTop - groundHeight) * 0.7 + 0.4, rng)
      const sx = 2
      const sz = -3
      const stylobate = new THREE.BoxGeometry(26, 1.1, 14)
      batch.geo(stylobate, place(sx, hillTop + 0.55, sz), TONE.plaster)
      stylobate.dispose()
      const columns: Array<[number, number, number]> = [
        [-10, 4, 6],
        [-5, 4, 6],
        [0, 4, 6],
        [5, 4, 2.6],
        [10, 4, 6],
        [-10, -4, 6],
        [0, -4, 1.8],
        [10, -4, 4.2],
      ]
      for (const [x, z, h] of columns) {
        const col = new THREE.CylinderGeometry(0.62, 0.78, h, 7)
        batch.geo(col, place(sx + x, hillTop + 1.1 + h / 2, sz + z), TONE.plaster)
        col.dispose()
      }
      const architrave = new THREE.BoxGeometry(11.6, 0.9, 1.6)
      batch.geo(architrave, place(sx - 5, hillTop + 1.1 + 6.45, sz + 6), TONE.ruin)
      architrave.dispose()
      // A pediment fragment over the standing bay.
      const ped = new THREE.ConeGeometry(4.2, 1.4, 3)
      batch.geo(ped, place(sx - 5, hillTop + 1.1 + 7.6, sz + 6, Math.PI / 2, 0, 0, 1, 1, 0.3), TONE.plaster)
      ped.dispose()
      // Fallen drums on the slab.
      for (const [x, z] of [
        [6, 0],
        [8.5, -1.5],
      ]) {
        const drum = new THREE.CylinderGeometry(0.7, 0.7, 2.2, 7)
        batch.geo(drum, place(sx + x, hillTop + 1.1 + 0.7, sz + z, 0, 0, Math.PI / 2), TONE.ruin)
        drum.dispose()
      }
      // Cypresses down the slope toward the camera.
      for (const [x, z, h] of [
        [-16, 14, 6.5],
        [-12, 17, 5.5],
        [14, 15, 6],
        [18, 12, 7],
        [-24, 6, 5],
      ]) {
        const cone = new THREE.ConeGeometry(1.1, h, 5)
        batch.geo(cone, place(sx + x, hillTop - 1.5 + h / 2, sz + z), night ? '#2f3a30' : '#3f5a3c')
        cone.dispose()
      }
      return { geometry: batch.build(), lamp: [sx - 5, hillTop + 1.1 + 3.2, sz + 7.4], lampRadius: 0.9 }
    }
    case 'lighthouse': {
      // A dark rock islet, a ruined round tower with a broken crown, a keeper's house without a roof.
      batch.tris(prism({ sides: 6, rx: 20, rz: 14, taper: 0.78, y0: -ROOT_DEPTH, y1: 3.4, jitter: 0.16, rng, open: true }), place(0, 0, 0, 0.3), TONE.deep)
      batch.tris(prism({ sides: 6, rx: 20 * 0.8, rz: 14 * 0.8, taper: 0.9, y0: 3.1, y1: 4.0, jitter: 0.1, rng }), place(0, 0, 0, 0.3), TONE.top)
      batch.tris(prism({ sides: 5, rx: 7, rz: 6, taper: 0.5, y0: -ROOT_DEPTH, y1: 2.4, jitter: 0.2, rng }), place(18, 0, 7, 1.1), TONE.warm)
      const towerH = H - 4 - 2.4
      const tower = new THREE.CylinderGeometry(2.6, 3.2, towerH, 9)
      batch.geo(tower, place(0, 4 + towerH / 2, 0), TONE.plaster)
      tower.dispose()
      const band = new THREE.CylinderGeometry(2.95, 3.1, 0.9, 9)
      batch.geo(band, place(0, 4 + towerH * 0.42, 0), P.cobalt, false)
      band.dispose()
      // Broken crown: three surviving merlons.
      for (const a of [0.3, 1.9, 3.6]) {
        const merlon = new THREE.BoxGeometry(1.4, 1.6, 0.9)
        batch.geo(merlon, place(Math.cos(a) * 2.4, 4 + towerH + 0.8, Math.sin(a) * 2.4, -a), TONE.ruin)
        merlon.dispose()
      }
      const house = new THREE.BoxGeometry(5.2, 2.6, 4.0)
      batch.geo(house, place(-8, 4 + 1.3, 3, 0.3), TONE.plaster)
      house.dispose()
      const wall = new THREE.BoxGeometry(5.6, 1.1, 0.5)
      batch.geo(wall, place(-8, 4 + 2.6 + 0.55, 3 + 1.9, 0.3), TONE.ruin)
      wall.dispose()
      return { geometry: batch.build(), lamp: [0, 4 + towerH + 0.9, 0], lampRadius: 1.0 }
    }
    case 'harbour-city': {
      // A harbour city on the horizon in two depth bands. Every piece stands with its base under the
      // water (−3 / −4 m) so the sea line cuts across the buildings instead of a shelf under them;
      // the back band is paler, and every face hazes further toward the sky the higher it is, so the
      // skyline's top edge dissolves. Two domes, a beacon tower (the one light), a long low harbour
      // wall, masts; heights vary 3–15 m.
      const front = (y: number) => 0.28 + 0.34 * Math.min(1, Math.max(0, y / 14))
      const back = (y: number) => 0.5 + 0.38 * Math.min(1, Math.max(0, y / 14))
      const roll = () => rng()
      const house = (x: number, z: number, w: number, h: number, d: number, y0: number, colour: string) => {
        const block = new THREE.BoxGeometry(w, h - y0, d)
        batch.geo(block, place(x, (h + y0) / 2, z, (roll() - 0.5) * 0.3), colour)
        block.dispose()
      }
      // Back band: 500 m from the camera (60 m behind the front), paler, taller silhouettes.
      batch.hazeGradient(back)
      const backBand: Array<[number, number, number, number, number]> = [
        [-150, -62, 16, 7, 10],
        [-118, -70, 22, 11, 14],
        [-86, -58, 14, 5, 10],
        [-60, -72, 26, 9, 16],
        [-26, -64, 18, 8, 12],
        [6, -74, 30, 8, 18],
        [40, -60, 16, 6, 10],
        [70, -70, 24, 10, 14],
        [104, -62, 18, 7, 12],
        [136, -72, 22, 9, 14],
      ]
      for (const [x, z, w, h, d] of backBand) house(x, z, w, h, d, -4, roll() < 0.4 ? '#e6dcc3' : TONE.plaster)
      // Two domes on the back band's heaviest blocks.
      for (const [x, z, r, y] of [
        [-60, -72, 6, 9],
        [6, -74, 6.5, 8],
      ]) {
        const dome = new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)
        batch.geo(dome, place(x, y, z), '#bfc9c4')
        dome.dispose()
      }
      // Front band: lower houses right on the water, a long low harbour wall, masts in the roads.
      batch.hazeGradient(front)
      const frontBand: Array<[number, number, number, number, number]> = [
        [-132, -8, 14, 4, 9],
        [-108, 4, 18, 6.5, 12],
        [-84, -14, 12, 3.5, 9],
        [-62, 2, 20, 7.5, 13],
        [-36, -10, 16, 5, 11],
        [-12, 6, 24, 9, 15],
        [12, -12, 14, 4.5, 10],
        [34, 4, 18, 6, 12],
        [58, -8, 16, 5.5, 11],
        [82, 6, 22, 8, 14],
        [108, -10, 14, 4, 10],
        [130, 2, 18, 6.5, 12],
      ]
      for (const [x, z, w, h, d] of frontBand) house(x, z, w, h, d, -3, roll() < 0.3 ? '#e2d4b4' : TONE.plaster)
      // The beacon tower, slim, the tallest thing, with its lamp.
      const towerTop = H - 1.2
      const tower = new THREE.CylinderGeometry(1.8, 2.4, towerTop + 3, 8)
      batch.geo(tower, place(46, (towerTop - 3) / 2, -30), TONE.plaster)
      tower.dispose()
      const gallery = new THREE.CylinderGeometry(2.4, 1.9, 0.8, 8)
      batch.geo(gallery, place(46, towerTop + 0.4, -30), TONE.ruin)
      gallery.dispose()
      // Harbour wall: a long low line just clear of the water, broken once.
      for (const [x0, len] of [
        [-150, 130],
        [-4, 158],
      ]) {
        const wall = new THREE.BoxGeometry(len, 4.4, 5)
        batch.geo(wall, place(x0 + len / 2, -0.8, 24, 0.02), TONE.ruin)
        wall.dispose()
      }
      for (let i = 0; i < 9; i++) {
        const mastH = 6 + roll() * 4
        const mast = new THREE.CylinderGeometry(0.16, 0.2, mastH, 4)
        batch.geo(mast, place(-120 + i * 30 + roll() * 12, mastH / 2, 16 + roll() * 6), TONE.ruin, false)
        mast.dispose()
      }
      batch.hazeGradient(null)
      return { geometry: batch.build(), lamp: [46, towerTop + 1.4, -30], lampRadius: 1.0 }
    }
    default: {
      // Sea arch: two rooted legs, a limestone bow with a cream crown, a lantern on the foot rock.
      const span = 30
      const R = span / 2
      const tube = 4
      const crownY = H - R - tube
      const bow = new THREE.TorusGeometry(R, tube, 6, 11, Math.PI)
      batch.geo(bow, place(0, crownY, 0, 0, 0, 0), TONE.warm)
      bow.dispose()
      for (const side of [-1, 1]) {
        batch.tris(prism({ sides: 7, rx: 6.5, rz: 5.5, taper: 0.8, y0: -ROOT_DEPTH, y1: crownY + 1.5, jitter: 0.14, rng }), place(side * R, 0, 0, 0.2 * side), TONE.warm)
        batch.tris(prism({ sides: 6, rx: 6.8, rz: 5.8, taper: 0.98, y0: -ROOT_DEPTH, y1: 1.2, jitter: 0.1, rng, open: true }), place(side * R, 0, 0, 0.2 * side), TONE.deep, false)
        batch.tris(prism({ sides: 6, rx: 5.4, rz: 4.6, taper: 0.8, y0: crownY + 1.2, y1: crownY + 2.2, jitter: 0.1, rng }), place(side * R, 0, 0, 0.2 * side), TONE.top)
      }
      const crown = new THREE.TorusGeometry(R + 0.3, tube * 0.5, 4, 11, Math.PI * 0.66)
      batch.geo(crown, place(0, crownY + tube * 0.45, 0, 0, 0, Math.PI * 0.17), TONE.top)
      crown.dispose()
      scrubTufts(batch, place(0, 0, 0), 4, 3, crownY + tube * 0.9, rng)
      // The fisherman's rock at the foot, with a beached skiff; the lantern is the one light.
      batch.tris(prism({ sides: 6, rx: 5, rz: 4, taper: 0.6, y0: -ROOT_DEPTH, y1: 2.4, jitter: 0.2, rng }), place(R + 9, 0, 6, 0.7), TONE.pale)
      const skiff = new THREE.DodecahedronGeometry(1, 0)
      batch.geo(skiff, place(R + 7, 2.6, 8.5, 0.5, 0, 0, 2.6, 0.6, 1), TONE.plaster)
      skiff.dispose()
      return { geometry: batch.build(), lamp: [R + 9.5, 3.6, 6.5], lampRadius: 0.6 }
    }
  }
}
