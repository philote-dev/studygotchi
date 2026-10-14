"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { qaEnabled } from "@/lib/graph/parity/dev-api";
import { constellationBridge } from "@/lib/graph/twin/bridge";
import { useIdentity } from "@/lib/identity";
import { getActiveCourseState, mostRecentCourse } from "@/lib/stage/active-course";
import type { StageDirector } from "@/lib/stage/director";
import { onBeadClick, onCourses, onInformation, onLand, prefetchFor, type HopContext as HopRules, type HopPlan } from "@/lib/stage/hop";
import { RUNG_L, type Rung } from "@/lib/stage/rungs";
import { withEarthCourses } from "@/lib/world/globe-courses";
import type { HopRuntime } from "./hop-runtime";

export interface HopApi {
  runtime: HopRuntime;
  director: StageDirector;
  /** The Information pill: returns false when it does nothing (the galaxy). */
  information(): boolean;
  courses(): boolean;
  beadClick(courseId: string): boolean;
  /** A landmark click or the flag's Land button on the planet: the cloud dive into that course's world. */
  land(courseId: string, landKey?: string | null): boolean;
  /** Hovering Information: prefetch the next rung's route and warm its layout. */
  prefetchInformation(): void;
  /** What Information would do from here (null = inert pill). */
  informationTarget(): Rung | null;
}

export const HopContext = createContext<HopApi | null>(null);

/** The hop api (the product shell always provides it; permanent since 2026-10-13). */
export function useHop(): HopApi {
  const hop = useContext(HopContext);
  if (!hop) throw new Error("useHop outside ProductShell");
  return hop;
}

/** The rung the ladder reads from, re-rendering on every discrete hop change (start, hold, rest). */
export function useHopRung(): Rung {
  const hop = useHop();
  const subscribe = useCallback(
    (fn: () => void) => {
      const offRuntime = hop.runtime.subscribe(fn);
      const offRest = hop.director.onRest(fn);
      return () => {
        offRuntime();
        offRest();
      };
    },
    [hop],
  );
  const read = useCallback(() => {
    const s = hop.director.sample();
    return s.moving ? s.target : s.rung;
  }, [hop]);
  return useSyncExternalStore(subscribe, read, read);
}

/** Provides the hop api built on `runtime`. */
export function HopProvider({ runtime, children }: { runtime: HopRuntime; children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const identity = useIdentity();
  const latest = useRef({ pathname: pathname ?? "/", search: searchParams.toString(), identity });
  latest.current = { pathname: pathname ?? "/", search: searchParams.toString(), identity };

  const context = useCallback((): HopRules => {
    const { pathname: path, search, identity: id } = latest.current;
    const s = runtime.director.sample();
    const courses = withEarthCourses(id.courses).map((c) => c.id);
    const active = getActiveCourseState().activeCourseId;
    return {
      rung: s.moving ? s.target : s.rung,
      pathname: path,
      search: search ? `?${search}` : "",
      activeCourseId: active ?? (id.courseId || null),
      mostRecentCourseId: mostRecentCourse(courses),
      defaultCourseId: id.courseId || null,
      courseIds: courses,
    };
  }, [runtime]);

  const api = useMemo<HopApi>(() => {
    const run = (plan: HopPlan) => runtime.run(plan);
    return {
      runtime,
      director: runtime.director,
      information: () => run(onInformation(context())),
      courses: () => run(onCourses(context())),
      beadClick: (courseId) => run(onBeadClick(context(), courseId)),
      land: (courseId, landKey = null) => run(onLand(context(), courseId, landKey)),
      prefetchInformation: () => {
        for (const intent of prefetchFor(context().rung)) {
          if (intent.kind === "route") runtime.effects.prefetchRoute(intent.href);
          else if (intent.kind === "layout") runtime.effects.warmLayout();
          // The galaxy layer is mounted and compiled with the stage: nothing to warm.
        }
      },
      informationTarget: () => onInformation(context()).target,
    };
  }, [runtime, context]);

  // Escape mid-flight turns the hop around: back down with Courses' rule, back up with Information's
  // (a dive turns into the rise back to the planet).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const flight = api.runtime.flight;
      if (!flight || !api.director.sample().moving) return;
      const up = RUNG_L[flight.to] > RUNG_L[flight.from];
      const ran = flight.to === "world" ? api.courses() : up ? api.courses() : api.information();
      if (ran) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api]);

  // Capture / probe controller (development, or `?qa=1`): `window.__stageHop`.
  useEffect(() => {
    if (!qaEnabled(window.location.search, process.env.NODE_ENV)) return;
    const dev: StageHopDevApi = {
      sample: () => api.director.sample(),
      state: () => api.runtime.state,
      request: (rung) => api.director.request(rung),
      teleport: (rung) => api.director.teleport(rung),
      teleportTo: (L) => api.director.teleportTo(L),
      information: () => api.information(),
      courses: () => api.courses(),
      beadClick: (courseId) => api.beadClick(courseId),
      land: (courseId) => api.land(courseId),
      flight: () => api.runtime.flight,
      courseIds: () => withEarthCourses(latest.current.identity.courses).map((c) => c.id),
      layouts: () => ({ pending: [...constellationBridge.layouts.pending], defer: constellationBridge.layouts.defer, history: [...constellationBridge.layouts.history] }),
      programs: () => api.runtime.programs?.() ?? [],
      ready: (layer) => api.director.readiness.get(layer),
    };
    window.__stageHop = dev;
    return () => {
      if (window.__stageHop === dev) delete window.__stageHop;
    };
  }, [api]);

  return <HopContext.Provider value={api}>{children}</HopContext.Provider>;
}

export interface StageHopDevApi {
  sample(): ReturnType<StageDirector["sample"]>;
  state(): HopRuntime["state"];
  request(rung: Rung): void;
  teleport(rung: Rung): void;
  teleportTo(L: number): void;
  information(): boolean;
  courses(): boolean;
  beadClick(courseId: string): boolean;
  land(courseId: string): boolean;
  flight(): HopRuntime["flight"];
  courseIds(): string[];
  layouts(): { pending: string[]; defer: boolean; history: unknown[] };
  programs(): string[];
  ready(layer: Parameters<StageDirector["readiness"]["get"]>[0]): boolean;
}

declare global {
  interface Window {
    __stageHop?: StageHopDevApi;
  }
}
