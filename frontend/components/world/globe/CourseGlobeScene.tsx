"use client";

import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GlobeCreatures } from "./GlobeCreatures";
import { GlobeOcean } from "./GlobeOcean";
import { GlobeRoutes } from "./GlobeRoutes";
import { GlobeShips } from "./GlobeShips";
import { GlobeTerrain } from "./GlobeTerrain";
import {
  GlobeTowns,
  type GlobeTownOpenEvent,
} from "./GlobeTown";
import {
  GLOBE_RADIUS,
  useGlobeSurfaceResources,
} from "./globe-materials";
import {
  GLOBE_PICK_SCREEN_PX,
  globeLayoutSize,
  globePointerNdc,
  pickGlobeLandmark,
  resolveGlobePointerUp,
  type GlobePickIntent,
} from "./globe-pick";
import { seededCourseDirections } from "./globe-spec";
import type {
  CourseGlobeCourse,
  ScreenPoint,
  SpaceTheme,
  UnitDirection,
} from "./globe-types";
import { GLOBE_FOCUS_DIRECTION, seatedCameraPosition } from "./globe-seat";
import { screenPointFromNdc } from "@/lib/world/earth-nav";
import { isLandmarkVisible } from "@/lib/world/landmark-hit";

const LAYOUT_SEED = "studygotchi:production-course-globe";
const FOCUS_DIRECTION = new THREE.Vector3(...GLOBE_FOCUS_DIRECTION).normalize();
const SNAP_DAMPING = 7.5;
const DRAG_THRESHOLD_PX = 8;

function landmarkPinWorld(
  direction: UnitDirection,
  globe: THREE.Object3D,
  radius = GLOBE_RADIUS + 0.45,
): THREE.Vector3 {
  return new THREE.Vector3(...direction)
    .normalize()
    .multiplyScalar(radius)
    .applyMatrix4(globe.matrixWorld);
}

function pickLandmarkAtPointer(
  camera: THREE.Camera,
  offsetX: number,
  offsetY: number,
  viewport: { width: number; height: number },
  directions: ReadonlyMap<string, UnitDirection>,
  globe: THREE.Object3D,
  intent: GlobePickIntent,
): string | null {
  const ndc = globePointerNdc(offsetX, offsetY, viewport);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
  globe.updateWorldMatrix(true, false);
  const planetCenter = globe.getWorldPosition(new THREE.Vector3());
  const landmarks = [];
  for (const [courseId, direction] of directions) {
    const pin = landmarkPinWorld(direction, globe);
    const projected = pin.clone().project(camera);
    landmarks.push({
      id: courseId,
      position: { x: pin.x, y: pin.y, z: pin.z },
      screen: {
        x: ((projected.x + 1) * viewport.width) / 2,
        y: ((1 - projected.y) * viewport.height) / 2,
      },
    });
  }
  return pickGlobeLandmark({
    rayOrigin: raycaster.ray.origin,
    rayDirection: raycaster.ray.direction,
    landmarks,
    camera: camera.position,
    globeCenter: planetCenter,
    intent,
    pointer: { x: offsetX, y: offsetY },
    maxScreenPx: GLOBE_PICK_SCREEN_PX,
  });
}

export type { GlobeTownOpenEvent } from "./GlobeTown";

export interface GlobeSpinApi {
  spin(horizontal: number, vertical: number): void;
  settle(): void;
}

export interface CourseGlobeSceneProps {
  courses: CourseGlobeCourse[];
  activeCourseId: string | null;
  theme: SpaceTheme;
  reducedMotion: boolean;
  onActiveCourseChange(courseId: string): void;
  onCourseTownOpen(event: GlobeTownOpenEvent): void;
  onLandmarkAnchor?(anchor: ScreenPoint | null): void;
  /** The landmark under the pointer changed (null when none): the earth page prefetches that course's land. */
  onHoverCourse?(courseId: string | null): void;
  onPointerInteractionChange(interacting: boolean): void;
  spinApi: RefObject<GlobeSpinApi | null>;
  /**
   * Element the pointer listeners attach to: the stage's page-side host
   * (`.course-globe-stage`). The scene renders as a layer of the persistent
   * stage canvas (`PlanetLayer`), whose composer owns the pixel pass; null
   * falls back to the canvas's own `.course-globe-stage` ancestor or the
   * canvas itself (a lab preview with its own canvas).
   */
  host?: HTMLElement | null;
}

export function shortestFocusQuaternion(
  current: THREE.Quaternion,
  courseDirection: THREE.Vector3,
  focusDirection: THREE.Vector3 = FOCUS_DIRECTION,
): THREE.Quaternion {
  const facing = courseDirection.clone().normalize().applyQuaternion(current);
  const correction = new THREE.Quaternion().setFromUnitVectors(
    facing,
    focusDirection.clone().normalize(),
  );
  return correction.multiply(current.clone()).normalize();
}

