import { describe, expect, it } from 'vitest'
import { backdropHeightAt } from '../../layout/skyline'
import { FRONTIER_POSES, frontierPosePosition } from '../poses'
import { createOuterDesert } from './desert'
import { plateDistance } from './plate'
import {
  VISTA_IDS,
  WINDOW_HALF,
  elevationDownDeg,
  frameBottomDeg,
  frameHalfWidthDeg,
  frameTopDeg,
  inPoseFrame,
  lateralDeg,
  outwardPose,
  poseCamera,
  sightlineClearance,
  viewBearingDeg,
  vistas,
  windowOpening,
  windows,
} from './vistas'

const desert = createOuterDesert(7)

describe('outward poses', () => {
  it('look outward from all four sides at 14–15°, camera inboard of the target', () => {
    const bearings = VISTA_IDS.map((id) => Math.round(viewBearingDeg(outwardPose(id))))
    // North ≈ 184 (toward −z), east ≈ 98 (toward +x), south ≈ 4 (toward +z), west ≈ 266 (toward −x).
    expect(bearings).toEqual([184, 98, 4, 266])
    for (const id of VISTA_IDS) {
      const pose = outwardPose(id)
      expect(pose.pitchDeg).toBeGreaterThanOrEqual(14)
      expect(pose.pitchDeg).toBeLessThanOrEqual(18)
      const [x, , z] = frontierPosePosition(pose)
      expect(Math.hypot(x, z)).toBeLessThan(Math.hypot(pose.target[0], pose.target[2]))
      // The frame top is below the horizon: the sky only enters through the far haze.
      expect(frameTopDeg(pose)).toBeGreaterThan(0)
    }
  })

  it('has one low pose with the horizon in frame and both max poses at the zoom limit', () => {
    const low = FRONTIER_POSES.find((pose) => pose.id === 'low-horizon')!
    expect(frameTopDeg(low)).toBeLessThan(0)
    expect(FRONTIER_POSES.find((pose) => pose.id === 'zoom-max')!.distance).toBeGreaterThanOrEqual(500)
    expect(FRONTIER_POSES.find((pose) => pose.id === 'horizon-max')!.pitchDeg).toBe(12)
  })
})

describe('windows', () => {
  it('cuts one window per outward pose, centred on its view ray, past the plate', () => {
    const list = windows()
    expect(list.map((w) => w.id)).toEqual(VISTA_IDS)
    for (const w of list) {
      const pose = outwardPose(w.id)
      expect(lateralDeg(pose, w.x, w.z)).toBeLessThan(0.5)
      expect(plateDistance(w.x, w.z)).toBeGreaterThanOrEqual(60)
      expect(w.fromCamera).toBeGreaterThan(200)
      expect(w.halfWidth).toBe(WINDOW_HALF[w.id])
      expect(windowOpening(w, w.along)).toBe(1)
      expect(windowOpening(w, w.along + w.halfWidth + 200)).toBe(0)
    }
  })

  it('north: no row-A mesa stands in the window; the lips frame it on both sides', () => {
    const north = windows().find((w) => w.id === 'north')!
    const rowA = desert.landforms.filter((m) => m.row === 1 && m.z < -250 && m.kind !== 'table')
    for (const m of rowA) {
      const reach = Math.max(m.rx, m.rz)
      expect(Math.abs(m.x - north.along) + 1e-6, `${m.kind} ${m.x.toFixed(0)}`).toBeGreaterThanOrEqual(north.halfWidth + reach * 0.78)
    }
    const left = rowA.filter((m) => m.x < north.along && m.x > north.along - 200)
    const right = rowA.filter((m) => m.x > north.along && m.x < north.along + 200)
    expect(left.length).toBeGreaterThanOrEqual(1)
    expect(right.length).toBeGreaterThanOrEqual(1)
    const table = desert.landforms.find((m) => m.kind === 'table')!
    expect(Math.max(...left.map((m) => m.height))).toBeGreaterThan(table.height + 20)
    expect(Math.max(...right.map((m) => m.height))).toBeGreaterThan(table.height + 20)
  })

  it('east: the gorge is full depth at the window and the portal rock stands beside the view, not on it', () => {
    const east = windows().find((w) => w.id === 'east')!
    const pose = outwardPose('east')
    expect(desert.gorge(east.z).fade).toBeGreaterThan(0.95)
    const portal = desert.trestle.portal
    const lateral = lateralDeg(pose, portal.x, portal.z)
    expect(lateral).toBeGreaterThan(5)
    expect(lateral + 6).toBeLessThan(frameHalfWidthDeg())
    // The far two thirds of the deck are clear of the rock.
    const t = desert.trestle
    const mid = [(t.near[0] + t.far[0]) / 2, (t.near[1] + t.far[1]) / 2] as const
    expect(Math.hypot(mid[0] - portal.x, mid[1] - portal.z)).toBeGreaterThan(portal.r + 20)
  })

  it('south and west: the barrier is open at the window and shut beside it', () => {
    const south = windows().find((w) => w.id === 'south')!
    expect(desert.duneCrest(south.along).amplitude).toBeLessThan(5)
    expect(desert.duneCrest(south.along + south.halfWidth + 120).amplitude).toBeGreaterThan(9)
    const west = windows().find((w) => w.id === 'west')!
    const e = desert.escarpment(west.along)
    const openStep = desert.heightAt(e.x - 30, west.along)
    const shutStep = desert.heightAt(desert.escarpment(west.along + 160).x - 30, west.along + 160)
    expect(openStep).toBeLessThan(shutStep)
  })
})

