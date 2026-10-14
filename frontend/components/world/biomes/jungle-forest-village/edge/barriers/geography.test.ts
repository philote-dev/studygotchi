import { describe, expect, it } from 'vitest'
import { bearingDeltaDeg, bearingOf, chebyshev } from '../noise'
import { createOuterWorld } from '../outer/heightfield'
import { EDGE_POSES } from '../poses'
import {
  PLATE_HALF,
  RIVER_CLEARANCE,
  barrierPlan,
  distanceToSightline,
  elevationDownDeg,
  frameTopDeg,
  gapAt,
  inPoseFrame,
  lateralDeg,
  outwardPose,
  poseCamera,
  riverDistance,
  vistaGaps,
  wallChebAt,
} from './geography'

const SEED = 7
const plan = barrierPlan(SEED)
const world = createOuterWorld(SEED)

/** The rope bridge's deck: the higher of the two gorge rims (where its pylons stand). */
function bridgeDeckHeight(): number {
  const g = plan.gorge
  const nx = Math.cos(g.yaw)
  const nz = -Math.sin(g.yaw)
  const rim = g.halfWidth + 6
  return Math.max(world.height(g.x + nx * rim, g.z + nz * rim), world.height(g.x - nx * rim, g.z - nz * rim))
}

/** The vertical extent a landmark silhouettes over: its readable base and its summit. */
function landmarkExtent(vista: (typeof plan.vistas)[number]): { base: number; top: number } {
  switch (vista.kind) {
    case 'bridge':
      return { base: bridgeDeckHeight(), top: bridgeDeckHeight() + vista.height }
    case 'volcano': {
      const v = plan.volcano
      // The cone's foot on the camera side and its crater rim.
      return { base: world.height(v.x + v.radius * 0.9, v.z), top: world.height(v.x + v.craterRadius * 0.95, v.z) }
    }
    default: {
      const ground = world.height(vista.x, vista.z)
      return { base: ground, top: ground + vista.height }
    }
  }
}

describe('barriers: the wall', () => {
  it('cuts one window per outward pose, centred on the pose ray where it crosses the wall', () => {
    expect(plan.gaps.map((g) => g.id).sort()).toEqual(['east', 'north', 'south', 'west'])
    for (const gap of plan.gaps) {
      const pose = outwardPose(gap.id)
      expect(gap.poseId).toBe(pose.id)
      expect(lateralDeg(pose, gap.crossing[0], gap.crossing[1])).toBeLessThan(0.5)
      expect(Math.abs(chebyshev(gap.crossing[0], gap.crossing[1]) - wallChebAt(gap.bearingDeg, SEED))).toBeLessThan(1)
      expect(gap.distance).toBeGreaterThan(200)
      expect(gap.distance).toBeLessThan(330)
    }
  })

  it('stands outside the plate, clear of the river, and never inside a window', () => {
    expect(plan.wall.length).toBeGreaterThan(40)
    for (const m of plan.wall) {
      const footprint = Math.max(m.rx, m.rz)
      expect(chebyshev(m.x, m.z) - footprint, `${m.kind} at ${m.x.toFixed(0)},${m.z.toFixed(0)}`).toBeGreaterThan(PLATE_HALF)
      expect(riverDistance(m.x, m.z)).toBeGreaterThan(RIVER_CLEARANCE)
      expect(gapAt(plan.gaps, bearingOf(m.x, m.z), 2), `${m.kind} in a window`).toBeNull()
    }
    const kinds = new Set(plan.wall.map((m) => m.kind))
    expect(kinds).toContain('cliff')
    expect(kinds).toContain('buttress')
    expect(plan.wall.filter((m) => m.kind === 'cliff' && m.fall).length).toBeGreaterThanOrEqual(4)
  })

  it('frames every window with a cliff and a buttress tree on both lips', () => {
    for (const gap of plan.gaps) {
      for (const side of [-1, 1]) {
        const near = plan.wall.filter((m) => {
          const delta = bearingOf(m.x, m.z) - gap.bearingDeg
          const signed = ((delta + 540) % 360) - 180
          return Math.sign(signed) === side && Math.abs(signed) < gap.halfWidthDeg + 18
        })
        expect(near.some((m) => m.kind === 'cliff'), `${gap.id} side ${side} cliff`).toBe(true)
        expect(near.some((m) => m.kind === 'buttress'), `${gap.id} side ${side} buttress`).toBe(true)
      }
    }
  })

  it('rebuilds the identical plan from the same seed and a different wall from another', () => {
    expect(JSON.stringify(barrierPlan(SEED))).toBe(JSON.stringify(plan))
    const other = barrierPlan(99)
    expect(JSON.stringify(other.wall)).not.toBe(JSON.stringify(plan.wall))
    // The windows follow the poses, so they barely move between seeds.
    for (const gap of other.gaps) expect(bearingDeltaDeg(gap.bearingDeg, plan.gaps.find((g) => g.id === gap.id)!.bearingDeg)).toBeLessThan(6)
  })
})

