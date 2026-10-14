import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ICE_TOWN_PALETTE as P } from '../../layout/biome-layout'
import { SEA_HORIZON, annulusRadii, waterAlbedo, type SeaPalette } from './sea-horizon'

/** Geometry builders for the sea technique: all flat-coloured via vertex colours so each prop is one draw call. */

/* ---------- far water annulus ---------- */

export const ANNULUS_SEGMENTS = 144
export const ANNULUS_RINGS = 26

/** Flat ring in the XZ plane from the inner radius to the horizon, coloured by `waterAlbedo`. */
export function buildAnnulus(palette: SeaPalette, segments = ANNULUS_SEGMENTS, rings = ANNULUS_RINGS): THREE.BufferGeometry {
  const radii = annulusRadii(rings)
  const count = (segments + 1) * rings
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const c = new THREE.Color()
  for (let ring = 0; ring < rings; ring++) {
    const r = radii[ring]
    c.set(waterAlbedo(r, palette))
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2
      const i = ring * (segments + 1) + s
      positions[i * 3] = Math.sin(a) * r
      positions[i * 3 + 1] = 0
      positions[i * 3 + 2] = Math.cos(a) * r
      normals[i * 3 + 1] = 1
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
  }
  const indices: number[] = []
  for (let ring = 0; ring < rings - 1; ring++) {
    for (let s = 0; s < segments; s++) {
      const a = ring * (segments + 1) + s
      const b = a + 1
      const d = a + segments + 1
      const e = d + 1
      // Up-facing winding (counter-clockwise seen from +y).
      indices.push(a, d, b, b, d, e)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

/* ---------- horizon haze wall ---------- */

/**
 * Open cylinder at the horizon radius. Its normals all point up so the pixel pass's normal-edge
 * detector sees no seam where it meets the water (the wall is unlit; the normals are only for that).
 */
export function buildHazeWall(radius = SEA_HORIZON.horizonRadius, yMin = -SEA_HORIZON.wallDepth, yMax = SEA_HORIZON.wallHeight, segments = ANNULUS_SEGMENTS): THREE.BufferGeometry {
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
      indices.push(a, b, d, b, e, d)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

export function createWallMaterial(haze: THREE.Color, seaLevel: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uHaze: { value: haze },
      uGlow: { value: SEA_HORIZON.glowHeight },
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
    depthWrite: false,
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
    if (!merged) throw new Error('sea: nothing to merge')
    merged.computeBoundingSphere()
    return merged
  }
}

/** Colour the faces of a unit shape by their normal: tops snow, sides ice. */
export function colourByNormal(geometry: THREE.BufferGeometry, top: string, side: string, upThreshold = 0.5): THREE.BufferGeometry {
  const out = geometry.index ? geometry.toNonIndexed() : geometry
  const normals = out.attributes.normal as THREE.BufferAttribute
  const count = out.attributes.position.count
  const colors = new Float32Array(count * 3)
  const topColor = new THREE.Color(top)
  const sideColor = new THREE.Color(side)
  for (let i = 0; i < count; i++) {
    const c = normals.getY(i) > upThreshold ? topColor : sideColor
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  out.deleteAttribute('uv')
  if (out !== geometry) geometry.dispose()
  return out
}

/* ---------- pack ice unit shapes ---------- */

export function buildFloeShape(palette: SeaPalette): THREE.BufferGeometry {
  return colourByNormal(new THREE.CylinderGeometry(1, 1.06, 1, 6), palette.snow, palette.iceShade)
}

export function buildBergShape(palette: SeaPalette): THREE.BufferGeometry {
  return colourByNormal(new THREE.DodecahedronGeometry(1, 0), palette.snow, palette.ice, 0.42)
}

export function buildTabularShape(palette: SeaPalette): THREE.BufferGeometry {
  return colourByNormal(new THREE.CylinderGeometry(1, 1.08, 1, 7), palette.snow, palette.ice)
}

/* ---------- icebreaker (far cousin of the moored one in Props.tsx: red hull, ink band, cream house, ink funnel) ---------- */

export function buildFarIcebreaker(): THREE.BufferGeometry {
  const b = new PartBuilder()
  b.add(new THREE.BoxGeometry(5.2, 2.6, 12.0), P.timberRed, [0, 1.2, -1.2])
  b.add(new THREE.ConeGeometry(2.6, 3.6, 4), P.timberRed, [0, 1.2, 5.6], { rotation: [-Math.PI / 2, 0, 0], scale: [1, 1, 0.68] })
  b.add(new THREE.BoxGeometry(5.3, 0.5, 12.1), P.ink, [0, 0.25, -1.2])
  b.add(new THREE.BoxGeometry(5.0, 0.2, 11.6), P.cream, [0, 2.6, -1.2])
  b.add(new THREE.BoxGeometry(4.4, 2.2, 5.6), P.cream, [0, 3.8, -2.8])
  b.add(new THREE.BoxGeometry(3.6, 1.6, 2.6), P.cream, [0, 5.6, -1.8])
  b.add(new THREE.CylinderGeometry(0.7, 0.8, 2.6, 8), P.ink, [0, 6.6, -4.4])
  b.add(new THREE.CylinderGeometry(0.74, 0.74, 0.4, 8), P.timberRed, [0, 7.4, -4.4])
  b.add(new THREE.CylinderGeometry(0.06, 0.1, 3.6, 4), P.ink, [0, 8.0, -1.0])
  b.add(new THREE.BoxGeometry(0.3, 3.4, 0.3), P.peach, [0.9, 4.4, 2.2])
  return b.build()
}

/* ---------- mirage places ---------- */

export interface MirageParts {
  body: THREE.BufferGeometry
  /** Optional separate accent geometry (emissive), its own draw call. */
  accent?: THREE.BufferGeometry
}

/** A low island with a single cabin; the accent is its one lit window. */
export function buildCabinIsland(palette: SeaPalette): MirageParts {
  const b = new PartBuilder()
  b.add(new THREE.CylinderGeometry(1, 1.12, 1, 9), palette.iceShade, [0, -1, 0], { scale: [52, 6, 34] })
  b.add(new THREE.DodecahedronGeometry(1, 0), palette.snow, [-10, 1, 2], { scale: [40, 12, 26] })
  b.add(new THREE.DodecahedronGeometry(1, 0), palette.snow, [22, 0.5, -4], { rotation: [0, 0.8, 0], scale: [26, 8, 20] })
  b.add(new THREE.DodecahedronGeometry(1, 0), palette.iceShade, [-34, -0.5, -8], { rotation: [0, 1.9, 0], scale: [16, 7, 14] })
  // Cabin on the saddle between the two humps.
  b.add(new THREE.BoxGeometry(7, 5, 6), P.timberDark, [6, 9.6, 8])
  b.add(new THREE.ConeGeometry(5.6, 3.6, 4), palette.snow, [6, 13.9, 8], { rotation: [0, Math.PI / 4, 0] })
  b.add(new THREE.BoxGeometry(1.2, 2.4, 1.2), P.stone, [8.2, 15.2, 6.6])
  const accent = new PartBuilder().add(new THREE.BoxGeometry(2.2, 1.8, 0.4), P.light, [6, 9.4, 11.2]).build()
  return { body: b.build(), accent }
}

/** A dark volcanic berg with a snow collar and crater; the accent is its steam plume (animated separately). */
export function buildVolcanoBerg(palette: SeaPalette): MirageParts {
  const b = new PartBuilder()
  const rock = '#8c8099'
  b.add(new THREE.ConeGeometry(1, 1, 7), rock, [0, 36, 0], { scale: [62, 74, 54] })
  b.add(new THREE.ConeGeometry(1, 1, 7), palette.snow, [0, 50, 0], { rotation: [0, 0.3, 0], scale: [30, 42, 27] })
  b.add(new THREE.CylinderGeometry(1, 1.3, 1, 7), P.ink, [0, 70, 0], { scale: [9, 6, 8] })
  b.add(new THREE.DodecahedronGeometry(1, 0), palette.ice, [48, 0, 18], { rotation: [0, 1.2, 0], scale: [26, 9, 18] })
  b.add(new THREE.DodecahedronGeometry(1, 0), palette.ice, [-40, -1, -22], { rotation: [0, 0.4, 0], scale: [20, 7, 16] })
  return { body: b.build() }
}

/** Tall ice spires around a nave; the accent is the crystal tips that catch the light. */
export function buildIceCathedral(palette: SeaPalette): MirageParts {
  const b = new PartBuilder()
  b.add(new THREE.CylinderGeometry(1, 1.15, 1, 8), palette.iceShade, [0, -1, 0], { scale: [70, 10, 50] })
  b.add(new THREE.BoxGeometry(44, 30, 24), palette.ice, [0, 19, 0], { rotation: [0, 0.2, 0] })
  const spires: Array<[number, number, number, number]> = [
    [0, 0, 16, 92],
    [-22, 10, 11, 64],
    [20, -12, 12, 70],
    [-14, -18, 9, 52],
    [26, 14, 8, 48],
  ]
  for (const [x, z, r, h] of spires) {
    b.add(new THREE.ConeGeometry(1, 1, 6), palette.ice, [x, h / 2 + 2, z], { scale: [r, h, r] })
    b.add(new THREE.ConeGeometry(1, 1, 6), palette.snow, [x, h * 0.78 + 2, z], { scale: [r * 0.5, h * 0.42, r * 0.5] })
  }
  b.add(new THREE.BoxGeometry(6, 26, 30), palette.iceShade, [-26, 13, 0])
  b.add(new THREE.BoxGeometry(6, 26, 30), palette.iceShade, [26, 13, 0])
  const accent = new PartBuilder()
  for (const [x, z, r, h] of spires) accent.add(new THREE.ConeGeometry(1, 1, 6), P.crystal, [x, h + 2 + 3, z], { scale: [r * 0.32, 7, r * 0.32] })
  return { body: b.build(), accent: accent.build() }
}

/** A drifting tabular giant: a long flat-topped berg; the accent is a blue crevasse down its face. */
export function buildTabularGiant(palette: SeaPalette): MirageParts {
  const b = new PartBuilder()
  b.add(new THREE.CylinderGeometry(1, 1.06, 1, 7), palette.ice, [0, 11, 0], { scale: [78, 24, 40] })
  b.add(new THREE.CylinderGeometry(1, 1, 1, 7), palette.snow, [0, 23.4, 0], { scale: [77, 1.6, 39.5] })
  b.add(new THREE.CylinderGeometry(1, 1.1, 1, 7), palette.iceShade, [0, 2, 0], { scale: [79, 5, 41] })
  b.add(new THREE.DodecahedronGeometry(1, 0), palette.ice, [-70, 2, 22], { rotation: [0, 0.7, 0], scale: [18, 9, 14] })
  b.add(new THREE.BoxGeometry(2.2, 18, 1.6), P.crystal, [22, 13, 40.5], { rotation: [0, 0, 0.12] })
  return { body: b.build() }
}
