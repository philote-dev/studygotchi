"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useCourseOverviewCache } from "@/components/earth/useCourseOverviewCache";
import { galaxyCoursesFromSummaries } from "@/lib/galaxy/courses";
import type { GalaxyLayout } from "@/lib/galaxy/layout";
import type { BlobPlacementMode } from "@/lib/galaxy/placement";
import type { GalaxySpec } from "@/lib/galaxy/spec";
import { useIdentity } from "@/lib/identity";
import { resolveCurrentCourse, useActiveCourse } from "@/lib/stage/active-course";
import type { StageDirector } from "@/lib/stage/director";
import { openCourseConstellation } from "@/lib/stage/events";
import { placeGalaxyScenery } from "@/lib/stage/galaxy-scenery";
import { bucketAspect } from "@/lib/stage/placement";
import { withEarthCourses } from "@/lib/world/globe-courses";
import type { StageTheme } from "../../lib/uniforms";
import { useHop } from "../../hop/HopProvider";
import { useStage, useStageDirector } from "../../StageContext";
import type { CourseBeadsApi } from "./CourseBeads";
import type { CourseBlobsApi } from "./CourseBlobs";
import { BULGE_KEEP_OUT_SIGMAS, type FlagCourse, type FlagFrameAnchor } from "./CourseFlags";
import { useCourseGraphs } from "./course-graphs";
import { GalaxyFader } from "./galaxy-fade";
import { GALAXY_HERO_SIZE, type GalaxyLayerBudget } from "./galaxy-layer-model";
import { GalaxyLayer } from "./GalaxyLayer";
import { GALAXY_HIDE_BELOW, galaxyRungFade, galaxyRungInteractive, stickyFlagNext } from "./galaxy-rung-model";
import { GalaxyScenery } from "./GalaxyScenery";
import type { GalaxySceneryBuild } from "./galaxy-scenery-build";
import type { GalaxyRungController } from "./galaxy-rung-controller";

/**
 * `value` as it was the last time the director rested. The galaxy's layout
 * is keyed on its current course (that blob sits at the anchor) and on the
 * course list: re-keying it mid-hop regenerated the layout, its buffers and
 * the scenery and ran a warm pass, a long synchronous frame on the way; and
 * it would move the very blob the twin is condensing onto. The rebuild waits
 * for the rest stop, where the galaxy is either hidden or already arrived.
 */
function useSettledValue<T>(value: T, director: StageDirector): T {
  const [settled, setSettled] = useState(value);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    if (!director.sample().moving) setSettled(value);
  }, [value, director]);
  useEffect(() => director.onRest(() => setSettled(latest.current)), [director]);
  return director.sample().moving ? settled : value;
}

export interface GalaxyRungProps {
  seed: number;
  theme: StageTheme;
  reducedMotion: boolean;
  controller: GalaxyRungController;
  /** Where the blobs go; `mixed` (default) keeps the current and world courses on their arms. */
  placement?: BlobPlacementMode;
  /** The current course's flag stays up while resting at the galaxy (default on); hover flags are always on. */
  currentFlag?: boolean;
  /** Called with the layer's budget and the scenery's stats (the perf overlay / captures read it). */
  onBudget?: (info: { layer: GalaxyLayerBudget; scenery: GalaxySceneryBuild["stats"] | null }) => void;
}

/**
 * The galaxy rung (L 3) in the product stage (permanent since gate 3,
 * 2026-10-13): `GalaxyLayer` with the student's real course list as concept
 * blobs, faded by the director's altitude band (nothing drawn below L ~2.3),
 * the galaxy-rung scenery in the pattern frame, and the pointer path: hover
 * rings a blob's core and moves the sticky flag there (a DOM card on an
 * anti-radial leader, solved from the per-frame projection this component
 * publishes; it stays on the blob last hovered); a click on a blob core asks
 * the product to open that course's constellation through
 * `stage:open-course-constellation`.
 *
 * Courses come from the same source /earth uses: the identity's list through
 * `withEarthCourses`, with concept stats from the course overview cache
 * (mock worlds for the sandbox catalogue, the API otherwise). The current
 * blob is the planet's active course when the earth code has reported one,
 * else the most recently opened course, else the identity's course. Each
 * course's stars are its settled constellation layout when known
 * (`useCourseGraphs`), a seeded stand-in until then.
 */
