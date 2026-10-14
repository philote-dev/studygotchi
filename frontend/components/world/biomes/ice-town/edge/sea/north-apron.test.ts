import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ICE_TOWN_LAYOUT } from '../../layout/biome-layout'
import { sampleTerrain } from '../../layout/terrain'
import { APRON_CLIFF, APRON_EDGE_BLEND, APRON_ROWS, apronCoastDepth, apronEdgeHeights, buildApron, readTerrainEdge } from './north-apron'

const layout = ICE_TOWN_LAYOUT
const extent = layout.worldExtent
const columns = extent * 2 + 1

function heights(geometry: THREE.BufferGeometry, row: number): number[] {
  const pos = geometry.attributes.position as THREE.BufferAttribute
  return Array.from({ length: columns }, (_, i) => pos.getY(row * columns + i))
}

describe('north apron', () => {
  it('samples the authored heightfield along the shared plate edge', () => {
    const edge = apronEdgeHeights(layout)
    expect(edge).toHaveLength(columns)
    for (let i = 0; i < columns; i += 17) expect(edge[i]).toBeCloseTo(sampleTerrain(layout, -extent + i, -extent).height, 5)
  })

  it('lies entirely north of the plate and ends in the sea on every column', () => {
    const geometry = buildApron(layout, false, null)
    const pos = geometry.attributes.position as THREE.BufferAttribute
    expect(pos.count).toBe(columns * APRON_ROWS.length)
    expect(geometry.index!.count / 3).toBe((columns - 1) * (APRON_ROWS.length - 1) * 2)
    for (let i = 0; i < pos.count; i++) expect(pos.getZ(i)).toBeLessThanOrEqual(-extent)
    // Row 0 is the shared edge, exactly.
    expect(heights(geometry, 0)).toEqual(Array.from(apronEdgeHeights(layout)))
    // The back coast cliff falls inside the apron so the outer row is open sea everywhere.
    for (let x = -extent; x <= extent; x += 1) expect(apronCoastDepth(x)).toBeLessThan(APRON_ROWS[APRON_ROWS.length - 1] - APRON_CLIFF.width)
    for (const h of heights(geometry, APRON_ROWS.length - 1)) expect(h).toBeLessThan(layout.seaLevel)
    // ... but the plateau behind the range does continue past the edge first.
    const plateau = heights(geometry, APRON_ROWS.indexOf(8))
    expect(plateau[extent]).toBeGreaterThan(layout.groundHeight)
    expect(geometry.attributes.color).toBeDefined()
    expect(geometry.attributes.normal).toBeDefined()
  })

  it('takes the measured terrain edge and fades the correction out inland', () => {
    const base = buildApron(layout, false, null)
    const measured = apronEdgeHeights(layout).map((h) => h + 2.5)
    const corrected = buildApron(layout, false, measured)
    expect(heights(corrected, 0)).toEqual(Array.from(measured))
    const deep = APRON_ROWS.findIndex((d) => d >= APRON_EDGE_BLEND)
    expect(heights(corrected, deep)).toEqual(heights(base, deep))
    const mid = heights(corrected, 3)
    const midBase = heights(base, 3)
    expect(mid[extent]).toBeGreaterThan(midBase[extent])
    expect(mid[extent]).toBeLessThan(midBase[extent] + 2.5)
  })

  it('finds the authored terrain mesh in a scene and reads its north edge', () => {
    const scene = new THREE.Scene()
    expect(readTerrainEdge(scene, extent)).toBeNull()
    const geo = new THREE.PlaneGeometry(extent * 2, extent * 2, extent * 2, extent * 2)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getX(i) * 0.01 + (Math.abs(pos.getZ(i) + extent) < 1e-6 ? 5 : 0))
    scene.add(new THREE.Mesh(geo))
    const edge = readTerrainEdge(scene, extent)
    expect(edge).not.toBeNull()
    expect(edge!.heights).toHaveLength(columns)
    expect(edge!.heights[0]).toBeCloseTo(5 - extent * 0.01, 5)
    expect(edge!.heights[columns - 1]).toBeCloseTo(5 + extent * 0.01, 5)
    expect(edge!.key).toBe(geo.uuid)
  })
})
