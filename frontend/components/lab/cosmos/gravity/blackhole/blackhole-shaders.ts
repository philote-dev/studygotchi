import { GLSL_BAND, GLSL_SNAP, GLSL_THEME_TONE } from "../lib/uniforms";

/** EHT proportions: shadow 0.38 R, photon ring 0.40..0.44 R, disc 0.46..1.0 R. */
export const BH = { shadow: 0.38, ringIn: 0.4, ringOut: 0.44, discIn: 0.46, beadR: 0.5 } as const;
export const MAX_BEADS = 5;

export const SPRITE_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/**
 * Disc, over-arc, under-arc, shadow, photon ring and beads in one quad.
 *
 * The flat disc is an ellipse squashed by the tilt (1 face-on, 0.30 edge-on).
 * The far half of a real thin disc is lensed over the top of the shadow and a
 * fainter second image appears below it (Schnittman SVS 13326, Interstellar);
 * here those are two more copies of the disc drawn in their own ellipse
 * coordinates, a tall dome (squash 0.80) above and a narrower, dimmer one
 * (0.55, width 0.72) below, both hugging the shadow. Doppler: the left side
 * approaches and is brightest, banded to four steps between 0.3 and 1.0.
 * The disc grain is a logarithmic spiral that winds up with Keplerian
 * differential rotation (omega ~ r^-1.5), per the EHT polarisation streaks.
 */
export const DISC_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSpin;        // period at r = R, seconds
uniform float uCellsPerR;
uniform float uTilt;        // 0 face-on .. 1 edge-on silhouette
uniform float uRingFlash;
uniform float uAlpha;
uniform float uFeed;        // disc brightness lift while feeding
uniform float uLight;
uniform float uBeadCount;
uniform float uBeads[${MAX_BEADS}];
uniform vec3 uGold, uAmber, uEdge, uDim, uRim, uFlashColor;
varying vec2 vUv;
${GLSL_BAND}

const float SHADOW = ${BH.shadow.toFixed(2)};
const float RING_IN = ${BH.ringIn.toFixed(2)};
const float RING_OUT = ${BH.ringOut.toFixed(2)};
const float DISC_IN = ${BH.discIn.toFixed(2)};

float quant(float r) { return (floor(r * uCellsPerR) + 0.5) / uCellsPerR; }

float doppler(float a) {
  // Approaching side on the left (a = pi) is brightest.
  float d = 0.55 - 0.45 * cos(a);
  return mix(0.3, 1.0, floor((d - 0.1) / 0.9 * 3.999) / 3.0);
}

// One disc copy in its own ellipse coordinates. Returns rgb and alpha (0 outside).
vec4 discCopy(vec2 p, float sq, float wid, float gain) {
  vec2 q = vec2(p.x / wid, p.y / sq);
  float r = length(q);
  float rq = quant(r);
  if (rq < DISC_IN || rq > 1.0) return vec4(0.0);
  float a = atan(q.y, q.x);
  float bandIdx = floor((rq - DISC_IN) / 0.18);
  // Keplerian differential rotation: inner rings lap the outer ones.
  float omega = 6.2832 / uSpin * pow(max(rq, 0.3), -1.5);
  float spiral = a + omega * uTime + 2.2 * log(max(rq, 0.2));
  float grain = step(0.5, fract(spiral * 7.0 / 6.2832 + bandIdx * 0.33 + floor(rq * uCellsPerR) * 0.11));
  vec3 c = bandIdx < 0.5 ? uAmber : (bandIdx < 1.5 ? uEdge : uDim);
  c = mix(c, uDim, grain * 0.28);
  c = mix(c, uGold, uFeed * 0.35 * (1.0 - grain));
  float lum = doppler(a) * gain * (1.0 + 0.3 * uFeed);
  float alpha = 1.0 - floor(smoothstep(0.72, 1.0, rq) * 4.0) / 4.0;
  return vec4(c * lum, alpha);
}

