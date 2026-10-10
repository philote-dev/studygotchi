import type { MarkerId } from '../markers'
import { academyTown } from './academy-town'
import { alpine } from './alpine'
import { celestialGarden } from './celestial-garden'
import { city } from './city'
import { egyptianDesert } from './egyptian-desert'
import { forest } from './forest'
import { fractalRecursion } from './fractal-recursion'
import { futureUtopia } from './future-utopia'
import { harborTown } from './harbor-town'
import { heavyIndustry } from './heavy-industry'
import { iceTown } from './ice-town'
import { inkWorld } from './ink-world'
import { jungle } from './jungle'
import { swamp } from './swamp'
import type { BiomeBouquet } from './types'
import { volcanic } from './volcanic'
import { whimsicalLand } from './whimsical-land'
import { wildwest } from './wildwest'

export type { BiomeBouquet, BouquetElement, BouquetPropsProps, BouquetSpec, BouquetTerrain } from './types'

/** One hand-built bouquet per roster family. File ownership: one biome, one file. */
export const BIOME_BOUQUETS: Record<MarkerId, BiomeBouquet> = {
  'ice-town': iceTown,
  'ink-world': inkWorld,
  'celestial-garden': celestialGarden,
  'heavy-industry': heavyIndustry,
  'future-utopia': futureUtopia,
  'harbor-town': harborTown,
  'academy-town': academyTown,
  wildwest,
  volcanic,
  'egyptian-desert': egyptianDesert,
  alpine,
  swamp,
  jungle,
  forest,
  city,
  'whimsical-land': whimsicalLand,
  'fractal-recursion': fractalRecursion,
}

export function bouquetFor(id: MarkerId): BiomeBouquet {
  return BIOME_BOUQUETS[id]
}
