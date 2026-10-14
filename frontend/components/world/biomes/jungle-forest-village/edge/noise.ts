/** Small deterministic noise kit for the outer world (value noise + fBm); no three.js. */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Hash of an integer lattice point to [0, 1). */
export function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123
  return s - Math.floor(s)
}

/** Value noise in [0, 1) with smooth interpolation. */
export function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uz = fz * fz * (3 - 2 * fz)
  const a = hash2(ix, iz)
  const b = hash2(ix + 1, iz)
  const c = hash2(ix, iz + 1)
  const d = hash2(ix + 1, iz + 1)
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz)
}

/** Fractal Brownian motion in [0, 1), normalised by the summed amplitude; per-octave offsets decorrelate the lattices. */
export function fbm(x: number, z: number, octaves = 3, lacunarity = 2, gain = 0.5): number {
  let total = 0
  let amp = 1
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    total += amp * valueNoise(x * freq + i * 5.3, z * freq + i * 9.1)
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return total / norm
}

/** Ridged transform of fBm: 1 at the crease, 0 in the troughs. */
export function ridged(x: number, z: number, octaves = 3): number {
  return 1 - Math.abs(2 * fbm(x, z, octaves) - 1)
}

/** Bearing in degrees from +z (south, the camera side) toward +x (east), in [0, 360). */
export function bearingOf(x: number, z: number): number {
  return ((Math.atan2(x, z) * 180) / Math.PI + 360) % 360
}

export function wrapDeg(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180
}

export function bearingDeltaDeg(a: number, b: number): number {
  return Math.abs(wrapDeg(a - b))
}

export function chebyshev(x: number, z: number): number {
  return Math.max(Math.abs(x), Math.abs(z))
}

/** Noise sampled on the unit circle at a bearing, so it is continuous all the way round. */
export function arcNoise(bearingDeg: number, scale: number, offset: number, octaves = 2): number {
  const a = (bearingDeg * Math.PI) / 180
  return fbm(Math.cos(a) * scale + offset, Math.sin(a) * scale + offset * 0.37, octaves)
}
