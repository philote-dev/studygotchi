import { describe, expect, it } from 'vitest'
import { generateKingdom } from '../../layout/biome-layout'
import { inRect, rectEuclid } from '../../layout/terrain'
import { createOuterWorld } from '../outer/outer-world'
import { EDGE_POSES, elevationDownDeg, frameTopDeg, inPoseFrame, lateralDeg, poseCamera, viewBearingDeg } from '../poses'
import { alongRay, barrierPlan, lakeInside, lakeWoodsDensity, outwardPose, rowsHeight, wallDensity, type VistaId } from './geography'
import { buildFarMill, buildVista, windmillSailsGeometry } from './vistas'

const layout = generateKingdom(7)
const SEED = 7
const world = createOuterWorld(layout, SEED)
const plan = world.plan
const plate = world.plate
const outward = EDGE_POSES.filter((pose) => pose.id.endsWith('-out'))

/** Ground along a pose's ray at `d` metres, plus standing trees as a 10 m obstacle. */
function obstacleHeight(x: number, z: number): number {
  const s = world.sample(x, z)
  return s.height + (s.forest > 0.4 ? 10 : 0)
}

describe('barriers: the four windows', () => {
  it('declares one vista per outward pose, each on that pose\u2019s centre ray, beyond the plate, 480–620 m out', () => {
    expect(plan.vistas.map((v) => v.poseId).sort()).toEqual(outward.map((p) => p.id).sort())
    expect(new Set(plan.vistas.map((v) => v.kind)).size).toBe(4)
    for (const vista of plan.vistas) {
      const pose = outwardPose(vista.id)
      expect(lateralDeg(pose, vista.x, vista.z)).toBeLessThan(0.5)
      expect(inRect(plate, vista.x, vista.z)).toBe(false)
      expect(rectEuclid(plate, vista.x, vista.z)).toBeGreaterThan(60)
      expect(vista.fromCamera).toBeGreaterThanOrEqual(480)
      expect(vista.fromCamera).toBeLessThanOrEqual(620)
      expect(Math.hypot(vista.x, vista.z)).toBeGreaterThan(400)
      expect(['warm', 'cool']).toContain(vista.light)
    }
  })

  it('frames every landmark: base well under the frame top, silhouette top under the frame edge, 9–22 % of the frame tall', () => {
    for (const vista of plan.vistas) {
      const pose = outwardPose(vista.id)
      const cam = poseCamera(pose)
      const ground = world.meshHeight(vista.x, vista.z)
      // The crag and the windmill hill are part of the silhouette: measure from the plain around them.
      const hill = vista.kind === 'crag-castle' ? plan.crag : vista.kind === 'windmill-hill' ? plan.millHill : null
      let plain = ground
      if (hill) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
          plain = Math.min(plain, world.sample(vista.x + Math.cos(a) * hill.radius * 1.15, vista.z + Math.sin(a) * hill.radius * 1.15).height)
        }
      }
      const base = elevationDownDeg(cam, vista.x, plain, vista.z)
      const landmarkBase = elevationDownDeg(cam, vista.x, ground, vista.z)
      const top = elevationDownDeg(cam, vista.x, ground + vista.height, vista.z)
      const frameTop = frameTopDeg(pose)
      expect(landmarkBase - frameTop, `${vista.id} base too close to the frame top`).toBeGreaterThanOrEqual(2.5)
      expect(top - frameTop, `${vista.id} silhouette cropped by the frame top`).toBeGreaterThanOrEqual(0.3)
      expect(inPoseFrame(pose, vista.x, ground, vista.z)).toBe(true)
      expect(inPoseFrame(pose, vista.x, ground + vista.height, vista.z, 0.25)).toBe(true)
      const fraction = (base - top) / 36
      expect(fraction, `${vista.id} reads too small`).toBeGreaterThan(0.09)
      expect(fraction, `${vista.id} too big for a far place`).toBeLessThan(0.22)
    }
  })

  it('keeps the sightline from each pose camera to its landmark clear of hills and standing trees', () => {
    for (const vista of plan.vistas) {
      const pose = outwardPose(vista.id)
      const cam = poseCamera(pose)
      const ground = world.sample(vista.x, vista.z).height
      const aim = ground + Math.min(6, vista.height * 0.3)
      const dx = vista.x - cam.x
      const dz = vista.z - cam.z
      const length = Math.hypot(dx, dz)
      for (let d = 40; d < length - 30; d += 10) {
        const k = d / length
        const x = cam.x + dx * k
        const z = cam.z + dz * k
        const rayY = cam.y + (aim - cam.y) * k
        if (inRect(plate, x, z)) continue
        expect(obstacleHeight(x, z), `${vista.id} window blocked at ${x.toFixed(0)},${z.toFixed(0)} (${d} m)`).toBeLessThan(rayY)
      }
    }
  })

  it('cuts the ridge in a saddle on the north ray with a tall peak on each side', () => {
    const north = outwardPose('north')
    const saddle = plan.saddle
    expect(lateralDeg(north, saddle.x, saddle.z)).toBeLessThan(0.5)
    const rowA = plan.rows.find((r) => r.id === 'A')!
    expect(rowsHeight([rowA], saddle.x, saddle.z).height).toBeLessThan(6)
    const left = rowA.peaks.filter((p) => p.x < saddle.x && p.x > saddle.x - saddle.halfWidth - 110)
    const right = rowA.peaks.filter((p) => p.x > saddle.x && p.x < saddle.x + saddle.halfWidth + 110)
    expect(left.length).toBeGreaterThanOrEqual(1)
    expect(right.length).toBeGreaterThanOrEqual(1)
    expect(Math.max(...left.map((p) => p.height))).toBeGreaterThanOrEqual(36)
    expect(Math.max(...right.map((p) => p.height))).toBeGreaterThanOrEqual(36)
    // The crag stands beyond the saddle, taller than the ridge, with the castle on it.
    expect(plan.crag.z).toBeLessThan(saddle.z - 60)
    expect(world.relief(plan.crag.x, plan.crag.z)).toBeGreaterThan(plan.crag.height * 0.9)
  })

  it('opens the east and west forest edges exactly on their pose rays, dense on both sides of each gap', () => {
    for (const side of ['east', 'west'] as const) {
      const wall = plan.walls.find((w) => w.side === side)!
      const pose = outwardPose(side)
      const sign = side === 'east' ? 1 : -1
      const x = sign * (wall.inner + 20)
      // Gap centre on the ray.
      expect(lateralDeg(pose, x, wall.gapZ)).toBeLessThan(1.5)
      expect(wallDensity(plan.walls, x, wall.gapZ)).toBeLessThan(0.05)
      const flank = (dz: number) => Math.max(...[0, 6, 12, 18].map((d) => wallDensity(plan.walls, sign * (wall.inner + 14 + d), wall.gapZ + dz)))
      expect(flank(wall.gapHalf + 40)).toBeGreaterThan(0.6)
      expect(flank(-(wall.gapHalf + 40))).toBeGreaterThan(0.6)
      // The wall stands just past the plate, never on it.
      expect(wall.inner).toBeGreaterThan(plate.maxX)
      for (let z = wall.zMin; z <= wall.zMax; z += 40) expect(wallDensity(plan.walls, sign * (plate.maxX - 4), z)).toBe(0)
    }
  })

  it('spreads the lake across the south beyond the plate, puts the monastery on its far shore and the river into its near shore', () => {
    const lake = plan.lake
    const south = outwardPose('south')
    const monastery = plan.vistas.find((v) => v.id === 'south')!
    expect(lakeInside(lake, monastery.x, monastery.z)).toBeLessThan(-8)
    // Somewhere along the south ray between the plate edge and the monastery there is water.
    let water = 0
    for (let d = 300; d < monastery.fromCamera; d += 10) {
      const p = alongRay(south, d)
      if (lakeInside(lake, p.x, p.z) > 0) water++
    }
    expect(water).toBeGreaterThan(8)
    // The whole lake is beyond the plate's south edge.
    for (let x = plate.minX; x <= plate.maxX; x += 10) expect(lakeInside(lake, x, plate.maxZ)).toBeLessThan(-20)
    expect(world.sample(lake.cx, lake.cz).material).toBe('water')
    expect(world.sample(lake.cx, lake.cz).height).toBeLessThan(lake.level + 0.01)
    // The woods behind the far shore leave a gap on the ray.
    expect(lakeWoodsDensity(plan, monastery.x, plan.lakeWoods.zMin + 30)).toBeLessThan(0.05)
    expect(lakeWoodsDensity(plan, monastery.x + 110, plan.lakeWoods.zMin + 30)).toBeGreaterThan(0.5)
  })

  it('looks outward from all four sides', () => {
    expect(outward.map((pose) => viewBearingDeg(pose)).sort((a, b) => a - b)).toEqual([4, 98, 188, 272])
    for (const pose of outward) {
      expect(pose.pitchDeg).toBeLessThanOrEqual(16)
      const cam = poseCamera(pose)
      expect(Math.hypot(cam.x, cam.z)).toBeLessThan(Math.hypot(pose.target[0], pose.target[2]) + 60)
    }
  })
})

