import { GLSL_BAND } from "../lib/uniforms";

/** Quad half-size in R units (rim plus a 1-cell halo). */
export const WORM_EXTENT = 1.12;
export const WORM = { mouth: 0.86, rimMid: 0.91, rimOuter: 0.96, edge: 1.0, halo: 1.04 } as const;
const g = (n: number) => n.toFixed(2);

/**
 * The mouth: a round glowing door. Inside, a second seeded star field (a small
 * render target) seen through a barrel map, r' = r^k, so the far sky bunches
 * toward the rim the way Interstellar's Dneg wormhole squeezes the distant
 * galaxy against its edge; it turns slowly and twists more near the centre.
 * The rim is three banded steps (cream, lilac, dusk) plus a 1-cell halo.
 */
export const MOUTH_FRAG = /* glsl */ `
uniform sampler2D tInner;
uniform vec2 uInnerRes;
uniform float uTime;
uniform float uCellsPerR;
uniform float uSwirl;
uniform float uOpen;      // 0 door shut, 1 open
uniform float uBarrel;    // barrel exponent, 1.6 at rest, eases to 1.0 while traversing
uniform float uAlpha;
uniform float uRimFlash;
uniform vec3 uRimOuter, uRimMid, uRimInner, uTint, uShut;
varying vec2 vUv;
${GLSL_BAND}
float quant(float r) { return (floor(r * uCellsPerR) + 0.5) / uCellsPerR; }
void main() {
  vec2 p = (vUv - 0.5) * 2.0 * ${g(WORM_EXTENT)};
  float r = length(p);
  float rq = quant(r);
  vec3 c = vec3(0.0);
  float alpha = 0.0;
  if (rq < ${g(WORM.mouth)}) {
    float rn = rq / ${g(WORM.mouth)};
    float a = atan(p.y, p.x) + uTime / 60.0 + uSwirl * 1.3 * (1.0 - rn) * (1.0 - rn);
    float rs = pow(rn, uBarrel) * 0.48;
    vec2 uv = vec2(0.5) + vec2(cos(a), sin(a)) * rs;
    // Snap the sample to the target's texels so inner stars stay whole cells.
    vec2 texel = vec2(1.0) / uInnerRes;
    uv = (floor(uv / texel) + 0.5) * texel;
    vec3 inner = texture2D(tInner, uv).rgb;
    // A soft two-step haze toward the centre of the far sky, so the door reads as depth, not a flat disc.
    float haze = band(1.0 - rn, 3.0) * 0.16;
    vec3 open = mix(inner, uTint, 0.12) + uTint * haze;
    // One cell of rim light just inside the door.
    float lip = step(${g(WORM.mouth)} - 1.2 / uCellsPerR, rq);
    open = mix(open, uRimInner, lip * 0.55);
    c = mix(uShut, open, uOpen);
    alpha = 1.0;
  } else if (rq < ${g(WORM.rimMid)}) { c = uRimInner; alpha = 1.0; }
  else if (rq < ${g(WORM.rimOuter)}) { c = uRimMid; alpha = 1.0; }
  else if (rq < ${g(WORM.edge)}) { c = uRimOuter; alpha = 0.8; }
  else if (rq < ${g(WORM.halo)}) { c = uRimOuter; alpha = 0.35; }
  c = mix(c, uRimInner, uRimFlash * step(0.01, alpha));
  alpha *= uAlpha;
  if (alpha <= 0.002) discard;
  gl_FragColor = vec4(c, alpha);
  #include <colorspace_fragment>
}
`;
