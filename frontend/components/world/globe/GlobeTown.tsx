"use client";

import { memo, useMemo, useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { showGlobeLandmarkNumberPin } from "@/lib/world/earth-nav";
import { markerIdForCourse } from "@/lib/world/globe-courses";
import { BouquetBase } from "./bouquet/BouquetBase";
import { WorldProps } from "./bouquet/WorldProps";
import { MARKERS } from "./bouquet/markers";
import { propCountFromProgress } from "./bouquet/bouquet-state";
import { isGlobeLandmarkFacing } from "./globe-pick";
import { GLOBE_ACTIVE_POP, GLOBE_BOUQUET_SCALE } from "./globe-parade";
import { courseMarkerState, sampleTerrain } from "./globe-spec";
import { GLOBE_RADIUS } from "./globe-materials";
import type {
  CourseGlobeCourse,
  UnitDirection,
} from "./globe-types";

export { GLOBE_BOUQUET_SCALE };

const UP = new THREE.Vector3(0, 1, 0);
const ACTIVE_LIFT = 2.8;
const LANDMARK_DEAD_LAYER = 31;

export interface GlobeTownOpenEvent {
  courseId: string;
  anchor: { x: number; y: number };
}

interface GlobeTownProps {
  course: CourseGlobeCourse;
  direction: UnitDirection;
  courses: CourseGlobeCourse[];
  directions: Map<string, UnitDirection>;
  active: boolean;
  hovered: boolean;
  night: boolean;
}

/** What a town draws from its course row (the rest of `CourseGlobeCourse` never reaches the scene). */
export function courseDrawKey(course: CourseGlobeCourse): string {
  const s = course.stats;
  return `${course.id}\u0001${course.code ?? ""}\u0001${course.biome}\u0001${course.markerId ?? ""}\u0001${course.progress ?? ""}\u0001${s ? `${s.reached}/${s.total}/${s.mastered}/${s.residents}/${s.sources}` : ""}`;
}

/**
 * Props equality for a town (and its walkers): the course row by what is
 * drawn from it, the course list only by what `sampleTerrain` reads (its
 * first id), everything else by identity. The earth page rebuilds its course
 * array for every overview record that lands and every settle; without this
 * each rebuild re-rendered every bouquet on the globe (dozens of meshes each)
 * in one synchronous frame.
 */
export function townPropsEqual<P extends { course: CourseGlobeCourse; courses: CourseGlobeCourse[] }>(a: P, b: P): boolean {
  for (const key of Object.keys(a) as (keyof P)[]) {
    if (key === "course") {
      if (courseDrawKey(a.course) !== courseDrawKey(b.course)) return false;
    } else if (key === "courses") {
      if (a.courses.length !== b.courses.length || a.courses[0]?.id !== b.courses[0]?.id) return false;
    } else if (!Object.is(a[key], b[key])) return false;
  }
  return Object.keys(a).length === Object.keys(b).length;
}

/**
 * One course's bouquet on the globe. Memoised (`townPropsEqual`): a settle on
 * another course (the hop's `lockCourse`, a bead click) changes `active` on
 * two towns, and the bouquet subtrees of the others (dozens of meshes each)
 * are not rebuilt, which kept a ~50 ms synchronous re-render off the first
 * frames of a hop.
 */
export const GlobeTown = memo(function GlobeTown({
  course,
  direction,
  courses,
  directions,
  active,
  hovered,
  night,
}: GlobeTownProps) {
  const group = useRef<THREE.Group>(null);
  const pinWorld = useRef(new THREE.Vector3());
  const planetCenter = useRef(new THREE.Vector3());
  const { camera } = useThree();
  const markerState = courseMarkerState(course.progress);
  const marker =
    MARKERS.find((entry) => entry.id === markerIdForCourse(course)) ?? MARKERS[0];
  const normal = useMemo(() => new THREE.Vector3(...direction).normalize(), [direction]);
  const quaternion = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(UP, normal),
    [normal],
  );
  const terrain = sampleTerrain(direction, courses, directions);
  const position = useMemo(
    () =>
      normal
        .clone()
        .multiplyScalar(GLOBE_RADIUS + Math.max(0, terrain.elevation) + 0.02),
    [normal, terrain.elevation],
  );
  const scale = GLOBE_BOUQUET_SCALE * markerState.footprintScale;

  useFrame(() => {
    const root = group.current;
    if (!root) return;
    root.updateWorldMatrix(true, false);
    root.getWorldPosition(pinWorld.current);
    const center = root.parent
      ? root.parent.getWorldPosition(planetCenter.current)
      : planetCenter.current.set(0, -0.7, 0);
    const next = isGlobeLandmarkFacing(
      pinWorld.current,
      center,
      camera.position,
    );
    root.traverse((obj) => {
      obj.layers.set(next ? 0 : LANDMARK_DEAD_LAYER);
    });
  });

  return (
    <group
      ref={group}
      position={position}
      quaternion={quaternion}
      scale={active ? scale * GLOBE_ACTIVE_POP : scale}
      userData={{ courseLandmark: course.id }}
    >
      <group position={active ? [0, ACTIVE_LIFT, 0] : [0, 0, 0]}>
        <BouquetBase marker={marker} />
        <WorldProps
          marker={marker}
          propCount={propCountFromProgress(course.progress)}
          night={night}
        />
        {hovered ? (
          <mesh
            position={[0, 0.08, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            raycast={() => undefined}
          >
            <ringGeometry args={active ? [20.4, 24.2, 28] : [16.4, 19.8, 28]} />
            <meshBasicMaterial
              color={night ? "#f2ead4" : "#2c261c"}
              toneMapped={false}
            />
          </mesh>
        ) : null}
        {active ? (
          <mesh
            position={[0, 0.12, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            raycast={() => undefined}
          >
            <ringGeometry args={[16.4, 19.8, 28]} />
            <meshBasicMaterial color="#fff0ae" toneMapped={false} />
          </mesh>
        ) : null}
        {active && showGlobeLandmarkNumberPin() ? (
          <Html
            position={[0, 42, 0]}
            center
            occlude={false}
            zIndexRange={[30, 0]}
            style={{ pointerEvents: "none" }}
          >
            <span className="landmark-pin" aria-hidden>
              <span className="landmark-pin-mast" />
              <span className="landmark-pin-flag">{course.code ?? "Pin"}</span>
            </span>
          </Html>
        ) : null}
      </group>
    </group>
  );
}, townPropsEqual);

interface GlobeTownsProps {
  courses: CourseGlobeCourse[];
  directions: Map<string, UnitDirection>;
  activeCourseId: string | null;
  hoveredCourseId?: string | null;
  night?: boolean;
}

export function GlobeTowns({
  courses,
  directions,
  activeCourseId,
  hoveredCourseId = null,
  night = false,
}: GlobeTownsProps) {
  return (
    <group>
      {courses.map((course) => {
        const direction = directions.get(course.id);
        return direction ? (
          <GlobeTown
            key={course.id}
            course={course}
            direction={direction}
            courses={courses}
            directions={directions}
            active={course.id === activeCourseId}
            hovered={course.id === hoveredCourseId}
            night={night}
          />
        ) : null;
      })}
    </group>
  );
}
