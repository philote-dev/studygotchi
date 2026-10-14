import type { DrapedQuad, HeightField, HeightSampler } from './heightfield'
import type { House, Item, Tree } from './plan-types'
import { clamp, hash2, lerp, pick, range, type Rng, type Vec2 } from './rng'

/** Yaw that points a unit box's local +x along the world direction (dx, dz). */
export function yawFromDir(dx: number, dz: number): number {
  return Math.atan2(-dz, dx)
}

export interface WallRingOptions {
  /** Base height of the wall at a point (terrace floor or terrain). */
  floorY: (x: number, z: number) => number
  height: number
  thickness?: number
  towerEvery?: number
  towerRadius?: number
  towerHeight?: number
  /** Indices of segments left open (gates). */
  openings?: ReadonlySet<number>
  wallColor: string
  towerColor?: string
  capColor?: string
  capHeight?: number
  closed?: boolean
  /** How far the wall boxes extend below the floor (tall sinks clad terrace steps as masonry). */
  sink?: number
}

export interface WallRing {
  walls: Item[]
  towers: Item[]
  caps: Item[]
}

/** Curtain wall along a polyline: a box per segment and a capped round tower every n joints. */
export function wallRing(points: readonly Vec2[], options: WallRingOptions): WallRing {
  const walls: Item[] = []
  const towers: Item[] = []
  const caps: Item[] = []
  const thickness = options.thickness ?? 2
  const towerEvery = options.towerEvery ?? 3
  const towerRadius = options.towerRadius ?? 2.6
  const towerHeight = options.towerHeight ?? options.height + 4
  const sink = options.sink ?? 0.6
  const n = options.closed ? points.length : points.length - 1
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    if (options.openings?.has(i)) continue
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len = Math.hypot(dx, dz)
    const ya = options.floorY(a[0], a[1])
    const yb = options.floorY(b[0], b[1])
    const base = Math.min(ya, yb) - sink
    const top = Math.max(ya, yb) + options.height
    walls.push({ p: [(a[0] + b[0]) / 2, base, (a[1] + b[1]) / 2], ry: yawFromDir(dx, dz), s: [len + 0.4, top - base, thickness], color: options.wallColor })
  }
  for (let i = 0; i < points.length; i++) {
    if (i % towerEvery !== 0) continue
    if (!options.closed && i === points.length - 1 && points.length % towerEvery !== 1) continue
    const [x, z] = points[i]
    const y = options.floorY(x, z) - sink - 0.4
    towers.push({ p: [x, y, z], s: [towerRadius * 2, towerHeight + sink + 0.4, towerRadius * 2], color: options.towerColor ?? options.wallColor })
    if (options.capColor) caps.push({ p: [x, y + towerHeight + sink + 0.4, z], s: [towerRadius * 2.5, options.capHeight ?? towerRadius * 1.5, towerRadius * 2.5], color: options.capColor })
  }
  return { walls, towers, caps }
}

/** Segment indices of a ring whose midpoint lies within `radius` of any of the given spots (gates). */
export function openingsNear(points: readonly Vec2[], spots: readonly Vec2[], radius: number, closed = true): Set<number> {
  const out = new Set<number>()
  const n = closed ? points.length : points.length - 1
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const mx = (a[0] + b[0]) / 2
    const mz = (a[1] + b[1]) / 2
    if (spots.some((spot) => Math.hypot(spot[0] - mx, spot[1] - mz) < radius)) out.add(i)
  }
  return out
}

/** Points on an ellipse between two angles (radians, 0 = +z/south, increasing toward +x). */
export function ellipseArc(centre: Vec2, rx: number, rz: number, from: number, to: number, count: number): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i <= count; i++) {
    const t = lerp(from, to, i / count)
    out.push([centre[0] + Math.sin(t) * rx, centre[1] + Math.cos(t) * rz])
  }
  return out
}

/** Irregular closed polygon around a centre: radius wobbles per vertex. */
export function wobblyPolygon(centre: Vec2, radius: number, sides: number, rng: Rng, wobble = 0.14): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < sides; i++) {
    const t = (i / sides) * Math.PI * 2 + range(rng, -0.08, 0.08)
    const r = radius * (1 + range(rng, -wobble, wobble))
    out.push([centre[0] + Math.sin(t) * r, centre[1] + Math.cos(t) * r])
  }
  return out
}

