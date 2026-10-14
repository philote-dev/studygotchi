/**
 * Same mulberry32 as `lib/spiral-galaxy.ts`, `SpaceField.tsx` and the space
 * lab. Copied rather than imported so this folder has no live dependency on
 * `components/lab/space/**`, which another agent is editing.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Text seeds ("gargantua") hash to a 32-bit seed; numeric strings pass through. */
export function seedFromText(text: string): number {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) >>> 0;
  if (/^0x[0-9a-f]+$/i.test(trimmed)) return parseInt(trimmed, 16) >>> 0;
  let h = 2166136261;
  for (let i = 0; i < trimmed.length; i++) {
    h ^= trimmed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function range(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}
