/**
 * The stage's rungs: four rest stops on the log-distance axis `L` the spring
 * travels (world 0, planet 1, constellation 2, galaxy 3). Internal only: the
 * header keeps its two pills (Courses and Information) and nothing renders a
 * ladder; the pills ask these pure rules where to go. The readout math
 * (`rungAt`, `stepRung`, `clampL`) comes from the shell lab's
 * `ladder-indicator.ts`; the navigation rules are Philote's 2026-10-11
 * decisions:
 *
 *   Information is a ladder keyed to the active course: planet -> that
 *   class's constellation, constellation -> the galaxy, galaxy -> nothing
 *   (stays). From inside a world it rises straight to the constellation.
 *
 *   Courses always lands on the planet: from a constellation locked on that
 *   course, from the galaxy on the most recent (or default) course, from a
 *   world on its course.
 */

export type Rung = "world" | "planet" | "constellation" | "galaxy";

export const RUNGS: readonly Rung[] = ["world", "planet", "constellation", "galaxy"];

/** Rest stop on the log-distance axis per rung. */
export const RUNG_L: Record<Rung, number> = { world: 0, planet: 1, constellation: 2, galaxy: 3 };

export const L_MIN = 0;
export const L_MAX = 3;

export function clampL(L: number): number {
  if (!Number.isFinite(L)) return L_MIN;
  return L < L_MIN ? L_MIN : L > L_MAX ? L_MAX : L;
}

export function rungIndex(rung: Rung): number {
  return RUNG_L[rung];
}

/** Nearest rest stop (no hysteresis). */
export function rungAt(L: number): Rung {
  return RUNGS[Math.round(clampL(L))];
}

export function stepRung(rung: Rung, dir: -1 | 1): Rung {
  const i = Math.max(0, Math.min(RUNGS.length - 1, rungIndex(rung) + dir));
  return RUNGS[i];
}

/** Half-width of the dead band around each midpoint (L units) for a flicker-free readout. */
export const HYSTERESIS = 0.08;

/**
 * The rung a readout should show, given the one it showed before: it only
 * moves to a neighbour once `L` is past the midpoint by more than `h`, and a
 * long hop walks as many rungs as the crossing allows. At rest on a stop this
 * is always the nearest rung.
 */
export function activeRung(L: number, prev: Rung, h = HYSTERESIS): Rung {
  const x = clampL(L);
  let i = rungIndex(prev);
  while (i < RUNGS.length - 1 && x > i + 0.5 + h) i++;
  while (i > 0 && x < i - 0.5 - h) i--;
  return RUNGS[i];
}

/**
 * Where the Information pill goes from `current`. Returns the same rung when
 * there is nowhere to go (the galaxy, or a planet with no course to open), so
 * a caller can treat "target === current" as a no-op.
 */
export function nextRungForInformation(current: Rung, hasCourse: boolean): Rung {
  switch (current) {
    case "world":
      return "constellation";
    case "planet":
      return hasCourse ? "constellation" : "planet";
    case "constellation":
      return "galaxy";
    case "galaxy":
      return "galaxy";
  }
}

export interface CoursesTarget {
  rung: "planet";
  /** The course the planet should settle on; null = the caller's default course. */
  courseId: string | null;
}

/**
 * Where the Courses pill goes from `current`: always the planet. From a
 * constellation the planet locks on that course (the constellation's course is
 * the most recent one); from the galaxy on the most recent course, or the
 * default when there is none; from a world on the world's course.
 */
export function rungForCourses(current: Rung, mostRecentCourse: string | null): CoursesTarget {
  void current;
  return { rung: "planet", courseId: mostRecentCourse };
}
