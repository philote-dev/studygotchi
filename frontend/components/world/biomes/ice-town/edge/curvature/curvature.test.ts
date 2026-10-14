import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { EDGE_POSES } from '../poses'
import { ICE_FREE_LOOK_BOX } from '../../camera/stations'
import { BEND, bendOffset, bendSlope, flatHorizonDepressionDeg, horizonFromPose, poseFrameDeg } from './bend'
import {
  CURVATURE_FRAGMENT_PARS,
  CURVATURE_PROJECT_VERTEX,
  CURVATURE_VERTEX_PARS,
  createCurvatureUniforms,
  injectCurvature,
  patchMaterial,
  restoreMaterial,
  shouldPatchMaterial,
  type PatchRegistry,
} from './shader'
import { buildSeaDisc, isWaterDisc, seaDiscRadii } from './sea-disc'
import { createCurvatureRig } from './rig'

const TOWN_RADIUS = Math.hypot(ICE_FREE_LOOK_BOX.max[0], 0) // 150 m: the look box reaches every coast

describe('bendOffset', () => {
  const { k, start } = BEND

  it('is zero everywhere inside the start radius, so the town never moves', () => {
    for (let d = 0; d <= start; d += 1) expect(bendOffset(d, k, start)).toBe(0)
    expect(bendOffset(start - 1e-6, k, start)).toBe(0)
    expect(start).toBeGreaterThanOrEqual(TOWN_RADIUS)
  })

  it('increases monotonically beyond the start radius', () => {
    let previous = 0
    for (let d = start; d <= 2400; d += 0.5) {
      const offset = bendOffset(d, k, start)
      expect(offset).toBeGreaterThanOrEqual(previous)
      previous = offset
    }
    expect(previous).toBeGreaterThan(0)
  })

  it('is C1-continuous at the start radius (no crease where the bend begins)', () => {
    const h = 1e-3
    const left = (bendOffset(start, k, start) - bendOffset(start - h, k, start)) / h
    const right = (bendOffset(start + h, k, start) - bendOffset(start, k, start)) / h
    expect(Math.abs(left)).toBeLessThan(1e-6)
    expect(Math.abs(right)).toBeLessThan(1e-5)
    expect(bendSlope(start, k, start)).toBe(0)
    // Slope is the analytic derivative of the offset.
    const d = start + 137
    const numeric = (bendOffset(d + h, k, start) - bendOffset(d - h, k, start)) / (2 * h)
    expect(bendSlope(d, k, start)).toBeCloseTo(numeric, 5)
  })

  it('drops the plate edge below the tangent plane and rolls the sea beyond it well under', () => {
    expect(bendOffset(170, k, start)).toBeGreaterThan(0.05) // the plate edge dips
    expect(bendOffset(170, k, start)).toBeLessThan(0.5) // but the coast line does not shear
    expect(bendOffset(240, k, start)).toBeGreaterThan(3) // plate corners (sea) already roll
    expect(bendOffset(330, k, start)).toBeGreaterThan(20) // 160 m past the edge the sea is gone
  })
})

describe('horizon from the lab poses', () => {
  const outward = EDGE_POSES.filter((pose) => pose.id.endsWith('-out'))

  it('lowers the apparent horizon by at least 5° from every outward pose, with the tangent in the bent zone', () => {
    for (const pose of outward) {
      const flat = flatHorizonDepressionDeg(pose, 640) // where the base fog saturates on a flat sea
      const bent = horizonFromPose(pose, BEND)
      expect(bent.depressionDeg - flat, pose.id).toBeGreaterThanOrEqual(5)
      expect(bent.radius, pose.id).toBeGreaterThan(BEND.start)
      // and the horizon lands inside the frame, below its top edge
      const frame = poseFrameDeg(pose)
      expect(bent.depressionDeg, pose.id).toBeGreaterThan(frame.top)
      expect(bent.depressionDeg, pose.id).toBeLessThan(frame.bottom)
    }
  })

  it('bends the far sea down from the 12° low pose', () => {
    const pose = EDGE_POSES.find((entry) => entry.id === 'low-horizon')!
    const bent = horizonFromPose(pose, BEND)
    expect(bent.depressionDeg - flatHorizonDepressionDeg(pose, 640)).toBeGreaterThanOrEqual(2.5)
  })

  it('keeps the horizon out of the overview frame, so the product pose does not change', () => {
    const pose = EDGE_POSES.find((entry) => entry.id === 'overview')!
    const bent = horizonFromPose(pose, BEND)
    expect(bent.depressionDeg).toBeLessThan(poseFrameDeg(pose).top)
  })
})

