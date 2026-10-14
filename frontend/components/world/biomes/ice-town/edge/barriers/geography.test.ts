import { describe, expect, it } from 'vitest'
import { ICE_TOWN_LAYOUT as L, mountainProfile } from '../../layout/biome-layout'
import { landField, mountainPeaks, sampleTerrain } from '../../layout/terrain'
import { EDGE_POSES, edgePosePosition } from '../poses'
import { createOuterWorld } from '../endless/outer-world'
import {
  COAST_CLEARANCE,
  HEADLAND_MAX_HEIGHT,
  HEADLAND_RADIUS,
  SHELF_LAND_LIMIT,
  SHELF_SINK_DEPTH,
  type VistaGap,
  apronSample,
  barrierPlan,
  bearingDeltaDeg,
  bearingOf,
  distanceToSightline,
  elevationDownDeg,
  exposedPlateEdge,
  frameHalfWidthDeg,
  frameTopDeg,
  gapAt,
  headlands,
  inPoseFrame,
  lateralDeg,
  outwardPose,
  poseCamera,
  ringCrossing,
  ringRadiusAt,
  shelfSeat,
  sightlineClear,
  snowfieldHeight,
  viewBearingDeg,
  wrapDeg,
} from './geography'

const SEED = 8223
const plan = barrierPlan(L, SEED)
const outward = EDGE_POSES.filter((pose) => pose.id.endsWith('-out'))

describe('barriers: camera frame maths', () => {
  it('turns a pose azimuth into the direction it looks', () => {
    expect(viewBearingDeg(outwardPose('north'))).toBe(196)
    expect(viewBearingDeg(outwardPose('south'))).toBe(4)
    expect(bearingDeltaDeg(350, 10)).toBe(20)
    expect(bearingOf(0, -1)).toBe(180)
    expect(bearingOf(1, 0)).toBe(90)
  })

  it('measures the frame from the pose camera', () => {
    const pose = outwardPose('north')
    const cam = poseCamera(pose)
    expect(cam).toEqual(expect.objectContaining({ y: expect.closeTo(56.4, 0.5) }))
    expect(frameTopDeg(pose)).toBe(5)
    // The pose target itself is dead centre.
    expect(elevationDownDeg(cam, ...pose.target)).toBeCloseTo(pose.pitchDeg, 1)
    expect(lateralDeg(pose, pose.target[0], pose.target[2])).toBeCloseTo(0, 5)
    expect(inPoseFrame(pose, ...pose.target)).toBe(true)
    // The sea 1 km out is above the frame top at this pitch: that is why the vistas are nearer.
    const far = { x: cam.x - Math.sin((16 * Math.PI) / 180) * 1000, z: cam.z - Math.cos((16 * Math.PI) / 180) * 1000 }
    expect(inPoseFrame(pose, far.x, 0, far.z)).toBe(false)
  })
})

