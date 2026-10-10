import { MARKERS } from '../../markers'
import { GenericProps } from '../GenericProps'
import type { BiomeBouquet, BouquetPropsProps } from './types'

const marker = MARKERS.find((entry) => entry.id === 'swamp')!

/** STUB: replace with a hand-built bouquet. Fidelity bar: scene/IceProps.tsx + biomes/ice-town.tsx. */
function Props(props: BouquetPropsProps) {
  return <GenericProps marker={marker} {...props} />
}

export const swamp: BiomeBouquet = {
  spec: {
    id: 'swamp',
    name: 'Mossy Lantern Bayou',
    silhouette: 'A tall dark cypress trunk with pale moss curtains drooping off a flat crown, over an olive disc with one yellow lantern dot at the right.',
    hero: 'bald-cypress',
    elements: [
      { id: 'bald-cypress', height: 32, slot: 'hero' },
      { id: 'stilt-hut', height: 28, slot: 'front-left' },
      { id: 'lantern-post', height: 28, slot: 'back-right' },
      { id: 'reeds-lily', height: 24, slot: 'front-right' },
    ],
    rim: 'Reed-tuft edge: thin reed cones and dark root knuckles around the peat lip, with duckweed patches floating on top of the mud.',
    exaggeration: 'Moss curtains on the cypress hang longer than the trunk is wide, and the paper lantern is bigger than the post head that carries it.',
    closestProtected: 'Kirby W6 (dark wetland with bare trees). Ours leads with a moss-draped cypress and a stilt hut on a boardwalk, adds a paper lantern and pink lilies, and sits on a peat cliff plinth rather than soft dough.',
  },
  Props,
}
