import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { MARKERS } from '../markers'
import {
  PLANET_DETAIL,
  PLANET_MARKER_SCALE,
  PLANET_RADIUS,
  facetJitter,
  planetPadGeometry,
  planetPalette,
  planetPlacements,
  planetSurfaceAt,
  type PlanetPlacement,
} from '../planet'
import { Surf } from '../render/materials'
import type { PropCount } from '../state'
import { BouquetBase } from './BouquetBase'
import { Creature } from './Creature'
import { WorldProps } from './WorldProps'

/**
 * Faceted two-tone globe: one non-indexed icosphere whose vertices are pushed
 * out on land and flattened to sea level under every pad footprint, with a
 * per-facet colour (ocean / shallows ring / land). flatShading does the rest.
 */
function buildGlobeGeometry(night: boolean, placements: readonly PlanetPlacement[]): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(PLANET_RADIUS, PLANET_DETAIL)
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const colors = new Float32Array(position.count * 3)
  const palette = planetPalette(night)
  const tint = {
    ocean: new THREE.Color(palette.ocean),
    shallows: new THREE.Color(palette.shallows),
    land: new THREE.Color(palette.land),
  }
  const seats = placements.map((placement) => placement.direction)
  const vertex = new THREE.Vector3()
  const centroid = new THREE.Vector3()

  for (let first = 0; first < position.count; first += 3) {
    centroid.set(0, 0, 0)
    for (let corner = 0; corner < 3; corner++) {
      vertex.fromBufferAttribute(position, first + corner).normalize()
      centroid.add(vertex)
      const { radius } = planetSurfaceAt([vertex.x, vertex.y, vertex.z], seats)
      position.setXYZ(first + corner, vertex.x * radius, vertex.y * radius, vertex.z * radius)
    }
    centroid.normalize()
    const facet: [number, number, number] = [centroid.x, centroid.y, centroid.z]
    const { kind } = planetSurfaceAt(facet, seats)
    const color = tint[kind]
    const gain = palette.exposure * facetJitter(facet)
    for (let corner = 0; corner < 3; corner++) {
      colors.set([color.r * gain, color.g * gain, color.b * gain], (first + corner) * 3)
    }
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

function Globe({ night, placements }: { night: boolean; placements: readonly PlanetPlacement[] }) {
  const geometry = useMemo(() => buildGlobeGeometry(night, placements), [night, placements])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial vertexColors flatShading roughness={0.92} metalness={0} />
    </mesh>
  )
}

/** Orientation: local +Y along the radial, local +Z (marker front) toward the north pole. */
function seatQuaternion(placement: PlanetPlacement): THREE.Quaternion {
  const up = new THREE.Vector3(...placement.direction)
  const front = new THREE.Vector3(...placement.front)
  const right = new THREE.Vector3().crossVectors(up, front).normalize()
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, front))
}

export function PlanetMarkers({
  propCount,
  night,
  creature,
}: {
  propCount: PropCount
  night: boolean
  creature: boolean
}) {
  const placements = useMemo(() => planetPlacements(), [])
  const pad = useMemo(() => planetPadGeometry(), [])
  const seats = useMemo(
    () => placements.map((placement) => ({ placement, quaternion: seatQuaternion(placement) })),
    [placements],
  )

  return (
    <group>
      <Globe night={night} placements={placements} />
      {seats.map(({ placement, quaternion }) => {
        const marker = MARKERS.find((entry) => entry.id === placement.id)!
        return (
          <group key={placement.id} position={placement.position} quaternion={quaternion}>
            {/* Pad: flattened cap in the ground tint; top = seat, skirt buried below sea level. */}
            <mesh position={[0, pad.centerY, 0]} rotation={[0, Math.PI / 24, 0]} receiveShadow>
              <cylinderGeometry args={[pad.radius, pad.radius, pad.height, 24]} />
              <Surf color={marker.pedestal.top} />
            </mesh>
            <group scale={PLANET_MARKER_SCALE}>
              <BouquetBase marker={marker} />
              <WorldProps marker={marker} propCount={propCount} night={night} />
              {creature && <Creature />}
            </group>
          </group>
        )
      })}
    </group>
  )
}
