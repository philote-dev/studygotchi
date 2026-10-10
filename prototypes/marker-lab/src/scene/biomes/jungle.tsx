import { MARKERS } from '../../markers'
import { GenericProps } from '../GenericProps'
import type { BiomeBouquet, BouquetPropsProps } from './types'

const marker = MARKERS.find((entry) => entry.id === 'jungle')!

/** STUB: replace with a hand-built bouquet. Fidelity bar: scene/IceProps.tsx + biomes/ice-town.tsx. */
function Props(props: BouquetPropsProps) {
  return <GenericProps marker={marker} {...props} />
}

export const jungle: BiomeBouquet = {
  spec: {
    id: 'jungle',
    name: 'Waterfall Canopy Ruins',
    silhouette: 'A wide umbrella canopy over a green cliff with one white-cyan water stripe falling down its face, a palm leaning left and a pale ruin stack at the back.',
    hero: 'waterfall-tree',
    elements: [
      { id: 'waterfall-tree', height: 32, slot: 'hero' },
      { id: 'palm', height: 28, slot: 'front-left' },
      { id: 'ruin-stack', height: 28, slot: 'back-right' },
      { id: 'tiki-torch', height: 24, slot: 'front-right' },
    ],
    rim: 'Hanging vine fringe: thin green vines dropping 1.2 m below the lip all the way around, with golden fruit dots at the plinth edge.',
    exaggeration: 'The canopy umbrella is wider than the plinth, and one waterfall stripe runs the full height of the cliff so it reads at 48 px.',
    closestProtected: 'Kirby W4 (palm island on soft dough). Ours leads with a waterfall canopy tree over a cliff and a four-block ruin stack; the palm is secondary, and a tiki torch and vine fringe replace the open sand.',
  },
  Props,
}