describe('barriers: the vistas', () => {
  it('composes four different far places with one light each', () => {
    expect(new Set(plan.vistas.map((v) => v.kind)).size).toBe(4)
    expect(new Set(plan.vistas.map((v) => v.light)).size).toBe(4)
  })

  it('stands each landmark beyond its window, 340–460 m out (the volcano farther), inside the frame', () => {
    for (const vista of plan.vistas) {
      const pose = outwardPose(vista.id)
      const gap = plan.gaps.find((g) => g.id === vista.id)!
      const cam = poseCamera(pose)
      expect(vista.fromCamera).toBeGreaterThan(gap.distance + 40)
      if (vista.kind !== 'volcano') {
        expect(vista.fromCamera).toBeGreaterThanOrEqual(340)
        expect(vista.fromCamera).toBeLessThanOrEqual(460)
      } else expect(vista.fromCamera).toBeGreaterThan(900)
      // Dead ahead.
      expect(lateralDeg(pose, vista.x, vista.z)).toBeLessThan(0.5)
      const { base, top } = landmarkExtent(vista)
      expect(inPoseFrame(pose, vista.x, base + 1, vista.z, 0.3), `${vista.id} base`).toBe(true)
      expect(inPoseFrame(pose, vista.x, top, vista.z, 0.3), `${vista.id} top`).toBe(true)
      // And it occupies a readable slice of the frame (≥ 2° tall for the near three, ≥ 1.5° for the volcano).
      const span = elevationDownDeg(cam, vista.x, base, vista.z) - elevationDownDeg(cam, vista.x, top, vista.z)
      expect(span, `${vista.id} apparent height`).toBeGreaterThan(vista.kind === 'volcano' ? 1.5 : 2)
      expect(frameTopDeg(pose)).toBeLessThan(0)
    }
  })

  it('keeps the sightline from each pose camera to its landmark clear of the land and the wall', () => {
    for (const vista of plan.vistas) {
      const pose = outwardPose(vista.id)
      const cam = poseCamera(pose)
      // Aim at the landmark's readable part: half-way up (the bridge deck spans the gorge at rim
      // height; the volcano's near crater rim is what the camera sees).
      const { base, top } = landmarkExtent(vista)
      const aim = vista.kind === 'bridge' ? base + 2 : vista.kind === 'volcano' ? top : base + (top - base) * 0.5
      let dx = vista.x - cam.x
      let dz = vista.z - cam.z
      if (vista.kind === 'volcano') {
        const d0 = Math.hypot(dx, dz)
        dx *= (d0 - plan.volcano.craterRadius) / d0
        dz *= (d0 - plan.volcano.craterRadius) / d0
      }
      const d = Math.hypot(dx, dz)
      for (let t = 40; t < d - 25; t += 4) {
        const k = t / d
        const x = cam.x + dx * k
        const z = cam.z + dz * k
        const line = cam.y + (aim - cam.y) * k
        const h = chebyshev(x, z) < PLATE_HALF ? 0 : world.height(x, z)
        expect(h, `${vista.id} ground at ${t.toFixed(0)} m`).toBeLessThan(line - 2)
      }
      for (const m of plan.wall) {
        const reach = Math.max(m.rx, m.rz)
        expect(distanceToSightline(cam, vista, m.x, m.z), `${vista.id} wall ${m.kind}`).toBeGreaterThan(reach * 0.8)
      }
    }
  })

  it('places the gorge across the south view and the volcano on the west ray', () => {
    const south = plan.vistas.find((v) => v.id === 'south')!
    expect(plan.gorge.x).toBeCloseTo(south.x, 6)
    expect(plan.gorge.depth).toBeGreaterThan(15)
    // The pit really is in the land, and the rims on either side are higher than its floor.
    const floor = world.height(plan.gorge.x, plan.gorge.z)
    const nx = Math.cos(plan.gorge.yaw)
    const nz = -Math.sin(plan.gorge.yaw)
    const rim = plan.gorge.halfWidth + 6
    expect(world.height(plan.gorge.x + nx * rim, plan.gorge.z + nz * rim)).toBeGreaterThan(floor + 12)
    expect(world.height(plan.gorge.x - nx * rim, plan.gorge.z - nz * rim)).toBeGreaterThan(floor + 12)
    const west = plan.vistas.find((v) => v.id === 'west')!
    expect(world.sample(west.x + plan.volcano.craterRadius * 0.5, west.z).material).toBe('crater')
    // The crater is dished: its rim stands above its centre, and the cone stands above the land round it.
    const craterRim = world.height(west.x + plan.volcano.craterRadius * 0.95, west.z)
    expect(craterRim).toBeGreaterThan(world.height(west.x, west.z) + 4)
    expect(craterRim).toBeGreaterThan(world.height(west.x + plan.volcano.radius + 40, west.z) + 40)
  })
})

describe('barriers: poses', () => {
  it('uses the comparison poses as the outward looks', () => {
    for (const id of ['north-out', 'east-out', 'south-out', 'west-out']) expect(EDGE_POSES.some((p) => p.id === id)).toBe(true)
    expect(vistaGaps(SEED).map((g) => g.poseId)).toEqual(['north-out', 'east-out', 'south-out', 'west-out'])
  })
})
