/**
 * Collider footprints for the Ice land, derived from the same pure placement data the meshes
 * are placed from (`districtSlots`, `propPlacements`, `harbourFixtures`, `localPaths`,
 * `forestPines`, `ambientScatter`, the layout's landforms), so the shapes cannot drift from
 * the geometry. The scene components register these per source; the vitest walker simulation
 * builds the union with `iceLandColliders`, so both see exactly the same set.
 *
 * Footprints are metres at scale 1 in each object's local frame (see Props.tsx for the
 * geometry) and are scaled / rotated into world XZ exactly as the groups in Structures,
 * Terrain and Landmark are.
 */
import {
  type BiomeLayout,
  type BuildingKind,
  type DistrictProgress,
  type IceBuildingKind,
  type LandmarkStage,
  courseProgress,
  landmarkStage,
  populationFor,
} from '../ice-town/layout/biome-layout'
import {
  type Placement,
  type PropKind,
  type Scatter,
  type Tree,
  ambientScatter,
  anchorPoint,
  districtSlots,
  forestPines,
  harbourFixtures,
  laneDir,
  localPaths,
  propPlacements,
  riverDirAt,
} from '../ice-town/layout/terrain'
import type { Collider } from './colliders'

/* ---------- scales shared with Structures.tsx ---------- */

/**
 * The older building kinds were modelled at toy scale; the forest and harbour houses are metres.
 * Scaled so every house lands in the 4.5–6 m band of the pass-3 scale rethink. Structures.tsx
 * scales the meshes with this table and the colliders below use the same numbers.
 */
export const BUILDING_SCALE: Record<BuildingKind, number> = {
  'forest-house': 1,
  'stilt-house': 1,
  'timber-house': 1.9,
  'fishing-hut': 1.8,
  tent: 1.9,
  quonset: 1.9,
}

/** Props were modelled around 1 m; the big timber structures are already metres. */
export const PROP_SCALE: Partial<Record<PropKind, number>> = {
  watchtower: 1,
  windmill: 1,
  'fenced-plot': 1,
  footbridge: 1,
  lamp: 1,
  helicopter: 1.6,
  boat: 1.8,
  'log-pile': 1.6,
  cart: 1.5,
  barrel: 1.4,
  crate: 1.4,
  bench: 1.4,
  fence: 1.5,
  stump: 1.5,
  sled: 1.5,
  'string-lights': 1.6,
  snowman: 1.5,
}

/** Props whose group ignores the placement's random scale (Structures.Knockable `fixed`). */
const FIXED_SCALE_PROPS: ReadonlySet<PropKind> = new Set<PropKind>(['footbridge', 'fenced-plot', 'watchtower', 'windmill', 'lamp'])

/** The whole group scale Structures.Knockable applies to a prop. */
export function propGroupScale(placement: Placement): number {
  const base = PROP_SCALE[placement.kind] ?? 1.3
  return FIXED_SCALE_PROPS.has(placement.kind) ? base : base * placement.scale
}

/** Radius of a pine trunk-plus-skirt a 4 m body cannot push through, per unit of pine scale. */
export const PINE_FOOTPRINT_R = 0.45

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

/** Rotate a local offset by the group yaw (three.js `rotation.y`): (lx cos + lz sin, −lx sin + lz cos). */
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

/* ---------- buildings ---------- */

/** Wall / deck footprints of each house kind at scale 1 (Props.tsx geometry). */
export function buildingFootprint(kind: BuildingKind, index: number): LocalShape[] {
  switch (kind as IceBuildingKind) {
    case 'stilt-house':
      // Plank deck 5.0 × 4.2 on posts, 1.3 m up: a body walks into its edge.
      return [box(0, 0, 2.5, 2.1)]
    case 'timber-house':
      return [box(0, 0, 0.9, 0.75)]
    case 'fishing-hut':
      // Walls 1.2 × 1.1 under a 1.4 × 1.3 snow slab.
      return [box(0, 0, 0.7, 0.65)]
    case 'forest-house': {
      const tall = index % 3 === 1
      const porch = index % 4 === 2
      const w = tall ? 4.6 : 4.2
      const d = tall ? 3.8 : 3.4
      const out: LocalShape[] = [box(0, 0, w / 2, d / 2)]
      if (porch) out.push(box(0, d / 2 + 1.1, w * 0.4, 1.0))
      return out
    }
    case 'tent':
      // Four-sided cone, radius 1.25, turned 45°: an axis-aligned square of half 1.25 / √2.
      return [box(0, 0, 0.884, 0.884)]
    case 'quonset':
      // Half-cylinder radius 0.95 lying along local x, 2.6 m long.
      return [box(0, 0, 1.3, 0.95)]
    default:
      return [box(0, 0, 1, 1)]
  }
}

