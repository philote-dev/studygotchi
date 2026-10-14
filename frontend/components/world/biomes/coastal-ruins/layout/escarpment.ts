/**
 * The north escarpment as terraced limestone hills: a pure heightfield over the plain behind the
 * town, built from the same shoulder / foot / back-row tables the skyline profile grows
 * (`dressing.ts`), so the 48 px comb keeps its positions and heights while the hills themselves are
 * rounded masses on a 2.5 m lattice, cut into 3 m terrace treads along their contours, with
 * darker retaining-wall risers, a smooth crest, and scrub dots on the treads. Metres; +z south.
 */
import { type BiomeLayout, type SkylineProfile, seeded } from './biome-layout'
import { fbm, sampleTerrain, smoothstep } from './terrain'
import { backRow, footBlocks, shoulderData } from './dressing'

/**
 * The heightfield covers this strip of the plain (x across the town, z from the foot to behind the
 * back row). 1.25 m cells: the scarp face toward the town climbs ~0.75 m/m, so a 3 m tread spans
 * ~4 m there and needs three or four cells to read as a tread and a wall.
 */
export const ESCARPMENT_BOUNDS = { minX: -162, maxX: 162, minZ: -142, maxZ: -78, cell: 1.25 } as const

/** Terrace riser height: the treads are cut every 3 m of hill; a 2.5 m lattice never shows a facet taller than one riser. */
export const TERRACE_RISER = 3
/** The foot of every hill: the plain stays flat south of this line (the colliders' south face). */
const FOOT_START_Z = -82

function hump(d: number): number {
  // Quartic dome: 1 at the centre, 0 at d = 1, zero slope at both.
  if (d >= 1) return 0
  const k = 1 - d * d
  return k * k
}

export interface HillSample {
  /** Hill mass above the plain before terracing. */
  mass: number
  /** Final height above the plain (terraced). */
  rise: number
  /** 0 on a tread, 1 on a riser. */
  riser: number
  /** 0 front hills, 1 the paler back row (by which dome dominates). */
  back: number
  /** Terrace index (for alternating tread tones). */
  tread: number
}

interface Tables {
  shoulders: ReturnType<typeof shoulderData>
  back: ReturnType<typeof backRow>
  bankCentre: number
  bankHalf: number
}

const tablesByBand = new Map<number, Tables>()

/** The authored tables for a profile, built once per progress band (hillMass is called ~15k times per build). */
function tables(profile: SkylineProfile): Tables {
  let t = tablesByBand.get(profile.band)
  if (!t) {
    const feet = footBlocks()
    const span = feet[feet.length - 1].x - feet[0].x
    t = { shoulders: shoulderData(profile), back: backRow(), bankCentre: feet[0].x + span / 2, bankHalf: span / 2 }
    tablesByBand.set(profile.band, t)
  }
  return t
}

