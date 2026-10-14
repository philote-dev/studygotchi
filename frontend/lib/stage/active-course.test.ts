import { beforeEach, describe, expect, it } from "vitest";
import {
  getActiveCourseState,
  lastOpenedAt,
  markCourseOpened,
  mostRecentCourse,
  RECENT_COURSES_KEY,
  RECENT_COURSES_LIMIT,
  resetActiveCourseStore,
  resolveCurrentCourse,
  setActiveCourse,
  subscribeActiveCourse,
  trimRecent,
} from "./active-course";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

describe("active-course store", () => {
  beforeEach(() => resetActiveCourseStore(null));

  it("starts empty and resolves the fallback only when it is one of the courses", () => {
    expect(getActiveCourseState()).toEqual({ activeCourseId: null, openedAt: {} });
    expect(mostRecentCourse()).toBeNull();
    expect(resolveCurrentCourse(["a", "b"], "b")).toBe("b");
    expect(resolveCurrentCourse(["a", "b"], "zzz")).toBeNull();
    expect(resolveCurrentCourse([], "a")).toBeNull();
  });

  it("the planet's active course wins, then the most recent opened course, then the fallback", () => {
    markCourseOpened("a", 100);
    markCourseOpened("b", 200);
    expect(mostRecentCourse()).toBe("b");
    expect(mostRecentCourse(["a"])).toBe("a");
    expect(resolveCurrentCourse(["a", "b"], "a")).toBe("b");
    setActiveCourse("a");
    expect(resolveCurrentCourse(["a", "b"], "b")).toBe("a");
    // An active course the student no longer has falls through to recency.
    setActiveCourse("gone");
    expect(resolveCurrentCourse(["a", "b"], "a")).toBe("b");
    expect(lastOpenedAt("a")).toBe(100);
    expect(lastOpenedAt("nope")).toBeNull();
  });

  it("notifies subscribers once per change and ignores no-ops", () => {
    let n = 0;
    const off = subscribeActiveCourse(() => n++);
    setActiveCourse("a");
    setActiveCourse("a");
    markCourseOpened("a", 5);
    markCourseOpened("  ", 6);
    expect(n).toBe(2);
    off();
    setActiveCourse("b");
    expect(n).toBe(2);
  });

  it("persists recency to storage and reads it back; the active course is per session", () => {
    const storage = memoryStorage();
    resetActiveCourseStore(storage);
    markCourseOpened("a", 1);
    setActiveCourse("a");
    expect(JSON.parse(storage.map.get(RECENT_COURSES_KEY)!)).toEqual({ a: 1 });
    resetActiveCourseStore(storage);
    expect(getActiveCourseState().openedAt).toEqual({ a: 1 });
    expect(getActiveCourseState().activeCourseId).toBeNull();
  });

  it("tolerates broken or hostile storage", () => {
    resetActiveCourseStore(memoryStorage({ [RECENT_COURSES_KEY]: "not json" }));
    expect(getActiveCourseState().openedAt).toEqual({});
    resetActiveCourseStore(memoryStorage({ [RECENT_COURSES_KEY]: JSON.stringify({ a: "x", b: 2, "": 3 }) }));
    expect(getActiveCourseState().openedAt).toEqual({ b: 2 });
    resetActiveCourseStore({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    markCourseOpened("a", 1);
    expect(mostRecentCourse()).toBe("a");
  });

  it("keeps only the newest entries", () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < RECENT_COURSES_LIMIT + 10; i++) many[`c${i}`] = i;
    const trimmed = trimRecent(many);
    expect(Object.keys(trimmed)).toHaveLength(RECENT_COURSES_LIMIT);
    expect(trimmed.c0).toBeUndefined();
    expect(trimmed[`c${RECENT_COURSES_LIMIT + 9}`]).toBe(RECENT_COURSES_LIMIT + 9);
  });
});
