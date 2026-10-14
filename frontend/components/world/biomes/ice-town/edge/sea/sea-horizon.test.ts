import { describe, expect, it } from 'vitest'
import { ICE_FREE_CAMERA_BOX } from '../../camera/stations'
import { ICE_TOWN_LAYOUT, ICE_TOWN_PALETTE } from '../../layout/biome-layout'
import { landField, sampleTerrain } from '../../layout/terrain'
import { skyGradeFor } from '../../scene/sky-blend'
import { stormGrade } from '../../scene/storm-weather'
import {
  ICEBREAKER_PATH,
  PACK_BANDS,
  SEA_FOG,
  SEA_HORIZON,
  annulusRadii,
  icebreakerSchedule,
  icebreakerStateAt,
  mirageSites,
  packIce,
  seaPalette,
  seaSky,
  spoutSites,
  waterAlbedo,
} from './sea-horizon'

const layout = ICE_TOWN_LAYOUT
const extent = layout.worldExtent
const boxDiagonal = Math.hypot(ICE_FREE_CAMERA_BOX.max[0], ICE_FREE_CAMERA_BOX.max[2])
const boxHeight = ICE_FREE_CAMERA_BOX.max[1]
const CAMERA_FAR = 3000

describe('sea horizon radii', () => {
  it('starts the far water outside every authored coast on the plate', () => {
    expect(SEA_HORIZON.innerRadius).toBeGreaterThanOrEqual(220)
    // Every non-sea sample inside the plate must lie inside the annulus hole.
    for (let x = -extent; x <= extent; x += 5) {
      for (let z = -extent; z <= extent; z += 5) {
        const sample = sampleTerrain(layout, x, z)
        if (sample.material === 'sea') continue
        expect(Math.hypot(x, z), `land at ${x},${z} under the annulus`).toBeLessThan(SEA_HORIZON.innerRadius)
      }
    }
  })

  it('puts the horizon beyond the camera box from every corner and inside the camera far plane', () => {
    expect(SEA_HORIZON.horizonRadius).toBeGreaterThan(boxDiagonal)
    expect(SEA_HORIZON.horizonRadius).toBeLessThan(CAMERA_FAR)
    // The far side of the horizon ring seen from a box corner must not be clipped either.
    expect(Math.hypot(SEA_HORIZON.horizonRadius + boxDiagonal, SEA_HORIZON.wallHeight)).toBeLessThanOrEqual(CAMERA_FAR)
  })

  it('keeps the haze wall top above the frame from the highest camera', () => {
    // The lab camera always looks down at >= 12 deg with a 26 deg FOV, so the frame never shows more than
    // 1 deg above eye level: the wall top must be more than 1 deg up from the highest, farthest camera.
    const nearest = SEA_HORIZON.horizonRadius - boxDiagonal
    const elevation = Math.atan2(SEA_HORIZON.wallHeight - boxHeight, nearest + 2 * boxDiagonal)
    expect(elevation).toBeGreaterThan((1 * Math.PI) / 180)
    // ... and the glow itself is a horizon band, not a sky painting.
    expect(SEA_HORIZON.glowHeight).toBeLessThan(SEA_HORIZON.wallHeight * 0.5)
  })

  it('only diverges from the scene fog beyond any authored water the camera can see', () => {
    // From a box corner the far side of the inner circle is the most distant authored water.
    const farthestAuthored = Math.hypot(boxDiagonal + SEA_HORIZON.innerRadius, boxHeight)
    expect(SEA_HORIZON.hazeNear).toBeGreaterThanOrEqual(farthestAuthored)
    // ... and is fully saturated before the nearest point of the horizon wall (allowing the view-depth cosine).
    const nearestWall = (SEA_HORIZON.horizonRadius - boxDiagonal) * Math.cos((26 * Math.PI) / 180)
    expect(SEA_HORIZON.hazeFar).toBeLessThanOrEqual(nearestWall)
    expect(SEA_HORIZON.hazeNear).toBeLessThan(SEA_HORIZON.hazeFar)
  })

  it('spaces the annulus rings from the inner edge to the horizon', () => {
    const radii = annulusRadii(24)
    expect(radii[0]).toBe(SEA_HORIZON.innerRadius)
    expect(radii[radii.length - 1]).toBe(SEA_HORIZON.horizonRadius)
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeGreaterThan(radii[i - 1])
  })
})

