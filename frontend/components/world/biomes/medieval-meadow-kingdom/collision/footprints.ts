/**
 * Collider footprints for the meadow kingdom, derived from the same pure placement data the meshes
 * are placed from (`buildingSlots`, `districtAnchor`, `authoredDistrictDetails`, `treePlacements`,
 * `ambientPlacements`, `animalPlacements`, the layout's bridges, the Green Crown, the landmark), so
 * the shapes cannot drift from the geometry. `<LandColliders>` registers the union once; the vitest
 * walker simulation builds the same union with `meadowLandColliders`.
 *
 * Footprints are metres in each object's local frame (see scene/Props.tsx, Structures.tsx,
 * Landmark.tsx for the geometry) and are rotated into world XZ exactly as the groups are.
 */
import {
  GREEN_CROWN,
  type DistrictDef,
  type DistrictProgress,
  type GeneratedKingdom,
  type GreenCrownProfile,
  type LandmarkStage,
  populationFor,
} from '../layout/biome-layout'
import {
  type AmbientPlacement,
  type AnimalPlacement,
  type TreePlacement,
  ambientPlacements,
  animalPlacements,
  authoredDistrictDetails,
  buildingSlots,
  districtAnchor,
  treePlacements,
} from '../layout/terrain'
import type { Collider } from '../../collision/colliders'

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

/* ---------- houses, sheds, stalls ---------- */

/** `House` walls plus the corner posts (Props.tsx): width 4.4 + (v % 2) · 1.1, depth 3.6 + ((v + 1) % 3) · 0.45. */
export function houseFootprint(variant: number): LocalShape[] {
  const width = 4.4 + (variant % 2) * 1.1
  const depth = 3.6 + ((variant + 1) % 3) * 0.45
  return [box(0, 0, width / 2 + 0.14, depth / 2 + 0.1)]
}

export function workShedFootprint(): LocalShape[] {
  return [box(0, 0, 2.75, 2.0)]
}

export function marketStallFootprint(): LocalShape[] {
  return [box(0, 0, 2.1, 1.4)]
}

/** District houses, sheds and stalls visible at the current progress. */
export function buildingColliders(layout: GeneratedKingdom, progress: DistrictProgress): Collider[] {
  const out: Collider[] = []
  for (const district of layout.districts) {
    const population = populationFor(district, progress[district.id] ?? 0)
    const slots = buildingSlots(layout, district).slice(0, population.buildings)
    for (const slot of slots) {
      const shapes =
        district.id === 'bridge-market'
          ? marketStallFootprint()
          : district.id === 'forest-hamlet' && slot.index % 3 === 0
            ? workShedFootprint()
            : houseFootprint(slot.variant)
      out.push(...placeShapes(shapes, slot.position[0], slot.position[2], slot.yaw, 1, 'building', `building:${district.id}:${slot.index}`))
    }
  }
  return out
}

/* ---------- district anchors and growth props ---------- */

/** The anchor pieces `DistrictAnchor` places: great oak, mill with its wheel, windmill. */
export function anchorColliders(layout: GeneratedKingdom): Collider[] {
  const out: Collider[] = []
  for (const district of layout.districts) {
    const [ax, , az] = districtAnchor(layout, district)
    switch (district.id) {
      case 'forest-hamlet':
        // GreatOak: RoundTree at scale 1.7, oak trunk 0.7 at the foot.
        out.push(...placeShapes([circle(0, 0, 1.25)], ax, az, district.yaw, 1, 'anchor', 'anchor:forest-hamlet:oak'))
        break
      case 'river-village':
        // Mill house 7 × 5 and the wheel standing in the x = 4 plane, dipping to the ground.
        out.push(...placeShapes([box(0, 0, 3.5, 2.5), box(4, 0, 0.3, 2.7)], ax, az, district.yaw, 1, 'anchor', 'anchor:river-village:mill'))
        break
      case 'farm-common':
        // Windmill tower, 2.7 m at the foot.
        out.push(...placeShapes([circle(0, 0, 2.75)], ax, az, district.yaw, 1, 'anchor', 'anchor:farm-common:windmill'))
        break
      default:
        break
    }
  }
  return out
}

