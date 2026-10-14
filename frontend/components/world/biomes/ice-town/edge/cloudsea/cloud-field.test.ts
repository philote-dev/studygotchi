import { describe, expect, it } from 'vitest'
import { ICE_TOWN_LAYOUT, mountainProfile } from '../../layout/biome-layout'
import { mountainPeaks, sampleTerrain } from '../../layout/terrain'
import { skyGradeFor } from '../../scene/sky-blend'
import { stormGrade } from '../../scene/storm-weather'
import { ICE_FREE_CAMERA_BOX, ICE_FREE_CAMERA_LIMITS, ICE_FREE_LOOK_BOX } from '../../camera/stations'
import {
  CLOUD_SEA,
  buildBeyondMesh,
  buildCoastModel,
  buildCutWall,
  buildDeck,
  cloudAmplitude,
  cloudCrest,
  cloudSeaSky,
  cloudTop,
  cloudTrough,
  coastDistance,
  cutShadow,
  effectiveOffshore,
  farPeaks,
  isLand,
  scatterHeads,
  sisterPlateau,
  withinCameraReach,
} from './cloud-field'

const layout = ICE_TOWN_LAYOUT
const model = buildCoastModel(layout)
const SEED = 8223

describe('cloud sea: coast model', () => {
  it('finds the authored coast ring and the one plate cut (the back land ends at the north edge)', () => {
    expect(model.coast.length / 2).toBeGreaterThan(150)
    expect(model.cuts.map((run) => run.edge)).toEqual(['north'])
    const [north] = model.cuts
    expect(north.from).toBeLessThan(-120)
    expect(north.to).toBeGreaterThan(140)
    expect(Math.min(...north.heights)).toBeGreaterThan(layout.seaLevel)
  })

  it('measures the distance offshore', () => {
    // Harbour mouth: open water a little way off the south coast.
    expect(coastDistance(model, 10, 70)).toBeGreaterThan(8)
    expect(coastDistance(model, 10, 70)).toBeLessThan(40)
    // Far out to sea the distance keeps growing.
    expect(coastDistance(model, 0, 400)).toBeGreaterThan(300)
    expect(isLand(model, 0, 0)).toBe(true)
    expect(isLand(model, 0, 400)).toBe(false)
  })
})

describe('cloud sea: rise profile', () => {
  it('keeps the crests under the water inside the coast clearance and rises past +8 m by 500 m', () => {
    for (let d = 0; d <= CLOUD_SEA.coastClear; d += 5) expect(cloudCrest(d), `crest at ${d} m`).toBeLessThan(layout.seaLevel - 0.5)
    expect(cloudCrest(500)).toBeGreaterThanOrEqual(8)
    expect(cloudCrest(1500)).toBeGreaterThanOrEqual(12)
  })

  it('hides the flat water disc entirely by 400 m (the troughs are above the surface)', () => {
    expect(cloudTrough(400)).toBeGreaterThan(layout.seaLevel + 0.5)
    expect(cloudTrough(260)).toBeGreaterThan(layout.seaLevel + 0.3)
    let last = -Infinity
    for (let d = 0; d <= 2600; d += 10) {
      const trough = cloudTrough(d)
      expect(trough).toBeGreaterThanOrEqual(last - 1e-9)
      expect(cloudAmplitude(d)).toBeGreaterThan(0)
      last = trough
    }
  })

  it('samples the coast ring: every offshore point within 54 m of a coast is still open water', () => {
    let checked = 0
    for (let i = 0; i < model.coast.length; i += 6) {
      const cx = model.coast[i]
      const cz = model.coast[i + 1]
      for (let a = 0; a < 8; a++) {
        const dx = Math.cos((a / 8) * Math.PI * 2)
        const dz = Math.sin((a / 8) * Math.PI * 2)
        for (let step = 6; step <= 54; step += 12) {
          const x = cx + dx * step
          const z = cz + dz * step
          if (isLand(model, x, z)) continue
          // Behind the back-land cut the deck must be cloud (tested below), not water; outside the
          // plate there is no authored water to keep (the deck climbs there, tested below too).
          if (cutShadow(model, x, z).k > 0) continue
          if (Math.max(Math.abs(x), Math.abs(z)) >= layout.worldExtent) continue
          checked++
          expect(cloudTop(model, x, z, SEED).height, `cloud at (${x.toFixed(0)}, ${z.toFixed(0)})`).toBeLessThan(layout.seaLevel - 0.3)
        }
      }
    }
    expect(checked).toBeGreaterThan(400)
  })

  it('is high cloud 500 m out from every coast', () => {
    let checked = 0
    for (let i = 0; i < model.coast.length; i += 10) {
      const cx = model.coast[i]
      const cz = model.coast[i + 1]
      const len = Math.hypot(cx, cz) || 1
      // March seaward until the point is a true 500 m from every coast (inlets and islands count).
      for (let s = 500; s <= 760; s += 20) {
        const x = cx + (cx / len) * s
        const z = cz + (cz / len) * s
        if (coastDistance(model, x, z) < 500) continue
        checked++
        expect(cloudCrest(effectiveOffshore(model, x, z)), `crest ${s} m off (${cx}, ${cz})`).toBeGreaterThanOrEqual(8)
        break
      }
    }
    expect(checked).toBeGreaterThan(40)
  })
})

