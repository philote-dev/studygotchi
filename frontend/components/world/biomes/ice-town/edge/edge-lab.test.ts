import { describe, expect, it } from 'vitest'
import { ICE_FREE_CAMERA_BOX, ICE_FREE_CAMERA_LIMITS, ICE_FREE_LOOK_BOX, clampCameraPosition, clampLookTarget } from '../camera/stations'
import { EDGE_TECHNIQUES, edgeTechniqueFromSearch } from './index'
import { EDGE_POSES, edgePosePosition, poseWithinLimits } from './poses'
import { EDGE_TECHNIQUE_IDS } from './types'

const SOURCES = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/**
 * Harness for the edge-technique swarm. Each technique turns its own rows green by replacing
 * the stub in `edge/<id>.tsx`. The camera and pose rows guard the shared comparison rig.
 */
describe('edge lab rig', () => {
  it('lets the camera orbit fully, drop to the horizon, and reach every coast', () => {
    expect(ICE_FREE_CAMERA_LIMITS.yawDeg).toBe(180)
    expect(ICE_FREE_CAMERA_LIMITS.pitchMinDeg).toBeLessThanOrEqual(14)
    expect(ICE_FREE_CAMERA_LIMITS.southOnly).toBe(false)
    expect(clampLookTarget(-150, 2, -150, ICE_FREE_LOOK_BOX)).toEqual([-150, 2, -150])
    expect(clampLookTarget(150, 2, 150, ICE_FREE_LOOK_BOX)).toEqual([150, 2, 150])
    const north = clampCameraPosition(-60, 40, -250, -110, ICE_FREE_CAMERA_BOX, false)
    expect(north[2]).toBe(-250)
  })

  it('keeps every comparison pose inside the free limits and camera box', () => {
    expect(new Set(EDGE_POSES.map((pose) => pose.id)).size).toBe(EDGE_POSES.length)
    for (const pose of EDGE_POSES) {
      expect(poseWithinLimits(pose), pose.id).toBe(true)
      const [x, y, z] = edgePosePosition(pose)
      expect(clampCameraPosition(x, y, z, pose.target[2], ICE_FREE_CAMERA_BOX, false), pose.id).toEqual([x, y, z])
      expect(clampLookTarget(...pose.target, ICE_FREE_LOOK_BOX), pose.id).toEqual(pose.target)
    }
  })

  it('looks outward from all four coasts', () => {
    const outward = EDGE_POSES.filter((pose) => pose.id.endsWith('-out'))
    expect(outward.map((pose) => pose.azimuthDeg).sort((a, b) => a - b)).toEqual([16, 92, 184, 276])
    for (const pose of outward) {
      expect(pose.pitchDeg).toBeLessThanOrEqual(20)
      // The camera sits on the land side of the target, so the view continues past the coast.
      const [x, , z] = edgePosePosition(pose)
      const towardCentre = Math.hypot(x, z) < Math.hypot(pose.target[0], pose.target[2])
      expect(towardCentre, `${pose.id} camera is inboard of its target`).toBe(true)
    }
  })

  it('parses the lab query and ignores unknown techniques', () => {
    expect(edgeTechniqueFromSearch('?edge=sea')?.id).toBe('sea')
    expect(edgeTechniqueFromSearch('?land=8.223&edge=cloudsea')?.id).toBe('cloudsea')
    expect(edgeTechniqueFromSearch('?edge=none')).toBeNull()
    expect(edgeTechniqueFromSearch('?edge=bogus')).toBeNull()
    expect(edgeTechniqueFromSearch('')).toBeNull()
  })
})

describe('edge techniques', () => {
  it('registers all six plus the combination in the menu order', () => {
    expect(EDGE_TECHNIQUES.map((technique) => technique.id)).toEqual(EDGE_TECHNIQUE_IDS)
    expect(new Set(EDGE_TECHNIQUES.map((technique) => technique.name)).size).toBe(7)
  })

  describe.each(EDGE_TECHNIQUE_IDS.map((id) => [id] as const))('%s', (id) => {
    const technique = EDGE_TECHNIQUES.find((entry) => entry.id === id)!

    it('tells Philote what it is and where it comes from', () => {
      expect(technique.lineage.length).toBeGreaterThanOrEqual(16)
      expect(technique.pitch.length).toBeGreaterThanOrEqual(60)
    })

    it('is a built technique, not the stub', () => {
      const source = SOURCES[`./${id}.tsx`]
      expect(source, `source for ${id}`).toBeTypeOf('string')
      expect(source, 'replace the EDGE_STUB marker with a real outer world').not.toMatch(/EDGE_STUB/)
    })

    it('never loosens the lab camera beyond the free limits', () => {
      const camera = technique.camera
      if (!camera) return
      if (camera.pitchMinDeg !== undefined) expect(camera.pitchMinDeg).toBeGreaterThanOrEqual(ICE_FREE_CAMERA_LIMITS.pitchMinDeg)
      if (camera.pitchMaxDeg !== undefined) expect(camera.pitchMaxDeg).toBeLessThanOrEqual(ICE_FREE_CAMERA_LIMITS.pitchMaxDeg)
      if (camera.minDistance !== undefined) expect(camera.minDistance).toBeGreaterThanOrEqual(ICE_FREE_CAMERA_LIMITS.minDistance)
      if (camera.maxDistance !== undefined) expect(camera.maxDistance).toBeLessThanOrEqual(ICE_FREE_CAMERA_LIMITS.maxDistance)
    })
  })
})