describe('barriers: three headlands, no ring', () => {
  const heads = headlands(plan.gaps)
  const across = EDGE_POSES.filter((pose) => !pose.id.endsWith('-out'))

  it('are the gate west of the south window, a headland east of it and one south of the east window, 240–300 m out', () => {
    expect(heads.map((h) => h.id)).toEqual(['gate', 'south-east', 'east-south'])
    expect(plan.ring.length).toBeGreaterThanOrEqual(14)
    expect(plan.ring.length).toBeLessThanOrEqual(26)
    for (const m of plan.ring) {
      const r = Math.hypot(m.x, m.z)
      expect(r, `${m.kind} radius`).toBeGreaterThanOrEqual(HEADLAND_RADIUS[0] - 20)
      expect(r, `${m.kind} radius`).toBeLessThanOrEqual(HEADLAND_RADIUS[1] + 40)
      const nearest = Math.min(...heads.map((h) => bearingDeltaDeg(bearingOf(m.x, m.z), h.bearingDeg)))
      expect(nearest, `${m.kind} belongs to no headland`).toBeLessThan(20)
    }
    // The ring's old radius function is still the gaps' crossing line.
    expect(ringRadiusAt(10, SEED)).toBeGreaterThan(215)
  })

  it('keeps every block in open sea at least 40 m from any coast (footprint samples)', () => {
    for (const m of plan.ring) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        const x = m.x + Math.cos(a) * Math.max(m.rx, m.rz)
        const z = m.z + Math.sin(a) * Math.max(m.rx, m.rz)
        const phantomShelf = -z > L.worldExtent + SHELF_SINK_DEPTH && sampleTerrain(L, x, z).material === 'ice'
        if (!phantomShelf) expect(sampleTerrain(L, x, z).material, `${m.kind} at ${m.x.toFixed(0)},${m.z.toFixed(0)}`).toBe('sea')
        expect(landField(L, x, z), `${m.kind} footprint near land`).toBeLessThan(-COAST_CLEARANCE)
      }
    }
  })

  it('are low and broken: every block a different height, none over 18 m, only the gate taller', () => {
    const blocks = plan.ring.filter((m) => m.kind !== 'arch')
    for (const m of blocks) expect(m.height, m.kind).toBeLessThanOrEqual(HEADLAND_MAX_HEIGHT)
    const heights = blocks.filter((m) => m.kind === 'headland').map((m) => Math.round(m.height * 2) / 2)
    expect(new Set(heights).size).toBeGreaterThanOrEqual(Math.ceil(heights.length * 0.7))
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(6)
    expect(plan.ring.filter((m) => m.kind === 'arch')).toHaveLength(1)
    expect(plan.ring.find((m) => m.kind === 'arch')?.span).toBeGreaterThanOrEqual(50)
    // Peaked tops: no headland block is a flat-topped slab.
    for (const m of blocks) expect(m.cap).toBe(false)
  })

  it('stand on bearings no pose crosses: out of frame from every pose that looks across the plate, and clear of every window', () => {
    for (const pose of across) {
      const cam = poseCamera(pose)
      for (const m of plan.ring) {
        const d = Math.hypot(m.x - cam.x, m.z - cam.z)
        // Base or top anywhere inside the frame (with 2° of slack) counts as in frame.
        const seen = inPoseFrame(pose, m.x, 0, m.z, -2) || inPoseFrame(pose, m.x, m.height, m.z, -2)
        expect(!seen || d >= 420, `${m.kind} is in the ${pose.id} frame at ${d.toFixed(0)} m`).toBe(true)
      }
    }
    for (const gap of plan.gaps) {
      for (const m of plan.ring) {
        const off = bearingDeltaDeg(bearingOf(m.x, m.z), gap.bearingDeg)
        expect(off, `${m.kind} inside the ${gap.id} window`).toBeGreaterThan(gap.halfWidthDeg)
      }
    }
  })

  it('never has two massifs stacked on the same spot', () => {
    for (let i = 0; i < plan.ring.length; i++) {
      for (let j = i + 1; j < plan.ring.length; j++) {
        const a = plan.ring[i]
        const b = plan.ring[j]
        const d = Math.hypot(a.x - b.x, a.z - b.z)
        expect(d, `${a.kind}#${i} vs ${b.kind}#${j}`).toBeGreaterThan(Math.min(a.rx, a.rz) * 0.5 + Math.min(b.rx, b.rz) * 0.5)
      }
    }
  })
})

