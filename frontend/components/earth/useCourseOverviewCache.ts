"use client";

import { useMemo, useSyncExternalStore } from "react";
import { api, mockWorldForCourse } from "@/lib/api";
import { isSandboxCatalogId } from "@/lib/world/sandbox-courses";
import { ingestionResourcesForCourse } from "@/lib/world/sandbox-roster";
import type { CourseSummary } from "@/lib/identity";
import {
  buildCourseOverview,
  type CourseOverview,
} from "@/lib/world/course-overview";

export type CourseOverviewCacheRecord =
  | { status: "idle"; data?: never; error?: never }
  | { status: "loading"; data?: never; error?: never }
  | { status: "ready"; data: CourseOverview; error?: never }
  | { status: "error"; data?: never; error: string };

export type CourseOverviewCacheState = Map<
  string,
  CourseOverviewCacheRecord
>;

export interface CourseOverviewCacheResult {
  studentId: string;
  records: CourseOverviewCacheState;
  load(courseId: string): Promise<void>;
  invalidate(courseId: string): void;
}

type CourseOverviewLoader = (
  studentId: string,
  courseId: string,
) => Promise<CourseOverview>;

interface CourseOverviewCache extends CourseOverviewCacheResult {
  getSnapshot(): CourseOverviewCacheState;
  subscribe(listener: () => void): () => void;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Could not load this course.";
}

export function createCourseOverviewCache(
  studentId: string,
  loader: CourseOverviewLoader,
): CourseOverviewCache {
  let records: CourseOverviewCacheState = new Map();
  const inFlight = new Map<string, Promise<void>>();
  const generations = new Map<string, number>();
  const listeners = new Set<() => void>();

  const publish = (
    courseId: string,
    record: CourseOverviewCacheRecord,
  ) => {
    records = new Map(records);
    records.set(courseId, record);
    listeners.forEach((listener) => listener());
  };

  const cache: CourseOverviewCache = {
    studentId,

    get records() {
      return records;
    },

    getSnapshot: () => records,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    load(courseId) {
      if (records.get(courseId)?.status === "ready") {
        return Promise.resolve();
      }

      const pending = inFlight.get(courseId);
      if (pending) return pending;

      const generation = generations.get(courseId) ?? 0;
      publish(courseId, { status: "loading" });

      let loaded: Promise<CourseOverview>;
      try {
        loaded = loader(studentId, courseId);
      } catch (error) {
        loaded = Promise.reject(error);
      }

      const request = loaded
        .then((data) => {
          if ((generations.get(courseId) ?? 0) === generation) {
            publish(courseId, { status: "ready", data });
          }
        })
        .catch((error: unknown) => {
          if ((generations.get(courseId) ?? 0) === generation) {
            publish(courseId, {
              status: "error",
              error: errorMessage(error),
            });
          }
        })
        .finally(() => {
          if (inFlight.get(courseId) === request) {
            inFlight.delete(courseId);
          }
        });

      inFlight.set(courseId, request);
      return request;
    },

    invalidate(courseId) {
      generations.set(courseId, (generations.get(courseId) ?? 0) + 1);
      inFlight.delete(courseId);
      publish(courseId, { status: "idle" });
    },
  };

  return cache;
}

/**
 * One cache per student, shared by every hook instance (the earth page, the
 * stage's planet stand-in, the galaxy rung). A per-instance cache made the
 * earth page rebuild every course overview (the sandbox worlds are generated
 * synchronously) on each mount, ~75 ms of timers landing on one frame while
 * the stage was still moving (S4-2 stall diagnosis); the records are the same
 * for every reader. The loader reads the course list the latest render gave.
 */
const SHARED_CACHES = new Map<string, { cache: CourseOverviewCache; courses: { current: readonly CourseSummary[] } }>();

function sharedCache(studentId: string): { cache: CourseOverviewCache; courses: { current: readonly CourseSummary[] } } {
  let entry = SHARED_CACHES.get(studentId);
  if (entry) return entry;
  const courses = { current: [] as readonly CourseSummary[] };
  const cache = createCourseOverviewCache(studentId, async (_studentId, courseId) => {
    const course = courses.current.find((candidate) => candidate.id === courseId);
    if (!course) throw new Error("This course is no longer available.");

    const ingested = ingestionResourcesForCourse(courseId);
    if (isSandboxCatalogId(courseId)) {
      return buildCourseOverview(course, mockWorldForCourse(courseId), ingested);
    }
    const [world, resources] = await Promise.all([
      api.getWorldForCourse(courseId),
      api.listResourcesForCourse(courseId).catch(() => []),
    ]);
    const merged = resources.length > 0 ? resources : ingested;
    return buildCourseOverview(course, world, merged);
  });
  entry = { cache, courses };
  SHARED_CACHES.set(studentId, entry);
  return entry;
}

/** Tests: forget every shared cache. */
export function resetCourseOverviewCaches(): void {
  SHARED_CACHES.clear();
}

export function useCourseOverviewCache(
  studentId: string,
  courses: readonly CourseSummary[],
): CourseOverviewCacheResult {
  const entry = sharedCache(studentId);
  entry.courses.current = courses;
  const cache = entry.cache;
  const records = useSyncExternalStore(
    cache.subscribe,
    cache.getSnapshot,
    cache.getSnapshot,
  );

  return useMemo(
    () => ({
      studentId: cache.studentId,
      records,
      load: cache.load,
      invalidate: cache.invalidate,
    }),
    [cache, records],
  );
}
