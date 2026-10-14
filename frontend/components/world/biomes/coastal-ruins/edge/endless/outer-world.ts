/**
 * Endless continuation: the pure outer world beyond the authored limestone plate. No three.js here.
 *
 * Coordinates as in the layout: x east, z south, y up, metres. The authored plate is the square
 * |x|,|z| ≤ worldExtent (400): a flat limestone plain north of the escarpment, open sea to the
 * south, a straight coast running out to each side. Beyond it the headland country simply goes
 * on, in a 20 m seam strip that meets the plate on its own lattice and three Chebyshev LOD rings
 * out to 2.4 km: terraced hills, karst outcrops, maquis scrub, a dry river and a broken aqueduct
 * to the north; the side coasts bend into capes that enclose the two side seas; the south stays
 * open water to the horizon. The hills keep a saddle on the north-out view ray so the far
 * acropolis window stays open.
 */
import { COASTAL_RUINS_LAYOUT, type BiomeLayout, seeded } from '../../layout/biome-layout'
import { fbm, landField, sampleTerrain, smoothstep } from '../../layout/terrain'
import { EDGE_POSES, edgePosePosition, viewBearingDeg } from '../poses'

/* ---------- rings ---------- */

export interface RingSpec {
  ring: 1 | 2 | 3
  /** Chebyshev inner / outer radius in metres. */
  inner: number
  outer: number
  /** Lattice cell in metres; divides both radii and the next ring's cell is a multiple of it. */
  cell: number
}

/** The seam strip: one ring-1 cell deep, from the plate edge to the first ring. */
export const SEAM_WIDTH = 20

/** Chebyshev radius of the last ring: the far frustum from anywhere in the camera box is fogged out before this. */
export const OUTER_REACH = 2400

/** 420–700 m at 10 m, 700–1200 m at 20 m, 1200–2400 m at 80 m: every boundary sits on both lattices. */
export function ringSpecs(plateHalf: number): RingSpec[] {
  const inner = plateHalf + SEAM_WIDTH
  return [
    { ring: 1, inner, outer: 700, cell: 10 },
    { ring: 2, inner: 700, outer: 1200, cell: 20 },
    { ring: 3, inner: 1200, outer: OUTER_REACH, cell: 80 },
  ]
}

export function chebyshev(x: number, z: number): number {
  return Math.max(Math.abs(x), Math.abs(z))
}

export function ringAt(x: number, z: number, rings: RingSpec[]): RingSpec | null {
  const d = chebyshev(x, z)
  for (const ring of rings) if (d >= ring.inner && d < ring.outer) return ring
  return null
}

/* ---------- the authored lattice ---------- */

/** The authored Terrain mesh: PlaneGeometry(2·extent, 2·extent, 280, 280). */
export const AUTHORED_SEGMENTS = 280

/**
 * The plate mesh's vertex coordinates along one axis, as float32 (PlaneGeometry stores float32
 * and the authored colours / heights are sampled at those rounded values).
 */
export function authoredLattice(layout: BiomeLayout): number[] {
  const width = layout.worldExtent * 2
  const segment = width / AUTHORED_SEGMENTS
  const out: number[] = []
  for (let i = 0; i <= AUTHORED_SEGMENTS; i++) out.push(Math.fround(i * segment - layout.worldExtent))
  return out
}

/* ---------- noise ---------- */

function hash(x: number, z: number): number {
  const v = Math.sin(x * 157.31 + z * 311.7 + 17.17) * 43758.5453
  return v - Math.floor(v)
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const sx = fx * fx * (3 - 2 * fx)
  const sz = fz * fz * (3 - 2 * fz)
  const a = hash(ix, iz)
  const b = hash(ix + 1, iz)
  const c = hash(ix, iz + 1)
  const d = hash(ix + 1, iz + 1)
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz
}

