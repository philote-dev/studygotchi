/**
 * Collider footprints for the Coastal Ruins land, derived from the same placement data the meshes
 * are placed from (`districtSlots`, `propPlacements`, `seededDistrictPlan`, `localPaths`, the
 * dressing and escarpment tables, `seaStacks`), so the shapes cannot drift from the geometry.
 * The scene components register these per source; the vitest walker simulation builds the union
 * with `coastalLandColliders`, so both see exactly the same set.
 *
 * Footprints are metres in each object's local frame (see Structures.tsx / Props.tsx for the
 * geometry) and are rotated into world XZ exactly as the groups are. Uses the shared collider
 * convention: world = centre + R(yaw) · local, R(yaw) · (lx, lz) = (lx cos + lz sin, −lx sin + lz cos).
 */
import type { Collider } from '../../collision/colliders'
import {
  type BiomeLayout,
  type BuildingKind,
  type DistrictProgress,
  type LandmarkStage,
  type Point2,
  type SkylineProfile,
  courseProgress,
  landmarkStage,
  populationFor,
  seededDistrictPlan,
  skylineProfile,
} from '../layout/biome-layout'
import { OLIVE_SPOTS, STONE_PIECES, STONE_SPOTS, backRow, footBlocks, shoulderData, stoneSpotScale } from '../layout/dressing'
import { type Placement, districtSlots, localPaths, propPlacements, seaStacks, visibleProps } from '../layout/terrain'

/* ---------- local shapes ---------- */

interface LocalCircle {
  kind: 'circle'
  lx: number
  lz: number
  r: number
}

interface LocalBox {
  kind: 'box'
  lx: number
  lz: number
  hx: number
  hz: number
  /** Extra turn relative to the group. */
  yaw?: number
}

type LocalShape = LocalCircle | LocalBox

const circle = (lx: number, lz: number, r: number): LocalCircle => ({ kind: 'circle', lx, lz, r })
const box = (lx: number, lz: number, hx: number, hz: number, yaw = 0): LocalBox => ({ kind: 'box', lx, lz, hx, hz, yaw })

/** Rotate a local offset by the group yaw (three.js `rotation.y`). */
export function worldFromLocal(cx: number, cz: number, yaw: number, lx: number, lz: number, scale = 1): [number, number] {
  const cs = Math.cos(yaw)
  const sn = Math.sin(yaw)
  return [cx + (lx * cs + lz * sn) * scale, cz + (-lx * sn + lz * cs) * scale]
}

/** Place local shapes as a group at (cx, cz) with the group's yaw and uniform scale. */
export function placeShapes(shapes: readonly LocalShape[], cx: number, cz: number, yaw: number, scale: number, tag: string, id: string): Collider[] {
  return shapes.map((shape, k) => {
    const [x, z] = worldFromLocal(cx, cz, yaw, shape.lx, shape.lz, scale)
    const sid = shapes.length > 1 ? `${id}#${k}` : id
    if (shape.kind === 'circle') return { kind: 'circle', x, z, r: shape.r * scale, tag, id: sid }
    return { kind: 'box', x, z, hx: shape.hx * scale, hz: shape.hz * scale, yaw: yaw + (shape.yaw ?? 0), tag, id: sid }
  })
}

/** A thin wall following a polyline of local points (Structures.WallLine: 0.75 m thick boxes). */
function wallLine(points: ReadonlyArray<readonly [number, number]>, thickness = 0.75): LocalShape[] {
  const out: LocalShape[] = []
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1]
    const [bx, bz] = points[i]
    const dx = bx - ax
    const dz = bz - az
    const length = Math.hypot(dx, dz)
    // WallLine draws a box of depth `length + 0.4` along local z, turned by atan2(dx, dz).
    out.push(box((ax + bx) / 2, (az + bz) / 2, thickness / 2, length / 2 + 0.2, Math.atan2(dx, dz)))
  }
  return out
}

/* ---------- buildings ---------- */