void main() {
  vec2 p = (vUv - 0.5) * 2.0 * 1.05;   // R units, quad is 2.1 R wide
  float r = length(p);
  float rq = quant(r);
  float sqFlat = mix(1.0, 0.30, uTilt);
  float sqOver = mix(1.0, 0.86, uTilt);
  float wOver = mix(1.0, 0.84, uTilt);
  float sqUnder = mix(1.0, 0.55, uTilt);
  float wUnder = mix(1.0, 0.70, uTilt);

  vec3 c = vec3(0.0);
  float alpha = 0.0;

  // Back to front: under-arc, over-arc, flat disc (far half), shadow, ring, near half, beads.
  if (p.y < 0.0 && uTilt > 0.02) {
    vec4 u = discCopy(p, sqUnder, wUnder, 0.5);
    c = mix(c, u.rgb, u.a); alpha = max(alpha, u.a * step(0.01, u.a));
  }
  if (p.y > 0.0 && uTilt > 0.02) {
    vec4 o = discCopy(p, sqOver, wOver, 0.78);
    c = mix(c, o.rgb, o.a); alpha = max(alpha, o.a * step(0.01, o.a));
  }
  vec4 flat_ = discCopy(p, sqFlat, 1.0, 1.0);
  bool near = flat_.a > 0.01 && p.y < 0.0;
  if (flat_.a > 0.01 && !near) { c = mix(c, flat_.rgb, flat_.a); alpha = max(alpha, flat_.a); }

  if (rq < SHADOW && !near) {
    // The only pure black in the sky; a 1-cell rim so it reads on the light theme.
    float rim = step(SHADOW - 1.2 / uCellsPerR, rq);
    c = mix(vec3(0.0), uRim, rim);
    alpha = 1.0;
  }
  float ring = step(RING_IN, rq) * step(rq, RING_OUT);
  if (ring > 0.5 && !near) { c = uGold; alpha = 1.0; }
  if (near) { c = flat_.rgb; alpha = flat_.a; }

  // Beads: 1-cell knots with a 1-cell halo, riding the near ellipse in front and the over-arc behind;
  // hidden where they pass behind the shadow.
  for (int i = 0; i < ${MAX_BEADS}; i++) {
    if (float(i) >= uBeadCount) break;
    float ang = uBeads[i];
    float far = step(0.0, sin(ang));
    float sq = mix(sqFlat, sqOver, far);
    float wd = mix(1.0, wOver, far);
    vec2 bp = vec2(cos(ang) * wd, sin(ang) * sq) * ${BH.beadR.toFixed(2)};
    if (far > 0.5 && length(bp) < SHADOW) continue;
    float dc = length(p - bp) * uCellsPerR;
    float bead = step(dc, 0.8);
    // The 1-cell halo only once the hole is big enough that it does not swallow the ring (R > 12 cells).
    float halo = step(dc, 1.7) * (1.0 - bead) * step(12.0, uCellsPerR);
    c = mix(c, uAmber, halo);
    alpha = max(alpha, halo * 0.85);
    c = mix(c, uGold, bead);
    alpha = max(alpha, bead);
  }

  c = mix(c, uFlashColor, uRingFlash * clamp(ring + alpha * 0.6, 0.0, 1.0));
  alpha *= uAlpha;
  if (alpha <= 0.002) discard;
  gl_FragColor = vec4(c, alpha);
  #include <colorspace_fragment>
}
`;

/** Two thin polar jets: 1-cell core, 1-cell soft edge, knots drifting outward, counter-jet dimmer. */
export const JET_FRAG = /* glsl */ `
uniform float uTime;
uniform float uCellsPerR;
uniform float uJet;
uniform vec3 uJetColor;
varying vec2 vUv;
${GLSL_BAND}
void main() {
  vec2 p = (vUv - 0.5) * vec2(1.0, 3.6);  // R units
  float ay = abs(p.y);
  if (ay < 0.42 || uJet <= 0.001) discard;
  float xc = abs(p.x) * uCellsPerR;
  float core = step(xc, 0.6);
  float edge = step(xc, 1.6) * (1.0 - core);
  float along = 1.0 - smoothstep(0.42, 1.8, ay);
  // Knots drift outward; the beam is a 1-cell core with a dimmer 1-cell sheath that the knots light up.
  float knot = step(0.55, fract(ay * 2.2 - uTime * 0.4 + step(p.y, 0.0) * 0.37));
  float lum = along * (core * (0.7 + 0.3 * knot) + edge * (0.25 + 0.3 * knot));
  lum *= p.y < 0.0 ? 0.55 : 1.0;
  float a = band(lum, 4.0) * uJet;
  if (a <= 0.01) discard;
  gl_FragColor = vec4(uJetColor, a);
  #include <colorspace_fragment>
}
`;

/**
 * In-falling feed streams: three lanes of 1-cell particles spiralling from
 * 2.1 R down to the disc edge in the disc plane, far side riding the over-arc,
 * hidden behind the shadow. All motion is in the vertex shader; the draw range
 * sets how many are alive (the `feed` slider).
 */
export const FEED_VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uRes;
uniform float uLight;
uniform float uTilt;
uniform float uPeriod;
uniform float uBurst;
attribute float aPhase;
attribute float aAngle;
attribute float aSpeed;
varying float vAlpha;
varying vec3 vColor;
varying float vShape;
${GLSL_SNAP}
${GLSL_THEME_TONE}
void main() {
  float f = fract(uTime / (uPeriod / aSpeed) + aPhase);
  float r = mix(2.1, ${BH.discIn.toFixed(2)}, pow(f, 0.75));
  float a = aAngle + 3.2 * (2.1 - r) + uBurst * 1.5;
  float far = step(0.0, sin(a));
  float sq = mix(mix(1.0, 0.30, uTilt), mix(1.0, 0.80, uTilt), far);
  vec2 q = vec2(cos(a) * r, sin(a) * r * sq);
  float hidden = far * step(length(q), ${BH.shadow.toFixed(2)});
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(q, 0.0, 1.0);
  gl_Position = snapClip(clip, uRes);
  // The head of each stream (last 12 percent of the fall) is a 3-cell plus, the tail single cells.
  float head = step(0.88, f);
  gl_PointSize = 1.0 + 2.0 * head;
  float tw = step(0.35, fract(uTime * 1.7 + aPhase * 7.0));
  vAlpha = (1.0 - hidden) * smoothstep(0.0, 0.08, f) * mix(0.7, 1.0, f) * mix(0.85, 1.0, tw);
  vShape = head;
  vColor = themeTone(color, uLight);
}
`;

export const FEED_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
varying float vShape;
void main() {
  float a = vAlpha;
  if (vShape > 0.5) {
    vec2 q = floor(gl_PointCoord * 3.0);
    if (q.x != 1.0 && q.y != 1.0) discard;
    if (!(q.x == 1.0 && q.y == 1.0)) a *= 0.5;
  }
  if (a <= 0.02) discard;
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}
`;
