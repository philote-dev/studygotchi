import type { BeadHit } from "./CourseBeads";
import { createFlagBus, type FlagBus, type FlagCourse } from "./CourseFlags";

/**
 * The thin channel between the galaxy rung's two halves: `GalaxyRungHost`
 * (DOM, outside the canvas: takes pointer events, shows the flags, owns the
 * navigation) and `GalaxyRung` (R3F, inside the canvas: picks the blob cores,
 * writes the hover uniform, projects every blob for the flags each frame).
 * Per-frame values are plain fields and the flag bus; only the discrete
 * hover / rest / active changes notify React (which cards are mounted).
 */
export interface GalaxyHover {
  courseId: string;
  code: string;
  title: string;
}

export interface GalaxyRungController {
  /** Latest pointer position in CSS px relative to the stage host; null when the pointer left. */
  pointer: { x: number; y: number } | null;
  /** True while the rung takes input (galaxy stop, fade > 0.5); the host mirrors it to `data-active`. */
  active: boolean;
  /** True while the director rests at the galaxy stop (the current course's flag stays up then). */
  resting: boolean;
  /** The pointer is over a flag card: its course stays hovered while the user reaches for "Open". */
  pinned: string | null;
  /**
   * The sticky flag's course (gate 3, 2026-10-13): the blob most recently hovered, kept after the
   * pointer leaves; null until something is hovered (the current course's flag shows then) and
   * reset when the rung goes inert, so a return shows the current course again.
   */
  sticky: string | null;
  /** Hit test at CSS px, bound by the R3F side while the layer is mounted. */
  pickAt: ((x: number, y: number) => BeadHit | null) | null;
  /** Every blob's screen footprint, published by the R3F side each frame; the flags re-solve from it. */
  readonly flags: FlagBus;
  /** The flag facts per course and the current course, written by the R3F side from its settled course list. */
  courses: readonly FlagCourse[];
  currentCourseId: string | null;
  /** Whether the current course's flag stays up while resting at the galaxy (the rung's `currentFlag` prop). */
  currentFlag: boolean;
  hover: GalaxyHover | null;
  setHover(hover: GalaxyHover | null): void;
  setActive(active: boolean): void;
  setResting(resting: boolean): void;
  setPinned(courseId: string | null): void;
  setSticky(courseId: string | null): void;
  setCourses(courses: readonly FlagCourse[], currentCourseId: string | null, currentFlag: boolean): void;
  subscribe(fn: () => void): () => void;
  /** Bumps on every hover / active / resting / pin / sticky change (external-store snapshot). */
  version(): number;
}

export function createGalaxyRungController(): GalaxyRungController {
  const listeners = new Set<() => void>();
  let version = 0;
  const notify = () => {
    version++;
    for (const fn of listeners) fn();
  };
  const controller: GalaxyRungController = {
    pointer: null,
    active: false,
    resting: false,
    pinned: null,
    sticky: null,
    pickAt: null,
    flags: createFlagBus(),
    courses: [],
    currentCourseId: null,
    currentFlag: true,
    hover: null,
    setHover(hover) {
      if (hover?.courseId === controller.hover?.courseId) return;
      controller.hover = hover;
      notify();
    },
    setActive(active) {
      if (active === controller.active) return;
      controller.active = active;
      if (!active) {
        controller.hover = null;
        controller.pinned = null;
        controller.sticky = null;
      }
      notify();
    },
    setResting(resting) {
      if (resting === controller.resting) return;
      controller.resting = resting;
      notify();
    },
    setPinned(courseId) {
      if (courseId === controller.pinned) return;
      controller.pinned = courseId;
      notify();
    },
    setSticky(courseId) {
      if (courseId === controller.sticky) return;
      controller.sticky = courseId;
      notify();
    },
    setCourses(courses, currentCourseId, currentFlag) {
      if (courses === controller.courses && currentCourseId === controller.currentCourseId && currentFlag === controller.currentFlag) return;
      controller.courses = courses;
      controller.currentCourseId = currentCourseId;
      controller.currentFlag = currentFlag;
      notify();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    version: () => version,
  };
  return controller;
}
