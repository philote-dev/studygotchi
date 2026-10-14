import { describe, expect, it } from 'vitest'
import { buildColliderSet, penetrationDepth } from '../../collision/colliders'
import { landFootprints } from '../collision/footprints'
import { LOOK_BOX } from '../camera/stations'
import { NORDIC_LAYOUT as L, generateDistricts } from './biome-layout'
import { dressing, dressingColliders, houseChimneys, mossHummocksOnLand } from './dressing'
import { LANDMARKS, landmarkColliders } from './landmarks'
import { shapesOverlap } from './landmarks.test'
import { CROSSINGS, LANES, PATH_NODES, STREAMS, lanesAt, node, onCrossing, onStream, sampleLane } from './paths'
import { landColliders } from './placements'
import { isLandAt } from './terrain'

const SEED = 7
const full = Object.fromEntries(L.districts.map((d) => [d.id, 1]))
const authored = landColliders(L, SEED, full)
const yards = generateDistricts(L, SEED).map((d) => ({ x: d.center[0], z: d.center[1], r: d.footprintRadius + 14 }))
yards.push({ x: L.landmark.center[0], z: L.landmark.center[1], r: 26 })
const inYard = (x: number, z: number) => yards.some((y) => Math.hypot(x - y.x, z - y.z) < y.r)

describe('paths: the lane network', () => {
  it('joins every place: each node has a lane, each lane ends on its nodes, and each bank is connected', () => {
    for (const n of PATH_NODES) expect(lanesAt(n.id).length, `${n.id} has no lane`).toBeGreaterThanOrEqual(1)
    for (const lane of LANES) {
      expect(lane.points[0]).toEqual(node(lane.from).at)
      expect(lane.points[lane.points.length - 1]).toEqual(node(lane.to).at)
    }
    for (const bank of ['west', 'east'] as const) {
      const lanes = LANES.filter((l) => l.bank === bank)
      const nodes = new Set(lanes.flatMap((l) => [l.from, l.to]))
      const seen = new Set<string>([lanes[0].from])
      let grew = true
      while (grew) {
        grew = false
        for (const l of lanes) {
          if (seen.has(l.from) && !seen.has(l.to)) (seen.add(l.to), (grew = true))
          if (seen.has(l.to) && !seen.has(l.from)) (seen.add(l.from), (grew = true))
        }
      }
      expect(seen.size, `${bank} bank is not one network`).toBe(nodes.size)
    }
    expect(LANES.length).toBeGreaterThanOrEqual(20)
  })

  it('stays on walkable land (a crossing where it meets a stream) and inside the look box', () => {
    for (const lane of LANES) {
      for (const [x, z] of sampleLane(lane.points, 1)) {
        expect(Math.abs(x) <= LOOK_BOX.max[0] && Math.abs(z) <= LOOK_BOX.max[2], `${lane.from}→${lane.to} leaves the look box`).toBe(true)
        expect(isLandAt(x, z, 0.6), `${lane.from}→${lane.to} at ${x.toFixed(1)},${z.toFixed(1)} is in the water`).toBe(true)
        if (onStream(x, z, 0)) expect(onCrossing(x, z), `${lane.from}→${lane.to} wades the stream at ${x.toFixed(1)},${z.toFixed(1)}`).toBe(true)
      }
    }
    for (const c of CROSSINGS) expect(onStream(c.at[0], c.at[1], 0.2), `${c.kind} crossing is not on a stream`).not.toBeNull()
    for (const s of STREAMS) for (const [x, z] of sampleLane(s.points, 2)) expect(isLandAt(x, z, 0) || s.points[s.points.length - 1][0] === x, `stream ${s.id} off the slab at ${x.toFixed(0)},${z.toFixed(0)}`).toBe(true)
  })

  it('runs clear of every landmark, every dressing piece and the authored structures outside their yards', () => {
    const landmarks = LANDMARKS.flatMap((spec) => landmarkColliders(spec, 2))
    const dressed = dressingColliders(dressing(L, SEED))
    const landmarkSet = buildColliderSet(landmarks)
    const dressedSet = buildColliderSet(dressed.filter((d) => d.tag !== 'brazier' && d.tag !== 'post'))
    const authoredSet = buildColliderSet(authored.filter((c) => c.tag !== 'relief'))
    for (const lane of LANES) {
      for (const [x, z] of sampleLane(lane.points, 1)) {
        expect(penetrationDepth(landmarkSet, x, z, 1.1), `${lane.from}→${lane.to} runs through a landmark at ${x.toFixed(0)},${z.toFixed(0)}`).toBe(0)
        expect(penetrationDepth(dressedSet, x, z, 1.1), `${lane.from}→${lane.to} runs through dressing at ${x.toFixed(0)},${z.toFixed(0)}`).toBe(0)
        if (!inYard(x, z)) expect(penetrationDepth(authoredSet, x, z, 1.1), `${lane.from}→${lane.to} runs through an authored structure at ${x.toFixed(0)},${z.toFixed(0)}`).toBe(0)
      }
    }
    // Braziers stand beside a lane end, not on the line.
    for (const b of dressed.filter((d) => d.tag === 'brazier')) {
      const near = LANES.some((lane) => sampleLane(lane.points, 1).some(([x, z]) => Math.hypot(x - b.x, z - b.z) < 4))
      expect(near, `${b.id} is far from every lane`).toBe(true)
    }
  })
})