/** Wall footprints of each house kind (Props.tsx geometry). */
export function buildingFootprint(kind: BuildingKind, index: number): LocalShape[] {
  switch (kind) {
    case 'plaster-house': {
      const width = 4.5 + (index % 3) * 0.55
      const depth = 3.8 + (index % 2) * 0.65
      return [box(0, 0, width / 2, depth / 2)]
    }
    case 'survey-shelter':
      return [box(0, 0, 2.4, 1.8)]
    case 'terrace-shed':
      return [box(0, 0, 2.6, 1.9)]
    case 'forum-shelter':
      // Four posts over a 4.2 × 2.9 base slab.
      return [box(0, 0, 2.1, 1.45)]
    case 'quay-workshop':
      return [box(0, 0, 2.75, 2.1)]
  }
}

export function buildingColliders(layout: BiomeLayout, seed: number, progress: DistrictProgress): Collider[] {
  const out: Collider[] = []
  for (const district of layout.districts) {
    const pop = populationFor(district, progress[district.id] ?? 0)
    const slots = districtSlots(layout, district, seed)
    for (const slot of slots.slice(0, pop.buildings)) {
      out.push(...placeShapes(buildingFootprint(district.building, slot.index), slot.position[0], slot.position[2], slot.yaw, 1, 'building', `building:${district.id}:${slot.index}`))
    }
  }
  return out
}

/* ---------- district anchors ---------- */

/** Circles along a torus arc in the local frame (DrownedForum ring: R 14, tube 1.15). */
function arcCircles(radius: number, start: number, arc: number, r: number): LocalShape[] {
  const n = Math.max(2, Math.ceil((arc * radius) / 2.2))
  const out: LocalShape[] = []
  for (let i = 0; i <= n; i++) {
    // The torus lies in the XZ plane after rotation (−π/2, 0, start): angle runs from `start`.
    const a = start + (arc * i) / n
    out.push(circle(Math.cos(a) * radius, -Math.sin(a) * radius, r))
  }
  return out
}

