/**
 * Endless red-rock desert: the pure heightfield beyond the authored plate. No three.js here.
 *
 * Coordinates as in the layout: x east, z south, y up, metres. The plate (./plate.ts) is flat
 * at y = 0; everything here is multiplied by `landMask` so the seam is exactly 0 and nothing
 * rises within LAND_CLEARANCE of an authored road or building. Beyond it the basin goes on:
 * gently rolling flats with compacted patches, a wash network and the arroyo's own channel
 * running south into a dry lake bed, a dune ridge across the south with a saddle where the
 * arroyo breaks through, a gorge down the east side with a canyon rim, an escarpment of
 * badlands to the west, and mesa country rising north in rows A, B, C and a ghost row toward
 * one horizon, with far ranges on the other three horizons so the sky never meets a flat line.
 * Haze toward the sky is baked per sample (aerial perspective); the renderer tints with it.
 */
import { cellular, clamp, fbm, lerp, ridged, seededRng, smoothstep } from './noise'
import { PLATE, insideRect, landMask, plateDistance } from './plate'
import { type Place, planPlaces } from './places'
import { type Vista, type VistaId, type Window, outwardPose, viewBearingDeg, vistas as planVistas, windows as planWindows, windowOpening } from './vistas'

export type GroundKind = 'sand' | 'sandAlt' | 'wash' | 'playa' | 'dune' | 'duneShade' | 'rock' | 'scree' | 'cap' | 'floor' | 'pool'

export interface OuterSample {
  height: number
  kind: GroundKind
  /** On a landform: this point's height as a fraction of its top (0 off landforms). */
  mesaFrac: number
  /** Row of the dominant landform (1 = the barrier row A … 4 = ghost / far ranges), 0 elsewhere. */
  row: 0 | 1 | 2 | 3 | 4
  /** 0–1 toward the sky colour: baked aerial perspective. */
  haze: number
}

export type LandformKind = 'mesa' | 'table' | 'butte' | 'knob' | 'range'

export interface Landform {
  kind: LandformKind
  x: number
  z: number
  /** Footprint radii along x / z (ellipse), metres. */
  rx: number
  rz: number
  /** Top above the local ground. */
  height: number
  row: 1 | 2 | 3 | 4
  /** Shape salt. */
  salt: number
  /** Set when the landform exists for a mid-field place (its table or knob). */
  placeId?: string
}

/** The timber trestle across the gorge at the east window, and the rock the line tunnels into on the near rim. */
export interface TrestlePlan {
  /** Deck centre (on the gorge centreline at the window crossing). */
  x: number
  z: number
  /** Axis bearing, degrees from +z toward +x; the deck runs from `near` (land side) to `far`. */
  bearingDeg: number
  near: [number, number]
  far: [number, number]
  length: number
  /** Deck height above the rim ground. */
  deckY: number
  portal: { x: number; z: number; r: number; height: number }
}

/** The trestle crosses the gorge 35° off the pose ray so the near portal rock sits beside the view, not on it. */
export const TRESTLE_SKEW_DEG = 35

/** The far cutting: a trench the line climbs through beyond the trestle's far abutment, up to the plateau and the rail yard. */
export const CUTTING = { length: 160, halfWidth: 6, blend: 7 } as const

export function trestlePlan(east: Window, gorgeX: number): TrestlePlan {
  const bearingDeg = viewBearingDeg(outwardPose('east')) - TRESTLE_SKEW_DEG
  const b = (bearingDeg * Math.PI) / 180
  const dx = Math.sin(b)
  const dz = Math.cos(b)
  const half = GORGE.wallHalf / Math.abs(dx)
  const x = gorgeX
  const z = east.z
  const near: [number, number] = [x - dx * half, z - dz * half]
  const far: [number, number] = [x + dx * half, z + dz * half]
  const portal = { x: near[0] - dx * 15, z: near[1] - dz * 15, r: 20, height: 22 }
  return { x, z, bearingDeg, near, far, length: half * 2, deckY: 2, portal }
}

