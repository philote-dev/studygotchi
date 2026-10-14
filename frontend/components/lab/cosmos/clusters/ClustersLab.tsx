"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { cellsPerUnitAt, type BlobBuffers, type BlobGraph, type BlobParams } from "@/lib/galaxy/blobs";
import type { Rect } from "@/lib/galaxy/flags";
import { armsFromSpec, generateGalaxyLayout, type GalaxyLayout, type LayoutCourse } from "@/lib/galaxy/layout";
import { SKY } from "@/lib/galaxy/palettes";
import { BLOB_PLACEMENT_MODES, blobOverlaps, placeBlobs, type BlobPlacementMode } from "@/lib/galaxy/placement";
import { generateGalaxySpec, type GalaxySpec } from "@/lib/galaxy/spec";
import { distanceAt, fovAt, GALAXY_WORLD_RADIUS } from "@/lib/stage/altitude";
import { seedFromText } from "@/lib/stage/rng";
import type { CourseBlobsApi } from "@/components/stage/layers/galaxy/CourseBlobs";
import { BULGE_KEEP_OUT_SIGMAS, CourseFlags, createFlagBus, lastFlagSolve, useFlagEntries, type FlagBus, type FlagCourse, type FlagFrameAnchor } from "@/components/stage/layers/galaxy/CourseFlags";
import { GalaxyLayer } from "@/components/stage/layers/galaxy/GalaxyLayer";
import { galaxyDistance, galaxySizeAt, STAGE_FOV_DEG, type GalaxyLayerBudget } from "@/components/stage/layers/galaxy/galaxy-layer-model";
import { createStageFrame, StageComposer, type StageFrame } from "@/components/stage/render/StageComposer";
import { createStageRegistry, StageContext, type StageApi } from "@/components/stage/StageContext";
import { STAGE_UNIFORMS, stageClock, type StageTheme } from "@/components/stage/lib/uniforms";
import { STAGE_CAMERA } from "@/components/stage/lib/view";
import { FAKE_COURSES } from "@/components/lab/cosmos/layout/fake-courses";
import { courseGraphsFor, type CourseGraph } from "./course-graphs";
import "./clusters-lab.css";

function blobOverlapCount(layout: GalaxyLayout, blobScale: number): string {
  const pairs = blobOverlaps(layout, blobScale);
  return pairs.length === 0 ? "none" : pairs.map(([a, b]) => `${a}/${b}`).join(", ");
}

export type FlagsMode = "hover" | "current" | "all";
export const FLAGS_MODES: readonly FlagsMode[] = ["hover", "current", "all"];

export interface ClustersLabInitial {
  theme: StageTheme;
  seed: string;
  /** Galaxy altitude on the stage ladder, 2.6 .. 3.2 (3 = galaxy rest). */
  L: number;
  /** Condense of the current course's blob, 0 full blob .. 1 its core glow. */
  condense: number;
  /** Node LOD: concepts below this weight are not drawn (0 = every concept). */
  nodeWeight: number;
  courses: 8 | 12;
  chrome: boolean;
  /** Freeze the stage clock at this ms (deterministic captures). */
  t: number | null;
  /** Where the blobs go: `mixed` (default), `arms` or `halo`. */
  placement: BlobPlacementMode;
  /** Blob radius / bead radius, 1.0 .. 1.8. */
  blobScale: number;
  /** Plummer core radius in blob radii, 0.2 .. 0.6. */
  blobCore: number;
  /** Depth semi-axis / blob radius, 0.3 .. 1. */
  blobDepth: number;
  /** Backbone threads per course, 0 .. 5 (0 = none). */
  threads: number;
  /** The bead glow's radius as a fraction of the bead radius (the blob's core glow). */
  coreGlow: number;
  /** How much the far third of a blob dims, 0 .. 0.7. */
  depthDim: number;
  /** Which flags are up: the hovered blob's, the current course's (plus hover), or every course's. */
  flags: FlagsMode;
  /** Hover this course from the start (captures). */
  hover: string | null;
  /** Centre the stage on the current course's blob (frozen frames; the pattern is at t = 0 then). */
  focus: "current" | null;
  /** With `focus`: choose the camera distance so the current BEAD is this many CSS px wide. */
  beadPx: number | null;
  /** Render the stage in a centred square box of this many CSS px (the product's 112 px corner). */
  box: number | null;
  /** Disc diameter as a fraction of the stage height; overrides `L` (1 = the disc fills the box). */
  disc: number | null;
  /** Stand-ins only: skip the settled synthetic graphs and show every course as its seeded stand-in (the product's first frame). */
  standIns: boolean;
}

