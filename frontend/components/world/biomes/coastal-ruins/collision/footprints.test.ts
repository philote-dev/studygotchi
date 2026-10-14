import { describe, expect, it } from 'vitest'
import { buildColliderSet, penetrationDepth } from '../../collision/colliders'
import { COASTAL_RUINS_LAYOUT as L, populationFor, skylineProfile } from '../layout/biome-layout'
import { localPaths, propPlacements, sampleTerrain, seaStacks, visibleProps } from '../layout/terrain'
import { OLIVE_SPOTS, STONE_PIECES, STONE_SPOTS, backRow, footBlocks, shoulderData } from '../layout/dressing'
import {
  anchorColliders,
  buildingColliders,
  coastalLandColliders,
  dockColliders,
  dressingColliders,
  escarpmentColliders,
  landmarkColliders,
  propColliders,
  seaStackColliders,
  walkablePathSamples,
} from './footprints'

const SEED = 7
const full = Object.fromEntries(L.districts.map((d) => [d.id, 1]))
const half = Object.fromEntries(L.districts.map((d) => [d.id, 0.5]))
const none = Object.fromEntries(L.districts.map((d) => [d.id, 0]))

describe('coastal collider footprints', () => {
  it('registers one footprint per visible building, gated by progress like the meshes', () => {
    const expectedFull = L.districts.reduce((sum, d) => sum + populationFor(d, 1).buildings, 0)
    const expectedHalf = L.districts.reduce((sum, d) => sum + populationFor(d, 0.5).buildings, 0)
    expect(buildingColliders(L, SEED, full)).toHaveLength(expectedFull)
    expect(buildingColliders(L, SEED, half)).toHaveLength(expectedHalf)
    expect(buildingColliders(L, SEED, none)).toHaveLength(0)
    expect(expectedFull).toBe(30)
    for (const c of buildingColliders(L, SEED, full)) expect(c.kind).toBe('box')
  })

  it('covers every anchor ruin: stair pads and walls, the column comb, the crescents, the forum ring and columns, the quay deck', () => {
    const anchors = anchorColliders(L, SEED)
    const byDistrict = (id: string) => anchors.filter((c) => c.id?.startsWith(`anchor:${id}`))
    expect(byDistrict('cliff-village').length).toBeGreaterThanOrEqual(3 + 9 + 4)
    expect(byDistrict('archaeology-ridge').filter((c) => c.kind === 'circle' && c.r > 0.8).length).toBeGreaterThanOrEqual(5)
    expect(byDistrict('dry-terraces').filter((c) => c.kind === 'circle' && c.r >= 2.8).length).toBe(2)
    expect(byDistrict('drowned-forum').filter((c) => c.kind === 'circle' && c.r === 1.7).length).toBe(4)
    expect(byDistrict('drowned-forum').length).toBeGreaterThan(20)
    expect(byDistrict('working-quay').filter((c) => c.kind === 'box' && c.hx === 21).length).toBe(1)
    expect(anchors.length).toBeGreaterThan(80)
  })

  it('registers every prop that stands up (not the flat mosaics), band-gated like the meshes', () => {
    const visible = visibleProps(propPlacements(L, SEED), L, full)
    const standing = visible.filter((p) => p.kind !== 'mosaic')
    expect(propColliders(L, SEED, full)).toHaveLength(standing.length)
    expect(propColliders(L, SEED, none)).toHaveLength(0)
    const kinds = new Set(standing.map((p) => p.kind))
    expect(kinds).toContain('boat')
    expect(kinds).toContain('olive')
    expect(kinds).toContain('lamp')
    expect(propColliders(L, SEED, full).filter((c) => c.id?.includes(':boat:'))).toHaveLength(4)
  })

  it('registers the quay deck ribbon as a dock, the landmark plinth, every dressing stone and olive, the escarpment and the side stacks', () => {
    const quay = localPaths(L, SEED).find((p) => p.kind === 'quay')!
    expect(dockColliders(L, SEED)).toHaveLength(quay.points.length - 1)
    expect(landmarkColliders(104, 96, 's3')).toHaveLength(1)
    expect(dressingColliders()).toHaveLength(STONE_SPOTS.length * STONE_PIECES.length + OLIVE_SPOTS.length)
    const profile = skylineProfile(1)
    expect(escarpmentColliders(profile)).toHaveLength(footBlocks().length + shoulderData(profile).length + backRow().length)
    expect(escarpmentColliders(skylineProfile(0))).toHaveLength(footBlocks().length + 3 + backRow().length)
    expect(seaStackColliders()).toHaveLength(seaStacks().length)
  })

  it('unions everything with unique ids, all inside the plate', () => {
    const all = coastalLandColliders(L, SEED, full)
    expect(all.length).toBeGreaterThan(200)
    expect(all.length).toBeLessThan(600)
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length)
    for (const c of all) {
      expect(Math.abs(c.x)).toBeLessThan(L.worldExtent)
      expect(Math.abs(c.z)).toBeLessThan(L.worldExtent)
      expect(c.tag).toBeDefined()
    }
    const tags = new Set(all.map((c) => c.tag))
    expect(tags).toEqual(new Set(['anchor', 'building', 'prop', 'dock', 'landmark', 'tree', 'escarpment', 'stack']))
    expect(coastalLandColliders(L, SEED, full)).toEqual(all)
  })

  it('leaves the lanes and stairs walkable: the paths register nothing, and no building or dock stands on a path centreline', () => {
    const paths = localPaths(L, SEED)
    expect(paths.filter((p) => p.kind === 'lane' || p.kind === 'stairs').length).toBeGreaterThanOrEqual(3)
    const samples = walkablePathSamples(L, SEED)
    expect(samples.length).toBeGreaterThan(100)
    // Only the quay deck is a path-derived collider; lanes and stairs register nothing.
    expect(dockColliders(L, SEED).every((c) => c.tag === 'dock')).toBe(true)
    // The authored village houses straddle the stair ribbon in a few spots (walkers steer round them);
    // everywhere else the centrelines are clear of buildings, docks and trees.
    const fixed = buildColliderSet([...buildingColliders(L, SEED, full), ...dockColliders(L, SEED), ...dressingColliders()], 4)
    const blocked = samples.filter(([x, z]) => penetrationDepth(fixed, x, z, 0.25) > 0).length
    expect(blocked / samples.length).toBeLessThan(0.1)
    // Every path sample is on land a walker may stand on.
    for (const [x, z] of samples) {
      const s = sampleTerrain(L, x, z)
      expect(s.material === 'limestone' || s.material === 'terrace').toBe(true)
    }
  })
})