/** Local footprints of the `GrowthProps` pieces by detail kind (Structures.tsx), for the band they appear at. */
export function detailFootprint(districtId: DistrictDef['id'], kind: string, band: number): LocalShape[] {
  switch (`${districtId}/${kind}`) {
    case 'forest-hamlet/sawyard':
      return band >= 1 ? [box(0, 0, 7, 4.5)] : []
    case 'forest-hamlet/log-stacks':
      return band >= 1 ? [box(0, 0, 3.1, 2.2)] : []
    case 'river-village/landing':
      return band >= 1 ? [box(0, 0, 3.75, 1.6)] : []
    case 'river-village/millrace':
      return band >= 1 ? [box(0, 0, 4.5, 1.2)] : []
    case 'river-village/kitchen-gardens':
      return band >= 2 ? [box(0, 0, 3.85, 2.4)] : []
    case 'bridge-market/market-stalls': {
      if (band < 1) return []
      // MarketAnchor: fountain at the centre, three canopy tables 5 m out at 0°, 120°, 240°, each turned −angle.
      const shapes: LocalShape[] = [circle(0, 0, 1.75)]
      for (let index = 0; index < 3; index++) {
        const angle = (index / 3) * Math.PI * 2
        shapes.push(box(Math.cos(angle) * 5, Math.sin(angle) * 5, 1.7, 1.1, -angle))
      }
      return shapes
    }
    case 'bridge-market/guild-hall':
      return band >= 1 ? [box(0, 0, 5.5, 3.25)] : []
    case 'farm-common/l-barn':
      // Barn 8 × 5 and the second barn at (4.2, −3.6), turned 90°, scaled 0.78.
      return band >= 1 ? [box(0, 0, 4, 2.5), box(4.2, -3.6, 4 * 0.78, 2.5 * 0.78, Math.PI / 2)] : []
    case 'farm-common/orchard':
      return band >= 2 ? [-4, 0, 4].flatMap((x) => [-3, 1.5].map((z) => circle(x, z, 0.28))) : []
    case 'farm-common/hedges':
      return band >= 2 ? [box(0, 0, 7, 0.55), box(-7, 4, 4, 0.55, Math.PI / 2)] : []
    default:
      // Crop strips are 15 cm slabs a body steps over; castle-court details are inside the plinth.
      return []
  }
}

export function detailColliders(layout: GeneratedKingdom, progress: DistrictProgress): Collider[] {
  const out: Collider[] = []
  for (const district of layout.districts) {
    const band = populationFor(district, progress[district.id] ?? 0).band
    for (const detail of authoredDistrictDetails(district)) {
      const shapes = detailFootprint(district.id, detail.kind, band)
      if (shapes.length === 0) continue
      out.push(...placeShapes(shapes, detail.position[0], detail.position[2], detail.yaw, 1, 'detail', `detail:${district.id}:${detail.kind}`))
    }
  }
  return out
}

/* ---------- bridges ---------- */

/** Bridge rails (`Bridge`): two 0.22 m beams at ±width / 2, 92 % of the span; the deck itself is walkable. */
export function bridgeColliders(layout: GeneratedKingdom): Collider[] {
  const out: Collider[] = []
  for (const bridge of layout.bridges) {
    const [length, width] = bridge.size
    const yaw = (bridge.yaw * Math.PI) / 180
    out.push(
      ...placeShapes(
        [box(0, -width / 2, length * 0.46, 0.11), box(0, width / 2, length * 0.46, 0.11)],
        bridge.center[0],
        bridge.center[1],
        yaw,
        1,
        'bridge-rail',
        `bridge:${bridge.id}`,
      ),
    )
  }
  return out
}

/* ---------- landmark ---------- */