export interface OuterDesert {
  seed: number
  windows: Window[]
  vistas: Vista[]
  trestle: TrestlePlan
  /** The inhabited mid-field (./places.ts), planned with this world's trestle line. */
  places: Place[]
  landforms: Landform[]
  /** Arroyo continuation past the plate, world xz. */
  arroyo: Array<[number, number]>
  playa: { x: number; z: number; rx: number; rz: number; yaw: number }
  sample(x: number, z: number): OuterSample
  /** Height only (cheaper; same number as `sample().height`). */
  heightAt(x: number, z: number): number
  /** The authored height on the plate edge: the slab has always been flat at 0. */
  seamHeight(x: number, z: number): number
  /** Haze for a bare point (instances). */
  hazeAt(x: number, z: number): number
  /** The gorge centreline x at a given z, and its depth factor (0 where it has faded out). */
  gorge(z: number): { x: number; fade: number }
  /** The escarpment foot x at a given z and its fade. */
  escarpment(z: number): { x: number; fade: number }
  /** Dune crest z at a given x and the local amplitude. */
  duneCrest(x: number): { z: number; amplitude: number }
}

/* ---------- constants that the tests and the renderer share ---------- */

export const GORGE = { x: 385, depth: 46, floorHalf: 22, wallHalf: 44, swing: 130, farRise: 14 } as const
export const DUNE_RIDGE = { z: 285, amplitude: 16, windward: 64, slip: 13, reach: 560 } as const
export const ESCARPMENT = { x: -330, step: 14, bench: 6 } as const
export const PLAYA = { x: 20, z: 650, rx: 240, rz: 190, yaw: 0.25, depth: 3.6 } as const

/** Haze floors per landform row, continuing the authored skyline's own bake (near 0.3, far 0.42). */
export const ROW_HAZE: Record<1 | 2 | 3 | 4, number> = { 1: 0.5, 2: 0.6, 3: 0.74, 4: 0.88 }

/** Aerial perspective: the authored land stays crisp, the rings dissolve into the sky. */
export const DESERT_FOG = {
  day: { near: 260, far: 1650 },
  night: { near: 220, far: 1250 },
} as const

/* ---------- landforms ---------- */

interface RowSpec {
  row: 1 | 2 | 3 | 4
  z: number
  /** Gentle bow z = z0 + curve·x², so the ends stay back. */
  curve: number
  xFrom: number
  xTo: number
  spacing: number
  radius: [number, number]
  height: [number, number]
  jitterZ: number
}

const MESA_ROWS: RowSpec[] = [
  // Row A's feet stay north of z ≈ −262, past the land mask's ramp, so its south cliffs are full height.
  { row: 1, z: -322, curve: -0.00012, xFrom: -470, xTo: 470, spacing: 118, radius: [40, 54], height: [74, 92], jitterZ: 12 },
  { row: 2, z: -570, curve: -0.0001, xFrom: -760, xTo: 760, spacing: 185, radius: [82, 122], height: [104, 142], jitterZ: 40 },
  { row: 3, z: -960, curve: -0.00006, xFrom: -1100, xTo: 1100, spacing: 300, radius: [130, 190], height: [160, 222], jitterZ: 60 },
  { row: 4, z: -1680, curve: -0.00003, xFrom: -1600, xTo: 1600, spacing: 520, radius: [260, 340], height: [250, 320], jitterZ: 90 },
]

function range(rng: () => number, [a, b]: [number, number]): number {
  return a + rng() * (b - a)
}

/** Spots a seeded landform must keep clear of (the mid-field places). */
export interface Avoid {
  x: number
  z: number
  r: number
}

function avoided(avoid: readonly Avoid[], x: number, z: number, reach: number): boolean {
  return avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.r + reach + 8)
}

