import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { COASTAL_PALETTE as P } from '../../layout/biome-layout'
import { SEA_HORIZON } from './sea-horizon'

/** Geometry builders for the sea side: all flat-coloured via vertex colours so each kind is one draw call. */

/* ---------- horizon haze wall ---------- */

export const WALL_SEGMENTS = 144

/**
 * Open cylinder at the horizon radius (metres; the caller scales). Its normals all point up and its
 * faces point inward, and the material writes depth: the wall then stands in the pixel pass's depth
 * and normal buffers behind every far hill and island, so their silhouettes against the sky draw no
 * ghost outlines once the fog has dissolved them (the override normal pass culls back faces, and a
 * cleared buffer reads as a foreign normal).
 */
export function buildHazeWall(radius = SEA_HORIZON.horizonRadius, yMin = -SEA_HORIZON.wallDepth, yMax = SEA_HORIZON.wallHeight, segments = WALL_SEGMENTS): THREE.BufferGeometry {
  const levels = [yMin, 0, SEA_HORIZON.glowHeight * 0.5, SEA_HORIZON.glowHeight, yMax]
  const count = (segments + 1) * levels.length
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  for (let level = 0; level < levels.length; level++) {
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2
      const i = level * (segments + 1) + s
      positions[i * 3] = Math.sin(a) * radius
      positions[i * 3 + 1] = levels[level]
      positions[i * 3 + 2] = Math.cos(a) * radius
      normals[i * 3 + 1] = 1
    }
  }
  const indices: number[] = []
  for (let level = 0; level < levels.length - 1; level++) {
    for (let s = 0; s < segments; s++) {
      const a = level * (segments + 1) + s
      const b = a + 1
      const d = a + segments + 1
      const e = d + 1
      // Inward-facing winding: seen from inside the ring these are front faces.
      indices.push(a, d, b, b, d, e)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

/** Geometric (winding) normal of the wall's first triangle: inward means toward the axis. */
export function wallFacesInward(geometry: THREE.BufferGeometry): boolean {
  const index = geometry.getIndex()!
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute
  const a = new THREE.Vector3().fromBufferAttribute(pos, index.getX(0))
  const b = new THREE.Vector3().fromBufferAttribute(pos, index.getX(1))
  const c = new THREE.Vector3().fromBufferAttribute(pos, index.getX(2))
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))
  const centre = new THREE.Vector3((a.x + b.x + c.x) / 3, 0, (a.z + b.z + c.z) / 3)
  return n.dot(centre) < 0
}

/** `glow` and `seaLevel` in the drawn units (the caller scales the metre constants). */
export function createWallMaterial(haze: THREE.Color, seaLevel: number, glow: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uHaze: { value: haze },
      uGlow: { value: glow },
      uSeaLevel: { value: seaLevel },
    },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() {
        vY = ( modelMatrix * vec4( position, 1.0 ) ).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uHaze;
      uniform float uGlow;
      uniform float uSeaLevel;
      varying float vY;
      void main() {
        float t = clamp( ( vY - uSeaLevel ) / uGlow, 0.0, 1.0 );
        float a = pow( 1.0 - t, 2.4 );
        gl_FragColor = vec4( uHaze, a );
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    // Writes depth on purpose (see `buildHazeWall`): nothing is ever behind the horizon.
    depthWrite: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  })
}

/* ---------- merged flat-coloured props ---------- */

const scratchMatrix = new THREE.Matrix4()
const scratchQuat = new THREE.Quaternion()
const scratchEuler = new THREE.Euler()
const scratchPos = new THREE.Vector3()
const scratchScale = new THREE.Vector3()

export interface PartOptions {
  rotation?: [number, number, number]
  scale?: [number, number, number] | number
}

/** Accumulates coloured parts into one non-indexed geometry with a `color` attribute (one draw call). */
export class PartBuilder {
  private parts: THREE.BufferGeometry[] = []

  add(geometry: THREE.BufferGeometry, color: string, position: [number, number, number], options: PartOptions = {}): this {
    const part = geometry.index ? geometry.toNonIndexed() : geometry.clone()
    const scale = options.scale ?? 1
    if (typeof scale === 'number') scratchScale.setScalar(scale)
    else scratchScale.set(scale[0], scale[1], scale[2])
    scratchEuler.set(...(options.rotation ?? [0, 0, 0]))
    scratchQuat.setFromEuler(scratchEuler)
    scratchPos.set(...position)
    scratchMatrix.compose(scratchPos, scratchQuat, scratchScale)
    part.applyMatrix4(scratchMatrix)
    const c = new THREE.Color(color)
    const count = part.attributes.position.count
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    part.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    part.deleteAttribute('uv')
    this.parts.push(part)
    geometry.dispose()
    return this
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false)
    for (const part of this.parts) part.dispose()
    this.parts = []
    if (!merged) throw new Error('coastal sea: nothing to merge')
    merged.computeVertexNormals()
    merged.computeBoundingSphere()
    return merged
  }
}

