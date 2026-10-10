import { MARKERS } from '../../markers'
import { GenericProps } from '../GenericProps'
import type { BiomeBouquet, BouquetPropsProps } from './types'

const marker = MARKERS.find((entry) => entry.id === 'forest')!

/** STUB: replace with a hand-built bouquet. Fidelity bar: scene/IceProps.tsx + biomes/ice-town.tsx. */
function Props(props: BouquetPropsProps) {
  return <GenericProps marker={marker} {...props} />
}

export const forest: BiomeBouquet = {
  spec: {
    id: 'forest',
    name: 'Giant Canopy Glade',
    silhouette:
      'One dark-green faceted ball, wider than the plinth, floating over a pale green disc, with a coral mushroom dot tucked at its right shoulder.',
    hero: 'great-round-tree',
    elements: [
      { id: 'great-round-tree', height: 32, slot: 'hero' },
      { id: 'round-tree-pair', height: 28, slot: 'front-left' },
      { id: 'mushroom-cottage', height: 28, slot: 'back-right' },
      { id: 'log-fern', height: 24, slot: 'front-right' },
    ],
    rim: 'Grass-tuft edge: twelve leaning turf blades around the plinth lip with brown root knuckles poking over the edge between them.',
    exaggeration: 'The hero canopy is a single faceted ball about 33 m across on a 16 m plinth: the tree is wider than the ground it grows from.',
    closestProtected:
      'Kirby W1 (spotted red toadstool and round bushes on grass dough) and W5 (round-canopy tree trio). Ours is one giant faceted ball that dwarfs everything, a coral mushroom cottage with door, window and chimney (no white spots), a lollipop tree pair and a fallen log with fern fronds, on a cliff-sided plinth with a turf-tuft rim.',
  },
  Props,
}