/** District houses visible at the current progress, plus the glacier's extra tents at 100 %. */
export function buildingColliders(layout: BiomeLayout, progress: DistrictProgress): Collider[] {
  const out: Collider[] = []
  if (layout.world) return out
  for (const district of layout.districts) {
    const pop = populationFor(district, progress[district.id] ?? 0)
    const slots = districtSlots(layout, district)
    const scale = BUILDING_SCALE[district.building]
    for (const slot of slots.slice(0, pop.buildings)) {
      out.push(...placeShapes(buildingFootprint(district.building, slot.index), slot.position[0], slot.position[2], slot.yaw, scale, 'building', `building:${district.id}:${slot.index}`))
    }
    if (pop.extras && district.id === 'glacier') {
      for (const slot of slots) {
        out.push(...placeShapes(buildingFootprint('tent', slot.index + 1), slot.position[0] + 3.6, slot.position[2] - 2.8, slot.yaw + 0.5, 1.5, 'building', `building:${district.id}:extra:${slot.index}`))
      }
    }
  }
  return out
}

/* ---------- district anchors ---------- */

/** The anchor pieces Structures.Anchors places (gantry + icebreaker, sawmill, plaza, rink, spire, dish). */
export function anchorColliders(layout: BiomeLayout): Collider[] {
  const out: Collider[] = []
  if (layout.world) return out
  for (const district of layout.districts) {
    const [ax, az] = anchorPoint(layout, district)
    const [dx, dz] = laneDir(district)
    switch (district.id) {
      case 'harbour': {
        const fx = harbourFixtures(layout)
        // A-frame gantry 11.4 m along local x with legs splayed ±2.4 m; the skeleton hangs at 3.6 m.
        out.push(...placeShapes([box(0, 0, 5.7, 2.6)], ax, az, fx.gantryYaw, 1, 'anchor', 'anchor:harbour:gantry'))
        // Icebreaker hull: 5.2 m beam, transom at z −7.2, bow tip near z 7.4.
        out.push(...placeShapes([box(0, 0.1, 2.65, 7.3)], fx.icebreaker[0], fx.icebreaker[1], fx.icebreakerYaw, 1, 'anchor', 'anchor:harbour:icebreaker'))
        break
      }
      case 'forest': {
        const rd = riverDirAt(layout, ax, az)
        const yaw = Math.atan2(rd[1], -rd[0])
        // Sawmill deck 8 × 5.5 with the waterwheel dipping toward local +z.
        out.push(...placeShapes([box(0, 0, 4, 2.75), circle(1.6, 3.5, 1.7)], ax, az, yaw, 1, 'anchor', 'anchor:forest:sawmill'))
        break
      }
      case 'town': {
        // Plaza platform radius 3.8 at scale 1.6; frozen fountain radius 1.7 at scale 1.6, 8 m along the lane normal.
        out.push({ kind: 'circle', x: ax, z: az, r: 3.8 * 1.6, tag: 'anchor', id: 'anchor:town:plaza' })
        out.push({ kind: 'circle', x: ax - dz * 8, z: az + dx * 8, r: 1.7 * 1.6, tag: 'anchor', id: 'anchor:town:fountain' })
        break
      }
      case 'lake':
        // Skating ring: boards at radius 4.6 (half-length 0.6) at scale 1.5.
        out.push({ kind: 'circle', x: ax, z: az, r: 4.7 * 1.5, tag: 'anchor', id: 'anchor:lake:rink' })
        break
      case 'glacier':
        out.push({ kind: 'circle', x: ax, z: az, r: 0.9 * 1.6, tag: 'anchor', id: 'anchor:glacier:spire' })
        break
      case 'station':
        // Dish tower base 2.2 × 2.2 at scale 1.5 (the helipad is a 0.4 m slab bodies can step on).
        out.push(...placeShapes([box(0, 0, 1.1, 1.1)], ax, az, district.laneYaw, 1.5, 'anchor', 'anchor:station:dish'))
        break
    }
  }
  return out
}

/* ---------- props ---------- */

