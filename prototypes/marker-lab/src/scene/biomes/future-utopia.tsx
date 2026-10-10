import { MARKERS } from '../../markers'
import { GenericProps } from '../GenericProps'
import type { BiomeBouquet, BouquetPropsProps } from './types'

const marker = MARKERS.find((entry) => entry.id === 'future-utopia')!

/** STUB: replace with a hand-built bouquet. Fidelity bar: scene/IceProps.tsx + biomes/ice-town.tsx. */
function Props(props: BouquetPropsProps) {
  return <GenericProps marker={marker} {...props} />
}

export const futureUtopia: BiomeBouquet = {
  spec: {
    id: 'future-utopia',
    name: 'Mint Needle Commons',
    silhouette: 'A white needle spire with three cyan bands over a pale mint disc ringed by a hairline cyan strip; a glass loop and a green dome sit at its feet.',
    hero: 'civic-spire',
    elements: [
      { id: 'civic-spire', height: 32, slot: 'hero' },
      { id: 'transit-arch', height: 28, slot: 'front-left' },
      { id: 'garden-dome', height: 28, slot: 'back-right' },
      { id: 'hover-lamp', height: 24, slot: 'front-right' },
    ],
    rim: 'Flush glass edge: a smooth mint glass lip with a 0.3 m cyan light strip that goes emissive at night.',
    exaggeration: 'The spire is 80 percent needle: a 26 m white point on a 6 m base, so thin the three cyan bands read as floating dashes.',
    closestProtected: 'Kirby pedestal grammar only (disc plus props); no Kirby world has a spire. Ours is a glass-rimmed mint disc with a plain three-band needle, a monorail loop and a garden dome.',
  },
  Props,
}
