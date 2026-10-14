"use client";

import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal, useFrame, useThree, type RootState } from "@react-three/fiber";
import * as THREE from "three";
import { BiomeConceptLayer } from "@/components/world/biomes/BiomeConceptLayer";
import { IceTownMount } from "@/components/world/biomes/ice-town/Mount";
import { risePose } from "@/components/world/biomes/ice-town/camera/CameraRig";
import { ICE_LOOK_AT, STATIONS, type Pose } from "@/components/world/biomes/ice-town/camera/stations";
import type { CatastropheEvent } from "@/components/world/biomes/ice-town/scene/catastrophe-sequence";
import { BiomeStageHostContext, type BiomeStageHost } from "@/components/world/biomes/stage-host";
import { iceLandParams } from "@/lib/world/land-build";
import { useLandBuilt } from "@/lib/world/land-build-hooks";
import { landMark } from "@/lib/world/land-marks";
import type { CanvasWorld } from "@/lib/world/types";
import { useHop } from "../hop/HopProvider";
import type { HostViewport, WorldPass } from "../render/StageComposer";
import { useStage, useStageDirector } from "../StageContext";
import { readHostViewport } from "./PlanetLayer";
import { ICE_TOWN_STAGE_GRAIN } from "./world/world-layer-model";

export interface WorldLayerProps {
  /** The page-side `[data-land-mount]` div: pointer input lands here and the pass is drawn inside its box. */
  host: HTMLElement;
  progress: number;
  focusDistrict?: string | null;
  result?: CatastropheEvent;
  onFocusDistrict?: (id: string | null) => void;
  world?: CanvasWorld | null;
  selectedId?: string | null;
  hoveredId?: string | null;
  changedIds?: ReadonlySet<string>;
  onSelect?(conceptId: string | null): void;
  onHover?(conceptId: string | null): void;
}

/** The land canvas's camera defaults (`DevelopedBiomeCanvas`); `BoundedIceCamera` seats it from here. */
const LAND_CAMERA = { fov: 36, near: 0.5, far: 3000, position: [18, 78, 188] as const, lookAt: [2, 2.4, 8] as const };

/**
 * R3F's DOM event names for the root event manager's handlers (`DOM_EVENTS` in
 * fiber's web events). The stage canvas takes no pointer events, so the layer
 * listens on its page-side host with the same handlers; portal objects then
 * raycast with this layer's camera through the `compute` override below.
 */
const HOST_EVENTS: readonly [name: string, event: string, passive: boolean][] = [
  ["onClick", "click", false],
  ["onContextMenu", "contextmenu", false],
  ["onDoubleClick", "dblclick", false],
  ["onPointerDown", "pointerdown", true],
  ["onPointerUp", "pointerup", true],
  ["onPointerLeave", "pointerleave", true],
  ["onPointerMove", "pointermove", true],
  ["onPointerCancel", "pointercancel", true],
  ["onLostPointerCapture", "lostpointercapture", true],
];

/** Height (land units) of the look target the rig's station poses sit on: the overview's look-at plus its lift. */
const LOOK_HEIGHT = ICE_LOOK_AT[1] + STATIONS.overview.targetLift;
const RISE_EPS = 1e-4;

/**
 * Where the land camera is looking: its forward ray meets the look plane
 * (the station target's height), or a point `fallback` ahead when the ray
 * misses (looking up). `out` is the result.
 */
function lookTarget(camera: THREE.PerspectiveCamera, out: THREE.Vector3, dir: THREE.Vector3, fallback = 180): THREE.Vector3 {
  camera.getWorldDirection(dir);
  const t = dir.y < -1e-4 ? (LOOK_HEIGHT - camera.position.y) / dir.y : fallback;
  return out.copy(dir).multiplyScalar(Math.min(fallback * 4, Math.max(1, t))).add(camera.position);
}

