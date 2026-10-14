import * as THREE from 'three'
import { BEND } from './bend'

/**
 * The bend as a shader patch for three's built-in materials. Injected through
 * `material.onBeforeCompile`, so the same code bends MeshToon, MeshStandard, MeshBasic, the
 * pixel pass's MeshNormalMaterial override and the shadow MeshDepthMaterial, and it keeps the
 * `instanceMatrix`, `batchingMatrix` and skinning paths exactly as `project_vertex` has them.
 *
 * The drop is applied in world space (not view space) so the beauty pass, the normal/depth
 * pass and any shadow camera all see the same rolled world and their edges line up.
 */

export interface CurvatureUniforms {
  k: THREE.IUniform<number>
  start: THREE.IUniform<number>
  origin: THREE.IUniform<THREE.Vector2>
  /** x: metres beyond the start before the horizon haze may begin; y: grazing sine where the haze is off. */
  haze: THREE.IUniform<THREE.Vector2>
}

/** Haze gate 40 m past the start; the haze ramps in as the ray grazes the rolled sea under 9°. */
export const HAZE_DEFAULT: [number, number] = [40, Math.sin((9 * Math.PI) / 180)]

export function createCurvatureUniforms(): CurvatureUniforms {
  return {
    k: { value: BEND.k },
    start: { value: BEND.start },
    origin: { value: new THREE.Vector2(0, 0) },
    haze: { value: new THREE.Vector2(...HAZE_DEFAULT) },
  }
}

export const CURVATURE_VERTEX_PARS = /* glsl */ `
uniform float uCurveK;
uniform float uCurveStart;
uniform vec2 uCurveOrigin;
uniform vec2 uCurveHaze;
varying float vCurveFade;

float curveBend( float d ) {
	float t = max( 0.0, d - uCurveStart );
	return uCurveK * t * t;
}
`

/** Replaces `#include <project_vertex>`: same matrices and order as three's chunk, plus the roll. */
export const CURVATURE_PROJECT_VERTEX = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );

#ifdef USE_BATCHING

	mvPosition = batchingMatrix * mvPosition;

#endif

#ifdef USE_INSTANCING

	mvPosition = instanceMatrix * mvPosition;

#endif

vec4 curveWorld = modelMatrix * mvPosition;
vec2 curveRadial = curveWorld.xz - uCurveOrigin;
float curveD = length( curveRadial );
float curveT = max( 0.0, curveD - uCurveStart );
float curveDrop = uCurveK * curveT * curveT;
curveWorld.y -= curveDrop;

// Horizon haze: where the ray to the camera grazes the rolled ground (the apparent horizon),
// the surface fades to the fog colour, so the sea curls into the sky instead of cutting it.
// The ground falls away outward, so its normal leans outward (a dome's normal), radial +.
vec2 curveDir = curveRadial / max( curveD, 1e-4 );
float curveSlope = 2.0 * uCurveK * curveT;
vec3 curveNormal = normalize( vec3( curveSlope * curveDir.x, 1.0, curveSlope * curveDir.y ) );
vec3 curveToCamera = normalize( cameraPosition - curveWorld.xyz );
float curveGraze = abs( dot( curveToCamera, curveNormal ) );
vCurveFade = ( 1.0 - smoothstep( 0.0, uCurveHaze.y, curveGraze ) ) * smoothstep( 0.0, uCurveHaze.x, curveT );

mvPosition = viewMatrix * curveWorld;

gl_Position = projectionMatrix * mvPosition;
`

/** Appended after `#include <worldpos_vertex>` so shadow and env lookups use the rolled position. */
export const CURVATURE_WORLDPOS_VERTEX = /* glsl */ `
#include <worldpos_vertex>
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0

	worldPosition.y -= curveBend( length( worldPosition.xz - uCurveOrigin ) );

#endif
`

export const CURVATURE_FRAGMENT_PARS = /* glsl */ `
varying float vCurveFade;
`

