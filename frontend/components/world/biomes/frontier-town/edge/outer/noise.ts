/**
 * Deterministic 2-D noise for the outer desert: a hash, value noise with a smooth kernel, fBm,
 * a ridged variant for dune crests, and Worley F1 / F2 for wash networks and playa polygons.
 * No state and no library, so the same (x, z) always gives the same number (procedural-gen
 * skill: one seeded field per feature, offsets per octave).
 */

/** Integer-lattice hash in [0, 1): sine-free so it is identical on every platform. */
export function hash2(x: number, z: number): number {
  let h = Math.imul(Math.floor(x) | 0, 0x27d4eb2d) ^ Math.imul(Math.floor(z) | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export function smoothstep(a: number, b: number, x: number): number {
  if (a === b) return x < a ? 0 : 1
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

export function clamp(x: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, x))
}

/** Value noise in [-1, 1] on a unit lattice with a quintic kernel. */
export function noise2(x: number, z: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
  const a = hash2(ix, iz)
  const b = hash2(ix + 1, iz)
  const c = hash2(ix, iz + 1)
  const d = hash2(ix + 1, iz + 1)
  const v = a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz
  return v * 2 - 1
}

/** fBm in [-1, 1]: `octaves` of value noise, lacunarity 2, gain 0.5, each octave offset. */
export function fbm(x: number, z: number, octaves = 4): number {
  let total = 0
  let amp = 1
  let norm = 0
  let fx = x
  let fz = z
  for (let i = 0; i < octaves; i++) {
    total += amp * noise2(fx + i * 17.31, fz + i * 29.17)
    norm += amp
    amp *= 0.5
    fx = fx * 2 + 11.7
    fz = fz * 2 + 5.3
  }
  return total / norm
}

/** Ridged noise in [0, 1]: sharp crests where the noise crosses zero (dune ridges, badlands). */
export function ridged(x: number, z: number, octaves = 3): number {
  let total = 0
  let amp = 1
  let norm = 0
  let fx = x
  let fz = z
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2(fx + i * 7.7, fz + i * 3.1))
    total += amp * n * n
    norm += amp
    amp *= 0.5
    fx = fx * 2.1 + 3.3
    fz = fz * 2.1 + 9.1
  }
  return total / norm
}

/** Worley F1 / F2 in the units of `cell` (metres when x, z are metres). */
export function cellular(x: number, z: number, cell: number, salt = 0): { f1: number; f2: number } {
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
      const fx = cx + 0.1 + 0.8 * hash2(cx * 3 + salt, cz * 7 + 1)
      const fz = cz + 0.1 + 0.8 * hash2(cx * 5 + 2, cz * 2 + salt + 4)
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

/** Small deterministic generator for placements (mulberry32, as the layout's `seeded`). */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
