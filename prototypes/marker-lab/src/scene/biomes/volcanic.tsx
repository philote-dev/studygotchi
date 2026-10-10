import { MARKERS } from '../../markers'
import { GenericProps } from '../GenericProps'
import type { BiomeBouquet, BouquetPropsProps } from './types'

const marker = MARKERS.find((entry) => entry.id === 'volcanic')!

/** STUB: replace with a hand-built bouquet. Fidelity bar: scene/IceProps.tsx + biomes/ice-town.tsx. */
function Props(props: BouquetPropsProps) {
  return <GenericProps marker={marker} {...props} />
}

export const volcanic: BiomeBouquet = {
  spec: {
    id: 'volcanic',
    name: 'Cinder Forge Burst',
    silhouette: 'A dark truncated cone wearing a thick orange rim, ink organ-pipe columns at its left foot and a white smoke puff front-right, over a tan disc on an ink side.',
    hero: 'crater-cone',
    elements: [
      { id: 'crater-cone', height: 32, slot: 'hero' },
      { id: 'basalt-columns', height: 28, slot: 'front-left' },
      { id: 'forge-house', height: 28, slot: 'back-right' },
      { id: 'ember-rock', height: 24, slot: 'front-right' },
    ],
    rim: 'Chunky basalt crust: 12 irregular dark blocks around the plinth edge, cut by 6 radial ember cracks that are orange by day and emissive at night.',
    exaggeration: 'A crater rim as thick as a tyre: a lava torus a fifth of the cone height, orange by day and glowing at night.',
    closestProtected: 'Kirby W8 (a single volcano on a dark disc). Ours adds a five-column basalt cluster, a forge house with a chimney taller than itself and an ember rock under an oversized smoke puff, on a crusted plinth with ember cracks.',
  },
  Props,
}
