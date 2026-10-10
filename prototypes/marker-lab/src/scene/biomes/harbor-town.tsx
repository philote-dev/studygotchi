import { MARKERS } from '../../markers'
import { GenericProps } from '../GenericProps'
import type { BiomeBouquet, BouquetPropsProps } from './types'

const marker = MARKERS.find((entry) => entry.id === 'harbor-town')!

/** STUB: replace with a hand-built bouquet. Fidelity bar: scene/IceProps.tsx + biomes/ice-town.tsx. */
function Props(props: BouquetPropsProps) {
  return <GenericProps marker={marker} {...props} />
}

export const harborTown: BiomeBouquet = {
  spec: {
    id: 'harbor-town',
    name: 'Quayside Sail Burst',
    silhouette: 'One tall mast with a cream square sail, wider than the dark hull under it, over a blue-grey cobble disc; a long crane jib tilts off the right edge.',
    hero: 'tall-ship',
    elements: [
      { id: 'tall-ship', height: 32, slot: 'hero' },
      { id: 'warehouse-row', height: 28, slot: 'front-left' },
      { id: 'harbour-crane', height: 28, slot: 'back-right' },
      { id: 'buoy-bollard', height: 24, slot: 'front-right' },
    ],
    rim: 'Cobble kerb ring in kerb slate around the quay edge, six ink mooring bollards at 60 degree steps, each with a cream rope loop slung over it.',
    exaggeration: 'The mainsail is wider than the hull is long: a 15 m cream sail with one marigold stripe on an 18 m hull, so the ship reads as sail first, boat second.',
    closestProtected: 'Kirby W4 (palm island with a lighthouse on soft dough). Ours has no lighthouse and no palm: a tall ship in a stone basin, canal-gabled warehouses, a treadwheel crane and a giant buoy on a cut-stone quay.',
  },
  Props,
}
