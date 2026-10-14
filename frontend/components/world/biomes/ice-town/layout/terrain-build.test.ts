import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ICE_TOWN_LAYOUT, mountainProfile, mountainProfileForBand } from './biome-layout'
import { mountainPeaks, sampleTerrain } from './terrain'
import {
  GROUND_MATERIALS,
  buildTerrainGrid,
  colourTerrainGrid,
  fieldsFromBytes,
  fieldsOf,
  fieldsToBytes,
  finishTerrainMesh,
  gridFromFields,
  mergeTerrainRows,
  sampleTerrainFields,
  sampleTerrainRows,
  terrainProfileFor,
  terrainRowRanges,
} from './terrain-build'

const layout = ICE_TOWN_LAYOUT

/** The plate as `scene/Terrain.tsx` used to build it: three's lattice, sampled, with three's normals. */
function legacyGeometry(segments: number, band: number) {
  const profile = mountainProfileForBand(band)
  const geo = new THREE.PlaneGeometry(layout.worldExtent * 2, layout.worldExtent * 2, segments, segments)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const peaks = mountainPeaks(layout, profile)
  const materials: string[] = []
  const heights: number[] = []
  for (let i = 0; i < pos.count; i++) {
    const s = sampleTerrain(layout, pos.getX(i), pos.getZ(i), profile, peaks)
    pos.setY(i, s.height)
    materials.push(s.material)
    heights.push(s.height)
  }
  geo.computeVertexNormals()
  return { geo, materials, heights }
}

describe("terrain-build: the lattice is three's", () => {
  it('positions, index, normals and the sampled doubles are bit-identical to PlaneGeometry + sampleTerrain + computeVertexNormals', () => {
    const segments = 48
    const { geo, materials, heights } = legacyGeometry(segments, 3)
    const grid = buildTerrainGrid(layout, mountainProfileForBand(3), segments)
    expect(grid.count).toBe((segments + 1) ** 2)
    expect(Array.from(grid.index)).toEqual(Array.from(geo.index!.array))
    expect(Array.from(grid.position)).toEqual(Array.from(geo.attributes.position.array))
    expect(Array.from(grid.normal)).toEqual(Array.from(geo.attributes.normal.array))
    expect(Array.from(grid.material, (m) => GROUND_MATERIALS[m])).toEqual(materials)
    expect(Array.from(grid.height)).toEqual(heights)
  })

  it('matches at the production resolution too', () => {
    const { geo } = legacyGeometry(340, 2)
    const grid = buildTerrainGrid(layout, mountainProfileForBand(2), 340)
    const pos = geo.attributes.position.array as Float32Array
    const nor = geo.attributes.normal.array as Float32Array
    let posDiff = 0
    let norDiff = 0
    for (let i = 0; i < pos.length; i++) {
      if (pos[i] !== grid.position[i]) posDiff++
      if (nor[i] !== grid.normal[i]) norDiff++
    }
    expect(posDiff).toBe(0)
    expect(norDiff).toBe(0)
    // Two full 116 k-vertex plates (three's and ours): ~3 s alone, past the default 5 s under a loaded machine.
  }, 30_000)
})

describe('terrain-build: determinism, rows and keys', () => {
  it('two builds of the same inputs are identical; night differs only in colour', () => {
    const a = finishTerrainMesh(layout, sampleTerrainFields(layout, mountainProfileForBand(2), 32))
    const b = finishTerrainMesh(layout, sampleTerrainFields(layout, mountainProfileForBand(2), 32))
    expect(a.day).toEqual(b.day)
    expect(a.night).toEqual(b.night)
    expect(a.grid.position).toEqual(b.grid.position)
    expect(a.grid.normal).toEqual(b.grid.normal)
    expect(a.night).not.toEqual(a.day)
  })

  it('row slices in any order merge into the whole-plate sample (the Worker pool splits the lattice)', () => {
    const profile = mountainProfileForBand(3)
    const whole = sampleTerrainFields(layout, profile, 30)
    const ranges = terrainRowRanges(4, 30)
    expect(ranges).toEqual([
      [0, 7],
      [7, 15],
      [15, 23],
      [23, 31],
    ])
    const parts = ranges.map(([a, b]) => sampleTerrainRows(layout, profile, a, b, 30)).reverse()
    const merged = mergeTerrainRows(parts)
    expect(merged.height).toEqual(whole.height)
    expect(merged.material).toEqual(whole.material)
    expect(merged.peakFrac).toEqual(whole.peakFrac)
    expect(merged.mountainRow).toEqual(whole.mountainRow)
    expect(() => mergeTerrainRows(parts.slice(1))).toThrow(/rows/)
  })

  it('bands change the heights (the range grows)', () => {
    const low = buildTerrainGrid(layout, mountainProfileForBand(0), 32)
    const high = buildTerrainGrid(layout, mountainProfileForBand(4), 32)
    expect(low.position).not.toEqual(high.position)
  })

  it('the course profile never drops below the 62 % range (BiomeScene) and clamps to [0, 1]', () => {
    expect(terrainProfileFor(0).band).toBe(mountainProfile(0.62).band)
    expect(terrainProfileFor(0.3).band).toBe(mountainProfile(0.62).band)
    expect(terrainProfileFor(0.9).band).toBe(mountainProfile(0.9).band)
    expect(terrainProfileFor(7).band).toBe(mountainProfile(1).band)
  })

  it('mountainProfileForBand agrees with mountainProfile on every band', () => {
    for (const p of [0, 0.2, 0.5, 0.62, 0.8, 0.95, 1]) {
      const viaProgress = mountainProfile(p)
      expect(mountainProfileForBand(viaProgress.band)).toEqual(viaProgress)
    }
  })
})

describe('terrain-build: storage round trip', () => {
  it('fields → bytes → fields → mesh reproduces the sampled grid and its colours exactly', () => {
    const profile = mountainProfileForBand(3)
    const fields = sampleTerrainFields(layout, profile, 40)
    const bytes = fieldsToBytes(fields)
    const restored = fieldsFromBytes(bytes)
    expect(restored).not.toBeNull()
    expect(restored!.band).toBe(3)
    expect(restored!.segments).toBe(40)
    expect(restored!.extent).toBe(layout.worldExtent)
    expect(restored!.height).toEqual(fields.height)
    expect(restored!.peakFrac).toEqual(fields.peakFrac)
    expect(restored!.material).toEqual(fields.material)
    expect(restored!.mountainRow).toEqual(fields.mountainRow)
    const direct = gridFromFields(fields)
    const viaStore = gridFromFields(restored!)
    expect(viaStore.position).toEqual(direct.position)
    expect(viaStore.normal).toEqual(direct.normal)
    expect(colourTerrainGrid(layout, profile, viaStore, true)).toEqual(colourTerrainGrid(layout, profile, direct, true))
    expect(fieldsOf(direct).height).toBe(fields.height)
  })

  it('rejects buffers that are not ours', () => {
    expect(fieldsFromBytes(new ArrayBuffer(4))).toBeNull()
    expect(fieldsFromBytes(new ArrayBuffer(64))).toBeNull()
    const bytes = fieldsToBytes(sampleTerrainFields(layout, mountainProfileForBand(1), 8))
    expect(fieldsFromBytes(bytes.slice(0, bytes.byteLength - 1))).toBeNull()
  })
})