/** Every landform of the world, seeded; the north window (row A) is cut around `north`, and the seeded buttes keep off `avoid`. */
export function buildLandforms(seed: number, north: Window, avoid: readonly Avoid[] = []): Landform[] {
  const out: Landform[] = []
  const rng = seededRng(seed * 31 + 7)
  // Mesa rows. Row A skips the window and sets a tall mesa on each lip of it.
  for (const spec of MESA_ROWS) {
    for (let x0 = spec.xFrom; x0 <= spec.xTo; x0 += spec.spacing) {
      const x = x0 + (rng() - 0.5) * spec.spacing * 0.45
      const z = spec.z + spec.curve * x * x + (rng() - 0.5) * spec.jitterZ * 2
      const r = range(rng, spec.radius)
      const h = range(rng, spec.height)
      const salt = rng() * 100
      if (spec.row === 1) {
        if (Math.abs(x - north.along) < north.halfWidth + r + 10) continue
      }
      out.push({ kind: 'mesa', x, z, rx: r * (0.95 + rng() * 0.4), rz: r * (0.8 + rng() * 0.2), height: h, row: spec.row, salt })
    }
  }
  // The window's lips: a tall mesa hard against each side (the low table in the middle is the vista).
  for (const side of [-1, 1]) {
    out.push({ kind: 'mesa', x: north.along + side * (north.halfWidth + 52), z: -322 + side * 6, rx: 54, rz: 42, height: 84 + (side > 0 ? 6 : 0), row: 1, salt: 11 + side })
  }
  // Corner closures where the rows meet the east gorge and the west escarpment.
  out.push({ kind: 'mesa', x: 580, z: -250, rx: 52, rz: 44, height: 62, row: 1, salt: 41 })
  out.push({ kind: 'butte', x: 640, z: -120, rx: 34, rz: 30, height: 48, row: 1, salt: 42 })
  out.push({ kind: 'mesa', x: -478, z: -252, rx: 56, rz: 46, height: 70, row: 1, salt: 43 })
  out.push({ kind: 'butte', x: -548, z: -146, rx: 40, rz: 34, height: 54, row: 1, salt: 44 })
  out.push({ kind: 'butte', x: -470, z: -58, rx: 30, rz: 26, height: 38, row: 1, salt: 45 })
  // Buttes on the far plateau across the gorge.
  const bRng = seededRng(seed * 17 + 3)
  for (let i = 0; i < 8; i++) {
    const z = -330 + i * 78 + (bRng() - 0.5) * 40
    const x = 490 + bRng() * 220
    const rx = 18 + bRng() * 22
    const rz = 16 + bRng() * 18
    const height = 26 + bRng() * 30
    if (avoided(avoid, x, z, Math.max(rx, rz))) continue
    out.push({ kind: 'butte', x, z, rx, rz, height, row: 1, salt: 50 + i })
  }
  // South-east corner knobs between the gorge's end and the dune ridge.
  out.push({ kind: 'knob', x: 400, z: 300, rx: 30, rz: 26, height: 26, row: 1, salt: 61 })
  out.push({ kind: 'knob', x: 462, z: 356, rx: 24, rz: 22, height: 20, row: 1, salt: 62 })
  // Far ranges on the east, south and west horizons (the north has the ghost row).
  const fRng = seededRng(seed * 23 + 9)
  const ranges: Array<[number, number, number, number]> = [
    // centre x, centre z, extent along, bearing (0 = along z)
    [1560, 60, 1300, 0],
    [40, 1760, 1500, Math.PI / 2],
    [-1580, 120, 1300, 0],
  ]
  for (const [cx, cz, extent, bearing] of ranges) {
    const n = 5
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1) - 0.5) * extent
      const off = (fRng() - 0.5) * 220
      const x = cx + Math.cos(bearing) * off + Math.sin(bearing) * t
      const z = cz - Math.sin(bearing) * off + Math.cos(bearing) * t
      out.push({ kind: 'range', x, z, rx: 230 + fRng() * 120, rz: 200 + fRng() * 100, height: 120 + fRng() * 80, row: 4, salt: 70 + i })
    }
  }
  return out
}

/** Flat-topped profile of a mesa against the normalised inset `k` (1 − r / R). */
function mesaProfile(k: number, kind: LandformKind): number {
  if (k <= 0) return 0
  if (kind === 'range') {
    const t = Math.min(1, k)
    return t * t * (3 - 2 * t) * (0.7 + 0.3 * t)
  }
  const talus = kind === 'knob' ? 0.22 : 0.16
  const cliffTop = kind === 'knob' ? 0.4 : kind === 'butte' ? 0.3 : 0.26
  const shoulder = kind === 'knob' ? 0.3 : 0.18
  return shoulder * smoothstep(0, talus, k) + (0.92 - shoulder) * smoothstep(talus, cliffTop, k) + 0.08 * smoothstep(cliffTop, 0.6, k)
}

/* ---------- the world ---------- */

