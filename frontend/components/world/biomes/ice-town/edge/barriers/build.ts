/**
 * Geometry for the barriers technique: everything is merged into a handful of vertex-coloured
 * buffers so the whole enclosure costs a dozen draw calls. Flat (per-face) normals and a baked
 * three-step facet shade, like the authored range, so the pale ice keeps its facets under fog.
 */
import * as THREE from 'three'
import { ICE_TOWN_PALETTE as P, type BiomeLayout, seeded } from '../../layout/biome-layout'
import { fbm, type GroundMaterial } from '../../layout/terrain'
import { type Apron, type BarrierPlan, type Massif, type Vista, apronSample } from './geography'

const DAY_LIGHT = new THREE.Vector3(60, 90, 70).normalize()
const NIGHT_LIGHT = new THREE.Vector3(-40, 60, 30).normalize()
/**
 * Baked facet shade (lit / half / shade). Harder than the range's steps: the pale ice blows out
 * under the key light and the tone map, and these walls are read at 250–500 m through fog.
 */
const FACET_STEPS: [number, number, number] = [1, 0.8, 0.6]
/** Snow slabs keep more of their white on the shade side. */
const SNOW_STEPS: [number, number, number] = [1, 0.9, 0.78]

/** Roots: every wall continues this far under the water so no base ever floats. */
export const ROOT_DEPTH = 8

/**
 * Flat colours. The headlands are the land's own pale ice: `wall` on lit faces, `wallShade` on the
 * shade side, the half step between them, baked like the authored range. `face` is the far ridge.
 */
const TONE = {
  wall: '#d9e4ee',
  wallShade: '#a9cfe8',
  pale: P.cliffIce,
  cliff: '#79aed2',
  snow: P.snow,
  deep: '#5c8db2',
  face: '#9aa6c8',
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
   * `hazeAmount` bakes atmosphere into the colours (lerp toward the sky), the way the range hazes
   * its back rows: the vistas are far places and must read paler than the walls in front of them.
   */
  constructor(private readonly night: boolean, private readonly hazeAmount = 0) {
    this.light = night ? NIGHT_LIGHT : DAY_LIGHT
    this.haze = new THREE.Color(night ? P.skyNight : P.sky)
  }

  get triangles(): number {
    return this.pos.length / 9
  }

  /**
   * Push raw local-space triangles (9 floats each) through `m`, coloured flat with the facet bake.
   * With `shade`, the three steps are lit → half → shade colours instead of darkening `color`.
   */
  tris(positions: ArrayLike<number>, m: THREE.Matrix4 | null, color: string, facet = true, shade?: string): void {
    const base = _col.set(color)
    if (this.night) base.offsetHSL(0.03, 0.05, -0.16)
    const r = base.r
    const g = base.g
    const b = base.b
    let sr = r
    let sg = g
    let sb = b
    if (shade) {
      const s = _col.set(shade)
      if (this.night) s.offsetHSL(0.03, 0.05, -0.16)
      sr = s.r
      sg = s.g
      sb = s.b
    }
    const steps = color === TONE.snow || color === P.snow ? SNOW_STEPS : FACET_STEPS
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
      let band = 0
      if (facet) {
        const ndl = _n.dot(this.light)
        band = ndl > 0.62 ? 0 : ndl > 0.3 ? 1 : 2
        step = steps[band]
      }
      this.pos.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _c.x, _c.y, _c.z)
      const h = this.hazeAmount
      let cr: number
      let cg: number
      let cb: number
      if (shade) {
        const t = band * 0.5
        cr = r + (sr - r) * t
        cg = g + (sg - g) * t
        cb = b + (sb - b) * t
      } else {
        cr = r * step
        cg = g * step
        cb = b * step
      }
      cr = cr * (1 - h) + this.haze.r * h
      cg = cg * (1 - h) + this.haze.g * h
      cb = cb * (1 - h) + this.haze.b * h
      for (let k = 0; k < 3; k++) this.col.push(cr, cg, cb)
    }
  }

  /** Push a three.js geometry (indexed or not) through `m`. */
  geo(geometry: THREE.BufferGeometry, m: THREE.Matrix4 | null, color: string, facet = true, shade?: string): void {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry
    this.tris(flat.attributes.position.array, m, color, facet, shade)
    if (flat !== geometry) flat.dispose()
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(this.pos)
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3))
    geo.computeVertexNormals()
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
  /** Skip the top cap (a cliff with a snow slab over it). */
  open?: boolean
  /** Raise the top cap's centre by this much (an apex, so there is no flat top). */
  peak?: number
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
    // Outward is away from the prism's axis at the quad's mid-height.
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
    const peak = spec.peak ?? 0
    if (peak > 0) {
      // Apex off-centre so the ridge line tilts, like a broken block rather than a tent.
      cx += (rng() - 0.5) * rx * taper * 0.6
      cz += (rng() - 0.5) * rz * taper * 0.6
    }
    const up = [0, 1, 0]
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides
      pushTri(out, [cx, y1 + peak, cz], [top[j][0], y1, top[j][1]], [top[i][0], y1, top[i][1]], up)
    }
  }
  return out
}

