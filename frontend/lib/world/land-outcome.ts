import type { WorldChange } from "./adapter";

/**
 * What a new world payload means for the land the student is standing on. A resident going weak
 * (`explode`) is a failed result: the town plays its catastrophe. A resident coming back
 * (`recover`) or a concept reaching mastery (`master`) is a passed result: the storm heals and the
 * land throws confetti. Everything else (sprouts, growth, landmarks) is news for one spot, not for
 * the land as a whole. One payload yields at most one outcome; a failure outranks a pass, the same
 * order the sound budget uses.
 */
export type LandOutcome = "fail" | "pass";

export function landOutcome(changes: readonly WorldChange[]): LandOutcome | null {
  let passed = false;
  for (const change of changes) {
    if (change.kind === "explode") return "fail";
    if (change.kind === "recover" || change.kind === "master") passed = true;
  }
  return passed ? "pass" : null;
}

export const CONFETTI_COUNT = 240;
export const CONFETTI_DURATION_S = 4.4;
const CONFETTI_COLORS = ["#ffe7a3", "#e88a8a", "#8fc9d8", "#fff6df", "#9b8daf", "#c8524a", "#7ec4e8"] as const;

export interface ConfettiPiece {
  id: number;
  left: number;
  delay: number;
  duration: number;
  color: string;
  rotate: number;
  width: number;
  height: number;
}

/** Screen-filling pass burst: many pieces, staggered, long fall. Deterministic, so a burst never re-rolls. */
export function buildConfettiPieces(count = CONFETTI_COUNT): ConfettiPiece[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    left: (index * 37 + (index % 9) * 11) % 100,
    delay: ((index % 24) / 24) * 1.15,
    duration: CONFETTI_DURATION_S + (index % 7) * 0.18,
    color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
    rotate: (index * 47) % 360,
    width: 7 + (index % 5) * 3,
    height: 10 + (index % 4) * 4,
  }));
}

/** When the last piece has landed (longest delay + longest fall, with a little slack). */
export function confettiBurstMs(pieces: readonly ConfettiPiece[] = buildConfettiPieces()): number {
  const last = Math.max(0, ...pieces.map((piece) => piece.delay + piece.duration));
  return Math.round((last + 0.5) * 1000);
}
