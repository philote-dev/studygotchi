import { MARKERS } from '../../markers'
import { GenericProps } from '../GenericProps'
import type { BiomeBouquet, BouquetPropsProps } from './types'

const marker = MARKERS.find((entry) => entry.id === 'whimsical-land')!

/** STUB: replace with a hand-built bouquet. Fidelity bar: scene/IceProps.tsx + biomes/ice-town.tsx. */
function Props(props: BouquetPropsProps) {
  return <GenericProps marker={marker} {...props} />
}

export const whimsicalLand: BiomeBouquet = {
  spec: {
    id: 'whimsical-land',
    name: 'Tipsy Candy Parade',
    silhouette:
      'A pink scalloped disc with one candy-striped disc tower tipping hard to the left, a blue bloom wider than a house at its foot, and a checker ribbon corkscrewing up on the right.',
    hero: 'spiral-tower',
    elements: [
      { id: 'spiral-tower', height: 32, slot: 'hero' },
      { id: 'oversized-flower', height: 28, slot: 'front-left' },
      { id: 'upside-down-house', height: 28, slot: 'back-right' },
      { id: 'checker-spiral', height: 24, slot: 'front-right' },
    ],
    rim: 'Scalloped frill: 14 flat half-discs around the plinth edge alternating candy pink and stripe blue (placeholder until references land).',
    exaggeration:
      'The spiral tower leans a full 12 degrees on top of the slot lean, so its top disc hangs clear of the plinth like a tipping ice-cream stack.',
    closestProtected:
      'Kirby W1 (green dough disc with flowers, a spotted mushroom and two spotted domes) and W9 (rainbow star with a flat yellow checker top). Ours has no mushroom, dome or flat checker: a leaning disc-stack tower, a flower bigger than a house, an upside-down house and a checker path that corkscrews into the air, on a round pink scalloped plinth.',
  },
  Props,
}
