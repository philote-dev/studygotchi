/**
 * Endless jungle: far detail placements on the outer heightfield, pure and seeded. Canopy domes
 * (with trunks near the seam) thin with distance and grow so they stay ≥ 1.5 cells on every
 * ring; palms line the outer river and the coast; white fall stripes hang on the steep inner
 * slopes of the ridge rows; mist curtains lie in the valleys between rows.
 */
import { seeded } from '../../layout/jungle-layout'
import { type BarrierPlan, PLATE_HALF, riverDistance, windowFactor } from '../barriers/geography'
import { pathDistance, placeClearance } from '../places/plan'
import { bearingOf, chebyshev, fbm, smoothstep } from '../noise'
import { ROWS, type OuterWorld, riverHalfWidth } from './heightfield'

export interface DomeInstance {
  x: number
  y: number
  z: number
  /** Crown radius (metres) and trunk height (0 for the far tier). */
  radius: number
  trunk: number
  yaw: number
  haze: number
  /** 1 near (ring 1, trunk + dodecahedron crown), 2 far (ring 2, flattened icosahedron). */
  tier: 1 | 2
  /** Crown colour variant 0–2. */
  variant: number
}

function steepAt(world: OuterWorld, x: number, z: number, step: number): boolean {
  const h = world.height(x, z)
  return Math.abs(world.height(x + step, z) - h) > step * 0.55 || Math.abs(world.height(x, z + step) - h) > step * 0.55
}

function nearWall(plan: BarrierPlan, x: number, z: number, margin: number): boolean {
  return plan.wall.some((m) => Math.hypot(m.x - x, m.z - z) < Math.max(m.rx, m.rz) + margin)
}

/** A clearing round the temple and the delta beacon so their silhouettes read. */
function nearLandmark(plan: BarrierPlan, x: number, z: number): boolean {
  for (const v of plan.vistas) {
    if (v.kind === 'temple' && Math.hypot(v.x - x, v.z - z) < 34) return true
    if (v.kind === 'delta' && Math.hypot(v.x - x, v.z - 30 - z) < 26) return true
  }
  return false
}

/** The gorge and a clearing round the bridge, so its silhouette is not lost among the crowns. */
function inGorge(world: OuterWorld, x: number, z: number): boolean {
  const g = world.gorge
  const dx = x - g.x
  const dz = z - g.z
  const along = Math.abs(dx * Math.sin(g.yaw) + dz * Math.cos(g.yaw))
  const across = Math.abs(dx * Math.cos(g.yaw) - dz * Math.sin(g.yaw))
  if (along < 40 && across < g.halfWidth + 30) return true
  return along < g.halfLength + 8 && across < g.halfWidth + 8
}

/** Open woodland continuing the plate's spaced trees, closing and coarsening with distance. */
export function canopyDomes(world: OuterWorld, plan: BarrierPlan): DomeInstance[] {
  const rng = seeded(world.seed * 19 + 41)
  const out: DomeInstance[] = []
  const tiers: Array<{ tier: 1 | 2; inner: number; outer: number; grid: number; keep: [number, number]; radius: [number, number] }> = [
    { tier: 1, inner: PLATE_HALF, outer: 500, grid: 17, keep: [0.62, 0.42], radius: [4.2, 6.8] },
    { tier: 2, inner: 500, outer: 1120, grid: 40, keep: [0.42, 0.22], radius: [15, 24] },
  ]
  for (const t of tiers) {
    const n = Math.ceil((2 * t.outer) / t.grid)
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -t.outer + (i + 0.5) * t.grid + (rng() - 0.5) * t.grid * 0.9
        const z = -t.outer + (j + 0.5) * t.grid + (rng() - 0.5) * t.grid * 0.9
        const cheb = chebyshev(x, z)
        // The first 50 m past the plate stay bare (what the overview sees beyond the north edge).
        if (cheb < t.inner + (t.tier === 1 ? 50 : 5) || cheb >= t.outer - 2) continue
        const far = smoothstep(t.inner, t.outer, cheb)
        const keep = t.keep[0] + (t.keep[1] - t.keep[0]) * far
        const roll = rng()
        const size = rng()
        if (roll > keep) continue
        const s = world.sample(x, z)
        if (s.material === 'sea' || s.material === 'wet' || s.material === 'bank' || s.material === 'volcano' || s.material === 'crater') continue
        if (riverDistance(x, z) < riverHalfWidth(x) + 5) continue
        if (x > world.shoreX(z) - 30) continue
        if (steepAt(world, x, z, t.grid * 0.4)) continue
        if (inGorge(world, x, z)) continue
        if (nearLandmark(plan, x, z)) continue
        // The inhabited places are clearings, and nothing grows on a path.
        if (placeClearance(world.places.places, x, z) < 6) continue
        if (pathDistance(world.places, x, z) < 4) continue
        if (t.tier === 1 && nearWall(plan, x, z, 3)) continue
        const scale = 1 + far * 0.6
        const radius = (t.radius[0] + size * (t.radius[1] - t.radius[0])) * scale
        out.push({
          x,
          y: s.height,
          z,
          radius,
          trunk: t.tier === 1 ? radius * (1.3 + rng() * 0.5) : 0,
          yaw: rng() * Math.PI * 2,
          haze: s.haze,
          tier: t.tier,
          variant: Math.floor(rng() * 3),
        })
      }
    }
  }
  return out
}

export interface PalmInstance {
  x: number
  y: number
  z: number
  height: number
  yaw: number
  lean: number
  haze: number
}

