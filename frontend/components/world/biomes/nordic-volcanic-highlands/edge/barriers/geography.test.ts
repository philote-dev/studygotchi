import { describe, expect, it } from 'vitest'
import { WATER_Y, inPlateRect } from '../../layout/terrain'
import { EDGE_POSES } from '../poses'
import { ARM, GEYSER_FIELD, VOLCANO, createOuterWorld } from '../outer/outer-world'
import {
  GEYSER_DURATION,
  PALISADE,
  barrierPlan,
  bearingDeltaDeg,
  bearingOf,
  distanceToSightline,
  elevationDownDeg,
  frameTopDeg,
  geyserProfile,
  geyserSchedule,
  geyserShowTime,
  geyserStateAt,
  inPoseFrame,
  lateralDeg,
  outwardPose,
  poseCamera,
  sightlineClear,
  viewBearingDeg,
  wrapDeg,
} from './geography'

const SEED = 7
const world = createOuterWorld(SEED)
const plan = barrierPlan(world, SEED)
const outward = EDGE_POSES.filter((pose) => pose.id.endsWith('-out'))

describe('barriers: camera frame maths', () => {
  it('turns a pose azimuth into the direction it looks', () => {
    expect(viewBearingDeg(outwardPose('north'))).toBe(180)
    expect(viewBearingDeg(outwardPose('south'))).toBe(0)
    expect(viewBearingDeg(outwardPose('east'))).toBe(90)
    expect(viewBearingDeg(outwardPose('west'))).toBe(270)
    expect(bearingDeltaDeg(350, 10)).toBe(20)
    expect(bearingOf(0, -1)).toBe(180)
    expect(bearingOf(1, 0)).toBe(90)
    expect(wrapDeg(190)).toBe(-170)
  })

  it('measures the frame from the pose camera', () => {
    const pose = outwardPose('north')
    const cam = poseCamera(pose)
    expect(cam.y).toBeCloseTo(40 + 260 * Math.sin((14 * Math.PI) / 180), 3)
    expect(frameTopDeg(pose)).toBe(1)
    expect(elevationDownDeg(cam, ...pose.target)).toBeCloseTo(pose.pitchDeg, 1)
    expect(lateralDeg(pose, pose.target[0], pose.target[2])).toBeCloseTo(0, 5)
    expect(inPoseFrame(pose, ...pose.target)).toBe(true)
    // A 100 m peak 1 km out is above the frame top at this pitch: that is why the vistas are nearer.
    expect(inPoseFrame(pose, cam.x, 100, cam.z - 1000)).toBe(false)
  })
})

