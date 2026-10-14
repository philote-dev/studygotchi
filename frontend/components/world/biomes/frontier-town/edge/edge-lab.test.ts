import { describe, expect, it } from 'vitest'
import { EDGE_LAB_EVENT as ICE_EDGE_LAB_EVENT } from '../../ice-town/edge/use-edge-lab'
import { FRONTIER_CAMERA_BOX, FRONTIER_CAMERA_LIMITS, FRONTIER_FREE_FOV, FRONTIER_LOOK_BOX, cameraReach, orbitOf, orbitPosition } from '../camera/limits'
import { CAMERA_GROUND_CLEARANCE, clearDistance } from '../camera/FreeCameraRig'
import { backdropHeightAt } from '../layout/skyline'
import { createOuterDesert } from './outer/desert'
import { parseCustomCamera } from './use-edge-lab'
import { STATIONS } from '../camera/stations'
import { stationPose } from '../camera/station-pose'
import { defaultOverride } from '../camera/stations'
import { FRONTIER_LAYOUT, dioramaCameraPose, generateLayout } from '../layout/biome-layout'
import type { LabState } from '../state'
import { FRONTIER_POSES, FRONTIER_POSE_IDS, frontierPose, frontierPosePosition, poseWithinLimits } from './poses'
import { DEFAULT_EDGE_MODE, EDGE_MODES, edgeModeFromSearch } from './types'
import { EDGE_LAB_EVENT } from './use-edge-lab'

