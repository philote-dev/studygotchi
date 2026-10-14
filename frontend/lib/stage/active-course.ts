/**
 * Which course the stage is "on", across rungs.
 *
 * The planet keeps its settled course in `EarthShell` state and the identity
 * store keeps the course the knowledge page shows; neither reaches the stage
 * canvas, which lives above both pages. This small external store is the
 * bridge: the earth code can `setActiveCourse` when the globe settles (not
 * wired yet), every entry into a course calls `markCourseOpened`, and the
 * galaxy rung reads `activeCourseId` -> the most recently opened course as
 * the bead that carries the "you are here" ring. Courses from the galaxy
 * lands the planet on `mostRecentCourse()` (Philote, 2026-10-11).
 *
 * Recency persists in localStorage (`sg.stage.recent-courses`, id -> epoch
 * ms) so a reload keeps the same bead current; the active course does not
 * (the planet re-settles on load). Pure except for that storage access,
 * which is guarded: tests run it in node with an injected storage.
 */
import { useSyncExternalStore } from "react";

export const RECENT_COURSES_KEY = "sg.stage.recent-courses";
/** Recency entries kept (the newest win). */
export const RECENT_COURSES_LIMIT = 24;

export interface ActiveCourseState {
  /** The planet's settled / active course, set by the earth code; null until it reports. */
  activeCourseId: string | null;
  /** Course id -> last opened, epoch ms. */
  openedAt: Readonly<Record<string, number>>;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

let state: ActiveCourseState = { activeCourseId: null, openedAt: {} };
let loaded = false;
let storageOverride: StorageLike | null | undefined;
const listeners = new Set<() => void>();

function storage(): StorageLike | null {
  if (storageOverride !== undefined) return storageOverride;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function parseRecent(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === "number" && Number.isFinite(at) && id) out[id] = at;
    }
    return out;
  } catch {
    return {};
  }
}

function load(): void {
  if (loaded) return;
  loaded = true;
  const s = storage();
  if (!s) return;
  try {
    state = { ...state, openedAt: parseRecent(s.getItem(RECENT_COURSES_KEY)) };
  } catch {
    // Privacy modes can throw; start empty.
  }
}

function persist(): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(RECENT_COURSES_KEY, JSON.stringify(state.openedAt));
  } catch {
    // Quota or privacy mode: the in-memory copy still works for this session.
  }
}

function publish(next: ActiveCourseState): void {
  state = next;
  for (const fn of listeners) fn();
}

/** Keep only the newest `limit` entries. */
export function trimRecent(openedAt: Readonly<Record<string, number>>, limit = RECENT_COURSES_LIMIT): Record<string, number> {
  const entries = Object.entries(openedAt).sort((a, b) => b[1] - a[1]).slice(0, limit);
  return Object.fromEntries(entries);
}

export function getActiveCourseState(): ActiveCourseState {
  load();
  return state;
}

export function subscribeActiveCourse(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The planet's settled course (the earth code reports it; null until then). */
export function setActiveCourse(courseId: string | null): void {
  load();
  if (state.activeCourseId === courseId) return;
  publish({ ...state, activeCourseId: courseId });
}

/** A course was opened (bead click, landing, constellation): it becomes the most recent one. */
export function markCourseOpened(courseId: string, at: number = Date.now()): void {
  load();
  const id = courseId.trim();
  if (!id) return;
  const openedAt = trimRecent({ ...state.openedAt, [id]: at });
  publish({ ...state, openedAt });
  persist();
}

export function lastOpenedAt(courseId: string): number | null {
  load();
  const at = state.openedAt[courseId];
  return typeof at === "number" ? at : null;
}

/** The most recently opened course among `among` (every known course when omitted); null when nothing was opened. */
export function mostRecentCourse(among?: readonly string[]): string | null {
  load();
  let best: string | null = null;
  let bestAt = -Infinity;
  for (const [id, at] of Object.entries(state.openedAt)) {
    if (among && !among.includes(id)) continue;
    if (at > bestAt) {
      bestAt = at;
      best = id;
    }
  }
  return best;
}

/**
 * The course the galaxy's ring should sit on: the planet's active course when
 * it is one of `courses`, else the most recently opened one of them, else the
 * caller's fallback (the identity's course), else null.
 */
export function resolveCurrentCourse(courses: readonly string[], fallback: string | null = null): string | null {
  load();
  if (state.activeCourseId && courses.includes(state.activeCourseId)) return state.activeCourseId;
  const recent = mostRecentCourse(courses);
  if (recent) return recent;
  if (fallback && courses.includes(fallback)) return fallback;
  return null;
}

export function useActiveCourse(): ActiveCourseState {
  return useSyncExternalStore(subscribeActiveCourse, getActiveCourseState, getActiveCourseState);
}

/** Tests: swap the storage (null = none) and clear the state. */
export function resetActiveCourseStore(storageForTests?: StorageLike | null): void {
  storageOverride = storageForTests;
  state = { activeCourseId: null, openedAt: {} };
  loaded = false;
}
