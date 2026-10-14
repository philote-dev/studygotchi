'use client'

import { createContext, useContext } from 'react'

/**
 * Scene time under the edge lab: a fixed pose freezes every ambient motion (steam, the boat, the
 * walkers, the outer world) at one deterministic instant so captures repeat exactly between
 * rounds and between `edge=none` and `edge=outer`. Null means live time.
 */
export const LabClockContext = createContext<number | null>(null)

export function useFrozenTime(): number | null {
  return useContext(LabClockContext)
}

/** The instant a frozen scene shows: `frozen ?? live`. */
export function sceneTime(frozen: number | null, live: number): number {
  return frozen ?? live
}