describe('sea sky override', () => {
  const day = skyGradeFor(false, null, ICE_TOWN_PALETTE)
  const night = skyGradeFor(true, null, ICE_TOWN_PALETTE)
  const storm = skyGradeFor(false, stormGrade(1), ICE_TOWN_PALETTE)

  it('keeps the authored land crisp and the horizon soft, in range', () => {
    for (const [grade, context] of [
      [day, { night: false, storm: false }],
      [night, { night: true, storm: false }],
    ] as const) {
      const out = seaSky(grade, context)
      expect(out.fogNear).toBeGreaterThanOrEqual(220)
      expect(out.fogNear).toBeLessThanOrEqual(400)
      expect(out.fogFar).toBeGreaterThanOrEqual(1800)
      expect(out.fogFar).toBeLessThanOrEqual(SEA_HORIZON.horizonRadius)
      expect(out.fogFar).toBeLessThan(CAMERA_FAR)
      expect(out.fogNear).toBeLessThan(out.fogFar)
      // Sky, lights and colours are the base grade's: the technique only owns the fog.
      expect(out.sky).toBe(grade.sky)
      expect(out.sunIntensity).toBe(grade.sunIntensity)
    }
  })

  it('closes the sea in a storm without turning it into a wall', () => {
    const out = seaSky(storm, { night: false, storm: true })
    expect(out.fogFar).toBeLessThan(SEA_FOG.calm.far)
    expect(out.fogFar).toBeGreaterThanOrEqual(900)
    expect(out.fogNear).toBeGreaterThanOrEqual(stormGrade(1).fogNear)
    expect(out.sky).toBe(storm.sky)
  })
})

describe('far water colour', () => {
  it('matches the authored water exactly at the inner edge and pales toward the horizon', () => {
    const day = seaPalette(false, false)
    const night = seaPalette(true, false)
    expect(day.water).toBe(ICE_TOWN_PALETTE.water)
    expect(night.water).toBe(ICE_TOWN_PALETTE.waterNight)
    expect(waterAlbedo(SEA_HORIZON.innerRadius, day)).toBe(day.water)
    expect(waterAlbedo(SEA_HORIZON.innerRadius - 50, day)).toBe(day.water)
    expect(waterAlbedo(SEA_HORIZON.horizonRadius, day)).toBe(day.far)
    const luma = (hex: string) => {
      const n = parseInt(hex.slice(1), 16)
      return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114
    }
    let previous = luma(waterAlbedo(SEA_HORIZON.innerRadius, day))
    for (let r = SEA_HORIZON.innerRadius + 100; r <= SEA_HORIZON.horizonRadius; r += 100) {
      const current = luma(waterAlbedo(r, day))
      expect(current).toBeGreaterThanOrEqual(previous - 1e-6)
      previous = current
    }
  })

  it('storm water keeps the authored day colour (the authored sea does not change in a storm)', () => {
    expect(seaPalette(false, true).water).toBe(ICE_TOWN_PALETTE.water)
  })
})

describe('pack ice', () => {
  const pieces = packIce(layout, 7)

  it('orders the bands by distance, denser and bigger toward the horizon', () => {
    for (let i = 1; i < PACK_BANDS.length; i++) {
      expect(PACK_BANDS[i].rMin).toBeGreaterThanOrEqual(PACK_BANDS[i - 1].rMax)
      expect(PACK_BANDS[i].count).toBeGreaterThan(PACK_BANDS[i - 1].count)
      expect(PACK_BANDS[i].size[1]).toBeGreaterThan(PACK_BANDS[i - 1].size[1])
    }
    expect(PACK_BANDS[0].rMin).toBeGreaterThanOrEqual(SEA_HORIZON.innerRadius)
    expect(PACK_BANDS[PACK_BANDS.length - 1].rMax).toBeLessThan(SEA_HORIZON.horizonRadius)
  })

  it('places every piece in its band, on open sea, deterministically', () => {
    expect(pieces.length).toBeGreaterThan(150)
    for (const piece of pieces) {
      const band = PACK_BANDS[piece.band]
      expect(piece.r).toBeGreaterThanOrEqual(band.rMin)
      expect(piece.r).toBeLessThan(band.rMax)
      expect(Math.hypot(piece.x, piece.z)).toBeCloseTo(piece.r, 6)
      expect(landField(layout, piece.x, piece.z)).toBeLessThan(-8)
      expect(piece.size).toBeGreaterThanOrEqual(band.size[0])
      expect(piece.size).toBeLessThanOrEqual(band.size[1])
    }
    expect(packIce(layout, 7)).toEqual(pieces)
    expect(packIce(layout, 8)).not.toEqual(pieces)
  })

  it('keeps clear of the mirage places and the far whales', () => {
    const sites = mirageSites(7)
    const spouts = spoutSites(layout, 7)
    for (const piece of pieces) {
      for (const site of sites) expect(Math.hypot(piece.x - site.x, piece.z - site.z)).toBeGreaterThan(120)
      for (const spout of spouts) expect(Math.hypot(piece.x - spout.x, piece.z - spout.z)).toBeGreaterThan(24)
    }
  })
})