describe('cloud sea: deck and heads', () => {
  const deck = buildDeck(layout, model, SEED)
  const heads = scatterHeads(model, SEED)

  it('is deterministic from the seed', () => {
    const again = buildDeck(layout, model, SEED)
    expect(again.positions).toEqual(deck.positions)
    expect(scatterHeads(model, SEED)).toEqual(heads)
    const other = buildDeck(layout, model, SEED + 1)
    let differs = 0
    for (let i = 1; i < deck.positions.length; i += 3) if (Math.abs(other.positions[i] - deck.positions[i]) > 0.05) differs++
    expect(differs).toBeGreaterThan(deck.positions.length / 30)
  })

  it('covers the camera box footprint and the far frustum to the fog horizon from any camera', () => {
    const [bx, , bz] = ICE_FREE_CAMERA_BOX.max
    expect(CLOUD_SEA.outerRadius).toBeGreaterThanOrEqual(Math.hypot(bx, bz) + CLOUD_SEA.fog.day.far)
    let minCoast = Infinity
    for (let i = 0; i < model.coast.length; i += 2) minCoast = Math.min(minCoast, Math.hypot(model.coast[i], model.coast[i + 1]))
    expect(CLOUD_SEA.innerRadius).toBeLessThanOrEqual(minCoast)
    expect(deck.outerRing).toBeGreaterThanOrEqual(CLOUD_SEA.outerRadius)
    expect(deck.innerRing).toBeLessThanOrEqual(CLOUD_SEA.innerRadius)
  })

  it('stays under the lowest lab camera anywhere the camera can reach, storm lift included', () => {
    const floor = ICE_FREE_CAMERA_BOX.min[1]
    const ceiling = floor - CLOUD_SEA.cameraClearance
    expect(CLOUD_SEA.cameraFloor).toBe(floor)
    expect(CLOUD_SEA.headCeiling).toBeLessThan(floor)
    expect(CLOUD_SEA.lookBoxHalf).toBe(ICE_FREE_LOOK_BOX.max[0])
    expect(CLOUD_SEA.cameraRange).toBe(ICE_FREE_CAMERA_LIMITS.maxDistance)
    expect(withinCameraReach(0, 0)).toBe(true)
    expect(withinCameraReach(460, 460)).toBe(false)
    let reachable = 0
    for (let i = 0; i < deck.positions.length; i += 3) {
      const x = deck.positions[i]
      const y = deck.positions[i + 1]
      const z = deck.positions[i + 2]
      if (!withinCameraReach(x, z)) continue
      reachable++
      expect(y, `deck at (${x.toFixed(0)}, ${z.toFixed(0)})`).toBeLessThanOrEqual(ceiling)
      expect(y + CLOUD_SEA.stormLift).toBeLessThan(floor)
    }
    expect(reachable).toBeGreaterThan(1000)
    for (const head of heads) {
      if (!withinCameraReach(head.x, head.z)) continue
      const top = head.y + head.sy * CLOUD_SEA.headTop + head.bob
      expect(top, `head at (${head.x.toFixed(0)}, ${head.z.toFixed(0)})`).toBeLessThanOrEqual(ceiling)
      // Storm: the deck group lifts, the head scales about its own origin and heaves harder.
      const stormTop = head.y + head.sy * CLOUD_SEA.headTop * CLOUD_SEA.stormGrow + CLOUD_SEA.stormLift + head.bob * (1 + CLOUD_SEA.stormBob)
      expect(stormTop, `storm head at (${head.x.toFixed(0)}, ${head.z.toFixed(0)})`).toBeLessThan(floor)
    }
  })

  it('never puts a head on the land or in the open-water band', () => {
    for (const head of heads) {
      expect(isLand(model, head.x, head.z)).toBe(false)
      expect(effectiveOffshore(model, head.x, head.z)).toBeGreaterThanOrEqual(CLOUD_SEA.headOffshore)
      expect(head.sy).toBeGreaterThan(0)
    }
    expect(heads.length).toBeGreaterThan(200)
  })

  it('climbs out of the water within 130 m of leaving the plate on every side (no corner-sea holes between the peaks)', () => {
    const e = layout.worldExtent
    for (let t = -e - 60; t <= e + 60; t += 25) {
      for (const [x, z] of [
        [t, -e - 130],
        [t, e + 130],
        [-e - 130, t],
        [e + 130, t],
      ]) {
        expect(cloudTop(model, x, z, SEED).height, `deck just outside the plate at (${x}, ${z})`).toBeGreaterThan(layout.seaLevel + 0.3)
      }
    }
  })

  it('hides the back-land cut: cloud, not water, right behind the north plate edge', () => {
    const e = layout.worldExtent
    const [north] = model.cuts
    for (let x = north.from + 10; x <= north.to - 10; x += 12) {
      for (const depth of [2, 12, 40, 120]) {
        const top = cloudTop(model, x, -e - depth, SEED).height
        expect(top, `behind the cut at x=${x}, ${depth} m out`).toBeGreaterThan(layout.seaLevel + 0.4)
      }
    }
  })
})