export function nearestFacingCourseId(
  current: THREE.Quaternion,
  courseIds: string[],
  directions: ReadonlyMap<string, UnitDirection>,
  focusDirection: THREE.Vector3 = FOCUS_DIRECTION,
): string | null {
  const focus = focusDirection.clone().normalize();
  let nearestId: string | null = null;
  let nearestDot = -Infinity;

  for (const courseId of courseIds) {
    const direction = directions.get(courseId);
    if (!direction) continue;
    const dot = new THREE.Vector3(...direction)
      .applyQuaternion(current)
      .dot(focus);
    if (dot > nearestDot) {
      nearestDot = dot;
      nearestId = courseId;
    }
  }

  return nearestId;
}

function SceneTheme({ theme }: { theme: SpaceTheme }) {
  const gl = useThree((state) => state.gl);
  const fog = theme === "light" ? "#cfd6e4" : "#080716";
  useLayoutEffect(() => {
    gl.setClearColor(0x000000, 0);
  }, [gl, theme]);
  return <fog attach="fog" args={[fog, 36, 72]} />;
}

function Lights({ theme }: { theme: SpaceTheme }) {
  return (
    <>
      <hemisphereLight
        args={
          theme === "light"
            ? ["#fff8e8", "#8e879d", 1.18]
            : ["#b9c9ef", "#251d35", 0.72]
        }
      />
      <directionalLight
        position={[-7, 10, 9]}
        intensity={theme === "light" ? 2.05 : 2.35}
        color={theme === "light" ? "#fff3d7" : "#fff0d5"}
        castShadow
      />
    </>
  );
}

function AutoFitCamera() {
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;

  useLayoutEffect(() => {
    const seat = seatedCameraPosition(
      { width, height },
      camera.fov,
      GLOBE_RADIUS,
    );
    camera.position.set(...seat.position);
    camera.lookAt(...seat.lookAt);
    camera.near = 0.1;
    camera.far = Math.max(80, seat.position[2] + 80);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }, [camera, height, width]);

  return null;
}

function StarField({ theme }: { theme: SpaceTheme }) {
  const geometries = useMemo(
    () =>
      [0, 1, 2].map((sizeBand) => {
        const points: number[] = [];
        for (let index = sizeBand; index < 57; index += 3) {
          const seed = index + 1;
          const x = Math.sin(seed * 12.9898) * 12.5;
          const y = Math.sin(seed * 5.3983 + 1.7) * 8;
          const z = -8.5 - ((seed * 37) % 10);
          points.push(x, y, z);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(points, 3),
        );
        return geometry;
      }),
    [],
  );

  useEffect(
    () => () => {
      for (const geometry of geometries) geometry.dispose();
    },
    [geometries],
  );

  const colors =
    theme === "light"
      ? ["#11131a", "#191923", "#090b10"]
      : ["#fff2cf", "#b7e7e5", "#d8f4ee"];

  return (
    <group>
      {geometries.map((geometry, index) => (
        <points key={index} geometry={geometry} frustumCulled={false}>
          <pointsMaterial
            color={colors[index]}
            size={0.045 + index * 0.011}
            sizeAttenuation
            fog={false}
          />
        </points>
      ))}
    </group>
  );
}

interface OrbitingGlobeProps {
  courses: CourseGlobeCourse[];
  activeCourseId: string | null;
  directions: Map<string, UnitDirection>;
  theme: SpaceTheme;
  reducedMotion: boolean;
  onActiveCourseChange(courseId: string): void;
  onCourseTownOpen(event: GlobeTownOpenEvent): void;
  onLandmarkAnchor?(anchor: ScreenPoint | null): void;
  onHoverCourse?(courseId: string | null): void;
  onPointerInteractionChange(interacting: boolean): void;
  spinApi: RefObject<GlobeSpinApi | null>;
  host?: HTMLElement | null;
}

