/**
 * The product's course list -> the galaxy layout's input (`GalaxyCourse`).
 *
 * The identity gives id, name, code and term; the course overview cache
 * (`components/earth/useCourseOverviewCache`, the same source the globe's
 * progress rings read) gives the concept stats once a course's world has
 * loaded; the active-course store gives recency. Pure: the caller passes
 * lookups, so this runs in vitest without React or fetches.
 *
 * Mapping (plan S3-1 / S3-2): size = concept count (unknown stats -> 1, the
 * smallest bead, until the overview arrives), mastery = reached / total,
 * subject from the code prefix (`subjectFromCode` in layout.ts), hasWorld
 * when the course has a loaded world with concepts (the caller may widen it),
 * archived never (the identity has no archive yet), lastOpenedAt from recency.
 */
import type { CourseSummary } from "@/lib/identity";
import type { GalaxyCourse } from "./layout";

export interface CourseStatsLike {
  reached: number;
  total: number;
}

export interface GalaxyCourseSources {
  /** Concept stats for a course, when its overview has loaded. */
  stats?: (courseId: string) => CourseStatsLike | null | undefined;
  /** Whether the course has a world to dive into; defaults to "has loaded stats with concepts". */
  hasWorld?: (courseId: string) => boolean;
  /** Epoch ms the course was last opened, from the active-course store. */
  lastOpenedAt?: (courseId: string) => number | null | undefined;
}

function finite(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** 0..1 from reached / total; 0 when unknown or empty. */
export function masteryFromStats(stats: CourseStatsLike | null | undefined): number {
  const total = finite(stats?.total);
  const reached = finite(stats?.reached);
  if (total === null || reached === null || total <= 0) return 0;
  return Math.min(1, Math.max(0, reached / total));
}

/** Bead size input: the concept count, or 1 while the stats are unknown. */
export function conceptCountFromStats(stats: CourseStatsLike | null | undefined): number {
  const total = finite(stats?.total);
  return total !== null && total > 0 ? Math.round(total) : 1;
}

export function galaxyCourseFromSummary(course: CourseSummary, sources: GalaxyCourseSources = {}): GalaxyCourse {
  const stats = sources.stats?.(course.id) ?? null;
  const code = course.code?.trim() || "";
  const hasWorld = sources.hasWorld ? sources.hasWorld(course.id) : conceptCountFromStats(stats) > 1;
  return {
    id: course.id,
    code: code || course.name,
    title: course.name,
    subject: null,
    conceptCount: conceptCountFromStats(stats),
    mastery: masteryFromStats(stats),
    hasWorld,
    archived: false,
    lastOpenedAt: sources.lastOpenedAt?.(course.id) ?? null,
  };
}

/** Every course in the identity's order (the layout sorts by size itself); duplicate ids keep the first. */
export function galaxyCoursesFromSummaries(courses: readonly CourseSummary[], sources: GalaxyCourseSources = {}): GalaxyCourse[] {
  const seen = new Set<string>();
  const out: GalaxyCourse[] = [];
  for (const c of courses) {
    if (!c.id || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(galaxyCourseFromSummary(c, sources));
  }
  return out;
}

/** The short label a bead shows on hover: the code, else the name. */
export function beadLabel(course: Pick<GalaxyCourse, "code" | "title">): string {
  return course.code.trim() || course.title.trim();
}
