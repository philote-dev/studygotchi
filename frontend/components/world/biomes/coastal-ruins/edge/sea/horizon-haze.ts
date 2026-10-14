import * as THREE from 'three'
import { MOON_DIR, SEA_HORIZON } from './sea-horizon'

/**
 * Horizon haze: a replacement for three's linear fog chunk on the outer world's materials.
 *
 * Up to `near` view depth it is exactly the scene fog (so nothing the land's own camera poses see
 * changes). Beyond, the fog colour slides toward the horizon haze colour and, for the water
 * (`lift` 1), the factor accelerates to 1 so the sea is fully haze-coloured where it meets the
 * haze wall. Land rings and far islands use a smaller lift so they keep a soft silhouette inside
 * the haze. The water also carries the moon path at night.
 *
 * The haze colour is mixed in the same place and space as three's fog colour (after tone mapping
 * when drawing to the screen, in the working space when drawing to the pixel pass's target), so a
 * fully hazed pixel matches the haze wall and the fog matches the background exactly.
 */
export interface HazeUniforms {
  color: { value: THREE.Color }
  moonColor: { value: THREE.Color }
  near: { value: number }
  far: { value: number }
  time: { value: number }
  moon: { value: number }
  moonDir: { value: THREE.Vector2 }
  /** Linear-space sources the per-draw conversion reads from. */
  hazeLinear: THREE.Color
  moonLinear: THREE.Color
}

/** `scale` converts the metre constants into the units the geometry is drawn in (render units). */
export function createHazeUniforms(scale: number): HazeUniforms {
  return {
    color: { value: new THREE.Color() },
    moonColor: { value: new THREE.Color() },
    near: { value: SEA_HORIZON.hazeNear * scale },
    far: { value: SEA_HORIZON.hazeFar * scale },
    time: { value: 0 },
    moon: { value: 0 },
    moonDir: { value: new THREE.Vector2(MOON_DIR[0], MOON_DIR[1]) },
    hazeLinear: new THREE.Color(),
    moonLinear: new THREE.Color(),
  }
}

const VERTEX_DECL = /* glsl */ `
varying vec3 vSeaWorld;
`

const VERTEX_WORLD = /* glsl */ `
#include <project_vertex>
{
  vec4 seaWorld = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    seaWorld = instanceMatrix * seaWorld;
  #endif
  vSeaWorld = ( modelMatrix * seaWorld ).xyz;
}
`

const FRAGMENT_DECL = /* glsl */ `
uniform vec3 uHazeColor;
uniform vec3 uMoonColor;
uniform float uHazeNear;
uniform float uHazeFar;
uniform float uHazeLift;
uniform float uSea;
uniform float uTime;
uniform float uMoon;
uniform vec2 uMoonDir;
uniform float uUnit;
varying vec3 vSeaWorld;
float seaHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float seaNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( seaHash( i ), seaHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( seaHash( i + vec2( 0.0, 1.0 ) ), seaHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
`

const FRAGMENT_HAZE = /* glsl */ `
#ifdef USE_FOG
  float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  float hazeW = smoothstep( uHazeNear, uHazeFar, vFogDepth );
  vec3 hazeCol = mix( fogColor, uHazeColor, hazeW );
  float hazeF = mix( fogFactor, 1.0, hazeW * uHazeLift );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, hazeCol, hazeF );
  if ( uSea > 0.5 && uMoon > 0.001 ) {
    // Moon path: a shimmering stripe on the water from the viewer toward the moon's bearing (a
    // reflection always lies between the eye and the light, so it is camera-relative). Metres.
    vec2 rel = ( vSeaWorld.xz - cameraPosition.xz ) / uUnit;
    float along = dot( rel, uMoonDir );
    float perp = dot( rel, vec2( -uMoonDir.y, uMoonDir.x ) );
    float width = 12.0 + max( along, 0.0 ) * 0.04;
    float path = exp( -perp * perp / ( width * width ) ) * smoothstep( 90.0, 320.0, along ) * ( 1.0 - smoothstep( 1300.0, 2100.0, along ) );
    float shimmer = 0.45 + 0.55 * seaNoise( vec2( along * 0.06 - uTime * 0.7, perp * 0.14 + uTime * 0.1 ) );
    gl_FragColor.rgb += uMoonColor * path * shimmer * uMoon * 0.5 * ( 1.0 - hazeF * 0.7 );
  }
#endif
`

/**
 * Install the haze on a built-in material (meant for MeshToonMaterial). `sea` enables the moon
 * path; `unit` is metres per world unit the geometry is drawn in (1 / renderScale).
 */
export function patchHaze(material: THREE.Material, shared: HazeUniforms, lift: number, sea: boolean, unit: number): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHazeColor = shared.color
    shader.uniforms.uMoonColor = shared.moonColor
    shader.uniforms.uHazeNear = shared.near
    shader.uniforms.uHazeFar = shared.far
    shader.uniforms.uTime = shared.time
    shader.uniforms.uMoon = shared.moon
    shader.uniforms.uMoonDir = shared.moonDir
    shader.uniforms.uHazeLift = { value: lift }
    shader.uniforms.uSea = { value: sea ? 1 : 0 }
    shader.uniforms.uUnit = { value: 1 / unit }
    shader.vertexShader = VERTEX_DECL + shader.vertexShader.replace('#include <project_vertex>', VERTEX_WORLD)
    shader.fragmentShader = FRAGMENT_DECL + shader.fragmentShader.replace('#include <fog_fragment>', FRAGMENT_HAZE)
  }
  // Same injected source for every patched material: share one program per material variant.
  material.customProgramCacheKey = () => 'coastal-horizon-haze'
  material.needsUpdate = true
}

/**
 * Convert the haze colours into the space three mixes fog in for this draw. Must be bound on every
 * renderable that uses a patched material (the render target is only known at draw time).
 */
export function bindHazeSpace(object: THREE.Object3D, shared: HazeUniforms): void {
  object.onBeforeRender = (renderer) => {
    const space = renderer.getRenderTarget() === null ? renderer.outputColorSpace : THREE.ColorManagement.workingColorSpace
    shared.hazeLinear.getRGB(shared.color.value, space)
    shared.moonLinear.getRGB(shared.moonColor.value, space)
  }
}