/** Fractal value noise in roughly −0.5..0.5 with `octaves` octaves (each with its own offset). */
export function fbmN(x: number, z: number, octaves: number): number {
  let value = 0
  let amplitude = 0.5
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    value += (valueNoise(x + o * 5.3, z + o * 9.1) - 0.5) * amplitude
    norm += amplitude
    x *= 2
    z *= 2
    amplitude *= 0.5
  }
  return value / norm / 1.0
}

function ridged(x: number, z: number): number {
  return 1 - Math.abs(fbmN(x, z, 3)) * 2.4
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

/* ---------- land mask ---------- */

/** How far south each side coast swings beyond the plate, metres. */
const CAPE = { west: 150, east: 170, over: 420 } as const

/** Coast wobble beyond the plate (zero at the plate edge so the mask stays continuous). */
function shoreWobble(x: number): number {
  return smoothstep(400, 520, Math.abs(x)) * (26 * fbmN(x * 0.006 + 3.1, 2.2, 3) * 2 + 8 * fbmN(x * 0.02 + 7.7, 9.9, 2) * 2)
}

/**
 * z of the coast beyond the plate as a function of x; land is north of it. The west coast leaves
 * the plate at z = 37 and the east coast at z = −73 (the authored polygon edges), then both bend
 * south into capes that enclose the side seas. The southern bay (|x| < 148) is open sea.
 */
export function continuationShore(x: number): number {
  if (x <= -148) return 37 + CAPE.west * smoothstep(-400, -400 - CAPE.over, x) + shoreWobble(x)
  if (x >= 148) return -73 + CAPE.east * smoothstep(400, 400 + CAPE.over, x) + shoreWobble(x)
  return 75
}

/** Unified land field, metres, positive inside: the authored polygon on the plate, the continuation beyond. */
export function outerLandField(layout: BiomeLayout, x: number, z: number): number {
  const plateHalf = layout.worldExtent
  if (chebyshev(x, z) <= plateHalf) return landField(layout, x, z)
  // North of the plate is all land: at least the shore ramp's full width inland, no polygon walk needed.
  if (z < -plateHalf) return -z - plateHalf + 20
  return continuationShore(x) - z
}

/* ---------- the world ---------- */

/** `terrace` / `terrace2` alternate by tread so the hillside stripes read from afar; `rock` is bare karst on the ridges. */
export type OuterMaterial = 'sea' | 'shallows' | 'limestone' | 'terrace' | 'terrace2' | 'scrub' | 'riverbed' | 'rock'

export interface OuterSample {
  height: number
  material: OuterMaterial
  /** 0–1 toward the sky colour: the baked aerial perspective. */
  haze: number
}

export interface AcropolisSite {
  x: number
  z: number
  /** Silhouette top above the sea the vista must stay under (frame-top maths in the barriers). */
  top: number
}

export interface OuterWorld {
  layout: BiomeLayout
  seed: number
  plateHalf: number
  seaLevel: number
  /** Authored open-sea floor height; everything of ours inside the plate stays below it. */
  seaFloor: number
  rings: RingSpec[]
  acropolisSite: AcropolisSite
  /** Our heightfield; inside the plate it is a hidden floor under the authored sea bed. */
  sample(x: number, z: number): OuterSample
  /** The ground things stand on: the authored terrain on the plate, ours beyond. */
  groundAt(x: number, z: number): number
  /** The maquis patch mask (the same noise `sample` uses for the scrub ground). */
  scrubAt(x: number, z: number): boolean
  /** The authored height at a plate-edge point, for a watertight seam. */
  seamHeight(x: number, z: number): number
  /** Unified land field, metres, positive inside. */
  landField(x: number, z: number): number
  hazeAt(x: number, z: number): number
  /** Centre line of the dry river at a given z (north of the plate). */
  riverX(z: number): number
}

/** The acropolis stands 490 m along the north-out view ray: in frame, hazed, just past the seam strip. */
export const ACROPOLIS_FROM_CAMERA = 490
export const ACROPOLIS_TOP = 26

export function acropolisSite(): AcropolisSite {
  const pose = EDGE_POSES.find((p) => p.id === 'north-out')!
  const [cx, , cz] = edgePosePosition(pose)
  const view = (viewBearingDeg(pose) * Math.PI) / 180
  return { x: cx + Math.sin(view) * ACROPOLIS_FROM_CAMERA, z: cz + Math.cos(view) * ACROPOLIS_FROM_CAMERA, top: ACROPOLIS_TOP }
}

function groundHaze(x: number, z: number): number {
  return 0.05 + 0.62 * smoothstep(120, 1750, Math.hypot(x, z) - 420)
}

const TERRACE_STEP = 3.5

export function createOuterWorld(layout: BiomeLayout, seed: number): OuterWorld {
  const plateHalf = layout.worldExtent
  const seaLevel = layout.seaLevel
  const seaFloor = seaLevel - 1.6
  const rings = ringSpecs(plateHalf)
  const rng = seeded(seed * 31 + 7)
  const ox = rng() * 100
  const oz = rng() * 100
  const site = acropolisSite()

  const riverX = (z: number) => -70 + 48 * Math.sin(z * 0.0033 + 0.8 + ox * 0.01) + 22 * fbmN(z * 0.009 + oz, 3.3, 2) * 2
  const scrubAt = (x: number, z: number) => fbmN(x * 0.011 + ox, z * 0.011 + oz, 3) > 0.09

  const unifiedLand = (x: number, z: number) => outerLandField(layout, x, z)

  const sample = (x: number, z: number): OuterSample => {
    const cheb = chebyshev(x, z)
    if (cheb < plateHalf) return { height: seaFloor - 0.6, material: 'sea', haze: 0 }
    const haze = groundHaze(x, z)
    const land = unifiedLand(x, z)
    if (land <= 0) {
      // The authored sea profile: shallows over the layout's width, then the open-sea floor.
      const shallow = land > -layout.shallowsWidth
      const height = shallow ? seaLevel - 0.55 - smoothstep(0, layout.shallowsWidth, -land) * 0.85 : seaFloor
      return { height, material: shallow ? 'shallows' : 'sea', haze }
    }
    const dOut = cheb - plateHalf
    // The authored plain, exactly, so the seam strip carries no step.
    const base = layout.groundHeight + fbm(x * 0.035, z * 0.035) * layout.relief
    // Each noise field below is only evaluated where its envelope is non-zero (the lattice build
    // samples ~50k points, so the sampler's cost is the build's cost).
    const north = z < -plateHalf
    // Rolling hills that fade in past the strip, karst ridges farther out, a far inland plateau.
    const hillsK = smoothstep(30, 650, dOut)
    const hills = hillsK > 0 ? (10 + 26 * (0.5 + fbmN(x * 0.0022 + ox, z * 0.0022 + oz, 3))) * hillsK : 0
    // The dry river keeps the ridges off its valley floor.
    const rd = north ? Math.abs(x - riverX(z)) : Number.POSITIVE_INFINITY
    const valley = north ? smoothstep(0, 110, -z - plateHalf) * (1 - smoothstep(20, 90, rd)) : 0
    const ridgeEnvelope = smoothstep(300, 1000, dOut) * (1 - valley)
    const ridgeK = ridgeEnvelope > 0 ? Math.max(0, ridged(x * 0.0045 + 1.3 + ox, z * 0.0045 + 2.1)) : 0
    const ridge = ridgeK * ridgeK * 40 * ridgeEnvelope
    const capK = smoothstep(1100, 2300, cheb)
    const cap = capK > 0 ? capK * 70 * (0.7 + 0.6 * (0.5 + fbmN(x * 0.0012 + 5, z * 0.0012 + 1, 2))) : 0
    let relief = hills * (1 - 0.35 * valley) + ridge + cap
    // The north window: hills within the acropolis sightline stay low until the far hazed rows.
    if (north) relief *= 1 - 0.8 * (1 - smoothstep(90, 200, Math.abs(x - site.x))) * smoothstep(-1050, -850, z)
    // Terraces on the moderate hillsides, in some places only.
    const tEnvelope = 0.75 * smoothstep(3, 8, hills) * (1 - smoothstep(26, 40, hills))
    const tAmount = tEnvelope > 0 ? tEnvelope * smoothstep(0.0, 0.1, fbmN(x * 0.006 + 9 + ox, z * 0.006 + 4, 2)) : 0
    const t = relief / TERRACE_STEP
    if (tAmount > 0) {
      const f = t - Math.floor(t)
      relief = lerp(relief, (Math.floor(t) + smoothstep(0.25, 0.75, f)) * TERRACE_STEP, tAmount)
    }
    // The dry river: a shallow valley meandering north from behind the escarpment.
    const riverK = north ? (1 - smoothstep(6, 34, rd)) * smoothstep(0, 110, -z - plateHalf) : 0
    let height = base + relief
    if (riverK > 0) height = Math.max(seaLevel + 0.6, height - Math.min(7, relief + 1.8) * riverK)
    // Shore: step down to the shallows over 5 m, like the authored coast.
    const cliffK = smoothstep(0, 5, land)
    height = lerp(seaLevel - 0.55, height, cliffK)
    let material: OuterMaterial = 'limestone'
    if (riverK > 0.55) material = 'riverbed'
    else if (tAmount > 0.35) material = Math.floor(t) % 2 === 0 ? 'terrace' : 'terrace2'
    else if (ridgeK > 0.62 && ridge > 6) material = 'rock'
    else if (height < 55 && scrubAt(x, z)) material = 'scrub'
    return { height, material, haze }
  }

  const seamHeight = (x: number, z: number) => sampleTerrain(layout, x, z).height
  const groundAt = (x: number, z: number) => (chebyshev(x, z) <= plateHalf ? sampleTerrain(layout, x, z).height : sample(x, z).height)

  return { layout, seed, plateHalf, seaLevel, seaFloor, rings, acropolisSite: site, sample, groundAt, scrubAt, seamHeight, landField: unifiedLand, hazeAt: groundHaze, riverX }
}

/* ---------- fog ---------- */

/**
 * Aerial perspective: the fog starts where the shipped fog starts (nothing the overview sees is
 * ever fogged, in either mode) and runs out to 1.6 km so the rings dissolve into the sky; night
 * pulls in because lit limestone does not tint toward a dark sky. Metres.
 */
export function outerFog(night: boolean, layout: BiomeLayout = COASTAL_RUINS_LAYOUT): { near: number; far: number } {
  const near = (layout.fog.near * 0.56) / layout.renderScale
  return { near, far: night ? 1300 : 1600 }
}

/* ---------- far detail placements ---------- */

export interface OuterInstance {
  x: number
  y: number
  z: number
  yaw: number
  sx: number
  sy: number
  sz: number
}

/**
 * The authored plain behind the escarpment is empty limestone out to the plate edge. South of this
 * line the overview frame can see it (the frame top reaches z ≈ −226 at any aspect, since the
 * vertical FOV is fixed); north of it the scatter may stand on the plate too, so the country reads
 * as continuous from the north-out pose instead of a void before the first ring.
 */
export const PLAIN_SCATTER_Z = -260

/** Farthest the scatter goes: beyond this the fog has the ground, and outlines alone would float in the haze. */
export const SCATTER_REACH = 760

/** Where an instance may stand: our continuation, or the authored plain north of the scatter line. */
export function scatterGround(world: OuterWorld, x: number, z: number): boolean {
  const cheb = chebyshev(x, z)
  if (cheb > world.plateHalf + 10) return true
  return z < PLAIN_SCATTER_Z && Math.abs(x) < world.plateHalf - 10
}

/** Karst outcrops on the land, larger with distance so they stay readable on coarse rings. */
export function karstOutcrops(world: OuterWorld, count = 260): OuterInstance[] {
  const rng = seeded(world.seed * 17 + 23)
  const out: OuterInstance[] = []
  let guard = 0
  const site = world.acropolisSite
  while (out.length < count && guard++ < count * 16) {
    const a = rng() * Math.PI * 2
    const d = 260 + Math.pow(rng(), 1.2) * (SCATTER_REACH - 260)
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d
    const cheb = chebyshev(x, z)
    if (!scatterGround(world, x, z) || cheb > SCATTER_REACH) continue
    if (world.landField(x, z) <= 8) continue
    const onPlate = cheb <= world.plateHalf
    const s = onPlate ? null : world.sample(x, z)
    if (s && (s.material === 'riverbed' || s.material === 'sea' || s.material === 'shallows')) continue
    if (Math.hypot(x - site.x, z - site.z) <= 90) continue
    const far = smoothstep(500, SCATTER_REACH, cheb)
    const sx = (2 + rng() * 4) * (1 + far * 1.4)
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < sx + o.sx + 2)) continue
    out.push({ x, y: world.groundAt(x, z) - 0.3, z, yaw: rng() * Math.PI, sx, sy: sx * (0.45 + rng() * 0.5), sz: sx * (0.7 + rng() * 0.4) })
  }
  return out
}

