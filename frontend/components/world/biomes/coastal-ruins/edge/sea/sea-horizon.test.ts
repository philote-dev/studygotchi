import { describe, expect, it } from 'vitest'
import { COASTAL_PALETTE, COASTAL_RUINS_LAYOUT as L } from '../../layout/biome-layout'
import { COASTAL_CAMERA_BOX, COASTAL_CAMERA_LIMITS, cameraReach } from '../../camera/stations'
import { outerFog, outerLandField } from '../endless/outer-world'
import { barrierPlan, distanceToSightline, inPoseFrame, outwardPose, poseCamera } from '../barriers/geography'
import { edgePose } from '../poses'
import {
  ISLAND_BANDS,
  MOON_DIR,
  SAIL_PATH,
  SEA_HORIZON,
  farIslands,
  sailSchedule,
  sailStateAt,
  seaPalette,
  waterBlend,
} from './sea-horizon'

const CAMERA_FAR_M = 1200 / L.renderScale
const plan = barrierPlan(L, 7)
const overview = edgePose('overview')!

describe('sea horizon radii', () => {
  it('puts the horizon beyond the camera reach and inside the camera far plane', () => {
    expect(SEA_HORIZON.horizonRadius).toBeGreaterThan(cameraReach() + outerFog(false).far)
    expect(SEA_HORIZON.horizonRadius).toBeLessThan(CAMERA_FAR_M)
    expect(Math.hypot(SEA_HORIZON.horizonRadius + cameraReach(), SEA_HORIZON.wallHeight)).toBeLessThanOrEqual(CAMERA_FAR_M)
    // The far water disc replaces the shipped 1800 m disc; both are far beyond anything the overview sees.
    expect(SEA_HORIZON.horizonRadius).toBeGreaterThanOrEqual(1800)
  })

  it('keeps the haze wall top above the frame from the highest, farthest camera', () => {
    // Pitch ≥ 12° with a 27° FOV: the frame never shows more than 1.5° above eye level.
    const nearest = SEA_HORIZON.horizonRadius - cameraReach()
    const elevation = (Math.atan2(SEA_HORIZON.wallHeight - COASTAL_CAMERA_BOX.max[1], nearest) * 180) / Math.PI
    expect(elevation).toBeGreaterThan(1.5 + 0.5)
    expect(SEA_HORIZON.glowHeight).toBeLessThan(SEA_HORIZON.wallHeight * 0.5)
  })

  it('only diverges from the scene fog beyond the land, and is fully haze before the nearest wall point', () => {
    // From the far edge of the camera box, the far side of the look box is this far away.
    const farthestLand = cameraReach() + 160
    expect(SEA_HORIZON.hazeNear).toBeGreaterThanOrEqual(farthestLand)
    const nearestWall = (SEA_HORIZON.horizonRadius - cameraReach()) * Math.cos((27 * Math.PI) / 180)
    expect(SEA_HORIZON.hazeFar).toBeLessThanOrEqual(nearestWall)
    expect(SEA_HORIZON.hazeNear).toBeLessThan(SEA_HORIZON.hazeFar)
    expect(SEA_HORIZON.hazeFar).toBeLessThanOrEqual(outerFog(false).far)
  })
})

