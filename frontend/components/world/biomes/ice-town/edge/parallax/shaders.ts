/**
 * GLSL for the painted horizon. Both materials are unlit (matte paintings are not lit by the
 * scene), opaque, and end with three's tone-mapping and colour-space chunks so they go through
 * the same output pipeline as the toon surfaces and the fog they must match.
 */

/**
 * Ring strip: two baked colour sets (day / night) crossfaded by `uNight`, then hazed toward the
 * scene's fog colour by the real camera distance. The foot of every column also takes the scene's
 * own linear fog (smoothstep of view depth, exactly as three does) so where the strip meets the
 * fogged sea the two are the same colour; `uClear` lifts the peaks out of that ground haze
 * (0 in a storm, so the blizzard swallows the beyond like it swallows the sea).
 */
export const RING_VERTEX = /* glsl */ `
  attribute vec3 colorDay;
  attribute vec3 colorNight;
  varying vec3 vDay;
  varying vec3 vNight;
  varying vec3 vWorld;
  varying float vViewDepth;
  void main() {
    vDay = colorDay;
    vNight = colorNight;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 view = viewMatrix * world;
    vViewDepth = -view.z;
    gl_Position = projectionMatrix * view;
  }
`

export const RING_FRAGMENT = /* glsl */ `
  uniform vec3 uHaze;
  uniform float uNight;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uLambda;
  uniform float uBaseFade;
  uniform float uClear;
  uniform float uNightHaze;
  varying vec3 vDay;
  varying vec3 vNight;
  varying vec3 vWorld;
  varying float vViewDepth;
  void main() {
    vec3 local = mix(vDay, vNight, uNight);
    float d = distance(cameraPosition, vWorld);
    float air = (1.0 - exp(-d / uLambda)) * mix(1.0, uNightHaze, uNight);
    float fog = smoothstep(uFogNear, uFogFar, vViewDepth);
    float lift = smoothstep(0.0, uBaseFade, vWorld.y) * uClear;
    float k = max(air, fog * (1.0 - lift));
    gl_FragColor = vec4(mix(local, uHaze, k), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/**
 * Sky dome: the fog / background colour at the waterline climbing to a zenith colour with height
 * (a painted cylinder, so the gradient reads the same from every camera height), and at night
 * three slow aurora curtains over the north. `uTime` stays 0 under reduced motion.
 */
export const DOME_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

export const DOME_FRAGMENT = /* glsl */ `
  uniform vec3 uHaze;
  uniform vec3 uZenithDay;
  uniform vec3 uZenithNight;
  uniform vec3 uAuroraA;
  uniform vec3 uAuroraB;
  uniform float uNight;
  uniform float uGlow;
  uniform float uTime;
  uniform float uAurora;
  varying vec3 vWorld;

  float curtain(float az, float y, float centre, float width, float phase) {
    float d = az - centre;
    d = atan(sin(d), cos(d));
    float band = exp(-d * d / (width * width));
    float ripple = 0.55 + 0.45 * sin(az * 9.0 + y * 0.012 + phase);
    float vert = smoothstep(30.0, 150.0, y) * (1.0 - smoothstep(280.0, 560.0, y));
    return band * ripple * vert;
  }

  void main() {
    vec3 zenith = mix(uZenithDay, uZenithNight, uNight);
    float y = max(vWorld.y, 0.0);
    float t = 1.0 - exp(-y / uGlow);
    vec3 c = mix(uHaze, zenith, t);
    if (uNight > 0.001) {
      float az = atan(vWorld.x, vWorld.z);
      // Curtains stay over the north (azimuth π) and sway a few degrees either way.
      float sway = 0.18 * sin(uTime * 0.05);
      float a = curtain(az, y, 3.05 + sway, 0.45, uTime * 0.2)
        + curtain(az, y, 3.65 - sway * 0.7, 0.3, 1.7 + uTime * 0.15)
        + 0.6 * curtain(az, y, 2.5 + sway * 0.5, 0.25, 3.1 - uTime * 0.1);
      vec3 glow = mix(uAuroraA, uAuroraB, 0.5 + 0.5 * sin(y * 0.01 + az * 2.0));
      c += glow * a * uAurora * uNight;
    }
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`
