import { describe, expect, it } from 'vitest'
import { COASTAL_RUINS_LAYOUT as L, skylineProfile } from './biome-layout'
import { sampleTerrain } from './terrain'
import { shoulderData } from './dressing'
import { ESCARPMENT_BOUNDS, TERRACE_RISER, escarpmentHeight, hillDots, hillMass, hillSample } from './escarpment'

const full = skylineProfile(1)
const empty = skylineProfile(0)
const { minX, maxX, minZ, maxZ, cell } = ESCARPMENT_BOUNDS

describe('escarpment: terraced hills', () => {
  it('keeps the comb: every shoulder crest reaches about the profile height at its authored position', () => {
    for (const profile of [empty, skylineProfile(0.5), full]) {
      for (const s of shoulderData(profile)) {
        let peak = 0
        for (let dx = -8; dx <= 8; dx += 2) for (let dz = -6; dz <= 6; dz += 2) peak = Math.max(peak, hillMass(s.x + s.offset * 0.3 + dx, s.z - 2 + dz, profile).mass)
        const want = profile.height * s.scale
        expect(peak, `shoulder at ${s.x.toFixed(0)}`).toBeGreaterThan(want * 0.8)
        expect(peak).toBeLessThan(want * 1.6)
      }
    }
    // Grows with the course like the box comb did.
    const crestAt = (profile: typeof full) => Math.max(...shoulderData(full).map((s) => hillMass(s.x, s.z, profile).mass))
    expect(crestAt(full)).toBeGreaterThan(crestAt(empty) + 6)
  })

  it('no lattice facet rises more than one terrace riser (far under the 12 m bar), and the hills stay inside their strip', () => {
    let maxStep = 0
    let maxRise = 0
    for (let z = minZ; z < maxZ; z += cell) {
      for (let x = minX; x < maxX; x += cell) {
        const h = escarpmentHeight(L, x, z, full)
        const hx = escarpmentHeight(L, x + cell, z, full)
        const hz = escarpmentHeight(L, x, z + cell, full)
        maxStep = Math.max(maxStep, Math.abs(hx - h), Math.abs(hz - h))
        maxRise = Math.max(maxRise, hillSample(x, z, full).rise)
      }
    }
    // One riser plus the hill's own slope over a cell; nothing like the 5.5–18 m box faces.
    expect(maxStep).toBeLessThan(TERRACE_RISER * 2 + 0.5)
    expect(maxStep).toBeLessThan(12)
    expect(maxRise).toBeGreaterThan(16)
    // The plain south of the foot and north of the back row is untouched.
    for (let x = minX; x <= maxX; x += 10) {
      expect(hillSample(x, -77, full).rise).toBe(0)
      expect(hillSample(x, -141.5, full).rise).toBeLessThan(0.3)
      expect(escarpmentHeight(L, x, -77.5, full)).toBeCloseTo(sampleTerrain(L, x, -77.5).height, 6)
    }
  })

  it('cuts the slopes into treads and risers that curve along the contours, and leaves the crests smooth', () => {
    let risers = 0
    let treads = 0
    for (let z = minZ; z < maxZ; z += cell) {
      for (let x = minX; x < maxX; x += cell) {
        const s = hillSample(x, z, full)
        if (s.mass < 1.5) continue
        if (s.riser > 0.5) risers++
        else treads++
      }
    }
    expect(risers).toBeGreaterThan(150)
    expect(treads).toBeGreaterThan(risers)
    // Every shoulder crest (the local top of the hill mass) is left un-terraced: a soft ridge.
    for (const s of shoulderData(full)) {
      let best = { x: s.x, z: s.z, mass: 0 }
      for (let dx = -10; dx <= 10; dx += 1) for (let dz = -8; dz <= 8; dz += 1) {
        const m = hillMass(s.x + s.offset * 0.3 + dx, s.z - 2 + dz, full).mass
        if (m > best.mass) best = { x: s.x + s.offset * 0.3 + dx, z: s.z - 2 + dz, mass: m }
      }
      const crest = hillSample(best.x, best.z, full)
      expect(crest.mass).toBeGreaterThan(6)
      expect(Math.abs(crest.rise - crest.mass), `shoulder at ${s.x.toFixed(0)} has a stepped crest`).toBeLessThan(0.5)
    }
    // Contours curve: the riser line of the central shoulder is not straight in x.
    const s0 = shoulderData(full)[0]
    const riserZ: number[] = []
    for (let x = s0.x - 12; x <= s0.x + 12; x += 2) {
      for (let z = -78; z >= -110; z -= 0.5) {
        if (hillSample(x, z, full).riser > 0.5) {
          riserZ.push(z)
          break
        }
      }
    }
    expect(riserZ.length).toBeGreaterThan(8)
    expect(Math.max(...riserZ) - Math.min(...riserZ)).toBeGreaterThan(2)
  })

  it('dots the treads with scrub and olives, never on a riser', () => {
    const dots = hillDots(L, full)
    expect(dots.length).toBeGreaterThan(100)
    for (const d of dots) {
      const s = hillSample(d.x, d.z, full)
      expect(s.riser).toBeLessThanOrEqual(0.05)
      expect(s.mass).toBeGreaterThanOrEqual(1.2)
      expect(d.y).toBeCloseTo(escarpmentHeight(L, d.x, d.z, full), 6)
    }
    expect(hillDots(L, full)).toEqual(dots)
  })
})