export function GalaxyRung({ seed, theme, reducedMotion, controller, placement, currentFlag = true, onBudget }: GalaxyRungProps) {
  const director = useStageDirector();
  const hop = useHop();
  const { frame } = useStage();
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const identity = useIdentity();
  const summaries = useMemo(() => withEarthCourses(identity.courses), [identity.courses]);
  const overview = useCourseOverviewCache(identity.studentId, summaries);
  const active = useActiveCourse();

  useEffect(() => {
    for (const course of summaries) void overview.load(course.id);
  }, [summaries, overview.load]);

  const liveCourses = useMemo(
    () =>
      galaxyCoursesFromSummaries(summaries, {
        stats: (id) => {
          const record = overview.records.get(id);
          return record?.status === "ready" ? record.data.stats : null;
        },
        lastOpenedAt: (id) => active.openedAt[id] ?? null,
      }),
    [summaries, overview.records, active.openedAt],
  );
  const liveCurrentCourseId = useMemo(
    () => resolveCurrentCourse(liveCourses.map((c) => c.id), identity.courseId || null),
    // The store's active id lives in `active`; recency is already in `courses`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveCourses, identity.courseId, active.activeCourseId],
  );
  // Re-keyed at rest only (see `useSettledValue`): a hop's `lockCourse` / recency lands here once it has settled.
  const courses = useSettledValue(liveCourses, director);
  const currentCourseId = useSettledValue(liveCurrentCourseId, director);
  const graphs = useCourseGraphs(courses, currentCourseId);

  // The flags' facts: the host reads them from the controller.
  const flagCourses = useMemo<FlagCourse[]>(() => courses.map((c) => ({ id: c.id, code: c.code, title: c.title, concepts: c.conceptCount, mastery: c.mastery })), [courses]);
  useEffect(() => controller.setCourses(flagCourses, currentCourseId, currentFlag), [controller, flagCourses, currentCourseId, currentFlag]);

  const [build, setBuild] = useState<{ spec: GalaxySpec; layout: GalaxyLayout; budget: GalaxyLayerBudget } | null>(null);
  const onBuild = useCallback((info: { spec: GalaxySpec; layout: GalaxyLayout; budget: GalaxyLayerBudget }) => setBuild(info), []);
  const aspectBucket = bucketAspect(size.width, size.height);
  const scenery = useMemo(
    () =>
      build
        ? placeGalaxyScenery({
            seed,
            layout: build.layout,
            view: { aspect: aspectBucket, fovDeg: camera.fov, size: GALAXY_HERO_SIZE, roll: build.spec.roll, inclination: build.spec.inclination },
          })
        : null,
    [build, seed, aspectBucket, camera.fov],
  );
  const sceneryStats = useRef<GalaxySceneryBuild["stats"] | null>(null);
  const onSceneryBuild = useCallback(
    (stats: GalaxySceneryBuild["stats"]) => {
      sceneryStats.current = stats;
      if (build) onBudget?.({ layer: build.budget, scenery: stats });
    },
    [build, onBudget],
  );
  useEffect(() => {
    if (build) onBudget?.({ layer: build.budget, scenery: sceneryStats.current });
  }, [build, onBudget]);

  // Per-frame state: fade, visibility, picking, projection. No React renders on the frame path.
  const root = useRef<THREE.Group>(null);
  const beads = useRef<CourseBeadsApi | null>(null);
  const blobs = useRef<CourseBlobsApi | null>(null);
  const fader = useMemo(() => new GalaxyFader(), []);
  const fadeRef = useRef(0);
  const framesSinceBuild = useRef(0);
  const scratch = useMemo(() => ({ raycaster: new THREE.Raycaster(), ndc: new THREE.Vector2(), pos: new THREE.Vector3(), proj: new THREE.Vector3(), edge: new THREE.Vector3(), anchors: [] as FlagFrameAnchor[] }), []);
  const hovered = useRef<string | null>(null);
  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  // Materials and bead attributes are rebuilt on these: make the fader rewrite them on the next frame.
  useEffect(() => fader.invalidate(), [fader, theme, courses, currentCourseId, scenery, graphs]);
  useEffect(() => {
    framesSinceBuild.current = 0;
  }, [build]);
  // The galaxy sits hidden below L 2.3; ask the composer to compile and draw it once offscreen
  // whenever its materials may have changed, so the rise never meets a program compile.
  useEffect(() => {
    const f = frame.current;
    if (f) f.warm = true;
  }, [frame, theme, build, scenery]);

  // The host's hit test, in CSS px of the stage host (the canvas fills it): the blob CORES only.
  const pickAt = useCallback(
    (x: number, y: number) => {
      const api = blobs.current;
      if (!api) return null;
      const rect = gl.domElement.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) return null;
      scratch.ndc.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
      scratch.raycaster.setFromCamera(scratch.ndc, camera);
      return api.pick(scratch.raycaster);
    },
    [gl, camera, scratch],
  );
  useEffect(() => {
    controller.pickAt = pickAt;
    return () => {
      if (controller.pickAt === pickAt) controller.pickAt = null;
    };
  }, [controller, pickAt]);

  useEffect(
    () => () => {
      director.readiness.set("galaxy", false);
      controller.setActive(false);
      controller.setResting(false);
    },
    [director, controller],
  );

  const setHover = (courseId: string | null) => {
    if (courseId === hovered.current) return;
    hovered.current = courseId;
    beads.current?.setHover(courseId);
    const course = courseId ? courseById.get(courseId) : null;
    controller.setHover(course ? { courseId: course.id, code: course.code, title: course.title } : null);
  };

  /** World -> host CSS px. */
  const toScreen = (v: THREE.Vector3) => {
    scratch.proj.copy(v).project(camera);
    return { x: ((scratch.proj.x + 1) / 2) * size.width, y: ((1 - scratch.proj.y) / 2) * size.height };
  };

  // After the director's step (-5), before the layers (0) and the composer (1).
  useFrame(() => {
    const sample = director.sample();
    const fade = galaxyRungFade(sample.L);
    fadeRef.current = fade;
    const group = root.current;
    if (group) {
      group.visible = fade > GALAXY_HIDE_BELOW;
      if (group.visible) fader.apply(group, fade);
    }
    // Ready: built, and one frame has drawn since.
    if (build && !director.readiness.get("galaxy")) {
      if (framesSinceBuild.current++ >= 1) director.readiness.set("galaxy", true);
    }
    // The group may be hidden (below the band): world positions need current matrices.
    if (group) group.updateWorldMatrix(true, true);
    // The hop (S3-2 / S3-3): the current course's blob CORE on screen is where the twin condenses to, so the
    // graph lands ON the core glow; the blob itself is folded into the core until the graph has landed and
    // blooms out with the ring (the driver's `galaxy.blob`, whole under reduced motion). The core rides the
    // pattern: re-projected every frame.
    {
      const st = hop.runtime.state;
      const handoff = st.galaxy;
      blobs.current?.setCondense(handoff.blob);
      beads.current?.setCondense(handoff.blob);
      const api = beads.current;
      const anchor = api && currentCourseId ? api.anchor(currentCourseId, scratch.pos) : null;
      if (anchor && group) {
        const depth = scratch.pos.distanceTo(camera.position);
        const p = toScreen(scratch.pos);
        const radiusPx = (anchor.radius / (depth * Math.tan((camera.fov * Math.PI) / 360))) * (size.height / 2);
        st.galaxyAnchor = { x: p.x, y: p.y, radius: Math.max(2, radiusPx) };
      } else st.galaxyAnchor = null;
    }
    const interactive = galaxyRungInteractive(sample);
    controller.setActive(interactive);
    controller.setResting(interactive && !sample.moving && sample.rung === "galaxy");
    if (!interactive) {
      if (hovered.current) setHover(null);
      return;
    }
    // Hover: hit-test the pointer against the blob cores; a pinned flag keeps its course hovered.
    // The sticky flag (gate 3) remembers the blob most recently hovered until another is.
    const p = controller.pointer;
    const hit = p ? pickAt(p.x, p.y) : null;
    setHover(hit?.courseId ?? controller.pinned);
    controller.setSticky(stickyFlagNext({ active: interactive, sticky: controller.sticky, hoveredId: hit?.courseId ?? null }));
    // Flags: publish every blob's screen footprint, the galaxy centre and the bulge radius (conservative:
    // the larger of two in-plane offsets, since the disc is inclined). The host's cards re-solve from it.
    const blobApi = blobs.current;
    if (blobApi && group) {
      const anchors = scratch.anchors;
      anchors.length = 0;
      blobApi.each((course, world, a) => {
        const c = toScreen(world);
        const depth = world.distanceTo(camera.position);
        const pxPerWorld = (size.height / 2) / (depth * Math.tan((camera.fov * Math.PI) / 360));
        anchors.push({ courseId: course.courseId, x: c.x, y: c.y, r: a.blobRadius * pxPerWorld, glowR: a.glowRadius * pxPerWorld });
      });
      // The pattern frame is the blobs' group (its world matrix carries the layer's distance, roll, inclination and
      // pattern angle); its origin is the galaxy centre. (The rung's root sits at the camera: never project it.)
      const frameGroup = blobApi.frame ?? group.getObjectByName("stage-galaxy") ?? group;
      const centre = toScreen(scratch.pos.set(0, 0, 0).applyMatrix4(frameGroup.matrixWorld));
      let bulgeR = 0;
      if (build) {
        const R = build.layout.shape.bulgeSigma * BULGE_KEEP_OUT_SIGMAS;
        for (let k = 0; k < 8; k++) {
          const t = (k / 8) * Math.PI * 2;
          scratch.edge.set(R * Math.cos(t), 0, R * Math.sin(t)).applyMatrix4(frameGroup.matrixWorld);
          const e = toScreen(scratch.edge);
          bulgeR = Math.max(bulgeR, Math.hypot(e.x - centre.x, e.y - centre.y));
        }
      }
      controller.flags.publish({ anchors: anchors.slice(), centre, bulgeR, width: size.width, height: size.height });
    }
  }, -1);

  return (
    <group ref={root} name="stage-galaxy-rung" visible={false}>
      <GalaxyLayer seed={seed} theme={theme} courses={courses} currentCourseId={currentCourseId} fade={1} reducedMotion={reducedMotion} placement={placement} graphs={graphs} onBuild={onBuild} beadsApi={beads} blobsApi={blobs} onBeadClick={(id) => openCourseConstellation(id)}>
        {scenery ? <GalaxyScenery scenery={scenery} theme={theme} fadeRef={fadeRef} reducedMotion={reducedMotion} onBuild={onSceneryBuild} /> : null}
      </GalaxyLayer>
    </group>
  );
}