/**
 * S4-1 (permanent since gate 4, 2026-10-13): the open ice land re-parented
 * into the persistent stage. The existing ice-town scene graph
 * (`IceTownMount` -> `BiomeScene`: sky blend, terrain, structures, residents,
 * storm wind, catastrophe, hover and the bounded camera rig) renders
 * unchanged into a scene of its own with its own camera, through an R3F
 * portal; the stage composer draws that scene through the land's pixel pass
 * at the land's grain and composites it inside the host's box. Pointer input,
 * the cursor, drag controls and DOM labels all go through the host.
 *
 * While mounted and at rest the director sits on the world rung (a teleport
 * on a cold `?land=` load); on unmount at rest it returns to the planet.
 * Mid-flight (the rise, when the land's page goes once the clouds have
 * closed; the dive, when it mounts under the deck) it leaves the spring alone.
 *
 * The cloud pass-through, both ways: while the hop's `world.rise` is above 0
 * the pass is drawn through a path camera on the dive path (`risePose`,
 * 0 the land's own camera pose, 1 the top): climbing, from wherever the land
 * camera was when the hop began; diving, from the station pose the rig seats
 * the land at when it mounts, down which the camera breaks out beneath the
 * clouds onto the island and hands over to the rig at 0. The land's own
 * camera rig (CameraControls) is untouched: it rewrites its camera every
 * frame, and the path camera lands exactly on it. The land reports ready
 * (`readiness.world`) after its first composited frame, which the dive waits
 * for inside the deck (`CLOUD_HOLD`).
 */
