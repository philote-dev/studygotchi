import { Surf } from '../../render/materials'
import { ICE_BOUQUET } from '../../iceBouquet'
import { BASE_RADIUS, BASE_TOP } from '../bouquetGeometry'
import { IceProps } from '../IceProps'
import type { BiomeBouquet } from './types'

/** Rounded snow lip: 12 lobes dripping 0.4 m over the plinth edge. */
function IceRim({ color }: { color: string }) {
  return (
    <group>
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (index / 12) * Math.PI * 2
        const width = index % 3 === 0 ? 1.35 : 1.05
        const depth = index % 4 === 0 ? 0.7 : 0.48
        return (
          <mesh
            key={index}
            position={[Math.sin(angle) * (BASE_RADIUS + 0.15), BASE_TOP - depth * 0.38, Math.cos(angle) * (BASE_RADIUS + 0.15)]}
            scale={[width, depth, width * 0.72]}
            castShadow
          >
            <sphereGeometry args={[0.86, 7, 5]} />
            <Surf color={color} />
          </mesh>
        )
      })}
    </group>
  )
}

export const iceTown: BiomeBouquet = {
  spec: {
    id: 'ice-town',
    name: ICE_BOUQUET.name,
    silhouette: ICE_BOUQUET.silhouette,
    hero: 'snow-mountain',
    elements: [
      { id: 'snow-mountain', height: 32, slot: 'hero' },
      { id: 'red-cap-lighthouse', height: 28, slot: 'front-left' },
      { id: 'pine-trio', height: 28, slot: 'back-right' },
      { id: 'timber-house-pair', height: 24, slot: 'front-right' },
    ],
    rim: 'Rounded snow lip, 12 lobes dripping 0.4 m over the cliff-ice edge.',
    exaggeration: 'A 28 m red-cap lighthouse on a 16 m plinth: the cap alone is wider than a house.',
    closestProtected: 'Kirby W3 (pines only on soft dough). Ours adds a three-peak range, a lighthouse, and gabled houses on a cliff-ice plinth.',
  },
  Props: IceProps,
  Rim: IceRim,
  terrain: { primary: '#eef4f7', secondary: '#ffffff', rocks: true },
}
