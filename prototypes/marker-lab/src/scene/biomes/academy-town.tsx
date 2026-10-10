import { MARKERS } from '../../markers'
import { GenericProps } from '../GenericProps'
import type { BiomeBouquet, BouquetPropsProps } from './types'

const marker = MARKERS.find((entry) => entry.id === 'academy-town')!

/** STUB: replace with a hand-built bouquet. Fidelity bar: scene/IceProps.tsx + biomes/ice-town.tsx. */
function Props(props: BouquetPropsProps) {
  return <GenericProps marker={marker} {...props} />
}

export const academyTown: BiomeBouquet = {
  spec: {
    id: 'academy-town',
    name: 'Ivy Quad Chime',
    silhouette: 'A brick disc with a green lawn top; one slim brick tower carrying a white cupola as wide as its shaft under a verdigris cap, a steep white pediment to its left and a round green oak in front.',
    hero: 'bell-tower',
    elements: [
      { id: 'bell-tower', height: 32, slot: 'hero' },
      { id: 'library', height: 28, slot: 'front-left' },
      { id: 'campus-row', height: 28, slot: 'back-right' },
      { id: 'quad-oak', height: 24, slot: 'front-right' },
    ],
    rim: 'A pale stone coping course laid over the brick plinth edge, with twelve tapered brick buttresses engaged against the side at 30 degree steps.',
    exaggeration: 'The cupola is as big as the tower: a white drum wider than the brick shaft under an oversized verdigris cap, so the campus reads as one white-capped tower at 48 px.',
    closestProtected: 'Kirby W6 (a pale castle keep on a grass pedestal). Ours is a brick bell tower with a white cupola, a pedimented library, a flat-roofed dorm row and a quad oak with a bench; no battlements, no keep.',
  },
  Props,
}
