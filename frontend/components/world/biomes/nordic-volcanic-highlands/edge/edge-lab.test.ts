import { describe, expect, it } from 'vitest'
import { CAMERA_BOX, CAMERA_LIMITS, FREE_CAMERA_LIMITS, LOOK_BOX, STATIONS, clampToBox, insideBox } from '../camera/stations'
import { EDGE_TECHNIQUES, edgeTechnique } from './index'
import { EDGE_POSES, edgePosePosition, poseWithinLimits } from './poses'
import { DEFAULT_TECHNIQUE, EDGE_TECHNIQUE_IDS } from './types'
import { readEdgeLab } from './use-edge-lab'

describe('edge lab rig', () => {
  it('lets the camera orbit fully, drop to the horizon and reach every coast, while the stations keep the diorama values', () => {
    expect(FREE_CAMERA_LIMITS.yawDeg).toBe(180)
    expect(FREE_CAMERA_LIMITS.pitchMinDeg).toBe(12)
    expect(FREE_CAMERA_LIMITS.pitchMaxDeg).toBe(64)
    expect(FREE_CAMERA_LIMITS.minDistance).toBeGreaterThanOrEqual(40)
    expect(FREE_CAMERA_LIMITS.maxDistance).toBeGreaterThanOrEqual(420)
    // Shared contract: the station values are untouched.
    for (const station of Object.values(STATIONS)) {
      expect(station.pitchDeg).toBeGreaterThanOrEqual(CAMERA_LIMITS.pitchMin)
      expect(station.pitchDeg).toBeLessThanOrEqual(CAMERA_LIMITS.pitchMax)
      expect(Math.abs(station.azimuthDeg)).toBeLessThanOrEqual(CAMERA_LIMITS.yaw)
    }
    // Look box = the authored land; camera box ≈ ±460 m.
    expect(LOOK_BOX.max[0]).toBeGreaterThanOrEqual(160)
    expect(LOOK_BOX.max[2]).toBeGreaterThanOrEqual(145)
    expect(CAMERA_BOX.max[0]).toBe(460)
    expect(CAMERA_BOX.min[2]).toBe(-460)
    expect(clampToBox(LOOK_BOX, -400, 2, 400)).toEqual([LOOK_BOX.min[0], 2, LOOK_BOX.max[2]])
    expect(insideBox(CAMERA_BOX, 0, 10, 0)).toBe(true)
    expect(insideBox(CAMERA_BOX, 0, 5, 0)).toBe(false)
  })

  it('keeps every comparison pose inside the free limits, the look box and the camera box', () => {
    // 8 edge poses + 5 district stations + 2 walking-height views (the inhabited-land audit).
    expect(EDGE_POSES.filter((pose) => !pose.id.startsWith('district-') && !pose.id.startsWith('walk-')).length).toBe(8)
    expect(EDGE_POSES.filter((pose) => pose.id.startsWith('district-')).length).toBe(5)
    expect(EDGE_POSES.filter((pose) => pose.id.startsWith('walk-')).length).toBe(2)
    for (const pose of EDGE_POSES.filter((pose) => pose.id.startsWith('walk-'))) {
      expect(pose.pitchDeg).toBe(14)
      expect(pose.distance).toBe(60)
    }
    expect(new Set(EDGE_POSES.map((pose) => pose.id)).size).toBe(EDGE_POSES.length)
    for (const pose of EDGE_POSES) {
      expect(poseWithinLimits(pose), pose.id).toBe(true)
      const [x, y, z] = edgePosePosition(pose)
      expect(insideBox(CAMERA_BOX, x, y, z), `${pose.id} camera`).toBe(true)
      expect(insideBox(LOOK_BOX, ...pose.target), `${pose.id} target`).toBe(true)
    }
  })

  it('has the required poses: the overview, four outward looks at 14–18° (one down the fjord), a 12° horizon and the maximum zoom', () => {
    const ids = EDGE_POSES.map((pose) => pose.id)
    expect(ids).toContain('overview')
    const outward = EDGE_POSES.filter((pose) => pose.id.endsWith('-out'))
    expect(outward).toHaveLength(4)
    expect(outward.map((pose) => pose.azimuthDeg).sort((a, b) => a - b)).toEqual([0, 90, 180, 270])
    for (const pose of outward) {
      expect(pose.pitchDeg).toBeGreaterThanOrEqual(14)
      expect(pose.pitchDeg).toBeLessThanOrEqual(18)
      // The camera sits inboard of its target, so the view continues past the plate.
      const [x, , z] = edgePosePosition(pose)
      expect(Math.hypot(x, z) < Math.hypot(pose.target[0], pose.target[2]), `${pose.id} camera is inboard of its target`).toBe(true)
    }
    // Down the fjord: the south look sits over the fjord (x near the channel) and looks south along it.
    const south = EDGE_POSES.find((pose) => pose.id === 'south-out')!
    expect(Math.abs(south.target[0])).toBeLessThan(30)
    expect(south.azimuthDeg).toBe(180)
    expect(EDGE_POSES.find((pose) => pose.id === 'low-horizon')!.pitchDeg).toBe(12)
    expect(Math.max(...EDGE_POSES.map((pose) => pose.distance))).toBe(420)
    // The overview pose is the product station at 16:9.
    const overview = EDGE_POSES.find((pose) => pose.id === 'overview')!
    expect(overview.pitchDeg).toBe(STATIONS.overview.pitchDeg)
    expect(overview.azimuthDeg).toBe(STATIONS.overview.azimuthDeg)
  })

  it('parses the lab query: outer by default, none for the baseline, unknown ids fall back to the baseline', () => {
    expect(readEdgeLab('')).toEqual({ active: false, technique: DEFAULT_TECHNIQUE, pose: null })
    expect(readEdgeLab('?land=18.03')).toEqual({ active: false, technique: 'outer', pose: null })
    expect(readEdgeLab('?edge=outer&pose=north-out')).toEqual({ active: true, technique: 'outer', pose: 'north-out' })
    expect(readEdgeLab('?edge=none&pose=overview')).toEqual({ active: true, technique: null, pose: 'overview' })
    expect(readEdgeLab('?edge=bogus')).toEqual({ active: true, technique: null, pose: null })
    expect(readEdgeLab('?pose=zoom-max')).toEqual({ active: true, technique: 'outer', pose: 'zoom-max' })
    expect(readEdgeLab('?pose=nope').pose).toBeNull()
  })

  it('registers the composed outer technique with its lineage and pitch', () => {
    expect(EDGE_TECHNIQUES.map((technique) => technique.id)).toEqual(EDGE_TECHNIQUE_IDS)
    const outer = edgeTechnique('outer')!
    expect(outer.lineage.length).toBeGreaterThanOrEqual(16)
    expect(outer.pitch.length).toBeGreaterThanOrEqual(60)
    expect(edgeTechnique(null)).toBeNull()
  })
})