describe('barriers: the four windows', () => {
  it('declares one gap per outward pose, each on that pose’s view ray', () => {
    expect(plan.gaps.map((g) => g.poseId).sort()).toEqual(outward.map((p) => p.id).sort())
    for (const pose of outward) {
      const crossing = ringCrossing(pose, SEED)
      const gap = gapAt(plan.gaps, crossing.bearingDeg)
      expect(gap, `${pose.id} view ray misses every gap`).not.toBeNull()
      expect(gap!.poseId).toBe(pose.id)
      expect(bearingDeltaDeg(crossing.bearingDeg, gap!.bearingDeg)).toBeLessThanOrEqual(gap!.halfWidthDeg)
      // Sanity: the ring is between the pose camera and the frame top's sea line.
      expect(crossing.distance).toBeGreaterThan(180)
      expect(crossing.distance).toBeLessThan(330)
    }
  })

  it('leaves the sightline from each pose camera to its vista clear of walls', () => {
    for (const vista of plan.vistas) {
      const pose = outwardPose(vista.id)
      const cam = poseCamera(pose)
      for (const m of plan.ring) {
        const between = Math.hypot(m.x - cam.x, m.z - cam.z) < vista.fromCamera
        if (!between) continue
        expect(distanceToSightline(cam, vista, m.x, m.z), `${m.kind} blocks the ${vista.id} window`).toBeGreaterThan(Math.max(m.rx, m.rz) + 4)
      }
    }
  })

  it('frames the south window on both sides (the gate and a headland) and the east window on its south side', () => {
    const framing = (gap: VistaGap, side: -1 | 1) =>
      plan.ring.filter((m) => {
        const w = wrapDeg(bearingOf(m.x, m.z) - gap.bearingDeg) * side
        return w > gap.halfWidthDeg && w < gap.halfWidthDeg + 24
      })
    const south = plan.gaps.find((g) => g.id === 'south')!
    const east = plan.gaps.find((g) => g.id === 'east')!
    expect(framing(south, -1).some((m) => m.kind === 'arch')).toBe(true)
    expect(framing(south, 1).length).toBeGreaterThanOrEqual(4)
    expect(framing(east, 1).length).toBeGreaterThanOrEqual(4)
    // Each headland is in its own window's frame, as a frame: inside the lateral field, never over the centre.
    for (const [gap, side] of [
      [south, -1],
      [south, 1],
      [east, 1],
    ] as Array<[VistaGap, -1 | 1]>) {
      const pose = outwardPose(gap.id)
      const seen = framing(gap, side).filter((m) => lateralDeg(pose, m.x, m.z) < frameHalfWidthDeg())
      expect(seen.length, `${gap.id} side ${side} frame not in view`).toBeGreaterThanOrEqual(2)
      for (const m of seen) expect(lateralDeg(pose, m.x, m.z)).toBeGreaterThan(6)
    }
  })
})

describe('barriers: the vistas', () => {
  it('stand beyond the ring, in open sea, within the frame-top sea line', () => {
    for (const vista of plan.vistas) {
      const pose = outwardPose(vista.id)
      const crossing = ringCrossing(pose, SEED)
      expect(vista.fromCamera).toBeGreaterThan(crossing.distance + 60)
      expect(vista.distance).toBeGreaterThanOrEqual(300)
      expect(vista.distance).toBeLessThanOrEqual(460)
      expect(sampleTerrain(L, vista.x, vista.z).material).toBe('sea')
      expect(landField(L, vista.x, vista.z)).toBeLessThan(-COAST_CLEARANCE)
    }
  })

  it('are fully inside their pose frame: base below the frame top, silhouette top under the edge', () => {
    for (const vista of plan.vistas) {
      const pose = outwardPose(vista.id)
      const cam = poseCamera(pose)
      const seat = vista.seatY ?? 0
      const base = elevationDownDeg(cam, vista.x, seat, vista.z)
      const top = elevationDownDeg(cam, vista.x, seat + vista.height, vista.z)
      const frameTop = frameTopDeg(pose)
      expect(base - frameTop, `${vista.id} base too close to the frame top`).toBeGreaterThanOrEqual(1.5)
      expect(top - frameTop, `${vista.id} silhouette cropped by the frame top`).toBeGreaterThanOrEqual(0.3)
      expect(inPoseFrame(pose, vista.x, seat, vista.z)).toBe(true)
      expect(inPoseFrame(pose, vista.x, seat + vista.height, vista.z, 0.25)).toBe(true)
      expect(lateralDeg(pose, vista.x, vista.z)).toBeLessThan(3)
      // Each place has its own silhouette and one light.
      expect(['warm', 'cyan']).toContain(vista.light)
    }
    expect(new Set(plan.vistas.map((v) => v.kind)).size).toBe(4)
  })

  it('seats the observatory ridge on the snowfield', () => {
    const north = plan.vistas.find((v) => v.id === 'north')!
    expect(north.seatY).toBeGreaterThan(L.seaLevel + 1)
    expect(north.seatY! + 1e-6).toBeGreaterThanOrEqual(snowfieldHeight(L, north.x, north.z))
    expect(apronSample(L, north.x, north.z).material).not.toBe('sea')
  })
})