/** Hill mass at (x, z) for a profile: foot bank + shoulder domes + back row (height-scaled by its opacity). */
export function hillMass(x: number, z: number, profile: SkylineProfile): { mass: number; back: number; peak: number } {
  const T = tables(profile)
  // Contour warp: bends the terrace lines without steepening the slopes much.
  const wz = z + fbm(x * 0.025 + 1.7, z * 0.025 + 3.1) * 5
  // The foot: a long sinuous bank where the block row stood (z ≈ −89), 4.5–8 m, its centre line
  // and height wandering along x so the terrace contours bend instead of ruling across the frame.
  let mass = 0
  let backMass = 0
  let peak = 1
  let backPeak = 1
  const bankEnd = 1 - smoothstep(T.bankHalf + 4, T.bankHalf + 18, Math.abs(x - T.bankCentre))
  const bankZ = -89 + 5 * Math.sin(x * 0.055 + 1) + fbm(x * 0.02 + 4.4, 3.3) * 6
  if (bankEnd > 0) {
    const bankH = 6.2 + fbm(x * 0.05 + 2.2, 7.7) * 3.4
    mass = bankH * bankEnd * hump(Math.abs(wz - bankZ) / 15)
    peak = bankH
  }
  for (const s of T.shoulders) {
    const h = profile.height * s.scale
    // Broad domes (slope ≤ ~1.2 m/m) so a lattice cell never rises more than one riser.
    const dx = (x - (s.x + s.offset * 0.3)) / (s.width * 1.2)
    const dz = (wz - s.z + 2) / (s.depth * 2.0)
    const d = Math.hypot(dx, dz)
    if (d >= 1) continue
    const dome = h * (0.78 * hump(d) + 0.22 * hump(d * 1.35))
    if (dome > mass) {
      mass = dome
      peak = h
    }
  }
  for (const b of T.back) {
    const h = b.height * (0.35 + 0.65 * profile.secondRowOpacity)
    const dx = (x - b.x) / (b.width * 0.85)
    const dz = (wz - b.z) / (b.depth * 1.6)
    const d = Math.hypot(dx, dz)
    if (d >= 1) continue
    const dome = h * hump(d)
    if (dome > backMass) {
      backMass = dome
      backPeak = h
    }
  }
  // Undulation and a gentle fade to the plain at the strip's edges; the foot line follows the bank's wander.
  const undulate = 1 + fbm(x * 0.03 + 9, z * 0.03 + 4) * 0.25
  const footLine = FOOT_START_Z + (bankZ + 89) * 0.7
  const front = mass * undulate * smoothstep(footLine, footLine - 12, z) * (1 - smoothstep(-132, -141, z))
  const backOnly = backMass * undulate * (1 - smoothstep(-132, -141, z))
  const total = Math.max(front, backOnly)
  return { mass: total, back: total > 0 ? backOnly / (front + backOnly) : 0, peak: (front >= backOnly ? peak : backPeak) * undulate }
}

/**
 * Terraced hill at (x, z): treads every 3 m with steep risers on the slopes; where the hill mass
 * flattens (its crest, the saddles) the terracing fades out so the ridge is rounded, not a tabletop.
 */
export function hillSample(x: number, z: number, profile: SkylineProfile): HillSample {
  const { mass, back, peak } = hillMass(x, z, profile)
  if (mass <= 0.02) return { mass: 0, rise: 0, riser: 0, back, tread: 0 }
  // Slope of the hill mass (metres per metre): flat crests and saddles are left smooth.
  const p = 1.5
  const slope = Math.hypot(hillMass(x + p, z, profile).mass - hillMass(x - p, z, profile).mass, hillMass(x, z + p, profile).mass - hillMass(x, z - p, profile).mass) / (2 * p)
  return terrace(mass, peak, slope, back)
}

/** Cut a hill mass into treads and risers given the local slope and the hill's own peak height. */
export function terrace(mass: number, peak: number, slope: number, back: number): HillSample {
  if (mass <= 0.02) return { mass: 0, rise: 0, riser: 0, back, tread: 0 }
  const t = mass / TERRACE_RISER
  const index = Math.floor(t)
  const f = t - index
  // Riser over the last 30 % of each step; the tread slopes gently (10 %) so water would run off.
  const stepped = (index + f * 0.1 + smoothstep(0.62, 1, f) * 0.9) * TERRACE_RISER
  // Terraces fade on flat ground and over the top 15 % of each hill: a soft ridge, not a tabletop.
  // The paler back row stays smooth (seen from above its steps would read as ripples, not hills).
  const amount = 0.92 * smoothstep(0.06, 0.16, slope) * smoothstep(0.6, 2.2, mass) * (1 - smoothstep(0.82, 0.96, mass / peak)) * (1 - smoothstep(0.4, 0.6, back))
  const rise = mass + (stepped - mass) * amount
  // The riser colour band is wider than the riser itself so a 2.5 m lattice still shows the wall as a stripe.
  const riser = smoothstep(0.5, 0.6, f) * amount
  return { mass, rise, riser, back, tread: index }
}