describe('mirage places', () => {
  it('sit just beyond reach, apart from one another, and are seeded', () => {
    const sites = mirageSites(7)
    expect(sites.map((site) => site.id)).toEqual(['cabin-island', 'volcano-berg', 'ice-cathedral', 'tabular-giant'])
    for (const site of sites) {
      expect(site.r).toBeGreaterThanOrEqual(700)
      expect(site.r).toBeLessThanOrEqual(1600)
      expect(Math.hypot(site.x, site.z)).toBeCloseTo(site.r, 6)
    }
    for (let i = 0; i < sites.length; i++) {
      for (let j = i + 1; j < sites.length; j++) {
        expect(Math.hypot(sites[i].x - sites[j].x, sites[i].z - sites[j].z)).toBeGreaterThan(300)
      }
    }
    expect(mirageSites(7)).toEqual(sites)
    expect(mirageSites(9)).not.toEqual(sites)
  })
})

describe('icebreaker crossings', () => {
  const schedule = icebreakerSchedule(7)

  it('is a pure function of the seed and crosses about every 90 s', () => {
    expect(icebreakerSchedule(7)).toEqual(schedule)
    expect(icebreakerSchedule(8)).not.toEqual(schedule)
    expect(schedule.length).toBeGreaterThanOrEqual(40)
    const periods: number[] = []
    for (let i = 1; i < schedule.length; i++) {
      const period = schedule[i].startAt - schedule[i - 1].startAt
      expect(period).toBeGreaterThanOrEqual(75)
      expect(period).toBeLessThanOrEqual(105)
      expect(schedule[i - 1].duration).toBeLessThan(period)
      periods.push(period)
    }
    const mean = periods.reduce((a, b) => a + b, 0) / periods.length
    expect(mean).toBeGreaterThan(84)
    expect(mean).toBeLessThan(96)
    // Direction alternates so the ship comes back the way it went.
    for (let i = 1; i < schedule.length; i++) expect(schedule[i].dir).toBe(-schedule[i - 1].dir)
  })

  it('sails a chord through the far water, hidden between crossings', () => {
    const first = schedule[0]
    expect(icebreakerStateAt(schedule, first.startAt - 1).visible).toBe(false)
    expect(icebreakerStateAt(schedule, first.startAt + first.duration + 1).visible).toBe(false)
    for (const k of [0, 0.25, 0.5, 0.75, 0.999]) {
      const state = icebreakerStateAt(schedule, first.startAt + first.duration * k)
      expect(state.visible).toBe(true)
      expect(state.k).toBeCloseTo(k, 6)
      const r = Math.hypot(state.x, state.z)
      expect(r).toBeGreaterThanOrEqual(SEA_HORIZON.innerRadius + 100)
      expect(r).toBeLessThanOrEqual(ICEBREAKER_PATH.radius + 1e-6)
      expect(landField(layout, state.x, state.z)).toBeLessThan(-20)
    }
    // Heading points along the direction of travel.
    const a = icebreakerStateAt(schedule, first.startAt + first.duration * 0.4)
    const b = icebreakerStateAt(schedule, first.startAt + first.duration * 0.6)
    const heading = Math.atan2(b.x - a.x, b.z - a.z)
    expect(Math.abs(((a.yaw - heading + Math.PI) % (Math.PI * 2)) - Math.PI)).toBeLessThan(1e-6)
  })
})

describe('far whale spouts', () => {
  it('seeds three sites in the visible middle distance with their own schedules', () => {
    const sites = spoutSites(layout, 7)
    expect(sites).toHaveLength(3)
    for (const site of sites) {
      expect(site.r).toBeGreaterThanOrEqual(SEA_HORIZON.innerRadius + 60)
      expect(site.r).toBeLessThanOrEqual(620)
      expect(landField(layout, site.x, site.z)).toBeLessThan(-20)
      expect(site.schedule.length).toBeGreaterThan(10)
      expect(site.schedule[0].startAt).toBeGreaterThan(0)
    }
    expect(new Set(sites.map((site) => site.schedule[0].startAt)).size).toBe(3)
    expect(spoutSites(layout, 7)).toEqual(sites)
  })
})
