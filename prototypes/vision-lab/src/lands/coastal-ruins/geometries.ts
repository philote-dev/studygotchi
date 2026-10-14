import * as THREE from 'three'

/**
 * The whole blockout is built from eight shared geometries, instanced per (geometry, colour)
 * batch. Every primitive except the dome and blob is grounded: origin at the base centre so an
 * instance's y is where it meets the terrain and sy is its height in metres.
 */
export type GeoKey = 'box' | 'cylinder' | 'column' | 'cone' | 'dome' | 'blob' | 'arch' | 'ring'

function grounded<T extends THREE.BufferGeometry>(geometry: T): T {
  geometry.translate(0, 0.5, 0)
  return geometry
}

/** One aqueduct bay in metres: 10 wide, 7.5 tall, 3 deep, round-headed opening; base-centred. */
function archBay(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(-5, 0)
  shape.lineTo(5, 0)
  shape.lineTo(5, 7.5)
  shape.lineTo(-5, 7.5)
  shape.closePath()
  const hole = new THREE.Path()
  hole.moveTo(-3.3, 0)
  hole.lineTo(3.3, 0)
  hole.lineTo(3.3, 2.6)
  hole.absarc(0, 2.6, 3.3, 0, Math.PI, false)
  hole.lineTo(-3.3, 0)
  shape.holes.push(hole)
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false, curveSegments: 7 })
  geometry.translate(0, 0, -1.5)
  return geometry
}

export const GEOMETRY: Record<GeoKey, THREE.BufferGeometry> = {
  box: grounded(new THREE.BoxGeometry(1, 1, 1)),
  cylinder: grounded(new THREE.CylinderGeometry(1, 1, 1, 8)),
  column: grounded(new THREE.CylinderGeometry(0.84, 1, 1, 8)),
  cone: grounded(new THREE.ConeGeometry(1, 1, 7)),
  dome: new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  blob: new THREE.DodecahedronGeometry(1, 0),
  arch: archBay(),
  ring: grounded(new THREE.CylinderGeometry(1, 1, 1, 14, 1, true)),
}

export function triangleCount(geometry: THREE.BufferGeometry): number {
  return geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3
}

export const TRIANGLES = Object.fromEntries(Object.entries(GEOMETRY).map(([key, geometry]) => [key, triangleCount(geometry)])) as Record<GeoKey, number>
