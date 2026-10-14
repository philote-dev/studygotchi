"use client";

import { useCallback, useEffect, useMemo, useRef, useState, ViewTransition } from "react";
import { useSearchParams } from "next/navigation";
import { api, type WorldEvent } from "@/lib/api";
import { emit } from "@/lib/audio/events";
import { selectCourse, useIdentity } from "@/lib/identity";
import { useStore } from "@/lib/store";
import { useHop } from "@/components/stage/hop/HopProvider";
import type { WorldRegion, WorldResponse } from "@/lib/world/types";
import { CourseGlobe } from "@/components/world/globe/CourseGlobe";
import { visualForGlobeBiome } from "@/components/world/biomes/types";
import { biomeForGlobeCourse, isOwnedCourse, rosterBiome, toGlobeCourses, withEarthCourses } from "@/lib/world/globe-courses";
import { DEMO_HERO_CODE } from "@/lib/world/demo-courses";
import { prefetchLand } from "@/lib/world/land-prefetch";
import { isConceptId, landParamFromSearch, resolveLandCourseId } from "@/lib/world/earth-nav";
import { BiomeLand } from "./BiomeLand";
import { ConceptCard } from "./ConceptCard";
import { ConceptRail } from "./ConceptRail";
import { CourseNavigator } from "./CourseNavigator";
import { LandmarkFlag } from "./LandmarkFlag";
import { useCourseOverviewCache } from "./useCourseOverviewCache";
import "./earth-integration.css";

/**
 * The product page. Level 1: the globe with one pin per course. Level 2: the
 * course's island on the right and an interactive panel on the left. Hovering
 * the island shows a marker; clicking moves the concept into the panel.
 *
 * Every move between the two levels is the stage's (gate 4, 2026-10-13): a
 * landmark click or the flag's Land button runs the cloud dive
 * (`hop.land`), which pushes `/earth?land=` at the press so the land mounts
 * and compiles under the deck, and "The planet", Escape and the Courses pill
 * run the rise (`hop.courses`), whose route follows once the clouds have
 * closed over the land. This page only mirrors the route into its state.
 */