describe('barriers: floes and apron', () => {
  it('scatters a far field beyond the headlands and a mid field inside them, all in sea, off the snowfield and clear of the vistas', () => {
    expect(plan.floes.far.length).toBeGreaterThanOrEqual(120)
    expect(plan.floes.mid.length).toBeGreaterThanOrEqual(30)
    for (const [x, z] of plan.floes.far) expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(300)
    for (const [x, z] of plan.floes.mid) {
      expect(sampleTerrain(L, x, z).material).toBe('sea')
      expect(landField(L, x, z)).toBeLessThan(-COAST_CLEARANCE)
    }
    for (const [x, z] of [...plan.floes.far, ...plan.floes.mid]) {
      for (const v of plan.vistas) expect(Math.hypot(v.x - x, v.z - z)).toBeGreaterThan(60)
      if (z < -L.worldExtent) expect(snowfieldHeight(L, x, z), `floe on the snowfield at ${x.toFixed(0)},${z.toFixed(0)}`).toBeLessThanOrEqual(L.seaLevel - 0.5)
    }
  })

  it('covers every plate-edge sample that stands above the sea, with an exact seam', () => {
    const exposed = exposedPlateEdge(L)
    expect(exposed.length).toBeGreaterThan(50)
    for (const [x, z] of exposed) {
      expect(z, 'only the back edge of the plate is above water').toBe(-L.worldExtent)
      expect(x).toBeGreaterThanOrEqual(plan.apron.minX)
      expect(x).toBeLessThanOrEqual(plan.apron.maxX)
    }
    expect(plan.apron.maxZ).toBe(-L.worldExtent)
    expect(plan.apron.rows[0]).toBe(-L.worldExtent)
    for (let i = 1; i < plan.apron.rows.length; i++) expect(plan.apron.rows[i]).toBeLessThan(plan.apron.rows[i - 1])
    // At the plate edge the apron is the plate's own heightfield: no step at the seam.
    for (let x = -L.worldExtent; x <= L.worldExtent; x += 4) {
      expect(apronSample(L, x, -L.worldExtent).height).toBeCloseTo(sampleTerrain(L, x, -L.worldExtent, mountainProfile(1), mountainPeaks(L, mountainProfile(1))).height, 6)
    }
  })

  it('runs north as a low snowfield whose shores (east, west, far north) are under the water', () => {
    expect(plan.apron.minZ).toBeLessThanOrEqual(-L.worldExtent - 1000)
    for (let x = plan.apron.minX; x <= plan.apron.maxX; x += 8) {
      expect(apronSample(L, x, plan.apron.minZ).height, `far edge at x=${x} above water`).toBeLessThan(L.seaLevel - 0.3)
    }
    for (const z of plan.apron.rows) {
      expect(apronSample(L, plan.apron.minX, z).height, `west edge at z=${z} above water`).toBeLessThan(L.seaLevel - 0.3)
      expect(apronSample(L, plan.apron.maxX, z).height, `east edge at z=${z} above water`).toBeLessThan(L.seaLevel - 0.3)
    }
    // Inside, it is snow just above the sea, climbing gently: never a cliff.
    let land = 0
    for (let z = -L.worldExtent - 60; z >= -L.worldExtent - 440; z -= 20) {
      for (let x = -260; x <= 240; x += 20) {
        const s = apronSample(L, x, z)
        if (s.material === 'sea') continue
        land++
        expect(s.height).toBeGreaterThan(L.seaLevel + 0.6)
        expect(s.height).toBeLessThan(L.seaLevel + 16)
      }
    }
    expect(land).toBeGreaterThan(400)
  })
})

