import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ICE_TOWN_LAYOUT, mountainProfile } from '../../layout/biome-layout'
import {
  OVERVIEW_COLUMN,
  backFade,
  backFadeOnset,
  coastRampWidth,
  headlandField,
  landField,
  miniIslandField,
  mountainHeight,
  mountainPeaks,
  overviewEase,
  overviewOutside,
  rangeArcZ,
  sampleTerrain,
  shelfField,
} from '../../layout/terrain'
import { STATIONS } from '../../camera/stations'
import { NORTH_FRINGE_BAND, STEEP_NY, backColourZone, cliffFace } from '../../scene/Terrain'
import { EDGE_POSES, edgePosePosition } from '../poses'
import { createOuterWorld } from './outer-world'

const layout = ICE_TOWN_LAYOUT
const PLATE = layout.worldExtent
const profile = mountainProfile(0.62)
const peaks = mountainPeaks(layout, profile)
const world = createOuterWorld(layout, 7)

/** The overview camera exactly as the lab capture has it (pose maths, FOV 26°, 16:9), for exact in-frame tests. */
const OVERVIEW_POSE = EDGE_POSES.find((p) => p.id === 'overview')!
const overviewCamera = (() => {
  const camera = new THREE.PerspectiveCamera(STATIONS.overview.fov, 16 / 9, 0.5, 3000)
  camera.position.set(...edgePosePosition(OVERVIEW_POSE))
  camera.lookAt(...OVERVIEW_POSE.target)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera
})()
const scratchP = new THREE.Vector3()

/** Whether a world point projects inside the overview frame (NDC within ±1, in front of the camera). */
function inOverviewFrame(x: number, y: number, z: number): boolean {
  scratchP.set(x, y, z).project(overviewCamera)
  return Math.abs(scratchP.x) <= 1 && Math.abs(scratchP.y) <= 1 && scratchP.z < 1
}

/** Whether a point is below the frame's top edge (the top, over the range, is `backFade`'s business). */
function belowOverviewTop(x: number, y: number, z: number): boolean {
  scratchP.set(x, y, z).project(overviewCamera)
  return scratchP.y <= 1
}

/**
 * Whether nearer authored terrain hides a point from the overview camera: the ray from the camera
 * is marched over the lowest range the product shows (band 2, so taller bands hide at least as
 * much) in 2 m steps; blocked if it dips under the ground more than 6 m before the point.
 */
function occludedFromOverview(x: number, y: number, z: number): boolean {
  const [cx, cy, cz] = edgePosePosition(OVERVIEW_POSE)
  const dx = x - cx
  const dy = y - cy
  const dz = z - cz
  const length = Math.hypot(dx, dy, dz)
  for (let t = 20; t < length - 6; t += 2) {
    const k = t / length
    const px = cx + dx * k
    const pz = cz + dz * k
    if (Math.max(Math.abs(px), Math.abs(pz)) > PLATE) continue
    if (cy + dy * k < sampleTerrain(layout, px, pz, profile, peaks).height) return true
  }
  return false
}