export interface PatchworkOptions {
  rng: Rng
  /** Rotation of the field grid (radians). */
  yaw: number
  /** Strip widths (metres) along each grid axis. */
  cell: readonly [number, number]
  /** Half extent of the grid search around the origin. */
  extent: number
  /** Include a field whose centre is here? */
  mask: (x: number, z: number) => boolean
  /** Field colours (hex) with relative weights. */
  palette: readonly (readonly [string, number])[]
  skipChance?: number
  orchardChance?: number
  orchardColor?: string
  hedgeChance?: number
  /** Hedge segments are dropped where this is true (roads, water). */
  avoid?: (x: number, z: number) => boolean
  hf: HeightField
}

export interface Patchwork {
  fields: Map<string, DrapedQuad[]>
  hedges: Item[]
  orchards: Tree[]
}

function weighted<T>(rng: Rng, table: readonly (readonly [T, number])[]): T {
  const total = table.reduce((sum, [, w]) => sum + w, 0)
  let roll = rng() * total
  for (const [item, w] of table) {
    roll -= w
    if (roll <= 0) return item
  }
  return table[table.length - 1][0]
}

/** A patchwork of fields on an irregular rotated grid, with hedgerows and the odd orchard. */
export function patchwork(options: PatchworkOptions): Patchwork {
  const { rng, yaw, extent, hf } = options
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const toWorld = (u: number, v: number): Vec2 => [u * c - v * s, u * s + v * c]
  const edgesU: number[] = [-extent]
  const edgesV: number[] = [-extent]
  while (edgesU[edgesU.length - 1] < extent) edgesU.push(edgesU[edgesU.length - 1] + options.cell[0] * range(rng, 0.65, 1.45))
  while (edgesV[edgesV.length - 1] < extent) edgesV.push(edgesV[edgesV.length - 1] + options.cell[1] * range(rng, 0.65, 1.45))
  const included = new Map<string, string>()
  const fields = new Map<string, DrapedQuad[]>()
  const orchards: Tree[] = []
  const hedges: Item[] = []
  const skipChance = options.skipChance ?? 0.18
  const orchardChance = options.orchardChance ?? 0.1
  for (let j = 0; j < edgesV.length - 1; j++) {
    for (let i = 0; i < edgesU.length - 1; i++) {
      const u0 = edgesU[i]
      const u1 = edgesU[i + 1]
      const v0 = edgesV[j]
      const v1 = edgesV[j + 1]
      const centre = toWorld((u0 + u1) / 2, (v0 + v1) / 2)
      if (!options.mask(centre[0], centre[1])) continue
      // every corner must be farmable too, so fields stop short of water and cliffs
      const corners = [toWorld(u0, v0), toWorld(u1, v0), toWorld(u0, v1), toWorld(u1, v1)]
      if (!corners.every(([x, z]) => options.mask(x, z))) continue
      if (rng() < skipChance) continue
      const orchard = rng() < orchardChance
      const color = orchard ? (options.orchardColor ?? '#8fc48a') : weighted(rng, options.palette)
      included.set(`${i},${j}`, color)
      const quad: DrapedQuad = { centre, half: [(u1 - u0) / 2 - 0.6, (v1 - v0) / 2 - 0.6], yaw }
      const list = fields.get(color) ?? []
      list.push(quad)
      fields.set(color, list)
      if (orchard) {
        const spacing = 4.6
        for (let v = v0 + spacing * 0.8; v < v1 - spacing * 0.5; v += spacing) {
          for (let u = u0 + spacing * 0.8; u < u1 - spacing * 0.5; u += spacing) {
            const [x, z] = toWorld(u + range(rng, -0.4, 0.4), v + range(rng, -0.4, 0.4))
            if (options.avoid?.(x, z)) continue
            orchards.push({ p: [x, hf.heightAt(x, z), z], r: range(rng, 1.3, 1.7), trunk: 1.2, crownH: 2.4, kind: 'round', color: '#5f9a55' })
          }
        }
      }
    }
  }
  const hedgeChance = options.hedgeChance ?? 0.72
  const hedge = (ua: number, va: number, ub: number, vb: number) => {
    if (rng() > hedgeChance) return
    const len = Math.hypot(ub - ua, vb - va)
    const pieces = Math.max(1, Math.round(len / 5.2))
    for (let k = 0; k < pieces; k++) {
      const t0 = (k + 0.08) / pieces
      const t1 = (k + 0.92) / pieces
      const a = toWorld(lerp(ua, ub, t0), lerp(va, vb, t0))
      const b = toWorld(lerp(ua, ub, t1), lerp(va, vb, t1))
      const mx = (a[0] + b[0]) / 2
      const mz = (a[1] + b[1]) / 2
      if (options.avoid?.(mx, mz)) continue
      const y = Math.min(hf.heightAt(a[0], a[1]), hf.heightAt(b[0], b[1])) - 0.3
      hedges.push({ p: [mx, y, mz], ry: yawFromDir(b[0] - a[0], b[1] - a[1]), s: [Math.hypot(b[0] - a[0], b[1] - a[1]), range(rng, 1.4, 2) + 0.3, 1.3] })
    }
  }
  for (let j = 0; j < edgesV.length - 1; j++) {
    for (let i = 0; i < edgesU.length - 1; i++) {
      const here = included.has(`${i},${j}`)
      const right = included.has(`${i + 1},${j}`)
      const down = included.has(`${i},${j + 1}`)
      if (here !== right || (here && right && hash2(i, j, 5) < 0.5)) hedge(edgesU[i + 1], edgesV[j], edgesU[i + 1], edgesV[j + 1])
      if (here !== down || (here && down && hash2(i, j, 9) < 0.5)) hedge(edgesU[i], edgesV[j + 1], edgesU[i + 1], edgesV[j + 1])
    }
  }
  return { fields, hedges, orchards }
}

