/** Easing for the gravity beats. All take and return 0..1 unless noted. */

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function easeOutQuad(t: number): number {
  const u = clamp01(t);
  return 1 - (1 - u) * (1 - u);
}

export function easeInQuad(t: number): number {
  const u = clamp01(t);
  return u * u;
}

export function easeInOutQuad(t: number): number {
  const u = clamp01(t);
  return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
}

export function easeOutCubic(t: number): number {
  const u = clamp01(t);
  return 1 - Math.pow(1 - u, 3);
}

export function easeInCubic(t: number): number {
  const u = clamp01(t);
  return u * u * u;
}

/** Overshoots past 1 and settles: the "pop". */
export function backOut(t: number, s = 1.70158): number {
  const u = clamp01(t) - 1;
  return u * u * ((s + 1) * u + s) + 1;
}

/** Fraction of [from, to] that `t` has covered, clamped. */
export function span(t: number, from: number, to: number): number {
  return clamp01((t - from) / Math.max(1e-6, to - from));
}