describe('back of the range: the authored side', () => {
  it('keeps the overview pose pixel-identical: no easing anywhere the overview frame can see', () => {
    let seen = 0
    let hidden = 0
    for (let x = -PLATE; x <= PLATE; x += 2) {
      for (let z = -PLATE; z <= PLATE; z += 2) {
        // Only land and shelf matter: the sea floor is under the water disc and never reaches a pixel.
        if (!(landField(layout, x, z) > -3 || shelfField(layout, x, z) > -3)) continue
        const y = sampleTerrain(layout, x, z, profile, peaks).height
        // The ground, anything standing on it (a house, the lighthouse), and the peak above it.
        const column = [y, y + 6, y + 14, y + mountainHeight(mountainPeaks(layout, mountainProfile(1)), x, z).height + 20]
        const visible = column.filter((h) => inOverviewFrame(x, h, z))
        if (visible.length === 0) continue
        seen++
        const gated = backFade(layout, x, z) > 0 || backColourZone(layout, x, z) || overviewEase(layout, x, z) > 0 || coastRampWidth(layout, x, z) !== 1.6
        if (!gated) continue
        // A gate may be open in frame only where the whole column is hidden behind nearer terrain.
        hidden++
        for (const h of visible) expect(occludedFromOverview(x, h, z), `${x},${z} at ${h.toFixed(1)} m is in frame and not hidden, yet eased`).toBe(true)
      }
    }
    expect(seen).toBeGreaterThan(6000)
    // Sanity: the occlusion escape is used only for the mountains' back feet, not wholesale.
    expect(hidden / seen).toBeLessThan(0.08)
  })

  it("derives the overview's frame from the pose maths: anything in frame anywhere in a 45 m column is never 'outside'", () => {
    let agree = 0
    let total = 0
    for (let x = -170; x <= 170; x += 3) {
      for (let z = -170; z <= 170; z += 3) {
        const inFrame = OVERVIEW_COLUMN.some((y) => inOverviewFrame(x, y, z))
        const outside = overviewOutside(layout, x, z)
        if (inFrame) expect(outside, `${x},${z} is in frame`).toBe(0)
        // Points past the top edge are "outside" only by `backFade`; the frustum test ignores the top.
        const belowTop = OVERVIEW_COLUMN.some((y) => belowOverviewTop(x, y, z))
        if (outside > 0.5 && belowTop) expect(inFrame, `${x},${z} is ${outside.toFixed(1)} m outside`).toBe(false)
        if (!belowTop) continue
        total++
        if (inFrame === (outside === 0)) agree++
      }
    }
    expect(agree / total).toBeGreaterThan(0.98)
  })

  it('samples the seam with whatever band the plate was built with, and every value beyond it is finite', () => {
    for (const fraction of [0.62, 0.8, 1]) {
      const p = mountainProfile(fraction)
      const w = createOuterWorld(layout, 7, { mountainProfile: p })
      const pk = mountainPeaks(layout, p)
      for (let x = -PLATE; x <= PLATE; x += 2) {
        for (const z of [-PLATE - 1, -PLATE - 6, -PLATE - 15]) {
          const s = w.sample(x, z)
          expect(Number.isFinite(s.haze) && s.haze >= 0 && s.haze <= 1, `haze at ${x},${z} band ${p.band}: ${s.haze}`).toBe(true)
          expect(Number.isFinite(s.height)).toBe(true)
        }
      }
      for (let x = -PLATE; x <= PLATE; x += 1) {
        expect(w.seamHeight(x, -PLATE)).toBe(sampleTerrain(layout, x, -PLATE, p, pk).height)
        // Our field evaluated on the seam line itself equals the plate (the back rows' skirts included).
        expect(Math.abs(w.sample(x, -PLATE).height - w.seamHeight(x, -PLATE)), `band ${p.band} x=${x}`).toBeLessThan(0.75)
      }
    }
    expect(createOuterWorld(layout, 7, { mountainProfile: mountainProfile(1) })).not.toBe(world)
  })

  it('eases the foothill belt down to a low snowfield behind the range', () => {
    for (const x of [-60, -40, -20, 0, 20]) {
      const arc = rangeArcZ(layout, x)
      const nearEdge = sampleTerrain(layout, x, Math.max(-PLATE, arc - backFadeOnset(x) + 4), profile, peaks).height
      // Where the fade has completed and before our own rows begin.
      const far = world.sample(x, arc - backFadeOnset(x) - 86)
      expect(far.material, `x=${x}`).not.toBe('mountain')
      expect(nearEdge - far.height, `x=${x}`).toBeGreaterThan(3)
      expect(far.height).toBeGreaterThan(layout.seaLevel + 1)
      expect(far.height).toBeLessThan(layout.groundHeight + 5)
    }
    expect(backFade(layout, 0, -PLATE)).toBeGreaterThan(0)
    expect(backFade(layout, 0, -140)).toBe(0)
  })

  it('has no ice or sea material within 14 m of the north edge where the range stands', () => {
    for (let x = -105; x <= 105; x += 1) {
      for (const z of [-PLATE, -PLATE + 4, -PLATE + 8, -PLATE + 14]) {
        const s = sampleTerrain(layout, x, z, profile, peaks)
        expect(s.material, `${x},${z}`).not.toBe('ice')
        expect(s.material, `${x},${z}`).not.toBe('sea')
        expect(s.height).toBeGreaterThan(layout.seaLevel + 1)
      }
    }
  })

  it('never flags a face flatter than 35° as a cliff on the north boundary, and never any face behind the range', () => {
    const flat35 = Math.cos((35 * Math.PI) / 180)
    expect(STEEP_NY).toBeLessThanOrEqual(flat35)
    for (let x = -PLATE; x <= PLATE; x += 2) {
      for (const z of [-PLATE, -PLATE + 2, -PLATE + NORTH_FRINGE_BAND - 1]) {
        expect(cliffFace(layout, x, z, flat35, 'snow')).toBe(false)
        expect(cliffFace(layout, x, z, 0.2, 'snow')).toBe(false)
        expect(cliffFace(layout, x, z, 0.2, 'ice')).toBe(false)
      }
      // Behind the range (the eased zone), steep snow is a slope into the outer world, not a cliff.
      const z = rangeArcZ(layout, x) - backFadeOnset(x) - 30
      if (z > -PLATE) expect(cliffFace(layout, x, z, 0.2, 'snow')).toBe(false)
    }
    // The coasts the overview sees keep their cliff ice; the ones it cannot see do not.
    expect(cliffFace(layout, 0, 60, 0.2, 'snow')).toBe(true)
    expect(cliffFace(layout, 60, 50, 0.2, 'snow')).toBe(true)
    expect(cliffFace(layout, 140, 20, 0.2, 'snow')).toBe(false)
    expect(cliffFace(layout, -120, 44, 0.2, 'ice')).toBe(false)
  })

  it('turns the back shores into slopes: ≥ 97 % under 35°, none over 45° (the rest are the 1–3 m rock knuckles)', () => {
    const slope35 = Math.tan((35 * Math.PI) / 180)
    const slope45 = 1
    let shores = 0
    let gentle = 0
    const sampleAny = (x: number, z: number) => (Math.max(Math.abs(x), Math.abs(z)) < PLATE ? sampleTerrain(layout, x, z, profile, peaks).height : world.sample(x, z).height)
    for (let x = -260; x <= 260; x += 3) {
      for (let z = -300; z <= -140; z += 3) {
        if (backFade(layout, x, z) < 0.5) continue
        const land = landField(layout, x, z)
        if (land < -30 || land > 30) continue
        shores++
        const e = 1.5
        const gx = (sampleAny(x + e, z) - sampleAny(x - e, z)) / (2 * e)
        const gz = (sampleAny(x, z + e) - sampleAny(x, z - e)) / (2 * e)
        const slope = Math.hypot(gx, gz)
        if (slope < slope35) gentle++
        expect(slope, `slope at ${x},${z}`).toBeLessThan(slope45)
      }
    }
    expect(shores).toBeGreaterThan(300)
    expect(gentle / shores).toBeGreaterThan(0.97)
  })

  it('ramps the east and west coasts and the shelf front wherever the overview cannot see them', () => {
    const slope35 = Math.tan((35 * Math.PI) / 180)
    let shores = 0
    let gentle = 0
    let steepest = 0
    const h = (x: number, z: number) => sampleTerrain(layout, x, z, profile, peaks).height
    for (let x = -168; x <= 168; x += 2) {
      for (let z = -140; z <= 168; z += 2) {
        if (overviewEase(layout, x, z) < 0.99) continue
        if (headlandField(layout, x, z) > -8 || miniIslandField(layout, x, z) > -8) continue
        const land = landField(layout, x, z)
        const shelf = shelfField(layout, x, z)
        // The coast band only: not the mountains' flanks or skirts, nor the foothill belt further in.
        if ((land < -30 || land > 18) && (shelf < -30 || shelf > 30)) continue
        if (mountainHeight(peaks, x, z).height > 0.3) continue
        shores++
        const e = 1
        const slope = Math.hypot((h(x + e, z) - h(x - e, z)) / (2 * e), (h(x, z + e) - h(x, z - e)) / (2 * e))
        if (slope < slope35) gentle++
        steepest = Math.max(steepest, slope)
      }
    }
    expect(shores).toBeGreaterThan(400)
    expect(gentle / shores).toBeGreaterThan(0.97)
    expect(steepest).toBeLessThan(1)
    // Inside the frame the coast is still the authored 1.6 m cliff.
    expect(coastRampWidth(layout, -40, 60)).toBe(1.6)
    expect(coastRampWidth(layout, 20, 70)).toBe(1.6)
    // Out of frame (the shelf's far south-west corner, the sea east of the research island) it is the full ramp.
    expect(coastRampWidth(layout, -120, 44)).toBeGreaterThan(34)
    expect(coastRampWidth(layout, 150, 60)).toBeCloseTo(36, 0)
    // The shelf's west front (x ≈ −105) is inside the overview frustum, so it keeps its authored lip.
    expect(coastRampWidth(layout, -105, 0)).toBe(1.6)
  })

  it('carries the snowfield straight from the plate into the northern mass: no water behind the range', () => {
    for (let x = -100; x <= 100; x += 4) {
      for (let z = -PLATE - 2; z >= -300; z -= 4) {
        const s = world.sample(x, z)
        expect(s.height, `${x},${z}`).toBeGreaterThan(layout.seaLevel + 0.8)
        expect(s.material, `${x},${z}`).not.toBe('sea')
      }
    }
  })
})

