/**
 * Geometry for the barriers and vistas: everything merges into a handful of vertex-coloured
 * buffers (the whole wall is one draw call). Flat per-face normals and a baked three-step facet
 * shade, like the authored land, with the haze toward the mist colour baked in so the far
 * landmarks read paler than the wall in front of them.
 */
import * as THREE from 'three'
import { JUNGLE_PALETTE as P, seeded } from '../../layout/jungle-layout'
import { mistColour, type OuterWorld } from '../outer/heightfield'
import type { BarrierPlan, Massif, Vista } from './geography'

const DAY_LIGHT = new THREE.Vector3(65, 105, 62).normalize()
const NIGHT_LIGHT = new THREE.Vector3(-55, 74, 30).normalize()
const FACET_STEPS: [number, number, number] = [1, 0.84, 0.68]

/** Roots: every piece continues this far under its ground so no base ever floats on a slope. */
export const ROOT_DEPTH = 8

const TONE = {
  rock: '#617c55',
  rockDark: '#4e6447',
  rockWet: '#71895c',
  moss: P.cliff,
  canopy: P.canopy,
  canopyLight: '#3f7f4d',
  canopyDark: P.canopyDark,
  bark: P.bark,
  barkLight: '#65442f',
  fall: '#f2fff1',
  pool: '#bfeee6',
  stone: P.ruin,
  stoneDark: '#948673',
  deck: P.deck,
  rope: '#6c4c37',
  flame: P.gold,
  ember: '#ff7a3a',
  lava: '#ffb347',
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

  constructor(
    private readonly night: boolean,
    private readonly hazeAmount = 0,
  ) {
    this.light = night ? NIGHT_LIGHT : DAY_LIGHT
    this.haze = new THREE.Color(mistColour(night))
  }

  get triangles(): number {
    return this.pos.length / 9
  }

  /** Push raw local-space triangles (9 floats each) through `m`, coloured flat with the facet bake. */
  tris(positions: ArrayLike<number>, m: THREE.Matrix4 | null, color: string, facet = true, hazeOverride?: number): void {
    const base = _col.set(color)
    if (this.night) base.offsetHSL(0.02, -0.08, -0.2)
    const r = base.r
    const g = base.g
    const b = base.b
    const h = hazeOverride ?? this.hazeAmount
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
      const cr = r * step * (1 - h) + this.haze.r * h
      const cg = g * step * (1 - h) + this.haze.g * h
      const cb = b * step * (1 - h) + this.haze.b * h
      for (let k = 0; k < 3; k++) this.col.push(cr, cg, cb)
    }
  }

  /** Push a three.js geometry (indexed or not) through `m`. */
  geo(geometry: THREE.BufferGeometry, m: THREE.Matrix4 | null, color: string, facet = true, hazeOverride?: number): void {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry
    this.tris(flat.attributes.position.array, m, color, facet, hazeOverride)
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
  taper: number
  y0: number
  y1: number
  jitter: number
  lean?: [number, number]
  rng: () => number
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

/** A flattened dodecahedron crown (the land's canopy shape) at (x, y, z). */
export function crown(batch: Batch, x: number, y: number, z: number, radius: number, color: string, yaw: number, haze?: number): void {
  const geo = new THREE.DodecahedronGeometry(1, 0)
  batch.geo(geo, place(x, y, z, yaw, 0, 0, radius, radius * 0.38, radius * 0.86), color, true, haze)
  geo.dispose()
}

/* ---------- the wall ---------- */

type GroundAt = (x: number, z: number) => number

function massifInto(batch: Batch, m: Massif, rng: () => number, groundAt: GroundAt): void {
  const y = groundAt(m.x, m.z)
  const rock = m.tone === 0 ? TONE.rock : TONE.rockDark
  const rock2 = m.tone === 0 ? TONE.rockWet : TONE.rock
  const at = place(m.x, y, m.z, m.yaw, m.tilt, (rng() - 0.5) * 0.05)
  switch (m.kind) {
    case 'buttress': {
      // A giant trunk with flared root fins, three crowns at the top.
      batch.tris(prism({ sides: m.sides, rx: m.rx, rz: m.rz, taper: m.taper, y0: -ROOT_DEPTH, y1: m.height, jitter: 0.14, rng, lean: [(rng() - 0.5) * 3, (rng() - 0.5) * 3] }), at, m.tone === 0 ? TONE.bark : TONE.barkLight)
      const fins = 4 + (rng() < 0.5 ? 1 : 0)
      for (let f = 0; f < fins; f++) {
        const a = (f / fins) * Math.PI * 2 + rng() * 0.8
        const reach = m.rx * (1.6 + rng() * 1.1)
        const fin = place(m.x + Math.cos(a) * reach * 0.5, y, m.z + Math.sin(a) * reach * 0.5, -a)
        batch.tris(prism({ sides: 4, rx: reach * 0.55, rz: 0.9, taper: 0.22, y0: -ROOT_DEPTH, y1: 6 + rng() * 5, jitter: 0.1, rng, lean: [-reach * 0.35, 0] }), fin, TONE.barkLight)
      }
      const top = y + m.height
      crown(batch, m.x, top + 1.5, m.z, m.rx * 3.2 + 6, TONE.canopy, m.yaw)
      crown(batch, m.x - Math.cos(m.yaw) * m.rx * 2.2, top - 1.4, m.z + Math.sin(m.yaw) * m.rx * 2.2, m.rx * 2.1 + 4, TONE.canopyLight, m.yaw + 0.7)
      crown(batch, m.x + Math.cos(m.yaw) * m.rx * 2.4, top - 0.4, m.z - Math.sin(m.yaw) * m.rx * 2.4, m.rx * 2.3 + 4, TONE.canopyDark, m.yaw - 0.5)
      return
    }
    case 'stack': {
      batch.tris(prism({ sides: m.sides, rx: m.rx, rz: m.rz, taper: m.taper, y0: -ROOT_DEPTH, y1: m.height, jitter: 0.18, rng }), at, rock)
      crown(batch, m.x, y + m.height + 0.6, m.z, m.rx * 1.1 + 1.5, TONE.canopyLight, m.yaw)
      return
    }
    case 'mound': {
      // A forest mass: a broad green prism with crowns heaped on it.
      batch.tris(prism({ sides: m.sides, rx: m.rx, rz: m.rz, taper: m.taper, y0: -ROOT_DEPTH, y1: m.height, jitter: 0.12, rng, open: true }), at, TONE.canopyDark)
      const n = 3 + Math.floor(rng() * 3)
      for (let k = 0; k < n; k++) {
        const u = (k / n - 0.5) * m.rx * 1.5
        const cx = m.x + Math.cos(m.yaw) * u
        const cz = m.z - Math.sin(m.yaw) * u
        crown(batch, cx + (rng() - 0.5) * 4, y + m.height - 1 + rng() * 2, cz + (rng() - 0.5) * 4, m.rx * 0.36 + rng() * 3, k % 2 ? TONE.canopy : TONE.canopyLight, rng() * Math.PI)
      }
      return
    }
    default: {
      // Cliff: three overlapping faceted rock blocks, a mossy canopy slab on each, boulders at the
      // foot, and on a fall cliff a white sheet down the land-facing face into a pale pool.
      const sides = Math.max(7, m.sides)
      const blocks: Array<{ dx: number; rx: number; rz: number; h: number; tone: string; taper: number }> = [
        { dx: 0, rx: m.rx * 0.7, rz: m.rz, h: m.height, tone: rock, taper: m.taper },
        { dx: m.rx * 0.66, rx: m.rx * 0.5, rz: m.rz * 1.05, h: m.height * (0.55 + rng() * 0.3), tone: rock2, taper: 0.74 },
        { dx: -m.rx * 0.7, rx: m.rx * 0.42, rz: m.rz * 0.9, h: m.height * (0.4 + rng() * 0.3), tone: rng() < 0.5 ? rock : rock2, taper: 0.68 },
      ]
      for (const blk of blocks) {
        const at2 = place(m.x + Math.cos(m.yaw) * blk.dx, y, m.z - Math.sin(m.yaw) * blk.dx, m.yaw + (rng() - 0.5) * 0.4, m.tilt * 0.6, (rng() - 0.5) * 0.05)
        batch.tris(prism({ sides, rx: blk.rx, rz: blk.rz, taper: blk.taper, y0: -ROOT_DEPTH, y1: blk.h, jitter: 0.14, rng, open: true, lean: [(rng() - 0.5) * 3, (rng() - 0.5) * 2] }), at2, blk.tone)
        batch.tris(prism({ sides, rx: blk.rx * blk.taper * 1.08, rz: blk.rz * blk.taper * 1.08, taper: 0.86, y0: blk.h - 0.4, y1: blk.h + 1.4 + blk.h * 0.05, jitter: 0.07, rng }), at2, TONE.moss)
        // Crowns heaped on the slab.
        crown(batch, m.x + Math.cos(m.yaw) * blk.dx + (rng() - 0.5) * 3, y + blk.h + 2.4, m.z - Math.sin(m.yaw) * blk.dx + (rng() - 0.5) * 3, blk.rx * 0.5 + 2, rng() < 0.5 ? TONE.canopy : TONE.canopyLight, rng() * Math.PI)
      }
      const foot = place(m.x + Math.sin(m.yaw) * -m.rz * 1.05, y, m.z + Math.cos(m.yaw) * -m.rz * 1.05, m.yaw + 0.9)
      batch.tris(prism({ sides: 6, rx: m.rx * 0.22, rz: m.rz * 0.4, taper: 0.5, y0: -ROOT_DEPTH, y1: 2 + m.height * 0.08, jitter: 0.2, rng }), foot, rock2)
      if (m.fall) {
        // The sheet hangs on the face toward the land (local −z), from near the slab to the pool.
        const sheetW = 2.6 + rng() * 2
        const faceZ = -m.rz * (0.72 + m.taper * 0.28)
        const sheet = new THREE.BoxGeometry(sheetW, m.height * 0.9, 0.5)
        batch.geo(sheet, place(m.x + Math.sin(m.yaw) * faceZ + Math.cos(m.yaw) * (rng() - 0.5) * m.rx * 0.4, y + m.height * 0.47, m.z + Math.cos(m.yaw) * faceZ - Math.sin(m.yaw) * (rng() - 0.5) * m.rx * 0.4, m.yaw), TONE.fall, false)
        sheet.dispose()
        const pool = new THREE.DodecahedronGeometry(1, 0)
        batch.geo(pool, place(m.x + Math.sin(m.yaw) * (faceZ - 4), y + 0.3, m.z + Math.cos(m.yaw) * (faceZ - 4), m.yaw, 0, 0, sheetW * 1.6, 0.5, 3.2), TONE.pool, false)
        batch.geo(pool, place(m.x + Math.sin(m.yaw) * (faceZ - 3), y + 1.6, m.z + Math.cos(m.yaw) * (faceZ - 3), m.yaw + 0.4, 0, 0, sheetW * 1.1, 0.9, 1.6), TONE.fall, false)
        pool.dispose()
      }
    }
  }
}

export function buildWall(plan: BarrierPlan, world: OuterWorld, night: boolean): THREE.BufferGeometry {
  const batch = new Batch(night, 0.04)
  const rng = seeded(world.seed * 29 + 3)
  for (const m of plan.wall) massifInto(batch, m, rng, world.height)
  return batch.build()
}

/* ---------- vistas ---------- */

export interface VistaBuild {
  geometry: THREE.BufferGeometry
  /** World position of the one light. */
  lamp: [number, number, number]
  lampRadius: number
  lampColor: string
  /** Bridge only: the swaying deck, built separately so one frame loop can rock it. */
  deck?: THREE.BufferGeometry
  /** Bridge only: the deck's pivot (mid-span, at deck height). */
  deckPivot?: [number, number, number]
}

/** A stepped temple on the far ridge: five tiers, a stair toward the camera, a shrine hut and a torch. */
function buildTemple(vista: Vista, world: OuterWorld, night: boolean): VistaBuild {
  const batch = new Batch(night, 0.22)
  const ground = world.height(vista.x, vista.z)
  const tiers = 5
  const tierH = 3.6
  let width = 34
  let y = ground - ROOT_DEPTH
  for (let t = 0; t < tiers; t++) {
    const h = t === 0 ? tierH + ROOT_DEPTH : tierH
    const box = new THREE.BoxGeometry(width, h, width * 0.86)
    batch.geo(box, place(vista.x, y + h / 2, vista.z, vista.yaw), t % 2 ? TONE.stoneDark : TONE.stone)
    box.dispose()
    // Moss creeping over the risers.
    for (let k = 0; k < 2; k++) {
      const moss = new THREE.BoxGeometry(width * 0.22, h * 0.5, 0.4)
      batch.geo(moss, place(vista.x + Math.cos(vista.yaw) * (k ? 1 : -1) * width * 0.28, y + h * 0.45, vista.z - Math.sin(vista.yaw) * (k ? 1 : -1) * width * 0.28 + Math.cos(vista.yaw) * width * 0.43, vista.yaw), TONE.moss, false)
      moss.dispose()
    }
    y += h
    width *= 0.74
  }
  // Stair up the camera face.
  const stair = new THREE.BoxGeometry(4.2, (tiers - 1) * tierH, 10)
  batch.geo(stair, place(vista.x + Math.sin(vista.yaw) * 13, ground + ((tiers - 1) * tierH) / 2, vista.z + Math.cos(vista.yaw) * 13, vista.yaw, -0.62), TONE.stoneDark)
  stair.dispose()
  // Shrine hut.
  const hut = new THREE.BoxGeometry(5.2, 3.2, 4.4)
  batch.geo(hut, place(vista.x, y + 1.6, vista.z, vista.yaw), TONE.bark)
  hut.dispose()
  const roof = new THREE.ConeGeometry(4.6, 2.8, 4)
  batch.geo(roof, place(vista.x, y + 3.2 + 1.4, vista.z, vista.yaw + Math.PI / 4), TONE.canopyDark)
  roof.dispose()
  // Torch pole on the camera side of the top platform.
  const pole = new THREE.CylinderGeometry(0.18, 0.26, 4.2, 5)
  batch.geo(pole, place(vista.x + Math.sin(vista.yaw) * 4.2, y + 2.1, vista.z + Math.cos(vista.yaw) * 4.2), TONE.bark, false)
  pole.dispose()
  return {
    geometry: batch.build(),
    lamp: [vista.x + Math.sin(vista.yaw) * 4.2, y + 4.6, vista.z + Math.cos(vista.yaw) * 4.2],
    lampRadius: 0.9,
    lampColor: TONE.flame,
  }
}

/** The rope bridge: rock pylons on both gorge rims and a sagging plank deck between them (separate geometry). */
function buildBridge(plan: BarrierPlan, world: OuterWorld, night: boolean): VistaBuild {
  const vista = plan.vistas.find((v) => v.id === 'south')!
  const g = plan.gorge
  const batch = new Batch(night, 0.2)
  const rng = seeded(world.seed * 31 + 9)
  const dirX = Math.sin(g.yaw)
  const dirZ = Math.cos(g.yaw)
  const span = (g.halfWidth + 5) * 2
  const towerH = vista.height - 5
  const ends: Array<[number, number, number]> = []
  for (const side of [-1, 1]) {
    // Pylons stand on the two rims, left and right of the view ray, so the deck crosses the frame side-on.
    const px = g.x + Math.cos(g.yaw) * side * (span / 2)
    const pz = g.z - Math.sin(g.yaw) * side * (span / 2)
    const py = world.height(px, pz)
    batch.tris(prism({ sides: 6, rx: 5.2, rz: 4.4, taper: 0.55, y0: -ROOT_DEPTH - 8, y1: towerH, jitter: 0.16, rng }), place(px, py, pz, g.yaw), TONE.rock)
    batch.tris(prism({ sides: 6, rx: 3.2, rz: 2.8, taper: 0.7, y0: towerH - 0.4, y1: towerH + 1, jitter: 0.1, rng }), place(px, py, pz, g.yaw), TONE.moss)
    const post = new THREE.CylinderGeometry(0.36, 0.48, 5, 5)
    batch.geo(post, place(px + dirX * 1.7, py + towerH + 1 + 2.5, pz + dirZ * 1.7), TONE.bark, false)
    batch.geo(post, place(px - dirX * 1.7, py + towerH + 1 + 2.5, pz - dirZ * 1.7), TONE.bark, false)
    post.dispose()
    ends.push([px, py + towerH + 1, pz])
  }
  const deck = new Batch(night, 0.2)
  const planks = 26
  const [a, b] = ends
  const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
  for (let i = 0; i < planks; i++) {
    const t = (i + 0.5) / planks
    const x = a[0] + (b[0] - a[0]) * t - mid[0]
    const z = a[2] + (b[2] - a[2]) * t - mid[2]
    const y = a[1] + (b[1] - a[1]) * t - mid[1] + Math.sin(t * Math.PI) * -3
    const plank = new THREE.BoxGeometry(3.2, 0.3, span / planks + 0.08)
    deck.geo(plank, place(x, y, z, g.yaw + Math.PI / 2, 0, (i % 3 - 1) * 0.03), i % 2 ? TONE.deck : '#a27647', false)
    plank.dispose()
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < planks; i++) {
      const t = (i + 0.5) / planks
      const x = a[0] + (b[0] - a[0]) * t - mid[0] + dirX * side * 1.7
      const z = a[2] + (b[2] - a[2]) * t - mid[2] + dirZ * side * 1.7
      const y = a[1] + (b[1] - a[1]) * t - mid[1] + Math.sin(t * Math.PI) * -3 + 1.3
      const rope = new THREE.BoxGeometry(0.22, 0.22, span / planks + 0.1)
      deck.geo(rope, place(x, y, z, g.yaw + Math.PI / 2), TONE.rope, false)
      rope.dispose()
      // Rail uprights every fourth plank.
      if (i % 4 === 1) {
        const upright = new THREE.BoxGeometry(0.2, 1.3, 0.2)
        deck.geo(upright, place(x, y - 0.65, z, g.yaw), TONE.rope, false)
        upright.dispose()
      }
    }
  }
  // One lantern, on the right-hand pylon's camera-side post.
  const post = ends[1]
  return {
    geometry: batch.build(),
    lamp: [post[0] + dirX * 1.7, post[1] + 5.4, post[2] + dirZ * 1.7],
    lampRadius: 0.7,
    lampColor: P.window,
    deck: deck.build(),
    deckPivot: mid,
  }
}