describe('shader chunks', () => {
  it('declare the live uniforms and define the bend before main()', () => {
    for (const name of ['uCurveK', 'uCurveStart', 'uCurveOrigin', 'uCurveHaze']) expect(CURVATURE_VERTEX_PARS).toContain(`uniform`)
    expect(CURVATURE_VERTEX_PARS).toMatch(/uniform float uCurveK;/)
    expect(CURVATURE_VERTEX_PARS).toMatch(/uniform float uCurveStart;/)
    expect(CURVATURE_VERTEX_PARS).toMatch(/uniform vec2 uCurveOrigin;/)
    expect(CURVATURE_VERTEX_PARS).toMatch(/uniform vec2 uCurveHaze;/)
    expect(CURVATURE_VERTEX_PARS).toMatch(/float curveBend\( float d \)/)
    expect(CURVATURE_PROJECT_VERTEX).toContain('instanceMatrix')
    expect(CURVATURE_PROJECT_VERTEX).toContain('batchingMatrix')
    expect(CURVATURE_PROJECT_VERTEX).toContain('gl_Position = projectionMatrix * mvPosition;')
    expect(CURVATURE_FRAGMENT_PARS).toContain('varying float vCurveFade;')
  })

  it('inject into the real toon program sources and keep skinning, fog and instancing hooks', () => {
    const uniforms = createCurvatureUniforms()
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.toon.vertexShader, fragmentShader: THREE.ShaderLib.toon.fragmentShader }
    expect(injectCurvature(shader, uniforms)).toBe(true)
    expect(shader.vertexShader).not.toContain('#include <project_vertex>')
    expect(shader.vertexShader).toContain('#include <skinning_vertex>')
    expect(shader.vertexShader).toContain('#include <fog_vertex>')
    expect(shader.vertexShader).toContain('uniform float uCurveK;')
    expect(shader.vertexShader.indexOf('float curveBend(')).toBeLessThan(shader.vertexShader.indexOf('void main()'))
    expect(shader.vertexShader).toContain('curveWorld.y -= curveDrop;')
    expect(shader.fragmentShader).toContain('#include <fog_fragment>')
    expect(shader.fragmentShader.indexOf('vCurveFade')).toBeGreaterThan(0)
    expect(shader.fragmentShader.indexOf('mix( gl_FragColor.rgb, fogColor, vCurveFade )')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <fog_fragment>'))
    // Uniform objects are shared by identity so one write retunes every program.
    expect(shader.uniforms).toMatchObject({ uCurveK: uniforms.k, uCurveStart: uniforms.start, uCurveOrigin: uniforms.origin, uCurveHaze: uniforms.haze })
    expect((shader.uniforms as Record<string, THREE.IUniform>).uCurveK).toBe(uniforms.k)
    for (const source of [shader.vertexShader, shader.fragmentShader]) {
      expect(source.split('{').length).toBe(source.split('}').length)
    }
  })

  it('bend the normal and depth programs (pixel-pass edges, shadow casters) without touching their fragments', () => {
    const uniforms = createCurvatureUniforms()
    for (const lib of [THREE.ShaderLib.normal, THREE.ShaderLib.depth]) {
      const shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader }
      expect(injectCurvature(shader, uniforms)).toBe(true)
      expect(shader.vertexShader).toContain('curveWorld.y -= curveDrop;')
      expect(shader.fragmentShader).toBe(lib.fragmentShader)
    }
  })

  it('leaves programs without a project_vertex hook alone', () => {
    const shader = { uniforms: {}, vertexShader: 'void main() { gl_Position = vec4(0.0); }', fragmentShader: 'void main() {}' }
    expect(injectCurvature(shader, createCurvatureUniforms())).toBe(false)
    expect(shader.vertexShader).toBe('void main() { gl_Position = vec4(0.0); }')
  })
})

