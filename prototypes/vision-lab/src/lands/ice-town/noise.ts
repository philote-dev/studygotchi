/**
 * Seeded, deterministic helpers for the Ice blockouts (procedural-gen skill: one seeded source per
 * field, fBm with per-octave offsets so octaves do not correlate, ridged noise for crevasses).
 * No three.js here so the heightfields can be unit-tested in node.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer lattice hash in 0..1. */
export function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Value noise in 0..1 with a quintic fade; one lattice cell = one unit. */
export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const a = hash2(ix, iz, seed)
  const b = hash2(ix + 1, iz, seed)
  const c = hash2(ix, iz + 1, seed)
  const d = hash2(ix + 1, iz + 1, seed)
  const u = fade(fx)
  const v = fade(fz)
  return lerp(lerp(a, b, u), lerp(c, d, u), v)
}

/** Fractal Brownian motion in 0..1 (normalised by the summed amplitude). */
export function fbm(x: number, z: number, seed: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let total = 0
  let amp = 1
  let freq = 1
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    total += amp * valueNoise(x * freq + o * 17.3, z * freq + o * 9.1, seed + o * 101)
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return total / norm
}

/** Ridged fBm in 0..1: sharp crests for crevasse fields and mountain spines. */
export function ridged(x: number, z: number, seed: number, octaves = 3): number {
  let total = 0
  let amp = 1
  let freq = 1
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(x * freq + o * 5.7, z * freq + o * 12.9, seed + o * 61)
    total += amp * (1 - Math.abs(2 * n - 1))
    norm += amp
    amp *= gain(o)
    freq *= 2
  }
  return total / norm
}
const gain = (o: number) => (o === 0 ? 0.55 : 0.5)

/** One-dimensional coastline wobble in roughly −1..1 (fBm recentred and stretched). */
export function wobble(t: number, seed: number, scale: number): number {
  return (fbm(t * scale, 0.5, seed, 3) - 0.5) * 2.6
}

/** Signed shortest angle from `a` to `b` in radians. */
export function angleDiff(a: number, b: number): number {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

/** Distance from (x, z) to a polyline and the parameter along it (0..1 by segment index). */
export function polylineDistance(points: ReadonlyArray<readonly [number, number]>, x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, az] = points[i]
    const [bx, bz] = points[i + 1]
    const dx = bx - ax
    const dz = bz - az
    const len2 = dx * dx + dz * dz || 1
    const t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1)
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z))
  }
  return best
}

/** Projection of (x, z) onto segment a→b: parameter t in 0..1 and distance to the segment. */
export function segmentProject(ax: number, az: number, bx: number, bz: number, x: number, z: number): { t: number; d: number } {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz || 1
  const t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1)
  return { t, d: Math.hypot(ax + dx * t - x, az + dz * t - z) }
}
