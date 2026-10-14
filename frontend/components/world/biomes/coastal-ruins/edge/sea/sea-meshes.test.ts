import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SEA_HORIZON } from './sea-horizon'
import { buildFarSail, buildHazeWall, buildIslandShape, buildIsletShape, buildStackShape, createWallMaterial, islandColours, silhouette, wallFacesInward } from './sea-meshes'

describe('sea meshes', () => {
  it('builds the haze wall at the horizon radius, faces inward, normals up, and writes depth', () => {
    const wall = buildHazeWall()
    const pos = wall.getAttribute('position') as THREE.BufferAttribute
    const normal = wall.getAttribute('normal') as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      expect(Math.hypot(pos.getX(i), pos.getZ(i))).toBeCloseTo(SEA_HORIZON.horizonRadius, 2)
      expect(normal.getY(i)).toBe(1)
    }
    expect(wallFacesInward(wall)).toBe(true)
    const material = createWallMaterial(new THREE.Color('#dde8e8'), 0, SEA_HORIZON.glowHeight)
    expect(material.depthWrite).toBe(true)
    expect(material.transparent).toBe(true)
    expect(material.fog).toBe(false)
  })

  it('island silhouettes carry up normals and colours pulled toward the sky; near stacks keep their facets', () => {
    const colours = islandColours(false)
    const islet = silhouette(buildIsletShape(colours), false, 0.35)
    const normal = islet.getAttribute('normal') as THREE.BufferAttribute
    for (let i = 0; i < normal.count; i++) expect(normal.getY(i)).toBe(1)
    const stack = buildStackShape(colours)
    const stackNormal = stack.getAttribute('normal') as THREE.BufferAttribute
    let sideways = 0
    for (let i = 0; i < stackNormal.count; i++) if (stackNormal.getY(i) < 0.5) sideways++
    expect(sideways).toBeGreaterThan(10)
    expect(buildIslandShape(colours).getAttribute('color')).toBeDefined()
  })

  it('builds the far sail with a hull, a mast and a sail in one geometry', () => {
    const sail = buildFarSail(false)
    const pos = sail.getAttribute('position') as THREE.BufferAttribute
    expect(pos.count).toBeGreaterThan(60)
    let top = 0
    for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i))
    expect(top).toBeGreaterThan(9)
    expect(top).toBeLessThan(12)
  })
})
