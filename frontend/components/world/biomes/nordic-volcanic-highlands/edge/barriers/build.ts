/**
 * Geometry for the barriers and vistas: everything is merged into a handful of vertex-coloured
 * buffers so the whole enclosure costs a few draw calls. Flat (per-face) normals and a baked
 * three-step facet shade, like the authored mountains, so the basalt keeps its facets under fog.
 */
import * as THREE from 'three'
import { NORDIC_PALETTE as P, seeded } from '../../layout/biome-layout'
import type { BarrierPlan, Massif, Vista } from './geography'

const DAY_LIGHT = new THREE.Vector3(65, 105, 70).normalize()
const NIGHT_LIGHT = new THREE.Vector3(-70, 80, 30).normalize()
const FACET_STEPS: [number, number, number] = [1, 0.82, 0.64]
const PALE_STEPS: [number, number, number] = [1, 0.9, 0.8]

/** Roots: every massif continues this far under its seat so no base ever floats on the relief. */
export const ROOT_DEPTH = 6

/** The palette, day and night (night keeps the authored cliff / rim night values). */
export const BARRIER_COLOURS = {
  day: {
    basalt: P.cliff,
    basaltLight: '#3a424d',
    basaltTop: P.basalt,
    moss: '#5e6d52',
    scree: '#3b3c42',
    ice: '#dde7ea',
    iceShade: '#b9cdd4',
    crevasse: '#8fb6c6',
    iceDirty: '#b4bfc0',
    timber: '#2b2522',
    timberLight: '#3a322d',
    cream: P.cream,
    red: '#a64b3c',
    turf: P.turf,
    stone: '#6c6f6a',
    sinter: '#cfc8ab',
    sinterPale: '#e2dcc4',
    pool: P.geothermal,
    hill: '#5e6d52',
    sky: P.sky,
  },
  night: {
    basalt: '#1d2933',
    basaltLight: '#242f3a',
    basaltTop: '#2b3038',
    moss: '#2b3a36',
    scree: '#1c1f26',
    ice: '#8192a0',
    iceShade: '#66798a',
    crevasse: '#4f6a7c',
    iceDirty: '#5f6b72',
    timber: '#121011',
    timberLight: '#1a1618',
    cream: '#6f6a62',
    red: '#4d2521',
    turf: '#263326',
    stone: '#363a3b',
    sinter: '#5e5a4d',
    sinterPale: '#6a665a',
    pool: '#3f6b67',
    hill: '#2b3a36',
    sky: P.skyNight,
  },
} as const

export type BarrierPalette = Record<keyof (typeof BARRIER_COLOURS)['day'], string>

export function barrierPalette(night: boolean): BarrierPalette {
  return night ? BARRIER_COLOURS.night : BARRIER_COLOURS.day
}

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

  /** `hazeAmount` bakes atmosphere into the colours (lerp toward the sky): far places read paler. */
  constructor(night: boolean, skyHex: string, private readonly hazeAmount = 0) {
    this.light = night ? NIGHT_LIGHT : DAY_LIGHT
    this.haze = new THREE.Color(skyHex)
  }

  get triangles(): number {
    return this.pos.length / 9
  }

  /** Push raw local-space triangles (9 floats each) through `m`, coloured flat with the facet bake. */
  tris(positions: ArrayLike<number>, m: THREE.Matrix4 | null, color: string, facet: 'rock' | 'pale' | 'none' = 'rock'): void {
    const base = _col.set(color)
    const r = base.r
    const g = base.g
    const b = base.b
    const steps = facet === 'pale' ? PALE_STEPS : FACET_STEPS
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
      if (facet !== 'none') {
        const ndl = _n.dot(this.light)
        step = ndl > 0.62 ? steps[0] : ndl > 0.3 ? steps[1] : steps[2]
      }
      this.pos.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _c.x, _c.y, _c.z)
      const h = this.hazeAmount
      const cr = r * step * (1 - h) + this.haze.r * h
      const cg = g * step * (1 - h) + this.haze.g * h
      const cb = b * step * (1 - h) + this.haze.b * h
      for (let k = 0; k < 3; k++) this.col.push(cr, cg, cb)
    }
  }

  /** Push a three.js geometry (indexed or not) through `m`. */
  geo(geometry: THREE.BufferGeometry, m: THREE.Matrix4 | null, color: string, facet: 'rock' | 'pale' | 'none' = 'rock'): void {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry
    this.tris(flat.attributes.position.array, m, color, facet)
    if (flat !== geometry) flat.dispose()
    geometry.dispose()
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
  /** Skip the top cap. */
  open?: boolean
  /** Tilt of the top face (metres of height difference across the top, along local x). */
  slant?: number
}

