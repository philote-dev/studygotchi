import { PHASE_SECONDS, type CatastrophePhase } from '../state'

/**
 * biome-world-structure.md §8.4: blizzard 2 s → residents fall apart 0.6 s → ruin (held) →
 * recovery 3 s → calm. The demo theater only says "fail" / "pass" / "idle"; this turns that into
 * the timed phase list the scene plays.
 */
export type CatastropheEvent = 'idle' | 'fail' | 'pass'

export interface PhaseStep {
  phase: CatastrophePhase
  /** Milliseconds to hold before the next step; the last step holds forever. */
  holdMs: number
}

function ms(seconds: number): number {
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : Number.POSITIVE_INFINITY
}

/** The steps to play when `event` arrives while the scene is in `from`. */
export function catastropheSteps(event: CatastropheEvent, from: CatastrophePhase, reducedMotion = false): PhaseStep[] {
  const ruined = from === 'ruin' || from === 'bang' || from === 'blizzard'
  if (event === 'fail') {
    if (ruined && from === 'ruin') return [{ phase: 'ruin', holdMs: Number.POSITIVE_INFINITY }]
    if (reducedMotion) return [{ phase: 'ruin', holdMs: Number.POSITIVE_INFINITY }]
    return [
      { phase: 'blizzard', holdMs: ms(PHASE_SECONDS.blizzard) },
      { phase: 'bang', holdMs: ms(PHASE_SECONDS.bang) },
      { phase: 'ruin', holdMs: Number.POSITIVE_INFINITY },
    ]
  }
  // pass or idle: anything stormy heals through recovering; calm stays calm.
  if (ruined || from === 'recovering') {
    if (reducedMotion) return [{ phase: 'calm', holdMs: Number.POSITIVE_INFINITY }]
    return [
      { phase: 'recovering', holdMs: ms(PHASE_SECONDS.recovering) },
      { phase: 'calm', holdMs: Number.POSITIVE_INFINITY },
    ]
  }
  return [{ phase: 'calm', holdMs: Number.POSITIVE_INFINITY }]
}

/** Residents only fall apart once the blizzard has rolled in (the "bang"), and stay down in ruin. */
export function residentsFallApart(phase: CatastrophePhase): boolean {
  return phase === 'bang' || phase === 'ruin'
}
