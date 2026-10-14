/**
 * Collider footprints for the frontier land, derived from the same placement tables the scene
 * maps over (../layout/placements.ts) and the same generated district transforms, so a mesh and
 * its collider cannot drift apart. Shapes are circles and oriented boxes in world XZ (the shared
 * collision API in ../../collision); heights do not matter on a flat plate. Band-gated exactly
 * like the meshes: a prop that is not shown has no collider.
 */
import type { Collider } from '../../collision/colliders'
import { type DistrictTransform, type DistrictProgress, type generateLayout, courseProgress, landmarkStage, populationFor } from '../layout/biome-layout'
import { DIG, type FrontKind, LANDMARK_RISE, MINE, RAILWAY, RANCH, RESERVE, TELEGRAPH_LINE, TOWN, frontWidth, reserveItemMinCount, reserveItems } from '../layout/placements'

type Generated = ReturnType<typeof generateLayout>

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
  yaw?: number
}

type LocalShape = LocalCircle | LocalBox

const circle = (lx: number, lz: number, r: number): LocalCircle => ({ kind: 'circle', lx, lz, r })
const box = (lx: number, lz: number, hx: number, hz: number, yaw = 0): LocalBox => ({ kind: 'box', lx, lz, hx, hz, yaw })

/** three.js `rotation.y = yaw`: world = centre + (lx cos + lz sin, −lx sin + lz cos). */
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

/** A nested group: shapes in the item's frame → the district frame → world. */
function nested(shapes: readonly LocalShape[], item: { x: number; z: number; yaw?: number; scale?: number }, d: DistrictTransform, tag: string, id: string): Collider[] {
  const yaw = item.yaw ?? 0
  const scale = item.scale ?? 1
  const inDistrict: LocalShape[] = shapes.map((s) => {
    const [lx, lz] = worldFromLocal(item.x, item.z, yaw, s.lx, s.lz, scale)
    if (s.kind === 'circle') return circle(lx, lz, s.r * scale)
    return box(lx, lz, s.hx * scale, s.hz * scale, yaw + (s.yaw ?? 0))
  })
  return placeShapes(inDistrict, d.center[0], d.center[1], d.yaw, 1, tag, id)
}

/* ---------- local footprints of the shared props ---------- */

/** FalseFront: body `w` × 5.4 plus the awning overhang, three porch posts, the saloon's balcony posts, the hotel's stair tower. */
export function falseFrontFootprint(variant: FrontKind): LocalShape[] {
  const w = frontWidth(variant)
  const out: LocalShape[] = [box(0, 0, w / 2 + 0.4, 2.7)]
  for (const x of [-w * 0.4, 0, w * 0.4]) out.push(circle(x, 3.25, 0.25))
  if (variant === 'saloon') for (const x of [-w * 0.43, w * 0.43]) out.push(circle(x, 3.7, 0.2))
  if (variant === 'hotel') out.push(box(w / 2 + 0.7, 0.4, 0.55, 0.55))
  return out
}

/** Wagon: bed 4.2 × 2.4 and the shafts out to x ≈ 4.5. */
const WAGON: LocalShape[] = [box(0, 0, 2.1, 1.2), box(3.2, 0, 1.35, 0.9)]
const TROUGH: LocalShape[] = [box(0, 0, 2.25, 0.85)]
/** Animal: body 3.4 m long on local x, head at +1.55. */
const ANIMAL: LocalShape[] = [box(0.15, 0, 1.95, 0.9)]
/** Unit-scale plant and rock footprints; the group scale is applied by `nested`. Cactus arms reach x ±1.5 at head height. */
const CACTUS: LocalShape[] = [circle(0.1, 0, 1.55)]
const PRICKLY_PEAR: LocalShape[] = [circle(0, 0, 1.25)]
const SCRUB: LocalShape[] = [circle(0, 0.25, 1.35)]
const ROCK_OUTCROP: LocalShape[] = [circle(0, 0, 1.9), circle(1.5, 0.5, 1.1), circle(-1.2, 0.8, 0.85)]
/** Tumbleweeds are light: the circle is the torus core, not its full reach, so one at the kerb leaves the street open. */
const TUMBLEWEED: LocalShape[] = [circle(0, 0, 0.85)]
/** Four-sided cone tent of radius r turned 45°: an axis-aligned square of half r / √2. */
const tent = (r: number): LocalShape[] => [box(0, 0, r * 0.707, r * 0.707)]

