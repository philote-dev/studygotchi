import { describe, expect, it } from 'vitest'
import {
  CAMERA_LIMITS,
  MEADOW_CAMERA_BOX,
  MEADOW_FREE_CAMERA_LIMITS,
  MEADOW_LOOK_BOX,
  STATIONS,
  clampCameraPosition,
  clampLookTarget,
  insideBox,
  overviewPose,
} from '../camera/stations'
import { generateKingdom } from '../layout/biome-layout'
import { cloudHalfHeight, cloudPlacements, sampleTerrain } from '../layout/terrain'
import { EDGE_POSES, FRAME, edgePose, edgePosePosition, frameTopDeg, inOverviewFrustum, poseWithinLimits, viewBearingDeg } from './poses'
import { DEFAULT_EDGE_MODE, EDGE_MODES, EDGE_PITCH, isEdgeMode } from './types'
import { readEdgeLab } from './use-edge-lab'

describe('meadow edge lab: camera', () => {
  it('orbits fully, drops to a 12° horizon look, pulls back to 380 m, looks only at the land and sits inside ±460 m', () => {
    expect(MEADOW_FREE_CAMERA_LIMITS.yawDeg).toBe(180)
    expect(MEADOW_FREE_CAMERA_LIMITS.pitchMinDeg).toBe(12)
    expect(MEADOW_FREE_CAMERA_LIMITS.pitchMaxDeg).toBe(64)
    expect(MEADOW_FREE_CAMERA_LIMITS.minDistance).toBe(40)
    expect(MEADOW_FREE_CAMERA_LIMITS.maxDistance).toBe(380)
    expect(MEADOW_CAMERA_BOX.min).toEqual([-460, 10, -460])
    expect(MEADOW_CAMERA_BOX.max).toEqual([460, 300, 460])
    // The look box is the authored world.
    expect(MEADOW_LOOK_BOX.max[0]).toBeGreaterThanOrEqual(139)
    expect(MEADOW_LOOK_BOX.max[2]).toBeGreaterThanOrEqual(130)
    expect(MEADOW_LOOK_BOX.max[0]).toBeLessThan(200)
    expect(clampLookTarget(-500, 2, 500)).toEqual([-140, 2, 135])
    expect(clampCameraPosition(900, 5, -900)).toEqual([460, 10, -460])
    expect(insideBox(MEADOW_CAMERA_BOX, 0, 100, 0)).toBe(true)
    // The station values (the shared diorama contract) are untouched and reachable under the free limits.
    expect(CAMERA_LIMITS.pitchMinDeg).toBe(34)
    for (const station of Object.values(STATIONS)) {
      expect(station.pitchDeg).toBeGreaterThanOrEqual(MEADOW_FREE_CAMERA_LIMITS.pitchMinDeg)
      expect(station.pitchDeg).toBeLessThanOrEqual(MEADOW_FREE_CAMERA_LIMITS.pitchMaxDeg)
    }
    const product = overviewPose(16 / 9)
    expect(insideBox(MEADOW_CAMERA_BOX, ...product.position)).toBe(true)
  })
})

describe('meadow edge lab: poses', () => {
  it('has eight unique poses: the product overview, four outward looks at 14–16°, a 12° low horizon and two maximum-zoom looks', () => {
    expect(EDGE_POSES).toHaveLength(8)
    expect(new Set(EDGE_POSES.map((pose) => pose.id)).size).toBe(8)
    const outward = EDGE_POSES.filter((pose) => pose.id.endsWith('-out'))
    expect(outward).toHaveLength(4)
    for (const pose of outward) {
      expect(pose.pitchDeg).toBeGreaterThanOrEqual(14)
      expect(pose.pitchDeg).toBeLessThanOrEqual(18)
      // The frame top sits above the horizon: the horizon line is in every outward frame.
      expect(frameTopDeg(pose)).toBeLessThan(0)
    }
    expect(edgePose('low-horizon')?.pitchDeg).toBe(12)
    expect(edgePose('horizon-max')?.pitchDeg).toBe(12)
    expect(edgePose('zoom-max')?.distance).toBe(MEADOW_FREE_CAMERA_LIMITS.maxDistance)
    expect(edgePose('bogus')).toBeNull()
    expect(FRAME.fovDeg).toBe(STATIONS.overview.fov)
  })

  it('keeps every pose inside the free limits, the camera box and the look box', () => {
    for (const pose of EDGE_POSES) {
      expect(poseWithinLimits(pose), pose.id).toBe(true)
      const [x, y, z] = edgePosePosition(pose)
      expect(clampCameraPosition(x, y, z), pose.id).toEqual([x, y, z])
      expect(clampLookTarget(...pose.target), pose.id).toEqual(pose.target)
    }
  })

  it('makes the overview pose the product overview at 16:9', () => {
    const product = overviewPose(16 / 9)
    const pose = edgePose('overview')!
    const [x, y, z] = edgePosePosition(pose)
    expect(x).toBeCloseTo(product.position[0], 1)
    expect(y).toBeCloseTo(product.position[1], 1)
    expect(z).toBeCloseTo(product.position[2], 1)
    expect(pose.target).toEqual(product.target)
    expect(inOverviewFrustum(0, 0, 0, 16 / 9)).toBe(true)
    expect(inOverviewFrustum(0, 0, -400, 16 / 9)).toBe(false)
    expect(inOverviewFrustum(0, 0, 100, 16 / 9)).toBe(false)
  })

  it('looks outward from all four sides, from inboard of the target', () => {
    const outward = EDGE_POSES.filter((pose) => pose.id.endsWith('-out'))
    expect(outward.map((pose) => viewBearingDeg(pose)).sort((a, b) => a - b)).toEqual([4, 98, 188, 272])
    for (const pose of outward) {
      const [x, , z] = edgePosePosition(pose)
      expect(Math.hypot(x, z), `${pose.id} camera is inboard of its target`).toBeLessThan(Math.hypot(pose.target[0], pose.target[2]) + 60)
    }
  })
})