describe('barriers: the north notch', () => {
  it('shows snow fading into the haze, never the sea or a sea / sky line, across the whole frame band', () => {
    const pose = outwardPose('north')
    const cam = poseCamera(pose)
    const view = (viewBearingDeg(pose) * Math.PI) / 180
    const halfW = frameHalfWidthDeg()
    const north = plan.gaps.find((g) => g.id === 'north')!
    expect(north.halfWidthDeg).toBeGreaterThanOrEqual(15)
    // Along rays across the frame, from the notch floor (~-10°) up to the frame top, the ground the
    // ray lands on past the plate is snowfield, not sea, until it is inside the fog.
    for (let lat = -halfW + 1; lat <= halfW - 1; lat += 3) {
      const a = view + (lat * Math.PI) / 180
      for (let down = frameTopDeg(pose) + 0.3; down <= 10; down += 0.6) {
        const slope = Math.tan((down * Math.PI) / 180)
        for (let d = 240; d <= 760; d += 10) {
          const x = cam.x + Math.sin(a) * d
          const z = cam.z + Math.cos(a) * d
          if (-z < L.worldExtent + 20) continue
          const ground = apronSample(L, x, z)
          if (ground.height >= cam.y - slope * d) {
            // The ray lands here.
            expect(ground.material, `sea at ${x.toFixed(0)},${z.toFixed(0)} (lat ${lat}°, down ${down.toFixed(1)}°)`).not.toBe('sea')
            break
          }
        }
      }
    }
  })

  it('keeps the snowfield’s west shore out of the west window and its east shore out of the east window', () => {
    for (const id of ['west', 'east'] as const) {
      const pose = outwardPose(id)
      for (const z of plan.apron.rows) {
        for (let x = plan.apron.minX; x <= plan.apron.maxX; x += 8) {
          if (apronSample(L, x, z).material === 'sea') continue
          if (-z < L.worldExtent + 2) continue
          expect(inPoseFrame(pose, x, 2, z, -1), `snowfield at ${x},${z} in the ${id} window`).toBe(false)
        }
      }
    }
  })
})

