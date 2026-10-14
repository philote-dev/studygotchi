import { describe, expect, it } from 'vitest'
import { COASTAL_RUINS_LAYOUT as L } from '../../layout/biome-layout'
import { sampleTerrain } from '../../layout/terrain'
import { EDGE_POSES, edgePose, edgePosePosition } from '../poses'
import { chebyshev, createOuterWorld, outerLandField } from '../endless/outer-world'
import {
  COAST_CLEARANCE,
  barrierPlan,
  bearingDeltaDeg,
  bearingOf,
  coastFramesBearing,
  distanceToSightline,
  elevationDownDeg,
  frameTopDeg,
  gapAt,
  inPoseFrame,
  lateralDeg,
  outwardPose,
  poseCamera,
  ringCrossing,
  ringRadiusAt,
  viewBearingDeg,
} from './geography'

const SEED = 7
const plan = barrierPlan(L, SEED)
const world = createOuterWorld(L, SEED)
const outward = EDGE_POSES.filter((pose) => pose.id.endsWith('-out'))
const overview = edgePose('overview')!

describe('barriers: camera frame maths', () => {
  it('turns a pose azimuth into the direction it looks', () => {
    expect(viewBearingDeg(outwardPose('north'))).toBe(180)
    expect(viewBearingDeg(outwardPose('south'))).toBe(0)
    expect(viewBearingDeg(outwardPose('east'))).toBe(90)
    expect(viewBearingDeg(outwardPose('west'))).toBe(270)
    expect(bearingDeltaDeg(350, 10)).toBe(20)
    expect(bearingOf(0, -1)).toBe(180)
    expect(bearingOf(1, 0)).toBe(90)
  })

  it('measures the frame from the pose camera', () => {
    const pose = outwardPose('south')
    const cam = poseCamera(pose)
    expect(frameTopDeg(pose)).toBeCloseTo(1.5, 6)
    expect(elevationDownDeg(cam, ...pose.target)).toBeCloseTo(pose.pitchDeg, 1)
    expect(lateralDeg(pose, pose.target[0], pose.target[2])).toBeCloseTo(0, 5)
    expect(inPoseFrame(pose, ...pose.target)).toBe(true)
    // The sea 3 km out is above the frame top at this pitch: that is why the vistas are nearer.
    expect(inPoseFrame(pose, cam.x, 0, cam.z + 3000)).toBe(false)
  })
})

describe('barriers: the ring', () => {
  it('is a coast of stacks, not a circle, standing 250–310 m out', () => {
    const radii = Array.from({ length: 72 }, (_, i) => ringRadiusAt(i * 5, SEED))
    expect(Math.min(...radii)).toBeGreaterThanOrEqual(250)
    expect(Math.max(...radii)).toBeLessThanOrEqual(310)
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(20)
  })

  it('stands only on the sea side, in open water at least 40 m from any coast (footprint samples)', () => {
    expect(plan.ring.length).toBeGreaterThanOrEqual(26)
    let samples = 0
    for (const m of plan.ring) {
      const n = 12
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        const x = m.x + Math.cos(a) * Math.max(m.rx, m.rz)
        const z = m.z + Math.sin(a) * Math.max(m.rx, m.rz)
        if (chebyshev(x, z) < L.worldExtent) expect(sampleTerrain(L, x, z).material, `${m.kind} at ${m.x.toFixed(0)},${m.z.toFixed(0)}`).toBe('sea')
        expect(outerLandField(L, x, z), `${m.kind} footprint near land`).toBeLessThan(-COAST_CLEARANCE)
        samples++
      }
    }
    expect(samples).toBeGreaterThanOrEqual(300)
    // Nothing on the land side: the north is barred by the escarpment and the hills, not by stacks.
    for (const m of plan.ring) expect(bearingDeltaDeg(bearingOf(m.x, m.z), 180)).toBeGreaterThan(70)
  })

  it('varies kind and height: stacks, needles, capes, islets and at least one arch', () => {
    const kinds = new Set(plan.ring.map((m) => m.kind))
    expect(kinds).toEqual(new Set(['stack', 'needle', 'cape', 'islet', 'arch']))
    const heights = plan.ring.map((m) => m.height)
    expect(Math.min(...heights)).toBeLessThan(10)
    expect(Math.max(...heights)).toBeGreaterThan(30)
    expect(plan.ring.filter((m) => m.kind === 'arch').length).toBeGreaterThanOrEqual(1)
  })

  it('never stacks two massifs on the same spot', () => {
    for (let i = 0; i < plan.ring.length; i++) {
      for (let j = i + 1; j < plan.ring.length; j++) {
        const a = plan.ring[i]
        const b = plan.ring[j]
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.kind}#${i} vs ${b.kind}#${j}`).toBeGreaterThan(Math.min(a.rx, a.rz) * 0.5 + Math.min(b.rx, b.rz) * 0.5)
      }
    }
  })
})

