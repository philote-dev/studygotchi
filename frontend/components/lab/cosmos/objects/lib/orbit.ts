/** Kepler orbit helpers shared by the comet, the moons and the binary (CPU side, tested). */

/** Eccentric anomaly from mean anomaly: a good first guess plus 6 Newton steps (1e-9 for e <= 0.9). */
export function keplerE(M: number, e: number): number {
  let E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
  for (let i = 0; i < 6; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
}

/** Position on an ellipse with the focus at the origin and periapsis on +x. */
export function orbitPoint(a: number, e: number, M: number): { x: number; y: number; E: number } {
  const E = keplerE(M, e);
  return { x: a * (Math.cos(E) - e), y: a * Math.sqrt(1 - e * e) * Math.sin(E), E };
}

/** The same solver in GLSL so tails and moons need no per-frame JS. */
export const GLSL_KEPLER = /* glsl */ `
float keplerE(float M, float e) {
  float E = M + e * sin(M) * (1.0 + e * cos(M));
  for (int i = 0; i < 6; i++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
  return E;
}
vec2 orbitPoint(float a, float e, float M) {
  float E = keplerE(M, e);
  return vec2(a * (cos(E) - e), a * sqrt(1.0 - e * e) * sin(E));
}
vec2 orbitTangent(float a, float e, float M) {
  float E = keplerE(M, e);
  return normalize(vec2(-a * sin(E), a * sqrt(1.0 - e * e) * cos(E)));
}
`;

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

export function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}