describe('barriers: seated on the endless shelf', () => {
  const world = createOuterWorld(L, SEED)
  const seated = barrierPlan(L, SEED, { shelf: world })

  it('keeps the headlands (all of them stand in the pack, none on the shelf’s land) and never changes the no-shelf plan', () => {
    expect(seated.shelf).toBe(true)
    expect(seated.ring.length).toBeGreaterThanOrEqual(plan.ring.length - 2)
    expect(seated.ring.length).toBeLessThanOrEqual(plan.ring.length)
    // Every seated massif is one of the planned ones (same kind, height, footprint); only stacks may have moved into a lead.
    for (const m of seated.ring) {
      const twin = plan.ring.find((p) => p.kind === m.kind && p.height === m.height && p.rx === m.rx && p.rz === m.rz)
      expect(twin, `${m.kind} is not in the base plan`).toBeDefined()
      const moved = Math.hypot(twin!.x - m.x, twin!.z - m.z)
      if (m.kind === 'stack') expect(moved).toBeLessThanOrEqual(26.01)
      else expect(moved).toBe(0)
    }
    expect(barrierPlan(L, SEED).ring).toEqual(plan.ring)
    expect(barrierPlan(L, SEED, { shelf: world })).toEqual(seated)
  })

  it('sits every wall on the pack ice or water under it: seat at the highest point, roots to the lowest', () => {
    for (const m of seated.ring) {
      const seat = shelfSeat(world, m.x, m.z, Math.max(m.rx, m.rz))
      expect(m.seatY, `${m.kind} seat below the sea`).toBeGreaterThanOrEqual(L.seaLevel)
      expect(m.seatY! + 1e-6, `${m.kind} floats over the pack`).toBeGreaterThanOrEqual(seat.maxH)
      expect(m.seatY! - m.rootDepth!, `${m.kind} roots do not reach the lowest ice`).toBeLessThanOrEqual(seat.minH)
      // Pack ice and its pressure ridges, never a mountainside.
      expect(m.seatY).toBeLessThan(L.seaLevel + 16)
      expect(world.landField(m.x, m.z) > 0 && seat.maxH > L.seaLevel + SHELF_LAND_LIMIT, `${m.kind} stands on the shelf's land`).toBe(false)
    }
  })

  it('moves sea stacks into open water (leads, the moat, the broken pack edge)', () => {
    const stacks = seated.ring.filter((m) => m.kind === 'stack')
    expect(stacks.length).toBeGreaterThanOrEqual(3)
    for (const s of stacks) expect(world.sample(s.x, s.z).material, `stack at ${s.x.toFixed(0)},${s.z.toFixed(0)}`).toBe('sea')
  })

  it('puts the north observatory on the shelf’s second mountain row, inside the notch and in frame', () => {
    const north = seated.vistas.find((v) => v.id === 'north')!
    expect(north.onShelf).toBe(true)
    const under = world.sample(north.x, north.z)
    expect(['mountain', 'snow', 'rock']).toContain(under.material)
    expect(north.seatY).toBeCloseTo(under.height, 6)
    expect(under.height).toBeGreaterThanOrEqual(12)
    // Between the first outer row's peaks (row 4), on their forward slope.
    const row4 = world.peaks.filter((p) => p.row === 4)
    const nearest = row4.map((p) => Math.hypot(p.x - north.x, p.z - north.z)).sort((a, b) => a - b)
    expect(nearest[0]).toBeLessThan(60)
    expect(nearest[1]).toBeLessThan(90)
    const pose = outwardPose('north')
    const cam = poseCamera(pose)
    expect(lateralDeg(pose, north.x, north.z)).toBeLessThan(8)
    expect(elevationDownDeg(cam, north.x, north.seatY! + north.height, north.z) - frameTopDeg(pose)).toBeGreaterThanOrEqual(0.4)
    expect(sightlineClear(L, world, cam, north.x, north.seatY! + north.height - 1, north.z)).toBe(true)
    expect(sightlineClear(L, world, cam, north.x, north.seatY! + 2, north.z)).toBe(true)
  })

  it('on a shelf reshaped for the pairing (shore moved north, first outer row dropped, a clearing), keeps our ridge on the ice', () => {
    const gap = plan.gaps.find((g) => g.id === 'north')!
    const north = plan.vistas.find((v) => v.id === 'north')!
    const reshaped = createOuterWorld(L, SEED, {
      northShoreShift: 230,
      dropRows: [4],
      clearings: [{ ax: gap.crossing[0], az: gap.crossing[1], bx: north.x + (north.x - gap.crossing[0]) * 0.3, bz: north.z + (north.z - gap.crossing[1]) * 0.3, radius: 90 }],
    })
    const paired = barrierPlan(L, SEED, { shelf: reshaped })
    const vista = paired.vistas.find((v) => v.id === 'north')!
    // No shelf mountain stands in the notch any more, so the observatory keeps its own ridge, seated on the pack.
    expect(vista.onShelf).toBeFalsy()
    expect(vista.x).toBeCloseTo(north.x, 6)
    expect(vista.seatY).toBeGreaterThanOrEqual(L.seaLevel)
    expect(vista.seatY).toBeLessThanOrEqual(L.seaLevel + 4)
    expect(paired.ring.length).toBe(plan.ring.length)
    for (const m of paired.ring) {
      const seat = shelfSeat(reshaped, m.x, m.z, Math.max(m.rx, m.rz))
      expect(m.seatY! + 1e-6).toBeGreaterThanOrEqual(seat.maxH)
      expect(m.seatY! - m.rootDepth!).toBeLessThanOrEqual(seat.minH)
    }
  })

  it('seats the other vistas on the ice without cropping their tops', () => {
    for (const v of seated.vistas.filter((v) => v.id !== 'north')) {
      const pose = outwardPose(v.id)
      const cam = poseCamera(pose)
      expect(v.seatY).toBeGreaterThanOrEqual(L.seaLevel)
      expect(v.seatY! + 1e-6).toBeGreaterThanOrEqual(world.sample(v.x, v.z).height)
      expect(elevationDownDeg(cam, v.x, v.seatY! + v.height, v.z) - frameTopDeg(pose), `${v.id} cropped`).toBeGreaterThanOrEqual(0.3)
    }
  })
})

describe('barriers: determinism', () => {
  it('rebuilds the identical plan from the same seed and a different coast from another', () => {
    expect(barrierPlan(L, SEED)).toEqual(plan)
    const other = barrierPlan(L, SEED + 1)
    expect(other.ring.map((m) => [m.x, m.z])).not.toEqual(plan.ring.map((m) => [m.x, m.z]))
    // The windows follow the poses, so their bearings only move with the ring's wobble.
    for (const gap of plan.gaps) {
      const twin = other.gaps.find((g) => g.id === gap.id)!
      expect(bearingDeltaDeg(gap.bearingDeg, twin.bearingDeg)).toBeLessThan(4)
    }
    // The poses themselves are the shared rig; the vistas sit on their rays.
    for (const pose of outward) expect(edgePosePosition(pose)).toEqual(edgePosePosition(outwardPose(plan.gaps.find((g) => g.poseId === pose.id)!.id)))
  })
})