/** The anchor pieces Structures.Anchor places, by district. */
export function anchorColliders(layout: BiomeLayout, seed: number): Collider[] {
  const plan = seededDistrictPlan(layout, seed)
  const out: Collider[] = []
  for (const district of layout.districts) {
    const [cx, cz] = plan[district.id].center
    const yaw = (plan[district.id].yawDeg * Math.PI) / 180
    const id = `anchor:${district.id}`
    switch (district.id) {
      case 'cliff-village': {
        // CivicStairs turns by the lane yaw, not the seeded yaw.
        const shapes: LocalShape[] = [
          box(-3, 12, 20.5, 4.5),
          box(2, 0, 19, 5),
          box(-2, -12, 17, 5),
          ...wallLine([[-18, 8], [-12, 5], [-5, 7], [3, 5], [12, 7], [18, 4]]),
          ...wallLine([[-15, -5], [-8, -7], [0, -5], [8, -8], [15, -6]]),
          circle(-11 - 4.3, 8 - 2.2, 0.14),
          circle(-11 - 4.3, 8 + 2.2, 0.14),
          circle(-11 + 4.3, 8 - 2.2, 0.14),
          circle(-11 + 4.3, 8 + 2.2, 0.14),
        ]
        out.push(...placeShapes(shapes, cx, cz, district.laneYaw, 1, 'anchor', id))
        break
      }
      case 'archaeology-ridge': {
        const columns: Array<[number, number]> = [[-16, -2], [-10, 0], [-2, -1], [8, 1], [15, -2]]
        const shapes: LocalShape[] = [
          ...columns.map(([x, z]) => circle(x, z, 0.86)),
          box(-12, 5, 1.55, 0.72),
          box(2, 5.6, 1.38, 0.72),
          box(12, 6.2, 1.2, 0.72),
          box(-13, -7, 5, 1.6),
          box(2, -7, 4, 1.35),
          box(13, 6, 3.5, 1.2),
          circle(-6 - 4.2, 8 - 2.2, 0.11),
          circle(-6 - 4.2, 8 + 2.2, 0.11),
          circle(-6 + 4.2, 8 - 2.2, 0.11),
          circle(-6 + 4.2, 8 + 2.2, 0.11),
          circle(13 - 2.2, -8, 0.1),
          circle(13, -8, 0.1),
          circle(13 + 2.2, -8, 0.1),
          circle(19, 4, 1.3),
        ]
        out.push(...placeShapes(shapes, cx, cz, yaw, 1, 'anchor', id))
        break
      }
      case 'dry-terraces': {
        const olives: Array<[number, number, number]> = [[-17, 1, 0.85], [-8, 3, 0.7], [0, -8, 0.8], [10, -2, 0.72], [16, 7, 0.82], [2, 9, 0.68]]
        const shapes: LocalShape[] = [
          ...wallLine([[-22, 10], [-15, 6], [-7, 8], [1, 5], [10, 7], [20, 2]]),
          ...wallLine([[-18, 0], [-12, -4], [-2, -2], [7, -6], [17, -4], [22, -9]]),
          ...wallLine([[-14, -10], [-5, -13], [4, -11], [12, -15], [18, -13]]),
          circle(5, -2, 3.2),
          circle(-10, 7, 2.8),
          ...olives.map(([x, z, s]) => circle(x, z, 0.35 * s)),
          ...Array.from({ length: 9 }, (_, i) => box(-14 + (i % 5) * 6, -6 + Math.floor(i / 5) * 8, 1.9, 0.22, i * 0.4)),
        ]
        out.push(...placeShapes(shapes, cx, cz, yaw, 1, 'anchor', id))
        break
      }
      case 'drowned-forum': {
        const arcs: Array<[number, number]> = [[0.08, 1.2], [1.55, 1.0], [2.8, 1.15], [4.25, 0.85]]
        const shapes: LocalShape[] = [
          ...arcs.flatMap(([start, arc]) => arcCircles(14, start, arc, 1.3)),
          circle(-11, 7, 1.7),
          circle(-4, -9, 1.7),
          circle(8, -7, 1.7),
          circle(12, 5, 1.7),
          circle(-14 + Math.cos(0.3) * -4.1, -5 - Math.sin(0.3) * -4.1, 0.85),
          circle(-14 + Math.cos(0.3) * 4.1, -5 - Math.sin(0.3) * 4.1, 0.85),
          box(17, 7, 6.5, 1.7, -0.45),
        ]
        out.push(...placeShapes(shapes, cx, cz, yaw, 1, 'anchor', id))
        break
      }
      case 'working-quay': {
        const shapes: LocalShape[] = [
          box(0, 0, 21, 3.25),
          box(17.5, 15, 3.5, 15),
          box(-11, 10, 6.5, 2.5),
          circle(-12, 7, 0.4),
          ...Array.from({ length: 8 }, (_, i) => box(-16 + (i % 4) * 2.3, 4.2 + Math.floor(i / 4) * 2, 0.75, 0.7, i * 0.27)),
        ]
        out.push(...placeShapes(shapes, cx, cz, yaw, 1, 'anchor', id))
        break
      }
    }
  }
  return out
}

/* ---------- props ---------- */

/** Local footprint of a prop (Props.tsx geometry) inside its Knockable group. */
export function propFootprint(placement: Placement): LocalShape[] {
  switch (placement.kind) {
    case 'lamp':
      return [circle(0, 0, 0.12)]
    case 'crate':
    case 'find':
      return [box(0, 0, 0.4, 0.4)]
    case 'amphora':
      return [circle(0, 0, 0.42)]
    case 'olive':
      return [circle(0, 0, 0.55)]
    case 'survey-table':
      return [box(0, 0, 1.2, 0.75)]
    case 'market-stall':
      return [box(0, 0, 1.4, 0.9)]
    case 'boat':
      return [box(0, 0, 2.4, 1.0)]
    case 'buoy':
      return [circle(0, 0, 0.45)]
    case 'mosaic':
      // Flat on the ground: walkable.
      return []
  }
}

export function propColliders(layout: BiomeLayout, seed: number, progress: DistrictProgress): Collider[] {
  const out: Collider[] = []
  for (const placement of visibleProps(propPlacements(layout, seed), layout, progress)) {
    out.push(...placeShapes(propFootprint(placement), placement.position[0], placement.position[2], placement.yaw, 1, 'prop', `prop:${placement.districtId}:${placement.kind}:${placement.index}`))
  }
  return out
}

/** Anchors, buildings and props: what `<Districts>` registers. */
export function districtColliders(layout: BiomeLayout, seed: number, progress: DistrictProgress): Collider[] {
  return [...anchorColliders(layout, seed), ...buildingColliders(layout, seed, progress), ...propColliders(layout, seed, progress)]
}