/** Maquis scrub: dark blobs on the scrub ground (and in scrub-noise patches on the plain). */
export function maquisScrub(world: OuterWorld, count = 420): OuterInstance[] {
  const rng = seeded(world.seed * 29 + 5)
  const out: OuterInstance[] = []
  let guard = 0
  while (out.length < count && guard++ < count * 24) {
    const a = rng() * Math.PI * 2
    const d = 260 + rng() * (SCATTER_REACH - 260)
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d
    const cheb = chebyshev(x, z)
    if (!scatterGround(world, x, z) || cheb > SCATTER_REACH) continue
    if (world.landField(x, z) <= 8) continue
    const onPlate = cheb <= world.plateHalf
    if (onPlate ? !world.scrubAt(x, z) : world.sample(x, z).material !== 'scrub') continue
    const far = smoothstep(500, SCATTER_REACH, cheb)
    const sx = (1.6 + rng() * 2.6) * (1 + far * 1.2)
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < (sx + o.sx) * 0.8)) continue
    out.push({ x, y: world.groundAt(x, z) - 0.2, z, yaw: rng() * Math.PI, sx, sy: sx * (0.5 + rng() * 0.3), sz: sx * (0.8 + rng() * 0.3) })
  }
  return out
}

/** Aqueduct line across the northern plain: A → B, metres. */
export const AQUEDUCT = { a: [-130, -470] as [number, number], b: [150, -650] as [number, number], spacing: 11 } as const

/** Ruined aqueduct piers along the line, in runs with gaps between them. */
export function aqueductStubs(world: OuterWorld): OuterInstance[] {
  const rng = seeded(world.seed * 41 + 11)
  const [ax, az] = AQUEDUCT.a
  const [bx, bz] = AQUEDUCT.b
  const length = Math.hypot(bx - ax, bz - az)
  const yaw = Math.atan2(bx - ax, bz - az)
  const n = Math.floor(length / AQUEDUCT.spacing)
  const out: OuterInstance[] = []
  let run = 0
  let gap = 0
  for (let i = 0; i <= n; i++) {
    if (run <= 0 && gap <= 0) {
      run = 2 + Math.floor(rng() * 4)
      gap = 1 + Math.floor(rng() * 4)
    }
    const t = i / n
    const x = ax + (bx - ax) * t
    const z = az + (bz - az) * t
    if (run > 0) {
      run--
      if (world.landField(x, z) > 0) {
        const s = world.sample(x, z)
        out.push({ x, y: s.height - 0.4, z, yaw, sx: 1, sy: 5.5 + rng() * 3.5, sz: 1 })
      }
    } else gap--
  }
  return out
}