/** Corral: sixteen rail segments between the posts (rails at 1 and 2 m block a body). */
function corral(radius: number): LocalShape[] {
  const out: LocalShape[] = []
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2
    const a1 = ((i + 1) / 16) * Math.PI * 2
    const mx = (Math.cos(a0) + Math.cos(a1)) / 2
    const mz = (Math.sin(a0) + Math.sin(a1)) / 2
    const half = Math.hypot(Math.cos(a1) - Math.cos(a0), Math.sin(a1) - Math.sin(a0)) * radius * 0.5
    // Segment direction in XZ is (dx, dz); a box with local x along it has rotation.y = atan2(−dz, dx).
    const dx = Math.cos(a1) - Math.cos(a0)
    const dz = Math.sin(a1) - Math.sin(a0)
    out.push(box(mx * radius, mz * radius, half + 0.1, 0.15, Math.atan2(-dz, dx)))
  }
  return out
}

/** Fence run of `length` along local x. */
const fence = (length: number): LocalShape[] => [box(0, 0, length / 2 + 0.1, 0.15)]

/* ---------- districts ---------- */

export function townColliders(d: DistrictTransform, count: number): Collider[] {
  const out: Collider[] = []
  const id = (s: string) => `town:${s}`
  out.push(...nested([box(0, 0, 2.85, 2.85)], TOWN.waterTower, d, 'anchor', id('water-tower')))
  TOWN.slots.slice(0, count).forEach((slot, i) => out.push(...nested(falseFrontFootprint(slot.variant), slot, d, 'building', id(`front:${i}`))))
  for (const w of TOWN.wagons) if (count >= w.minCount) out.push(...nested(WAGON, w, d, 'prop', id(`wagon:${w.x}`)))
  for (const t of TOWN.troughs) if (count >= t.minCount) out.push(...nested(TROUGH, t, d, 'prop', id(`trough:${t.x}`)))
  if (count >= 12) {
    const hall = TOWN.civicHall
    out.push(...nested([box(0, 0, 5, 4), circle(-3.2, 4.2, 0.2), circle(3.2, 4.2, 0.2)], hall, d, 'building', id('civic-hall')))
    for (const s of TOWN.sheds) out.push(...nested([box(0, 0, 2.7, 2.3)], s, d, 'building', id(`shed:${s.x}`)))
    for (const h of TOWN.hitches) out.push(...nested([box(0, 0, 1.4, 0.12)], h, d, 'prop', id(`hitch:${h.x}`)))
    for (const l of TOWN.lamps) out.push(...nested([circle(0, 0, 0.12)], l, d, 'prop', id(`lamp:${l.x}`)))
    for (const h of TOWN.horses) out.push(...nested(ANIMAL, h, d, 'animal', id(`horse:${h.x}`)))
    for (const t of TOWN.tumbleweeds) out.push(...nested(TUMBLEWEED, t, d, 'prop', id(`tumbleweed:${t.x}`)))
    for (const p of TOWN.posts) out.push(...nested([circle(0, 0, 0.1)], p, d, 'prop', id(`post:${p.x}`)))
  }
  return out
}