/** Where the delta beacon stands: on the north bank beside the vista point, clear of the channel. */
export function beaconFoot(vista: Vista): [number, number] {
  return [vista.x, vista.z - 30]
}

/** The delta beacon: a stilt watchtower on the bank where the river fans, two moored canoes beside it. */
function buildBeacon(vista: Vista, world: OuterWorld, night: boolean): VistaBuild {
  const batch = new Batch(night, 0.26)
  const [bx, bz] = beaconFoot(vista)
  const ground = Math.max(world.height(bx, bz), -0.6)
  const H = vista.height
  for (const [sx, sz] of [
    [-1.6, -1.6],
    [1.6, -1.6],
    [-1.6, 1.6],
    [1.6, 1.6],
  ]) {
    const post = new THREE.CylinderGeometry(0.22, 0.32, H * 0.62 + ROOT_DEPTH, 5)
    batch.geo(post, place(bx + sx, ground + (H * 0.62 - ROOT_DEPTH) / 2, bz + sz, vista.yaw), TONE.bark, false)
    post.dispose()
  }
  const platform = new THREE.BoxGeometry(5.6, 0.4, 5.6)
  batch.geo(platform, place(bx, ground + H * 0.62, bz, vista.yaw), TONE.deck)
  platform.dispose()
  const cabin = new THREE.BoxGeometry(3.6, H * 0.22, 3.6)
  batch.geo(cabin, place(bx, ground + H * 0.62 + H * 0.11 + 0.2, bz, vista.yaw), '#8c6843')
  cabin.dispose()
  const roof = new THREE.ConeGeometry(3.4, H * 0.16, 4)
  batch.geo(roof, place(bx, ground + H * 0.84 + H * 0.08 + 0.2, bz, vista.yaw + Math.PI / 4), TONE.canopyDark)
  roof.dispose()
  const ladder = new THREE.BoxGeometry(0.9, H * 0.62, 0.12)
  batch.geo(ladder, place(bx + Math.sin(vista.yaw) * 2.9, ground + H * 0.31, bz + Math.cos(vista.yaw) * 2.9, vista.yaw, -0.18), TONE.rope, false)
  ladder.dispose()
  const canoe = new THREE.DodecahedronGeometry(1, 0)
  batch.geo(canoe, place(bx + 9, world.riverSurface(bx + 9, bz + 24) + 0.3, bz + 24, 0.4, 0, 0, 2.8, 0.4, 0.8), P.coral)
  batch.geo(canoe, place(bx - 7, world.riverSurface(bx - 7, bz + 26) + 0.3, bz + 26, -0.3, 0, 0, 2.6, 0.4, 0.75), '#dca34f')
  canoe.dispose()
  return { geometry: batch.build(), lamp: [bx, ground + H * 0.84 + 0.3, bz + Math.cos(vista.yaw) * 1.9], lampRadius: 1.3, lampColor: P.window }
}