/** The castle headland at (x, z): the plinth, then the gatehouse, towers, walls, halls and fountain of the stage. */
export function landmarkColliders(x: number, z: number, stage: LandmarkStage): Collider[] {
  const shapes: LocalShape[] = [circle(0, 0, 17)]
  if (stage === 'stake') shapes.push(circle(0, 0, 0.2))
  else {
    shapes.push(box(0, 7, 4.25, 2.7), circle(-6.8, 7, 2.8), box(-11.5, 0, 0.6, 7.5), box(11.5, 0, 0.6, 7.5))
    if (stage !== 's1') shapes.push(circle(6.8, 7, 2.8))
    if (stage === 's2' || stage === 's3') shapes.push(box(-7.3, -7.5, 4.6, 2.7), box(0, -11.5, 12, 0.6))
    if (stage === 's3') shapes.push(box(7.4, -7.8, 4.25, 2.5), circle(0, -1.6, 2.75))
  }
  return placeShapes(shapes, x, z, 0, 1, 'landmark', 'landmark:castle')
}

/* ---------- terrain: woodland, scatter, crown, animals ---------- */

/** Woodland trees (`Woodland`): one circle per trunk foot (oak 0.7, round 0.42) × scale. */
export function treeColliders(trees: readonly TreePlacement[]): Collider[] {
  return trees.map((tree, i) => ({ kind: 'circle', x: tree.position[0], z: tree.position[2], r: (tree.crown === 'oak' ? 0.75 : 0.45) * tree.scale, tag: 'tree', id: `tree:${i}` }))
}

/** Ambient scatter (`MeadowScatter`): haystacks and rocks block; flowers and reeds are walked through. */
export function scatterColliders(items: readonly AmbientPlacement[]): Collider[] {
  const out: Collider[] = []
  items.forEach((item, i) => {
    if (item.kind === 'hay') out.push({ kind: 'circle', x: item.position[0], z: item.position[2], r: 0.72 * item.scale, tag: 'scatter', id: `scatter:hay:${i}` })
    else if (item.kind === 'rocks') out.push({ kind: 'circle', x: item.position[0], z: item.position[2], r: 0.8 * item.scale, tag: 'scatter', id: `scatter:rock:${i}` })
  })
  return out
}

/** Green Crown hills (`GreenCrown`): the hill body as an oriented box (dodecahedron scaled 2.25 × 1.5 in XZ, inscribed). */
export function crownColliders(profile: GreenCrownProfile): Collider[] {
  const out: Collider[] = []
  GREEN_CROWN.slice(0, profile.crowns).forEach((crown, index) => {
    if (crown.row === 2 && !profile.secondRow) return
    const wingFade = 1 - (Math.abs(crown.position[0]) / 132) * 0.28
    const baseHeight = profile.height * (crown.row === 1 ? 0.7 : 0.92) * (0.82 + (index % 5) * 0.045) * wingFade
    const hillRadius = Math.max(3.2, baseHeight * 0.34)
    out.push({ kind: 'box', x: crown.position[0], z: crown.position[1], hx: hillRadius * 2.25 * 0.9, hz: hillRadius * 1.5 * 0.9, yaw: crown.phase * Math.PI * 2, tag: 'crown', id: crown.id })
  })
  return out
}

/** Farm animals (`Animal`): body width 1.35 × 0.62 × size × scale. */
export function animalColliders(animals: readonly AnimalPlacement[]): Collider[] {
  return animals.map((animal, i) => {
    const size = animal.kind === 'cow' ? 1.5 : animal.kind === 'sheep' ? 1.05 : 0.48
    return { kind: 'circle', x: animal.position[0], z: animal.position[2], r: 0.62 * 1.35 * size * animal.scale * 0.95, tag: 'animal', id: `animal:${animal.kind}:${i}` }
  })
}

/* ---------- the whole land ---------- */

/**
 * Everything the meadow scene registers, from the same data, for tests and tooling. The landmark
 * sits at the generated castle position at the stage of the course fraction.
 */
export function meadowLandColliders(layout: GeneratedKingdom, seed: number, progress: DistrictProgress, stage: LandmarkStage, crown: GreenCrownProfile): Collider[] {
  return [
    ...buildingColliders(layout, progress),
    ...anchorColliders(layout),
    ...detailColliders(layout, progress),
    ...bridgeColliders(layout),
    ...landmarkColliders(layout.landmark.position[0], layout.landmark.position[1], stage),
    ...treeColliders(treePlacements(layout, seed)),
    ...scatterColliders(ambientPlacements(layout, seed)),
    ...crownColliders(crown),
    ...animalColliders(animalPlacements(layout, seed)),
  ]
}
