"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { createPortal, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CourseGlobeScene, type GlobeSpinApi } from "@/components/world/globe/CourseGlobeScene";
import type { CourseGlobeCourse, ScreenPoint, SpaceTheme } from "@/components/world/globe/globe-types";
import type { HostViewport, PlanetPass } from "../render/StageComposer";
import { useStage, useStageDirector, useStageSeed } from "../StageContext";
import { useHop } from "../hop/HopProvider";
import { PlanetPullback } from "./planet/PlanetPullback";
import { PlanetScenery } from "./planet/PlanetScenery";

export interface PlanetLayerProps {
  /** The page-side `.course-globe-stage` div: pointer input lands here and the pass is drawn inside its box. */
  host: HTMLElement;
  spinApi: RefObject<GlobeSpinApi | null>;
  courses: CourseGlobeCourse[];
  activeCourseId: string | null;
  theme: SpaceTheme;
  reducedMotion: boolean;
  onActiveCourseChange(courseId: string): void;
  onCourseTownOpen(courseId: string, anchor: ScreenPoint): void;
  onLandmarkAnchor?(anchor: ScreenPoint | null): void;
  onHoverCourse?(courseId: string | null): void;
  onPointerInteractionChange(interacting: boolean): void;
}

/** The globe's camera defaults (what its own canvas opened with before gate 1); `AutoFitCamera` seats it from here. */
const GLOBE_CAMERA = { fov: 26, near: 0.1, far: 80, position: [0, 4, 30] as const };

/**
 * Where the host sits on the stage canvas right now, with the opacity its CSS
 * chain composes; null while it is hidden. Read once per frame so the CSS
 * motions the host still runs (page slide-in, arrive / dive / rise, leave
 * phases) move the drawn layer in the same frame.
 */
export function readHostViewport(host: HTMLElement, canvas: HTMLElement, out: HostViewport): HostViewport | null {
  const rect = host.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const cr = canvas.getBoundingClientRect();
  if (!(cr.width > 0) || !(cr.height > 0)) return null;
  let opacity = 1;
  for (let el: HTMLElement | null = host; el && el !== document.body; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return null;
    const o = parseFloat(style.opacity);
    if (Number.isFinite(o)) opacity *= o;
    if (opacity <= 0.001) return null;
  }
  out.x = (rect.left - cr.left) / cr.width;
  out.y = (rect.top - cr.top) / cr.height;
  out.w = rect.width / cr.width;
  out.h = rect.height / cr.height;
  out.opacity = opacity;
  return out;
}

/** What the globe draws from a course: a change anywhere here is a real change, anything else is the same list. */
function coursesKey(courses: CourseGlobeCourse[]): string {
  return courses
    .map((c) => `${c.id}\u0001${c.code ?? ""}\u0001${c.name}\u0001${c.biome}\u0001${c.markerId ?? ""}\u0001${c.progress ?? ""}\u0001${c.stats ? `${c.stats.reached}/${c.stats.total}/${c.stats.mastered}/${c.stats.residents}/${c.stats.sources}` : ""}`)
    .join("\u0002");
}

/**
 * The same `courses` reference while the list is structurally the same. The
 * earth page's layer replaces the stand-in's with a list built from the same
 * records (S2's sticky slot keeps the component mounted), and a fresh array
 * there re-rendered every town and walker of the globe mid-hop.
 */
function useStableCourses(courses: CourseGlobeCourse[]): CourseGlobeCourse[] {
  const key = coursesKey(courses);
  const last = useRef<{ key: string; courses: CourseGlobeCourse[] } | null>(null);
  if (!last.current || last.current.key !== key) last.current = { key, courses };
  return last.current.courses;
}

/** Keeps the portal camera's aspect on the stage size; `AutoFitCamera` (a later sibling) seats it. */
function PortalCamera({ camera }: { camera: THREE.PerspectiveCamera }) {
  const size = useThree((s) => s.size);
  useLayoutEffect(() => {
    camera.aspect = size.width / Math.max(1, size.height);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

/**
 * S2: the globe re-parented into the persistent stage (the only globe path
 * since gate 1, 2026-10-13). The globe scene graph (`CourseGlobeScene`:
 * theme, lights, star field, the orbiting globe with its towns, ships,
 * creatures, picking, hover and settle) renders unchanged into a scene of its
 * own with the globe's own camera, through an R3F portal; the stage composer
 * draws that scene through its pixel path (the stage grain,
 * `REST_GRAIN_CSS_PX` = `PRODUCTION_PIXEL_GRAIN` CSS px per cell at rest,
 * `HOP_GRAIN_CSS_PX` while a hop is fast) and composites it over the sky
 * inside the host's box. The planet-rung scenery (moons, station) rides along
 * in the same scene.
 */
export function PlanetLayer({
  host,
  spinApi,
  courses: coursesProp,
  activeCourseId,
  theme,
  reducedMotion,
  onActiveCourseChange,
  onCourseTownOpen,
  onLandmarkAnchor,
  onHoverCourse,
  onPointerInteractionChange,
}: PlanetLayerProps) {
  const { frame, registry } = useStage();
  const director = useStageDirector();
  const seed = useStageSeed();
  const gl = useThree((s) => s.gl);
  const courses = useStableCourses(coursesProp);
  const scene = useMemo(() => new THREE.Scene(), []);
  const camera = useMemo(() => {
    const c = new THREE.PerspectiveCamera(GLOBE_CAMERA.fov, 1, GLOBE_CAMERA.near, GLOBE_CAMERA.far);
    c.position.set(...GLOBE_CAMERA.position);
    return c;
  }, []);
  const pass = useMemo<PlanetPass>(() => ({ scene, camera, viewport: null }), [scene, camera]);
  const box = useMemo<HostViewport>(() => ({ x: 0, y: 0, w: 1, h: 1, opacity: 1 }), []);
  const hop = useHop();
  // The layer outlives its page (sticky slot), so a detached host means "the whole canvas".
  const fullBox = useMemo<HostViewport>(() => ({ x: 0, y: 0, w: 1, h: 1, opacity: 1 }), []);

  useEffect(() => {
    registry.register("planet", scene);
    const f = frame.current;
    if (f) f.planet = pass;
    return () => {
      registry.register("planet", null);
      director.readiness.set("planet", false);
      const cur = frame.current;
      if (cur && cur.planet === pass) cur.planet = null;
    };
  }, [registry, scene, frame, pass, director]);

  // Before the globe's own frame callbacks (0) and the composer (1): where to draw this frame.
  useFrame(() => {
    pass.viewport = readHostViewport(host, gl.domElement, box) ?? fullBox;
    director.readiness.set("planet", true);
  }, -1);

  return createPortal(
    <>
      <PortalCamera camera={camera} />
      <PlanetPullback runtime={hop.runtime} camera={camera} scene={scene} />
      <CourseGlobeScene
        host={host}
        courses={courses}
        activeCourseId={activeCourseId}
        theme={theme}
        reducedMotion={reducedMotion}
        onActiveCourseChange={onActiveCourseChange}
        onCourseTownOpen={({ courseId, anchor }) => onCourseTownOpen(courseId, anchor)}
        onLandmarkAnchor={onLandmarkAnchor}
        onHoverCourse={onHoverCourse}
        onPointerInteractionChange={onPointerInteractionChange}
        spinApi={spinApi}
      />
      <PlanetScenery seed={seed} reducedMotion={reducedMotion} />
    </>,
    scene,
    { camera },
  );
}
