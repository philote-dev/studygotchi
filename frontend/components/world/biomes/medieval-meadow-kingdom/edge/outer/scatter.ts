/**
 * Endless meadow: the instanced detail. Pure placement data (no three.js) for the hedgerows along
 * the field edges, the trees (forest-edge walls, copses, hedgerow oaks, lone trees thinning with
 * distance) and the haystacks in the hay and wheat fields. Everything respects `world.decorate`,
 * so nothing stands in the authored world, the shipped overview, the water or on a track.
 */
import { seeded } from '../../layout/biome-layout'
import { rectEuclid } from '../../layout/terrain'
import { hash2, smoothstep } from '../noise'
import { type FieldEdge, fieldEdges, fieldPolygon, fieldRange, fieldTone } from './fields'
import type { OuterWorld } from './outer-world'

export interface TreeInstance {
  x: number
  y: number
  z: number
  scale: number
  yaw: number
  /** 0.9–1.1 crown brightness. */
  tint: number
  /** The ground's aerial haze here (far silhouettes lean toward the sky by it). */
  haze: number
}

export interface HedgeInstance {
  x: number
  y: number
  z: number
  length: number
  yaw: number
}

export interface HayInstance {
  x: number
  y: number
  z: number
  scale: number
  yaw: number
}

/** Hedgerows (and their oaks) only this far past the plate; beyond, the patchwork is colour alone. */
export const HEDGE_REACH = 300
/**
 * Tree LOD by distance past the plate edge: full canopy (50 tris) on the plate and to 120 m, an
 * eight-facet lollipop (16 tris) to 400 m, a crossed-quad silhouette (4 tris) to 840 m, nothing
 * beyond (the far rings are colour and haze). Woods and copses are merged canopy masses instead
 * of individual trees at every distance.
 */
export const TREE_L0_REACH = 120
export const TREE_L1_REACH = 400
export const TREE_REACH = 840
/** Kept for the budget test's distance bands. */
export const NEAR_TREE_REACH = TREE_L1_REACH
export const HEDGE_SEGMENT = 9
export const HEDGE_CHANCE = 0.62
export const GATE_CHANCE = 0.5
export const GATE_WIDTH = 4.5

interface HedgePlan {
  hedges: HedgeInstance[]
  /** Segment ends that carry a hedgerow oak. */
  oaks: Array<{ x: number; z: number; roll: number }>
}

function edgeHedges(world: OuterWorld, edge: FieldEdge, out: HedgePlan): void {
  const [ax, az] = edge.a
  const [bx, bz] = edge.b
  if (world.forbidden(ax, az) || world.forbidden(bx, bz)) return
  if (rectEuclid(world.plate, ax, az) > HEDGE_REACH || rectEuclid(world.plate, bx, bz) > HEDGE_REACH) return
  const length = Math.hypot(bx - ax, bz - az)
  const n = Math.max(1, Math.round(length / HEDGE_SEGMENT))
  const gate = edge.gate < GATE_CHANCE ? 0.2 + edge.gate * 1.2 : -1
  const yaw = Math.atan2(bx - ax, bz - az)
  for (let k = 0; k < n; k++) {
    const t0 = k / n
    const t1 = (k + 1) / n
    const mid = (t0 + t1) / 2
    if (gate >= 0 && Math.abs(mid - gate) * length < GATE_WIDTH) continue
    const mx = ax + (bx - ax) * mid
    const mz = az + (bz - az) * mid
    if (!world.decorate(mx, mz)) continue
    const x0 = ax + (bx - ax) * t0
    const z0 = az + (bz - az) * t0
    const x1 = ax + (bx - ax) * t1
    const z1 = az + (bz - az) * t1
    const y = Math.min(world.meshHeight(x0, z0), world.meshHeight(x1, z1), world.meshHeight(mx, mz))
    out.hedges.push({ x: mx, y, z: mz, length: length / n, yaw })
    const oakRoll = hash2(mx * 0.37 + 3.1, mz * 0.53 + 7.9)
    if (k > 0 && oakRoll < 0.05) out.oaks.push({ x: x0, z: z0, roll: oakRoll / 0.05 })
  }
}

