import { MARKERS } from '../../markers'
import { GenericProps } from '../GenericProps'
import type { BiomeBouquet, BouquetPropsProps } from './types'

const marker = MARKERS.find((entry) => entry.id === 'city')!

/** STUB: replace with a hand-built bouquet. Fidelity bar: scene/IceProps.tsx + biomes/ice-town.tsx. */
function Props(props: BouquetPropsProps) {
  return <GenericProps marker={marker} {...props} />
}

export const city: BiomeBouquet = {
  spec: {
    id: 'city',
    name: 'Lilac Block Skyline',
    silhouette:
      'A pale boxy tower turned 45 degrees with a mauve roof slab, over a mauve paving disc; a cream clock dot at front-left and a coral awning flash at the right.',
    hero: 'tower-block',
    elements: [
      { id: 'tower-block', height: 32, slot: 'hero' },
      { id: 'clock-tower', height: 28, slot: 'front-left' },
      { id: 'townhouse-pair', height: 28, slot: 'back-right' },
      { id: 'lamp-planter', height: 24, slot: 'front-right' },
    ],
    rim: 'Kerb and cobble ring: a dark plum kerb band around the plinth edge with a ring of flat cream and mauve cobble plates set on top of it.',
    exaggeration: 'The tower block is all window grid: twelve chunky lit facets across its two visible faces, each window a full storey tall.',
    closestProtected:
      'Kirby W6 (sandstone keep towers with green pipes on a stone pedestal). Ours has no keep and no pipes: a 45-degree window-grid tower block, a clock tower whose face spans most of its width, townhouses with awnings that stick out a storey, and a 24 m lamp post, on a paving-plate plinth with a cobble kerb.',
  },
  Props,
}
