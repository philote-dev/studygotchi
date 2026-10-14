"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { Canvas, createPortal, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { qaEnabled } from "@/lib/graph/parity/dev-api";
import { useStore } from "@/lib/store";
import { useReducedMotion, useSpaceAttribute } from "@/components/shell/useSpaceAttribute";
import { useStage, useStageDirector } from "../../StageContext";
import { condenseFromL, enterFromL, type CondenseAnchor } from "@/lib/graph/twin/condense";
import { createConstellationOverlayPass, type ConstellationOverlayPass } from "./overlay-pass";
import { createTwinController, type TwinController } from "./twin-controller";
import { installTwinDevApi } from "./twin-dev-api";
import { TwinRuntime } from "./twin-runtime";
import { TwinLabels } from "./TwinLabels";
import { TwinScene } from "./TwinScene";
import "./twin.css";

function useTwinController(): TwinController {
  const controller = useMemo(createTwinController, []);
  useEffect(() => {
    // Measured widths change when the label faces finish loading.
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) controller.invalidate();
    });
    const onLoaded = () => controller.invalidate();
    document.fonts?.addEventListener("loadingdone", onLoaded);
    return () => {
      cancelled = true;
      document.fonts?.removeEventListener("loadingdone", onLoaded);
    };
  }, [controller]);
  return controller;
}

/** The runtime, subscribed to the bridge for the component's life, with the live theme. */
function useTwinRuntime(controller: TwinController): TwinRuntime {
  const runtime = useMemo(() => new TwinRuntime(), []);
  const theme = useSpaceAttribute();
  runtime.theme = theme;
  runtime.reducedMotion = useReducedMotion();
  useEffect(() => runtime.start(), [runtime]);
  useEffect(() => {
    // Keep the last label placement on the runtime: cluster-label hit boxes.
    return controller.subscribe((output) => {
      runtime.placement = output?.labels ?? null;
    });
  }, [controller, runtime]);
  return runtime;
}

/**
 * STANDALONE mode (what the parity captures use): the twin in its own
 * transparent R3F canvas, positioned exactly over the 2D constellation canvas's
 * box (`.sg-twin` is `inset: 0` of the same `.sg-page`), full resolution, with
 * the DOM label layer inside the same element so a screenshot of `.sg-twin` is
 * the whole twin. Mounted on /knowledge behind the `twin` flag. The twin is the
 * input surface while on (the hidden 2D canvas lets pointer events through):
 * pan, zoom, hover, select, node drag, cluster-label focus and file drop run
 * the same code paths as the 2D canvas, against the same store.
 */
export interface ConstellationTwinProps {
  /** T-4: 0 = the full graph, 1 = collapsed into its galaxy bead at `anchor` (default: box centre, course bead radius). */
  condense?: number;
  /** T-4: 0 = collapsed at the planet's screen point (`planetAnchor`), 1 = the full graph. */
  enter?: number;
  anchor?: CondenseAnchor | null;
  planetAnchor?: CondenseAnchor | null;
  /**
   * S2-3 / S3-2: a per-frame driver (the hop) that writes `condense`, `enter`
   * and the anchors on the runtime and the twin's opacity on its root element,
   * before the scene reads the frame. When set, the props above are ignored.
   */
  drive?: TwinDrive | null;
}

export type TwinDrive = (runtime: TwinRuntime, root: HTMLElement | null) => void;

/** Runs the hop's driver inside the twin's own frame loop, before `TwinScene` reads the runtime (-1). */
function TwinDriveStep({ drive, runtime, root }: { drive: TwinDrive; runtime: TwinRuntime; root: React.RefObject<HTMLDivElement | null> }) {
  useFrame(() => drive(runtime, root.current), -2);
  return null;
}