const hedgeCache = new WeakMap<OuterWorld, HedgePlan>()

/** Hedgerow boxes along the edges of included fields (both sides of the seam), with gates and breaks at the river. */
export function hedgePlan(world: OuterWorld): HedgePlan {
  const cached = hedgeCache.get(world)
  if (cached) return cached
  const built = buildHedgePlan(world)
  hedgeCache.set(world, built)
  return built
}

function buildHedgePlan(world: OuterWorld): HedgePlan {
  const plate = world.plate
  const range = fieldRange(world.fields, plate.minX - HEDGE_REACH, plate.maxX + HEDGE_REACH, plate.minZ - HEDGE_REACH, plate.maxZ + HEDGE_REACH)
  const out: HedgePlan = { hedges: [], oaks: [] }
  for (let j = range.j0; j <= range.j1; j++) {
    for (let i = range.i0; i <= range.i1; i++) {
      const [south, west] = fieldEdges(world.fields, i, j)
      // An edge is hedged when either field beside it is part of the patchwork.
      if (south.roll < HEDGE_CHANCE && (world.fieldIncluded(i, j) || world.fieldIncluded(i, j - 1))) edgeHedges(world, south, out)
      if (west.roll < HEDGE_CHANCE && (world.fieldIncluded(i, j) || world.fieldIncluded(i - 1, j))) edgeHedges(world, west, out)
    }
  }
  return out
}

export function hedgerows(world: OuterWorld): HedgeInstance[] {
  return hedgePlan(world).hedges
}

/* ---------- trees ---------- */

export type TreeLod = 0 | 1 | 2

function treeAt(world: OuterWorld, x: number, z: number, scale: number, yaw: number, tint: number): TreeInstance {
  const s = world.sample(x, z)
  return { x, y: world.meshHeight(x, z) - 0.12, z, scale, yaw, tint, haze: s.haze }
}

export function treeLod(outside: number): TreeLod | null {
  if (outside > TREE_REACH) return null
  if (outside <= TREE_L0_REACH) return 0
  if (outside <= TREE_L1_REACH) return 1
  return 2
}

/** Distance from a point to the nearest edge of its field (so lone trees do not stand in a hedge line). */
function fieldEdgeDistance(world: OuterWorld, x: number, z: number): number {
  const grid = world.fields
  const c = Math.cos(-grid.angle)
  const s = Math.sin(-grid.angle)
  const u = x * c - z * s
  const v = x * s + z * c
  const i = Math.floor(u / grid.spacing)
  const j = Math.floor(v / grid.spacing)
  const poly = fieldPolygon(grid, i, j)
  let best = Number.POSITIVE_INFINITY
  for (let k = 0; k < 4; k++) {
    const [ax, az] = poly[k]
    const [bx, bz] = poly[(k + 1) % 4]
    const dx = bx - ax
    const dz = bz - az
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z))
  }
  return best
}

/** One canopy mass of the woods (forest edges, lake woods, hill flanks): a merged blob, with a trunk on some near ones. */
export interface CanopyInstance {
  x: number
  y: number
  z: number
  scale: number
  yaw: number
  tint: number
  haze: number
  trunk: boolean
}

/** A copse: one merged geometry (three canopies, three trunks) placed and scaled as a whole. */
export interface CopseInstance {
  x: number
  y: number
  z: number
  scale: number
  yaw: number
  tint: number
}

export interface TreeField {
  /** Individual trees by LOD: full canopy, lollipop, crossed silhouette. */
  l0: TreeInstance[]
  l1: TreeInstance[]
  l2: TreeInstance[]
  woods: CanopyInstance[]
  copses: CopseInstance[]
}

export function emptyTreeField(): TreeField {
  return { l0: [], l1: [], l2: [], woods: [], copses: [] }
}

/** Canopy pitch of the woods, metres: one blob stands for about two crowns. */
export const WOODS_PITCH = 14
/** Standing woods canopies only this far past the plate; farther, the woods are baked face colour. */
export const WOODS_REACH = TREE_L1_REACH

/**
 * Woods from the density field, in a z-band (so the build can spread the scan over frames): a
 * 14 m jittered grid, each kept point one merged canopy blob; trunks under a third of the near ones.
 */
