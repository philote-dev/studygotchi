/**
 * Shaders of the constellation twin. Everything is drawn full resolution over a
 * transparent clear and written PREMULTIPLIED (the canvas composites over the
 * page with premultiplied "over", like the 2D canvas did), in sRGB values as
 * the palette states them, with no colour-space conversion: Canvas2D blends in
 * sRGB, so the twin does too.
 *
 * Geometry convention: world positions in the buffers, every radius / width in
 * CSS px. `uK` is the 2D zoom (px per world unit), so a px offset becomes a
 * world offset by dividing by `uK`; the orthographic camera from
 * `lib/graph/twin/camera.ts` does the rest.
 *
 * Anti-aliasing: the 1-D "box filter" coverage of a pixel centred `d` px from
 * a stroke centre of half width `h` (`overlap of [d−½, d+½] with [−h, h]`),
 * which is what Skia's analytic AA converges to for thin strokes and disc edges.
 */

const PREAMBLE = /* glsl */ `
precision highp float;
float coverage(float d, float half_) {
  return max(0.0, min(d + 0.5, half_) - max(d - 0.5, -half_));
}
// Area of the unit pixel square on the positive side of a line at signed distance t
// from the pixel centre with unit normal (a, b) (a >= b >= 0): exact, piecewise quadratic.
float halfPlaneArea(float t, float a, float b) {
  float lim = (a + b) * 0.5;
  if (t <= -lim) return 0.0;
  if (t >= lim) return 1.0;
  if (abs(t) <= (a - b) * 0.5) return 0.5 + t / max(a, 1e-6);
  float s = lim - abs(t);
  float corner = s * s / max(2.0 * a * b, 1e-6);
  return t > 0.0 ? 1.0 - corner : corner;
}
// Pixel area covered by a stroke of half width h whose centreline passes at signed
// distance d (px) from the pixel centre, with screen normal n: what analytic AA gives.
float strokeArea(float d, float h, vec2 n) {
  float a = max(abs(n.x), abs(n.y));
  float b = min(abs(n.x), abs(n.y));
  return clamp(halfPlaneArea(d + h, a, b) - halfPlaneArea(d - h, a, b), 0.0, 1.0);
}
`;

/** Nebula dust: one radial gradient per cluster (stops 0 / 0.55 / 1 of the centre alpha, ×0.45, 0). */
export const DUST_VERT = /* glsl */ `
attribute vec2 aPos;
attribute float aRadius;
attribute vec4 aColor;
uniform float uK;
varying vec2 vLocal;
varying float vRadius;
varying vec4 vColor;
void main() {
  vec2 corner = position.xy * (aRadius + 1.0);
  vec2 world = aPos + corner / uK;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 0.0, 1.0);
  vLocal = corner;
  vRadius = aRadius;
  vColor = aColor;
}
`;

export const DUST_FRAG = /* glsl */ `
${PREAMBLE}
varying vec2 vLocal;
varying float vRadius;
varying vec4 vColor;
void main() {
  float d = length(vLocal);
  float t = d / vRadius;
  float core = vColor.a;
  float a = t < 0.55 ? mix(core, core * 0.45, t / 0.55) : mix(core * 0.45, 0.0, clamp((t - 0.55) / 0.45, 0.0, 1.0));
  a *= clamp(vRadius + 0.5 - d, 0.0, 1.0);
  if (a <= 0.0005) discard;
  gl_FragColor = vec4(vColor.rgb * a, a);
}
`;

/**
 * Star glyph: the 2D `drawStar` in one quad. Glow = 4-stop radial gradient
 * (0 / 0.12 / 0.42 / 1 → min(1, o·a), 0.72·o·a, 0.15·o·a, 0), then two 0.5 px
 * rays at alpha·0.22 for big cores, then the core disc at `alpha`, composited
 * in that order. All three share `uStar`, so the result is one alpha.
 */
export const NODE_VERT = /* glsl */ `
attribute vec2 aPos;
attribute float aCore;
attribute float aGlow;
attribute float aRayLen;
attribute float aRayAngle;
attribute float aOpacity;
attribute float aAlpha;
uniform float uK;
varying vec2 vLocal;
varying float vCore;
varying float vGlow;
varying float vRayLen;
varying float vRayAngle;
varying float vOpacity;
varying float vAlpha;
void main() {
  float ext = max(aGlow, aRayLen) + 1.0;
  vec2 corner = position.xy * ext;
  vec2 world = aPos + corner / uK;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 0.0, 1.0);
  vLocal = corner;
  vCore = aCore;
  vGlow = aGlow;
  vRayLen = aRayLen;
  vRayAngle = aRayAngle;
  vOpacity = aOpacity;
  vAlpha = aAlpha;
}
`;

