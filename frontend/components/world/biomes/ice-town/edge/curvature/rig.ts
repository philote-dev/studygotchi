import * as THREE from 'three'
import { BEND } from './bend'
import { buildSeaDisc, isWaterDisc } from './sea-disc'
import { createCurvatureUniforms, patchMaterial, restoreMaterial, type CurvatureUniforms, type PatchRegistry } from './shader'

/** How long the bend takes to settle in when the technique mounts (game-feel: ease-out, never snap). */
export const SETTLE_SECONDS = 0.5

export interface CurvatureTuning {
  k: number
  start: number
  /** `land`: the bend is a fixed planet around the land centre. `camera`: it follows the camera's xz (the Subway Surfers variant). */
  follow: 'land' | 'camera'
  /** [gate metres past the start, grazing sine where the haze ends]. */
  haze: [number, number]
}

export interface CurvatureRig {
  uniforms: CurvatureUniforms
  /** Hook the scene: first sweep, the override-material trap, the water disc swap. */
  install(scene: THREE.Scene): void
  /** Restore every material, geometry and hook exactly as found. */
  uninstall(scene: THREE.Scene): void
  /** Patch any material (and water disc) that has appeared since the last pass. */
  sweep(scene: THREE.Scene): void
  /** Per frame: settle-in ramp and the camera-follow origin. */
  tick(camera: THREE.Camera, delta: number, reducedMotion: boolean): void
  tune(next: Partial<CurvatureTuning>): CurvatureTuning
  tuning(): CurvatureTuning
  patchedCount(): number
}

/**
 * WebGLRenderer.render calls `scene.onBeforeRender(renderer, scene, camera, renderTarget)`; the
 * typings only describe the per-object six-argument form, so the hook is typed by hand.
 */
type SceneHook = (this: THREE.Scene, renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, ...rest: unknown[]) => void
type HookedScene = THREE.Scene & { onBeforeRender: SceneHook }

function easeOutCubic(t: number): number {
  const u = Math.min(1, Math.max(0, t))
  return 1 - Math.pow(1 - u, 3)
}

function forEachMaterial(object: THREE.Object3D, visit: (material: THREE.Material) => void) {
  const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
  if (!material) return
  if (Array.isArray(material)) material.forEach(visit)
  else visit(material)
}

export function createCurvatureRig(): CurvatureRig {
  const uniforms = createCurvatureUniforms()
  const registry: PatchRegistry = new Map()
  const swappedWater = new Map<THREE.Mesh, THREE.BufferGeometry>()
  const tuning: CurvatureTuning = { k: BEND.k, start: BEND.start, follow: 'land', haze: [uniforms.haze.value.x, uniforms.haze.value.y] }
  let seaDisc: THREE.BufferGeometry | null = null
  let settle = 0
  let hookedScene: THREE.Scene | null = null
  let previousHook: SceneHook | null = null
  let hadOwnHook = false

  const patch = (material: THREE.Material) => {
    patchMaterial(material, uniforms, registry)
  }

  const sweep = (scene: THREE.Scene) => {
    scene.traverse((object) => {
      forEachMaterial(object, patch)
      if (isWaterDisc(object) && !swappedWater.has(object)) {
        seaDisc ??= buildSeaDisc()
        swappedWater.set(object, object.geometry)
        object.geometry = seaDisc
      }
    })
    if (scene.overrideMaterial) patch(scene.overrideMaterial)
  }

  const onBeforeRender: SceneHook = function curvedSceneHook(renderer, scene, camera, ...rest) {
    previousHook?.call(this, renderer, scene, camera, ...rest)
    // RenderPixelatedPass swaps in its private MeshNormalMaterial for the edge pass; bend it too.
    if (scene.overrideMaterial) patch(scene.overrideMaterial)
  }

  const install = (scene: THREE.Scene) => {
    settle = 0
    uniforms.k.value = 0
    hookedScene = scene
    hadOwnHook = Object.prototype.hasOwnProperty.call(scene, 'onBeforeRender')
    previousHook = (scene as HookedScene).onBeforeRender
    ;(scene as HookedScene).onBeforeRender = onBeforeRender
    sweep(scene)
  }

  const uninstall = (scene: THREE.Scene) => {
    for (const material of [...registry.keys()]) restoreMaterial(material, registry)
    for (const [mesh, geometry] of swappedWater) if (mesh.geometry === seaDisc) mesh.geometry = geometry
    swappedWater.clear()
    seaDisc?.dispose()
    seaDisc = null
    const target = (hookedScene ?? scene) as HookedScene
    if (target.onBeforeRender === onBeforeRender) {
      if (hadOwnHook && previousHook) target.onBeforeRender = previousHook
      else delete (target as Partial<HookedScene>).onBeforeRender
    }
    hookedScene = null
    previousHook = null
  }

  const applyTuning = () => {
    uniforms.start.value = tuning.start
    uniforms.haze.value.set(tuning.haze[0], tuning.haze[1])
    if (settle >= 1) uniforms.k.value = tuning.k
  }

  const tick = (camera: THREE.Camera, delta: number, reducedMotion: boolean) => {
    if (settle < 1) {
      settle = reducedMotion ? 1 : Math.min(1, settle + Math.max(0, delta) / SETTLE_SECONDS)
      uniforms.k.value = tuning.k * easeOutCubic(settle)
    }
    if (tuning.follow === 'camera') uniforms.origin.value.set(camera.position.x, camera.position.z)
    else uniforms.origin.value.set(0, 0)
  }

  return {
    uniforms,
    install,
    uninstall,
    sweep,
    tick,
    tune(next) {
      Object.assign(tuning, next)
      applyTuning()
      return { ...tuning }
    },
    tuning: () => ({ ...tuning, haze: [...tuning.haze] as [number, number] }),
    patchedCount: () => registry.size,
  }
}