export interface EscarpmentGrid {
  nx: number
  nz: number
  cell: number
  minX: number
  minZ: number
  /** Per vertex: plain height, final height, riser weight, back-row weight, tread index, hill mass. */
  ground: Float32Array
  height: Float32Array
  riser: Float32Array
  back: Float32Array
  tread: Uint8Array
  mass: Float32Array
}

/**
 * The whole strip on its 2.5 m lattice, with the slope taken from the lattice neighbours (one
 * `hillMass` per vertex, so a rebuild on a progress band change costs a few milliseconds).
 */
export function buildEscarpmentGrid(layout: BiomeLayout, profile: SkylineProfile): EscarpmentGrid {
  const { minX, maxX, minZ, maxZ, cell } = ESCARPMENT_BOUNDS
  const nx = Math.round((maxX - minX) / cell) + 1
  const nz = Math.round((maxZ - minZ) / cell) + 1
  const n = nx * nz
  const mass = new Float32Array(n)
  const peak = new Float32Array(n)
  const back = new Float32Array(n)
  const ground = new Float32Array(n)
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = minX + i * cell
      const z = minZ + j * cell
      const m = hillMass(x, z, profile)
      const k = j * nx + i
      mass[k] = m.mass
      peak[k] = m.peak
      back[k] = m.back
      ground[k] = plainHeight(layout, x, z)
    }
  }
  const height = new Float32Array(n)
  const riser = new Float32Array(n)
  const tread = new Uint8Array(n)
  const at = (i: number, j: number) => mass[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))]
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      const slope = Math.hypot(at(i + 1, j) - at(i - 1, j), at(i, j + 1) - at(i, j - 1)) / (2 * cell)
      const s = terrace(mass[k], peak[k], slope, back[k])
      height[k] = ground[k] + s.rise
      riser[k] = s.riser
      tread[k] = s.tread
    }
  }
  return { nx, nz, cell, minX, minZ, ground, height, riser, back, tread, mass }
}

/**
 * The plain under the strip. North of z = −82 no district catchment reaches, so the authored
 * sampler reduces to the plain's own formula (ground height plus relief noise); the first rows,
 * where the village's upper pad can intrude, ask the sampler itself.
 */
export function plainHeight(layout: BiomeLayout, x: number, z: number): number {
  if (z < -82) return layout.groundHeight + fbm(x * 0.035, z * 0.035) * layout.relief
  return sampleTerrain(layout, x, z).height
}

/** Height of the escarpment surface (terrain plus hill) at (x, z). */
export function escarpmentHeight(layout: BiomeLayout, x: number, z: number, profile: SkylineProfile): number {
  return plainHeight(layout, x, z) + hillSample(x, z, profile).rise
}

export interface HillDot {
  x: number
  y: number
  z: number
  scale: number
  /** 0 scrub, 1 olive. */
  kind: 0 | 1
}

/** Scrub and olive dots on the treads (never on risers or the crest), seeded, ~1 per 25 m². */
export function hillDots(layout: BiomeLayout, profile: SkylineProfile, count = 150): HillDot[] {
  const rng = seeded(7705)
  const out: HillDot[] = []
  let guard = 0
  const { minX, maxX, minZ, maxZ } = ESCARPMENT_BOUNDS
  while (out.length < count && guard++ < count * 12) {
    const x = minX + rng() * (maxX - minX)
    const z = minZ + rng() * (maxZ - minZ)
    const s = hillSample(x, z, profile)
    if (s.mass < 1.2 || s.riser > 0.05) continue
    const t = s.mass / TERRACE_RISER
    if (t - Math.floor(t) > 0.6) continue
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 3.2)) continue
    out.push({ x, y: plainHeight(layout, x, z) + s.rise, z, scale: 0.7 + rng() * 0.8, kind: rng() < 0.3 ? 1 : 0 })
  }
  return out
}