export const CURRENT_COURSE_ID = "8.223";
/** Synthetic course graphs are seeded per course id on top of this, independent of the galaxy seed, so a reroll moves beads but keeps each course's sky. */
const GRAPH_SEED = 0x5eed;
/** CSS px per stage cell (the composer's 2 px pixel pass). */
const CELL_PX = 2;
/** Smallest `box` (CSS px) that still shows flags; the 112 px corner has no room for a card. */
const MIN_FLAG_BOX = 240;

/** Twelve active courses (the outer-zone lab's term with its archived flags cleared); 8 = the first eight. */
export const AB_COURSES: readonly LayoutCourse[] = FAKE_COURSES.map((c) => ({ ...c, archived: false, current: c.id === CURRENT_COURSE_ID }));

/** Disc diameter as a fraction of the viewport height at altitude L (the stage ladder's distance and fov). */
export function galaxySizeAtL(L: number): number {
  return GALAXY_WORLD_RADIUS / (distanceAt(L) * Math.tan((fovAt(L) * Math.PI) / 360));
}

/** "8.223 Classical Mechanics II" -> "Classical Mechanics II" (the code goes on the flag's tab). */
export function courseTitle(course: LayoutCourse): string {
  return course.name.startsWith(`${course.id} `) ? course.name.slice(course.id.length + 1) : course.name;
}

interface RenderStats {
  calls: number;
  points: number;
  triangles: number;
}

/** Counts the scene's draw calls per frame (the composer's upscale quad excluded) and freezes the clock when asked. */
function StageProbe({ frozenT, onStats }: { frozenT: number | null; onStats: (s: RenderStats) => void }) {
  const gl = useThree((s) => s.gl);
  const last = useRef<RenderStats>({ calls: -1, points: -1, triangles: -1 });
  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
  useFrame(() => gl.info.reset(), -20);
  useFrame(() => {
    if (frozenT === null) return;
    stageClock.seconds = frozenT / 1000;
    STAGE_UNIFORMS.uTime.value = frozenT / 1000;
  }, -5);
  useFrame(() => {
    const r = gl.info.render;
    const next = { calls: Math.max(0, r.calls - 1), points: r.points, triangles: r.triangles };
    const p = last.current;
    if (next.calls !== p.calls || next.points !== p.points || next.triangles !== p.triangles) {
      last.current = next;
      onStats(next);
    }
  }, 2);
  return null;
}

export interface HoverInfo {
  courseId: string;
  /** CSS px inside the stage box. */
  x: number;
  y: number;
}

