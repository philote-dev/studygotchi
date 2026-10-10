import { describe, expect, it } from 'vitest'
import { PHASE_SECONDS } from '../state'
import { catastropheSteps, residentsFallApart } from './catastrophe-sequence'

describe('ice catastrophe sequence', () => {
  it('plays blizzard → bang → ruin on fail with the locked timings', () => {
    const steps = catastropheSteps('fail', 'calm')
    expect(steps.map((s) => s.phase)).toEqual(['blizzard', 'bang', 'ruin'])
    expect(steps[0].holdMs).toBe(PHASE_SECONDS.blizzard * 1000)
    expect(steps[1].holdMs).toBe(PHASE_SECONDS.bang * 1000)
    expect(steps[2].holdMs).toBe(Number.POSITIVE_INFINITY)
  })

  it('does not restart the storm when already in ruin', () => {
    expect(catastropheSteps('fail', 'ruin').map((s) => s.phase)).toEqual(['ruin'])
  })

  it('recovers over three seconds from any stormy phase', () => {
    for (const from of ['blizzard', 'bang', 'ruin'] as const) {
      const steps = catastropheSteps('pass', from)
      expect(steps.map((s) => s.phase)).toEqual(['recovering', 'calm'])
      expect(steps[0].holdMs).toBe(PHASE_SECONDS.recovering * 1000)
    }
    expect(catastropheSteps('idle', 'ruin').map((s) => s.phase)).toEqual(['recovering', 'calm'])
  })

  it('stays calm when nothing happened', () => {
    expect(catastropheSteps('idle', 'calm')).toEqual([{ phase: 'calm', holdMs: Number.POSITIVE_INFINITY }])
    expect(catastropheSteps('pass', 'calm')).toEqual([{ phase: 'calm', holdMs: Number.POSITIVE_INFINITY }])
  })

  it('jumps to the end state under reduced motion', () => {
    expect(catastropheSteps('fail', 'calm', true).map((s) => s.phase)).toEqual(['ruin'])
    expect(catastropheSteps('pass', 'ruin', true).map((s) => s.phase)).toEqual(['calm'])
  })

  it('residents fall apart at the bang, not during the blizzard', () => {
    expect(residentsFallApart('blizzard')).toBe(false)
    expect(residentsFallApart('bang')).toBe(true)
    expect(residentsFallApart('ruin')).toBe(true)
    expect(residentsFallApart('recovering')).toBe(false)
    expect(residentsFallApart('calm')).toBe(false)
  })
})