describe('edge lab rig', () => {
  it('ships the outer world by default and reads `?edge=none|outer`', () => {
    expect(DEFAULT_EDGE_MODE).toBe('outer')
    expect(EDGE_MODES).toEqual(['none', 'outer'])
    expect(edgeModeFromSearch('')).toBe('outer')
    expect(edgeModeFromSearch('?land=8.022')).toBe('outer')
    expect(edgeModeFromSearch('?edge=none')).toBe('none')
    expect(edgeModeFromSearch('?edge=outer&pose=overview')).toBe('outer')
    expect(edgeModeFromSearch('?edge=bogus')).toBe('outer')
    expect(frontierPose('north-out')?.id).toBe('north-out')
    expect(frontierPose('bogus')).toBeNull()
  })

  it('dispatches the ice lab event so the shared capture harness drives this land', () => {
    expect(EDGE_LAB_EVENT).toBe(ICE_EDGE_LAB_EVENT)
  })

  it('lets the camera orbit fully, drop to the horizon, and reach every edge of the plate', () => {
    expect(FRONTIER_CAMERA_LIMITS.yawDeg).toBe(180)
    expect(FRONTIER_CAMERA_LIMITS.pitchMinDeg).toBe(12)
    expect(FRONTIER_CAMERA_LIMITS.pitchMaxDeg).toBe(64)
    expect(FRONTIER_CAMERA_BOX.min[0]).toBeLessThanOrEqual(-460)
    expect(FRONTIER_CAMERA_BOX.max[2]).toBeGreaterThanOrEqual(460)
    // A district (~60 m) fills the frame near the minimum, the whole land fits at the maximum.
    const fov = (FRONTIER_FREE_FOV * Math.PI) / 180
    const halfH = Math.atan(Math.tan(fov / 2) * (16 / 9))
    const widthAt = (d: number) => 2 * d * Math.tan(halfH)
    expect(widthAt(FRONTIER_CAMERA_LIMITS.minDistance)).toBeLessThan(80)
    expect(widthAt(FRONTIER_CAMERA_LIMITS.maxDistance)).toBeGreaterThan(430)
    const reach = cameraReach()
    expect(reach.x).toBeGreaterThan(FRONTIER_LOOK_BOX.max[0])
  })

  it('keeps 8 comparison poses inside the free limits, the camera box and the look box', () => {
    expect(FRONTIER_POSE_IDS).toEqual(['overview', 'north-out', 'east-out', 'south-out', 'west-out', 'low-horizon', 'zoom-max', 'horizon-max'])
    expect(new Set(FRONTIER_POSE_IDS).size).toBe(8)
    for (const pose of FRONTIER_POSES) {
      expect(poseWithinLimits(pose), pose.id).toBe(true)
      const back = orbitOf(frontierPosePosition(pose), pose.target)
      expect(back.pitchDeg).toBeCloseTo(pose.pitchDeg, 6)
      expect(back.distance).toBeCloseTo(pose.distance, 6)
    }
  })

  it('keeps the camera out of the mesas: a low orbit behind the back wall dollies in until it clears', () => {
    const desert = createOuterDesert(7)
    const ground = (x: number, z: number) => Math.max(desert.heightAt(x, z), backdropHeightAt(x, z, 1))
    // Behind the back wall at pitch 12°, 540 m: inside row B / C country.
    const target: [number, number, number] = [0, 20, -200]
    const far = orbitPosition(target, 12, 180, 540)
    const d = clearDistance(target, far, ground, FRONTIER_CAMERA_LIMITS.minDistance)
    expect(d).toBeLessThan(540)
    expect(d).toBeGreaterThanOrEqual(FRONTIER_CAMERA_LIMITS.minDistance)
    const settled = orbitPosition(target, 12, 180, d)
    expect(settled[1]).toBeGreaterThanOrEqual(ground(settled[0], settled[2]) + CAMERA_GROUND_CLEARANCE - 1e-6)
    // Every comparison pose already clears.
    for (const pose of FRONTIER_POSES) {
      const p = frontierPosePosition(pose)
      expect(clearDistance(pose.target, p, ground, FRONTIER_CAMERA_LIMITS.minDistance), pose.id).toBeCloseTo(pose.distance, 6)
    }
  })

  it('parses the QA camera param', () => {
    expect(parseCustomCamera('1,2,3,4,5,6')).toEqual({ position: [1, 2, 3], target: [4, 5, 6] })
    expect(parseCustomCamera('1,2,3')).toBeNull()
    expect(parseCustomCamera('a,2,3,4,5,6')).toBeNull()
    expect(parseCustomCamera(null)).toBeNull()
  })

  it('overview pose is the plan-v4 diorama camera to the millimetre', () => {
    const overview = frontierPose('overview')!
    const diorama = dioramaCameraPose(0, 1, 37)
    const position = frontierPosePosition(overview)
    for (let i = 0; i < 3; i++) {
      expect(position[i]).toBeCloseTo(diorama.position[i], 6)
      expect(overview.target[i]).toBeCloseTo(diorama.target[i], 6)
    }
    expect(orbitPosition(overview.target, overview.pitchDeg, overview.azimuthDeg, overview.distance)[1]).toBeCloseTo(4 + Math.tan((37 * Math.PI) / 180) * 220, 6)
  })

  it('keeps every station exactly where the diorama contract put it (the free camera only starts there)', () => {
    const generated = generateLayout(7)
    const base = (station: LabState['station']): LabState => ({
      progress: Object.fromEntries(FRONTIER_LAYOUT.districts.map((d) => [d.id, 1])),
      residents: 10,
      seed: 7,
      night: false,
      dust: true,
      train: true,
      wildlife: true,
      pixel: true,
      station,
      focusDistrict: null,
      camera: defaultOverride(station),
      catastrophe: { districtId: null, phase: 'calm' },
    })
    const overview = stationPose(base('overview'), generated)
    expect(overview.position).toEqual(dioramaCameraPose(0, 1, 37).position)
    expect(overview.target).toEqual(dioramaCameraPose(0, 1, 37).target)
    expect(overview.fov).toBe(26)
    const arrival = stationPose(base('arrival'), generated)
    expect(arrival.target).toEqual([-22, 4, -5])
    expect(arrival.position[2]).toBe(95)
    for (const station of Object.values(STATIONS)) {
      expect(station.pitchDeg).toBeGreaterThanOrEqual(34)
      expect(station.pitchDeg).toBeLessThanOrEqual(40)
    }
  })
})