describe('barriers: the enclosure', () => {
  it('stands every massif outside the plate, planted on the outer ground, in four kinds', () => {
    expect(plan.massifs.length).toBeGreaterThan(300)
    const kinds = new Set(plan.massifs.map((m) => m.kind))
    expect(kinds).toEqual(new Set(['column', 'wall', 'serac', 'talus']))
    for (const m of plan.massifs) {
      expect(inPlateRect(m.x, m.z), `${m.kind} at ${m.x.toFixed(0)},${m.z.toFixed(0)} is on the plate`).toBe(false)
      expect(m.seatY).toBeGreaterThanOrEqual(WATER_Y - 1e-6)
      expect(m.seatY).toBeLessThanOrEqual(world.heightAt(m.x, m.z) + 1e-6)
      expect(m.height).toBeGreaterThan(m.kind === 'talus' ? 2 : 3)
    }
  })

  it('builds two palisades that frame a window on each pose ray, with taller lips beside the gap', () => {
    for (const side of [1, -1] as const) {
      const id = side > 0 ? 'east' : 'west'
      const win = plan.windows.find((w) => w.id === id)!
      const columns = plan.massifs.filter((m) => m.kind === 'column' && Math.sign(m.x) === side)
      expect(columns.length).toBeGreaterThan(120)
      // No column inside the window.
      for (const c of columns) expect(Math.abs(c.z - win.crossing[1])).toBeGreaterThanOrEqual(PALISADE.windowHalf - 1.5)
      // Lips both sides, taller than the mid-run average.
      const lip = (dir: 1 | -1) => columns.filter((c) => dir * (c.z - win.crossing[1]) > PALISADE.windowHalf && dir * (c.z - win.crossing[1]) < PALISADE.windowHalf + 18)
      const avg = columns.reduce((s, c) => s + c.height, 0) / columns.length
      for (const dir of [1, -1] as const) {
        const lips = lip(dir)
        expect(lips.length).toBeGreaterThanOrEqual(2)
        expect(Math.max(...lips.map((c) => c.height))).toBeGreaterThan(avg + 3)
      }
      // The walls are ≥ 20 m at the lips but under the pose's frame top where they stand.
      const pose = outwardPose(id)
      const cam = poseCamera(pose)
      for (const c of columns) {
        if (Math.abs(c.z - cam.z) > 140) continue
        expect(elevationDownDeg(cam, c.x, c.seatY + c.height, c.z) - frameTopDeg(pose), `column top cropped at ${c.z.toFixed(0)}`).toBeGreaterThan(0.2)
      }
    }
  })

  it('lines the arm with fjord walls on both banks and closes its head with a glacier front', () => {
    const walls = plan.massifs.filter((m) => m.kind === 'wall')
    expect(walls.length).toBe(8)
    const left = walls.filter((m) => m.x < 19)
    const right = walls.filter((m) => m.x > 19)
    expect(left.length).toBe(4)
    expect(right.length).toBe(4)
    for (const m of walls) {
      expect(m.z).toBeLessThan(ARM.zMouth - 10)
      expect(m.z).toBeGreaterThan(ARM.zHead)
      expect(m.height).toBeGreaterThanOrEqual(30)
      expect(world.landField(m.x, m.z)).toBeGreaterThan(10)
    }
    const front = plan.massifs.filter((m) => m.kind === 'serac')
    expect(front.length).toBe(7)
    for (const s of front) {
      expect(s.z).toBeLessThan(ARM.zHead)
      expect(s.z).toBeGreaterThan(ARM.zHead - 16)
      expect(s.height).toBeGreaterThanOrEqual(15)
    }
    const xs = front.map((s) => s.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(40)
  })

  it('never stacks two massifs on the same spot', () => {
    for (let i = 0; i < plan.massifs.length; i++) {
      for (let j = i + 1; j < plan.massifs.length; j++) {
        const a = plan.massifs[i]
        const b = plan.massifs[j]
        const d = Math.hypot(a.x - b.x, a.z - b.z)
        expect(d, `${a.kind}#${i} vs ${b.kind}#${j}`).toBeGreaterThan(Math.min(a.rx, a.rz) * 0.5 + Math.min(b.rx, b.rz) * 0.5)
      }
    }
  })
})

describe('barriers: the four windows and vistas', () => {
  it('declares one window and one vista per outward pose', () => {
    expect(plan.windows.map((w) => w.poseId).sort()).toEqual(outward.map((p) => p.id).sort())
    expect(plan.vistas.map((v) => v.poseId).sort()).toEqual(outward.map((p) => p.id).sort())
    expect(new Set(plan.vistas.map((v) => v.kind)).size).toBe(4)
    expect(new Set(plan.vistas.map((v) => v.light)).size).toBe(3)
  })

  it('keeps each vista 400–620 m along its pose ray, inside the frame, under the frame top', () => {
    for (const vista of plan.vistas) {
      const pose = outwardPose(vista.id)
      const cam = poseCamera(pose)
      expect(vista.fromCamera, vista.id).toBeGreaterThanOrEqual(400)
      expect(vista.fromCamera, vista.id).toBeLessThanOrEqual(620)
      expect(lateralDeg(pose, vista.x, vista.z), vista.id).toBeLessThan(6)
      const base = elevationDownDeg(cam, vista.x, vista.seatY, vista.z)
      const top = elevationDownDeg(cam, vista.x, vista.seatY + vista.height, vista.z)
      expect(base - frameTopDeg(pose), `${vista.id} base too close to the frame top`).toBeGreaterThanOrEqual(1.2)
      expect(top - frameTopDeg(pose), `${vista.id} silhouette cropped by the frame top`).toBeGreaterThanOrEqual(0.3)
      expect(inPoseFrame(pose, vista.x, vista.seatY, vista.z)).toBe(true)
      expect(inPoseFrame(pose, vista.lamp[0], vista.lamp[1], vista.lamp[2], 0.25), `${vista.id} lamp in frame`).toBe(true)
      expect(inPlateRect(vista.x, vista.z)).toBe(false)
    }
  })

  it('leaves the sightline from each pose camera to its vista clear of every massif and the terrain', () => {
    for (const vista of plan.vistas) {
      const pose = outwardPose(vista.id)
      const cam = poseCamera(pose)
      // The volcano's visible silhouette is its south rim; the others are checked at mid-height.
      const target = vista.kind === 'volcano' ? { x: vista.x, z: vista.z + VOLCANO.craterRadius + 2, y: vista.seatY + vista.height + 2 } : { x: vista.x, z: vista.z, y: vista.seatY + vista.height * 0.5 }
      for (const m of plan.massifs) {
        if (Math.hypot(m.x - cam.x, m.z - cam.z) > vista.fromCamera) continue
        const d = distanceToSightline(cam, target, m.x, m.z)
        if (d > Math.max(m.rx, m.rz) + 2) continue
        // A massif under the ray is fine (the glacier front below the volcano summit); one through it is not.
        const t = Math.hypot(m.x - cam.x, m.z - cam.z) / vista.fromCamera
        const rayY = cam.y + (target.y - cam.y) * t
        expect(m.seatY + m.height, `${m.kind} at ${m.x.toFixed(0)},${m.z.toFixed(0)} blocks the ${vista.id} window`).toBeLessThan(rayY - 1)
      }
      expect(sightlineClear(world, plan.massifs, cam, target.x, target.y, target.z), `${vista.id} sightline`).toBe(true)
    }
  })

  it('frames both sides of each palisade window within the frame width and leaves the ray itself open', () => {
    for (const id of ['east', 'west'] as const) {
      const pose = outwardPose(id)
      const win = plan.windows.find((w) => w.id === id)!
      const columns = plan.massifs.filter((m) => m.kind === 'column' && Math.sign(m.x) === (id === 'east' ? 1 : -1))
      const framed = (dir: 1 | -1) => columns.some((c) => dir * (c.z - win.crossing[1]) > PALISADE.windowHalf && lateralDeg(pose, c.x, c.z) < 16)
      expect(framed(1), `${id} window framed on +z`).toBe(true)
      expect(framed(-1), `${id} window framed on −z`).toBe(true)
      expect(lateralDeg(pose, ...win.crossing)).toBeLessThan(0.5)
    }
    const east = plan.vistas.find((v) => v.id === 'east')!
    expect(Math.hypot(east.x - GEYSER_FIELD.x, east.z - GEYSER_FIELD.z)).toBeLessThan(6)
  })
})

describe('barriers: the geysers', () => {
  it('erupts on a seeded, deterministic schedule with gaps of 16–30 s and a rise-hang-drift profile', () => {
    const schedule = geyserSchedule(SEED)
    expect(schedule).toEqual(geyserSchedule(SEED))
    expect(schedule).not.toEqual(geyserSchedule(SEED + 1))
    expect(schedule.length).toBe(80)
    for (let i = 1; i < schedule.length; i++) {
      const gap = schedule[i].startAt - schedule[i - 1].startAt
      expect(gap).toBeGreaterThanOrEqual(16)
      expect(gap).toBeLessThanOrEqual(30)
      expect(schedule[i].vent).not.toBe(schedule[i - 1].vent)
    }
    expect(new Set(schedule.map((e) => e.vent))).toEqual(new Set([0, 1, 2]))
    expect(geyserStateAt(schedule, schedule[0].startAt - 1)).toBeNull()
    const mid = geyserStateAt(schedule, schedule[0].startAt + GEYSER_DURATION / 2)!
    expect(mid.vent).toBe(schedule[0].vent)
    expect(mid.k).toBeCloseTo(0.5, 6)
    expect(geyserStateAt(schedule, schedule[0].startAt + GEYSER_DURATION + 0.01)).toBeNull()
    expect(geyserProfile(0).column).toBe(0)
    expect(geyserProfile(0.4).column).toBeGreaterThan(15)
    expect(geyserProfile(1).column).toBe(0)
    expect(geyserProfile(1).spread).toBe(1)
    const show = geyserStateAt(schedule, geyserShowTime(SEED))!
    expect(show).not.toBeNull()
    expect(geyserProfile(show.k).column).toBeGreaterThan(15)
  })
})

describe('barriers: determinism', () => {
  it('rebuilds the identical plan from the same seed and a different one from another', () => {
    expect(barrierPlan(createOuterWorld(SEED), SEED)).toEqual(plan)
    const other = barrierPlan(createOuterWorld(SEED + 1), SEED + 1)
    expect(other.massifs.map((m) => [m.x, m.z])).not.toEqual(plan.massifs.map((m) => [m.x, m.z]))
    // The windows follow the poses, so they do not move.
    for (const w of plan.windows) expect(other.windows.find((o) => o.id === w.id)!.crossing[1]).toBeCloseTo(w.crossing[1], 6)
  })
})
