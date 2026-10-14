import { describe, expect, it } from 'vitest'
import { NORDIC_LAYOUT as L, generateDistricts } from '../../layout/biome-layout'
import { RELIEF, ROCKS } from '../../layout/placements'
import { GROUND_Y, HIDDEN_SEA_Y, PLATE_RECT, SEAM_LIFT, WATER_Y, inPlateRect, seamHeightAt } from '../../layout/terrain'
import { EDGE_POSES } from '../poses'
import { elevationDownDeg, frameTopDeg, lateralDeg, outwardPose, poseCamera } from '../barriers/geography'
import {
  ARM,
  BAY,
  CORRIDORS,
  OUTER_REACH,
  RINGS,
  VOLCANO,
  armCentre,
  armHalfWidth,
  bayCentre,
  bayHalfWidth,
  chebyshev,
  corridorMask,
  createOuterWorld,
  groundHaze,
  insideRingInner,
  landField,
  outerFogRange,
  ringAt,
  seaSurfaceY,
} from './outer-world'

const SEED = 7
const world = createOuterWorld(SEED)

describe('outer world: rings', () => {
  it('tiles from the plate rectangle to the reach on lattices that meet', () => {
    expect(RINGS.map((r) => r.ring)).toEqual([1, 2, 3])
    for (let i = 0; i < RINGS.length - 1; i++) {
      expect(RINGS[i].outer).toBe(RINGS[i + 1].inner)
      expect(RINGS[i].outer % RINGS[i].cell).toBe(0)
      expect(RINGS[i].outer % RINGS[i + 1].cell).toBe(0)
      expect(RINGS[i + 1].cell % RINGS[i].cell).toBe(0)
    }
    expect(RINGS[RINGS.length - 1].outer).toBe(OUTER_REACH)
    for (const edge of [PLATE_RECT.minX, PLATE_RECT.maxX, PLATE_RECT.minZ, PLATE_RECT.maxZ]) expect(Math.abs(edge % RINGS[0].cell)).toBe(0)
    // The plate rectangle sits inside ring 1's square.
    expect(Math.max(Math.abs(PLATE_RECT.minX), PLATE_RECT.maxX, Math.abs(PLATE_RECT.minZ), PLATE_RECT.maxZ)).toBeLessThan(RINGS[0].outer)
  })

  it('covers every point outside the plate out to the reach exactly once', () => {
    let covered = 0
    for (let z = -OUTER_REACH + 5; z < OUTER_REACH; z += 65) {
      for (let x = -OUTER_REACH + 5; x < OUTER_REACH; x += 65) {
        const ring = ringAt(x, z)
        if (inPlateRect(x, z)) {
          expect(ring).toBeNull()
          continue
        }
        expect(ring, `${x},${z}`).not.toBeNull()
        expect(insideRingInner(ring!, x, z)).toBe(false)
        const inner = RINGS.find((r) => r.ring === ring!.ring - 1)
        if (inner) expect(chebyshev(x, z)).toBeGreaterThanOrEqual(inner.outer)
        covered++
      }
    }
    expect(covered).toBeGreaterThan(4000)
    expect(ringAt(OUTER_REACH + 1, 0)).toBeNull()
  })
})