/* ---------- far island unit shapes (footprint radius 1, height 1) ---------- */

export interface IslandColours {
  rock: string
  top: string
  scrub: string
}

export function islandColours(night: boolean): IslandColours {
  return night ? { rock: '#5a4a44', top: '#5e6366', scrub: '#3f4a44' } : { rock: P.cliff, top: P.ground, scrub: P.olive }
}

/**
 * Far silhouette treatment: every normal set to up (so the pixel pass's normal-edge detector draws
 * no facet lines on a shape that is mostly haze anyway, and the toon ramp lights it flat) and the
 * colours baked part way toward the sky.
 */
export function silhouette(geometry: THREE.BufferGeometry, night: boolean, haze: number): THREE.BufferGeometry {
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
  for (let i = 0; i < normal.count; i++) normal.setXYZ(i, 0, 1, 0)
  normal.needsUpdate = true
  const color = geometry.getAttribute('color') as THREE.BufferAttribute
  const sky = new THREE.Color(night ? P.skyNight : P.sky)
  const c = new THREE.Color()
  for (let i = 0; i < color.count; i++) {
    c.setRGB(color.getX(i), color.getY(i), color.getZ(i)).lerp(sky, haze)
    color.setXYZ(i, c.r, c.g, c.b)
  }
  color.needsUpdate = true
  return geometry
}

/** Sea stack: a tapered faceted column with a cream top and a scrub tuft. */
export function buildStackShape(c: IslandColours): THREE.BufferGeometry {
  const b = new PartBuilder()
  b.add(new THREE.CylinderGeometry(0.72, 1, 0.9, 6), c.rock, [0, 0.45, 0])
  b.add(new THREE.CylinderGeometry(0.78, 0.74, 0.12, 6), c.top, [0, 0.96, 0])
  b.add(new THREE.DodecahedronGeometry(0.42, 0), c.scrub, [0.1, 1.08, -0.1], { scale: [1, 0.55, 1] })
  return b.build()
}

/** Low islet: a tabular slab, a cream cap and two scrub patches. */
export function buildIsletShape(c: IslandColours): THREE.BufferGeometry {
  const b = new PartBuilder()
  b.add(new THREE.CylinderGeometry(0.88, 1, 0.82, 7), c.rock, [0, 0.41, 0])
  b.add(new THREE.CylinderGeometry(0.9, 0.86, 0.18, 7), c.top, [0, 0.9, 0])
  b.add(new THREE.DodecahedronGeometry(0.34, 0), c.scrub, [-0.3, 1.02, 0.1], { scale: [1.2, 0.5, 1] })
  b.add(new THREE.DodecahedronGeometry(0.26, 0), c.scrub, [0.42, 1.0, -0.2], { scale: [1.1, 0.5, 1] })
  return b.build()
}

/** Far island: two humps and a shoulder, read as a silhouette through the haze. */
export function buildIslandShape(c: IslandColours): THREE.BufferGeometry {
  const b = new PartBuilder()
  b.add(new THREE.ConeGeometry(1, 1, 7), c.rock, [-0.15, 0.5, 0], { scale: [1, 1, 0.8] })
  b.add(new THREE.ConeGeometry(0.7, 0.72, 6), c.rock, [0.5, 0.36, 0.2], { rotation: [0, 0.4, 0] })
  b.add(new THREE.ConeGeometry(0.42, 0.42, 6), c.top, [-0.15, 0.62, 0], { scale: [1, 1, 0.8] })
  b.add(new THREE.DodecahedronGeometry(0.5, 0), c.scrub, [-0.5, 0.18, 0.35], { scale: [1.2, 0.45, 1] })
  return b.build()
}

/* ---------- the far sail (a lateen fishing boat, metres) ---------- */

export function buildFarSail(night: boolean): THREE.BufferGeometry {
  const b = new PartBuilder()
  const hull = night ? '#9a948a' : P.plaster
  const sail = night ? '#c9c4bb' : '#f8f3e4'
  b.add(new THREE.DodecahedronGeometry(1, 0), hull, [0, 0.5, 0], { scale: [5.2, 1.1, 1.8] })
  b.add(new THREE.BoxGeometry(5.4, 0.3, 1.5), P.cobalt, [0, 1.15, 0])
  b.add(new THREE.CylinderGeometry(0.1, 0.14, 8.6, 5), P.ruinDark, [-0.4, 5.4, 0])
  // Lateen yard and a triangular sail (two triangles, so it reads from both sides).
  b.add(new THREE.CylinderGeometry(0.08, 0.08, 10.5, 4), P.ruinDark, [0.6, 6.4, 0], { rotation: [0, 0, 1.05] })
  const tri = new THREE.BufferGeometry()
  tri.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-3.2, 2.4, 0.05, 3.6, 9.8, 0.05, 3.9, 2.6, 0.05, -3.2, 2.4, -0.05, 3.9, 2.6, -0.05, 3.6, 9.8, -0.05], 3),
  )
  tri.computeVertexNormals()
  b.add(tri, sail, [0, 0, 0])
  return b.build()
}