/** The volcano's crater: a dark rim ring and a glowing floor (the vista's one light). */
function buildVolcano(plan: BarrierPlan, world: OuterWorld, night: boolean): VistaBuild {
  const v = plan.volcano
  const batch = new Batch(night, 0.6)
  const floorY = world.height(v.x, v.z)
  const rimY = world.height(v.x + v.craterRadius * 0.95, v.z)
  const rim = new THREE.CylinderGeometry(v.craterRadius * 1.15, v.craterRadius * 1.3, 2.5, 9, 1, true)
  batch.geo(rim, place(v.x, rimY + 0.4, v.z), '#4a4642', true, 0.6)
  rim.dispose()
  const floor = new THREE.CylinderGeometry(v.craterRadius * 0.8, v.craterRadius * 0.8, 1, 9)
  batch.geo(floor, place(v.x, floorY + 1.2, v.z), night ? TONE.ember : '#6b4a3a', false, night ? 0.1 : 0.55)
  floor.dispose()
  // The glow stands proud of the rim so a low camera sees it over the crater's near lip.
  return { geometry: batch.build(), lamp: [v.x, rimY + 5, v.z], lampRadius: v.craterRadius * 0.5, lampColor: TONE.lava }
}

export function buildVista(vista: Vista, plan: BarrierPlan, world: OuterWorld, night: boolean): VistaBuild {
  switch (vista.kind) {
    case 'temple':
      return buildTemple(vista, world, night)
    case 'bridge':
      return buildBridge(plan, world, night)
    case 'delta':
      return buildBeacon(vista, world, night)
    default:
      return buildVolcano(plan, world, night)
  }
}