export function railwayColliders(d: DistrictTransform, count: number): Collider[] {
  const out: Collider[] = []
  const id = (s: string) => `railway:${s}`
  out.push(...nested([box(0, 0, RAILWAY.depot.w / 2, RAILWAY.depot.d / 2)], RAILWAY.depot, d, 'building', id('depot')))
  out.push(...nested([box(0, 0, RAILWAY.freightShed.w / 2, RAILWAY.freightShed.d / 2)], RAILWAY.freightShed, d, 'building', id('freight-shed')))
  for (const c of RAILWAY.depotCrates) out.push(...nested([box(0, 0, c.w / 2, c.d / 2)], c, d, 'prop', id(`crate:${c.x}`)))
  for (const p of RAILWAY.canopyPosts) out.push(...nested([circle(0, 0, 0.26)], p, d, 'prop', id(`canopy-post:${p.z}`)))
  out.push(...nested([circle(0, 0, 2.75)], RAILWAY.waterCrane, d, 'anchor', id('water-crane')))
  out.push(...nested([circle(0, 0, 0.2)], RAILWAY.signalMast, d, 'anchor', id('signal-mast')))
  if (count >= RAILWAY.crateStack.minCount) out.push(...nested([box(0, 0, RAILWAY.crateStack.w / 2, RAILWAY.crateStack.d / 2)], RAILWAY.crateStack, d, 'prop', id('crate-stack')))
  if (count >= RAILWAY.wagon.minCount) out.push(...nested(WAGON, RAILWAY.wagon, d, 'prop', id('wagon')))
  if (count >= RAILWAY.shed.minCount) out.push(...nested([box(0, 0, RAILWAY.shed.w / 2, RAILWAY.shed.d / 2)], RAILWAY.shed, d, 'building', id('shed')))
  if (count >= RAILWAY.caboose.minCount) out.push(...nested([box(0, 0, RAILWAY.caboose.w / 2, RAILWAY.caboose.d / 2)], RAILWAY.caboose, d, 'prop', id('caboose')))
  return out
}

export function ranchColliders(d: DistrictTransform, count: number): Collider[] {
  const out: Collider[] = []
  const id = (s: string) => `ranch:${s}`
  out.push(...nested([box(0, 0, 1.8, 1.8)], RANCH.windPump, d, 'anchor', id('wind-pump')))
  for (const c of RANCH.corrals) if (count >= c.minCount) out.push(...nested(corral(c.radius), c, d, 'fence', id(`corral:${c.x}`)))
  if (count >= RANCH.house.minCount) out.push(...nested(falseFrontFootprint('store'), RANCH.house, d, 'building', id('house')))
  if (count >= RANCH.barn.minCount) out.push(...nested([box(0, 0, RANCH.barn.w / 2, RANCH.barn.d / 2)], RANCH.barn, d, 'building', id('barn')))
  for (const f of RANCH.fences) if (count >= f.minCount) out.push(...nested(fence(f.length), f, d, 'fence', id(`fence:${f.x}:${f.z}`)))
  for (const a of RANCH.cattle) if (count >= a.minCount) out.push(...nested(ANIMAL, a, d, 'animal', id(`cow:${a.x}`)))
  for (const a of RANCH.horses) if (count >= a.minCount) out.push(...nested(ANIMAL, a, d, 'animal', id(`horse:${a.x}`)))
  if (count >= 4) {
    out.push(...nested(WAGON, RANCH.wagon, d, 'prop', id('wagon')))
    out.push(...nested(TROUGH, RANCH.trough, d, 'prop', id('trough')))
    for (const h of RANCH.hay) out.push(...nested([box(0, 0, 1.25, 1.15)], h, d, 'prop', id(`hay:${h.x}`)))
    out.push(...nested([box(0, 0, RANCH.shed.w / 2, RANCH.shed.d / 2)], RANCH.shed, d, 'building', id('shed')))
  }
  return out
}