describe('vistas', () => {
  const list = vistas()

  it('stand 310–450 m from their pose camera, beyond the barrier, each with exactly one light', () => {
    expect(list.map((v) => v.kind)).toEqual(['mesa-town', 'trestle', 'mission', 'mast'])
    for (const v of list) {
      expect(v.fromCamera).toBeGreaterThanOrEqual(310)
      expect(v.fromCamera).toBeLessThanOrEqual(450)
      const w = windows().find((g) => g.id === v.id)!
      // The table stands in the wall's own row and the trestle spans the gorge itself; the mission and the mast stand beyond.
      if (v.id === 'north' || v.id === 'east') expect(Math.abs(v.fromCamera - w.fromCamera)).toBeLessThan(25)
      else expect(v.fromCamera).toBeGreaterThan(w.fromCamera + 20)
      expect(plateDistance(v.x, v.z)).toBeGreaterThan(100)
      expect(['warm', 'red']).toContain(v.light)
    }
  })

  it('sit inside their pose frame, base and top, near the frame centre line', () => {
    for (const v of list) {
      const pose = outwardPose(v.id)
      expect(inPoseFrame(pose, v.x, v.base, v.z), `${v.id} base`).toBe(true)
      expect(inPoseFrame(pose, v.x, v.base + v.height, v.z), `${v.id} top`).toBe(true)
      expect(lateralDeg(pose, v.x, v.z)).toBeLessThan(1)
      const cam = poseCamera(pose)
      const down = elevationDownDeg(cam, v.x, v.base + v.height / 2, v.z)
      // Mid-height lands in the upper half of the frame (the far band), not on the near ground.
      expect(down).toBeLessThan((frameTopDeg(pose) + frameBottomDeg(pose)) / 2)
    }
  })

  it('are seen over everything in front of them at every course band (authored skyline grows)', () => {
    for (const v of list) {
      const pose = outwardPose(v.id)
      for (const fraction of [0, 0.5, 1]) {
        const groundAt = (x: number, z: number) => Math.max(desert.heightAt(x, z), backdropHeightAt(x, z, fraction))
        // Landmarks on their own landform: stop short of its own top (the table / butte rim).
        const stopShort = v.kind === 'mesa-town' ? 18 : v.kind === 'mast' ? 14 : 2
        const total = Math.hypot(v.x - poseCamera(pose).x, v.z - poseCamera(pose).z)
        const k = (total - stopShort) / total
        const cam = poseCamera(pose)
        const target = { x: cam.x + (v.x - cam.x) * k, y: v.base + v.height * 0.35, z: cam.z + (v.z - cam.z) * k }
        const clear = sightlineClearance(pose, target, groundAt, fraction)
        expect(clear.clearance, `${v.id} at band ${fraction} near ${clear.at.map((n) => n.toFixed(0))}`).toBeGreaterThan(2)
      }
    }
  })

  it('is deterministic', () => {
    expect(vistas()).toEqual(list)
    expect(windows()).toEqual(windows())
  })
})