export const NODE_FRAG = /* glsl */ `
${PREAMBLE}
uniform vec3 uStar;
varying vec2 vLocal;
varying float vCore;
varying float vGlow;
varying float vRayLen;
varying float vRayAngle;
varying float vOpacity;
varying float vAlpha;
void main() {
  if (vAlpha <= 0.0005) discard;
  float d = length(vLocal);
  float t = d / vGlow;
  float a0 = min(1.0, vOpacity * vAlpha);
  float a1 = vOpacity * vAlpha * 0.72;
  float a2 = vOpacity * vAlpha * 0.15;
  float glowA;
  if (t < 0.12) glowA = mix(a0, a1, t / 0.12);
  else if (t < 0.42) glowA = mix(a1, a2, (t - 0.12) / 0.30);
  else glowA = mix(a2, 0.0, clamp((t - 0.42) / 0.58, 0.0, 1.0));
  glowA *= clamp(vGlow + 0.5 - d, 0.0, 1.0);

  float raysA = 0.0;
  if (vRayLen > 0.0) {
    vec2 dir1 = vec2(cos(vRayAngle), sin(vRayAngle));
    vec2 dir2 = vec2(-dir1.y, dir1.x);
    float cov1 = coverage(abs(dot(vLocal, dir2)), 0.25) * clamp(vRayLen + 0.5 - abs(dot(vLocal, dir1)), 0.0, 1.0);
    float cov2 = coverage(abs(dot(vLocal, dir1)), 0.25) * clamp(vRayLen + 0.5 - abs(dot(vLocal, dir2)), 0.0, 1.0);
    float rayAlpha = vAlpha * 0.22;
    raysA = 1.0 - (1.0 - cov1 * rayAlpha) * (1.0 - cov2 * rayAlpha);
  }

  float coreA = coverage(d, vCore) * vAlpha;
  float a = 1.0 - (1.0 - glowA) * (1.0 - raysA) * (1.0 - coreA);
  if (a <= 0.0005) discard;
  gl_FragColor = vec4(uStar * a, a);
}
`;

/**
 * Edge strips: a quadratic curve as a triangle strip, widened in the vertex
 * shader by `half + 1` px along the per-vertex normal, antialiased per pixel.
 * `uDash` (on, off lengths in px) and `uDashOffset` reproduce `setLineDash` /
 * `lineDashOffset` for the weak-trace pass; (0, 0) draws solid.
 */
export const EDGE_VERT = /* glsl */ `
attribute vec2 aNormal;
attribute float aSide;
attribute float aHalf;
attribute vec4 aColor;
attribute float aAlong;
uniform float uK;
varying float vDist;
varying float vHalf;
varying vec4 vColor;
varying float vAlong;
varying vec2 vNormal;
void main() {
  float ext = aHalf + 1.0;
  vec2 world = position.xy + aNormal * (aSide * ext) / uK;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 0.0, 1.0);
  vDist = aSide * ext;
  vHalf = aHalf;
  vColor = aColor;
  vAlong = aAlong;
  vNormal = aNormal;
}
`;

export const EDGE_FRAG = /* glsl */ `
${PREAMBLE}
uniform vec2 uDash;
uniform float uDashOffset;
varying float vDist;
varying float vHalf;
varying vec4 vColor;
varying float vAlong;
varying vec2 vNormal;
void main() {
  float a;
  if (uDash.x > 0.0) {
    // Round-capped dashes (lineCap round): distance to the nearest dash segment
    // along the stroke, combined with the distance across it.
    float period = uDash.x + uDash.y;
    float p = mod(vAlong + uDashOffset, period);
    if (p < 0.0) p += period;
    float gap = p <= uDash.x ? 0.0 : min(p - uDash.x, period - p);
    a = coverage(length(vec2(gap, vDist)), vHalf) * vColor.a;
  } else {
    a = strokeArea(vDist, vHalf, normalize(vNormal)) * vColor.a;
  }
  if (a <= 0.0005) discard;
  gl_FragColor = vec4(vColor.rgb * a, a);
}
`;
