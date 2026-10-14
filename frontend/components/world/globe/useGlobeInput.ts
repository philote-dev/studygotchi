"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { GlobeSpinApi } from "./CourseGlobeScene";
import {
  adjacentCourseId,
  createSettleScheduler,
  isInteractiveKeyboardTarget,
  keyboardNavigationStep,
  normalizeWheelSpin,
} from "./globe-input";

export interface GlobeInputOptions {
  courseIds: readonly string[];
  activeCourseId: string | null;
  onActiveCourseChange(courseId: string): void;
}

/**
 * The globe's wheel, keyboard and settle logic, shared by the globe's own
 * canvas and the stage's planet host: trackpad travel spins the globe and
 * schedules a settle onto the facing course once the wheel goes idle (unless
 * a drag is in progress), arrow / WASD keys step through the courses.
 */
export function useGlobeInput(hostRef: RefObject<HTMLElement | null>, spinApi: RefObject<GlobeSpinApi | null>, { courseIds, activeCourseId, onActiveCourseChange }: GlobeInputOptions) {
  const pointerInteractingRef = useRef(false);
  const settleSchedulerRef = useRef<ReturnType<typeof createSettleScheduler> | null>(null);

  const onPointerInteractionChange = useCallback((pointerInteracting: boolean) => {
    pointerInteractingRef.current = pointerInteracting;
    if (pointerInteracting) settleSchedulerRef.current?.cancel();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const settleScheduler = createSettleScheduler(
      () => {
        spinApi.current?.settle();
      },
      () => !pointerInteractingRef.current,
    );
    settleSchedulerRef.current = settleScheduler;
    const handleWheel = (event: WheelEvent) => {
      if (!spinApi.current) return;
      event.preventDefault();
      const [horizontal, vertical] = normalizeWheelSpin(event.deltaX, event.deltaY);
      spinApi.current.spin(horizontal, vertical);
      settleScheduler.schedule();
    };

    host.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      host.removeEventListener("wheel", handleWheel);
      settleScheduler.cancel();
      if (settleSchedulerRef.current === settleScheduler) {
        settleSchedulerRef.current = null;
      }
    };
  }, [hostRef, spinApi]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const step = keyboardNavigationStep({
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        interactiveTarget: isInteractiveKeyboardTarget(event.target),
      });
      if (step === null) return;
      settleSchedulerRef.current?.cancel();

      const destination = adjacentCourseId(courseIds, activeCourseId, step);
      if (!destination || destination === activeCourseId) return;
      event.preventDefault();
      onActiveCourseChange(destination);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeCourseId, courseIds, onActiveCourseChange]);

  return { onPointerInteractionChange };
}