/** Local footprint of a prop at scale 1, before the Knockable group scale (`propGroupScale`). */
export function propFootprint(placement: Placement): LocalShape[] {
  const s = placement.scale
  switch (placement.kind) {
    case 'lamp':
      return [circle(0, 0, 0.12)]
    case 'fence':
      return [box(0, 0, 1.3, 0.06)]
    case 'fenced-plot':
      return [box(0, 0, 3, 2)]
    case 'footbridge':
      // A deck over the river, which the walkers never approach; walkable.
      return []
    case 'bench':
      return [box(0, 0, 0.65, 0.25)]
    case 'crate':
      return [box(0, 0, 0.31, 0.31)]
    case 'barrel':
      return [circle(0, 0, 0.32)]
    case 'snowman':
      return [circle(0, 0, 0.45)]
    case 'bare-tree':
      return [circle(0, 0, 0.25 * s)]
    case 'pine':
      return [circle(0, 0, PINE_FOOTPRINT_R * 1.2 * s)]
    case 'pine-trio':
      return [circle(0, 0, PINE_FOOTPRINT_R * 1.15 * s), circle(1.6 * s, 0.6 * s, PINE_FOOTPRINT_R * 0.85 * s), circle(-1.1 * s, 1.3 * s, PINE_FOOTPRINT_R * 0.65 * s)]
    case 'log-pile':
      return [box(0, 0, 0.6, 0.8)]
    case 'cart':
      return [box(0.1, 0, 0.95, 0.5)]
    case 'stump':
      return [circle(0, 0, 0.4)]
    case 'sawhorse':
      return [box(0, 0, 0.75, 0.3)]
    case 'sled':
      return [box(0, 0, 0.75, 0.35)]
    case 'fuel-drum':
      return [circle(0, 0, 0.33)]
    case 'boat':
      return [box(0, 0.3, 1.1, 2.6)]
    case 'flag':
      return [circle(0, 0, 0.1)]
    case 'crystal': {
      const k = s * 0.8
      return [circle(0, 0, 0.6 * k), circle(1.1 * k, 0.4 * k, 0.42 * k), circle(-0.8 * k, 0.9 * k, 0.36 * k)]
    }
    case 'boulder':
      return [circle(0, 0, 0.9 * s), circle(1.3 * s, 0.5 * s, 0.6 * s), circle(-0.9 * s, 0.9 * s, 0.5 * s)]
    case 'string-lights':
      return [circle(-1.6, 0, 0.1), circle(1.6, 0, 0.1)]
    case 'watchtower':
      // Four splayed legs; the cabin is 6 m up, so bodies pass between the legs.
      return [circle(-1.1, -1.1, 0.3), circle(1.1, -1.1, 0.3), circle(-1.1, 1.1, 0.3), circle(1.1, 1.1, 0.3)]
    case 'windmill':
      return [circle(0, 0, 2.0)]
    case 'helicopter':
      // Body ellipsoid 1.4 m long plus the tail boom to x −2.9; skids ±0.5 in z.
      return [box(-0.75, 0, 2.15, 0.85)]
    case 'antenna':
      return [circle(0, 0, 0.1)]
    case 'warm-tent':
      return [box(0, 0, 1.06, 1.06)]
  }
}

/** Every prop Structures.Districts shows at the current progress (band-gated like the meshes). */
export function propColliders(layout: BiomeLayout, seed: number, progress: DistrictProgress): Collider[] {
  const out: Collider[] = []
  if (layout.world) return out
  const bands = new Map<string, number>(layout.districts.map((district) => [district.id, populationFor(district, progress[district.id] ?? 0).band]))
  for (const placement of propPlacements(layout, seed)) {
    if (placement.minBand > (bands.get(placement.districtId) ?? 0)) continue
    out.push(...placeShapes(propFootprint(placement), placement.position[0], placement.position[2], placement.yaw, propGroupScale(placement), 'prop', `prop:${placement.districtId}:${placement.kind}:${placement.index}`))
  }
  return out
}

/** Buildings, anchors and props: what `<Districts>` registers. */
export function districtColliders(layout: BiomeLayout, seed: number, progress: DistrictProgress): Collider[] {
  return [...buildingColliders(layout, progress), ...anchorColliders(layout), ...propColliders(layout, seed, progress)]
}

/* ---------- docks ---------- */

/** Plank docks (`<Paths>`): a box from the quay root to the sea end, 3 m wide, 1 m above the water. */
export function dockColliders(layout: BiomeLayout, progress: DistrictProgress): Collider[] {
  const out: Collider[] = []
  if (layout.world) return out
  const bands = new Map<string, number>(layout.districts.map((district) => [district.id, populationFor(district, progress[district.id] ?? 0).band]))
  localPaths(layout)
    .filter((path) => path.kind === 'dock' && (bands.get(path.districtId) ?? 0) >= path.minBand)
    .forEach((path, i) => {
      const a = path.points[0]
      const b = path.points[path.points.length - 1]
      const dx = b[0] - a[0]
      const dz = b[2] - a[2]
      const len = Math.hypot(dx, dz)
      if (len < 1e-6) return
      // Local z runs along the deck (the plank yaw in Structures.Dock), local x across it.
      out.push({ kind: 'box', x: (a[0] + b[0]) / 2, z: (a[2] + b[2]) / 2, hx: path.width / 2, hz: len / 2, yaw: Math.atan2(dx, dz), tag: 'dock', id: `dock:${path.districtId}:${i}` })
    })
  return out
}