export function createOuterDesert(seed: number, windows: Window[] = planWindows()): OuterDesert {
  const win = (id: VistaId) => windows.find((w) => w.id === id)!
  const north = win('north')
  const east = win('east')
  const south = win('south')
  const west = win('west')
  const vistaList = planVistas()
  const vistaOf = (id: VistaId) => vistaList.find((v) => v.id === id)!

  // The arroyo leaves the plate at its authored heading and runs through the dune saddle to the playa.
  const arroyo: Array<[number, number]> = [
    [-77, 170],
    [-56, 226],
    [south.along - 8, DUNE_RIDGE.z - 6],
    [south.along + 14, 332],
    [south.along + 52, 392],
    [south.along + 72, 450],
  ]

  const gorge = (z: number) => {
    const swing = smoothstep(150, 330, -z)
    const x = GORGE.x + GORGE.swing * swing + 12 * Math.sin(z / 80) + 8 * fbm(z * 0.012, 7.7, 2)
    const fade = smoothstep(-430, -340, z) * (1 - smoothstep(200, 290, z))
    return { x, fade }
  }
  const escarpment = (z: number) => {
    const x = ESCARPMENT.x + 16 * fbm(z * 0.012, 2.2, 2) + 10 * Math.sin(z / 70)
    const fade = smoothstep(-300, -220, z) * (1 - smoothstep(200, 280, z))
    return { x, fade }
  }

  // The trestle line sets where the rail yard goes; the places are planned before the seeded
  // landforms so knobs and buttes keep off them.
  const trestle = trestlePlan(east, gorge(east.z).x)
  const places = planPlaces(seed, windows, trestle)
  const avoid: Avoid[] = places.map((p) => ({ x: p.x, z: p.z, r: p.r }))
  const landforms = buildLandforms(seed, north, avoid)

  // Landforms the vistas stand on: the window table (north), the mast's butte (west), the portal rock (east).
  const table = vistaOf('north')
  landforms.push({ kind: 'table', x: table.x, z: table.z, rx: 46, rz: 40, height: table.base, row: 1, salt: 5 })
  const mast = vistaOf('west')
  landforms.push({ kind: 'butte', x: mast.x, z: mast.z, rx: 26, rz: 22, height: mast.base, row: 1, salt: 6 })
  landforms.push({ kind: 'knob', x: trestle.portal.x, z: trestle.portal.z, rx: trestle.portal.r, rz: trestle.portal.r * 0.9, height: trestle.portal.height, row: 1, salt: 8 })
  // Landforms the places stand on: the pueblo's table, the mine's knob.
  for (const p of places) {
    if (!p.landform) continue
    const c = Math.cos(p.yaw)
    const s = Math.sin(p.yaw)
    const lf = p.landform
    landforms.push({ kind: lf.kind, x: p.x + (lf.dx * c + lf.dz * s) * p.scale, z: p.z + (-lf.dx * s + lf.dz * c) * p.scale, rx: lf.rx * p.scale, rz: lf.rz * p.scale, height: lf.height * p.scale, row: 1, salt: 90 + p.id.length, placeId: p.id })
  }
  // Knobs along the near canyon rim (the rim reads as a broken wall), skipping the window and the places.
  const kRng = seededRng(seed * 19 + 1)
  for (let z = -300; z <= 220; z += 64 + kRng() * 40) {
    const gx = gorge(z).x
    const x = gx - GORGE.wallHalf - 6 - kRng() * 14
    const rx = 11 + kRng() * 12
    const rz = 10 + kRng() * 10
    const height = 12 + kRng() * 14
    if (Math.abs(z - east.along) < east.halfWidth + 24) continue
    if (avoided(avoid, x, z, Math.max(rx, rz))) continue
    landforms.push({ kind: 'knob', x, z, rx, rz, height, row: 1, salt: 80 + z })
  }

  // Flat pads: the mission's, and one under every place (its base is sampled before the pads exist).
  const pads: Array<{ x: number; z: number; r: number; y: number; kind?: GroundKind }> = []
  /** The ferry's pool of standing water, set once the pads are known. */
  let pool: { x: number; z: number; rx: number; rz: number; y: number; cos: number; sin: number } | null = null
  const mission = vistaOf('south')

  const cutDir = [Math.sin((trestle.bearingDeg * Math.PI) / 180), Math.cos((trestle.bearingDeg * Math.PI) / 180)]
  const cutEnd = [trestle.far[0] + cutDir[0] * CUTTING.length, trestle.far[1] + cutDir[1] * CUTTING.length]
  /** Distance to the cutting's axis and the fraction along it (0 at the far abutment, 1 at its end). */
  const cuttingAt = (x: number, z: number): { distance: number; along: number } => {
    const ax = trestle.far[0]
    const az = trestle.far[1]
    const dx = cutEnd[0] - ax
    const dz = cutEnd[1] - az
    const len2 = dx * dx + dz * dz
    const t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1)
    return { distance: Math.hypot(ax + dx * t - x, az + dz * t - z), along: t }
  }

  const duneCrest = (x: number) => {
    const z = DUNE_RIDGE.z + 9 * Math.sin(x / 57) + 6 * fbm(x * 0.01, 2.2, 2)
    const open = windowOpening(south, x, 40)
    const end = 1 - smoothstep(DUNE_RIDGE.reach - 120, DUNE_RIDGE.reach, Math.abs(x))
    const amplitude = (DUNE_RIDGE.amplitude + 6 * Math.cos(x / 14 + 0.5) + 3 * fbm(x * 0.03, 4, 2)) * (1 - 0.86 * open) * end
    return { z, amplitude }
  }

  const arroyoDistance = (x: number, z: number): number => {
    let best = Infinity
    for (let i = 1; i < arroyo.length; i++) {
      const [ax, az] = arroyo[i - 1]
      const [bx, bz] = arroyo[i]
      const dx = bx - ax
      const dz = bz - az
      const len2 = dx * dx + dz * dz || 1
      const t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1)
      const d = Math.hypot(ax + dx * t - x, az + dz * t - z)
      if (d < best) best = d
    }
    return best
  }

  const playaLocal = (x: number, z: number): number => {
    const dx = x - PLAYA.x
    const dz = z - PLAYA.z
    const c = Math.cos(PLAYA.yaw)
    const s = Math.sin(PLAYA.yaw)
    const lx = dx * c - dz * s
    const lz = dx * s + dz * c
    const r = Math.hypot(lx / PLAYA.rx, lz / PLAYA.rz)
    return r * (1 + 0.07 * fbm(Math.atan2(lz, lx) * 1.3 + 4, 2.2, 2))
  }

  const hazeAt = (x: number, z: number): number => {
    const d = plateDistance(x, z)
    const base = 0.1 * smoothstep(0, 160, d) + 0.86 * smoothstep(0, 1500, d)
    const northBand = 0.28 * smoothstep(-200, -420, z) * (1 - smoothstep(0, 1200, d))
    return clamp(base + northBand, 0, 0.95)
  }

  interface LandformHit {
    height: number
    frac: number
    row: 0 | 1 | 2 | 3 | 4
    kind: LandformKind | null
  }

  const landformAt = (x: number, z: number): LandformHit => {
    let best: LandformHit = { height: 0, frac: 0, row: 0, kind: null }
    let sum = 0
    for (const m of landforms) {
      const dx = x - m.x
      const dz = z - m.z
      if (Math.abs(dx) > m.rx * 1.35 || Math.abs(dz) > m.rz * 1.35) continue
      const a = Math.atan2(dz / m.rz, dx / m.rx)
      const wobble = 1 + 0.2 * fbm(Math.cos(a) * 2.3 + m.salt, Math.sin(a) * 2.3 + m.salt * 0.7, 2)
      const r = Math.hypot(dx / m.rx, dz / m.rz) / wobble
      const k = 1 - r
      if (k <= 0) continue
      const h = m.height * mesaProfile(k, m.kind)
      sum += h
      if (h > best.height) best = { height: h, frac: h / m.height, row: m.row, kind: m.kind }
    }
    if (best.height > 0) best.height += (sum - best.height) * 0.12
    return best
  }

  const sampleFull = (x: number, z: number, needKind: boolean): OuterSample => {
    if (insideRect(PLATE, x, z)) return { height: 0, kind: 'sand', mesaFrac: 0, row: 0, haze: 0 }
    const m = landMask(x, z)
    const haze = hazeAt(x, z)
    if (m <= 0) return { height: 0, kind: 'sand', mesaFrac: 0, row: 0, haze }
    const d = plateDistance(x, z)

    // Rolling flats, stronger with distance; compacted darker patches.
    const grow = 0.5 + 0.5 * smoothstep(0, 500, d)
    let h = (2.4 * fbm(x * 0.012 + 3.1, z * 0.012 + 8.4, 3) + 0.8 * fbm(x * 0.05, z * 0.05, 2)) * grow
    let kind: GroundKind = 'sand'
    // Colour variation eases in with the mask too, so the seam keeps the plate's one flat colour.
    if (needKind && fbm(x * 0.02 + 7, z * 0.02 + 1, 2) < -0.44 - 0.7 * (1 - m)) kind = 'sandAlt'

    // The basin tilts up toward the mesa country.
    h += 12 * smoothstep(-200, -900, z) + 40 * smoothstep(-800, -2000, z)

    // Dry lake bed.
    const pr = playaLocal(x, z)
    const playaK = 1 - smoothstep(0.8, 1, pr)
    if (playaK > 0) {
      h = lerp(h, -PLAYA.depth, playaK)
      if (needKind) kind = pr < 0.9 ? 'playa' : 'sandAlt'
    }

    // Wash network on the flats (Worley cell edges) and the arroyo's own channel.
    if (playaK < 1) {
      const warp = fbm(z * 0.004 + 1.7, x * 0.004 + 9.2, 2) * 30
      const density = smoothstep(0.02, 0.22, fbm(x * 0.003 + 5, z * 0.003 + 2, 2))
      let washK = 0
      if (density > 0) {
        const c = cellular(x + warp, z - warp, 150, 3)
        washK = (1 - smoothstep(4, 11, c.f2 - c.f1)) * density
      }
      const da = arroyoDistance(x, z)
      const arroyoK = (1 - smoothstep(4.5, 12, da)) * smoothstep(170, 200, z) * (1 - playaK)
      const channel = Math.max(washK, arroyoK)
      if (channel > 0) {
        h -= 1.8 * channel * (1 - playaK)
        if (needKind && channel * m > 0.55) kind = 'wash'
      }
    }

    // Dune ridge across the south (the window is a low saddle) and the dune field beyond.
    const crest = duneCrest(x)
    const dd = z - crest.z
    const prof = dd < 0 ? smoothstep(-DUNE_RIDGE.windward, 0, dd) : 1 - smoothstep(0, DUNE_RIDGE.slip, dd)
    const ridge = crest.amplitude * prof
    if (ridge > 0.05) {
      h += ridge
      if (needKind && prof > 0.12) kind = dd > 0 ? 'duneShade' : 'dune'
    }
    const fieldK = Math.max(smoothstep(330, 400, z), smoothstep(-520, -600, x) * smoothstep(200, 280, z)) * (1 - playaK)
    if (fieldK > 0) {
      const field = 7 * ridged(x * 0.008 + fbm(z * 0.01, 3, 1) * 0.6, z * 0.028, 2) * fieldK
      h += field
      if (needKind && field > 2.5) kind = 'dune'
    }

    // East gorge: a canyon down to a floor, the far side rising to a plateau.
    const g = gorge(z)
    if (g.fade > 0) {
      const gd = x - g.x
      const inGorge = 1 - smoothstep(GORGE.floorHalf, GORGE.wallHalf, Math.abs(gd))
      if (inGorge > 0) {
        h -= GORGE.depth * inGorge * g.fade
        if (needKind) kind = inGorge > 0.97 ? 'floor' : 'rock'
      }
      h += GORGE.farRise * smoothstep(GORGE.wallHalf, 80, gd) * g.fade
      // The railway cutting: the line leaves the trestle's far end through a trench that climbs
      // the rising plateau toward the rail yard (the floor rises from the deck to the plateau).
      const cut = cuttingAt(x, z)
      if (cut.distance < CUTTING.halfWidth + CUTTING.blend) {
        const floor = lerp(trestle.deckY - 0.6, GORGE.farRise, smoothstep(0.12, 1, cut.along))
        const k = 1 - smoothstep(CUTTING.halfWidth, CUTTING.halfWidth + CUTTING.blend, cut.distance)
        if (h > floor) h = lerp(h, floor, k)
        if (needKind && k > 0.5) kind = 'scree'
      }
    }

    // West escarpment: the land steps up onto a badlands bench.
    const e = escarpment(z)
    if (e.fade > 0) {
      const up = smoothstep(0, 16, e.x - x)
      if (up > 0) {
        const open = windowOpening(west, z, 36)
        h += ESCARPMENT.step * up * e.fade * (1 - 0.6 * open)
        h += ESCARPMENT.bench * ridged(x * 0.02 + 1, z * 0.02 + 3, 2) * smoothstep(0, 40, e.x - x) * e.fade
        if (needKind && up > 0.1 && up < 0.95) kind = 'rock'
      }
    }

    // Mesas, buttes, knobs and far ranges.
    const lf = landformAt(x, z)
    let mesaFrac = 0
    let row: OuterSample['row'] = 0
    if (lf.height > 0.1) {
      h += lf.height
      mesaFrac = lf.frac
      row = lf.row
      if (needKind) kind = lf.frac > 0.9 ? 'cap' : lf.frac > 0.22 ? 'rock' : 'scree'
    }

    h *= m

    // Flat pads last, so the mission, the mesa settlement and every mid-field place stand level.
    for (const pad of pads) {
      const pd = Math.hypot(x - pad.x, z - pad.z)
      if (pd < pad.r) {
        const k = smoothstep(pad.r * 0.55, pad.r, pd)
        h = lerp(pad.y, h, k)
        if (needKind && k < 0.5 && pad.kind) kind = pad.kind
      }
    }
    // The ferry's pool: a short reach of standing water in the wash.
    if (pool) {
      const dx = x - pool.x
      const dz = z - pool.z
      const lx = dx * pool.cos - dz * pool.sin
      const lz = dx * pool.sin + dz * pool.cos
      const pr2 = Math.hypot(lx / pool.rx, lz / pool.rz)
      if (pr2 < 1) {
        h = Math.min(h, pool.y - 0.5 * (1 - pr2))
        if (needKind) kind = 'pool'
      }
    }

    let hz = haze
    if (row > 0) hz = lerp(haze, Math.max(haze, ROW_HAZE[row as 1 | 2 | 3 | 4]), smoothstep(0.05, 0.4, mesaFrac))
    return { height: h, kind, mesaFrac, row, haze: hz }
  }

  // Pads are installed after the sampler exists: each place's base is the ground it would have had.
  pads.push({ x: mission.x, z: mission.z, r: 40, y: mission.base })
  for (const p of places) {
    const raw = sampleFull(p.x, p.z, false).height
    const base = p.landform?.kind === 'table' ? raw : Math.round(raw * 2) / 2
    pads.push({ x: p.x, z: p.z, r: (p.padR ?? p.r) + 6, y: base, kind: p.kind === 'cattle-drive' ? undefined : 'sand' })
  }
  const ferry = places.find((p) => p.kind === 'ferry')
  if (ferry) {
    const base = pads.find((pad) => pad.x === ferry.x && pad.z === ferry.z)!.y
    // Along the arroyo's heading at the ferry (its nearest channel segment).
    let best = 1
    let bestD = Infinity
    for (let i = 1; i < arroyo.length; i++) {
      const [ax, az] = arroyo[i - 1]
      const [bx, bz] = arroyo[i]
      const d = Math.hypot((ax + bx) / 2 - ferry.x, (az + bz) / 2 - ferry.z)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    const yaw = Math.atan2(arroyo[best][0] - arroyo[best - 1][0], arroyo[best][1] - arroyo[best - 1][1])
    pool = { x: ferry.x, z: ferry.z, rx: 7, rz: 19, y: base - 0.4, cos: Math.cos(yaw), sin: Math.sin(yaw) }
  }

  return {
    seed,
    windows,
    vistas: vistaList,
    trestle,
    places,
    landforms,
    arroyo,
    playa: { x: PLAYA.x, z: PLAYA.z, rx: PLAYA.rx, rz: PLAYA.rz, yaw: PLAYA.yaw },
    sample: (x, z) => sampleFull(x, z, true),
    heightAt: (x, z) => sampleFull(x, z, false).height,
    seamHeight: () => 0,
    hazeAt,
    gorge,
    escarpment,
    duneCrest,
  }
}
