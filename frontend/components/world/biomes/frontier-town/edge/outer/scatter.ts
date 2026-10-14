/**
 * Instanced desert props beyond the plate: saguaros, scrub, rocks and the western hoodoo field.
 * Seeded rejection sampling with a minimum spacing (procedural-gen: no grid, no clumps), kept
 * off the plate and PROP_CLEARANCE from every authored feature, off the dry lake, the gorge and
 * the cliffs, out of the four vista corridors, and thinning with distance so the far rings stay
 * cheap. Pure: no three.js.
 */
import { type OuterDesert, GORGE } from './desert'
import { seededRng, smoothstep } from './noise'
import { plateDistance, propClear } from './plate'
import { type Window, outwardPose, poseCamera, type Vista } from './vistas'

export type PropKind = 'saguaro' | 'scrub' | 'rock' | 'hoodoo'

export interface PropInstance {
  x: number
  y: number
  z: number
  yaw: number
  scale: number
  haze: number
}

export interface ScatterSpec {
  kind: PropKind
  count: number
  /** Metres beyond the plate the field reaches; density fades over the last third. */
  reach: number
  minSpacing: number
  scale: [number, number]
  /** Maximum ground slope (rise over 2 m) the prop will stand on. */
  maxSlope: number
}

export const SCATTER: readonly ScatterSpec[] = [
  { kind: 'saguaro', count: 420, reach: 900, minSpacing: 14, scale: [0.75, 1.5], maxSlope: 0.9 },
  { kind: 'scrub', count: 900, reach: 760, minSpacing: 7, scale: [0.8, 1.9], maxSlope: 1.2 },
  { kind: 'rock', count: 360, reach: 1200, minSpacing: 16, scale: [0.7, 2.6], maxSlope: 2.5 },
]

/** The hoodoo field: along the western bench, 15–40 m spires, denser near the step. */
export const HOODOO_SPEC = { count: 72, zFrom: -280, zTo: 260, bench: 110, minSpacing: 18, height: [15, 40] as [number, number], radius: [3, 7] as [number, number] }

/** Half-width of the strip kept clear of tall props along each vista sightline. */
export const CORRIDOR_HALF = 26

/** Distance of (x, z) from the pose camera → landmark sightline segment, horizontal. */
export function corridorDistance(cam: { x: number; z: number }, v: Vista, x: number, z: number): number {
  const dx = v.x - cam.x
  const dz = v.z - cam.z
  const len2 = dx * dx + dz * dz || 1
  const t = Math.min(1, Math.max(0, ((x - cam.x) * dx + (z - cam.z) * dz) / len2))
  return Math.hypot(cam.x + dx * t - x, cam.z + dz * t - z)
}

function inAnyCorridor(desert: OuterDesert, x: number, z: number, pad = 0): boolean {
  for (const v of desert.vistas) {
    const cam = poseCamera(outwardPose(v.id))
    if (corridorDistance(cam, v, x, z) < CORRIDOR_HALF + pad) return true
    if (Math.hypot(v.x - x, v.z - z) < 45 + pad) return true
  }
  const t = desert.trestle
  if (Math.hypot(t.x - x, t.z - z) < t.length / 2 + 30 + pad) return true
  return false
}

class SpacingGrid {
  private readonly cells = new Map<number, Array<[number, number]>>()
  constructor(private readonly cell: number) {}
  private key(ix: number, iz: number): number {
    return (ix + 65536) * 131072 + (iz + 65536)
  }
  tooClose(x: number, z: number, spacing: number): boolean {
    const ix = Math.floor(x / this.cell)
    const iz = Math.floor(z / this.cell)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.cells.get(this.key(ix + dx, iz + dz))
        if (!list) continue
        for (const [px, pz] of list) if (Math.hypot(px - x, pz - z) < spacing) return true
      }
    }
    return false
  }
  add(x: number, z: number): void {
    const key = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))
    const list = this.cells.get(key)
    if (list) list.push([x, z])
    else this.cells.set(key, [[x, z]])
  }
}

function slopeAt(desert: OuterDesert, x: number, z: number): number {
  const h = desert.heightAt(x, z)
  return Math.max(Math.abs(desert.heightAt(x + 2, z) - h), Math.abs(desert.heightAt(x, z + 2) - h), Math.abs(desert.heightAt(x - 2, z) - h), Math.abs(desert.heightAt(x, z - 2) - h))
}