/* ---------- landmark ---------- */

/** The headland landmark at (x, z): the plinth, then the igloo / observatory / lighthouse of the stage. */
export function landmarkColliders(x: number, z: number, stage: LandmarkStage): Collider[] {
  const out: Collider[] = [{ kind: 'circle', x, z, r: 5.0, tag: 'landmark', id: 'landmark:plinth' }]
  if (stage === 's1') out.push({ kind: 'circle', x, z, r: 1.3 * 1.4, tag: 'landmark', id: 'landmark:igloo' })
  if (stage === 's2' || stage === 's3') {
    out.push({ kind: 'circle', x, z, r: stage === 's2' ? 1.9 : 1.5, tag: 'landmark', id: stage === 's2' ? 'landmark:observatory' : 'landmark:lighthouse' })
    out.push({ kind: 'circle', x: x + 2.6, z: z + 1.4, r: 1.3, tag: 'landmark', id: 'landmark:annex' })
  }
  return out
}

/* ---------- terrain: forest, scatter, landforms ---------- */

/** Instanced forest pines (`<Forest>`): one circle per trunk, r = 0.45 × tree scale. */
export function forestColliders(trees: readonly Tree[]): Collider[] {
  return trees.map((tree, i) => ({ kind: 'circle', x: tree.x, z: tree.z, r: PINE_FOOTPRINT_R * tree.scale, tag: 'forest', id: `forest:${i}` }))
}

/** Ambient groves and rock outcrops (`<Scatter>`), offsets turned by the cluster yaw like the meshes. */
export function scatterColliders(items: readonly Scatter[]): Collider[] {
  const out: Collider[] = []
  items.forEach((cluster, i) => {
    cluster.items.forEach((item, j) => {
      const [x, z] = worldFromLocal(cluster.position[0], cluster.position[2], cluster.yaw, item.dx, item.dz)
      const r = cluster.kind === 'grove' ? PINE_FOOTPRINT_R * 1.2 * item.scale : 1.1 * item.scale
      out.push({ kind: 'circle', x, z, r, tag: 'scatter', id: `scatter:${cluster.kind}:${i}:${j}` })
    })
  })
  return out
}

/** The ice arch's legs and the ice cave's dome, mouth and rock (`<Landforms>`). */
export function landformColliders(layout: BiomeLayout): Collider[] {
  if (layout.world) return []
  const out: Collider[] = []
  const arch = layout.iceArch
  const half = arch.span * 0.5
  out.push(
    ...placeShapes(
      [circle(-half, 0, arch.span * 0.2), circle(half, 0, arch.span * 0.2), circle(-half - 1.2, 1.0, arch.span * 0.11), circle(half + 1.2, 1.0, arch.span * 0.11)],
      arch.center[0],
      arch.center[1],
      arch.yaw,
      1,
      'landform',
      'landform:arch',
    ),
  )
  const { center: oc, radius: orad, caveYaw } = layout.outcrop
  const cx = oc[0] + Math.sin(caveYaw) * orad * 0.62
  const cz = oc[1] + Math.cos(caveYaw) * orad * 0.62
  out.push(...placeShapes([circle(0, -0.6, 2.2), circle(0, 0.9, 1.3), circle(1.6, 1.4, 0.7)], cx, cz, caveYaw, 1, 'landform', 'landform:cave'))
  return out
}

/* ---------- the whole land ---------- */

/**
 * Everything the Ice scene registers, from the same data, for tests and tooling. The landmark
 * sits at the headland centre (BiomeScene) at the stage of the course fraction.
 */
export function iceLandColliders(layout: BiomeLayout, seed: number, progress: DistrictProgress): Collider[] {
  const fraction = courseProgress(layout, progress)
  const [hx, hz] = layout.headland.center
  return [
    ...districtColliders(layout, seed, progress),
    ...dockColliders(layout, progress),
    ...landmarkColliders(hx, hz, landmarkStage(fraction)),
    ...forestColliders(forestPines(layout, seed)),
    ...scatterColliders(ambientScatter(layout, seed)),
    ...landformColliders(layout),
  ]
}
