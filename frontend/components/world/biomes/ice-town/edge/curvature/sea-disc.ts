import * as THREE from 'three'

/**
 * The shipped sea is `circleGeometry(2400, 64)`: one centre vertex and a rim, no radial rings.
 * A per-vertex bend would turn that fan into a cone (the rim drops 2 km, the chord to the
 * centre passes 250 m below the harbour). So while the curvature technique is mounted the
 * water mesh borrows this disc instead: same plane, same radius, same material, but with rings
 * every 10 m where the horizon forms and geometric spacing out to the rim.
 */
export const SEA_RADIUS = 2400
export const SEA_THETA_SEGMENTS = 96

export function seaDiscRadii(outer = SEA_RADIUS, inner = 150, fineStep = 10, fineUntil = 420, growth = 1.09): number[] {
  const radii = [0, inner]
  for (let r = inner + fineStep; r < fineUntil; r += fineStep) radii.push(r)
  let r = fineUntil
  while (r < outer) {
    radii.push(r)
    r *= growth
  }
  radii.push(outer)
  return radii
}

/** Flat disc in the XY plane facing +Z (CircleGeometry's frame), so the mesh's own rotation lays it on the sea. */
export function buildSeaDisc(radii = seaDiscRadii(), thetaSegments = SEA_THETA_SEGMENTS): THREE.BufferGeometry {
  const rings = radii.length - 1 // radii[0] is the centre vertex
  const vertexCount = 1 + rings * thetaSegments
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  normals[2] = 1
  uvs[0] = 0.5
  uvs[1] = 0.5
  for (let ring = 0; ring < rings; ring++) {
    const radius = radii[ring + 1]
    for (let j = 0; j < thetaSegments; j++) {
      const index = 1 + ring * thetaSegments + j
      const theta = (j / thetaSegments) * Math.PI * 2
      const x = Math.cos(theta) * radius
      const y = Math.sin(theta) * radius
      positions[index * 3] = x
      positions[index * 3 + 1] = y
      normals[index * 3 + 2] = 1
      uvs[index * 2] = (x / SEA_RADIUS + 1) / 2
      uvs[index * 2 + 1] = (y / SEA_RADIUS + 1) / 2
    }
  }
  const indices: number[] = []
  for (let j = 0; j < thetaSegments; j++) indices.push(0, 1 + j, 1 + ((j + 1) % thetaSegments))
  for (let ring = 0; ring < rings - 1; ring++) {
    const a = 1 + ring * thetaSegments
    const b = a + thetaSegments
    for (let j = 0; j < thetaSegments; j++) {
      const next = (j + 1) % thetaSegments
      indices.push(a + j, b + j, b + next)
      indices.push(a + j, b + next, a + next)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

/** The shipped water: a Mesh over a CircleGeometry of at least a kilometre. Nothing else in the land is that big. */
export function isWaterDisc(object: THREE.Object3D): object is THREE.Mesh {
  const mesh = object as THREE.Mesh
  if (!mesh.isMesh) return false
  const geometry = mesh.geometry as THREE.CircleGeometry
  return geometry?.type === 'CircleGeometry' && (geometry.parameters?.radius ?? 0) >= 1000
}
