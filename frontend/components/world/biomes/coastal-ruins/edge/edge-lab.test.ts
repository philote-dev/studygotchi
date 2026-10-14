import { describe, expect, it } from 'vitest'
import { COASTAL_RUINS_LAYOUT as L } from '../layout/biome-layout'
import { sampleTerrain } from '../layout/terrain'
import {
  COASTAL_CAMERA_BOX,
  COASTAL_CAMERA_LIMITS,
  COASTAL_LOOK_BOX,
  STATIONS,
  clampCameraPosition,
  clampLookTarget,
  defaultOverride,
  overviewSubject,
  poseFor,
} from '../camera/stations'
import { EDGE_POSES, edgePose, edgePosePosition, poseWithinLimits, viewBearingDeg } from './poses'
import { edgeModeFromSearch, edgeLabFromSearch } from './use-edge-lab'

describe('coastal edge lab poses', () => {
  it('has 6–8 unique poses, all reachable under the free limits and inside the camera and look boxes', () => {
    expect(EDGE_POSES.length).toBeGreaterThanOrEqual(6)
    expect(EDGE_POSES.length).toBeLessThanOrEqual(8)
    expect(new Set(EDGE_POSES.map((pose) => pose.id)).size).toBe(EDGE_POSES.length)
    for (const pose of EDGE_POSES) {
      expect(poseWithinLimits(pose), pose.id).toBe(true)
      const [x, y, z] = edgePosePosition(pose)
      expect(clampCameraPosition(x, y, z, COASTAL_CAMERA_BOX), `${pose.id} camera outside the box`).toEqual([x, y, z])
      expect(clampLookTarget(...pose.target, COASTAL_LOOK_BOX), `${pose.id} target outside the land`).toEqual(pose.target)
      expect(pose.why.length).toBeGreaterThan(20)
    }
  })

  it('overview is the product pose: same camera and target as the overview station, in metres', () => {
    const pose = edgePose('overview')!
    const station = poseFor(STATIONS.overview, defaultOverride(STATIONS.overview), overviewSubject(L), 16 / 9)
    const s = L.renderScale
    const position = edgePosePosition(pose)
    for (let i = 0; i < 3; i++) {
      expect(position[i] * s).toBeCloseTo(station.position[i], 6)
      expect(pose.target[i] * s).toBeCloseTo(station.target[i], 6)
    }
  })

  it('looks outward from all four sides at pitch 14–18°, one of them straight out to sea', () => {
    const outward = EDGE_POSES.filter((pose) => pose.id.endsWith('-out'))
    expect(outward).toHaveLength(4)
    const bearings = outward.map((pose) => viewBearingDeg(pose)).sort((a, b) => a - b)
    // South (0°), east (~90°), north (180°), west (~270°) within 30° each.
    expect(bearings.map((b) => Math.round(b / 90) * 90 % 360).sort((a, b) => a - b)).toEqual([0, 90, 180, 270])
    for (const pose of outward) {
      expect(pose.pitchDeg).toBeGreaterThanOrEqual(14)
      expect(pose.pitchDeg).toBeLessThanOrEqual(18)
      // The camera sits inboard of its target so the view continues past the coast.
      const [x, , z] = edgePosePosition(pose)
      expect(Math.hypot(x, z), `${pose.id} camera is inboard of its target`).toBeLessThan(Math.hypot(pose.target[0], pose.target[2]) + 1)
    }
    const south = edgePose('south-out')!
    expect(Math.abs(viewBearingDeg(south))).toBeLessThan(5)
    // Straight out to sea: the target and the far view ray are open water.
    expect(sampleTerrain(L, south.target[0], south.target[2]).material).toBe('sea')
    const [cx, , cz] = edgePosePosition(south)
    for (let d = 200; d <= 380; d += 60) {
      const x = cx + Math.sin((viewBearingDeg(south) * Math.PI) / 180) * d
      const z = cz + Math.cos((viewBearingDeg(south) * Math.PI) / 180) * d
      expect(sampleTerrain(L, x, z).material, `south ray at ${d} m`).toBe('sea')
    }
  })

  it('has a 12° low horizon and a maximum zoom at the distance limit', () => {
    const low = edgePose('low-horizon')!
    expect(low.pitchDeg).toBe(12)
    expect(low.pitchDeg).toBe(COASTAL_CAMERA_LIMITS.pitchMinDeg)
    const zoom = edgePose('zoom-max')!
    expect(zoom.distance).toBe(COASTAL_CAMERA_LIMITS.maxDistance)
    const horizon = edgePose('horizon-max')!
    expect(horizon.distance).toBe(COASTAL_CAMERA_LIMITS.maxDistance)
    expect(horizon.pitchDeg).toBe(COASTAL_CAMERA_LIMITS.pitchMinDeg)
  })
})

describe('coastal edge lab query', () => {
  it('defaults to the outer world and only `none` turns it off', () => {
    expect(edgeModeFromSearch('')).toBe('outer')
    expect(edgeModeFromSearch('?land=16.C20')).toBe('outer')
    expect(edgeModeFromSearch('?edge=outer')).toBe('outer')
    expect(edgeModeFromSearch('?edge=none')).toBe('none')
    expect(edgeModeFromSearch('?edge=bogus')).toBe('outer')
  })

  it('opens the lab (panel, fixed poses) when an edge or pose param is present', () => {
    expect(edgeLabFromSearch('').active).toBe(false)
    expect(edgeLabFromSearch('?edge=none').active).toBe(true)
    expect(edgeLabFromSearch('?pose=south-out')).toMatchObject({ active: true, mode: 'outer', pose: 'south-out' })
    expect(edgeLabFromSearch('?edge=outer&pose=nowhere').pose).toBeNull()
  })
})
