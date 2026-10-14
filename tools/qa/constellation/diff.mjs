/**
 * Pixel diff in the spirit of pixelmatch (YIQ colour distance, alpha blended on
 * white, no anti-aliasing detection): `threshold` is the pixelmatch scale where
 * 0 is exact and 0.1 ignores only barely-visible differences.
 *
 *   diffImages(a, b, { threshold = 0.1 }) ->
 *     { ratio, differing, total, diff: { width, height, data }, note? }
 *
 * The heat map is the baseline as a faint grey with differing pixels in red,
 * brighter for larger colour distances.
 */

function blend(c, a) {
  return 255 + (c - 255) * a
}

function rgb2y(r, g, b) {
  return r * 0.29889531 + g * 0.58662247 + b * 0.11448223
}
function rgb2i(r, g, b) {
  return r * 0.59597799 - g * 0.2741761 - b * 0.32180189
}
function rgb2q(r, g, b) {
  return r * 0.21147017 - g * 0.52261711 + b * 0.31114694
}

/** Squared YIQ distance between two RGBA pixels, each blended on white. */
function colorDelta(img1, img2, k, m) {
  let r1 = img1[k]
  let g1 = img1[k + 1]
  let b1 = img1[k + 2]
  let a1 = img1[k + 3]
  let r2 = img2[m]
  let g2 = img2[m + 1]
  let b2 = img2[m + 2]
  let a2 = img2[m + 3]
  if (a1 === a2 && r1 === r2 && g1 === g2 && b1 === b2) return 0
  if (a1 < 255) {
    a1 /= 255
    r1 = blend(r1, a1)
    g1 = blend(g1, a1)
    b1 = blend(b1, a1)
  }
  if (a2 < 255) {
    a2 /= 255
    r2 = blend(r2, a2)
    g2 = blend(g2, a2)
    b2 = blend(b2, a2)
  }
  const y = rgb2y(r1, g1, b1) - rgb2y(r2, g2, b2)
  const i = rgb2i(r1, g1, b1) - rgb2i(r2, g2, b2)
  const q = rgb2q(r1, g1, b1) - rgb2q(r2, g2, b2)
  return 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q
}

export function diffImages(a, b, { threshold = 0.1 } = {}) {
  const total = a.width * a.height
  if (a.width !== b.width || a.height !== b.height) {
    return {
      ratio: 1,
      differing: total,
      total,
      diff: { width: a.width, height: a.height, data: new Uint8Array(total * 4) },
      note: `size mismatch: baseline ${a.width}x${a.height}, candidate ${b.width}x${b.height}`,
    }
  }
  const maxDelta = 35215 * threshold * threshold
  const out = new Uint8Array(total * 4)
  let differing = 0
  for (let p = 0; p < total; p += 1) {
    const k = p * 4
    const delta = colorDelta(a.data, b.data, k, k)
    if (delta > maxDelta) {
      differing += 1
      // Red, brighter with distance; a tiny difference is still clearly marked.
      const strength = Math.min(1, Math.sqrt(delta / 35215))
      out[k] = 255
      out[k + 1] = Math.round(40 * (1 - strength))
      out[k + 2] = Math.round(40 * (1 - strength))
      out[k + 3] = 255
    } else {
      const grey = rgb2y(a.data[k], a.data[k + 1], a.data[k + 2])
      const faint = Math.round(blend(grey, 0.18))
      out[k] = faint
      out[k + 1] = faint
      out[k + 2] = faint
      out[k + 3] = 255
    }
  }
  return { ratio: total === 0 ? 0 : differing / total, differing, total, diff: { width: a.width, height: a.height, data: out } }
}