/* ---------- far detail geometry ---------- */

/** Near canopy dome: a dodecahedron the instance matrix flattens (the land's own crown shape). */
export function domeGeometry(): THREE.BufferGeometry {
  return new THREE.DodecahedronGeometry(1, 0)
}

/**
 * Far canopy clump: an icosahedron, flattened by the instance matrix. Its normals all point up:
 * hazed nearly to the sky, its facets must not be inked by the pixel pass's normal-edge detector
 * (which would draw every far clump as a wireframe bubble); only the silhouette's depth edge stays.
 */
export function farDomeGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 0)
  const normal = geo.getAttribute('normal') as THREE.BufferAttribute
  for (let i = 0; i < normal.count; i++) normal.setXYZ(i, 0, 1, 0)
  normal.needsUpdate = true
  return geo
}

/** Trunk: an open cylinder from y = 0 to 1 (the instance scales height and girth). */
export function trunkGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.55, 1, 1, 7, 1, true)
  geo.translate(0, 0.5, 0)
  return geo
}

/** Palm crown: six drooping fronds (thin triangles) round the top of a unit palm. */
export function palmCrownGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const fronds = 6
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2
    const dx = Math.cos(a)
    const dz = Math.sin(a)
    // Root at the crown, tip 0.42 out and 0.16 down, half-width 0.07 at the root.
    const px = -dz * 0.07
    const pz = dx * 0.07
    positions.push(px, 1, pz, -px, 1, -pz, dx * 0.42, 0.84, dz * 0.42)
    positions.push(-px, 1, -pz, px, 1, pz, dx * 0.42, 0.84, dz * 0.42)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  return geo
}

