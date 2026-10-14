import { useMemo } from 'react'
import { BarriersScene } from './barriers'
import { EndlessScene, useAuthoredMountainProfile } from './endless'
import { endlessFog, type OuterWorldOptions } from './endless/outer-world'
import type { EdgeSceneProps, EdgeTechnique } from './types'

/**
 * Shelf and vistas: the two winners together. The endless shelf supplies the ground (pack ice,
 * the snowfield the range eases into, the far rows) and the sky; the barriers supply the fjord
 * ring and its four framed landmarks. The barriers scene is rendered in its composable form: its
 * snow apron off (the shelf already continues the plate on the authored lattice, and two copies
 * would z-fight), its own floe fields off (the shelf's drift ice and pack are there), and every
 * wall and vista seated on the shelf's heightfield (`barrierPlan(…, { shelf })`): roots reach the
 * lowest ice under each footprint, walls the shelf's own land already encloses are dropped, sea
 * stacks move into leads, and the north observatory stands on the shelf's first outer row.
 * Both scenes build the world through `createOuterWorld`, which caches by (layout, seed, options),
 * and both are handed the same options (with the authored plate's mountain profile, so the seam
 * matches the plate's rows), so there is one heightfield and one build.
 */
function Scene(props: EdgeSceneProps) {
  const detected = useAuthoredMountainProfile(!props.profile)
  const profile = props.profile ?? detected
  const options = useMemo<OuterWorldOptions | null>(() => (profile ? { mountainProfile: profile } : null), [profile])
  if (!options) return null
  return (
    <>
      <EndlessScene {...props} world={options} />
      <BarriersScene {...props} apron={false} floes={false} shelf={options} />
    </>
  )
}

export const combined: EdgeTechnique = {
  id: 'combined',
  name: 'Shelf and vistas',
  lineage: "Breath of the Wild's continuing land, fenced by Skyrim's walls and God of War's framed vistas",
  pitch:
    'The endless shelf and the barrier ring together: the coast runs out into seeded pack ice, the authored range eases down ' +
    'into a snowfield, and standing in that ice is the fjord ring of cliffs, spires and the gate, every wall seated on the ' +
    'pack with its roots in the lowest lead under it, with the four framed landmarks (observatory on the first outer row, ' +
    'second lighthouse, icebreaker, ice cathedral) and the far mountain rows as their backdrop. One sky: fog pushed to ' +
    '1.5–1.7 km, far faces tinted toward the sky, no band and no plate edge.',
  Scene,
  sky: endlessFog,
}