/** Hover through the product's blob-core picking (a ray against each blob's bead radius), from this canvas's own pointer events. */
function HoverProbe({ blobsApi, onHover }: { blobsApi: RefObject<CourseBlobsApi | null>; onHover: (h: HoverInfo | null) => void }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const lastId = useRef<string | null>(null);
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const emit = (h: HoverInfo | null) => {
      const id = h?.courseId ?? null;
      if (id === lastId.current && id === null) return;
      lastId.current = id;
      onHover(h);
    };
    const move = (ev: PointerEvent) => {
      const api = blobsApi.current;
      if (!api) return;
      const rect = el.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      ndc.set((mx / rect.width) * 2 - 1, -(my / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = api.pick(raycaster);
      emit(hit ? { courseId: hit.courseId, x: mx, y: my } : null);
    };
    const leave = () => emit(null);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [gl, camera, blobsApi, onHover]);
  return null;
}

/**
 * Publishes every blob's screen footprint, the galaxy centre and the bulge
 * radius each frame (after the Galaxy has advanced the pattern) so the DOM
 * flags can be re-laid out without React: the same projection `GalaxyRung`
 * runs in the product.
 */
function FlagProjector({ blobsApi, bulgeSigma, bus }: { blobsApi: RefObject<CourseBlobsApi | null>; bulgeSigma: number; bus: FlagBus }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const scratch = useMemo(() => ({ p: new THREE.Vector3(), e: new THREE.Vector3(), anchors: [] as FlagFrameAnchor[] }), []);
  useFrame(() => {
    const api = blobsApi.current;
    const frame = api?.frame;
    if (!api || !frame) return;
    const W = size.width;
    const H = size.height;
    frame.updateWorldMatrix(true, false);
    const toScreen = (v: THREE.Vector3) => {
      scratch.p.copy(v).project(camera);
      return { x: ((scratch.p.x + 1) / 2) * W, y: ((1 - scratch.p.y) / 2) * H };
    };
    const fov = (camera as THREE.PerspectiveCamera).fov ?? STAGE_FOV_DEG;
    const anchors = scratch.anchors;
    anchors.length = 0;
    api.each((course, world, a) => {
      const c = toScreen(world);
      const depth = world.distanceTo(camera.position);
      const pxPerWorld = H / 2 / (depth * Math.tan((fov * Math.PI) / 360));
      anchors.push({ courseId: course.courseId, x: c.x, y: c.y, r: a.blobRadius * pxPerWorld, glowR: a.glowRadius * pxPerWorld });
    });
    const centre = toScreen(scratch.e.set(0, 0, 0).applyMatrix4(frame.matrixWorld));
    let bulgeR = 0;
    const R = bulgeSigma * BULGE_KEEP_OUT_SIGMAS;
    for (let k = 0; k < 8; k++) {
      const t = (k / 8) * Math.PI * 2;
      const p = toScreen(scratch.e.set(R * Math.cos(t), 0, R * Math.sin(t)).applyMatrix4(frame.matrixWorld));
      bulgeR = Math.max(bulgeR, Math.hypot(p.x - centre.x, p.y - centre.y));
    }
    bus.publish({ anchors: anchors.slice(), centre, bulgeR, width: W, height: H });
  }, 1);
  return null;
}

interface SceneProps {
  theme: StageTheme;
  spec: GalaxySpec;
  courses: readonly LayoutCourse[];
  /** The placed layout the Scene expects the layer to produce (for the focus offset). */
  layout: GalaxyLayout;
  /** The settled graphs; courses missing here (or everything while settling) show the layer's seeded stand-ins. */
  graphs: ReadonlyMap<string, BlobGraph> | undefined;
  seed: number;
  distance: number;
  condense: number;
  reducedMotion: boolean;
  params: BlobParams;
  placement: BlobPlacementMode;
  blobScale: number;
  coreGlow: number;
  depthDim: number;
  /** With `focus`, the current blob sits at the stage centre (frozen frame: the pattern angle is 0). */
  focus: "current" | null;
  /** With `focus`: the camera distance that makes the current BEAD this many CSS px wide (2 CSS px per cell). */
  beadPx: number | null;
  bus: FlagBus;
  blobsApi: RefObject<CourseBlobsApi | null>;
  onBuild: (info: { spec: GalaxySpec; layout: GalaxyLayout; budget: GalaxyLayerBudget }, cellsPerUnit: number) => void;
  onHover: (h: HoverInfo | null) => void;
}

/** World offset of a pattern-frame point under the Galaxy's roll and inclination at pattern angle 0 (the frozen frame). */
function focusOffset(spec: GalaxySpec, p: readonly [number, number, number] | null): [number, number] {
  if (!p) return [0, 0];
  const v = new THREE.Vector3(p[0], p[1], p[2]);
  v.applyAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2 - spec.inclination);
  v.applyAxisAngle(new THREE.Vector3(0, 0, 1), spec.roll);
  return [v.x, v.y];
}

/** The product's `GalaxyLayer` at the chosen altitude, with this lab's tuning as its props. */
function Scene({ theme, spec, courses, layout, graphs, seed, distance: ladderDistance, condense, reducedMotion, params, placement, blobScale, coreGlow, depthDim, focus, beadPx, bus, blobsApi, onBuild, onHover }: SceneProps) {
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  // The composer's cell target: `floor(height * dpr / round(2 * dpr))` cells high.
  const cellsHigh = Math.max(1, Math.floor((size.height * dpr) / Math.max(1, Math.round(2 * dpr))));
  // Bead width in CSS px = 2 px/cell * 2 r * cellsPerUnit = 2 r cellsHigh / (d tan(fov/2)); solve for d.
  const distance = focus && beadPx && layout.current ? (2 * layout.current.radius * cellsHigh) / (beadPx * Math.tan((STAGE_FOV_DEG * Math.PI) / 360)) : ladderDistance;
  const cellsPerUnit = useMemo(() => Math.round(cellsPerUnitAt(distance, STAGE_FOV_DEG, cellsHigh) * 1000) / 1000, [distance, cellsHigh]);
  const onLayerBuild = useCallback((info: { spec: GalaxySpec; layout: GalaxyLayout; budget: GalaxyLayerBudget }) => onBuild(info, cellsPerUnit), [onBuild, cellsPerUnit]);
  const focusAt = useMemo(() => focusOffset(spec, focus === "current" ? (layout.current?.position ?? null) : null), [spec, focus, layout]);
  const blobs = useMemo(() => ({ blobScale, coreGlow, depthDim, params, condense, threadAlpha: 0.5 }), [blobScale, coreGlow, depthDim, params, condense]);

  return (
    <group position={[-focusAt[0], -focusAt[1], 0]}>
      <GalaxyLayer seed={seed} theme={theme} courses={courses} currentCourseId={CURRENT_COURSE_ID} fade={1} size={galaxySizeAt(distance, STAGE_FOV_DEG)} reducedMotion={reducedMotion} placement={placement} graphs={graphs} blobs={blobs} blobsApi={blobsApi} onBuild={onLayerBuild} />
      <HoverProbe blobsApi={blobsApi} onHover={onHover} />
      <FlagProjector blobsApi={blobsApi} bulgeSigma={layout.shape.bulgeSigma} bus={bus} />
    </group>
  );
}

