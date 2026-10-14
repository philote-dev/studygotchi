import { describe, expect, it } from 'vitest'
import { COASTAL_RUINS_LAYOUT as L } from '../layout/biome-layout'
import {
  COASTAL_CAMERA_BOX,
  COASTAL_CAMERA_LIMITS,
  COASTAL_LOOK_BOX,
  STATIONS,
  cameraReach,
  clampCameraPosition,
  clampLookTarget,
  defaultOverride,
  overviewSubject,
  poseFor,
  toRender,
} from './stations'

describe('coastal camera stations (diorama values kept, shared contract)', () => {
  it('keeps the shipped station table untouched', () => {
    expect(STATIONS.arrival).toMatchObject({ pitchDeg: 36, azimuthDeg: 12, fov: 27, distance: 72, targetLift: 3.5 })
    expect(STATIONS.overview).toMatchObject({ pitchDeg: 39, azimuthDeg: 0, fov: 27, distance: 76, targetLift: 3 })
    expect(STATIONS.district).toMatchObject({ pitchDeg: 36, azimuthDeg: 20, fov: 27, fitWidth: 0.75 })
    expect(STATIONS.landmark).toMatchObject({ pitchDeg: 36, azimuthDeg: 18, fov: 27, fitWidth: 0.72 })
    expect(STATIONS.resident).toMatchObject({ pitchDeg: 34, azimuthDeg: 12, fov: 27, distance: 10 })
    for (const station of Object.values(STATIONS)) {
      expect(station.pitchDeg).toBeGreaterThanOrEqual(34)
      expect(station.pitchDeg).toBeLessThanOrEqual(40)
      expect(Math.abs(station.azimuthDeg)).toBeLessThanOrEqual(35)
    }
  })

  it('the overview pose is the same numbers as before (the product frame must not move)', () => {
    const subject = overviewSubject(L)
    const pose = poseFor(STATIONS.overview, defaultOverride(STATIONS.overview), subject, 16 / 9)
    // Target: (8, 2.4, 23) m in render units plus the 3-unit lift; camera 76 units away at 39°.
    expect(pose.target[0]).toBeCloseTo(8 * L.renderScale, 9)
    expect(pose.target[1]).toBeCloseTo(L.groundHeight * L.renderScale + 3, 9)
    expect(pose.target[2]).toBeCloseTo(23 * L.renderScale, 9)
    expect(Math.hypot(pose.position[0] - pose.target[0], pose.position[1] - pose.target[1], pose.position[2] - pose.target[2])).toBeCloseTo(76, 9)
    expect(pose.position[0]).toBeCloseTo(pose.target[0], 9)
  })
})

describe('coastal free camera (orbit, pitch 12–64°, look box = land, camera box ≈ ±460 m)', () => {
  it('orbits fully and drops to the horizon', () => {
    expect(COASTAL_CAMERA_LIMITS.yawDeg).toBe(180)
    expect(COASTAL_CAMERA_LIMITS.pitchMinDeg).toBe(12)
    expect(COASTAL_CAMERA_LIMITS.pitchMaxDeg).toBe(64)
    for (const station of Object.values(STATIONS)) {
      expect(station.pitchDeg).toBeGreaterThanOrEqual(COASTAL_CAMERA_LIMITS.pitchMinDeg)
      expect(station.pitchDeg).toBeLessThanOrEqual(COASTAL_CAMERA_LIMITS.pitchMaxDeg)
    }
  })

  it('has sensible distance bounds in metres that still reach every station distance', () => {
    expect(COASTAL_CAMERA_LIMITS.minDistance).toBeGreaterThanOrEqual(30)
    expect(COASTAL_CAMERA_LIMITS.minDistance).toBeLessThanOrEqual(60)
    // Station distances are render units; the limits are metres.
    const overview = STATIONS.overview.distance! / L.renderScale
    const arrival = STATIONS.arrival.distance! / L.renderScale
    const resident = STATIONS.resident.distance! / L.renderScale
    expect(COASTAL_CAMERA_LIMITS.maxDistance).toBeGreaterThanOrEqual(overview)
    expect(COASTAL_CAMERA_LIMITS.maxDistance).toBeGreaterThanOrEqual(arrival)
    expect(COASTAL_CAMERA_LIMITS.minDistance).toBeLessThanOrEqual(resident)
    expect(COASTAL_CAMERA_LIMITS.maxDistance).toBeLessThanOrEqual(600)
  })

  it('look box is the land: every district centre, the escarpment and the headland, not the open sea', () => {
    for (const district of L.districts) {
      const [x, z] = district.nominalCenter
      expect(clampLookTarget(x, 2.4, z)).toEqual([x, 2.4, z])
      for (const [cx, cz] of district.catchment) expect(clampLookTarget(cx, 2.4, cz)).toEqual([cx, 2.4, cz])
    }
    const [hx, hz] = L.headland.center
    expect(clampLookTarget(hx, 2, hz)).toEqual([hx, 2, hz])
    expect(clampLookTarget(0, 2.4, -124)[2]).toBe(-124)
    // Out at sea the look-at is pulled back to the land.
    const sea = clampLookTarget(0, 1, 300)
    expect(sea[2]).toBeLessThan(200)
    expect(COASTAL_LOOK_BOX.max[0] - COASTAL_LOOK_BOX.min[0]).toBeLessThanOrEqual(360)
    expect(COASTAL_LOOK_BOX.max[2] - COASTAL_LOOK_BOX.min[2]).toBeLessThanOrEqual(300)
  })

  it('camera box is about ±460 m and holds the overview camera', () => {
    expect(COASTAL_CAMERA_BOX.min[0]).toBe(-460)
    expect(COASTAL_CAMERA_BOX.max[0]).toBe(460)
    expect(COASTAL_CAMERA_BOX.min[2]).toBe(-460)
    expect(COASTAL_CAMERA_BOX.max[2]).toBe(460)
    const pose = poseFor(STATIONS.overview, defaultOverride(STATIONS.overview), overviewSubject(L), 16 / 9)
    const metres = pose.position.map((v) => v / L.renderScale) as [number, number, number]
    expect(clampCameraPosition(...metres)).toEqual(metres)
    // Zoomed all the way out at the lowest pitch from the land centre still fits the box.
    const horizontal = COASTAL_CAMERA_LIMITS.maxDistance * Math.cos((COASTAL_CAMERA_LIMITS.pitchMinDeg * Math.PI) / 180)
    expect(horizontal).toBeLessThanOrEqual(COASTAL_CAMERA_BOX.max[2])
  })

  it('reports the farthest a camera can get from the land centre (look box plus zoom)', () => {
    const reach = cameraReach()
    expect(reach).toBeGreaterThan(COASTAL_CAMERA_BOX.max[0])
    expect(reach).toBeLessThan(900)
  })

  it('converts metres to render units with the layout scale', () => {
    expect(toRender(L, [100, 10, -50])).toEqual([100 * L.renderScale, 10 * L.renderScale, -50 * L.renderScale])
  })
})
