import type { ComponentType } from 'react'
import type { MarkerId } from '../../markers'
import type { PropCount } from '../../state'
import type { BouquetPlacement, BouquetSlot, TerrainLobe } from '../bouquetGeometry'

/** Props every family bouquet component receives. */
export interface BouquetPropsProps {
  propCount: PropCount
  night: boolean
}

export interface BouquetElement {
  /** Must equal the roster prop id in `markers.ts`, in P1 → P4 order. */
  id: string
  height: 32 | 28 | 24
  slot: BouquetSlot
}

/**
 * The reviewable, data-only description of one family's bouquet. Every string
 * is shown on the review board, so write them for Philote, not for the compiler.
 */
export interface BouquetSpec {
  id: MarkerId
  /** Composition name, e.g. "Chilly Village Burst". Unique across the roster. */
  name: string
  /** One sentence: what the 48 px read is. */
  silhouette: string
  /** Roster prop id of the skyline element. Must be P1. */
  hero: string
  elements: readonly BouquetElement[]
  /** The family rim treatment on the single plinth, in words. */
  rim: string
  /** The one exaggerated feature (`.fleet/org.md`). */
  exaggeration: string
  /** Closest protected silhouette (Kirby sheet etc.) and how ours differs. */
  closestProtected: string
  /** Optional family-specific slots; defaults to the shared BOUQUET_PLACEMENTS. */
  placements?: readonly BouquetPlacement[]
}

export interface BouquetTerrain {
  /** Main terrain lobe colour (defaults to pedestal top). */
  primary: string
  /** Every third lobe and the scatter rocks (defaults to pedestal lip). */
  secondary: string
  /** Optional replacement lobes; defaults to the shared terrainLobes(). */
  lobes?: readonly TerrainLobe[]
  /** Set false to drop the three scatter rocks (e.g. water or paper families). */
  rocks?: boolean
}

export interface BiomeBouquet {
  spec: BouquetSpec
  /** The hand-built composition. Must not delegate to GenericProps. */
  Props: ComponentType<BouquetPropsProps>
  /** Family rim treatment around the plinth edge. Receives the pedestal lip colour. */
  Rim?: ComponentType<{ color: string }>
  terrain?: BouquetTerrain
}