export function ConstellationTwin({ condense = 0, enter = 1, anchor = null, planetAnchor = null, drive = null }: ConstellationTwinProps = {}) {
  const controller = useTwinController();
  const runtime = useTwinRuntime(controller);
  if (!drive) {
    runtime.condense = condense;
    runtime.enter = enter;
    runtime.galaxyAnchor = anchor;
    runtime.planetAnchor = planetAnchor;
  }
  const { addUploads } = useStore();
  const camera = useMemo(() => {
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100) as THREE.OrthographicCamera & { manual?: boolean };
    cam.position.set(0, 0, 10);
    // R3F: do not re-fit this camera on resize; TwinScene sets the frustum from the 2D camera every frame.
    cam.manual = true;
    return cam;
  }, []);
  const read = useCallback(() => runtime.frame(), [runtime]);
  const [ready, setReady] = useState(false);
  const [dropping, setDropping] = useState(false);
  const onDrawn = useCallback(() => setReady(true), []);
  const root = useRef<HTMLDivElement>(null);

  // The twin measures its own box like the 2D canvas measures its wrap.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    runtime.element = el;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      runtime.resize({ w: rect.width, h: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (runtime.element === el) runtime.element = null;
    };
  }, [runtime]);

  // The parity controller (development, or ?qa=1).
  useEffect(() => {
    if (!qaEnabled(window.location.search, process.env.NODE_ENV)) return;
    return installTwinDevApi(runtime, () => Math.min(window.devicePixelRatio || 1, 2));
  }, [runtime]);

  const cursor = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.style.cursor = runtime.cursor;
  };
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      runtime.pointerDown(e);
      cursor(e);
    },
    [runtime],
  );
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      runtime.pointerMove(e);
      cursor(e);
    },
    [runtime],
  );
  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      runtime.pointerUp(e);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
      cursor(e);
    },
    [runtime],
  );
  const onPointerLeave = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      runtime.pointerLeave();
      cursor(e);
    },
    [runtime],
  );
  const onWheel = useCallback((e: WheelEvent<HTMLDivElement>) => runtime.wheel(e), [runtime]);

  // File drop, as KnowledgeWorkspace's: the hidden 2D canvas no longer receives it.
  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropping(true);
  }, []);
  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDropping(false);
  }, []);
  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDropping(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      addUploads(files, "student_self", "student_notes");
    },
    [addUploads],
  );

  return (
    <div
      ref={root}
      className="sg-twin"
      data-on="true"
      data-mode="standalone"
      data-ready={ready ? "1" : undefined}
      style={{ cursor: "grab" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onWheel={onWheel}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Canvas
        dpr={[1, 2]}
        flat
        frameloop="always"
        camera={camera}
        gl={{ alpha: true, antialias: false, premultipliedAlpha: true, depth: false, stencil: false, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          gl.autoClear = true;
        }}
        style={{ pointerEvents: "none" }}
        fallback={null}
      >
        {drive ? <TwinDriveStep drive={drive} runtime={runtime} root={root} /> : null}
        <TwinScene controller={controller} read={read} camera={camera} onDrawn={onDrawn} />
      </Canvas>
      <TwinLabels controller={controller} />
      {dropping ? <div className="sg-constellation-drop" aria-hidden /> : null}
    </div>
  );
}

/** Drives `condense` / `enter` from the stage director's altitude each frame (before the scene reads the runtime). */
function DirectorDrive({ runtime }: { runtime: TwinRuntime }) {
  const director = useStageDirector();
  useFrame(() => {
    const { L } = director.sample();
    runtime.condense = condenseFromL(L);
    runtime.enter = enterFromL(L);
  }, -2);
  return null;
}

/**
 * OVERLAY mode: the twin as a layer of the persistent stage canvas, rendered by
 * `overlay-pass.ts` after the pixel composite. Mount inside `StageCanvas`'s
 * `<Canvas>` once `StageComposer` calls `frame.current.overlay?.render(gl)`;
 * the input surface and the DOM labels then live in a page-side host that
 * receives the controller and runtime through `onReady`.
 */
export function TwinOverlayLayer({ onReady }: { onReady?: (controller: TwinController, runtime: TwinRuntime) => void }) {
  const { frame } = useStage();
  const controller = useTwinController();
  const runtime = useTwinRuntime(controller);
  const pass = useMemo(createConstellationOverlayPass, []);
  const read = useCallback(() => runtime.frame(), [runtime]);

  useEffect(() => {
    onReady?.(controller, runtime);
  }, [controller, runtime, onReady]);

  useEffect(() => {
    const f = frame.current as (typeof frame.current & { overlay?: ConstellationOverlayPass | null }) | null;
    if (!f) return;
    f.overlay = pass;
    return () => {
      if (f.overlay === pass) f.overlay = null;
      pass.dispose();
    };
  }, [frame, pass]);

  return createPortal(
    <>
      <DirectorDrive runtime={runtime} />
      <TwinScene controller={controller} read={read} camera={pass.camera} />
    </>,
    pass.scene,
  );
}