/* ---------- the ring ---------- */

function massifInto(batch: Batch, m: Massif, rng: () => number): void {
  const body = TONE.wall
  const shade = TONE.wallShade
  // Every massif is modelled with its base at local y = 0 and roots to -ROOT_DEPTH; on the shelf the
  // whole thing is lifted onto its seat and the roots stretched down to the lowest ice under it.
  const seat = m.seatY ?? 0
  const rootStretch = (m.rootDepth ?? ROOT_DEPTH) / ROOT_DEPTH
  const at = place(m.x, seat, m.z, m.yaw, m.tilt, (rng() - 0.5) * 0.06)
  if (rootStretch > 1.001) {
    // A separate root block reaching down to the lowest point, so the body itself keeps its proportions.
    batch.tris(prism({ sides: m.sides, rx: m.rx * 0.98, rz: m.rz * 0.98, taper: 1, y0: -(m.rootDepth ?? ROOT_DEPTH), y1: -ROOT_DEPTH + 0.5, jitter: 0.05, rng, open: true }), at, shade, false)
  }
  switch (m.kind) {
    case 'arch': {
      const span = m.span ?? 56
      const R = span / 2
      const tube = 7.5
      const torus = new THREE.TorusGeometry(R, tube, 5, 9, Math.PI)
      batch.geo(torus, place(m.x, seat + 4.5, m.z, m.yaw, 0, 0), body, true, shade)
      torus.dispose()
      for (const side of [-1, 1]) {
        const leg = place(m.x + Math.cos(m.yaw) * side * R, seat, m.z - Math.sin(m.yaw) * side * R, m.yaw)
        batch.tris(prism({ sides: 7, rx: 9, rz: 8, taper: 0.8, y0: -ROOT_DEPTH, y1: 9, jitter: 0.12, rng, peak: 1.5 }), leg, body, true, shade)
        batch.tris(prism({ sides: 6, rx: 6, rz: 5.5, taper: 0.6, y0: -ROOT_DEPTH, y1: 5, jitter: 0.2, rng, lean: [side * 6, 4], peak: 1.2 }), leg, body, true, shade)
      }
      // Snow along the crown.
      const crown = new THREE.TorusGeometry(R + 0.4, tube * 0.55, 4, 9, Math.PI * 0.72)
      batch.geo(crown, place(m.x, seat + 4.5 + tube * 0.42, m.z, m.yaw, 0, Math.PI * 0.14), TONE.snow)
      crown.dispose()
      return
    }
    case 'headland': {
      // A low broken block: a peaked main body, a lower shoulder leaning off one side and a boulder
      // at the foot, each with its own apex so the skyline has no flat line in it.
      const side = rng() < 0.5 ? -1 : 1
      batch.tris(
        prism({ sides: m.sides, rx: m.rx, rz: m.rz, taper: m.taper, y0: -ROOT_DEPTH, y1: m.height, jitter: 0.2, rng, lean: [(rng() - 0.5) * m.rx * 0.5, (rng() - 0.5) * m.rz * 0.4], peak: 1.5 + m.height * 0.18 }),
        at,
        body,
        true,
        shade,
      )
      const sh = place(m.x + Math.cos(m.yaw) * side * m.rx * 0.85, seat, m.z - Math.sin(m.yaw) * side * m.rx * 0.85, m.yaw + (rng() - 0.5) * 0.8, m.tilt * 0.5, (rng() - 0.5) * 0.08)
      const shH = m.height * (0.45 + rng() * 0.25)
      batch.tris(prism({ sides: 5 + Math.floor(rng() * 2), rx: m.rx * 0.6, rz: m.rz * 0.75, taper: 0.4 + rng() * 0.3, y0: -ROOT_DEPTH, y1: shH, jitter: 0.22, rng, peak: 1 + shH * 0.2 }), sh, body, true, shade)
      const foot = place(m.x + Math.sin(m.yaw) * m.rz * 0.9 - Math.cos(m.yaw) * side * m.rx * 0.4, seat, m.z + Math.cos(m.yaw) * m.rz * 0.9 + Math.sin(m.yaw) * side * m.rx * 0.4, m.yaw + 0.7)
      batch.tris(prism({ sides: 5, rx: m.rx * 0.3, rz: m.rz * 0.45, taper: 0.5, y0: -ROOT_DEPTH, y1: 1.5 + m.height * 0.14, jitter: 0.25, rng, peak: 0.8 }), foot, body, true, shade)
      return
    }
    case 'tabular': {
      batch.tris(prism({ sides: m.sides, rx: m.rx, rz: m.rz, taper: m.taper, y0: -ROOT_DEPTH, y1: m.height, jitter: 0.08, rng, open: true }), at, body)
      // Thick snow slab with a slight overhang, then a low ridge at one end.
      batch.tris(prism({ sides: m.sides, rx: m.rx * m.taper * 1.03, rz: m.rz * m.taper * 1.03, taper: 0.92, y0: m.height - 0.3, y1: m.height + 1.6 + m.height * 0.06, jitter: 0.05, rng }), at, TONE.snow)
      const ridge = place(m.x + Math.cos(m.yaw) * m.rx * 0.45, seat, m.z - Math.sin(m.yaw) * m.rx * 0.45, m.yaw + 0.4)
      batch.tris(prism({ sides: 5, rx: m.rx * 0.28, rz: m.rz * 0.4, taper: 0.5, y0: m.height, y1: m.height + 3 + m.height * 0.2, jitter: 0.15, rng }), ridge, body)
      batch.tris(prism({ sides: 5, rx: m.rx * 0.15, rz: m.rz * 0.22, taper: 0.5, y0: m.height + 2.6 + m.height * 0.2, y1: m.height + 3.9 + m.height * 0.2, jitter: 0.1, rng }), ridge, TONE.snow)
      // Dark deep-ice band at the waterline.
      batch.tris(prism({ sides: m.sides, rx: m.rx * 1.04, rz: m.rz * 1.04, taper: 0.98, y0: -ROOT_DEPTH, y1: 1.1, jitter: 0.08, rng, open: true }), at, TONE.deep, false)
      return
    }
    case 'spire': {
      batch.tris(prism({ sides: m.sides, rx: m.rx, rz: m.rz, taper: m.taper, y0: -ROOT_DEPTH, y1: m.height, jitter: 0.16, rng, lean: [(rng() - 0.5) * m.rx * 0.8, (rng() - 0.5) * m.rz * 0.8] }), at, body)
      // A shoulder at the foot and a lower second needle.
      const sh = place(m.x + Math.cos(m.yaw) * m.rx * 0.9, seat, m.z - Math.sin(m.yaw) * m.rx * 0.9, m.yaw - 0.5)
      batch.tris(prism({ sides: 6, rx: m.rx * 0.7, rz: m.rz * 0.7, taper: 0.35, y0: -ROOT_DEPTH, y1: m.height * 0.45, jitter: 0.2, rng }), sh, TONE.cliff)
      batch.tris(prism({ sides: 6, rx: m.rx * 0.5, rz: m.rz * 0.5, taper: 0.5, y0: m.height * 0.45 - 0.4, y1: m.height * 0.45 + 1.2, jitter: 0.1, rng }), sh, TONE.snow)
      return
    }
    case 'stack': {
      batch.tris(prism({ sides: m.sides, rx: m.rx, rz: m.rz, taper: m.taper, y0: -ROOT_DEPTH, y1: m.height, jitter: 0.18, rng, peak: 0.6 + m.height * 0.15 }), at, body, true, shade)
      return
    }
    default: {
      // Cliff: a stepped massif of three overlapping faceted blocks (tall centre, lower ends), snow
      // slabs on each, one crenel on the ridge, a boulder at the foot and the deep band at the waterline.
      const sides = Math.max(7, m.sides)
      const tone2 = m.tone === 0 ? TONE.cliff : TONE.pale
      const blocks: Array<{ dx: number; rx: number; rz: number; h: number; tone: string; taper: number }> = [
        { dx: 0, rx: m.rx * 0.72, rz: m.rz, h: m.height, tone: body, taper: m.taper },
        { dx: m.rx * 0.66, rx: m.rx * 0.5, rz: m.rz * 1.05, h: m.height * (0.55 + rng() * 0.3), tone: tone2, taper: 0.72 },
        { dx: -m.rx * 0.7, rx: m.rx * 0.42, rz: m.rz * 0.9, h: m.height * (0.38 + rng() * 0.3), tone: rng() < 0.5 ? body : tone2, taper: 0.66 },
      ]
      for (const blk of blocks) {
        const at2 = place(m.x + Math.cos(m.yaw) * blk.dx, seat, m.z - Math.sin(m.yaw) * blk.dx, m.yaw + (rng() - 0.5) * 0.5, m.tilt * 0.6, (rng() - 0.5) * 0.05)
        batch.tris(prism({ sides, rx: blk.rx, rz: blk.rz, taper: blk.taper, y0: -ROOT_DEPTH, y1: blk.h, jitter: 0.14, rng, open: true, lean: [(rng() - 0.5) * 4, (rng() - 0.5) * 3] }), at2, blk.tone)
        batch.tris(prism({ sides, rx: blk.rx * blk.taper * 1.05, rz: blk.rz * blk.taper * 1.05, taper: 0.84, y0: blk.h - 0.3, y1: blk.h + 1.2 + blk.h * 0.05, jitter: 0.07, rng }), at2, TONE.snow)
        batch.tris(prism({ sides, rx: blk.rx * 1.03, rz: blk.rz * 1.03, taper: 0.99, y0: -ROOT_DEPTH, y1: 1.0, jitter: 0.1, rng, open: true }), at2, TONE.deep, false)
      }
      const side = rng() < 0.5 ? -1 : 1
      const crenel = place(m.x - Math.cos(m.yaw) * side * m.rx * 0.25, seat, m.z + Math.sin(m.yaw) * side * m.rx * 0.25, m.yaw)
      const ch = m.height + 1.2 + m.height * 0.14
      batch.tris(prism({ sides: 5, rx: m.rx * 0.2, rz: m.rz * 0.5, taper: 0.55, y0: m.height, y1: ch, jitter: 0.15, rng }), crenel, body)
      batch.tris(prism({ sides: 5, rx: m.rx * 0.13, rz: m.rz * 0.3, taper: 0.6, y0: ch - 0.3, y1: ch + 0.9, jitter: 0.1, rng }), crenel, TONE.snow)
      const foot = place(m.x + Math.sin(m.yaw) * m.rz * 0.95 + Math.cos(m.yaw) * side * m.rx * 0.2, seat, m.z + Math.cos(m.yaw) * m.rz * 0.95 - Math.sin(m.yaw) * side * m.rx * 0.2, m.yaw + 0.9)
      batch.tris(prism({ sides: 6, rx: m.rx * 0.28, rz: m.rz * 0.5, taper: 0.5, y0: -ROOT_DEPTH, y1: 2.5 + m.height * 0.1, jitter: 0.2, rng }), foot, tone2)
    }
  }
}

