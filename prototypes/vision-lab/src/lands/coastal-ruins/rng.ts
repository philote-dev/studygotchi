/**
 * Seeded randomness and noise for the coastal-ruins blockouts (procedural-gen skill: one RNG
 * instance threaded through every choice; value-noise fBm for terrain; nothing reads global
 * Math.random, so a seed reproduces the same coast).
 */
export type Rng = () => number

export const DEG = Math.PI / 180

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const range = (rng: Rng, lo: number, hi: number): number => lo + (hi - lo) * rng()
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Hermite step; works with reversed edges (e0 > e1) too. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

function hash2(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed + 0x9e37, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth value noise in [0, 1]; integer lattice in the caller's units. */
export function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const fx = x - x0
  const fz = z - z0
  const sx = fx * fx * (3 - 2 * fx)
  const sz = fz * fz * (3 - 2 * fz)
  const a = hash2(x0, z0, seed)
  const b = hash2(x0 + 1, z0, seed)
  const c = hash2(x0, z0 + 1, seed)
  const d = hash2(x0 + 1, z0 + 1, seed)
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sz)
}

/** Fractal value noise normalised back into [0, 1]. */
export function fbm(x: number, z: number, seed: number, octaves = 3, lacunarity = 2, gain = 0.5): number {
  let total = 0
  let amp = 1
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    total += amp * valueNoise(x * freq, z * freq, seed + i * 131)
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return total / norm
}

/** Flat terraces with steep risers: the last (1 - sharp) of every step is the riser. */
export function terrace(h: number, step: number, sharp = 0.7): number {
  const t = h / step
  const f = Math.floor(t)
  return (f + smoothstep(sharp, 1, t - f)) * step
}