export function woodsBand(world: OuterWorld, zMin: number, zMax: number): CanopyInstance[] {
  const plate = world.plate
  const out: CanopyInstance[] = []
  const pitch = WOODS_PITCH
  const i0 = Math.floor((plate.minX - WOODS_REACH) / pitch)
  const i1 = Math.ceil((plate.maxX + WOODS_REACH) / pitch)
  const j0 = Math.floor(zMin / pitch)
  const j1 = Math.ceil(zMax / pitch)
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const x = i * pitch + (hash2(i * 1.3, j * 2.7) - 0.5) * pitch * 0.9
      const z = j * pitch + (hash2(i * 4.1 + 2, j * 0.9) - 0.5) * pitch * 0.9
      if (z < zMin || z >= zMax) continue
      const outside = rectEuclid(plate, x, z)
      if (outside <= 0 || outside > WOODS_REACH) continue
      // The cheap density first; the full sample only for points that pass the roll.
      const forest = world.forestAt(x, z)
      if (forest < 0.14) continue
      if (hash2(i * 7.7 + 1, j * 3.3) > forest * 0.85) continue
      const s = world.sample(x, z)
      if (s.material === 'water' || s.material === 'bank') continue
      if (!world.decorate(x, z)) continue
      out.push({
        x,
        y: world.meshHeight(x, z) - 0.3,
        z,
        scale: 0.9 + hash2(i * 2.2, j * 5.5 + 1) * 0.6,
        yaw: hash2(i, j) * Math.PI * 2,
        tint: 0.88 + hash2(i * 0.7, j * 1.9) * 0.24,
        haze: s.haze,
        trunk: outside <= 200 && hash2(i * 3.1 + 4, j * 9.7) < 0.35,
      })
    }
  }
  return out
}

/** Copses: a sparse grid of cluster centres near the plate, each one merged copse geometry. */
export function copses(world: OuterWorld): CopseInstance[] {
  const plate = world.plate
  const out: CopseInstance[] = []
  const rng = seeded(world.seed * 101 + 7)
  const copsePitch = 110
  for (let j = Math.floor((plate.minZ - TREE_L1_REACH) / copsePitch); j <= Math.ceil((plate.maxZ + TREE_L1_REACH) / copsePitch); j++) {
    for (let i = Math.floor((plate.minX - TREE_L1_REACH) / copsePitch); i <= Math.ceil((plate.maxX + TREE_L1_REACH) / copsePitch); i++) {
      if (hash2(i * 3.9 + world.seed, j * 1.7) > 0.34) continue
      const cx = i * copsePitch + (hash2(i, j + 9) - 0.5) * copsePitch * 0.8
      const cz = j * copsePitch + (hash2(i + 5, j) - 0.5) * copsePitch * 0.8
      const outside = rectEuclid(plate, cx, cz)
      if (outside > TREE_L1_REACH) continue
      const radius = 7 + rng() * 8
      const yaw = rng() * Math.PI * 2
      const tint = 0.92 + rng() * 0.16
      // The whole footprint must be allowed (centre and the four cardinal points of its radius).
      let ok = world.decorate(cx, cz)
      for (let k = 0; k < 4 && ok; k++) ok = world.decorate(cx + Math.cos((k * Math.PI) / 2) * radius * 0.8, cz + Math.sin((k * Math.PI) / 2) * radius * 0.8)
      if (!ok) continue
      const s = world.sample(cx, cz)
      if (s.material === 'water' || s.material === 'bank' || s.material === 'rock' || s.forest > 0.3) continue
      out.push({ x: cx, y: world.meshHeight(cx, cz) - 0.2, z: cz, scale: radius / 10, yaw, tint })
    }
  }
  return out
}

