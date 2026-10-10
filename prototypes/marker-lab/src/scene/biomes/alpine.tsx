import { MARKERS } from '../../markers'
import { GenericProps } from '../GenericProps'
import type { BiomeBouquet, BouquetPropsProps } from './types'

const marker = MARKERS.find((entry) => entry.id === 'alpine')!

/** STUB: replace with a hand-built bouquet. Fidelity bar: scene/IceProps.tsx + biomes/ice-town.tsx. */
function Props(props: BouquetPropsProps) {
  return <GenericProps marker={marker} {...props} />
}

export const alpine: BiomeBouquet = {
  spec: {
    id: 'alpine',
    name: 'Granite Gondola Crest',
    silhouette:
      'Two jagged grey spikes with small white caps over a green disc, one thin diagonal cable from the left pylon up to the peak shoulder, an orange gondola dot hanging on it.',
    hero: 'twin-peak',
    elements: [
      { id: 'twin-peak', height: 32, slot: 'hero' },
      { id: 'cable-pylon', height: 28, slot: 'front-left' },
      { id: 'chalet', height: 28, slot: 'back-right' },
      { id: 'fir-pair', height: 24, slot: 'front-right' },
    ],
    rim: 'Split-granite ledge: 12 chunky grey blocks around the plinth edge, turf tufts #86b26e in the gaps, snow dusting #eef4f7 on 6 of the notches.',
    exaggeration: 'The gondola is bigger than the pylon head that carries it: an orange cabin the size of a chalet hanging from one cable.',
    closestProtected:
      'Kirby W3 (pines on soft dough) and Ice-town (soft white snow cone). Ours is two sharp grey granite spikes joined by a cable and gondola, a wide-roof chalet and a fir pair on a granite-ledge plinth.',
  },
  Props,
}