describe('meadow edge lab: sky', () => {
  it('keeps every cloud above the eye line of every 12° pose, wherever it has drifted, so none reads as a boulder on the far fields', () => {
    const layout = generateKingdom(7)
    const clouds = cloudPlacements(layout)
    expect(clouds).toHaveLength(8)
    const lowPoses = EDGE_POSES.filter((pose) => pose.pitchDeg <= 12)
    expect(lowPoses.map((pose) => pose.id).sort()).toEqual(['horizon-max', 'low-horizon'])
    for (const pose of lowPoses) {
      const camY = edgePosePosition(pose)[1]
      for (const cloud of clouds) {
        const bottom = cloud.y - cloudHalfHeight(cloud.scale)
        expect(bottom, `${pose.id}: cloud at ${cloud.y.toFixed(0)} m dips to the eye line (${camY.toFixed(0)} m)`).toBeGreaterThan(camY + 6)
      }
    }
    // And they still pass under the 38° overview camera, so they are not lost from the product sky altogether.
    const overviewY = overviewPose(16 / 9).position[1]
    for (const cloud of clouds) expect(cloud.y + cloudHalfHeight(cloud.scale)).toBeLessThan(overviewY + 20)
  })

  it('moves the east and west looks off the roofs: the ground at each outward frame\u2019s bottom centre is open meadow or water', () => {
    const layout = generateKingdom(7)
    for (const pose of EDGE_POSES.filter((p) => p.id.endsWith('-out'))) {
      const [cx, cy, cz] = edgePosePosition(pose)
      const bearing = ((pose.azimuthDeg + 180) * Math.PI) / 180
      const down = ((pose.pitchDeg + STATIONS.overview.fov / 2) * Math.PI) / 180
      const d = (cy - 0) / Math.tan(down)
      const x = cx + Math.sin(bearing) * d
      const z = cz + Math.cos(bearing) * d
      const sample = sampleTerrain(layout, x, z)
      expect(sample.districtId, `${pose.id} looks down onto ${sample.districtId} at ${x.toFixed(0)},${z.toFixed(0)}`).toBeNull()
    }
  })
})

describe('meadow edge lab: modes and the URL', () => {
  it('defaults to the outer world, parses none / outer, and treats unknown ids as the baseline with the lab on', () => {
    expect(EDGE_MODES).toEqual(['none', 'outer'])
    expect(DEFAULT_EDGE_MODE).toBe('outer')
    expect(isEdgeMode('outer')).toBe(true)
    expect(isEdgeMode('sea')).toBe(false)
    expect(readEdgeLab('')).toEqual({ active: false, mode: 'outer', pose: null })
    expect(readEdgeLab('?land=18.06')).toEqual({ active: false, mode: 'outer', pose: null })
    expect(readEdgeLab('?land=18.06&edge=none')).toEqual({ active: true, mode: 'none', pose: null })
    expect(readEdgeLab('?edge=outer&pose=north-out')).toEqual({ active: true, mode: 'outer', pose: 'north-out' })
    expect(readEdgeLab('?edge=bogus&pose=nope')).toEqual({ active: true, mode: 'none', pose: null })
  })

  it('tells Philote what it is and where it comes from', () => {
    expect(EDGE_PITCH.lineage.length).toBeGreaterThan(40)
    expect(EDGE_PITCH.pitch.length).toBeGreaterThan(120)
  })
})
