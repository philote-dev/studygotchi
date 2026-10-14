/**
 * Pure 2-D noise helpers for the meadow's outer world. Deterministic (hash-based, no RNG state),
 * no three.js. Value noise is coarse on purpose: the outer world is read from 100 m and up on
 * 10–60 m cells, so smooth broad folds matter more than gradient-noise fidelity.
 */

export function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}

export function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/** Fractal value noise centred on 0, roughly in −0.5…0.5; each octave has its own offset so they do not line up at the origin. */
export function fbm(x: number, y: number, octaves = 3): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  for (let i = 0; i < octaves; i++) {
    sum += (valueNoise(x * freq + i * 5.3, y * freq + i * 9.1) - 0.5) * amp
    amp *= 0.5
    freq *= 2
  }
  return sum
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

/** Worley F1 / F2 (metres) over a jittered `cell`-metre grid; the seed shifts the jitter. */
export function cellular(x: number, z: number, cell: number, seed = 0): { f1: number; f2: number; id: number } {
  const px = x / cell
  const pz = z / cell
  const ix = Math.floor(px)
  const iz = Math.floor(pz)
  let f1 = Number.POSITIVE_INFINITY
  let f2 = Number.POSITIVE_INFINITY
  let id = 0
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx
      const cz = iz + dz
      const fx = cx + 0.1 + 0.8 * hash2(cx * 3.7 + 11.1 + seed, cz * 7.9 - seed)
      const fz = cz + 0.1 + 0.8 * hash2(cx * 5.3 - seed, cz * 2.1 + 4.4 + seed)
      const d = Math.hypot(fx - px, fz - pz) * cell
      if (d < f1) {
        f2 = f1
        f1 = d
        id = (cx * 73856093) ^ (cz * 19349663)
      } else if (d < f2) {
        f2 = d
      }
    }
  }
  return { f1, f2, id }
}
