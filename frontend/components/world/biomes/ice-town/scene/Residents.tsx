import type { BiomeLayout, DistrictProgress } from '../layout/biome-layout'
import type { CatastrophePhase } from '../state'
import { OurWalkers } from './OurWalkers'

export { residentPositions, ICE_CAST } from './OurWalkers'

/**
 * The Ice residents are the parade cast in OurWalkers. Their bodies are circles in the land's
 * collider set (parade.ts `stepWalkers` / `settleWalkers`): walking, standing or dismantled,
 * a resident is pushed out of every registered structure each frame and kept off the sea.
 */
export function Residents({
  layout,
  progress,
  phase,
}: {
  layout: BiomeLayout
  progress: DistrictProgress
  count?: number
  seed?: number
  phase: CatastrophePhase
  night?: boolean
}) {
  return <OurWalkers layout={layout} progress={progress} phase={phase} />
}