export interface ScatterOptions {
  rng: Rng
  count: number
  /** Axis-aligned search box [minX, minZ, maxX, maxZ]. */
  box: readonly [number, number, number, number]
  mask: (x: number, z: number) => boolean
  spacing?: number
  hf: HeightField
  kind?: Tree['kind'] | ((x: number, z: number) => Tree['kind'])
  radius?: readonly [number, number]
  colors: readonly string[]
}

/** Blue-noise-ish tree scatter: rejection sampling with a spacing grid. */
export function scatterTrees(options: ScatterOptions): Tree[] {
  const { rng, hf } = options
  const spacing = options.spacing ?? 4.5
  const taken = new Set<string>()
  const out: Tree[] = []
  const [minX, minZ, maxX, maxZ] = options.box
  const radius = options.radius ?? [2, 3.4]
  let attempts = 0
  while (out.length < options.count && attempts < options.count * 14) {
    attempts++
    const x = range(rng, minX, maxX)
    const z = range(rng, minZ, maxZ)
    if (!options.mask(x, z)) continue
    const key = `${Math.floor(x / spacing)},${Math.floor(z / spacing)}`
    if (taken.has(key)) continue
    taken.add(key)
    const kind = typeof options.kind === 'function' ? options.kind(x, z) : (options.kind ?? 'round')
    const r = range(rng, radius[0], radius[1])
    out.push({
      p: [x, hf.heightAt(x, z) - 0.2, z],
      r,
      trunk: kind === 'cone' ? r * 0.5 : r * 0.7,
      crownH: kind === 'cone' ? r * 3.2 : r * 2,
      kind,
      color: pick(rng, options.colors),
    })
  }
  return out
}

export interface StreetHousesOptions {
  rng: Rng
  hf: HeightField
  path: readonly Vec2[]
  spacing: number
  /** Distance from the path centreline to the house centre. */
  setback: number
  sides?: readonly (-1 | 1)[]
  mask?: (x: number, z: number) => boolean
  size?: { w: readonly [number, number]; d: readonly [number, number]; h: readonly [number, number] }
  walls: readonly string[]
  roofs: readonly string[]
  /** Yaw jitter in radians. */
  jitter?: number
  /** Skip chance per slot, to keep gaps between houses. */
  gap?: number
  /** Extra downward sink so houses on slopes keep their feet in the ground. */
  sink?: number
}