describe('back of the range: the seam into the outer world', () => {
  it('is continuous to within 1.5 m everywhere along the back edge', () => {
    for (let x = -PLATE; x <= PLATE; x += 1) {
      const seam = world.seamHeight(x, -PLATE)
      // On the seam line our field equals the plate; one metre out it may only have moved by the
      // ground's own slope (the back rows' skirts reach 56°), never by a step.
      expect(Math.abs(world.sample(x, -PLATE).height - seam), `x=${x}`).toBeLessThan(0.75)
      const slope = Math.abs(world.seamHeight(x, -PLATE + 1) - seam)
      expect(Math.abs(world.sample(x, -PLATE - 1).height - seam), `x=${x}`).toBeLessThan(1.5 + slope)
    }
  })

  it('is continuous to within 1.5 m along the other three edges too', () => {
    for (let t = -PLATE; t <= PLATE; t += 1) {
      for (const [x, z, bx, bz] of [
        [t, PLATE, t, PLATE + 1],
        [-PLATE, t, -PLATE - 1, t],
        [PLATE, t, PLATE + 1, t],
      ]) {
        expect(Math.abs(world.sample(bx, bz).height - world.seamHeight(x, z)), `${x},${z}`).toBeLessThan(1.5)
      }
    }
  })

  it('carries the back land on as snow (never ice or sea) for the first 40 m past the seam where the range stands', () => {
    for (let x = -105; x <= 105; x += 2) {
      for (const z of [-PLATE - 1, -PLATE - 10, -PLATE - 25, -PLATE - 40]) {
        const s = world.sample(x, z)
        expect(s.material === 'snow' || s.material === 'rock' || s.material === 'mountain', `${x},${z}: ${s.material}`).toBe(true)
        expect(s.height).toBeGreaterThan(layout.seaLevel + 1)
      }
    }
  })
})