describe('material patching', () => {
  it('patches every ground-attached material type and skips stars, sprites and custom shaders', () => {
    for (const material of [
      new THREE.MeshToonMaterial(),
      new THREE.MeshStandardMaterial(),
      new THREE.MeshBasicMaterial(),
      new THREE.MeshNormalMaterial(),
      new THREE.MeshDepthMaterial(),
      new THREE.LineBasicMaterial(),
    ]) {
      expect(shouldPatchMaterial(material), material.type).toBe(true)
    }
    for (const material of [new THREE.PointsMaterial(), new THREE.SpriteMaterial(), new THREE.ShaderMaterial(), new THREE.RawShaderMaterial(), new THREE.ShadowMaterial()]) {
      expect(shouldPatchMaterial(material), material.type).toBe(false)
    }
  })

  it('marks, wraps, bumps and fully restores a real material', () => {
    const uniforms = createCurvatureUniforms()
    const registry: PatchRegistry = new Map()
    const material = new THREE.MeshToonMaterial()
    const original = material.onBeforeCompile
    const keyBefore = material.customProgramCacheKey()
    const versionBefore = material.version

    expect(patchMaterial(material, uniforms, registry)).toBe(true)
    expect(material.userData.curved).toBe(true)
    expect(material.version).toBe(versionBefore + 1)
    expect(material.onBeforeCompile).not.toBe(original)
    expect(material.customProgramCacheKey()).not.toBe(keyBefore)
    expect(material.customProgramCacheKey()).toContain('ice-curvature')
    // Idempotent: a second pass neither double-wraps nor re-bumps.
    expect(patchMaterial(material, uniforms, registry)).toBe(false)
    expect(material.version).toBe(versionBefore + 1)
    expect(registry.size).toBe(1)

    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.toon.vertexShader, fragmentShader: THREE.ShaderLib.toon.fragmentShader }
    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer)
    expect(shader.vertexShader).toContain('curveWorld.y -= curveDrop;')

    expect(restoreMaterial(material, registry)).toBe(true)
    expect(material.onBeforeCompile).toBe(original)
    expect(Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(material, 'customProgramCacheKey')).toBe(false)
    expect(material.customProgramCacheKey()).toBe(keyBefore)
    expect(material.userData.curved).toBeUndefined()
    expect(material.version).toBe(versionBefore + 2)
    expect(registry.size).toBe(0)
  })

  it('chains and restores a material that already had its own onBeforeCompile', () => {
    const uniforms = createCurvatureUniforms()
    const registry: PatchRegistry = new Map()
    const material = new THREE.MeshStandardMaterial()
    const mine = vi.fn((shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.vertexShader = '// mine\n' + shader.vertexShader
    })
    material.onBeforeCompile = mine
    material.customProgramCacheKey = () => 'mine'
    patchMaterial(material, uniforms, registry)
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader }
    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer)
    expect(mine).toHaveBeenCalledTimes(1)
    expect(shader.vertexShader.startsWith('// mine')).toBe(true)
    expect(shader.vertexShader).toContain('curveWorld.y -= curveDrop;')
    expect(material.customProgramCacheKey()).toBe('mine|ice-curvature')
    restoreMaterial(material, registry)
    expect(material.onBeforeCompile).toBe(mine)
    expect(material.customProgramCacheKey()).toBe('mine')
  })
})

describe('sea disc', () => {
  it('samples the bend finely where the horizon forms and coarsens toward the rim', () => {
    const radii = seaDiscRadii()
    expect(radii[0]).toBe(0)
    expect(radii[radii.length - 1]).toBe(2400)
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeGreaterThan(radii[i - 1])
      const mid = (radii[i] + radii[i - 1]) / 2
      if (mid > BEND.start && mid < 420) {
        // chord error k·Δ²/8 stays under 2 cm where the roll is seen up close
        expect((BEND.k * (radii[i] - radii[i - 1]) ** 2) / 8).toBeLessThan(0.02)
      }
    }
    expect(radii.length).toBeLessThan(80)
  })

  it('builds a flat disc in the XY plane, like the circleGeometry it replaces', () => {
    const geometry = buildSeaDisc()
    const position = geometry.getAttribute('position') as THREE.BufferAttribute
    expect(position.count).toBeGreaterThan(1000)
    let maxR = 0
    for (let i = 0; i < position.count; i++) {
      expect(position.getZ(i)).toBe(0)
      maxR = Math.max(maxR, Math.hypot(position.getX(i), position.getY(i)))
    }
    expect(maxR).toBeCloseTo(2400, 2) // float32 positions
    expect(geometry.index).not.toBeNull()
    expect(geometry.index!.count % 3).toBe(0)
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
    expect(normal.getZ(0)).toBe(1)
    geometry.dispose()
  })

  it('recognises only the 2400 m water disc', () => {
    expect(isWaterDisc(new THREE.Mesh(new THREE.CircleGeometry(2400, 64), new THREE.MeshToonMaterial()))).toBe(true)
    expect(isWaterDisc(new THREE.Mesh(new THREE.CircleGeometry(5, 16), new THREE.MeshToonMaterial()))).toBe(false)
    expect(isWaterDisc(new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshToonMaterial()))).toBe(false)
    expect(isWaterDisc(new THREE.Group())).toBe(false)
  })
})

