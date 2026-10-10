import * as THREE from 'three'

let ramp: THREE.DataTexture | null = null

export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp
  const texture = new THREE.DataTexture(new Uint8Array([118, 200, 255]), 3, 1, THREE.RedFormat)
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  ramp = texture
  return texture
}

/**
 * One MeshToonMaterial per distinct (colour, emissive, intensity, transparency, side) tuple,
 * shared by every mesh that asks for it. Seventeen bouquets on the planet used to carry ~1,200
 * materials; the cache collapses that to a few dozen so three.js can skip per-mesh uniform
 * uploads. Materials are never mutated after creation and never disposed by a single mesh.
 */
const MATERIALS = new Map<string, THREE.MeshToonMaterial>()

export function toonMaterial(options: {
  color: string
  emissive?: string
  emissiveIntensity?: number
  transparent?: boolean
  opacity?: number
  side?: THREE.Side
}): THREE.MeshToonMaterial {
  const { color, emissive = '#000000', emissiveIntensity = 0, transparent = false, opacity = 1, side = THREE.FrontSide } = options
  const key = `${color}|${emissive}|${emissiveIntensity}|${transparent ? 1 : 0}|${opacity}|${side}`
  let material = MATERIALS.get(key)
  if (!material) {
    material = new THREE.MeshToonMaterial({
      color,
      gradientMap: toonRamp(),
      emissive,
      emissiveIntensity,
      transparent,
      opacity,
      side,
    })
    MATERIALS.set(key, material)
  }
  return material
}

/** Number of distinct cached materials; exposed for perf diagnostics and tests. */
export function toonMaterialCount(): number {
  return MATERIALS.size
}

export function Surf({
  color,
  emissive = '#000000',
  emissiveIntensity = 0,
  transparent = false,
  opacity = 1,
  side = THREE.FrontSide,
}: {
  color: string
  emissive?: string
  emissiveIntensity?: number
  transparent?: boolean
  opacity?: number
  side?: THREE.Side
}) {
  const material = toonMaterial({ color, emissive, emissiveIntensity, transparent, opacity, side })
  // dispose={null}: the material is shared, so an unmounting mesh must not dispose it.
  return <primitive attach="material" object={material} dispose={null} />
}

/**
 * An emissive surface that only glows when `on` (night). By day it shows `offColor`: the muted
 * window grey by default, or the material's own hue for things that are coloured by day and lit
 * by night (lava, cyan light strips, paper lanterns).
 */
export function Glow({
  color,
  on,
  intensity = 1.6,
  offColor = '#aaa4b4',
}: {
  color: string
  on: boolean
  intensity?: number
  offColor?: string
}) {
  return <Surf color={on ? color : offColor} emissive={on ? color : '#000000'} emissiveIntensity={on ? intensity : 0} />
}