function OrbitingGlobe({
  courses,
  activeCourseId,
  directions,
  theme,
  reducedMotion,
  onActiveCourseChange,
  onLandmarkAnchor,
  onHoverCourse,
  onPointerInteractionChange,
  spinApi,
  host = null,
}: OrbitingGlobeProps) {
  const group = useRef<THREE.Group>(null);
  const target = useRef(new THREE.Quaternion());
  const interacting = useRef(false);
  const dragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const dragOrigin = useRef({ x: 0, y: 0 });
  const dragMoved = useRef(false);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);
  const cameraRight = useRef(new THREE.Vector3());
  const yawRotation = useRef(new THREE.Quaternion());
  const pitchRotation = useRef(new THREE.Quaternion());
  const resources = useGlobeSurfaceResources(courses, directions);
  const courseIds = useMemo(() => courses.map((course) => course.id), [courses]);
  const [hoveredCourseId, setHoveredCourseId] = useState<string | null>(null);

  useEffect(() => {
    const target =
      host ??
      gl.domElement.closest<HTMLElement>(".course-globe-stage") ??
      gl.domElement;
    target.dataset.globeHover = hoveredCourseId ?? "";
    return () => {
      target.dataset.globeHover = "";
    };
  }, [gl.domElement, host, hoveredCourseId]);
  useEffect(() => {
    onHoverCourse?.(hoveredCourseId);
  }, [hoveredCourseId, onHoverCourse]);

  useEffect(() => {
    if (!activeCourseId) return;
    const direction = directions.get(activeCourseId);
    if (!direction) return;
    target.current.copy(
      shortestFocusQuaternion(
        group.current?.quaternion ?? new THREE.Quaternion(),
        new THREE.Vector3(...direction),
      ),
    );
  }, [activeCourseId, directions]);

  useEffect(
    () => () => {
      dragging.current = false;
      interacting.current = false;
      onPointerInteractionChange(false);
      document.body.style.cursor = "auto";
    },
    [onPointerInteractionChange],
  );

  useFrame((_, delta) => {
    if (group.current && !interacting.current) {
      if (reducedMotion) {
        group.current.quaternion.copy(target.current);
      } else {
        const blend = 1 - Math.exp(-SNAP_DAMPING * delta);
        group.current.quaternion.slerp(target.current, blend);
      }
    }
    if (!onLandmarkAnchor || !group.current || !activeCourseId) {
      onLandmarkAnchor?.(null);
      return;
    }
    const direction = directions.get(activeCourseId);
    if (!direction) {
      onLandmarkAnchor(null);
      return;
    }
    group.current.updateWorldMatrix(true, false);
    const world = landmarkPinWorld(direction, group.current, GLOBE_RADIUS + 0.85);
    const ndc = world.clone().project(camera);
    if (
      !isLandmarkVisible({
        pin: world,
        camera: camera.position,
        planetCenter: group.current.getWorldPosition(new THREE.Vector3()),
        planetRadius: GLOBE_RADIUS,
        ndc,
      })
    ) {
      onLandmarkAnchor(null);
      return;
    }
    onLandmarkAnchor(screenPointFromNdc(ndc, size));
  });

  const spin = (horizontal: number, vertical: number) => {
    if (!group.current) return;
    interacting.current = true;
    cameraRight.current
      .set(1, 0, 0)
      .applyQuaternion(camera.quaternion)
      .normalize();
    yawRotation.current.setFromAxisAngle(camera.up, horizontal);
    pitchRotation.current.setFromAxisAngle(cameraRight.current, vertical);
    group.current.quaternion
      .premultiply(yawRotation.current)
      .premultiply(pitchRotation.current)
      .normalize();
    target.current.copy(group.current.quaternion);
  };

  const settle = () => {
    if (!group.current) return;
    interacting.current = false;
    const nearestId = nearestFacingCourseId(
      group.current.quaternion,
      courseIds,
      directions,
    );
    if (!nearestId) return;
    const direction = directions.get(nearestId);
    if (!direction) return;
    target.current.copy(
      shortestFocusQuaternion(
        group.current.quaternion,
        new THREE.Vector3(...direction),
      ),
    );
    onActiveCourseChange(nearestId);
  };

  useImperativeHandle(spinApi, () => ({ spin, settle }));
  const spinRef = useRef(spin);
  const settleRef = useRef(settle);
  spinRef.current = spin;
  settleRef.current = settle;

  useEffect(() => {
    // The globe's own canvas, or the stage's page-side host (same box, so offsets and sizes match).
    const el: HTMLElement = host ?? gl.domElement;

    const pickAt = (event: PointerEvent, intent: GlobePickIntent) => {
      if (!group.current) return null;
      return pickLandmarkAtPointer(
        camera,
        event.offsetX,
        event.offsetY,
        globeLayoutSize(el),
        directions,
        group.current,
        intent,
      );
    };

    const hoverAt = (event: PointerEvent) => {
      const courseId = pickAt(event, "hover");
      setHoveredCourseId(courseId);
      return courseId;
    };

    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      dragging.current = true;
      dragMoved.current = false;
      lastPointer.current = { x: event.clientX, y: event.clientY };
      dragOrigin.current = lastPointer.current;
      el.setPointerCapture(event.pointerId);
    };

    const pointerMove = (event: PointerEvent) => {
      if (!dragging.current) {
        const courseId = hoverAt(event);
        document.body.style.cursor = courseId ? "pointer" : "grab";
        return;
      }
      const x = event.clientX;
      const y = event.clientY;
      if (!dragMoved.current) {
        const travel = Math.hypot(x - dragOrigin.current.x, y - dragOrigin.current.y);
        if (travel < DRAG_THRESHOLD_PX) {
          hoverAt(event);
          return;
        }
        dragMoved.current = true;
        setHoveredCourseId(null);
        interacting.current = true;
        onPointerInteractionChange(true);
        document.body.style.cursor = "grabbing";
      }
      const dx = x - lastPointer.current.x;
      const dy = y - lastPointer.current.y;
      lastPointer.current = { x, y };
      spinRef.current(dx * 0.006, dy * 0.006);
    };

    const pointerUp = (event: PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      dragMoved.current = false;
      if (el.hasPointerCapture(event.pointerId)) {
        el.releasePointerCapture(event.pointerId);
      }
      const courseId = pickAt(event, "click");
      const travel = Math.hypot(
        event.clientX - dragOrigin.current.x,
        event.clientY - dragOrigin.current.y,
      );
      const action = resolveGlobePointerUp({
        facingLandmarkId: courseId,
        travelPx: travel,
      });
      setHoveredCourseId(courseId);
      document.body.style.cursor = courseId ? "pointer" : "grab";
      if (action.type === "select") {
        onActiveCourseChange(action.courseId);
      } else if (action.type === "settle") {
        settleRef.current();
      }
      interacting.current = false;
      onPointerInteractionChange(false);
    };

    const pointerLeave = () => {
      if (dragging.current) return;
      setHoveredCourseId(null);
      document.body.style.cursor = "auto";
    };

    el.addEventListener("pointerdown", pointerDown);
    el.addEventListener("pointermove", pointerMove);
    el.addEventListener("pointerup", pointerUp);
    el.addEventListener("pointercancel", pointerUp);
    el.addEventListener("pointerleave", pointerLeave);
    return () => {
      el.removeEventListener("pointerdown", pointerDown);
      el.removeEventListener("pointermove", pointerMove);
      el.removeEventListener("pointerup", pointerUp);
      el.removeEventListener("pointercancel", pointerUp);
      el.removeEventListener("pointerleave", pointerLeave);
    };
  }, [camera, directions, gl.domElement, host, onActiveCourseChange, onPointerInteractionChange]);

  return (
    <group ref={group} position={[0, -0.7, 0]}>
      {resources ? (
        <>
          <GlobeTerrain
            terrainAtlas={resources.terrainAtlas}
            geometry={resources.terrainGeometry}
          />
          <GlobeOcean
            terrainAtlas={resources.terrainAtlas}
            geometry={resources.waterGeometry}
            reducedMotion={reducedMotion}
          />
        </>
      ) : null}
      <GlobeShips reducedMotion={reducedMotion} />
      <GlobeRoutes
        activeCourseId={activeCourseId}
        courses={courses}
        directions={directions}
        theme={theme}
      />
      <GlobeTowns
        courses={courses}
        directions={directions}
        activeCourseId={activeCourseId}
        hoveredCourseId={hoveredCourseId}
        night={theme === "dark"}
      />
      <GlobeCreatures
        courses={courses}
        directions={directions}
        activeCourseId={activeCourseId}
        reducedMotion={reducedMotion}
      />
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS + 2.4, 48, 32]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function CourseGlobeScene({
  courses,
  activeCourseId,
  theme,
  reducedMotion,
  onActiveCourseChange,
  onCourseTownOpen,
  onLandmarkAnchor,
  onHoverCourse,
  onPointerInteractionChange,
  spinApi,
  host = null,
}: CourseGlobeSceneProps) {
  const layoutKey = courses
    .map((course) => course.id)
    .sort()
    .join("\u0000");
  const directions = useMemo(() => {
    const values = seededCourseDirections(
      courses.map((course) => course.id),
      LAYOUT_SEED,
    );
    return new Map(
      courses.map(
        (course, index) =>
          [course.id, values[index]] as [string, UnitDirection],
      ),
    );
    // The key includes every id that affects the deterministic layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  return (
    <>
      <SceneTheme theme={theme} />
      <Lights theme={theme} />
      <AutoFitCamera />
      <StarField theme={theme} />
      <OrbitingGlobe
        courses={courses}
        activeCourseId={activeCourseId}
        directions={directions}
        theme={theme}
        reducedMotion={reducedMotion}
        onActiveCourseChange={onActiveCourseChange}
        onCourseTownOpen={onCourseTownOpen}
        onLandmarkAnchor={onLandmarkAnchor}
        onHoverCourse={onHoverCourse}
        onPointerInteractionChange={onPointerInteractionChange}
        spinApi={spinApi}
        host={host}
      />
    </>
  );
}