describe('dressing: the ambient layer at 0 %', () => {
  const items = dressing(L, SEED)
  const colliders = dressingColliders(items)

  it('has fences, lamp-fires, benches, boats, carts, banners, tarns and 60+ hummocks, all on land and in the look box', () => {
    const count = (kind: string) => items.filter((d) => d.kind === kind).length
    expect(count('fence')).toBeGreaterThanOrEqual(8)
    expect(count('brazier')).toBeGreaterThanOrEqual(12)
    expect(count('bench')).toBeGreaterThanOrEqual(5)
    expect(count('boat')).toBeGreaterThanOrEqual(5)
    expect(count('cart')).toBeGreaterThanOrEqual(4)
    expect(count('banner')).toBeGreaterThanOrEqual(4)
    expect(count('tarn')).toBeGreaterThanOrEqual(4)
    expect(count('hummock')).toBeGreaterThanOrEqual(60)
    for (const d of items) {
      expect(Math.abs(d.x) <= LOOK_BOX.max[0] + 25 && Math.abs(d.z) <= LOOK_BOX.max[2] + 10, `${d.kind} at ${d.x},${d.z} outside the look box`).toBe(true)
      expect(isLandAt(d.x, d.z, d.kind === 'boat' ? -1 : 0.3), `${d.kind} at ${d.x},${d.z} off land`).toBe(true)
    }
    expect(colliders.length).toBe(items.length)
  })

  it('never sits on a landmark, an authored structure or another piece', () => {
    const landmarks = LANDMARKS.flatMap((spec) => landmarkColliders(spec, 2))
    for (const c of colliders) {
      for (const other of landmarks) expect(shapesOverlap(c, other), `${c.id} overlaps ${other.id}`).toBe(false)
      for (const other of authored) if (other.tag !== 'relief') expect(shapesOverlap(c, other), `${c.id} overlaps ${other.id}`).toBe(false)
    }
    for (let i = 0; i < colliders.length; i++) {
      for (let j = i + 1; j < colliders.length; j++) expect(shapesOverlap(colliders[i], colliders[j]), `${colliders[i].id} overlaps ${colliders[j].id}`).toBe(false)
    }
  })

  it('is deterministic and gives every standing house a chimney', () => {
    expect(mossHummocksOnLand(L, SEED)).toEqual(mossHummocksOnLand(L, SEED))
    expect(mossHummocksOnLand(L, SEED + 1).map((h) => h.x)).not.toEqual(mossHummocksOnLand(L, SEED).map((h) => h.x))
    const none = houseChimneys(L, SEED, Object.fromEntries(L.districts.map((d) => [d.id, 0])))
    const all = houseChimneys(L, SEED, full)
    expect(none.length).toBe(2 + 2) // the quay boathouses and the hamlet halls
    expect(all.length).toBe(none.length + 11 + 10 + 2 + 3 + 2)
    for (const [x, y, z] of all) {
      expect(Number.isFinite(x) && Number.isFinite(z)).toBe(true)
      expect(y).toBeGreaterThan(8)
    }
  })
})

describe('footprints: one list for everything drawn on the slabs', () => {
  it('equals authored + landmarks(band) + dressing and grows with the band', () => {
    const at = (fraction: number) => landFootprints(L, SEED, Object.fromEntries(L.districts.map((d) => [d.id, fraction])))
    const f0 = at(0)
    const f1 = at(0.5)
    const f2 = at(1)
    for (const f of [f0, f1, f2]) {
      expect(f.all.length).toBe(f.authored.length + f.landmarks.length + f.dressing.length)
      expect(new Set(f.all.map((c) => c.id)).size).toBe(f.all.length)
    }
    expect(f0.band).toBe(0)
    expect(f1.band).toBe(1)
    expect(f2.band).toBe(2)
    expect(f0.landmarks.length).toBeLessThan(f1.landmarks.length)
    expect(f1.landmarks.length).toBeLessThan(f2.landmarks.length)
    expect(f0.all.length).toBeLessThan(f1.all.length)
    expect(f1.all.length).toBeLessThan(f2.all.length)
    expect(f2.all.length).toBeGreaterThan(250)
  })
})
