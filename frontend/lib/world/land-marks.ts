/**
 * User-timing spans around the land's build stages (the cloud dive's hold,
 * 2026-10-14): every heavy step of the ice land's mount is wrapped in
 * `landSpan`, so a CPU profile or `performance.getEntriesByType("measure")`
 * reads `land:<stage>` with its milliseconds. Free when there is no
 * `performance` (SSR, node tests) and cheap otherwise.
 */

const perf: Performance | null = typeof performance !== "undefined" && typeof performance.now === "function" ? performance : null;

export const LAND_MARK_PREFIX = "land:";

/** Run `fn`, recording `land:<name>` as a measure from its start to its end. */
export function landSpan<T>(name: string, fn: () => T): T {
  if (!perf) return fn();
  const start = perf.now();
  try {
    return fn();
  } finally {
    landMeasure(name, start, perf.now());
  }
}

/** Record `land:<name>` over an explicit [start, end] (both `performance.now()` values). */
export function landMeasure(name: string, start: number, end: number): void {
  if (!perf || typeof perf.measure !== "function") return;
  try {
    perf.measure(`${LAND_MARK_PREFIX}${name}`, { start, end: Math.max(start, end) });
  } catch {
    /* an older User Timing (no options bag): the measure is diagnostic only */
  }
}

/** A point in time, `land:<name>`. */
export function landMark(name: string): void {
  if (!perf || typeof perf.mark !== "function") return;
  try {
    perf.mark(`${LAND_MARK_PREFIX}${name}`);
  } catch {
    /* diagnostic only */
  }
}