declare global {
  interface Window {
    /** Lab hooks for captures: where a blob is on screen (client px) and the last flag solve. */
    __clustersLab?: { screenPositionOf(courseId: string): { x: number; y: number } | null; flags(): ReturnType<typeof lastFlagSolve> };
  }
}

export function ClustersLab({ initial }: { initial: ClustersLabInitial }) {
  const [theme, setTheme] = useState<StageTheme>(initial.theme);
  const [seedText, setSeedText] = useState(initial.seed);
  const [L, setL] = useState(initial.L);
  const [condense, setCondense] = useState(initial.condense);
  const [nodeWeight, setNodeWeight] = useState(initial.nodeWeight);
  const [courseCount, setCourseCount] = useState<8 | 12>(initial.courses);
  const [placement, setPlacement] = useState<BlobPlacementMode>(initial.placement);
  const [blobScale, setBlobScale] = useState(initial.blobScale);
  const [blobCore, setBlobCore] = useState(initial.blobCore);
  const [blobDepth, setBlobDepth] = useState(initial.blobDepth);
  const [threads, setThreads] = useState(initial.threads);
  const [coreGlow, setCoreGlow] = useState(initial.coreGlow);
  const [depthDim, setDepthDim] = useState(initial.depthDim);
  const [flagsMode, setFlagsMode] = useState<FlagsMode>(initial.flags);
  const [standIns, setStandIns] = useState(initial.standIns);
  const [stats, setStats] = useState<RenderStats | null>(null);
  const [build, setBuild] = useState<{ layout: GalaxyLayout; budget: GalaxyLayerBudget; buffers: BlobBuffers | null; cellsPerUnit: number } | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(initial.hover ? { courseId: initial.hover, x: 0, y: 0 } : null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [built, setBuilt] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const blobsApi = useRef<CourseBlobsApi | null>(null);
  const bus = useMemo(() => createFlagBus(), []);

  const seed = useMemo(() => seedFromText(seedText), [seedText]);
  const spec = useMemo(() => generateGalaxySpec(seed), [seed]);
  const courses = useMemo(() => AB_COURSES.slice(0, courseCount), [courseCount]);
  const armLayout = useMemo(() => generateGalaxyLayout({ courses, currentCourseId: CURRENT_COURSE_ID, seed, geometry: armsFromSpec(spec) }), [courses, seed, spec]);
  const layout = useMemo(() => placeBlobs(armLayout, placement, seed, blobScale), [armLayout, placement, seed, blobScale]);
  const blobParams = useMemo<BlobParams>(() => ({ core: blobCore, depth: blobDepth, nodeWeight, seed: GRAPH_SEED, threads }), [blobCore, blobDepth, nodeWeight, threads]);
  const [settled, setSettled] = useState<ReadonlyMap<string, CourseGraph>>(() => new Map());
  // The d3 settle for 7 .. 11 synthetic courses takes a second or two: run it after the first paint. Until it
  // lands the layer shows the product's seeded stand-ins, and the swap is the product's 300 ms crossfade.
  useEffect(() => {
    setBuilt(false);
    if (standIns) {
      setSettled(new Map());
      setBuilt(true);
      return;
    }
    const id = window.setTimeout(() => {
      setSettled(courseGraphsFor(courses.map((c) => ({ id: c.id, concepts: c.concepts })), GRAPH_SEED));
      setBuilt(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, [courses, standIns]);
  // `GalaxyLayer` fills the gaps with stand-ins when a course has no graph; here the settled graphs override.
  const graphs: ReadonlyMap<string, BlobGraph> | undefined = settled.size ? settled : undefined;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // The flags read the design-system tokens, which follow the site's space theme: mirror the lab's toggle.
  useEffect(() => {
    const root = document.documentElement;
    const was = root.dataset.spaceTheme;
    root.dataset.spaceTheme = theme;
    return () => {
      if (was === undefined) delete root.dataset.spaceTheme;
      else root.dataset.spaceTheme = was;
    };
  }, [theme]);

  // Framing: the ladder's L, or an explicit disc fraction (the 112 px corner); with `focus` + `beadPx` the
  // Scene overrides the distance so the current BEAD is that many CSS px wide.
  const size = initial.disc !== null ? initial.disc : galaxySizeAtL(L);
  const distance = galaxyDistance(size, STAGE_FOV_DEG);

  const frame = useRef<StageFrame>(createStageFrame(initial.theme));
  const api = useMemo<StageApi>(() => {
    const registry = createStageRegistry();
    registry.register("sky", new THREE.Group());
    return { registry, frame, seed: seedFromText(initial.seed) };
  }, [initial.seed]);
  frame.current.theme = theme;
  frame.current.bg.set(theme === "dark" ? SKY.dark : SKY.light);

  const reroll = useCallback(() => setSeedText(String(Math.floor(Math.random() * 0xffffff))), []);
  const onBuild = useCallback((info: { spec: GalaxySpec; layout: GalaxyLayout; budget: GalaxyLayerBudget }, cellsPerUnit: number) => setBuild({ layout: info.layout, budget: info.budget, buffers: blobsApi.current?.buffers ?? null, cellsPerUnit }), []);
  const onReady = useCallback(() => {
    document.documentElement.dataset.stageReady = "true";
  }, []);
  const readyKey = `${seed}|${theme}|${L}|${condense}|${nodeWeight}|${courseCount}|${initial.t}|${built}|${placement}|${blobScale}|${blobCore}|${blobDepth}|${threads}|${coreGlow}|${depthDim}|${flagsMode}|${standIns}`;
  useEffect(() => {
    document.documentElement.dataset.labReady = "false";
    if (!built) return;
    // Past the 300 ms stand-in -> settled crossfade before a capture reads "ready".
    const id = window.setTimeout(() => {
      document.documentElement.dataset.labReady = "true";
    }, 700);
    return () => window.clearTimeout(id);
  }, [readyKey, built]);
  useEffect(
    () => () => {
      delete document.documentElement.dataset.stageReady;
      delete document.documentElement.dataset.labReady;
    },
    [],
  );

  // Captures: `window.__clustersLab.screenPositionOf(id)` gives a blob's client position from the last projected frame.
  useEffect(() => {
    window.__clustersLab = {
      screenPositionOf(courseId) {
        const f = bus.last;
        const a = f?.anchors.find((x) => x.courseId === courseId);
        const canvas = stageRef.current?.querySelector("canvas");
        if (!a || !canvas) return null;
        const r = canvas.getBoundingClientRect();
        return { x: r.left + a.x, y: r.top + a.y };
      },
      flags: lastFlagSolve,
    };
    return () => {
      delete window.__clustersLab;
    };
  }, [bus]);

  // Chrome safe areas in stage coordinates: the side panel (the header is outside the stage box).
  const obstacles = useCallback((): Rect[] => {
    const canvas = stageRef.current?.querySelector("canvas");
    const aside = asideRef.current;
    if (!canvas || !aside || !initial.chrome) return [];
    const c = canvas.getBoundingClientRect();
    const a = aside.getBoundingClientRect();
    return [{ x: a.left - c.left, y: a.top - c.top, w: a.width, h: a.height }];
  }, [initial.chrome]);

  const sky = theme === "dark" ? SKY.dark : SKY.light;
  const C = build?.cellsPerUnit ?? 0;
  const placedLayout = build?.layout ?? layout;
  const blobs = build?.buffers ?? null;
  // One glow + core draw for every blob (the anchors), the ring on the current course rides the same draw.
  const anchorDraws = placedLayout.beads.length ? 1 : 0;
  const galaxyDraws = build ? build.budget.drawCalls - anchorDraws - build.budget.blobDraws : 0;
  const blobDraws = build?.budget.blobDraws ?? 0;
  const hoverId = hover?.courseId ?? pinned;
  const hoverBead = hoverId ? (placedLayout.beads.find((b) => b.courseId === hoverId) ?? null) : null;
  const hoverGraph = hoverId ? (settled.get(hoverId) ?? null) : null;
  const hoverBlob = hoverId ? (blobs?.courses.find((s) => s.courseId === hoverId) ?? null) : null;
  const currentBead = placedLayout.current;
  const blobPoints = blobs?.budget.visiblePoints ?? 0;

  const flagCourses = useMemo<FlagCourse[]>(() => courses.map((c) => ({ id: c.id, code: c.id, title: courseTitle(c), concepts: c.concepts, mastery: c.mastery })), [courses]);
  const shownFlags = useMemo(() => {
    // No flags in the product's small corner: there is no room for a card there.
    if (!built || (initial.box !== null && initial.box < MIN_FLAG_BOX)) return [];
    const ids = new Set<string>();
    if (flagsMode === "all") for (const b of placedLayout.beads) ids.add(b.courseId);
    if (flagsMode === "current" && placedLayout.current) ids.add(placedLayout.current.courseId);
    if (hoverId) ids.add(hoverId);
    return [...ids];
  }, [built, initial.box, flagsMode, placedLayout, hoverId]);
  const flagEntries = useFlagEntries(shownFlags, flagCourses, CURRENT_COURSE_ID, hoverId, flagsMode === "all");

  return (
    <div className="clusters-lab" data-theme={theme} data-chrome={initial.chrome ? "1" : "0"} data-built={built ? "1" : "0"} data-box={initial.box ? "1" : "0"} data-flags={flagsMode} style={{ "--cl-bg": sky, "--cl-box": initial.box ? `${initial.box}px` : "auto" } as CSSProperties}>
      <header className="clusters-lab__bar clusters-lab__chrome">
        <span className="clusters-lab__title">Cosmos · galaxy clusters C</span>
        <div className="clusters-lab__tabs" role="tablist" aria-label="Placement">
          {BLOB_PLACEMENT_MODES.map((m) => (
            <button key={m} role="tab" aria-selected={placement === m} className="clusters-lab__tab" onClick={() => setPlacement(m)} title={m === "arms" ? "The generator's ridge placement, every blob in the disc plane" : m === "halo" ? "Every course floats off the plane in the inter-arm / halo volume" : "Current + world courses on their arms, the rest hover near their home arm (the product default)"}>
              {m}
            </button>
          ))}
        </div>
        <div className="clusters-lab__tabs" role="tablist" aria-label="Flags">
          {FLAGS_MODES.map((m) => (
            <button key={m} role="tab" aria-selected={flagsMode === m} className="clusters-lab__tab" onClick={() => setFlagsMode(m)} title={m === "hover" ? "A flag for the hovered blob only" : m === "current" ? "The current course's flag stays up; hover adds one (the product at rest)" : "A flag on every course (the density and collision check)"}>
              flags · {m}
            </button>
          ))}
        </div>
        <div className="clusters-lab__tabs" role="tablist" aria-label="Courses">
          {([8, 12] as const).map((n) => (
            <button key={n} role="tab" aria-selected={courseCount === n} className="clusters-lab__tab" onClick={() => setCourseCount(n)}>
              {n} courses
            </button>
          ))}
        </div>
        <label className="clusters-lab__field">
          seed
          <input type="text" value={seedText} onChange={(e) => setSeedText(e.target.value)} spellCheck={false} aria-label="Galaxy seed" />
        </label>
        <button className="clusters-lab__btn" onClick={reroll}>
          Reroll
        </button>
        <button className="clusters-lab__btn" aria-pressed={theme === "light"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "Dark sky" : "Light sky"}
        </button>
        <button className="clusters-lab__btn" aria-pressed={standIns} onClick={() => setStandIns(!standIns)} title="Every course as its seeded stand-in (what the product shows before a layout has settled); off = the settled graphs, reached through the 300 ms crossfade">
          stand-ins
        </button>
        <label className="clusters-lab__field" title="Galaxy altitude on the stage ladder; 3.0 is the galaxy rest">
          L {L.toFixed(2)}
          <input type="range" min={2.6} max={3.2} step={0.01} value={L} onChange={(e) => setL(Number(e.target.value))} aria-label="Altitude L" />
        </label>
        <label className="clusters-lab__field" title="Current course: 0 the full blob, 1 collapsed into its core glow (which grows back to the bead)">
          condense {condense.toFixed(2)}
          <input type="range" min={0} max={1} step={0.01} value={condense} onChange={(e) => setCondense(Number(e.target.value))} aria-label="Condense current course" />
        </label>
        <label className="clusters-lab__field" title="Blob radius over the bead radius: blobs can be larger than beads without smearing because their rim is sparse">
          blob ×{blobScale.toFixed(2)}
          <input type="range" min={1} max={1.8} step={0.05} value={blobScale} onChange={(e) => setBlobScale(Number(e.target.value))} aria-label="Blob scale" />
        </label>
        <label className="clusters-lab__field" title="Plummer core radius in blob radii: 0.2 a sharp globular core, 0.6 an open cluster">
          core {blobCore.toFixed(2)}
          <input type="range" min={0.2} max={0.6} step={0.01} value={blobCore} onChange={(e) => setBlobCore(Number(e.target.value))} aria-label="Blob core radius" />
        </label>
        <label className="clusters-lab__field" title="Depth semi-axis over the blob radius: 0.3 a lens, 1.0 a ball">
          depth {blobDepth.toFixed(2)}
          <input type="range" min={0.3} max={1} step={0.05} value={blobDepth} onChange={(e) => setBlobDepth(Number(e.target.value))} aria-label="Blob depth" />
        </label>
        <label className="clusters-lab__field" title="How much the far third of a blob dims (the middle third dims half as much)">
          far dim {depthDim.toFixed(2)}
          <input type="range" min={0} max={0.7} step={0.05} value={depthDim} onChange={(e) => setDepthDim(Number(e.target.value))} aria-label="Depth dimming" />
        </label>
        <label className="clusters-lab__field" title="The bead glow's radius as a fraction of the bead radius: the blob's core glow (the current one grows back to its bead with condense)">
          core glow {coreGlow.toFixed(2)}
          <input type="range" min={0.3} max={1} step={0.05} value={coreGlow} onChange={(e) => setCoreGlow(Number(e.target.value))} aria-label="Core glow radius" />
        </label>
        <label className="clusters-lab__field" title="Backbone threads per course drawn as faint lines (the strongest cluster bridges); 0 draws none">
          threads {threads}
          <input type="range" min={0} max={5} step={1} value={threads} onChange={(e) => setThreads(Number(e.target.value))} aria-label="Threads per course" />
        </label>
        <label className="clusters-lab__field" title="Node level of detail: concepts below this weight are not drawn; 0 draws every concept like the twin's cluster layer">
          nodes ≥ {nodeWeight.toFixed(2)}
          <input type="range" min={0} max={1} step={0.05} value={nodeWeight} onChange={(e) => setNodeWeight(Number(e.target.value))} aria-label="Node weight threshold" />
        </label>
      </header>

      <div className="clusters-lab__stage" ref={stageRef}>
        <Canvas
          dpr={[1, 2]}
          flat
          frameloop="always"
          camera={{ fov: STAGE_CAMERA.fov, near: STAGE_CAMERA.near, far: STAGE_CAMERA.far, position: STAGE_CAMERA.position, rotation: STAGE_CAMERA.rotation }}
          gl={{ alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: "high-performance", stencil: false, depth: false }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0);
            gl.autoClear = true;
          }}
          fallback={null}
        >
          <StageContext.Provider value={api}>
            <StageProbe frozenT={initial.t} onStats={setStats} />
            <Scene
              theme={theme}
              spec={spec}
              courses={courses}
              layout={layout}
              graphs={graphs}
              seed={seed}
              distance={distance}
              condense={condense}
              reducedMotion={reducedMotion || initial.t !== null}
              params={blobParams}
              placement={placement}
              blobScale={blobScale}
              coreGlow={coreGlow}
              depthDim={depthDim}
              focus={initial.focus}
              beadPx={initial.beadPx}
              bus={bus}
              blobsApi={blobsApi}
              onBuild={onBuild}
              onHover={setHover}
            />
            <StageComposer frame={frame} onReady={onReady} />
          </StageContext.Provider>
        </Canvas>

        <CourseFlags entries={flagEntries} bus={bus} cell={CELL_PX} obstacles={obstacles} onOpen={setOpened} onPin={setPinned} />

        <aside className="clusters-lab__side clusters-lab__chrome" ref={asideRef}>
          <h2>C · 3D blobs, {placement} placement</h2>
          <dl className="clusters-lab__kv">
            <dt>draws</dt>
            <dd data-stat="draws">
              {stats ? stats.calls : "…"} measured · {galaxyDraws} galaxy + {blobDraws} blobs + {anchorDraws} anchors
            </dd>
            <dt>blob stars</dt>
            <dd data-stat="nodes">{blobs ? `${blobs.budget.points} in ${blobs.budget.courses} course${blobs.budget.courses === 1 ? "" : "s"} · ${blobPoints} drawn` : built ? "0" : "settling…"}</dd>
            <dt>threads</dt>
            <dd data-stat="edges">{blobs ? `${blobs.budget.threads} drawn` : "…"}</dd>
            <dt>density</dt>
            <dd data-stat="density">{blobs && blobs.courses.length ? `mean r ${blobs.courses[0].meanRadius.toFixed(2)} of the blob (Plummer a ${blobCore.toFixed(2)})` : "…"}</dd>
            <dt>overlaps</dt>
            <dd data-stat="overlaps">{blobOverlapCount(placedLayout, blobScale)}</dd>
            <dt>triangles</dt>
            <dd data-stat="triangles">{stats ? stats.triangles : "…"} measured</dd>
            <dt>points</dt>
            <dd data-stat="points">
              {stats ? stats.points : "…"} measured · {build?.budget.points ?? 0} galaxy + {blobPoints} blobs
            </dd>
            <dt>altitude</dt>
            <dd>
              L {L.toFixed(2)} · disc {(size * 100).toFixed(0)} % of height · {C.toFixed(0)} cells / R
            </dd>
            <dt>current bead</dt>
            <dd data-stat="bead">{currentBead ? `r ${(currentBead.radius * C).toFixed(1)} cells (${(currentBead.radius * C * 2 * 2).toFixed(0)} css px wide) · blob ${(currentBead.radius * C * 2 * 2 * blobScale).toFixed(0)} px` : "…"}</dd>
            <dt>flags</dt>
            <dd data-stat="flags">
              {flagsMode} · {flagEntries.filter((e) => e.phase === "in").length} up{opened ? ` · opened ${opened}` : ""}
            </dd>
            <dt>graphs</dt>
            <dd data-stat="graphs">{blobs ? `${blobs.courses.filter((c) => c.origin === "stand-in").length} stand-in · ${blobs.courses.filter((c) => c.origin !== "stand-in").length} settled${blobs.courses.some((c) => c.swapping) ? " · swapping" : ""}` : "…"}</dd>
          </dl>
          <h2>Courses</h2>
          <ul className="clusters-lab__courses">
            {placedLayout.beads.map((b) => {
              const bl = blobs?.courses.find((st) => st.courseId === b.courseId) ?? null;
              return (
                <li key={b.courseId} data-current={b.kind === "current" ? "1" : "0"} data-hover={hoverId === b.courseId ? "1" : "0"}>
                  <span>
                    {b.courseId}
                    {b.kind === "current" ? " · here" : ""}
                  </span>
                  <small>{`${bl ? `${bl.visible}★` : "…"} · y ${b.position[1] >= 0 ? "+" : ""}${b.position[1].toFixed(2)} · r ${(b.radius * blobScale * C).toFixed(0)}c`}</small>
                </li>
              );
            })}
          </ul>
          {hoverBead ? (
            <p data-stat="hover">
              {hoverBead.name}
              {hoverGraph ? ` · ${hoverGraph.origin === "real" ? "real layout" : "settled synthetic"} · ${hoverGraph.nodes.length} nodes · ${hoverGraph.clusters.length} clusters` : " · stand-in"}
              {hoverBlob ? ` · ${hoverBlob.visible} stars · ${((Math.PI * 2) / Math.abs(hoverBlob.omega)) | 0} s tumble` : ""}
            </p>
          ) : null}
          <p>The product&apos;s galaxy layer with this lab&apos;s tuning: every course is its concepts mapped into an ellipsoid (layout x/y, Plummer core, one lobe per topic cluster in depth), one cell per star, tumbling once per 90 .. 180 s; the bead glow is the core, the ring marks the current course. `lib/galaxy/{"{"}blobs,placement,flags{"}"}` and `components/stage/layers/galaxy` are what render here.</p>
          <p>Flags stem from the core glow along the anti-radial (away from the bulge), rotating in 30° steps when that would leave the stage, cover the bulge, another blob or another flag; a longer leader is tried before clamping. After the knowledge-map callouts in the inka top view.</p>
        </aside>
      </div>
    </div>
  );
}
