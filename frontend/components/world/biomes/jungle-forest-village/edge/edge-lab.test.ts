import { describe, expect, it } from 'vitest'
import { JUNGLE_CAMERA_BOX, JUNGLE_CAMERA_LIMITS, JUNGLE_LOOK_AT, JUNGLE_LOOK_BOX, OVERVIEW_DISTANCE, STATIONS, clampToBox } from '../camera/stations'
import { edgeLabFromSearch, edgeModeFromSearch } from './edge-lab'
import { EDGE_POSES, edgePose, edgePosePosition, poseWithinLimits, viewBearingDeg } from './poses'

describe('jungle edge lab rig', () => {
  it('frees the camera: full orbit, 12–64° pitch, boxed look-at over the land, camera box ±460 m', () => {
    expect(JUNGLE_CAMERA_LIMITS.yawDeg).toBe(180)
    expect(JUNGLE_CAMERA_LIMITS.pitchMinDeg).toBe(12)
    expect(JUNGLE_CAMERA_LIMITS.pitchMaxDeg).toBe(64)
    expect(JUNGLE_CAMERA_LIMITS.minDistance).toBeGreaterThanOrEqual(40)
    expect(JUNGLE_CAMERA_LIMITS.maxDistance).toBeLessThanOrEqual(380)
    expect(JUNGLE_LOOK_BOX.max[0]).toBeGreaterThanOrEqual(144)
    expect(JUNGLE_LOOK_BOX.max[2]).toBeGreaterThanOrEqual(132)
    expect(JUNGLE_CAMERA_BOX.max[0]).toBe(460)
    expect(JUNGLE_CAMERA_BOX.min[2]).toBe(-460)
    expect(clampToBox(JUNGLE_LOOK_BOX, 300, 2, -300)).toEqual([150, 2, -140])
  })

  it('keeps the station values of the diorama contract', () => {
    for (const station of Object.values(STATIONS)) {
      expect(station.pitchDeg).toBeGreaterThanOrEqual(34)
      expect(station.pitchDeg).toBeLessThanOrEqual(40)
      expect(Math.abs(station.azimuthDeg)).toBeLessThanOrEqual(35)
      expect(station.pitchDeg).toBeGreaterThanOrEqual(JUNGLE_CAMERA_LIMITS.pitchMinDeg)
      expect(station.pitchDeg).toBeLessThanOrEqual(JUNGLE_CAMERA_LIMITS.pitchMaxDeg)
    }
  })

  it('has 8 unique poses, every one inside the free limits and both boxes', () => {
    expect(EDGE_POSES).toHaveLength(8)
    expect(new Set(EDGE_POSES.map((pose) => pose.id)).size).toBe(8)
    for (const pose of EDGE_POSES) expect(poseWithinLimits(pose), pose.id).toBe(true)
  })

  it('makes the overview pose the product overview station exactly', () => {
    const overview = edgePose('overview')!
    expect(overview.target).toEqual(JUNGLE_LOOK_AT)
    expect(overview.pitchDeg).toBe(STATIONS.overview.pitchDeg)
    expect(overview.azimuthDeg).toBe(STATIONS.overview.azimuthDeg)
    expect(overview.distance).toBe(OVERVIEW_DISTANCE)
    expect(overview.fov).toBe(STATIONS.overview.fov)
  })

  it('looks outward from all four sides at 14–18°, with a 12° low horizon and a max zoom', () => {
    const outward = EDGE_POSES.filter((pose) => pose.id.endsWith('-out'))
    // One look per side; the east look follows the river's course (74°) rather than due east.
    const bearings = outward.map((pose) => viewBearingDeg(pose)).sort((a, b) => a - b)
    expect(bearings).toHaveLength(4)
    for (const [i, side] of [0, 90, 180, 270].entries()) expect(Math.abs(bearings[i] - side)).toBeLessThanOrEqual(20)
    for (const pose of outward) {
      expect(pose.pitchDeg).toBeGreaterThanOrEqual(14)
      expect(pose.pitchDeg).toBeLessThanOrEqual(18)
      const [x, , z] = edgePosePosition(pose)
      expect(Math.hypot(x, z) < Math.hypot(pose.target[0], pose.target[2]), `${pose.id} camera is inboard of its target`).toBe(true)
    }
    expect(edgePose('low-horizon')!.pitchDeg).toBe(12)
    expect(edgePose('horizon-max')!.pitchDeg).toBe(12)
    expect(edgePose('zoom-max')!.distance).toBe(JUNGLE_CAMERA_LIMITS.maxDistance)
  })

  it('parses the lab query: outer is the default, none is the shipped baseline', () => {
    expect(edgeModeFromSearch('')).toBe('outer')
    expect(edgeModeFromSearch('?land=6.1400')).toBe('outer')
    expect(edgeModeFromSearch('?edge=outer')).toBe('outer')
    expect(edgeModeFromSearch('?edge=none')).toBe('none')
    expect(edgeModeFromSearch('?edge=bogus')).toBe('outer')
    expect(edgeLabFromSearch('?land=6.1400')).toEqual({ active: false, mode: 'outer', pose: null })
    expect(edgeLabFromSearch('?edge=none&pose=north-out')).toEqual({ active: true, mode: 'none', pose: 'north-out' })
    expect(edgeLabFromSearch('?pose=nope')).toEqual({ active: true, mode: 'outer', pose: null })
  })
})
