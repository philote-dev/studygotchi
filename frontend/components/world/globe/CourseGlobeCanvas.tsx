"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PerformanceMonitor } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { globeLayoutSize } from "./globe-pick";
import { CourseGlobeScene, type GlobeSpinApi } from "./CourseGlobeScene";
import {
  adjacentCourseId,
  createSettleScheduler,
  isInteractiveKeyboardTarget,
  keyboardNavigationStep,
  normalizeWheelSpin,
} from "./globe-input";
import { diveOriginFromAnchor } from "./globe-dive";
import type { CourseGlobeCanvasProps } from "./globe-types";
import "./globe.css";

export type { CourseGlobeCanvasProps } from "./globe-types";

function SyncLayoutSize() {
  const gl = useThree((state) => state.gl);
  const setSize = useThree((state) => state.setSize);

  useLayoutEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;
    const sync = () => {
      const { width, height } = globeLayoutSize(parent);
      setSize(width, height);
      gl.setSize(width, height, false);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [gl, setSize]);

  return null;
}

export default function CourseGlobeCanvas({
  courses,
  activeCourseId,
  theme,
  arriving,
  diving,
  rising,
  diveAnchor,
  reducedMotion,
  onActiveCourseChange,
  onCourseTownOpen,
  onLandmarkAnchor,
}: CourseGlobeCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const spinApi = useRef<GlobeSpinApi | null>(null);
  const pointerInteractingRef = useRef(false);
  const settleSchedulerRef = useRef<ReturnType<
    typeof createSettleScheduler
  > | null>(null);
  const [dpr, setDpr] = useState<[number, number]>([1, 2]);
  const [frameloop, setFrameloop] = useState<"always" | "demand">(
    "always",
  );
  const [arriveReady, setArriveReady] = useState(false);
  const courseIds = useMemo(
    () => courses.map((course) => course.id),
    [courses],
  );
  const handlePointerInteractionChange = useCallback(
    (pointerInteracting: boolean) => {
      pointerInteractingRef.current = pointerInteracting;
      if (pointerInteracting) settleSchedulerRef.current?.cancel();
    },
    [],
  );

  useEffect(() => {
    const syncFrameloop = () => {
      setFrameloop(document.hidden ? "demand" : "always");
    };
    syncFrameloop();
    document.addEventListener("visibilitychange", syncFrameloop);
    return () => {
      document.removeEventListener("visibilitychange", syncFrameloop);
    };
  }, []);

  useEffect(() => {
    if (!arriving) {
      setArriveReady(false);
      return;
    }
    const timer = window.setTimeout(() => setArriveReady(true), 0);
    return () => window.clearTimeout(timer);
  }, [arriving]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const settleScheduler = createSettleScheduler(() => {
      spinApi.current?.settle();
    }, () => !pointerInteractingRef.current);
    settleSchedulerRef.current = settleScheduler;
    const handleWheel = (event: WheelEvent) => {
      if (!spinApi.current) return;
      event.preventDefault();
      const [horizontal, vertical] = normalizeWheelSpin(
        event.deltaX,
        event.deltaY,
      );
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
  }, []);

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

      const destination = adjacentCourseId(
        courseIds,
        activeCourseId,
        step,
      );
      if (!destination || destination === activeCourseId) return;
      event.preventDefault();
      onActiveCourseChange(destination);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeCourseId, courseIds, onActiveCourseChange]);

  const origin = diveOriginFromAnchor(diveAnchor, {
    width: typeof window === "undefined" ? 1 : window.innerWidth,
    height: typeof window === "undefined" ? 1 : window.innerHeight,
  });

  return (
    <div
      ref={hostRef}
      className="course-globe-stage"
      data-arriving={arriving && arriveReady}
      data-diving={diving}
      data-rising={rising}
      data-reduced-motion={reducedMotion}
      data-theme={theme}
      style={{
        position: "absolute",
        inset: 0,
        ...(diving
          ? {
              ["--dive-origin-x" as string]: origin.x,
              ["--dive-origin-y" as string]: origin.y,
            }
          : {}),
      }}
    >
      <Canvas
        className="course-globe-canvas"
        dpr={dpr}
        frameloop={frameloop}
        camera={{ position: [0, 4, 30], fov: 26, near: 0.1, far: 80 }}
        gl={{
          antialias: false,
          alpha: true,
          powerPreference: "high-performance",
        }}
        fallback={
          <div
            className="course-globe-fallback"
            role="img"
            aria-label="Course globe unavailable"
          />
        }
      >
        <PerformanceMonitor onDecline={() => setDpr([1, 1])} />
        <SyncLayoutSize />
        <CourseGlobeScene
          courses={courses}
          activeCourseId={activeCourseId}
          theme={theme}
          diving={diving}
          reducedMotion={reducedMotion}
          onActiveCourseChange={onActiveCourseChange}
          onCourseTownOpen={({ courseId, anchor }) =>
            onCourseTownOpen(courseId, anchor)
          }
          onLandmarkAnchor={onLandmarkAnchor}
          onPointerInteractionChange={handlePointerInteractionChange}
          spinApi={spinApi}
        />
      </Canvas>
    </div>
  );
}