/** Houses lined up on both sides of a street, ridge parallel to the street. */
export function streetHouses(options: StreetHousesOptions): House[] {
  const { rng, hf, path } = options
  const out: House[] = []
  const size = options.size ?? { w: [5, 7.5], d: [4, 5.5], h: [3, 4.8] }
  const sides = options.sides ?? [-1, 1]
  let carry = options.spacing * 0.4
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const tx = (b[0] - a[0]) / (len || 1)
    const tz = (b[1] - a[1]) / (len || 1)
    let t = carry
    while (t < len) {
      const px = a[0] + tx * t
      const pz = a[1] + tz * t
      for (const side of sides) {
        if (rng() < (options.gap ?? 0.15)) continue
        const x = px - tz * side * options.setback
        const z = pz + tx * side * options.setback
        if (options.mask && !options.mask(x, z)) continue
        const w = range(rng, size.w[0], size.w[1])
        const d = range(rng, size.d[0], size.d[1])
        const h = range(rng, size.h[0], size.h[1])
        const ry = yawFromDir(tx, tz) + range(rng, -(options.jitter ?? 0.08), options.jitter ?? 0.08)
        const y = hf.heightAt(x, z) - (options.sink ?? 0.5)
        out.push({ p: [x, y, z], ry, w, d, h, roofH: h * range(rng, 0.55, 0.8), wall: pick(rng, options.walls), roof: pick(rng, options.roofs) })
      }
      t += options.spacing * range(rng, 0.85, 1.3)
    }
    carry = t - len
  }
  return out
}

export interface BridgeOptions {
  a: Vec2
  b: Vec2
  deckY: number
  waterY: number
  width: number
  span?: number
  stone: string
  deckColor?: string
}

export interface BridgeParts {
  decks: Item[]
  arches: Item[]
  piers: Item[]
  parapets: Item[]
}

/** Stone arch bridge or causeway between two points: deck, parapets, arches and piers. */
export function archBridge(options: BridgeOptions): BridgeParts {
  const { a, b } = options
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len = Math.hypot(dx, dz)
  const ux = dx / len
  const uz = dz / len
  const yaw = yawFromDir(dx, dz)
  const span = options.span ?? 9
  const count = Math.max(1, Math.round(len / span))
  const actual = len / count
  const radius = actual * 0.42
  const decks: Item[] = []
  const arches: Item[] = []
  const piers: Item[] = []
  const parapets: Item[] = []
  const archCentreY = options.waterY - 0.4
  const deckBottom = Math.max(archCentreY + radius * 0.35, options.waterY + 0.3)
  const mx = (a[0] + b[0]) / 2
  const mz = (a[1] + b[1]) / 2
  decks.push({ p: [mx, deckBottom, mz], ry: yaw, s: [len + 1.2, options.deckY - deckBottom, options.width], color: options.deckColor ?? options.stone })
  for (const side of [-1, 1]) {
    parapets.push({ p: [mx - uz * side * (options.width / 2 - 0.25), options.deckY, mz + ux * side * (options.width / 2 - 0.25)], ry: yaw, s: [len + 1.2, 1.1, 0.5], color: options.stone })
  }
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count
    const x = a[0] + dx * t
    const z = a[1] + dz * t
    arches.push({ p: [x, archCentreY, z], ry: yaw, s: [radius, radius, (options.width + 0.6) / 0.4], color: options.stone })
  }
  for (let i = 1; i < count; i++) {
    const t = i / count
    const x = a[0] + dx * t
    const z = a[1] + dz * t
    piers.push({ p: [x, options.waterY - 4, z], ry: yaw, s: [1.6, deckBottom - options.waterY + 4.2, options.width + 0.8], color: options.stone })
  }
  return { decks, arches, piers, parapets }
}

export function roundTower(p: readonly [number, number, number], radius: number, height: number, wall: string, cap: string, capHeight = radius * 1.5): { body: Item; cap: Item } {
  return {
    body: { p, s: [radius * 2, height, radius * 2], color: wall },
    cap: { p: [p[0], p[1] + height, p[2]], s: [radius * 2.5, capHeight, radius * 2.5], color: cap },
  }
}

export interface CathedralParts {
  boxes: Item[]
  prisms: Item[]
  cones6: Item[]
  cones4: Item[]
  cyls: Item[]
  windows: Item[]
}

