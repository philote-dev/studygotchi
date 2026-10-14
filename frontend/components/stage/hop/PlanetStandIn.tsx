"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCourseOverviewCache } from "@/components/earth/useCourseOverviewCache";
import { PlanetLayer } from "@/components/stage/layers/PlanetLayer";
import { useStageSlots } from "@/components/stage/StageSlots";
import type { GlobeSpinApi } from "@/components/world/globe/CourseGlobeScene";
import { useIdentity } from "@/lib/identity";
import { useSpaceTheme } from "@/lib/space-theme";
import { useActiveCourse } from "@/lib/stage/active-course";
import { toGlobeCourses, withEarthCourses } from "@/lib/world/globe-courses";
import { useReducedMotion } from "@/components/shell/useSpaceAttribute";

/**
 * The hop keeps the planet layer alive across routes through the sticky slot,
 * but a cold load of /knowledge has no earth page to slot it in the first
 * place: Courses would then mount (and compile) the globe mid-hop. This
 * stand-in slots a planet layer with the identity's courses and no-op
 * callbacks when nothing else has, so the globe exists (as the centred point
 * at L 2) and is compiled before any hop. The earth page's own layer replaces
 * it as soon as it mounts (same component, no remount).
 */
export function PlanetStandIn() {
  const slots = useStageSlots();
  const identity = useIdentity();
  const { resolved: theme } = useSpaceTheme();
  const reducedMotion = useReducedMotion();
  const active = useActiveCourse();
  const spinApi = useRef<GlobeSpinApi | null>(null);
  const summaries = useMemo(() => withEarthCourses(identity.courses), [identity.courses]);
  const overview = useCourseOverviewCache(identity.studentId, summaries);
  useEffect(() => {
    for (const course of summaries) void overview.load(course.id);
  }, [summaries, overview.load]);
  // The same course records the earth page gives the globe (stats drive the landmark rings), so
  // the earth page's layer changes nothing the globe has not already compiled.
  const courses = useMemo(
    () =>
      toGlobeCourses(summaries).map((course) => {
        const record = overview.records.get(course.id);
        const stats = record?.status === "ready" ? record.data.stats : null;
        return { ...course, stats, progress: stats && stats.total > 0 ? stats.reached / stats.total : course.progress };
      }),
    [summaries, overview.records],
  );
  const activeCourseId = active.activeCourseId ?? (identity.courseId || courses[0]?.id || null);
  // A detached host: no pointer input reaches the stand-in; the pass draws in the whole canvas.
  const [host] = useState(() => (typeof document !== "undefined" ? document.createElement("div") : null));
  const [needed, setNeeded] = useState(false);

  // Only when no page has slotted the planet (checked after the pages' own effects ran).
  useEffect(() => {
    const check = () => setNeeded(slots.get("planet") === null);
    check();
    return slots.subscribe(check);
  }, [slots]);

  const element = useMemo(
    () =>
      host && courses.length > 0 ? (
        <PlanetLayer
          host={host}
          spinApi={spinApi}
          courses={courses}
          activeCourseId={activeCourseId}
          theme={theme}
          reducedMotion={reducedMotion}
          onActiveCourseChange={() => {}}
          onCourseTownOpen={() => {}}
          onPointerInteractionChange={() => {}}
        />
      ) : null,
    [host, courses, activeCourseId, theme, reducedMotion],
  );

  useEffect(() => {
    if (!needed || !element) return;
    if (slots.get("planet") === null) slots.set("planet", element);
  }, [needed, element, slots]);

  return null;
}