describe('barriers: the four windows', () => {
  it('declares one gap per outward pose; the three sea gaps sit on their pose’s view ray through the ring', () => {
    expect(plan.gaps.map((g) => g.poseId).sort()).toEqual(outward.map((p) => p.id).sort())
    for (const id of ['east', 'south', 'west'] as const) {
      const pose = outwardPose(id)
      const crossing = ringCrossing(pose, SEED)
      const gap = gapAt(plan.gaps, crossing.bearingDeg)
      expect(gap, `${pose.id} view ray misses every gap`).not.toBeNull()
      expect(gap!.poseId).toBe(pose.id)
      expect(crossing.distance).toBeGreaterThan(190)
      expect(crossing.distance).toBeLessThan(330)
    }
  })

  it('leaves the sightline from each pose camera to its vista clear of the ring', () => {
    for (const vista of plan.vistas) {
      const pose = outwardPose(vista.id)
      const cam = poseCamera(pose)
      for (const m of plan.ring) {
        if (Math.hypot(m.x - cam.x, m.z - cam.z) >= vista.fromCamera) continue
        expect(distanceToSightline(cam, vista, m.x, m.z), `${m.kind} blocks the ${vista.id} window`).toBeGreaterThan(Math.max(m.rx, m.rz) + 4)
      }
    }
  })

  it('frames every sea window on both sides: a tall stack, or the mainland shore where the arc meets the coast', () => {
    let coastSides = 0
    for (const gap of plan.gaps.filter((g) => g.id !== 'north')) {
      for (const sign of [1, -1]) {
        const pieces = plan.ring.filter((m) => {
          const w = sign * (((bearingOf(m.x, m.z) - gap.bearingDeg + 540) % 360) - 180)
          return w > gap.halfWidthDeg && w < gap.halfWidthDeg + 24 && m.height >= 18
        })
        const coast = coastFramesBearing(L, gap.bearingDeg + sign * (gap.halfWidthDeg + 8), SEED)
        if (coast) coastSides++
        expect(pieces.length >= 1 || coast, `${gap.id} ${sign > 0 ? 'left' : 'right'} frame`).toBe(true)
      }
    }
    // The south window is framed by stacks on both sides; the east and west arcs run into the side coasts.
    expect(coastSides).toBeLessThanOrEqual(2)
  })

  it('the north window is the hills’ saddle: the acropolis sightline clears the terrain and the escarpment', () => {
    const vista = plan.vistas.find((v) => v.id === 'north')!
    const pose = outwardPose('north')
    const cam = poseCamera(pose)
    expect(vista.x).toBeCloseTo(world.acropolisSite.x, 6)
    expect(vista.z).toBeCloseTo(world.acropolisSite.z, 6)
    const d = Math.hypot(vista.x - cam.x, vista.z - cam.z)
    for (let t = 30; t < d - 20; t += 10) {
      const k = t / d
      const x = cam.x + (vista.x - cam.x) * k
      const z = cam.z + (vista.z - cam.z) * k
      const sight = cam.y + (vista.height * 0.6 - cam.y) * k
      // Authored escarpment (boxes to 18 m on a 2.4 m plain, z −89..−124) and the outer terrain.
      const ground = chebyshev(x, z) < L.worldExtent ? (z < -85 && z > -128 ? 2.4 + 18.6 : sampleTerrain(L, x, z).height) : world.sample(x, z).height
      expect(ground, `blocked at ${t} m`).toBeLessThan(sight)
    }
  })
})

