/**
 * Deterministic noise for the highlands: a hashed value noise, fBm on top of it, and the small
 * maths the layout, the outer world and the barriers share. No three.js, no Math.random.
 */

/** Hash of a 2-D lattice point to 0..1, stable across runs and engines. */
export function hash2(x: number, z: number): number {
  let h = Math.imul(Math.floor(x) | 0, 0x27d4eb2d) ^ Math.imul(Math.floor(z) | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

function fade(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Smooth value noise, 0..1, one unit cell per integer. */
export function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = fade(x - ix)
  const fz = fade(z - iz)
  const a = hash2(ix, iz)
  const b = hash2(ix + 1, iz)
  const c = hash2(ix, iz + 1)
  const d = hash2(ix + 1, iz + 1)
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz
}

/**
 * Fractal Brownian motion centred on zero (≈ −0.5..0.5). Each octave is offset so the octaves
 * do not line up at the origin (procedural-gen skill, references/noise.md).
 */
export function fbm(x: number, z: number, octaves = 4, gain = 0.5, lacunarity = 2): number {
  let total = 0
  let amp = 1
  let norm = 0
  let fx = x
  let fz = z
  for (let i = 0; i < octaves; i++) {
    total += amp * (valueNoise(fx + i * 5.3, fz + i * 9.1) - 0.5)
    norm += amp
    amp *= gain
    fx *= lacunarity
    fz *= lacunarity
  }
  return total / norm
}

/** Ridged variant, 0..1 with sharp crests: cooled lava ropes, crevasse lines. */
export function ridged(x: number, z: number, octaves = 3): number {
  return 1 - Math.min(1, Math.abs(fbm(x, z, octaves)) * 2.4)
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

export function clamp(x: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, x))
}

/** Worley F1 / F2 (metres) on a `cell` grid: lava lobes, cloud heads, sinter terraces. */
export function cellular(x: number, z: number, cell: number): { f1: number; f2: number } {
  const px = x / cell
  const pz = z / cell
  const ix = Math.floor(px)
  const iz = Math.floor(pz)
  let f1 = Number.POSITIVE_INFINITY
  let f2 = Number.POSITIVE_INFINITY
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx
      const cz = iz + dz
      const fx = cx + 0.1 + 0.8 * hash2(cx * 3 + 11, cz * 7 + 5)
      const fz = cz + 0.1 + 0.8 * hash2(cx * 5 + 2, cz * 2 + 13)
      const d = Math.hypot(fx - px, fz - pz) * cell
      if (d < f1) {
        f2 = f1
        f1 = d
      } else if (d < f2) {
        f2 = d
      }
    }
  }
  return { f1, f2 }
}