/** After three's own fog: the haze reuses `fogColor`, which SkyBlend keeps equal to the sky. */
export const CURVATURE_FOG_FRAGMENT = /* glsl */ `
#include <fog_fragment>
#ifdef USE_FOG

	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, vCurveFade );

#endif
`

function withPars(source: string, pars: string): string {
  return source.includes('#include <common>') ? source.replace('#include <common>', `#include <common>\n${pars}`) : `${pars}\n${source}`
}

export interface ShaderSources {
  uniforms: Record<string, THREE.IUniform>
  vertexShader: string
  fragmentShader: string
}

/** Patch one compiled-program source set. Returns false (and leaves it alone) without a project_vertex hook. */
export function injectCurvature(shader: ShaderSources, uniforms: CurvatureUniforms): boolean {
  if (!shader.vertexShader.includes('#include <project_vertex>')) return false
  shader.uniforms.uCurveK = uniforms.k
  shader.uniforms.uCurveStart = uniforms.start
  shader.uniforms.uCurveOrigin = uniforms.origin
  shader.uniforms.uCurveHaze = uniforms.haze
  shader.vertexShader = withPars(shader.vertexShader, CURVATURE_VERTEX_PARS)
    .replace('#include <project_vertex>', CURVATURE_PROJECT_VERTEX)
    .replace('#include <worldpos_vertex>', CURVATURE_WORLDPOS_VERTEX)
  if (shader.fragmentShader.includes('#include <fog_fragment>')) {
    shader.fragmentShader = withPars(shader.fragmentShader, CURVATURE_FRAGMENT_PARS).replace('#include <fog_fragment>', CURVATURE_FOG_FRAGMENT)
  }
  return true
}

type MaterialFlags = THREE.Material & {
  isShaderMaterial?: boolean
  isPointsMaterial?: boolean
  isSpriteMaterial?: boolean
  isShadowMaterial?: boolean
}

/**
 * Everything attached to the ground bends. Points (the 600 m star dome, snowfall) and sprites
 * are not ground; custom ShaderMaterials own their vertex stage.
 */
export function shouldPatchMaterial(material: THREE.Material): boolean {
  const flags = material as MaterialFlags
  return !(flags.isShaderMaterial || flags.isPointsMaterial || flags.isSpriteMaterial || flags.isShadowMaterial)
}

interface Saved {
  onBeforeCompile: PropertyDescriptor | undefined
  customProgramCacheKey: PropertyDescriptor | undefined
}

export type PatchRegistry = Map<THREE.Material, Saved>

export function patchMaterial(material: THREE.Material, uniforms: CurvatureUniforms, registry: PatchRegistry): boolean {
  if (registry.has(material) || !shouldPatchMaterial(material)) return false
  registry.set(material, {
    onBeforeCompile: Object.getOwnPropertyDescriptor(material, 'onBeforeCompile'),
    customProgramCacheKey: Object.getOwnPropertyDescriptor(material, 'customProgramCacheKey'),
  })
  const previousCompile = material.onBeforeCompile
  const previousKey = material.customProgramCacheKey()
  material.onBeforeCompile = function curvedOnBeforeCompile(this: THREE.Material, shader, renderer) {
    previousCompile.call(this, shader, renderer)
    injectCurvature(shader, uniforms)
  }
  material.customProgramCacheKey = () => `${previousKey}|ice-curvature`
  material.userData.curved = true
  material.needsUpdate = true
  return true
}

function restoreProperty(material: THREE.Material, name: 'onBeforeCompile' | 'customProgramCacheKey', descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(material, name, descriptor)
  else delete (material as unknown as Record<string, unknown>)[name]
}

export function restoreMaterial(material: THREE.Material, registry: PatchRegistry): boolean {
  const saved = registry.get(material)
  if (!saved) return false
  registry.delete(material)
  restoreProperty(material, 'onBeforeCompile', saved.onBeforeCompile)
  restoreProperty(material, 'customProgramCacheKey', saved.customProgramCacheKey)
  delete material.userData.curved
  material.needsUpdate = true
  return true
}