describe('curvature rig', () => {
  function labScene() {
    const scene = new THREE.Scene()
    const toon = new THREE.MeshToonMaterial()
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), toon)
    const pines = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 2, 6), new THREE.MeshToonMaterial(), 4)
    const walker = new THREE.SkinnedMesh(new THREE.BoxGeometry(), [new THREE.MeshStandardMaterial(), new THREE.MeshBasicMaterial()])
    const stars = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial())
    const waterGeometry = new THREE.CircleGeometry(2400, 64)
    const water = new THREE.Mesh(waterGeometry, new THREE.MeshToonMaterial())
    scene.add(ground, pines, walker, stars, water)
    return { scene, toon, ground, pines, walker, stars, water, waterGeometry }
  }

  it('patches the whole graph, swaps the water disc, catches the pixel-pass override, and reverses all of it', () => {
    const { scene, toon, pines, walker, stars, water, waterGeometry } = labScene()
    const sceneHook = scene.onBeforeRender
    const rig = createCurvatureRig()
    rig.install(scene)

    expect(toon.userData.curved).toBe(true)
    expect((pines.material as THREE.Material).userData.curved).toBe(true)
    for (const material of walker.material as THREE.Material[]) expect(material.userData.curved).toBe(true)
    expect((stars.material as THREE.Material).userData.curved).toBeUndefined()
    expect(water.geometry).not.toBe(waterGeometry)
    expect((water.geometry.getAttribute('position') as THREE.BufferAttribute).count).toBeGreaterThan(1000)
    expect(scene.onBeforeRender).not.toBe(sceneHook)

    // The pixel pass sets scene.overrideMaterial to its private MeshNormalMaterial during render.
    const normal = new THREE.MeshNormalMaterial()
    scene.overrideMaterial = normal
    // WebGLRenderer.render calls the scene hook with (renderer, scene, camera, renderTarget).
    ;(scene.onBeforeRender as unknown as (...args: unknown[]) => void)(null, scene, new THREE.PerspectiveCamera(), null)
    scene.overrideMaterial = null
    expect(normal.userData.curved).toBe(true)

    // Objects added later are picked up by the periodic sweep.
    const late = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshToonMaterial())
    scene.add(late)
    rig.sweep(scene)
    expect((late.material as THREE.Material).userData.curved).toBe(true)
    expect(rig.patchedCount()).toBe(7)

    rig.uninstall(scene)
    for (const material of [toon, pines.material as THREE.Material, ...(walker.material as THREE.Material[]), normal, late.material as THREE.Material]) {
      expect(material.userData.curved).toBeUndefined()
      expect(Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile')).toBe(false)
    }
    expect(water.geometry).toBe(waterGeometry)
    expect(scene.onBeforeRender).toBe(sceneHook)
    expect(rig.patchedCount()).toBe(0)
  })

  it('ramps the bend in over half a second, or instantly under reduced motion', () => {
    const rig = createCurvatureRig()
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()
    rig.install(scene)
    expect(rig.uniforms.k.value).toBe(0)
    rig.tick(camera, 0.25, false)
    expect(rig.uniforms.k.value).toBeGreaterThan(0)
    expect(rig.uniforms.k.value).toBeLessThan(BEND.k)
    rig.tick(camera, 0.4, false)
    expect(rig.uniforms.k.value).toBeCloseTo(BEND.k, 9)
    rig.uninstall(scene)

    const instant = createCurvatureRig()
    instant.install(scene)
    instant.tick(camera, 0.001, true)
    expect(instant.uniforms.k.value).toBeCloseTo(BEND.k, 9)
    instant.uninstall(scene)
  })

  it('anchors the bend on the land by default and can follow the camera for comparison', () => {
    const rig = createCurvatureRig()
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(120, 40, -80)
    camera.updateMatrixWorld()
    rig.install(scene)
    rig.tick(camera, 1, true)
    expect(rig.uniforms.origin.value.x).toBe(0)
    expect(rig.uniforms.origin.value.y).toBe(0)
    rig.tune({ follow: 'camera' })
    rig.tick(camera, 1, true)
    expect(rig.uniforms.origin.value.x).toBe(120)
    expect(rig.uniforms.origin.value.y).toBe(-80)
    rig.tune({ k: 0.002, start: 200, follow: 'land' })
    rig.tick(camera, 1, true)
    expect(rig.uniforms.k.value).toBe(0.002)
    expect(rig.uniforms.start.value).toBe(200)
    expect(rig.uniforms.origin.value.x).toBe(0)
    rig.uninstall(scene)
  })
})
