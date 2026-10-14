import { GLSL_BAND, GLSL_HASH, GLSL_SNAP, GLSL_THEME_TONE } from "../lib/uniforms";

/** Quad half-size in R units (room for the corona rays and the birth shock ring). */
export const WH_EXTENT = 2.6;
export const WH = { core: 0.3, band1: 0.52, band2: 0.74, edge: 1.0, rayOut: 1.7, shockMax: 2.4 } as const;
const g = (n: number) => n.toFixed(2);

/**
 * The mirror of the black hole: a bright banded core (four steps, cream to
 * cyan to ice blue) whose band edges boil with two slow polar waves, fourteen
 * thin corona rays of seeded length that blink in two steps and creep round
 * once per 40 s, a 3 to 5 s breathing pulse that steps the bands outward one
 * cell at a time, and on birth a 1.5-cell shock ring that runs from the core
 * to 2.4 R in 900 ms.
 */
export const CORE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uCellsPerR;
uniform float uPulse;
uniform float uAlpha;
uniform float uIntensity;
uniform float uState;       // 0 dormant, 1 alive
uniform float uBirth;       // 0..1 shock progress, < 0 when idle
uniform float uRingFlash;
uniform float uSeed;
uniform vec3 uCore, uBand1, uBand2, uBand3, uRay, uShock;
varying vec2 vUv;
${GLSL_BAND}
${GLSL_HASH}
float quant(float r) { return (floor(r * uCellsPerR) + 0.5) / uCellsPerR; }
void main() {
  vec2 p = (vUv - 0.5) * 2.0 * ${g(WH_EXTENT)};
  float r = length(p);
  float a = atan(p.y, p.x);
  float pulse = 1.0 + 0.06 * sin(6.2832 * uTime / uPulse) * uState;
  // Boiling edge: two slow polar waves, quantised with the radius so bands step whole cells.
  float boil = (0.035 * sin(a * 6.0 + uTime * 0.7) + 0.025 * sin(a * 11.0 - uTime * 1.1)) * uState;
  float rq = quant(r + boil * r);
  float rr = rq / pulse;
  vec3 c = vec3(0.0);
  float alpha = 0.0;
  if (rr < ${g(WH.core)}) { c = uCore; alpha = 1.0; }
  else if (rr < ${g(WH.band1)}) { c = uBand1; alpha = 1.0; }
  else if (rr < ${g(WH.band2)}) { c = uBand2; alpha = mix(0.6, 1.0, uState); }
  else if (rr < ${g(WH.edge)}) { c = uBand3; alpha = mix(0.35, 0.85, uState); }
  else if (rr < ${g(WH.rayOut)} && uState > 0.5) {
    // Fourteen thin rays, each with a seeded length and a two-step blink, drifting round slowly.
    float sectors = 14.0;
    float s = a * sectors / 6.2832 + uTime / 40.0;
    float idx = floor(s);
    float h = hash11(idx + uSeed);
    float len = ${g(WH.edge)} + 0.18 + 0.5 * h;
    float k = clamp((rr - ${g(WH.edge)}) / (len - ${g(WH.edge)}), 0.0, 1.0);
    float halfW = mix(0.075, 0.025, k);                      // tapers outward
    float ray = step(abs(fract(s) - 0.5), halfW) * step(rr, len);
    float blink = step(0.3, fract(uTime / (2.0 + 3.0 * h) + h));
    float fall = band(1.0 - k, 3.0);
    c = mix(uBand3, uRay, step(0.35, k));
    alpha = ray * fall * uIntensity * mix(0.55, 1.0, blink) * 0.95;
  }
  // Birth shock: a 1.5-cell ring expanding from the core edge, fading in three steps.
  if (uBirth >= 0.0 && uBirth < 1.0) {
    float sr = mix(${g(WH.core)}, ${g(WH.shockMax)}, 1.0 - pow(1.0 - uBirth, 2.0));
    float w = 1.5 / uCellsPerR;
    float hit = step(abs(quant(r) - sr), w);
    float sa = band(1.0 - uBirth, 3.0) * hit;
    c = mix(c, uShock, sa);
    alpha = max(alpha, sa);
  }
  c = mix(c, uCore, uRingFlash * step(0.01, alpha));
  alpha *= uAlpha;
  if (alpha <= 0.002) discard;
  gl_FragColor = vec4(c, alpha);
  #include <colorspace_fragment>
}
`;

/**
 * Fountain: particles born at the core edge, decelerating outward to 2.4 R
 * with a gentle curl, fading in three alpha steps; one in five is a 3-cell
 * plus sparkle. On birth every particle with phase < 0.6 is re-emitted
 * together as one shell.
 */
export const FOUNTAIN_VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uRes;
uniform float uLight;
uniform float uPeriod;
uniform float uBirthAt;
attribute float aPhase;
attribute float aAngle;
attribute float aSpeed;
attribute float aCurl;
attribute float aSize;
varying float vAlpha;
varying vec3 vColor;
varying float vShape;
${GLSL_SNAP}
${GLSL_THEME_TONE}
void main() {
  float f = fract(uTime / (uPeriod / aSpeed) + aPhase);
  float sinceBirth = uTime - uBirthAt;
  if (sinceBirth >= 0.0 && sinceBirth < 1.1 && aPhase < 0.6) f = clamp(sinceBirth / 1.1 * (0.6 + 0.4 * aSpeed), 0.0, 0.999);
  float ease = 1.0 - (1.0 - f) * (1.0 - f);
  float r = mix(${g(WH.edge)} * 0.9, ${g(WH.shockMax)}, ease);
  float a = aAngle + aCurl * f * 0.8;
  vec2 q = vec2(cos(a), sin(a)) * r;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(q, 0.0, 1.0);
  gl_Position = snapClip(clip, uRes);
  // Young particles are 3-cell plus sparkles (the spray), then shrink to one cell as they fade.
  float young = step(f, 0.3);
  float sizeNow = max(aSize * young, mix(1.0, aSize, 0.0) + young * 2.0);
  gl_PointSize = sizeNow;
  float fade = 0.5 + 0.5 * floor((1.0 - f) * 2.0 + 0.999) / 2.0;
  float tw = step(0.3, fract(uTime * 1.3 + aPhase * 9.0));
  vAlpha = fade * smoothstep(0.0, 0.03, f) * mix(0.8, 1.0, tw);
  vColor = themeTone(color, uLight);
  vShape = step(2.0, sizeNow);
}
`;

export const FOUNTAIN_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
varying float vShape;
void main() {
  float a = vAlpha;
  if (vShape > 0.5) {
    vec2 q = floor(gl_PointCoord * 3.0);
    bool centre = q.x == 1.0 && q.y == 1.0;
    if (q.x != 1.0 && q.y != 1.0) discard;
    if (!centre) a *= 0.45;
  }
  if (a <= 0.02) discard;
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}
`;
