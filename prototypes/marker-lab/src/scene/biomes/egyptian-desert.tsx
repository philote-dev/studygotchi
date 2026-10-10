import { MARKERS } from '../../markers'
import { GenericProps } from '../GenericProps'
import type { BiomeBouquet, BouquetPropsProps } from './types'

const marker = MARKERS.find((entry) => entry.id === 'egyptian-desert')!

/** STUB: replace with a hand-built bouquet. Fidelity bar: scene/IceProps.tsx + biomes/ice-town.tsx. */
function Props(props: BouquetPropsProps) {
  return <GenericProps marker={marker} {...props} />
}

export const egyptianDesert: BiomeBouquet = {
  spec: {
    id: 'egyptian-desert',
    name: 'Sunbaked Oasis Crown',
    silhouette:
      'A fat four-step pyramid filling the back of a pale sand disc, a slim obelisk needle to its left, a teal pool dot under two palm fans at the right.',
    hero: 'stepped-pyramid',
    elements: [
      { id: 'stepped-pyramid', height: 32, slot: 'hero' },
      { id: 'obelisk', height: 28, slot: 'front-left' },
      { id: 'oasis', height: 28, slot: 'back-right' },
      { id: 'pylon-gate', height: 24, slot: 'front-right' },
    ],
    rim: 'Three wind-ripple strata bands: thin rings in strata #d2a95e, ripple #e2b98a and sand #efd9a2 at slightly offset radii, stepping down the plinth edge.',
    exaggeration: 'The pyramid has only four fat steps, each riser a quarter of its height: a staircase for giants, not a smooth slope.',
    closestProtected:
      'Kirby W2 (one smooth pyramid on soft sand dough). Ours is a four-step pyramid plus an obelisk, a palm oasis with a teal pool and a pylon gate, on a strata-banded cliff plinth.',
  },
  Props,
}
