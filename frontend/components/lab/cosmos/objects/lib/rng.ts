/**
 * Seeded randomness for the exhibits. `mulberry32` / `seedFromText` come from
 * the space lab's stable helper (read-only import); everything else is local.
 */
import { mulberry32, seedFromText } from "../../../space/lib/rng";

export { mulberry32, seedFromText };

export type Rng = () => number;

export function range(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

export function int(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

/** Box-Muller, one sample per call. */
export function gaussian(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Per-exhibit seed derived from the gallery seed: reroll changes all, each stays distinct. */
export function seedFor(base: number, id: string): number {
  return seedFromText(`${base >>> 0}:${id}`);
}

/** Even pixel coordinate so a 2 px cell never straddles. */
export function even(n: number): number {
  return Math.round(n / 2) * 2;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