describe('outer world: in-plate exclusion and the seam', () => {
  it('never puts land inside the plate: the sample there is a hidden floor under the water', () => {
    for (const district of generateDistricts(L, SEED)) {
      const s = world.sample(district.center[0], district.center[1])
      expect(s.material).toBe('sea')
      expect(s.height).toBeLessThan(HIDDEN_SEA_Y)
    }
    for (const [x, z] of [L.landmark.center, [0, 0], [240, 500], [-240, -190]] as Array<[number, number]>) {
      expect(world.sample(x, z).height).toBeLessThan(WATER_Y - 0.5)
      expect(world.heightAt(x, z)).toBe(GROUND_Y)
    }
  })

  it('meets the slab top (lifted 8 cm) along the whole seam and dips under the water at the two fjord mouths', () => {
    const inset = 1.5
    let slab = 0
    let water = 0
    for (let x = PLATE_RECT.minX + inset; x <= PLATE_RECT.maxX - inset; x += 1) {
      for (const z of [PLATE_RECT.minZ + inset, PLATE_RECT.maxZ - inset]) {
        const h = world.seamHeight(x, z)
        expect(h === GROUND_Y + SEAM_LIFT || h === HIDDEN_SEA_Y, `seam at ${x},${z}`).toBe(true)
        if (h === HIDDEN_SEA_Y) water++
        else slab++
      }
    }
    for (let z = PLATE_RECT.minZ + inset; z <= PLATE_RECT.maxZ - inset; z += 1) {
      for (const x of [PLATE_RECT.minX + inset, PLATE_RECT.maxX - inset]) {
        expect(world.seamHeight(x, z)).toBe(GROUND_Y + SEAM_LIFT)
        slab++
      }
    }
    expect(slab).toBeGreaterThan(2300)
    // North mouth x ∈ (−6, 44), south mouth x ∈ (−28, 34): about 112 m of water on the seam.
    expect(water).toBeGreaterThanOrEqual(104)
    expect(water).toBeLessThanOrEqual(116)
    expect(seamHeightAt(19, PLATE_RECT.minZ + inset)).toBe(HIDDEN_SEA_Y)
    expect(seamHeightAt(3, PLATE_RECT.maxZ - inset)).toBe(HIDDEN_SEA_Y)
    expect(seamHeightAt(-100, PLATE_RECT.minZ + inset)).toBe(GROUND_Y + SEAM_LIFT)
  })

  it('continues the slab height just outside the seam: no step within 20 m of the plate', () => {
    for (let x = -240; x <= 240; x += 20) {
      for (const [z, dz] of [
        [PLATE_RECT.minZ, -1],
        [PLATE_RECT.maxZ, 1],
      ]) {
        const land = world.landField(x, z + dz * 6)
        if (land < 12) continue
        const h = world.sample(x, z + dz * 6).height
        expect(Math.abs(h - (GROUND_Y + SEAM_LIFT)), `${x},${z + dz * 6}`).toBeLessThan(0.35)
      }
    }
    for (let z = -190; z <= 510; z += 25) {
      for (const [x, dx] of [
        [PLATE_RECT.minX, -1],
        [PLATE_RECT.maxX, 1],
      ]) {
        const h = world.sample(x + dx * 6, z).height
        expect(Math.abs(h - (GROUND_Y + SEAM_LIFT)), `${x + dx * 6},${z}`).toBeLessThan(0.35)
      }
    }
  })

  it('keeps every outer feature clear of the authored structures (they are all inside the plate)', () => {
    const authored: Array<[number, number]> = [
      ...generateDistricts(L, SEED).map((d) => d.center),
      L.landmark.center,
      ...RELIEF.map((r) => [r.p[0], r.p[2]] as [number, number]),
      ...ROCKS.map((r) => [r[0], r[2]] as [number, number]),
      ...L.lavaBasin.islets.map((i) => i.center),
    ]
    for (const [x, z] of authored) {
      expect(inPlateRect(x, z), `${x},${z}`).toBe(true)
      expect(ringAt(x, z)).toBeNull()
    }
  })
})

