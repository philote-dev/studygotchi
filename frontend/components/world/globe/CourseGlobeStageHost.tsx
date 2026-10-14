"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHop } from "@/components/stage/hop/HopProvider";
import { PlanetLayer } from "@/components/stage/layers/PlanetLayer";
import { useStageSlot } from "@/components/stage/StageSlots";
import type { GlobeSpinApi } from "./CourseGlobeScene";
import type { CourseGlobeHostProps } from "./globe-types";
import { useGlobeInput } from "./useGlobeInput";
import "./globe.css";

/**
 * The globe as a layer of the persistent stage (S2-2; the only globe path
 * since gate 1, 2026-10-13). The page renders the `.course-globe-stage` host
 * div, with the cold-load arrival the CSS keys off, and the wheel, keyboard
 * and pointer input on it; the scene itself is handed to the stage canvas
 * through the `planet` slot, where the stage composer draws it inside this
 * host's box at the stage grain. Every other motion of the globe (the
 * pull-back, the cloud dive and rise) is the stage camera's
 * (`PlanetPullback`), never CSS.
 */
export default function CourseGlobeStageHost({
  courses,
  activeCourseId,
  theme,
  arriving,
  reducedMotion,
  onActiveCourseChange,
  onCourseTownOpen,
  onLandmarkAnchor,
  onHoverCourse,
}: CourseGlobeHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const attachHost = useCallback((el: HTMLDivElement | null) => {
    hostRef.current = el;
    setHost(el);
  }, []);
  const spinApi = useRef<GlobeSpinApi | null>(null);
  const [arriveReady, setArriveReady] = useState(false);
  const hop = useHop();
  // The host's CSS slide only plays on a cold load, when the director already rests at the seat;
  // arriving by a hop (Courses, the rise) the globe is placed by the stage camera instead.
  const [hopAway] = useState(() => hop.director.sample().moving || hop.director.sample().rung !== "planet");
  const courseIds = useMemo(() => courses.map((course) => course.id), [courses]);
  const { onPointerInteractionChange } = useGlobeInput(hostRef, spinApi, {
    courseIds,
    activeCourseId,
    onActiveCourseChange,
  });

  useEffect(() => {
    if (!arriving) {
      setArriveReady(false);
      return;
    }
    const timer = window.setTimeout(() => setArriveReady(true), 0);
    return () => window.clearTimeout(timer);
  }, [arriving]);

  useStageSlot(
    "planet",
    host ? (
      <PlanetLayer
        host={host}
        spinApi={spinApi}
        courses={courses}
        activeCourseId={activeCourseId}
        theme={theme}
        reducedMotion={reducedMotion}
        onActiveCourseChange={onActiveCourseChange}
        onCourseTownOpen={onCourseTownOpen}
        onLandmarkAnchor={onLandmarkAnchor}
        onHoverCourse={onHoverCourse}
        onPointerInteractionChange={onPointerInteractionChange}
      />
    ) : null,
  );

  return (
    <div
      ref={attachHost}
      className="course-globe-stage"
      data-arriving={arriving && arriveReady && !hopAway}
      data-reduced-motion={reducedMotion}
      data-theme={theme}
      style={{ position: "absolute", inset: 0 }}
    />
  );
}
