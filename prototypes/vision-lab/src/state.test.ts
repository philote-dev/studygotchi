import { describe, expect, it } from 'vitest'
import { INITIAL_STATE, searchFromState, stateFromSearch } from './state'

describe('vision lab state', () => {
  it('round-trips land, direction, pose and night through the URL', () => {
    const state = { land: 'coastal-ruins', direction: 'b', pose: 'walk', night: true, seed: 7 } as const
    expect(stateFromSearch(searchFromState(state))).toEqual(state)
  })

  it('falls back to the first land and direction for unknown ids and treats free as no pose', () => {
    expect(stateFromSearch('?land=mars&dir=z&pose=free')).toEqual({ ...INITIAL_STATE, pose: null })
  })
})