describe('barriers: geometry and determinism', () => {
  it('builds every landmark as one buffer with vertex colours, a lamp, and sails only on the windmill', () => {
    for (const vista of plan.vistas) {
      const haze = world.sample(vista.x, vista.z).haze
      const built = buildVista(vista, { night: false }, haze, SEED)
      const pos = built.geometry.getAttribute('position')
      const col = built.geometry.getAttribute('color')
      expect(pos.count).toBeGreaterThan(60)
      expect(pos.count).toBeLessThan(20_000)
      expect(col.count).toBe(pos.count)
      let top = -Infinity
      for (let i = 0; i < pos.count; i++) {
        expect(Number.isFinite(pos.getY(i))).toBe(true)
        top = Math.max(top, pos.getY(i))
      }
      if (built.sails) top = Math.max(top, built.sails.position[1] + built.sails.radius)
      // The silhouette matches the plan's height within a few metres (sails and spires included).
      expect(Math.abs(top - vista.height), `${vista.kind} top ${top.toFixed(1)} vs ${vista.height}`).toBeLessThan(5)
      expect(built.lamp[1]).toBeGreaterThan(2)
      expect(!!built.sails).toBe(vista.kind === 'windmill-hill')
      built.geometry.dispose()
    }
    const mill = buildFarMill({ night: false }, 0.1)
    expect(mill.getAttribute('position').count).toBeGreaterThan(30)
    const sails = windmillSailsGeometry(8)
    expect(sails.getAttribute('position').count).toBeGreaterThan(30)
    mill.dispose()
    sails.dispose()
  })

  it('rebuilds the identical plan from the same seed and a different ridge from another', () => {
    expect(barrierPlan(layout, SEED)).toEqual(plan)
    const other = barrierPlan(layout, SEED + 1)
    expect(other.rows.map((r) => r.peaks.map((p) => p.x))).not.toEqual(plan.rows.map((r) => r.peaks.map((p) => p.x)))
    // The windows follow the poses, so the vistas and gaps do not move with the seed.
    expect(other.vistas).toEqual(plan.vistas)
    expect(other.saddle).toEqual(plan.saddle)
    expect(other.walls).toEqual(plan.walls)
    for (const id of ['north', 'east', 'south', 'west'] as VistaId[]) expect(outwardPose(id).id).toBe(`${id}-out`)
  })
})