/** Nave, west tower with spire, crossing lantern, apse; scale 1 is a 26 m nave. */
export function cathedral(p: readonly [number, number, number], yaw: number, scale: number, stone: string, roof: string): CathedralParts {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const at = (lx: number, lz: number): readonly [number, number] => [p[0] + lx * c - lz * s, p[2] + lx * s + lz * c]
  const naveL = 26 * scale
  const naveW = 11 * scale
  const naveH = 13 * scale
  const boxes: Item[] = []
  const prisms: Item[] = []
  const cones6: Item[] = []
  const cones4: Item[] = []
  const cyls: Item[] = []
  const windows: Item[] = []
  const nave = at(0, 0)
  boxes.push({ p: [nave[0], p[1], nave[1]], ry: yaw, s: [naveL, naveH, naveW], color: stone })
  prisms.push({ p: [nave[0], p[1] + naveH - 0.05, nave[1]], ry: yaw, s: [naveL + 0.6, naveH * 0.55, naveW + 0.8], color: roof })
  // transept
  const transept = at(naveL * 0.12, 0)
  boxes.push({ p: [transept[0], p[1], transept[1]], ry: yaw, s: [naveW * 0.8, naveH, naveW * 1.9], color: stone })
  prisms.push({ p: [transept[0], p[1] + naveH - 0.05, transept[1]], ry: yaw + Math.PI / 2, s: [naveW * 1.9 + 0.6, naveH * 0.55, naveW * 0.8 + 0.8], color: roof })
  // crossing lantern + spire
  boxes.push({ p: [transept[0], p[1] + naveH, transept[1]], ry: yaw, s: [naveW * 0.7, naveH * 0.5, naveW * 0.7], color: stone })
  cones6.push({ p: [transept[0], p[1] + naveH * 1.5, transept[1]], ry: yaw, s: [naveW * 0.78, 18 * scale, naveW * 0.78], color: roof })
  // west tower
  const west = at(-naveL / 2 - naveW * 0.3, 0)
  const towerW = naveW * 0.68
  const towerH = naveH * 1.9
  boxes.push({ p: [west[0], p[1], west[1]], ry: yaw, s: [towerW, towerH, towerW], color: stone })
  cones4.push({ p: [west[0], p[1] + towerH, west[1]], ry: yaw, s: [towerW * 1.08, 11 * scale, towerW * 1.08], color: roof })
  for (const corner of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const pin = at(-naveL / 2 - naveW * 0.3 + corner[0] * towerW * 0.46, corner[1] * towerW * 0.46)
    cyls.push({ p: [pin[0], p[1] + towerH - 1, pin[1]], s: [1.1 * scale, 4 * scale, 1.1 * scale], color: stone })
  }
  // apse
  const apse = at(naveL / 2, 0)
  cyls.push({ p: [apse[0], p[1], apse[1]], s: [naveW * 0.9, naveH * 0.85, naveW * 0.9], color: stone })
  cones6.push({ p: [apse[0], p[1] + naveH * 0.85, apse[1]], ry: yaw, s: [naveW * 1.05, naveH * 0.45, naveW * 1.05], color: roof })
  // tall windows along the nave, both sides
  for (let k = -2; k <= 2; k++) {
    for (const side of [-1, 1]) {
      const w = at(k * naveL * 0.16, side * (naveW / 2 + 0.06))
      windows.push({ p: [w[0], p[1] + naveH * 0.55, w[1]], ry: yaw + (side > 0 ? 0 : Math.PI), s: [1.6 * scale, 5 * scale, 1] })
    }
  }
  return { boxes, prisms, cones6, cones4, cyls, windows }
}