/** Palms along the outer river's banks, as far as the delta apex (farther they would read as pale lollipops). */
export function palms(world: OuterWorld): PalmInstance[] {
  const rng = seeded(world.seed * 23 + 7)
  const out: PalmInstance[] = []
  let guard = 0
  while (out.length < 120 && guard++ < 4000) {
    const x = PLATE_HALF + 4 + rng() * 280
    const z = 20 + rng() * 160
    const dr = riverDistance(x, z)
    const half = riverHalfWidth(x)
    const onBank = dr > half + 3 && dr < half + 16
    if (!onBank) continue
    if (chebyshev(x, z) < PLATE_HALF + 4) continue
    const s = world.sample(x, z)
    if (s.material === 'sea' || s.material === 'wet') continue
    if (placeClearance(world.places.places, x, z) < 4) continue
    if (out.some((p) => Math.hypot(p.x - x, p.z - z) < 7)) continue
    out.push({ x, y: s.height, z, height: 6 + rng() * 5, yaw: rng() * Math.PI * 2, lean: (rng() - 0.5) * 0.3, haze: s.haze })
  }
  return out
}

export interface FallStripe {
  x: number
  z: number
  /** Bottom and top of the white sheet. */
  y0: number
  y1: number
  width: number
  /** Facing (rotation.y) toward the land centre. */
  yaw: number
  haze: number
}

/**
 * White falls on the far ridges: the steepest land-facing slopes of rows 2 and 3, outside the
 * windows, up to six of them; the wall's own fall cliffs are built in `barriers/build.ts`.
 */
export function ridgeFalls(world: OuterWorld): FallStripe[] {
  const candidates: Array<FallStripe & { slope: number }> = []
  for (const spec of ROWS.slice(1, 3)) {
    for (let b = 0; b < 360; b += 5) {
      if (windowFactor(world.gaps, b, 6) > 0) continue
      const a = (b * Math.PI) / 180
      // Walk the inner slope of the row from its foot toward the crest and take the steepest 40 m.
      let best: { r: number; slope: number } | null = null
      for (let r = spec.radius - spec.width * 0.9; r < spec.radius - spec.width * 0.15; r += 10) {
        // On the land-facing slope the ground climbs with the radius (toward the crest).
        const outer = world.height(Math.sin(a) * (r + 20), Math.cos(a) * (r + 20))
        const inner = world.height(Math.sin(a) * (r - 20), Math.cos(a) * (r - 20))
        const slope = (outer - inner) / 40
        if (slope > 0.42 && (!best || slope > best.slope)) best = { r, slope }
      }
      if (!best) continue
      const x = Math.sin(a) * best.r
      const z = Math.cos(a) * best.r
      if (x > world.shoreX(z) - 120) continue
      const s = world.sample(x, z)
      const rise = best.slope * 40
      candidates.push({ x, z, y0: s.height - rise * 0.5 - 2, y1: s.height + rise * 0.5 + 2, width: 2.6 + rise * 0.06, yaw: a + Math.PI, haze: s.haze, slope: best.slope })
    }
  }
  candidates.sort((p, q) => q.slope - p.slope)
  const out: FallStripe[] = []
  for (const c of candidates) {
    if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 120)) continue
    out.push({ x: c.x, z: c.z, y0: c.y0, y1: c.y1, width: c.width, yaw: c.yaw, haze: c.haze })
    if (out.length >= 6) break
  }
  return out
}

export interface MistCurtain {
  /** Mean radius and vertical extent of the curtain (a cylinder strip facing inward). */
  radius: number
  y0: number
  y1: number
  /** Peak opacity at the foot. */
  opacity: number
  /** Angular drift speed, rad/s. */
  drift: number
}

/** Three mist layers lying in the valleys between the ridge rows, each one sitting higher. */
export function mistCurtains(world: OuterWorld): MistCurtain[] {
  const valleyHeight = (radius: number) => {
    let sum = 0
    for (let b = 0; b < 360; b += 15) {
      const a = (b * Math.PI) / 180
      sum += world.height(Math.sin(a) * radius, Math.cos(a) * radius)
    }
    return sum / 24
  }
  return [
    { radius: 425, y0: valleyHeight(425) - 2, y1: valleyHeight(425) + 34, opacity: 0.42, drift: 0.0022 },
    { radius: 705, y0: valleyHeight(705) - 4, y1: valleyHeight(705) + 58, opacity: 0.48, drift: -0.0016 },
    { radius: 1085, y0: valleyHeight(1085) - 6, y1: valleyHeight(1085) + 90, opacity: 0.5, drift: 0.0011 },
  ]
}

/** Where the far-tier domes thin to: used by the budget test and the report. */
export function domeCounts(domes: readonly DomeInstance[]): { near: number; far: number } {
  let near = 0
  let far = 0
  for (const d of domes) if (d.tier === 1) near += 1
  else far += 1
  return { near, far }
}

/** Haze for a bearing/radius pair (debug helper for the tests' row-recession check). */
export function meanHazeAtRadius(world: OuterWorld, radius: number): number {
  let sum = 0
  for (let b = 0; b < 360; b += 10) {
    const a = (b * Math.PI) / 180
    sum += world.sample(Math.sin(a) * radius, Math.cos(a) * radius).haze
  }
  return sum / 36
}

export function meanHeightAtRadius(world: OuterWorld, radius: number): number {
  let sum = 0
  for (let b = 0; b < 360; b += 10) {
    const a = (b * Math.PI) / 180
    sum += world.height(Math.sin(a) * radius, Math.cos(a) * radius)
  }
  return sum / 36
}

export function bearingNoise(x: number, z: number): number {
  return fbm(bearingOf(x, z) * 0.01, 0.5, 2)
}