/** Ground a prop may stand on: flats, washes' banks, scree; never the playa, the gorge, a cliff or a dune crest. */
function standable(desert: OuterDesert, kind: PropKind, x: number, z: number, maxSlope: number): { ok: boolean; y: number } {
  const s = desert.sample(x, z)
  if (s.kind === 'playa' || s.kind === 'floor' || s.kind === 'cap') return { ok: false, y: s.height }
  if (kind !== 'rock' && (s.kind === 'dune' || s.kind === 'duneShade')) return { ok: false, y: s.height }
  if (kind === 'saguaro' && s.kind === 'wash') return { ok: false, y: s.height }
  if (s.mesaFrac > 0.12) return { ok: false, y: s.height }
  const g = desert.gorge(z)
  if (g.fade > 0 && Math.abs(x - g.x) < GORGE.wallHalf + 12) return { ok: false, y: s.height }
  if (slopeAt(desert, x, z) > maxSlope) return { ok: false, y: s.height }
  return { ok: true, y: s.height }
}

export function scatterProps(desert: OuterDesert, spec: ScatterSpec): PropInstance[] {
  const rng = seededRng(desert.seed * 101 + spec.kind.length * 7 + spec.count)
  const grid = new SpacingGrid(spec.minSpacing)
  const out: PropInstance[] = []
  let guard = 0
  const maxX = 240 + spec.reach
  const maxZ = 200 + spec.reach
  while (out.length < spec.count && guard++ < spec.count * 30) {
    const x = (rng() * 2 - 1) * maxX
    const z = (rng() * 2 - 1) * maxZ
    const d = plateDistance(x, z)
    if (d <= 0 || d > spec.reach) continue
    // Thin out with distance: full density to a third of the reach, then a smooth fade.
    if (rng() < smoothstep(spec.reach * 0.35, spec.reach, d) * 0.85) continue
    if (!propClear(x, z)) continue
    if (kindIsTall(spec.kind) && inAnyCorridor(desert, x, z)) continue
    if (grid.tooClose(x, z, spec.minSpacing)) continue
    const stand = standable(desert, spec.kind, x, z, spec.maxSlope)
    if (!stand.ok) continue
    const far = smoothstep(300, 1100, d)
    const scale = (spec.scale[0] + rng() * (spec.scale[1] - spec.scale[0])) * (1 + far * 0.8)
    grid.add(x, z)
    out.push({ x, y: stand.y, z, yaw: rng() * Math.PI * 2, scale, haze: desert.hazeAt(x, z) })
  }
  return out
}

function kindIsTall(kind: PropKind): boolean {
  return kind === 'saguaro' || kind === 'hoodoo'
}

export interface HoodooInstance extends PropInstance {
  height: number
  radius: number
}

/** The hoodoo field along the western escarpment, skipping the west window and the mast's corridor. */
export function hoodooField(desert: OuterDesert): HoodooInstance[] {
  const rng = seededRng(desert.seed * 59 + 17)
  const west = desert.windows.find((w) => w.id === 'west')!
  const grid = new SpacingGrid(HOODOO_SPEC.minSpacing)
  const out: HoodooInstance[] = []
  let guard = 0
  while (out.length < HOODOO_SPEC.count && guard++ < HOODOO_SPEC.count * 40) {
    const z = HOODOO_SPEC.zFrom + rng() * (HOODOO_SPEC.zTo - HOODOO_SPEC.zFrom)
    const e = desert.escarpment(z)
    if (e.fade < 0.6) continue
    // Denser on and just behind the step, thinning across the bench.
    const back = Math.pow(rng(), 1.6) * HOODOO_SPEC.bench
    const x = e.x + 6 - back
    if (!propClear(x, z)) continue
    if (Math.abs(z - west.along) < west.halfWidth + 14) continue
    if (inAnyCorridor(desert, x, z, 6)) continue
    if (grid.tooClose(x, z, HOODOO_SPEC.minSpacing)) continue
    const s = desert.sample(x, z)
    if (s.kind === 'floor' || s.kind === 'playa' || s.mesaFrac > 0.12) continue
    const height = HOODOO_SPEC.height[0] + rng() * (HOODOO_SPEC.height[1] - HOODOO_SPEC.height[0])
    const radius = HOODOO_SPEC.radius[0] + rng() * (HOODOO_SPEC.radius[1] - HOODOO_SPEC.radius[0])
    grid.add(x, z)
    out.push({ x, y: s.height - 0.6, z, yaw: rng() * Math.PI * 2, scale: 1, height, radius, haze: desert.hazeAt(x, z) })
  }
  return out
}

/** Window the hoodoo field is cut around (for the renderer's tests). */
export function hoodooWindow(desert: OuterDesert): Window {
  return desert.windows.find((w) => w.id === 'west')!
}
