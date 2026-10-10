import { MARKERS } from '../../markers'
import { GenericProps } from '../GenericProps'
import type { BiomeBouquet, BouquetPropsProps } from './types'

const marker = MARKERS.find((entry) => entry.id === 'fractal-recursion')!

/** STUB: replace with a hand-built bouquet. Fidelity bar: scene/IceProps.tsx + biomes/ice-town.tsx. */
function Props(props: BouquetPropsProps) {
  return <GenericProps marker={marker} {...props} />
}

export const fractalRecursion: BiomeBouquet = {
  spec: {
    id: 'fractal-recursion',
    name: 'Slate Echo Grove',
    silhouette:
      'A slate disc that sprouts smaller copies of itself: a wide branching-square tree across the back, a five-piece stepped pyramid front-left, a twisted shell behind, and a third-scale marker budding on a stalk front-right.',
    hero: 'pythagoras-tree',
    elements: [
      { id: 'pythagoras-tree', height: 32, slot: 'hero' },
      { id: 'sierpinski-pyramid', height: 28, slot: 'front-left' },
      { id: 'spiral-shell', height: 28, slot: 'back-right' },
      { id: 'marker-copy', height: 24, slot: 'front-right' },
    ],
    rim: 'Three one-third-scale slate plinth discs budding off the rim at 120 degree spacing, each with a hot-pink #ff7ad9 lip and one terrain blob.',
    exaggeration:
      'Self-similarity itself: the fourth element is the whole marker again at one-third scale, held up on a slate stalk so its pink-lipped disc reads at 48 px.',
    closestProtected:
      'Kirby W6 (sandstone stacked towers with green pipes on a stone slab) and W2 (one solid pyramid on a pancake stack). Ours is a slate disc with a branching-square tree as the skyline, a hollow five-piece Sierpinski instead of a solid pyramid, no pipes, and the disc repeating itself at one-third scale on its own rim.',
  },
  Props,
}