describe('outer world: geography', () => {
  it('continues the fjord north as a narrowing arm to the glacier head and south as a widening bay to open sea', () => {
    expect(armCentre(ARM.zMouth)).toBeCloseTo(19, 6)
    expect(armHalfWidth(ARM.zMouth)).toBe(25)
    expect(armHalfWidth(ARM.zHead)).toBeLessThan(armHalfWidth(ARM.zMouth))
    for (let z = ARM.zMouth - 4; z > ARM.zHead + 4; z -= 8) {
      const c = armCentre(z)
      expect(landField(c, z)).toBeLessThan(-10)
      expect(world.sample(c, z).material).toBe('sea')
      expect(landField(c + armHalfWidth(z) + 30, z)).toBeGreaterThan(20)
      expect(landField(c - armHalfWidth(z) - 30, z)).toBeGreaterThan(20)
    }
    expect(landField(armCentre(ARM.zHead - 20), ARM.zHead - 20)).toBeGreaterThan(10)
    expect(bayCentre(BAY.zMouth)).toBe(3)
    expect(bayHalfWidth(BAY.zMouth)).toBe(31)
    for (let z = BAY.zMouth + 10; z < 760; z += 40) {
      expect(world.sample(bayCentre(z), z).material).toBe('sea')
      expect(bayHalfWidth(z)).toBeGreaterThan(bayHalfWidth(z - 40))
    }
    // Open sea south of the bay mouth, the far ring's own surface beyond the water plane.
    expect(world.sample(0, 1000).material).toBe('sea')
    expect(world.sample(0, 1000).height).toBe(WATER_Y)
    expect(world.sample(0, 2300).material).toBe('sea')
    expect(seaSurfaceY(0, 600)).toBe(HIDDEN_SEA_Y)
    expect(seaSurfaceY(0, 700)).toBe(WATER_Y)
  })

  it('shapes the ice-capped volcano at the arm head with its crater lower than the rim', () => {
    const rim = world.sample(VOLCANO.x, VOLCANO.z - VOLCANO.craterRadius - 2)
    const crater = world.sample(VOLCANO.x, VOLCANO.z)
    expect(rim.height).toBeGreaterThan(crater.height + 3)
    expect(rim.material).toBe('ice')
    expect(crater.material).toBe('lava')
    // The tongue runs from the cap down to the glacier front; the flanks either side of it are bare.
    expect(world.sample(VOLCANO.x - 6, ARM.zHead - 12).material).toBe('ice')
    expect(world.sample(VOLCANO.x - 60, VOLCANO.z + 60).material).toBe('mountain')
    // The flanks east and west are bare mountain.
    expect(['mountain', 'moss']).toContain(world.sample(VOLCANO.x + 110, VOLCANO.z).material)
  })

  it('recedes: each row stands farther, taller and hazier than the last', () => {
    const rows = [3, 4, 5, 6] as const
    const byRow = rows.map((row) => world.peaks.filter((p) => p.row === row))
    for (const peaks of byRow) expect(peaks.length).toBeGreaterThanOrEqual(10)
    for (let i = 0; i < rows.length - 1; i++) {
      const near = byRow[i]
      const far = byRow[i + 1]
      const meanZ = (ps: typeof near) => ps.reduce((s, p) => s + p.z, 0) / ps.length
      const meanH = (ps: typeof near) => ps.reduce((s, p) => s + p.height, 0) / ps.length
      expect(meanZ(far)).toBeLessThan(meanZ(near) - 100)
      expect(meanH(far)).toBeGreaterThan(meanH(near) * 1.2)
    }
    // Baked aerial perspective grows with distance from the plate and the rows carry extra.
    expect(groundHaze(0, -220)).toBeLessThan(0.1)
    expect(groundHaze(0, -800)).toBeGreaterThan(groundHaze(0, -400))
    expect(groundHaze(0, -2000)).toBeGreaterThan(0.8)
    const sampled = rows.map((row) => {
      const p = byRow[row - 3].reduce((best, q) => (corridorMask(q.x, q.z) < corridorMask(best.x, best.z) ? q : best))
      return world.sample(p.x, p.z)
    })
    for (let i = 0; i < sampled.length - 1; i++) expect(sampled[i + 1].haze).toBeGreaterThan(sampled[i].haze)
    // The authored rear row tops out near 65 m at z ≈ −190; row 3 behind it is taller.
    expect(Math.max(...byRow[0].map((p) => p.height))).toBeGreaterThan(70)
  })

  it('keeps the window corridors low so the vistas read against haze and sky', () => {
    expect(corridorMask(CORRIDORS.north.x, -700)).toBeGreaterThan(0.95)
    expect(corridorMask(CORRIDORS.north.x + 400, -700)).toBe(0)
    expect(corridorMask(600, CORRIDORS.east.z)).toBeGreaterThan(0.95)
    expect(corridorMask(-600, CORRIDORS.west.z)).toBeGreaterThan(0.95)
    expect(corridorMask(1200, CORRIDORS.east.z)).toBe(0)
    for (let z = -620; z > -1400; z -= 60) expect(world.sample(CORRIDORS.north.x, z).height, `corridor floor at ${z}`).toBeLessThan(22)
    for (let x = 480; x < 860; x += 40) expect(world.sample(x, CORRIDORS.east.z).height, `east corridor at ${x}`).toBeLessThan(22)
  })

  it('shows the volcano summit under the north pose frame top with the sky corridor behind it', () => {
    const pose = outwardPose('north')
    const cam = poseCamera(pose)
    // The silhouette seen from the south is the far (north) rim; the near rim carries the notch.
    const rim = world.sample(VOLCANO.x, VOLCANO.z - VOLCANO.craterRadius - 2)
    const top = elevationDownDeg(cam, VOLCANO.x, rim.height, VOLCANO.z - VOLCANO.craterRadius - 2)
    expect(top - frameTopDeg(pose)).toBeGreaterThanOrEqual(0.3)
    expect(top - frameTopDeg(pose)).toBeLessThanOrEqual(8)
    expect(lateralDeg(pose, VOLCANO.x, VOLCANO.z)).toBeLessThan(4)
    // The rim shows above the authored rear row (its tallest peak on this line is 54 m at z ≈ −193).
    const peak = elevationDownDeg(cam, 34, 54, -193)
    expect(peak - top).toBeGreaterThanOrEqual(1.5)
    // The top ray clears the corridor floor behind the summit until the fog.
    const far = outerFogRange(Math.hypot(cam.x, cam.y, cam.z), false).far
    for (let d = 700; d < far; d += 50) {
      const z = cam.z - d
      const rayY = cam.y - d * Math.tan((frameTopDeg(pose) * Math.PI) / 180)
      expect(world.sample(cam.x, z).height, `corridor at ${z}`).toBeLessThan(rayY - 2)
    }
  })

  it('is deterministic per seed and differs between seeds', () => {
    const again = createOuterWorld(SEED)
    for (const [x, z] of [[300, -40], [-400, 100], [19, -260], [0, 900], [700, 700]] as Array<[number, number]>) {
      expect(again.sample(x, z)).toEqual(world.sample(x, z))
    }
    const other = createOuterWorld(SEED + 1)
    expect(other.peaks.map((p) => p.x)).not.toEqual(world.peaks.map((p) => p.x))
  })
})

describe('outer world: fog', () => {
  it('follows the camera like the land’s own fog but reaches 1.3–1.6 km, farther than every pose can see the plate', () => {
    const overview = EDGE_POSES.find((p) => p.id === 'overview')!
    const cam = poseCamera(overview)
    const distance = Math.hypot(cam.x, cam.y, cam.z)
    const fog = outerFogRange(distance, false)
    // Nothing in the overview frame is farther than the back cliffs (~480 m): fog starts past them.
    expect(fog.near).toBeGreaterThan(560)
    expect(fog.far).toBeGreaterThan(1500)
    expect(outerFogRange(60, false).far).toBeGreaterThanOrEqual(1300)
    expect(outerFogRange(60, true).far).toBeLessThan(outerFogRange(60, false).far)
  })
})