/* ---------- docks ---------- */

/** The working quay's path ribbon (`localPaths` kind 'quay', 4 m wide, 1.1 m above the water): what `<Paths>` registers. */
export function dockColliders(layout: BiomeLayout, seed: number): Collider[] {
  const out: Collider[] = []
  for (const path of localPaths(layout, seed)) {
    if (path.kind !== 'quay') continue
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1]
      const b = path.points[i]
      const dx = b[0] - a[0]
      const dz = b[2] - a[2]
      const len = Math.hypot(dx, dz)
      if (len < 1e-6) continue
      out.push({ kind: 'box', x: (a[0] + b[0]) / 2, z: (a[2] + b[2]) / 2, hx: path.width / 2, hz: len / 2, yaw: Math.atan2(dx, dz), tag: 'dock', id: `dock:${path.districtId}:${i}` })
    }
  }
  return out
}

/* ---------- landmark ---------- */

/** The Archive-Beacon on its plinth (radius 6.8): one circle covers every stage. */
export function landmarkColliders(x: number, z: number, stage: LandmarkStage): Collider[] {
  return [{ kind: 'circle', x, z, r: 6.8, tag: 'landmark', id: `landmark:plinth:${stage}` }]
}

/* ---------- terrain dressing, escarpment, sea stacks ---------- */

/** Stone clusters and the loose olives of `<CoastalDressing>`. */
export function dressingColliders(): Collider[] {
  const out: Collider[] = []
  STONE_SPOTS.forEach(([x, , z, yaw], i) => {
    const scale = stoneSpotScale(i)
    out.push(...placeShapes(STONE_PIECES.map(([dx, dz, r]) => circle(dx, dz, r * 1.1)), x, z, yaw, scale, 'tree', `stone:${i}`))
  })
  OLIVE_SPOTS.forEach(([x, , z, scale], i) => out.push({ kind: 'circle', x, z, r: 0.3 * scale, tag: 'tree', id: `olive:${i}` }))
  return out
}

/** The escarpment's foot blocks, the revealed shoulders and the back row. */
export function escarpmentColliders(profile: SkylineProfile): Collider[] {
  const out: Collider[] = []
  footBlocks().forEach((f, i) => out.push({ kind: 'box', x: f.x, z: f.z, hx: f.width / 2, hz: f.depth / 2, yaw: f.yaw, tag: 'escarpment', id: `foot:${i}` }))
  shoulderData(profile).forEach((s, i) => out.push({ kind: 'box', x: s.x, z: s.z, hx: s.width / 2, hz: s.depth / 2, yaw: 0, tag: 'escarpment', id: `shoulder:${i}` }))
  backRow().forEach((b, i) => out.push({ kind: 'box', x: b.x, z: b.z, hx: b.width / 2, hz: b.depth / 2, yaw: b.yaw, tag: 'escarpment', id: `back:${i}` }))
  return out
}

/** The authored side islet stacks (`<HorizonStacks>`). */
export function seaStackColliders(): Collider[] {
  return seaStacks().map((s, i) => ({ kind: 'circle', x: s.x, z: s.z, r: s.radius, tag: 'stack', id: `stack:${i}` }))
}

/* ---------- the whole land ---------- */

/** Everything the coastal scene registers, from the same data, for tests and tooling. */
export function coastalLandColliders(layout: BiomeLayout, seed: number, progress: DistrictProgress): Collider[] {
  const fraction = courseProgress(layout, progress)
  const [hx, hz] = layout.headland.center
  return [
    ...districtColliders(layout, seed, progress),
    ...dockColliders(layout, seed),
    ...landmarkColliders(hx, hz, landmarkStage(fraction)),
    ...dressingColliders(),
    ...escarpmentColliders(skylineProfile(fraction)),
    ...seaStackColliders(),
  ]
}

/** Centreline samples of the walkable lanes and stairs (not the quay deck or the submerged steps). */
export function walkablePathSamples(layout: BiomeLayout, seed: number, step = 1): Point2[] {
  const out: Point2[] = []
  for (const path of localPaths(layout, seed)) {
    if (path.kind !== 'lane' && path.kind !== 'stairs') continue
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1]
      const b = path.points[i]
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / step))
      for (let k = 0; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n])
    }
  }
  return out
}