export function WorldLayer({
  host,
  progress,
  focusDistrict = null,
  result = "idle",
  onFocusDistrict,
  world = null,
  selectedId = null,
  hoveredId = null,
  changedIds,
  onSelect = () => undefined,
  onHover = () => undefined,
}: WorldLayerProps) {
  const { frame, registry } = useStage();
  const director = useStageDirector();
  const hop = useHop();
  const gl = useThree((s) => s.gl);
  const events = useThree((s) => s.events);
  const scene = useMemo(() => new THREE.Scene(), []);
  const camera = useMemo(() => {
    const c = new THREE.PerspectiveCamera(LAND_CAMERA.fov, 1, LAND_CAMERA.near, LAND_CAMERA.far);
    c.position.set(...LAND_CAMERA.position);
    c.lookAt(...LAND_CAMERA.lookAt);
    c.updateMatrixWorld();
    return c;
  }, []);
  const pass = useMemo<WorldPass>(
    () => ({
      scene,
      camera,
      normalEdgeStrength: ICE_TOWN_STAGE_GRAIN.normalEdgeStrength,
      depthEdgeStrength: ICE_TOWN_STAGE_GRAIN.depthEdgeStrength,
      viewport: null,
      frames: 0,
      compiled: null,
    }),
    [scene, camera],
  );
  const box = useMemo<HostViewport>(() => ({ x: 0, y: 0, w: 1, h: 1, opacity: 1 }), []);
  // The land's pure build (the plate's heightfield, the outer shelf, every placement) runs in the
  // land build Worker from the hover / settle prefetch (`lib/world/land-build.ts`); the scene
  // mounts only once it has landed, so the mount is an assembly of three.js objects, not a
  // 1.9 s stall. On a dive it also waits for the cloud deck to be whole (or the director parked /
  // resting / tweening under reduced motion), so no mount lands on the planet mid-descent.
  const landParams = useMemo(() => iceLandParams(progress), [progress]);
  const built = useLandBuilt(landParams);
  // Sticky: once the land is up, a progress change into another growth band (the payload landing
  // after a default-band mount) must not unmount it while that band's plate is built; `Terrain`
  // keeps the previous plate until the new one lands, and the hook above starts the build.
  const builtOnce = useRef(false);
  if (built) builtOnce.current = true;
  const [deckWhole, setDeckWhole] = useState(() => !director.sample().moving);
  const build = deckWhole && (built || builtOnce.current);
  // Once the real scene is in the graph (after this commit, before the next frame), let the composer
  // compile it in parallel before its first draw; `pending` until then keeps the empty scene from
  // counting as compiled.
  useLayoutEffect(() => {
    if (build) {
      pass.compiled = null;
      landMark("mounted");
    }
  }, [build, pass]);
  const stageHost = useMemo<BiomeStageHost>(() => ({ element: host, ref: { current: host } as RefObject<HTMLElement> }), [host]);
  // The path camera and the land pose the path starts from (captured on the first frame above the land).
  const rise = useMemo(() => ({ camera: new THREE.PerspectiveCamera(LAND_CAMERA.fov, 1, LAND_CAMERA.near, LAND_CAMERA.far), from: null as Pose | null, target: new THREE.Vector3(), dir: new THREE.Vector3() }), []);

  useEffect(() => {
    registry.register("world", scene);
    const f = frame.current;
    if (f) f.world = pass;
    // A cold `?land=` load: the director is in the world now. A dive in flight leaves the spring alone.
    if (!director.sample().moving) director.teleport("world");
    return () => {
      registry.register("world", null);
      director.readiness.set("world", false);
      const cur = frame.current;
      if (cur && cur.world === pass) cur.world = null;
      // Leaving the land at rest (nothing in flight): back on the planet. On the spring (the land's
      // page goes under the clouds) the director is already on its way.
      const s = director.sample();
      if (!s.moving && s.rung === "world") director.teleport("planet");
    };
  }, [registry, scene, frame, pass, director]);

  // The stage canvas takes no pointer events: feed the root event manager from the host.
  useEffect(() => {
    const handlers = events.handlers as Record<string, EventListener> | undefined;
    if (!handlers) return;
    const bound: [string, EventListener, AddEventListenerOptions][] = [];
    for (const [name, event, passive] of HOST_EVENTS) {
      const handler = handlers[name];
      if (!handler) continue;
      const options = { passive };
      host.addEventListener(event, handler, options);
      bound.push([event, handler, options]);
    }
    return () => {
      for (const [event, handler, options] of bound) host.removeEventListener(event, handler, options);
    };
  }, [events, host]);

  // Pointer -> this layer's camera, in the host's box (not the stage canvas's).
  const compute = useMemo(
    () => (event: { clientX: number; clientY: number }, state: RootState) => {
      const rect = host.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) return;
      state.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      state.raycaster.setFromCamera(state.pointer, camera);
    },
    [host, camera],
  );

  const deckMarked = useRef(false);
  // Before the land's own frame callbacks (0) and the composer (1): where to draw this frame.
  useFrame(() => {
    const v = readHostViewport(host, gl.domElement, box);
    pass.viewport = v;
    if (!deckWhole) {
      const s = director.sample();
      if (hop.runtime.state.world.clouds >= 0.999 || s.held || !s.moving || director.reducedMotion) {
        pass.compiled = "pending";
        if (!deckMarked.current) landMark("deck-whole");
        deckMarked.current = true;
        // A transition: React time-slices the scene's render (~5 ms units, yielding to the frame
        // loop), so the deck keeps drifting while the land's objects are created under it.
        startTransition(() => setDeckWhole(true));
      }
    }
    if (!v) return;
    const aspect = (v.w * gl.domElement.clientWidth) / Math.max(1, v.h * gl.domElement.clientHeight);
    if (Number.isFinite(aspect) && Math.abs(camera.aspect - aspect) > 1e-4) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    // The dive path, both ways: above the land the pass looks through the path camera, between the
    // pose the land camera has (had) at the bottom and the top of the dive path; 0 under reduced
    // motion (the crossfade keeps the land at its station).
    const t = hop.runtime.state.world.rise;
    // The path starts from the rig's station pose: nothing to capture until the land is built.
    if (!build || t <= RISE_EPS) {
      rise.from = null;
      pass.camera = camera;
      return;
    }
    if (!rise.from) {
      camera.updateMatrixWorld();
      const look = lookTarget(camera, rise.target, rise.dir);
      rise.from = { position: [camera.position.x, camera.position.y, camera.position.z], target: [look.x, look.y, look.z] };
    }
    const pose = risePose(rise.from, t);
    const rc = rise.camera;
    rc.position.set(...pose.position);
    rc.up.copy(camera.up);
    rc.lookAt(...pose.target);
    if (rc.fov !== camera.fov || rc.aspect !== camera.aspect || rc.near !== camera.near || rc.far !== camera.far) {
      rc.fov = camera.fov;
      rc.aspect = camera.aspect;
      rc.near = camera.near;
      rc.far = camera.far;
      rc.updateProjectionMatrix();
    }
    rc.updateMatrixWorld();
    pass.camera = rc;
  }, -1);

  // After the composer (1): ready once the real scene is built and its programs have compiled (in
  // parallel, `WorldPass.compiled`); the dive's hold releases on this, the first composite follows
  // under the deck (and under reduced motion the crossfade only starts fading the land in now).
  const reported = useRef(false);
  useFrame(() => {
    if (build && pass.compiled === "done" && pass.viewport) {
      if (!reported.current) {
        reported.current = true;
        landMark("ready");
      }
      director.readiness.set("world", true);
    }
  }, 2);

  return createPortal(
    build ? (
      <BiomeStageHostContext.Provider value={stageHost}>
        <IceTownMount stage progress={progress} focusDistrict={focusDistrict} result={result} onFocusDistrict={onFocusDistrict} />
        <BiomeConceptLayer
          visual="ice-town"
          world={world}
          selectedId={selectedId}
          hoveredId={hoveredId}
          changedIds={changedIds}
          onSelect={onSelect}
          onHover={onHover}
        />
      </BiomeStageHostContext.Provider>
    ) : null,
    scene,
    { camera, events: { compute } },
  );
}