describe('cloud sea: cliff wall under the cut', () => {
  it('runs the whole cut, rises above the terrain edge and drops into the cloud', () => {
    const wall = buildCutWall(layout, model, SEED)
    const e = layout.worldExtent
    const profile = mountainProfile(1)
    const peaks = mountainPeaks(layout, profile)
    const [north] = model.cuts
    const tops = new Map<number, number>()
    let minY = Infinity
    for (let i = 0; i < wall.positions.length; i += 3) {
      const x = Math.round(wall.positions[i])
      const y = wall.positions[i + 1]
      const z = wall.positions[i + 2]
      expect(z).toBeLessThanOrEqual(-e + 1e-6)
      minY = Math.min(minY, y)
      if (Math.abs(z + e) < 1e-6) tops.set(x, Math.max(tops.get(x) ?? -Infinity, y))
    }
    expect(minY).toBeLessThan(cloudTrough(CLOUD_SEA.cutOffshore) - 2)
    for (let x = north.from; x <= north.to; x += 2) {
      const terrain = sampleTerrain(layout, x, -e + 0.01, profile, peaks).height
      const top = tops.get(x)
      expect(top, `wall top at x=${x}`).toBeDefined()
      expect(top!).toBeGreaterThanOrEqual(terrain)
    }
    expect(wall.triangles).toBeGreaterThan(100)
  })
})

describe('cloud sea: the beyond', () => {
  const peaks = farPeaks(SEED)
  const plateau = sisterPlateau(SEED)

  it('places four to seven big far peaks 700–1600 m out, one with the observatory', () => {
    expect(peaks.length).toBeGreaterThanOrEqual(4)
    expect(peaks.length).toBeLessThanOrEqual(7)
    for (const peak of peaks) {
      const distance = Math.hypot(peak.x, peak.z)
      expect(distance).toBeGreaterThanOrEqual(700)
      expect(distance).toBeLessThanOrEqual(1600)
      expect(peak.height).toBeGreaterThan(50)
      expect(peak.radius).toBeGreaterThan(peak.height * 0.8)
    }
    expect(peaks.filter((peak) => peak.observatory)).toHaveLength(1)
    expect(farPeaks(SEED)).toEqual(peaks)
  })

  it('puts the sister plateau far off on one bearing, flat-topped above the cloud', () => {
    const distance = Math.hypot(plateau.x, plateau.z)
    expect(distance).toBeGreaterThanOrEqual(900)
    expect(distance).toBeLessThanOrEqual(1600)
    expect(plateau.top).toBeGreaterThan(cloudCrest(distance) + 8)
    expect(plateau.top).toBeLessThan(60)
    expect(plateau.outline.length).toBeGreaterThanOrEqual(8)
    expect(plateau.lights.length).toBeGreaterThan(0)
  })

  it('holds the budget: at most 30 draw calls worth of meshes and 70k triangles', () => {
    const deck = buildDeck(layout, model, SEED)
    const heads = scatterHeads(model, SEED)
    const beyond = buildBeyondMesh(peaks, plateau, SEED)
    const wall = buildCutWall(layout, model, SEED)
    const total = deck.triangles + heads.length * 36 + beyond.triangles + wall.triangles
    expect(total).toBeLessThanOrEqual(70_000)
    expect(deck.triangles).toBeLessThan(32_000)
  })
})

describe('cloud sea: sky', () => {
  const palette = { sky: '#dbe2ee', skyNight: '#22284a' }
  it('pushes the fog out to the cloud horizon by day and night', () => {
    const day = cloudSeaSky(skyGradeFor(false, null, palette), { night: false, storm: false })
    expect(day.fogNear).toBeGreaterThanOrEqual(240)
    expect(day.fogNear).toBeLessThanOrEqual(320)
    expect(day.fogFar).toBeGreaterThanOrEqual(1600)
    expect(day.fogFar).toBeLessThanOrEqual(2200)
    const night = cloudSeaSky(skyGradeFor(true, null, palette), { night: true, storm: false })
    expect(night.fogFar).toBeGreaterThanOrEqual(1200)
    expect(night.sky).not.toBe(day.sky)
  })

  it('keeps the storm close and dark', () => {
    const base = skyGradeFor(false, stormGrade(1), palette)
    const storm = cloudSeaSky(base, { night: false, storm: true })
    expect(storm.sky).toBe(base.sky)
    expect(storm.fogFar).toBeGreaterThanOrEqual(base.fogFar)
    expect(storm.fogFar).toBeLessThan(1200)
  })
})
