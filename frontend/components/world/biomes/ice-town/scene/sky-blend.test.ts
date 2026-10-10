import { describe, expect, it } from 'vitest'
import { ICE_TOWN_PALETTE as P } from '../layout/biome-layout'
import { stormGrade } from './storm-weather'
import { DAY_NIGHT_SECONDS, blendProgress, easeInOutCubic, skyGradeFor } from './sky-blend'

describe('ice sky blend', () => {
  it('takes 1.2 s to cross from day to night', () => {
    expect(DAY_NIGHT_SECONDS).toBe(1.2)
    let t = 0
    let frames = 0
    while (t < 1) {
      t = blendProgress(t, 1 / 60)
      frames++
    }
    expect(frames).toBeGreaterThanOrEqual(72)
    expect(frames).toBeLessThanOrEqual(73)
    expect(blendProgress(0.5, 10)).toBe(1)
  })

  it('snaps under reduced motion', () => {
    expect(blendProgress(0, 0.001, true)).toBe(1)
  })

  it('eases symmetrically', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5)
    expect(easeInOutCubic(1)).toBe(1)
  })

  it('picks the bible §6 skies and lets the storm win over night', () => {
    expect(skyGradeFor(false, null, P).sky).toBe(P.sky)
    expect(skyGradeFor(true, null, P).sky).toBe(P.skyNight)
    expect(skyGradeFor(true, null, P).sunColor).toBe('#8fa3d8')
    const storm = stormGrade(1)
    expect(skyGradeFor(true, storm, P).sky).toBe(storm.sky)
    expect(skyGradeFor(false, storm, P).fogNear).toBe(storm.fogNear)
  })
})