/** Keep with four corner turrets. */
export function keep(p: readonly [number, number, number], width: number, height: number, yaw: number, stone: string, cap: string): { boxes: Item[]; cyls: Item[]; cones: Item[]; windows: Item[] } {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const boxes: Item[] = [{ p, ry: yaw, s: [width, height, width], color: stone }]
  const cyls: Item[] = []
  const cones: Item[] = []
  const windows: Item[] = []
  for (const [cx, cz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const lx = cx * width * 0.5
    const lz = cz * width * 0.5
    const x = p[0] + lx * c - lz * s
    const z = p[2] + lx * s + lz * c
    cyls.push({ p: [x, p[1], z], s: [width * 0.3, height + 3, width * 0.3], color: stone })
    cones.push({ p: [x, p[1] + height + 3, z], s: [width * 0.38, width * 0.3, width * 0.38], color: cap })
  }
  for (const side of [-1, 1]) {
    for (let k = -1; k <= 1; k++) {
      const lx = k * width * 0.28
      const lz = side * (width / 2 + 0.06)
      windows.push({ p: [p[0] + lx * c - lz * s, p[1] + height * 0.62, p[2] + lx * s + lz * c], ry: yaw + (side > 0 ? 0 : Math.PI), s: [1.1, 2, 1] })
    }
  }
  return { boxes, cyls, cones, windows }
}

/** Timber hall or barn with a steep roof. */
export function hall(p: readonly [number, number, number], yaw: number, w: number, d: number, h: number, wall: string, roof: string): House {
  return { p, ry: yaw, w, d, h, roofH: h * 0.9, wall, roof }
}

/** Market stalls: a post box with a coloured canopy prism, loosely gridded on a plaza. */
export function stalls(rng: Rng, hf: HeightField, centre: Vec2, yaw: number, cols: number, rows: number, pitch: number, canopies: readonly string[]): { posts: Item[]; canopies: Item[] } {
  const posts: Item[] = []
  const tops: Item[] = []
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (rng() < 0.2) continue
      const lx = (i - (cols - 1) / 2) * pitch + range(rng, -0.4, 0.4)
      const lz = (j - (rows - 1) / 2) * pitch * 1.3 + range(rng, -0.4, 0.4)
      const x = centre[0] + lx * c - lz * s
      const z = centre[1] + lx * s + lz * c
      const y = hf.heightAt(x, z)
      posts.push({ p: [x, y, z], ry: yaw, s: [2.4, 1.9, 1.6], color: '#8a6a4a' })
      tops.push({ p: [x, y + 1.9, z], ry: yaw, s: [3.2, 1.3, 2.6], color: pick(rng, canopies) })
    }
  }
  return { posts, canopies: tops }
}

export interface Lanterns {
  /** Glow heads (a glow layer). */
  heads: Item[]
  /** Posts under them (a plain box layer). */
  posts: Item[]
}

/** Lanterns along one edge of a path at intervals, for the night pass. */
export function lanterns(hf: HeightSampler, path: readonly Vec2[], every: number, lift = 2.6, offset = 1.7): Lanterns {
  const heads: Item[] = []
  const posts: Item[] = []
  let carry = every * 0.5
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const nx = -(b[1] - a[1]) / len
    const nz = (b[0] - a[0]) / len
    let t = carry
    while (t < len) {
      const x = lerp(a[0], b[0], t / len) + nx * offset
      const z = lerp(a[1], b[1], t / len) + nz * offset
      const ground = hf.heightAt(x - nx * offset, z - nz * offset)
      heads.push({ p: [x, ground + lift, z], s: [0.5, 0.5, 0.5] })
      posts.push({ p: [x, ground - 0.2, z], s: [0.22, lift + 0.2, 0.22], color: '#4a3a30' })
      t += every
    }
    carry = t - len
  }
  return { heads, posts }
}

/** Carts, as scale cues: a bed box plus two wheels. */
export function carts(rng: Rng, hf: HeightField, spots: readonly Vec2[], yawAt: (p: Vec2) => number): { beds: Item[]; wheels: Item[] } {
  const beds: Item[] = []
  const wheels: Item[] = []
  for (const spot of spots) {
    const yaw = yawAt(spot) + range(rng, -0.3, 0.3)
    const y = hf.heightAt(spot[0], spot[1])
    beds.push({ p: [spot[0], y + 0.6, spot[1]], ry: yaw, s: [3, 0.9, 1.6], color: pick(rng, ['#8a6a4a', '#a37a52']) })
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    for (const side of [-1, 1]) {
      // thin upright box plates read as wheels at pixel scale (both layers are boxes)
      wheels.push({ p: [spot[0] - side * 0.95 * s, y, spot[1] - side * 0.95 * c], ry: yaw, s: [1.2, 1.2, 0.25], color: '#5a4030' })
    }
  }
  return { beds, wheels }
}

export function clampToLand(v: number, half: number): number {
  return clamp(v, -half + 2, half - 2)
}
