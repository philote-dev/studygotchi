import { GLSL_SNAP, GLSL_THEME_TONE } from "../lib/uniforms";

/**
 * Grain stars: 1-cell or 3-cell (plus) points, snapped to the low-res grid,
 * two-step twinkle on the big ones. `uRes` is whichever target the points are
 * drawn into (the sky pass, or the wormhole's inner-sky target).
 */
export const STAR_VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uRes;
uniform float uLight;
uniform float uFade;
attribute float size;
attribute float phase;
attribute float shape;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
${GLSL_SNAP}
${GLSL_THEME_TONE}
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = snapClip(clip, uRes);
  gl_PointSize = size;
  float tw = step(0.5, fract(uTime / (3.0 + 4.0 * phase) + phase * 3.0));
  float twinkle = size > 1.5 ? mix(0.6, 1.0, tw) : 1.0;
  vColor = themeTone(color, uLight) * twinkle;
  vAlpha = uFade;
  vShape = shape;
}
`;

export const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
void main() {
  vec3 c = vColor;
  float a = vAlpha;
  if (vShape > 0.5) {
    // 3x3 plus: centre bright, arms soft, corners empty.
    vec2 q = floor(gl_PointCoord * 3.0);
    bool centre = q.x == 1.0 && q.y == 1.0;
    if (q.x != 1.0 && q.y != 1.0) discard;
    if (!centre) a *= 0.45;
  }
  if (a <= 0.002) discard;
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}
`;
