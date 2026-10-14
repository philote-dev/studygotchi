import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { GROUND_Y, HIDDEN_SEA_Y, PLATE_RECT, SEAM_INSET, SEAM_LIFT, WATER_PLANE_HALF, WATER_Y, inPlateRect } from '../../layout/terrain'
import { OUTER_REACH, RINGS, createOuterWorld } from './outer-world'
import { buildOuterMeshes, buildRing, colourRing, ringGeometry, triangleCount, type RingMeshData } from './outer-mesh'

const SEED = 7
const world = createOuterWorld(SEED)
const meshes = buildOuterMeshes(world, WATER_Y)

function vertices(data: RingMeshData): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  for (let i = 0; i < data.position.length; i += 3) out.push([data.position[i], data.position[i + 1], data.position[i + 2]])
  return out
}

describe('outer mesh', () => {
  it('builds three rings as quadrant meshes within a 70k-triangle budget, no NaNs', () => {
    expect(new Set(meshes.map((m) => m.ring))).toEqual(new Set([1, 2, 3]))
    const total = triangleCount(meshes)
    expect(total).toBeGreaterThan(20_000)
    expect(total).toBeLessThan(70_000)
    // Hundreds of thousands of values: tally in plain loops and assert the tallies (one `expect` per value took seconds).
    let nonFinite = 0
    let downFacing = 0
    for (const m of meshes) {
      expect(m.position.length).toBe(m.triangles * 9)
      expect(m.normal.length).toBe(m.triangles * 9)
      for (let i = 0; i < m.position.length; i++) if (!Number.isFinite(m.position[i])) nonFinite++
      for (let i = 0; i < m.normal.length; i += 3) if (!(m.normal[i + 1] >= 0)) downFacing++
    }
    expect(nonFinite, 'non-finite positions').toBe(0)
    expect(downFacing, 'normals facing down').toBe(0)
  })

  it('puts no vertex inside the plate (beyond the 1.5 m seam inset) and none beyond the reach', () => {
    const inside: string[] = []
    const beyond: string[] = []
    for (const m of meshes) {
      for (const [x, , z] of vertices(m)) {
        const insideByMore =
          x > PLATE_RECT.minX + SEAM_INSET + 1e-6 && x < PLATE_RECT.maxX - SEAM_INSET - 1e-6 && z > PLATE_RECT.minZ + SEAM_INSET + 1e-6 && z < PLATE_RECT.maxZ - SEAM_INSET - 1e-6
        if (insideByMore) inside.push(`${x},${z}`)
        if (!(Math.max(Math.abs(x), Math.abs(z)) <= OUTER_REACH + 1e-6)) beyond.push(`${x},${z}`)
      }
    }
    expect(inside, 'vertices inside the plate').toEqual([])
    expect(beyond, 'vertices beyond the reach').toEqual([])
  })

  it('is seam-exact: every vertex on the seam line carries the slab top + 8 cm or the hidden sea', () => {
    let onSeam = 0
    let slab = 0
    for (const m of meshes.filter((m) => m.ring === 1)) {
      for (const [x, y, z] of vertices(m)) {
        const seamX = Math.abs(Math.abs(x) - (PLATE_RECT.maxX - SEAM_INSET)) < 1e-6 && z >= PLATE_RECT.minZ && z <= PLATE_RECT.maxZ
        const seamZ = (Math.abs(z - (PLATE_RECT.minZ + SEAM_INSET)) < 1e-6 || Math.abs(z - (PLATE_RECT.maxZ - SEAM_INSET)) < 1e-6) && x >= PLATE_RECT.minX && x <= PLATE_RECT.maxX
        if (!seamX && !seamZ) continue
        onSeam++
        // Float32 storage: compare within 1e-5.
        const isSlab = Math.abs(y - (GROUND_Y + SEAM_LIFT)) < 1e-5
        expect(isSlab || Math.abs(y - HIDDEN_SEA_Y) < 1e-5, `seam vertex ${x},${z} at ${y}`).toBe(true)
        if (isSlab) slab++
      }
    }
    expect(onSeam).toBeGreaterThan(4000)
    expect(slab / onSeam).toBeGreaterThan(0.9)
  })

  it('shares every vertex across the ring boundaries (no LOD cracks)', () => {
    for (let i = 0; i < RINGS.length - 1; i++) {
      const r = RINGS[i].outer
      const key = (x: number, z: number) => `${x.toFixed(3)},${z.toFixed(3)}`
      const inner = new Map<string, number>()
      for (const m of meshes.filter((m) => m.ring === RINGS[i].ring)) {
        for (const [x, y, z] of vertices(m)) if (Math.max(Math.abs(x), Math.abs(z)) === r) inner.set(key(x, z), y)
      }
      let shared = 0
      for (const m of meshes.filter((m) => m.ring === RINGS[i + 1].ring)) {
        for (const [x, y, z] of vertices(m)) {
          if (Math.max(Math.abs(x), Math.abs(z)) !== r) continue
          const innerY = inner.get(key(x, z))
          if (innerY === undefined) continue
          expect(Math.abs(innerY - y), `boundary ${r} at ${x},${z}`).toBeLessThan(1e-3)
          shared++
        }
      }
      expect(shared).toBeGreaterThan(100)
    }
  })

  it('drops cells that are wholly sea under the authored water plane, and draws the sea beyond it', () => {
    // Nothing at the fjord arm's centre (hidden under the plane), sea faces far south.
    const ring1 = meshes.filter((m) => m.ring === 1)
    let inArm = 0
    let farSea = 0
    for (const m of ring1) {
      for (let f = 0; f < m.triangles; f++) {
        const cx = (m.position[f * 9] + m.position[f * 9 + 3] + m.position[f * 9 + 6]) / 3
        const cz = (m.position[f * 9 + 2] + m.position[f * 9 + 5] + m.position[f * 9 + 8]) / 3
        if (Math.abs(cx - 19) < 8 && cz > -300 && cz < -215) inArm++
      }
    }
    expect(inArm).toBe(0)
    for (const m of meshes.filter((m) => m.ring >= 2)) {
      for (let f = 0; f < m.triangles; f++) {
        const cz = (m.position[f * 9 + 2] + m.position[f * 9 + 5] + m.position[f * 9 + 8]) / 3
        const cy = (m.position[f * 9 + 1] + m.position[f * 9 + 4] + m.position[f * 9 + 7]) / 3
        if (cz > WATER_PLANE_HALF + 40 && Math.abs(cy - WATER_Y) < 1e-3) farSea++
      }
    }
    expect(farSea).toBeGreaterThan(200)
  })

  it('colours faces per material with the seam faces exactly the authored ground colour', () => {
    const ring1 = meshes.find((m) => m.ring === 1 && m.quadrant === 0)!
    const day = colourRing(ring1, { night: false, storm: false })
    const night = colourRing(ring1, { night: true, storm: false })
    expect(day.length).toBe(ring1.triangles * 9)
    // Vertex colours are linear (three converts the authored hex the same way for `Surf`).
    const ground = new THREE.Color('#68765b').toArray()
    const groundNight = new THREE.Color('#34434a').toArray()
    let seamFaces = 0
    for (let f = 0; f < ring1.triangles; f++) {
      if (ring1.seamDistance[f] > 4 || ring1.material[f] !== 2) continue
      seamFaces++
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(day[f * 9 + c] - ground[c])).toBeLessThan(0.02)
        expect(Math.abs(night[f * 9 + c] - groundNight[c])).toBeLessThan(0.02)
      }
    }
    expect(seamFaces).toBeGreaterThan(50)
    const geometry = ringGeometry(ring1, { night: false, storm: false })
    expect(geometry.getAttribute('color').count).toBe(ring1.triangles * 3)
    geometry.dispose()
  })

  it('is deterministic', () => {
    const again = buildRing(createOuterWorld(SEED), RINGS[0], RINGS[1], WATER_Y)
    const first = meshes.filter((m) => m.ring === 1)
    expect(again.map((m) => m.triangles)).toEqual(first.map((m) => m.triangles))
    expect(Array.from(again[0].position.slice(0, 300))).toEqual(Array.from(first[0].position.slice(0, 300)))
    expect(inPlateRect(0, 0)).toBe(true)
  })
})