export function mineColliders(d: DistrictTransform, count: number): Collider[] {
  const out: Collider[] = []
  const id = (s: string) => `mine:${s}`
  // The rock with the adit mouth on its east face.
  out.push(...nested([box(0.5, 0, MINE.rock.w / 2 + 0.5, MINE.rock.d / 2)], MINE.rock, d, 'landform', id('rock')))
  out.push(...nested([box(0, 0, MINE.headframe.baseW / 2, MINE.headframe.baseD / 2)], MINE.headframe, d, 'anchor', id('headframe')))
  if (count >= MINE.boiler.minCount) {
    out.push(...nested([circle(0, 0, MINE.boiler.radius)], MINE.boiler, d, 'prop', id('boiler')))
    out.push(...nested([box(0, 0, MINE.shed.w / 2, MINE.shed.d / 2)], MINE.shed, d, 'building', id('shed')))
  }
  for (const c of MINE.carts) if (count >= c.minCount) out.push(...nested([box(0, 0, c.w / 2, c.d / 2)], c, d, 'prop', id(`cart:${c.x}`)))
  for (const t of MINE.tailings) if (count >= t.minCount) out.push(...nested([circle(0, 0, t.radius * 0.85)], t, d, 'prop', id(`tailings:${t.x}`)))
  for (const t of MINE.tents) if (count >= t.minCount) out.push(...nested(tent(3.8), t, d, 'building', id(`tent:${t.x}`)))
  if (count >= MINE.assay.minCount) out.push(...nested([box(0, 0, MINE.assay.w / 2, MINE.assay.d / 2)], MINE.assay, d, 'building', id('assay')))
  return out
}

export function digColliders(d: DistrictTransform, count: number): Collider[] {
  const out: Collider[] = []
  const id = (s: string) => `dig:${s}`
  for (const f of DIG.foundations) if (count >= f.minCount) out.push(...nested([box(0, 0, f.w / 2 + 0.4, f.d / 2 + 0.4)], f, d, 'landform', id(`foundation:${f.x}:${f.z}`)))
  for (const t of DIG.trenches) out.push(...nested([box(0, 0, t.w / 2 + 0.6, t.d / 2 + 0.6)], t, d, 'landform', id(`trench:${t.x}`)))
  for (const t of DIG.tents) if (count >= t.minCount) out.push(...nested(tent(5), t, d, 'building', id(`tent:${t.x}`)))
  if (count >= DIG.table.minCount) {
    out.push(...nested([box(0, 0, DIG.table.w / 2, DIG.table.d / 2)], DIG.table, d, 'prop', id('table')))
    for (const c of DIG.crates) out.push(...nested([box(0, 0, c.w / 2, c.d / 2)], c, d, 'prop', id(`crate:${c.x}`)))
  }
  if (count >= DIG.scaffold.minCount) {
    const legs: LocalShape[] = []
    for (const x of DIG.scaffold.legs) for (const z of DIG.scaffold.legsZ) legs.push(circle(x, z, 0.2))
    out.push(...nested(legs, DIG.scaffold, d, 'prop', id('scaffold')))
  }
  if (count >= 8) {
    for (const s of DIG.spoil) out.push(...nested([circle(0, 0, s.radius * 0.85)], s, d, 'prop', id(`spoil:${s.x}`)))
    out.push(...nested([box(0, 0, DIG.sortingTable.w / 2, DIG.sortingTable.d / 2)], DIG.sortingTable, d, 'prop', id('sorting-table')))
    for (const b of DIG.barrels) out.push(...nested([circle(0, 0, b.radius + 0.05)], b, d, 'prop', id(`barrel:${b.x}`)))
    out.push(...nested(WAGON, DIG.wagon, d, 'prop', id('wagon')))
  }
  return out
}