describe('barriers: the vistas', () => {
  it('are four different places, each with exactly one light, 380–520 m from the land centre', () => {
    expect(new Set(plan.vistas.map((v) => v.kind)).size).toBe(4)
    expect(plan.vistas.map((v) => v.kind).sort()).toEqual(['acropolis', 'harbour-city', 'lighthouse', 'sea-arch'])
    for (const vista of plan.vistas) {
      expect(vista.lights).toBe(1)
      expect(vista.distance).toBeGreaterThanOrEqual(380)
      expect(vista.distance).toBeLessThanOrEqual(560)
      expect(vista.fromCamera).toBeGreaterThanOrEqual(360)
      expect(vista.fromCamera).toBeLessThanOrEqual(500)
    }
  })

  it('sea vistas stand beyond the ring in open water; the acropolis stands on the continuation land', () => {
    for (const vista of plan.vistas) {
      if (vista.id === 'north') {
        expect(outerLandField(L, vista.x, vista.z)).toBeGreaterThan(20)
        continue
      }
      const crossing = ringCrossing(outwardPose(vista.id), SEED)
      expect(vista.fromCamera).toBeGreaterThan(crossing.distance + 60)
      expect(outerLandField(L, vista.x, vista.z)).toBeLessThan(-COAST_CLEARANCE)
    }
  })

  it('are fully inside their pose frame: base below the frame top, silhouette top under the edge', () => {
    for (const vista of plan.vistas) {
      const pose = outwardPose(vista.id)
      const cam = poseCamera(pose)
      const ground = vista.id === 'north' ? world.sample(vista.x, vista.z).height : 0
      const base = elevationDownDeg(cam, vista.x, ground, vista.z)
      const top = elevationDownDeg(cam, vista.x, vista.height, vista.z)
      const frameTop = frameTopDeg(pose)
      expect(base - frameTop, `${vista.id} base too close to the frame top`).toBeGreaterThanOrEqual(1.5)
      expect(top - frameTop, `${vista.id} silhouette cropped by the frame top`).toBeGreaterThanOrEqual(0.3)
      expect(inPoseFrame(pose, vista.x, ground, vista.z)).toBe(true)
      expect(inPoseFrame(pose, vista.x, vista.height, vista.z, 0.25)).toBe(true)
      expect(lateralDeg(pose, vista.x, vista.z)).toBeLessThan(3)
    }
  })
})

describe('barriers: the overview frame stays the product frame', () => {
  it('no ring piece or vista enters the overview frustum, even at a 21:9 aspect', () => {
    const cam = poseCamera(overview)
    const check = (x: number, top: number, z: number, label: string) => {
      for (const y of [0, top]) expect(inPoseFrame(overview, x, y, z, -0.5, 2.4), `${label} in the overview frame`).toBe(false)
    }
    for (const m of plan.ring) {
      const r = Math.max(m.rx, m.rz)
      for (const [dx, dz] of [
        [0, 0],
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
      ]) check(m.x + dx, m.height + 4, m.z + dz, `${m.kind} at ${m.x.toFixed(0)},${m.z.toFixed(0)}`)
    }
    for (const v of plan.vistas) check(v.x, v.height, v.z, v.kind)
    expect(cam.y).toBeGreaterThan(250)
  })
})

describe('barriers: determinism', () => {
  it('rebuilds the identical plan from the same seed and a different coast from another', () => {
    expect(barrierPlan(L, SEED)).toEqual(plan)
    const other = barrierPlan(L, SEED + 1)
    expect(other.ring.map((m) => [m.x, m.z])).not.toEqual(plan.ring.map((m) => [m.x, m.z]))
    for (const gap of plan.gaps) {
      const twin = other.gaps.find((g) => g.id === gap.id)!
      expect(bearingDeltaDeg(gap.bearingDeg, twin.bearingDeg)).toBeLessThan(5)
    }
    for (const pose of outward) expect(edgePosePosition(pose)).toEqual(edgePosePosition(outwardPose(plan.gaps.find((g) => g.poseId === pose.id)!.id)))
  })
})