describe('sea palette', () => {
  it('starts from the authored water and blends toward a horizon haze a touch warmer than the sky', () => {
    const day = seaPalette(false)
    const night = seaPalette(true)
    expect(day.water).toBe(COASTAL_PALETTE.water)
    expect(night.water).toBe(COASTAL_PALETTE.waterNight)
    expect(day.haze).not.toBe(COASTAL_PALETTE.sky)
    expect(night.haze).not.toBe(COASTAL_PALETTE.skyNight)
    // The opaque far water matches what the 78 % water disc shows over the authored sea bed.
    expect(waterBlend(false)).toMatch(/^#[0-9a-f]{6}$/)
    expect(waterBlend(true)).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('far islands and sea stacks', () => {
  const islands = farIslands(L, 7, plan)

  it('come in three ordered bands, bigger and farther toward the horizon', () => {
    expect(ISLAND_BANDS).toHaveLength(3)
    for (let i = 1; i < ISLAND_BANDS.length; i++) {
      expect(ISLAND_BANDS[i].rMin).toBeGreaterThanOrEqual(ISLAND_BANDS[i - 1].rMax)
      expect(ISLAND_BANDS[i].size[1]).toBeGreaterThan(ISLAND_BANDS[i - 1].size[1])
    }
    expect(ISLAND_BANDS[0].rMin).toBeGreaterThanOrEqual(300)
    expect(ISLAND_BANDS[ISLAND_BANDS.length - 1].rMax).toBeLessThan(SEA_HORIZON.horizonRadius - 300)
    for (const band of ISLAND_BANDS) expect(islands.filter((p) => p.band === band.index).length).toBeGreaterThanOrEqual(Math.floor(band.count * 0.6))
  })

  it('stand in open sea clear of every coast, the ring, the vistas and their sightlines', () => {
    expect(islands.length).toBeGreaterThan(24)
    for (const piece of islands) {
      const band = ISLAND_BANDS[piece.band]
      expect(piece.r).toBeGreaterThanOrEqual(band.rMin)
      expect(piece.r).toBeLessThan(band.rMax)
      expect(outerLandField(L, piece.x, piece.z)).toBeLessThan(-(40 + piece.size))
      for (const m of plan.ring) expect(Math.hypot(m.x - piece.x, m.z - piece.z)).toBeGreaterThan(piece.size + Math.max(m.rx, m.rz) + 10)
      for (const vista of plan.vistas) {
        expect(Math.hypot(vista.x - piece.x, vista.z - piece.z)).toBeGreaterThan(120)
        const cam = poseCamera(outwardPose(vista.id))
        if (Math.hypot(piece.x - cam.x, piece.z - cam.z) < vista.fromCamera + 40) expect(distanceToSightline(cam, vista, piece.x, piece.z), `${piece.kind} in the ${vista.id} window`).toBeGreaterThan(piece.size + 30)
      }
      // Far islands never enter the product overview frame.
      expect(inPoseFrame(overview, piece.x, piece.height, piece.z, -0.5, 2.4)).toBe(false)
    }
    expect(farIslands(L, 7, plan)).toEqual(islands)
    expect(farIslands(L, 8, plan)).not.toEqual(islands)
  })
})

describe('the far sail', () => {
  const schedule = sailSchedule(7)

  it('crosses about every 90 s, alternating direction, as a pure function of the seed', () => {
    expect(sailSchedule(7)).toEqual(schedule)
    expect(sailSchedule(8)).not.toEqual(schedule)
    expect(schedule.length).toBeGreaterThanOrEqual(40)
    const periods: number[] = []
    for (let i = 1; i < schedule.length; i++) {
      const period = schedule[i].startAt - schedule[i - 1].startAt
      expect(period).toBeGreaterThanOrEqual(75)
      expect(period).toBeLessThanOrEqual(105)
      expect(schedule[i - 1].duration).toBeLessThan(period)
      expect(schedule[i].dir).toBe(-schedule[i - 1].dir)
      periods.push(period)
    }
    const mean = periods.reduce((a, b) => a + b, 0) / periods.length
    expect(mean).toBeGreaterThan(84)
    expect(mean).toBeLessThan(96)
  })

  it('sails a chord through the southern sea, hidden between crossings, beyond the ring and inside the fog', () => {
    const first = schedule[0]
    expect(sailStateAt(schedule, first.startAt - 1).visible).toBe(false)
    expect(sailStateAt(schedule, first.startAt + first.duration + 1).visible).toBe(false)
    for (const k of [0, 0.25, 0.5, 0.75, 0.999]) {
      const state = sailStateAt(schedule, first.startAt + first.duration * k)
      expect(state.visible).toBe(true)
      expect(state.k).toBeCloseTo(k, 6)
      const r = Math.hypot(state.x, state.z)
      expect(r).toBeGreaterThanOrEqual(330)
      expect(r).toBeLessThanOrEqual(SAIL_PATH.radius + 1e-6)
      expect(outerLandField(L, state.x, state.z)).toBeLessThan(-60)
      expect(state.z).toBeGreaterThan(200)
      // In frame from the south-out pose (hazed by distance, under the frame top).
      expect(inPoseFrame(outwardPose('south'), state.x, 0, state.z, 0.3)).toBe(true)
    }
    const a = sailStateAt(schedule, first.startAt + first.duration * 0.4)
    const b = sailStateAt(schedule, first.startAt + first.duration * 0.6)
    const heading = Math.atan2(b.x - a.x, b.z - a.z)
    expect(Math.abs(((a.yaw - heading + Math.PI) % (Math.PI * 2)) - Math.PI)).toBeLessThan(1e-6)
    // The sail passes in front of the harbour city, not behind it, so it is never hidden by the vista.
    const south = plan.vistas.find((v) => v.id === 'south')!
    const cam = poseCamera(outwardPose('south'))
    for (const k of [0, 0.5, 0.999]) {
      const s = sailStateAt(schedule, first.startAt + first.duration * k)
      expect(Math.hypot(s.x - cam.x, s.z - cam.z)).toBeLessThan(south.fromCamera - 20)
    }
  })
})

describe('night', () => {
  it('lays the moon path toward the open southern sea', () => {
    expect(MOON_DIR[1]).toBeGreaterThan(0.85)
    expect(Math.hypot(MOON_DIR[0], MOON_DIR[1])).toBeCloseTo(1, 6)
    expect(COASTAL_CAMERA_LIMITS.pitchMinDeg).toBe(12)
  })
})