/** Irregular faceted prism around the local origin: sides plus a fan top. Returns local triangles. */
export function prism(spec: PrismSpec): number[] {
  const { sides, rx, rz, taper, y0, y1, jitter, rng } = spec
  const lean = spec.lean ?? [0, 0]
  const slant = spec.slant ?? 0
  const base: Array<[number, number]> = []
  const top: Array<[number, number, number]> = []
  const phase = rng() * Math.PI * 2
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * Math.PI * 2 + (rng() - 0.5) * (Math.PI / sides) * 0.8
    const jb = 1 + (rng() - 0.5) * 2 * jitter
    const jt = 1 + (rng() - 0.5) * 2 * jitter * 0.7
    const tx = Math.cos(a) * rx * taper * jt + lean[0]
    const tz = Math.sin(a) * rz * taper * jt + lean[1]
    base.push([Math.cos(a) * rx * jb, Math.sin(a) * rz * jb])
    top.push([tx, y1 + (slant * Math.cos(a)) / 2, tz])
  }
  const out: number[] = []
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    const b0 = [base[i][0], y0, base[i][1]]
    const b1 = [base[j][0], y0, base[j][1]]
    const t0 = [top[i][0], top[i][1], top[i][2]]
    const t1 = [top[j][0], top[j][1], top[j][2]]
    const outward = [(b0[0] + b1[0] + t0[0] + t1[0]) / 4 - lean[0] / 2, 0, (b0[2] + b1[2] + t0[2] + t1[2]) / 4 - lean[1] / 2]
    pushTri(out, b0, t1, t0, outward)
    pushTri(out, b0, b1, t1, outward)
  }
  if (!spec.open && taper > 0.02) {
    let cx = 0
    let cy = 0
    let cz = 0
    for (const [x, y, z] of top) {
      cx += x / sides
      cy += y / sides
      cz += z / sides
    }
    const up = [0, 1, 0]
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides
      pushTri(out, [cx, cy, cz], [top[j][0], top[j][1], top[j][2]], [top[i][0], top[i][1], top[i][2]], up)
    }
  }
  return out
}

/* ---------- the enclosure ---------- */

function massifInto(batch: Batch, m: Massif, pal: BarrierPalette, rng: () => number): void {
  const at = place(m.x, m.seatY, m.z, m.yaw, m.tilt, (rng() - 0.5) * 0.04)
  switch (m.kind) {
    case 'column': {
      // Columnar basalt: a regular hexagonal prism, slanted top, moss or bare cap.
      const body = m.tone === 0 ? pal.basalt : pal.basaltLight
      batch.tris(prism({ sides: 6, rx: m.rx, rz: m.rz, taper: 0.97, y0: -ROOT_DEPTH, y1: m.height, jitter: 0.03, rng, open: true, slant: 0.6 + rng() * 0.8 }), at, body)
      batch.tris(prism({ sides: 6, rx: m.rx * 0.97, rz: m.rz * 0.97, taper: 0.9, y0: m.height - 0.35, y1: m.height + 0.3, jitter: 0.02, rng }), at, m.cap ? pal.moss : pal.basaltTop, 'pale')
      return
    }
    case 'talus': {
      // Scree fan at the foot of the palisade: a squat faceted mound of fallen column stubs.
      batch.tris(prism({ sides: 6, rx: m.rx, rz: m.rz, taper: 0.45, y0: -2, y1: m.height, jitter: 0.2, rng }), at, pal.scree)
      batch.tris(prism({ sides: 6, rx: m.rx * 0.5, rz: m.rz * 0.6, taper: 0.5, y0: -1, y1: m.height * 0.7, jitter: 0.2, rng }), place(m.x + m.rx * 0.5, m.seatY, m.z + m.rz * 0.4, m.yaw + 1), pal.basaltLight)
      return
    }
    case 'serac': {
      // Glacier terminus block: pale ice, a blue crevasse face toward the fjord, dirty foot.
      batch.tris(prism({ sides: m.sides, rx: m.rx, rz: m.rz, taper: 0.86, y0: -ROOT_DEPTH, y1: m.height, jitter: 0.12, rng, open: true, lean: [(rng() - 0.5) * 2, 2] }), at, m.tone === 0 ? pal.ice : pal.iceShade, 'pale')
      batch.tris(prism({ sides: m.sides, rx: m.rx * 0.86, rz: m.rz * 0.86, taper: 0.9, y0: m.height - 0.4, y1: m.height + 0.6, jitter: 0.08, rng, lean: [(rng() - 0.5) * 2, 2] }), at, pal.ice, 'pale')
      if (m.cap) {
        const slab = new THREE.BoxGeometry(m.rx * 0.5, m.height * 0.7, 0.8)
        batch.geo(slab, place(m.x, m.seatY + m.height * 0.45, m.z + m.rz * 0.9, m.yaw, 0.08), pal.crevasse, 'none')
      }
      batch.tris(prism({ sides: m.sides, rx: m.rx * 1.08, rz: m.rz * 1.08, taper: 0.95, y0: -ROOT_DEPTH, y1: 1.4, jitter: 0.1, rng, open: true }), at, pal.iceDirty, 'none')
      return
    }
    default: {
      // Fjord wall: the authored fjord walls are faceted dodecahedra; ours continue that vocabulary
      // up the arm, two overlapping blobs (tall, then a lower shoulder toward the water).
      const body = m.tone === 0 ? pal.basalt : pal.basaltLight
      const other = m.tone === 0 ? pal.basaltLight : pal.basalt
      const main = new THREE.DodecahedronGeometry(1, 0)
      batch.geo(main, place(m.x, m.seatY + m.height * 0.42, m.z, m.yaw + rng() * 0.8, 0.05, (rng() - 0.5) * 0.1, m.rx, m.height * 0.6, m.rz), body)
      const shoulder = new THREE.DodecahedronGeometry(1, 0)
      const sx = Math.sin(m.yaw) * m.rz * 0.9
      const sz = Math.cos(m.yaw) * m.rz * 0.9
      batch.geo(shoulder, place(m.x + sx, m.seatY + m.height * 0.22, m.z + sz, m.yaw + 0.6 + rng(), 0.03, 0, m.rx * 0.7, m.height * 0.34, m.rz * 0.8), other)
    }
  }
}

