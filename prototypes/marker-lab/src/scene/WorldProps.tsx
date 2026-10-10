import type { MarkerDefinition } from '../markers'
import type { PropCount } from '../state'
import { bouquetFor } from './biomes'

/** Renders the registered family bouquet for a roster row. */
export function WorldProps({
  marker,
  propCount,
  night,
}: {
  marker: MarkerDefinition
  propCount: PropCount
  night: boolean
}) {
  const { Props } = bouquetFor(marker.id)
  return <Props propCount={propCount} night={night} />
}