export function buildRing(plan: BarrierPlan, seed: number, night: boolean): THREE.BufferGeometry {
  const batch = new Batch(night)
  const rng = seeded(seed * 29 + 3)
  for (const m of plan.ring) massifInto(batch, m, rng)
  return batch.build()
}

/* ---------- the apron ---------- */

const GROUND: Partial<Record<GroundMaterial, string>> = { sea: '#2a5474', snow: P.snow, ice: P.paleIce, rock: P.rock, mountain: P.snow }
const STEEP: Partial<Record<GroundMaterial, string>> = { sea: '#2a5474', snow: P.cliffIce, ice: P.cliffIce, rock: P.rockDeep, mountain: P.rock }

/** The back land continued past the plate on the same heightfield (see `apronSample`). Indexed, smooth normals, like the plate. */
export function buildApron(layout: BiomeLayout, apron: Apron, night: boolean): THREE.BufferGeometry {
  const nx = Math.round((apron.maxX - apron.minX) / apron.stepX) + 1
  const nz = apron.rows.length
  const positions = new Float32Array(nx * nz * 3)
  const colors = new Float32Array(nx * nz * 3)
  const materials: GroundMaterial[] = new Array(nx * nz)
  const indices: number[] = []
  let v = 0
  for (let iz = 0; iz < nz; iz++) {
    const z = apron.rows[iz]
    for (let ix = 0; ix < nx; ix++, v++) {
      const x = apron.minX + ix * apron.stepX
      const s = apronSample(layout, x, z)
      positions[v * 3] = x
      positions[v * 3 + 1] = s.height
      positions[v * 3 + 2] = z
      materials[v] = s.material
    }
  }
  for (let iz = 0; iz < nz - 1; iz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = iz * nx + ix
      const b = a + 1
      const c = a + nx
      const d = c + 1
      // Winding so the normals point up: z decreases with iz (north), so (a, b, c) is counter-clockwise from above.
      indices.push(a, b, c, b, d, c)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  const normals = geo.attributes.normal as THREE.BufferAttribute
  const c = new THREE.Color()
  for (let i = 0; i < nx * nz; i++) {
    const mat = materials[i]
    const steep = normals.getY(i) < 0.8
    c.set((steep ? STEEP[mat] : GROUND[mat]) ?? P.snow)
    const x = positions[i * 3]
    const z = positions[i * 3 + 2]
    if (mat !== 'sea') c.offsetHSL(0, 0, 0.02 * fbm(x * 0.08, z * 0.08) + 0.01 * fbm(x * 0.5, z * 0.5))
    if (night) c.offsetHSL(0.03, 0.05, -0.16)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

/* ---------- floes ---------- */

/** One hex floe (snow top on a blue root) at unit radius; instances scale it. */
export function buildFloeGeometry(night: boolean): THREE.BufferGeometry {
  const batch = new Batch(night)
  const top = new THREE.CylinderGeometry(1, 1.05, 0.3, 6)
  batch.geo(top, place(0, 0.2, 0), night ? P.snowShadow : P.snow)
  top.dispose()
  const root = new THREE.CylinderGeometry(1.05, 0.95, 0.3, 6)
  batch.geo(root, place(0, -0.1, 0), P.cliffIce, false)
  root.dispose()
  return batch.build()
}

/* ---------- vistas ---------- */

export interface VistaBuild {
  geometry: THREE.BufferGeometry
  /** Local position of the one light. */
  lamp: [number, number, number]
  lampRadius: number
  /** Local funnel top (icebreaker) for the plume. */
  funnel?: [number, number, number]
}

/** Local frame: +z toward the pose camera, x across the view, y up; the sea at y = 0. */
export function buildVista(vista: Vista, night: boolean, seed: number): VistaBuild {
  const batch = new Batch(night, night ? 0.3 : 0.32)
  const rng = seeded(seed * 7 + vista.id.length * 31 + vista.distance)
  const H = vista.height
  switch (vista.kind) {
    case 'observatory': {
      if (vista.onShelf) {
        // On the shelf's own mountains: just the station on a small snow pad, drum, dome, slit, light.
        const pad = new THREE.CylinderGeometry(6.5, 7.5, 1.6, 8)
        batch.geo(pad, place(0, 0.3, 0), TONE.snow)
        pad.dispose()
        const drum = new THREE.CylinderGeometry(3.8, 4.2, 3.2, 8)
        batch.geo(drum, place(0, 1.1 + 1.6, 0), P.cream)
        drum.dispose()
        const dome = new THREE.SphereGeometry(4.3, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2)
        batch.geo(dome, place(0, 1.1 + 3.0, 0), P.lilac)
        dome.dispose()
        const slit = new THREE.BoxGeometry(1.2, 4.0, 1.3)
        batch.geo(slit, place(0, 1.1 + 5.2, 3.0, 0, 0.55), P.ink, false)
        slit.dispose()
        return { geometry: batch.build(), lamp: [0, 1.1 + 5.9, 3.6], lampRadius: 1.2 }
      }
      // A long far ridge, lavender faces with snow above the shoulder line, a dome on its summit.
      const ridgeTop = H - 7.2
      batch.tris(prism({ sides: 7, rx: 62, rz: 30, taper: 0.12, y0: -ROOT_DEPTH, y1: ridgeTop, jitter: 0.1, rng, lean: [4, -3] }), place(0, 0, 0, 0.1), TONE.face)
      batch.tris(prism({ sides: 6, rx: 36, rz: 22, taper: 0.1, y0: -ROOT_DEPTH, y1: ridgeTop * 0.72, jitter: 0.12, rng }), place(-54, 0, -8, -0.3), TONE.face)
      batch.tris(prism({ sides: 6, rx: 30, rz: 20, taper: 0.1, y0: -ROOT_DEPTH, y1: ridgeTop * 0.6, jitter: 0.12, rng }), place(52, 0, 4, 0.4), TONE.face)
      // Snow: a cap cone sitting on the upper third of each hump.
      batch.tris(prism({ sides: 7, rx: 62 * 0.42, rz: 30 * 0.42, taper: 0.1, y0: ridgeTop * 0.58, y1: ridgeTop + 0.6, jitter: 0.1, rng, lean: [4 * 0.42, -3 * 0.42] }), place(0, 0, 0, 0.1), TONE.snow)
      batch.tris(prism({ sides: 6, rx: 36 * 0.4, rz: 22 * 0.4, taper: 0.1, y0: ridgeTop * 0.72 * 0.6, y1: ridgeTop * 0.72 + 0.4, jitter: 0.1, rng }), place(-54, 0, -8, -0.3), TONE.snow)
      batch.tris(prism({ sides: 6, rx: 30 * 0.4, rz: 20 * 0.4, taper: 0.1, y0: ridgeTop * 0.6 * 0.6, y1: ridgeTop * 0.6 + 0.4, jitter: 0.1, rng }), place(52, 0, 4, 0.4), TONE.snow)
      // Observatory: cream drum, grey-lilac dome, dark slit toward the camera.
      const sx = 4 * 0.42 // the ridge's lean puts the summit here
      const drum = new THREE.CylinderGeometry(3.8, 4.2, 3.2, 8)
      batch.geo(drum, place(sx, ridgeTop + 1.6, -3 * 0.42), P.cream)
      drum.dispose()
      const dome = new THREE.SphereGeometry(4.3, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2)
      batch.geo(dome, place(sx, ridgeTop + 3.0, -3 * 0.42), P.lilac)
      dome.dispose()
      const slit = new THREE.BoxGeometry(1.2, 4.0, 1.3)
      batch.geo(slit, place(sx, ridgeTop + 5.2, -3 * 0.42 + 3.0, 0, 0.55), P.ink, false)
      slit.dispose()
      return { geometry: batch.build(), lamp: [sx, ridgeTop + 5.9, -3 * 0.42 + 3.6], lampRadius: 1.2 }
    }
    case 'lighthouse': {
      // A dark rock stack in the sea, a slim ink tower with cream bands, a cyan lamp under a flat cap.
      batch.tris(prism({ sides: 6, rx: 17, rz: 13, taper: 0.78, y0: -ROOT_DEPTH, y1: 4.2, jitter: 0.16, rng, open: true }), place(0, 0, 0, 0.3), P.timberSlate)
      batch.tris(prism({ sides: 6, rx: 17 * 0.8, rz: 13 * 0.8, taper: 0.9, y0: 3.9, y1: 4.9, jitter: 0.1, rng }), place(0, 0, 0, 0.3), TONE.snow)
      batch.tris(prism({ sides: 5, rx: 7, rz: 6, taper: 0.5, y0: -ROOT_DEPTH, y1: 2.6, jitter: 0.2, rng }), place(16, 0, 6, 1.1), P.timberSlate)
      const towerH = H - 4.9 - 1.9
      const tower = new THREE.CylinderGeometry(1.35, 1.9, towerH, 8)
      batch.geo(tower, place(0, 4.9 + towerH / 2, 0), P.ink)
      tower.dispose()
      for (const f of [0.3, 0.62]) {
        const band = new THREE.CylinderGeometry(1.9 - 0.55 * f + 0.08, 1.9 - 0.55 * f + 0.14, 1.0, 8)
        batch.geo(band, place(0, 4.9 + towerH * f, 0), P.cream, false)
        band.dispose()
      }
      const gallery = new THREE.CylinderGeometry(2.3, 1.9, 0.5, 8)
      batch.geo(gallery, place(0, 4.9 + towerH + 0.25, 0), P.ink)
      gallery.dispose()
      const cap = new THREE.ConeGeometry(2.0, 0.9, 8)
      batch.geo(cap, place(0, H - 0.45, 0), P.ink)
      cap.dispose()
      const hut = new THREE.BoxGeometry(4.2, 2.4, 3.0)
      batch.geo(hut, place(-7, 4.9 + 1.2, 2.5, 0.3), P.cream)
      hut.dispose()
      const hutRoof = new THREE.ConeGeometry(3.1, 1.3, 4)
      batch.geo(hutRoof, place(-7, 4.9 + 2.4 + 0.65, 2.5, 0.3 + Math.PI / 4), TONE.snow)
      hutRoof.dispose()
      return { geometry: batch.build(), lamp: [0, 4.9 + towerH + 1.2, 0], lampRadius: 1.25 }
    }
    case 'icebreaker': {
      // Long dark hull broadside to the harbour, cream deckhouse aft, one peach funnel; the plume is live.
      const hull = new THREE.BoxGeometry(48, 5, 9.5)
      batch.geo(hull, place(0, 2.0, 0), P.ink)
      hull.dispose()
      const prow = new THREE.BoxGeometry(6.8, 5, 6.8)
      batch.geo(prow, place(24, 2.0, 0, Math.PI / 4), P.ink)
      prow.dispose()
      const deck = new THREE.BoxGeometry(47, 0.4, 9.0)
      batch.geo(deck, place(0, 4.6, 0), P.cream, false)
      deck.dispose()
      const house = new THREE.BoxGeometry(14, 4.6, 7.4)
      batch.geo(house, place(-11, 4.6 + 2.3, 0), P.cream)
      house.dispose()
      const bridge = new THREE.BoxGeometry(9, 2.6, 6.4)
      batch.geo(bridge, place(-10, 9.2 + 1.3, 0), P.cream)
      bridge.dispose()
      const funnel = new THREE.CylinderGeometry(1.7, 1.9, 4.6, 8)
      batch.geo(funnel, place(-16.5, 9.2 + 2.3, 0), P.peach)
      funnel.dispose()
      const funnelTop = new THREE.CylinderGeometry(1.8, 1.8, 0.6, 8)
      batch.geo(funnelTop, place(-16.5, 9.2 + 4.6 + 0.3, 0), P.ink, false)
      funnelTop.dispose()
      const mast = new THREE.BoxGeometry(0.7, 6, 0.7)
      batch.geo(mast, place(10, 4.6 + 3, 0), P.ink, false)
      mast.dispose()
      const boom = new THREE.BoxGeometry(0.5, 0.5, 7)
      batch.geo(boom, place(10, 9.6, 2.6, 0, 0.5), P.peach, false)
      boom.dispose()
      for (const [x, color] of [
        [2, P.timberTeal],
        [5.2, P.coral],
        [-1.4, P.lilac],
      ] as Array<[number, string]>) {
        const crate = new THREE.BoxGeometry(2.8, 1.6, 3.2)
        batch.geo(crate, place(x, 4.6 + 0.8, 1.2), color)
        crate.dispose()
      }
      return { geometry: batch.build(), lamp: [-10, 10.6, 3.25], lampRadius: 0.9, funnel: [-16.5, H, 0] }
    }
    default: {
      // Ice cathedral: a tabular plinth, five crystal needles, a frozen cascade spilling toward the sea.
      batch.tris(prism({ sides: 7, rx: 27, rz: 19, taper: 0.9, y0: -ROOT_DEPTH, y1: 3.2, jitter: 0.1, rng, open: true }), place(0, 0, 0, 0.2), TONE.pale)
      batch.tris(prism({ sides: 7, rx: 27 * 0.92, rz: 19 * 0.92, taper: 0.9, y0: 2.9, y1: 4.0, jitter: 0.06, rng }), place(0, 0, 0, 0.2), TONE.snow)
      const needles: Array<[number, number, number, number, string]> = [
        [0, -2, 6.2, H, P.crystal],
        [-9, 1, 4.6, H * 0.74, TONE.pale],
        [8.5, -1, 4.2, H * 0.68, P.crystal],
        [-16, -4, 3.6, H * 0.52, TONE.pale],
        [15, 3, 3.2, H * 0.46, TONE.pale],
      ]
      for (const [x, z, r, h, color] of needles) {
        const cone = new THREE.ConeGeometry(r, h - 3.2, 5)
        batch.geo(cone, place(x, 3.2 + (h - 3.2) / 2, z, rng() * Math.PI, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.08), color)
        cone.dispose()
      }
      // The cascade: a slanted slab from the plinth lip down into the water on the camera side.
      const fall = new THREE.BoxGeometry(14, 1.6, 12)
      batch.geo(fall, place(4, 1.4, 19, 0.1, 0.42), P.crystal)
      fall.dispose()
      const falls = new THREE.BoxGeometry(6, 1.2, 7)
      batch.geo(falls, place(-7, 1.0, 20, -0.2, 0.5), TONE.pale)
      falls.dispose()
      return { geometry: batch.build(), lamp: [0, 7.4, 3.4], lampRadius: 1.4 }
    }
  }
}