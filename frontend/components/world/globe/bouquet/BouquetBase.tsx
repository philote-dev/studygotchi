"use client";

import type { MarkerDefinition } from './markers'
import { Surf } from './materials'
import { bouquetFor } from './biomes'
import { BASE_HEIGHT, BASE_RADIUS, BASE_TOP, SNOW_CAP_THICKNESS, terrainLobes } from './bouquetGeometry'

/** Neutral fallback rim: a plain lip ring. Families register their own `Rim`. */
function PlainRim({ color }: { color: string }) {
  return (
    <mesh position={[0, BASE_TOP - 0.3, 0]} rotation={[0, Math.PI / 12, 0]} castShadow>
      <cylinderGeometry args={[BASE_RADIUS + 0.35, BASE_RADIUS + 0.2, 0.6, 12]} />
      <Surf color={color} />
    </mesh>
  )
}

const SCATTER_ROCKS: readonly (readonly [number, number, number, number])[] = [
  [-8.3, BASE_TOP + 1, 1.2, 1.5],
  [7.5, BASE_TOP + 0.7, -0.8, 1.1],
  [1.2, BASE_TOP + 0.55, 7.4, 0.9],
]

export function BouquetBase({ marker }: { marker: MarkerDefinition }) {
  const bouquet = bouquetFor(marker.id)
  const Rim = bouquet.Rim ?? PlainRim
  const terrain = bouquet.terrain
  const primary = terrain?.primary ?? marker.pedestal.top
  const secondary = terrain?.secondary ?? marker.pedestal.lip
  const lobes = terrain?.lobes ?? terrainLobes()
  const rocks = terrain?.rocks ?? true

  return (
    <group>
      <mesh position={[0, BASE_HEIGHT / 2, 0]} rotation={[0, Math.PI / 12, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[BASE_RADIUS, BASE_RADIUS * 1.04, BASE_HEIGHT, 12]} />
        <Surf color={marker.pedestal.side} />
      </mesh>
      <mesh position={[0, BASE_TOP + SNOW_CAP_THICKNESS / 2, 0]} rotation={[0, Math.PI / 12, 0]} receiveShadow>
        <cylinderGeometry args={[BASE_RADIUS + 0.3, BASE_RADIUS + 0.3, SNOW_CAP_THICKNESS, 12]} />
        <Surf color={marker.pedestal.top} />
      </mesh>
      <Rim color={marker.pedestal.lip} />

      {lobes.map((lobe, index) => (
        <mesh
          key={index}
          position={[lobe.position[0], BASE_TOP + lobe.height * 0.25, lobe.position[2]]}
          scale={[lobe.radius * lobe.stretch[0], lobe.height * 0.5, lobe.radius * lobe.stretch[1]]}
          rotation={[0, index * 0.37, 0]}
          castShadow
          receiveShadow
        >
          <dodecahedronGeometry args={[1, 1]} />
          <Surf color={index % 3 === 0 ? secondary : primary} />
        </mesh>
      ))}

      {rocks &&
        SCATTER_ROCKS.map(([x, y, z, scale], index) => (
          <mesh key={index} position={[x, y, z]} scale={[scale, scale * 0.72, scale * 0.86]} rotation={[0.2, index * 0.8, -0.1]} castShadow>
            <dodecahedronGeometry args={[1, 0]} />
            <Surf color={secondary} />
          </mesh>
        ))}
    </group>
  )
}