export function buildEnclosure(plan: BarrierPlan, seed: number, night: boolean): THREE.BufferGeometry {
  const pal = barrierPalette(night)
  const batch = new Batch(night, pal.sky, 0.04)
  const rng = seeded(seed * 29 + 3)
  for (const m of plan.massifs) massifInto(batch, m, pal, rng)
  return batch.build()
}

/* ---------- vistas ---------- */

export interface VistaBuild {
  geometry: THREE.BufferGeometry
  /** Geyser field only: the three vent positions (world). */
  vents?: Array<[number, number, number]>
}

/** Local frame: +z toward the pose camera, x across the view, y up; the seat at y = 0. */
export function buildVista(vista: Vista, night: boolean, seed: number): VistaBuild {
  const pal = barrierPalette(night)
  const batch = new Batch(night, pal.sky, night ? 0.26 : 0.3)
  const rng = seeded(seed * 7 + vista.id.length * 31 + Math.round(vista.fromCamera))
  const at = (lx: number, ly: number, lz: number, yaw = 0, tiltX = 0, tiltZ = 0, sx = 1, sy = 1, sz = 1) => {
    const cs = Math.cos(vista.yaw)
    const sn = Math.sin(vista.yaw)
    return place(vista.x + lx * cs + lz * sn, vista.seatY + ly, vista.z - lx * sn + lz * cs, vista.yaw + yaw, tiltX, tiltZ, sx, sy, sz)
  }
  switch (vista.kind) {
    case 'volcano': {
      // The cone is the heightfield; add the dark crater rim and a sulphur stain at the notch.
      const rim = new THREE.TorusGeometry(19, 3.2, 5, 12)
      const summit = vista.seatY + vista.height
      batch.geo(rim, place(vista.x, summit - 1.5, vista.z, 0, Math.PI / 2), pal.basalt)
      const stain = new THREE.CylinderGeometry(9, 14, 1.4, 7)
      batch.geo(stain, place(vista.lamp[0], vista.lamp[1] - 1.2, vista.lamp[2]), '#8a6a3c', 'none')
      return { geometry: batch.build() }
    }
    case 'longhouse': {
      // A chieftain's hall: long red walls, deep turf roof, cream gables; a shed, a boathouse, a dry-stone wall.
      batch.geo(new THREE.BoxGeometry(24, 0.8, 11), at(0, 0.4, 0), pal.stone)
      batch.geo(new THREE.BoxGeometry(23, 3.6, 9), at(0, 2.6, 0), pal.red)
      for (const side of [-1, 1]) {
        const roof = new THREE.BoxGeometry(24.5, 0.6, 6.4)
        batch.geo(roof, at(0, 5.6, side * 2.6, 0, side * 0.72), pal.turf, 'pale')
      }
      batch.geo(new THREE.BoxGeometry(2.6, 2.6, 9.4), at(11.6, 5.5, 0, 0, 0, Math.PI / 4), pal.cream, 'none')
      batch.geo(new THREE.BoxGeometry(2.6, 2.6, 9.4), at(-11.6, 5.5, 0, 0, 0, Math.PI / 4), pal.cream, 'none')
      batch.geo(new THREE.BoxGeometry(7, 2.8, 5), at(-17, 1.4, 4), pal.timberLight)
      batch.geo(new THREE.ConeGeometry(4.4, 2.2, 4), at(-17, 3.9, 4, Math.PI / 4), pal.turf, 'pale')
      batch.geo(new THREE.BoxGeometry(5, 2.4, 8), at(12, 1.2, 14), pal.timber)
      batch.geo(new THREE.BoxGeometry(0.8, 1.2, 30), at(-6, 0.6, 9, 0.3), pal.stone, 'none')
      batch.geo(new THREE.ConeGeometry(1.6, 3.2, 5), at(18, 1.6, -8), pal.stone)
      return { geometry: batch.build() }
    }
    case 'church': {
      // A stave church: three tarred tiers with steep roofs, a slender spire, a porch; the moss
      // hill under it is the heightfield's own (CHURCH_HILL), with a stone plinth to sit on.
      batch.tris(prism({ sides: 8, rx: 9, rz: 7, taper: 0.9, y0: -ROOT_DEPTH, y1: 0.7, jitter: 0.08, rng }), at(0, 0, 0, 0.3), pal.stone, 'pale')
      const base = 0.7
      batch.geo(new THREE.BoxGeometry(12, 3.4, 8), at(0, base + 1.7, 0), pal.timber)
      batch.geo(new THREE.BoxGeometry(13, 0.5, 4.6), at(0, base + 4.3, 2.6, 0, 0.9), pal.timberLight, 'pale')
      batch.geo(new THREE.BoxGeometry(13, 0.5, 4.6), at(0, base + 4.3, -2.6, 0, -0.9), pal.timberLight, 'pale')
      batch.geo(new THREE.BoxGeometry(8, 2.6, 5.2), at(0, base + 5.8, 0), pal.timber)
      batch.geo(new THREE.BoxGeometry(8.6, 0.45, 3.4), at(0, base + 7.6, 1.9, 0, 0.95), pal.timberLight, 'pale')
      batch.geo(new THREE.BoxGeometry(8.6, 0.45, 3.4), at(0, base + 7.6, -1.9, 0, -0.95), pal.timberLight, 'pale')
      batch.geo(new THREE.BoxGeometry(4.2, 2.2, 3.2), at(0, base + 8.9, 0), pal.timber)
      batch.geo(new THREE.ConeGeometry(2.8, 3.2, 4), at(0, base + 11.4, 0, Math.PI / 4), pal.timberLight, 'pale')
      batch.geo(new THREE.CylinderGeometry(0.35, 0.9, 6.2, 6), at(0, base + 15.6, 0), pal.timber, 'none')
      batch.geo(new THREE.BoxGeometry(3.6, 2.4, 2.4), at(0, base + 1.2, 5.2), pal.timber)
      batch.geo(new THREE.ConeGeometry(2.6, 1.6, 4), at(0, base + 3.1, 5.2, Math.PI / 4), pal.timberLight, 'pale')
      for (const [x, z] of [[-9, 6], [8, -7], [11, 5]] as Array<[number, number]>) batch.geo(new THREE.ConeGeometry(0.9, 2.2, 5), at(x, base + 0.6, z), pal.stone)
      return { geometry: batch.build() }
    }
    default: {
      // Geyser field: three sinter terraces stepping down toward the camera, a pool, three vents.
      const terraces: Array<[number, number, number, number]> = [
        [-16, -14, 22, 1.6],
        [10, -6, 18, 1.1],
        [-2, 12, 20, 0.6],
      ]
      const vents: Array<[number, number, number]> = []
      for (const [lx, lz, r, h] of terraces) {
        batch.tris(prism({ sides: 9, rx: r, rz: r * 0.8, taper: 0.88, y0: -ROOT_DEPTH, y1: h, jitter: 0.1, rng }), at(lx, 0, lz, rng()), pal.sinter, 'pale')
        batch.tris(prism({ sides: 8, rx: r * 0.55, rz: r * 0.45, taper: 0.85, y0: h - 0.2, y1: h + 0.9, jitter: 0.1, rng }), at(lx, 0, lz, rng()), pal.sinterPale, 'pale')
        batch.geo(new THREE.ConeGeometry(2.6, 1.6, 7), at(lx, h + 1.4, lz), pal.sinterPale, 'none')
        const cs = Math.cos(vista.yaw)
        const sn = Math.sin(vista.yaw)
        vents.push([vista.x + lx * cs + lz * sn, vista.seatY + h + 2.1, vista.z - lx * sn + lz * cs])
      }
      batch.geo(new THREE.CylinderGeometry(7, 8, 0.5, 9), at(-6, 0.4, 9), pal.pool, 'none')
      batch.geo(new THREE.BoxGeometry(5, 2.6, 4), at(22, 1.3, 10, 0.4), pal.timber)
      batch.geo(new THREE.ConeGeometry(3.4, 1.8, 4), at(22, 3.4, 10, 0.4 + Math.PI / 4), pal.turf, 'pale')
      return { geometry: batch.build(), vents }
    }
  }
}
