"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { emit } from "@/lib/audio/events";
import { useSpaceTheme } from "@/lib/space-theme";
import type { CourseGlobeCourse, ScreenPoint } from "./globe-types";

/**
 * The globe, drawn by the persistent stage canvas (S2-2, the only globe path
 * since gate 1 on 2026-10-13 retired its own `<Canvas>`): the page renders the
 * input host and slots the scene into the stage.
 */
const CourseGlobeStageHost = dynamic(() => import("./CourseGlobeStageHost"), { ssr: false });

export interface CourseGlobeProps {
  courses: CourseGlobeCourse[];
  activeCourseId?: string | null;
  onSelect?: (courseId: string) => void;
  onActiveCourseChange?: (courseId: string) => void;
  onCourseTownOpen?: (courseId: string, anchor: ScreenPoint) => void;
  onLandmarkAnchor?: (anchor: ScreenPoint | null) => void;
  /** The landmark under the pointer (null when none): the page prefetches that course's land. */
  onHoverCourse?: (courseId: string | null) => void;
  /** The page's cold-load entrance; false when the planet arrives by the stage camera. */
  arriving?: boolean;
  decorative?: boolean;
  playMusic?: boolean;
  className?: string;
}

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncReducedMotion = () => setReducedMotion(media.matches);
    syncReducedMotion();
    media.addEventListener("change", syncReducedMotion);
    return () => media.removeEventListener("change", syncReducedMotion);
  }, []);

  return reducedMotion;
}

export function CourseGlobe({
  courses,
  activeCourseId = null,
  onSelect,
  onActiveCourseChange,
  onCourseTownOpen,
  onLandmarkAnchor,
  onHoverCourse,
  arriving = true,
  decorative = false,
  playMusic = false,
  className,
}: CourseGlobeProps) {
  const { resolved: theme } = useSpaceTheme();
  const reducedMotion = useReducedMotion();
  const [focusedId, setFocusedId] = useState<string | null>(
    activeCourseId ?? courses[0]?.id ?? null,
  );

  useEffect(() => {
    if (activeCourseId) setFocusedId(activeCourseId);
  }, [activeCourseId]);

  useEffect(() => {
    if (!playMusic) return;
    emit({ type: "enter-world" });
    return () => emit({ type: "leave-world" });
  }, [playMusic]);

  const globe = (
    <CourseGlobeStageHost
      courses={courses}
      activeCourseId={focusedId}
      theme={theme}
      arriving={arriving}
      reducedMotion={reducedMotion}
      onActiveCourseChange={(courseId) => {
        setFocusedId(courseId);
        onActiveCourseChange?.(courseId);
      }}
      onCourseTownOpen={(courseId, anchor) => {
        if (decorative) return;
        if (onCourseTownOpen) {
          onCourseTownOpen(courseId, anchor);
          return;
        }
        onSelect?.(courseId);
      }}
      onLandmarkAnchor={decorative ? undefined : onLandmarkAnchor}
      onHoverCourse={decorative ? undefined : onHoverCourse}
    />
  );

  return className ? <div className={className}>{globe}</div> : globe;
}