/** Fall sheet: a unit plane the instance stretches to width × drop. */
export function sheetGeometry(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1, 1)
}

/** Mist curtain: an inward-facing cylinder strip with RGBA vertex colours (opaque foot, clear top), wobbled so it is not a compass circle. */
export function curtainGeometry(radius: number, y0: number, y1: number, opacity: number, color: string, seed: number): THREE.BufferGeometry {
  const segments = 96
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const c = new THREE.Color(color)
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    const wobble = 1 + 0.03 * Math.sin(a * 3 + seed) + 0.02 * Math.sin(a * 7 - seed * 0.7)
    const r = radius * wobble
    const top = y1 + (y1 - y0) * 0.18 * Math.sin(a * 5 + seed * 1.3)
    const gaps = 0.55 + 0.45 * Math.sin(a * 4 + seed * 2.1) * Math.sin(a * 9 + 0.4)
    const x = Math.sin(a) * r
    const z = Math.cos(a) * r
    positions.push(x, y0, z, x, (y0 + top) * 0.5, z, x, top, z)
    colors.push(c.r, c.g, c.b, opacity * gaps, c.r, c.g, c.b, opacity * gaps * 0.45, c.r, c.g, c.b, 0)
    if (i < segments) {
      const k = i * 3
      indices.push(k, k + 3, k + 1, k + 1, k + 3, k + 4, k + 1, k + 4, k + 2, k + 2, k + 4, k + 5)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}
