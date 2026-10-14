/**
 * Course blobs: one `gl.POINTS` draw for every course's concept stars and one
 * `gl.LINES` draw for the few backbone threads (the clusters lab's version C,
 * now the galaxy rung's cluster rendering). Per-course state (centre, tumble
 * axis + speed, radius, condense, colour, crossfade) lives in uniform arrays
 * indexed by the `aCourse` attribute, so the clock, the hop's condense and a
 * stand-in -> real layout swap never rebuild a buffer: they are vertex math.
 *
 * Pixel rules, the galaxy's own: the point centre is snapped to its cell
 * (`snapClip`), a star is one cell (or a three-cell plus for a heavy concept
 * on the near side), colours are quantised to three steps between the course
 * colour at the core and star-white at the rim, and depth dims in two steps
 * (one for the far third, half a step for the middle), so the blob reads as a
 * ball at 1 cell per star without any smooth gradient.
 *
 * `aGen` / `uSwap`: a course whose graph is being replaced carries both sets
 * of stars; the outgoing set (`aGen` 0) fades with `1 - uSwap[i]`, the new one
 * (`aGen` 1) with `uSwap[i]`, ramped 0 -> 1 over `BLOB_SWAP_MS` by the renderer.
 */
import { MAX_BLOB_COURSES } from "@/lib/galaxy/blobs";
import { GLSL_SNAP } from "../../lib/uniforms";

const N = MAX_BLOB_COURSES;

const BLOB_COMMON = /* glsl */ `
uniform float uTime;
uniform vec2 uRes;
uniform float uFade;
uniform float uMotion;
uniform vec3 uCentre[${N}];
uniform vec4 uAxis[${N}];
uniform float uRadius[${N}];
uniform float uCondense[${N}];
uniform float uSwap[${N}];
attribute float aCourse;
${GLSL_SNAP}
// Rodrigues: rotate p about the unit axis ax by ang.
vec3 rotateAxis(vec3 p, vec3 ax, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  return p * c + cross(ax, p) * s + ax * dot(ax, p) * (1.0 - c);
}
`;

export const BLOB_POINT_VERT = /* glsl */ `
${BLOB_COMMON}
uniform float uCells;
uniform float uCellPx;
uniform float uDepthDim;
uniform vec3 uColor[${N}];
uniform vec3 uStar;
attribute vec3 aLocal;
attribute float aWeight;
attribute float aAlpha;
attribute float aRadius;
attribute float aGen;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
void main() {
  int i = int(aCourse + 0.5);
  vec3 centre = uCentre[i];
  vec4 ax = uAxis[i];
  float keep = 1.0 - uCondense[i];
  vec3 local = rotateAxis(aLocal, ax.xyz, ax.w * uTime * uMotion) * keep;
  vec4 cmv = modelViewMatrix * vec4(centre, 1.0);
  vec4 mv = modelViewMatrix * vec4(centre + local, 1.0);
  // Depth inside the blob, in blob radii: positive toward the camera (view z grows toward it).
  float Rv = length(mat3(modelViewMatrix) * vec3(uRadius[i], 0.0, 0.0));
  float depth = clamp((mv.z - cmv.z) / max(Rv, 1e-5), -1.0, 1.0);
  // A blob behind the disc plane (its foot on the plane is nearer than it): one more step down.
  vec4 foot = modelViewMatrix * vec4(centre.x, 0.0, centre.z, 1.0);
  float behind = step(1e-4, foot.z - cmv.z);
  gl_Position = snapClip(projectionMatrix * mv, uRes);
  float dim = depth < -0.33 ? 1.0 - uDepthDim : (depth < 0.33 ? 1.0 - 0.5 * uDepthDim : 1.0);
  dim *= 1.0 - 0.3 * behind;
  // Heavy concepts on the near side of the core are a three-cell plus; everything else one cell (the rim stays
  // single cells so it thins out instead of sparkling).
  float plus = step(0.5, aWeight) * step(0.1, depth) * step(aRadius, 0.55);
  vShape = plus;
  gl_PointSize = uCells * (1.0 + 2.0 * plus) * uCellPx;
  // Core takes the course colour, rim goes star-white, in three steps.
  float t = smoothstep(0.25, 0.95, aRadius);
  t = floor(t * 3.0 + 0.5) / 3.0;
  vColor = mix(uColor[i], uStar, t);
  // Crossfade: the outgoing graph (aGen 0) goes out as the new one (aGen 1) comes in.
  float swap = uSwap[i];
  float gen = mix(1.0 - swap, swap, step(0.5, aGen));
  vAlpha = aAlpha * dim * keep * uFade * gen;
}
`;

export const BLOB_POINT_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
void main() {
  if (vAlpha <= 0.002) discard;
  float a = vAlpha;
  if (vShape > 0.5) {
    vec2 q = floor(gl_PointCoord * 3.0);
    bool centre = q.x == 1.0 && q.y == 1.0;
    if (q.x != 1.0 && q.y != 1.0) discard;
    if (!centre) a *= 0.45;
  }
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}
`;

export const BLOB_THREAD_VERT = /* glsl */ `
${BLOB_COMMON}
attribute vec3 aLocal;
varying float vAlpha;
void main() {
  int i = int(aCourse + 0.5);
  vec4 ax = uAxis[i];
  float keep = 1.0 - uCondense[i];
  vec3 local = rotateAxis(aLocal, ax.xyz, ax.w * uTime * uMotion) * keep;
  vec4 mv = modelViewMatrix * vec4(uCentre[i] + local, 1.0);
  gl_Position = snapClip(projectionMatrix * mv, uRes);
  vAlpha = keep * uFade * uSwap[i];
}
`;

export const BLOB_THREAD_FRAG = /* glsl */ `
uniform vec3 uThread;
uniform float uThreadAlpha;
varying float vAlpha;
void main() {
  float a = vAlpha * uThreadAlpha;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(uThread, a);
  #include <colorspace_fragment>
}
`;