/** Hedgerow oaks and lone trees thinning with distance, sorted into the three LODs. */
export function loneTrees(world: OuterWorld): Pick<TreeField, 'l0' | 'l1' | 'l2'> {
  const plate = world.plate
  const field: Pick<TreeField, 'l0' | 'l1' | 'l2'> = { l0: [], l1: [], l2: [] }
  const push = (x: number, z: number, scale: number, yaw: number, tint: number) => {
    const lod = treeLod(rectEuclid(plate, x, z))
    if (lod === null) return
    const tree = treeAt(world, x, z, scale, yaw, tint)
    if (lod === 0) field.l0.push(tree)
    else if (lod === 1) field.l1.push(tree)
    else field.l2.push(tree)
  }
  for (const oak of hedgePlan(world).oaks) {
    if (!world.decorate(oak.x, oak.z)) continue
    push(oak.x, oak.z, 1.15 + oak.roll * 0.5, oak.roll * Math.PI * 2, 0.95 + oak.roll * 0.1)
  }
  const lonePitch = 16
  for (let j = Math.floor((plate.minZ - TREE_REACH) / lonePitch); j <= Math.ceil((plate.maxZ + TREE_REACH) / lonePitch); j++) {
    for (let i = Math.floor((plate.minX - TREE_REACH) / lonePitch); i <= Math.ceil((plate.maxX + TREE_REACH) / lonePitch); i++) {
      const x = i * lonePitch + (hash2(i * 2.9, j * 6.1 + 3) - 0.5) * lonePitch
      const z = j * lonePitch + (hash2(i * 8.3 + 1, j * 1.1) - 0.5) * lonePitch
      const outside = rectEuclid(plate, x, z)
      if (outside > TREE_REACH) continue
      const chance = 0.12 / (1 + outside / 220)
      if (hash2(i * 5.1 + 7, j * 3.7) > chance) continue
      if (!world.decorate(x, z)) continue
      if (fieldEdgeDistance(world, x, z) < 2.5) continue
      if (world.forestAt(x, z) > 0.12) continue
      const s = world.sample(x, z)
      if (s.material === 'water' || s.material === 'bank' || s.material === 'rock') continue
      push(x, z, 0.85 + hash2(i, j * 3) * 0.7, hash2(i * 1.1, j) * Math.PI * 2, 0.92 + hash2(j, i) * 0.16)
    }
  }
  return field
}

/** Everything in one call (tests and tooling); the scene builds the same pieces step by step. */
export function trees(world: OuterWorld): TreeField {
  const plate = world.plate
  const lone = loneTrees(world)
  return {
    ...lone,
    woods: woodsBand(world, plate.minZ - WOODS_REACH, plate.maxZ + WOODS_REACH),
    copses: copses(world),
  }
}

/* ---------- haystacks ---------- */

export function haystacks(world: OuterWorld): HayInstance[] {
  const plate = world.plate
  const range = fieldRange(world.fields, plate.minX - HEDGE_REACH, plate.maxX + HEDGE_REACH, plate.minZ - HEDGE_REACH, plate.maxZ + HEDGE_REACH)
  const out: HayInstance[] = []
  const rng = seeded(world.seed * 59 + 13)
  for (let j = range.j0; j <= range.j1; j++) {
    for (let i = range.i0; i <= range.i1; i++) {
      const tone = fieldTone(world.fields, i, j)
      if (tone < 3 || !world.fieldIncluded(i, j)) continue
      const poly = fieldPolygon(world.fields, i, j)
      const cx = (poly[0][0] + poly[1][0] + poly[2][0] + poly[3][0]) / 4
      const cz = (poly[0][1] + poly[1][1] + poly[2][1] + poly[3][1]) / 4
      if (rectEuclid(plate, cx, cz) > HEDGE_REACH) continue
      const count = 2 + Math.floor(rng() * 3)
      for (let k = 0; k < count; k++) {
        // Inside the quad: a point between the centre and a corner.
        const corner = poly[Math.floor(rng() * 4)]
        const f = 0.2 + rng() * 0.55
        const x = cx + (corner[0] - cx) * f
        const z = cz + (corner[1] - cz) * f
        if (!world.decorate(x, z)) continue
        const s = world.sample(x, z)
        if (s.material !== 'meadow') continue
        const thin = 1 - smoothstep(120, HEDGE_REACH, rectEuclid(plate, x, z)) * 0.6
        if (rng() > thin) continue
        out.push({ x, y: world.meshHeight(x, z), z, scale: 1.05 + rng() * 0.45, yaw: rng() * Math.PI })
      }
    }
  }
  return out
}