export function reserveColliders(d: DistrictTransform, seed: number, count: number, wildlife: boolean): Collider[] {
  const out: Collider[] = []
  const id = (s: string) => `reserve:${s}`
  for (const c of RESERVE.cacti) out.push(...nested(CACTUS, c, d, 'plant', id(`cactus:${c.x}`)))
  for (const item of reserveItems(seed)) {
    const minCount = reserveItemMinCount(item.kind)
    if (minCount === null || count < minCount) continue
    // Same group scales as the scene: rocks at 0.8 × s, tumbleweeds at 0.7 × s.
    const [shapes, scale] =
      item.kind === 0
        ? [CACTUS, item.s]
        : item.kind === 1 || item.kind === 2
          ? [PRICKLY_PEAR, item.s]
          : item.kind === 3 || item.kind === 4
            ? [SCRUB, item.s]
            : item.kind === 5 || item.kind === 6
              ? [ROCK_OUTCROP, item.s * 0.8]
              : [TUMBLEWEED, item.s * 0.7]
    out.push(...nested(shapes, { x: item.x, z: item.z, scale }, d, item.kind <= 4 ? 'plant' : 'prop', id(`item:${item.index}`)))
  }
  out.push(...nested([circle(0, 0, RESERVE.tank.radius)], RESERVE.tank, d, 'anchor', id('tank')))
  for (const p of RESERVE.telegraph) out.push(...nested([circle(0, 0, 0.18)], p, d, 'prop', id(`telegraph:${p.z}`)))
  if (wildlife && count >= 1) for (const a of RESERVE.wildlife) out.push(...nested(ANIMAL, a, d, 'animal', id(`animal:${a.x}:${a.z}`)))
  if (count >= 4) {
    out.push(...nested([circle(-4, 0, 2.9), circle(4, 0, 2.6)], RESERVE.formation, d, 'landform', id('formation')))
    out.push(...nested([circle(0, 0, 5.1)], RESERVE.stack, d, 'landform', id('stack')))
    for (const w of RESERVE.washes) {
      out.push(...nested(PRICKLY_PEAR, { x: w.x - 4, z: w.z + 1, scale: 0.8 }, d, 'plant', id(`wash:${w.z}:pear`)))
      out.push(...nested(SCRUB, { x: w.x + 4, z: w.z - 1, scale: 0.9 }, d, 'plant', id(`wash:${w.z}:scrub`)))
    }
  }
  return out
}

/* ---------- fixed pieces ---------- */

export function fixedColliders(fraction: number): Collider[] {
  const out: Collider[] = []
  const stage = landmarkStage(fraction)
  out.push({ kind: 'circle', x: LANDMARK_RISE.x, z: LANDMARK_RISE.z, r: LANDMARK_RISE.radius, tag: 'landmark', id: 'landmark:rise' })
  if (stage === 's2' || stage === 's3') for (const dx of [-2.5, 2.5]) for (const dz of [-2.5, 2.5]) out.push({ kind: 'circle', x: LANDMARK_RISE.x + dx, z: LANDMARK_RISE.z + dz, r: 0.3, tag: 'landmark', id: `landmark:leg:${dx}:${dz}` })
  TELEGRAPH_LINE.forEach((p, i) => out.push({ kind: 'circle', x: p.x, z: p.z, r: 0.18, tag: 'prop', id: `telegraph-line:${i}` }))
  return out
}

/* ---------- the whole land ---------- */

export function districtColliders(d: DistrictTransform, seed: number, count: number, wildlife: boolean): Collider[] {
  switch (d.id) {
    case 'main-town':
      return townColliders(d, count)
    case 'railway-station':
      return railwayColliders(d, count)
    case 'outskirts-reserve':
      return reserveColliders(d, seed, count, wildlife)
    case 'broad-ranch':
      return ranchColliders(d, count)
    case 'mine-works':
      return mineColliders(d, count)
    case 'archaeology-dig':
      return digColliders(d, count)
  }
}

/** Everything the frontier scene registers, from the same data, for tests and tooling. */
export function frontierColliders(generated: Generated, progress: DistrictProgress, wildlife = true): Collider[] {
  const out: Collider[] = []
  for (const d of generated.districts) {
    const pop = populationFor(d, progress[d.id] ?? 0)
    out.push(...districtColliders(d, generated.seed, pop.buildings, wildlife))
  }
  out.push(...fixedColliders(courseProgress(progress)))
  return out
}

/** Road centrelines (world xz) the walkers use and no collider may cross: Main Street's spine east of the water tower. */
export function roadCentrelines(generated: Generated): Array<{ id: string; a: [number, number]; b: [number, number] }> {
  const town = generated.districts.find((d) => d.id === 'main-town')!
  const [ax, az] = worldFromLocal(town.center[0], town.center[1], town.yaw, TOWN.waterTower.x + 4.2, 0)
  const [bx, bz] = worldFromLocal(town.center[0], town.center[1], town.yaw, TOWN.road.x + TOWN.road.w / 2, 0)
  return [{ id: 'main-street', a: [ax, az], b: [bx, bz] }]
}