export function EarthShell() {
  const { selectedId, select, ingestVersion, focusConcept } = useStore();
  const identity = useIdentity();
  const searchParams = useSearchParams();
  const hop = useHop();
  const [activeCourseId, setActiveCourseId] = useState<string | null>(
    () => identity.courseId || identity.courses[0]?.id || null,
  );
  const [enteredCourseId, setEnteredCourseId] = useState<string | null>(() =>
    resolveLandCourseId(landParamFromSearch(searchParams), withEarthCourses(identity.courses)),
  );
  const [world, setWorld] = useState<WorldResponse | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [focusDistrict, setFocusDistrict] = useState<string | null>(null);

  const courses = useMemo(() => withEarthCourses(identity.courses), [identity.courses]);
  const landCourseId = resolveLandCourseId(landParamFromSearch(searchParams), courses);
  const entered = enteredCourseId !== null;
  const enteredRef = useRef(enteredCourseId);
  enteredRef.current = enteredCourseId;
  const overviewCache = useCourseOverviewCache(identity.studentId, courses);
  const globeCourses = useMemo(
    () =>
      toGlobeCourses(courses).map((course) => {
        const record = overviewCache.records.get(course.id);
        const stats = record?.status === "ready" ? record.data.stats : null;
        return {
          ...course,
          stats,
          progress:
            stats && stats.total > 0
              ? stats.reached / stats.total
              : course.progress,
        };
      }),
    [courses, overviewCache.records],
  );
  const enteredCourse =
    globeCourses.find((course) => course.id === enteredCourseId) ?? null;
  const current =
    enteredCourse ??
    courses.find((course) => course.id === enteredCourseId) ??
    null;

  // The globe is the world's front door: the director knows we are here, and music starts the
  // moment a gesture unlocks the context.
  useEffect(() => {
    emit({ type: "enter-world" });
    return () => emit({ type: "leave-world" });
  }, []);

  useEffect(() => {
    if (courses.length === 0) {
      setActiveCourseId(null);
      return;
    }
    setActiveCourseId((active) => {
      if (active && isOwnedCourse(active, courses)) return active;
      if (identity.courseId && isOwnedCourse(identity.courseId, courses)) {
        return identity.courseId;
      }
      return courses[0].id;
    });
  }, [courses, identity.courseId]);

  useEffect(() => {
    for (const course of courses) void overviewCache.load(course.id);
  }, [courses, overviewCache.load]);

  // Warm a land before the dive: its code chunk and its world payload, on landmark hover and settle.
  const warmLand = useCallback(
    (courseId: string | null) => {
      if (!courseId) return;
      const biome = globeCourses.find((course) => course.id === courseId)?.biome ?? biomeForGlobeCourse(courseId, courses.find((course) => course.id === courseId)?.code);
      prefetchLand(courseId, visualForGlobeBiome(biome), () => api.getWorldForCourse(courseId));
    },
    [courses, globeCourses],
  );

  const focusCourse = useCallback(
    (courseId: string) => {
      if (!isOwnedCourse(courseId, courses) && !courses.some((course) => course.id === courseId)) {
        return;
      }
      setActiveCourseId(courseId);
      void overviewCache.load(courseId);
      warmLand(courseId);
    },
    [courses, overviewCache.load, warmLand],
  );

  /** The cloud dive into a course's world: one director request, the land's route pushed at the press. */
  const enterCourse = useCallback(
    (courseId: string) => {
      const onGlobe = globeCourses.some((course) => course.id === courseId);
      if (!onGlobe || enteredCourseId || hop.runtime.flight?.to === "world") return;
      if (isOwnedCourse(courseId, courses)) {
        focusCourse(courseId);
        selectCourse(courseId);
      } else {
        setActiveCourseId(courseId);
      }
      select(null);
      const course = globeCourses.find((entry) => entry.id === courseId) ?? null;
      warmLand(courseId);
      if (!hop.land(courseId, course?.code ?? courseId)) return;
      emit({
        type: "enter-island",
        biome: course?.biome ? rosterBiome(course.biome) : null,
        arrival: "dive",
      });
    },
    [courses, enteredCourseId, focusCourse, globeCourses, hop, select, warmLand],
  );

  const land = useCallback(
    (courseId?: string) => {
      const target = courseId ?? activeCourseId;
      if (!target) return;
      enterCourse(target);
    },
    [activeCourseId, enterCourse],
  );

  /** The rise back to the planet, settling on the land's landmark (Courses' rule from the world). */
  const leave = useCallback(() => {
    select(null);
    if (!hop.courses()) return;
    emit({ type: "leave-island" });
  }, [hop, select]);

  // The route is the land's state: `?land=` opens it (the dive pushed it at the press; a reload or a
  // cold link lands directly), its absence closes it (the rise's route follows the clouds).
  useEffect(() => {
    if (!landCourseId) {
      if (enteredRef.current) {
        // The globe settles on the landmark the land was risen from (S4-3).
        if (courses.some((course) => course.id === enteredRef.current)) setActiveCourseId(enteredRef.current);
      }
      setEnteredCourseId(null);
      setWorld(null);
      setHovered(null);
      setFocusDistrict(null);
      return;
    }
    setEnteredCourseId(landCourseId);
    setFocusDistrict(null);
    if (isOwnedCourse(landCourseId, courses)) selectCourse(landCourseId);
  }, [courses, landCourseId]);

  // The dive announces its island inside the click (so the whoosh can play). A cold `?land=`
  // load or a reload never dives, so announce it here too, silently. Re-announcing the same
  // land is a no-op for the director, so this also covers the roster resolving the biome late
  // and dev StrictMode replaying the mount effect's `enter-world` after us.
  useEffect(() => {
    if (!enteredCourseId) return;
    const biome = globeCourses.find((course) => course.id === enteredCourseId)?.biome ?? null;
    emit({ type: "enter-island", biome: biome ? rosterBiome(biome) : null, arrival: "direct" });
  }, [enteredCourseId, globeCourses]);

  // What changed since the page opened, newest first. Polled after every ingest.
  useEffect(() => {
    if (!entered || !identity.ready) return;
    let cancelled = false;
    api
      .getWorldEvents(undefined, 12)
      .then((list) => {
        if (!cancelled) setEvents(list);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [entered, ingestVersion, identity.studentId, identity.courseId]);

  const regionById = useMemo(() => new Map((world?.regions ?? []).map((r) => [r.concept_id, r])), [world]);
  const selectedRegion: WorldRegion | null = selectedId ? (regionById.get(selectedId) ?? null) : null;

  // The concept card sliding in and out is the panel's own sound, whatever opened it.
  const cardOpen = !!selectedRegion;
  const cardWasOpen = useRef(false);
  useEffect(() => {
    if (cardOpen !== cardWasOpen.current) {
      cardWasOpen.current = cardOpen;
      emit({ type: "card", open: cardOpen });
    }
  }, [cardOpen]);

  // Every ingest that moved the student's state gets one slurp-and-ding; the island's own
  // sounds follow when the new payload lands.
  const lastIngest = useRef(ingestVersion);
  useEffect(() => {
    if (ingestVersion !== lastIngest.current) {
      lastIngest.current = ingestVersion;
      emit({ type: "evidence-ingested" });
      if (enteredCourseId) overviewCache.invalidate(enteredCourseId);
    }
  }, [enteredCourseId, ingestVersion, overviewCache.invalidate]);

  const iceLandOpen =
    entered &&
    (enteredCourse?.code === DEMO_HERO_CODE || current?.code === DEMO_HERO_CODE) &&
    (enteredCourse?.biome ?? biomeForGlobeCourse(enteredCourseId ?? "", current?.code)) === "ice";

  return (
    <div className="earth-page is-earth">
      <div className="earth-stage">
        {entered && enteredCourseId ? (
          <BiomeLand
            key={enteredCourseId}
            courseId={enteredCourseId}
            biome={
              enteredCourse?.biome ??
              biomeForGlobeCourse(enteredCourseId, current?.code)
            }
            focusDistrict={focusDistrict}
            onFocusDistrict={setFocusDistrict}
            onWorld={setWorld}
            hoveredId={hovered}
            onHover={setHovered}
          />
        ) : (
          <ViewTransition name="studygotchi-earth" share="earth-morph" default="none">
            <div className="course-globe-overview">
              <CourseGlobe
                courses={globeCourses}
                activeCourseId={activeCourseId}
                onActiveCourseChange={focusCourse}
                onHoverCourse={warmLand}
                onCourseTownOpen={(courseId) => enterCourse(courseId)}
              />
            </div>
          </ViewTransition>
        )}
      </div>

      {!entered ? (
        <div className="earth-planet-chrome">
          <CourseNavigator
            courses={courses}
            activeCourseId={activeCourseId}
            records={overviewCache.records}
            onFocusCourse={focusCourse}
          />
          {activeCourseId ? (
            <LandmarkFlag
              course={
                globeCourses.find((course) => course.id === activeCourseId) ?? {
                  id: activeCourseId,
                  code: courses.find((course) => course.id === activeCourseId)?.code ?? null,
                  name: courses.find((course) => course.id === activeCourseId)?.name ?? "Course",
                  biome: biomeForGlobeCourse(
                    activeCourseId,
                    courses.find((course) => course.id === activeCourseId)?.code,
                  ),
                  progress: null,
                  stats: null,
                }
              }
              record={overviewCache.records.get(activeCourseId)}
              onLand={() => land(activeCourseId)}
              onWarm={() => warmLand(activeCourseId)}
            />
          ) : null}
        </div>
      ) : selectedRegion ? (
        <aside className="earth-panel" aria-label="Place">
          <ConceptCard region={selectedRegion} onClose={() => select(null)} />
        </aside>
      ) : (
        <ConceptRail
          courseCode={current?.code ?? identity.courseName}
          world={world}
          overview={
            enteredCourseId
              ? overviewCache.records.get(enteredCourseId)?.status === "ready"
                ? overviewCache.records.get(enteredCourseId)?.data ?? null
                : null
              : null
          }
          events={events}
          activeConceptId={selectedId}
          activePlaceId={focusDistrict}
          iceLand={iceLandOpen}
          // "The planet" is the Courses rule: the rise to the planet, the land's page following under the clouds.
          onLeave={leave}
          // A concept from the rail: the merged rise into the constellation, focused on it.
          onSelectConcept={(conceptId) => {
            emit({ type: "ui", kind: "tap" });
            if (isConceptId(conceptId)) focusConcept(conceptId);
            hop.information();
          }}
          onVisitPlace={(placeId) => {
            emit({ type: "ui", kind: "tap" });
            setFocusDistrict(placeId);
          }}
        />
      )}

    </div>
  );
}
