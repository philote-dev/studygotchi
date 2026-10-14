"use client";

import { memo } from 'react'
import type { MarkerDefinition } from './markers'
import type { PropCount } from './bouquet-state'
import { bouquetFor } from './biomes'

/** Renders the registered family bouquet for a roster row (memoised: marker, prop count and night are all it reads). */
export const WorldProps = memo(function WorldProps({
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
})
