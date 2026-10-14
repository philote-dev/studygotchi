"use client";

import { useContext, useEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { DEFAULT_DITHER_MODE, type DitherMode } from "@/lib/light";
import { ALL_FEATURES, buildGalaxyBuffers, type GalaxyFeatures } from "@/lib/galaxy/points";
import { generateGalaxySpec, type GalaxySpec } from "@/lib/galaxy/spec";
import { armsFromSpec, generateGalaxyLayout, type GalaxyCourse, type GalaxyLayout, type LayoutCourse, type LayoutFriend } from "@/lib/galaxy/layout";
import { BLOB_DEFAULTS, DEFAULT_BLOB_PARAMS, standInGraph, type BlobBuffers, type BlobGraph, type BlobParams } from "@/lib/galaxy/blobs";
import { DEFAULT_BLOB_PLACEMENT, placeBlobs, type BlobPlacementMode } from "@/lib/galaxy/placement";
import type { StageTheme } from "../../lib/uniforms";
import { StageContext, type StageRegistry } from "../../StageContext";
import { CourseBeads, type CourseBeadsApi } from "./CourseBeads";
import { CourseBlobs, type CourseBlobsApi } from "./CourseBlobs";
import { Galaxy } from "./Galaxy";
import { GALAXY_HERO_SIZE, galaxyDistance, galaxyLayerBudget, galaxyLayerVisible, STAGE_FOV_DEG, type BeadAnchorScale, type GalaxyLayerBudget } from "./galaxy-layer-model";

/*
 * registerGalaxyLayer
 * -------------------
 * The layer registers its root group as `"galaxy"` on whatever `StageContext`
 * it finds (soft: outside a provider it simply does not register). The product
 * mounts it through `GalaxyRung` (S3-2), which drives the per-frame fade from
 * the director's altitude band, owns the pointer path (hover flag, blob click
 * -> `stage:open-course-constellation`) and adds the galaxy-rung scenery as
 * `children` in the pattern frame. The layer itself never navigates.
 * `registerGalaxyLayer(registry, group)` is the same registration for a
 * caller that owns the group itself (pass `ref` and call it, or neither).
 */

export const GALAXY_LAYER_NAME = "galaxy" as const;

/** Register (or with null, unregister) a galaxy root group on a stage registry. */
export function registerGalaxyLayer(registry: StageRegistry, group: THREE.Group | null): void {
  registry.register(GALAXY_LAYER_NAME, group);
}

/** The blob tuning the layer exposes (the clusters lab's sliders); the product uses the defaults. */
export interface GalaxyBlobTuning {
  blobScale?: number;
  coreGlow?: number;
  depthDim?: number;
  params?: BlobParams;
  /** Thread alpha at full fade. */
  threadAlpha?: number;
  /** Initial collapse of the current course's blob (per-frame writes go through `blobsApi.setCondense`). */
  condense?: number;
}

export interface GalaxyLayerProps {
  /** Per-student seed (`seedFromStudent`); the same seed is the same galaxy and the same bead placement. */
  seed: number;
  theme: StageTheme;
  /** The student's courses in the product shape (identity courses + overview stats); labs may pass the generator's record. */
  courses: readonly (GalaxyCourse | LayoutCourse)[];
  /** The active course: its blob carries the ring. Null falls back to the most recently opened course. */
  currentCourseId: string | null;
  /** 0..1 overall alpha, one uniform write per material. At 0 the layer renders nothing (root group hidden). */
  fade: number;
  /** Disc diameter as a fraction of the viewport height; defaults to the lab hero framing (0.83). */
  size?: number;
  /** `bayer8` (default, accepted), `ign` selectable; `bands` is the old lab look. */
  lightModel?: DitherMode;
  /** Polish toggles; all on by default. */
  features?: GalaxyFeatures;
  /** prefers-reduced-motion: no pattern rotation, no orbits, no flashes or comet, no blob tumble; the twinkle stays. */
  reducedMotion?: boolean;
  /** Friends become satellite dwarfs in the layout (unused by the renderer for now). */
  friends?: readonly LayoutFriend[];
  /** Where the blobs go: `mixed` (default), `arms` or `halo`. */
  placement?: BlobPlacementMode;
  /** Each course's graph (settled layout or stand-in); omitted = seeded stand-ins from the concept counts. */
  graphs?: ReadonlyMap<string, BlobGraph>;
  blobs?: GalaxyBlobTuning;
  /** A blob anchor was clicked through R3F events (a canvas that takes pointer input). No navigation inside the layer. */
  onBeadClick?: (courseId: string) => void;
  /** Called once per build with the spec, the PLACED layout and the draw / point budget (the rung places scenery from it). */
  onBuild?: (info: { spec: GalaxySpec; layout: GalaxyLayout; budget: GalaxyLayerBudget }) => void;
  /** Receives the anchor handle (hover ring, condense, the twin's landing disc). */
  beadsApi?: RefObject<CourseBeadsApi | null>;
  /** Receives the blob handle (picking, world anchors, condense). */
  blobsApi?: RefObject<CourseBlobsApi | null>;
  /** Mounted in the galaxy's pattern frame beside the blobs (the galaxy-rung scenery). */
  children?: ReactNode;
  /** The root group, for the stage registry. */
  ref?: Ref<THREE.Group>;
}

/**
 * The galaxy rung: the polished seeded galaxy (dithered light model) with the
 * student's courses as three-dimensional concept blobs (version C) placed
 * `mixed` on and just off its arms, the core glow + ring anchors on the
 * current course and archived courses as halo globulars. Sits on the stage
 * camera's axis at the distance that gives `size`, so a later director only
 * has to move the camera. Budget: galaxy <= 9000 points, 8 draws + 1
 * instanced draw for the anchors + 1 point draw for every blob.
 */
export function GalaxyLayer({
  seed,
  theme,
  courses,
  currentCourseId,
  fade,
  size = GALAXY_HERO_SIZE,
  lightModel = DEFAULT_DITHER_MODE,
  features = ALL_FEATURES,
  reducedMotion = false,
  friends,
  placement = DEFAULT_BLOB_PLACEMENT,
  graphs,
  blobs,
  onBeadClick,
  onBuild,
  beadsApi,
  blobsApi,
  children,
  ref,
}: GalaxyLayerProps) {
  const inner = useRef<THREE.Group>(null);
  const stage = useContext(StageContext);
  const camera = useThree((s) => s.camera);
  const fov = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera).fov : STAGE_FOV_DEG;
  const spec = useMemo(() => generateGalaxySpec(seed), [seed]);
  const blobScale = blobs?.blobScale ?? BLOB_DEFAULTS.blobScale;
  const coreGlow = blobs?.coreGlow ?? BLOB_DEFAULTS.coreGlow;
  const depthDim = blobs?.depthDim ?? BLOB_DEFAULTS.depthDim;
  const params = blobs?.params ?? DEFAULT_BLOB_PARAMS;
  const armLayout = useMemo(() => generateGalaxyLayout({ courses, currentCourseId, friends, seed, geometry: armsFromSpec(spec) }), [courses, currentCourseId, friends, seed, spec]);
  const layout = useMemo(() => placeBlobs(armLayout, placement, seed, blobScale), [armLayout, placement, seed, blobScale]);
  const anchorScale = useMemo<BeadAnchorScale>(() => ({ blobScale, coreGlow }), [blobScale, coreGlow]);
  // A course without a graph (no source at all in the preview lab, or none settled yet) is its seeded stand-in;
  // the stand-ins are cached so they keep their identity across renders (a changed identity is a crossfade).
  const standIns = useRef(new Map<string, BlobGraph>());
  const blobGraphs = useMemo(() => {
    const m = new Map<string, BlobGraph>();
    for (const c of courses) {
      const given = graphs?.get(c.id);
      if (given) {
        m.set(c.id, given);
        continue;
      }
      const count = Math.max(1, Math.round("conceptCount" in c ? c.conceptCount : c.concepts));
      const key = `${c.id}:${count}`;
      let g = standIns.current.get(key);
      if (!g) standIns.current.set(key, (g = standInGraph(c.id, count)));
      m.set(c.id, g);
    }
    return m;
  }, [graphs, courses]);
  const distance = galaxyDistance(size, fov);
  const visible = galaxyLayerVisible(fade);
  const [blobBuild, setBlobBuild] = useState<BlobBuffers | null>(null);

  useEffect(() => {
    if (!onBuild) return;
    onBuild({ spec, layout, budget: galaxyLayerBudget(features, buildGalaxyBuffers(spec), layout, blobBuild ? { draws: blobBuild.budget.draws, points: blobBuild.budget.visiblePoints } : undefined) });
  }, [onBuild, layout, features, spec, blobBuild]);

  // Hidden, not unmounted: at fade 0 nothing is drawn, but every program stays compiled for the next rise.
  useEffect(() => {
    if (inner.current) inner.current.visible = visible;
  }, [visible]);

  // Soft registration: inside a StageCanvas the director finds the root under "galaxy".
  useEffect(() => {
    const registry = stage?.registry;
    if (!registry) return;
    registerGalaxyLayer(registry, inner.current);
    return () => registerGalaxyLayer(registry, null);
  }, [stage]);

  const setRef = (g: THREE.Group | null) => {
    inner.current = g;
    if (g) g.visible = visible;
    if (typeof ref === "function") ref(g);
    else if (ref) ref.current = g;
  };

  return (
    <group ref={setRef} name="stage-galaxy" position={[0, 0, -distance]}>
      <Galaxy spec={spec} theme={theme} radius={1} cells={1} fade={fade} features={features} lightModel={lightModel} cameraDistance={distance} reducedMotion={reducedMotion}>
        {children}
        <CourseBeads layout={layout} theme={theme} fade={fade} lightModel={lightModel} anchorScale={anchorScale} api={beadsApi} onBeadClick={onBeadClick} />
        <CourseBlobs
          layout={layout}
          graphs={blobGraphs}
          theme={theme}
          params={params}
          blobScale={blobScale}
          coreGlow={coreGlow}
          fade={fade}
          depthDim={depthDim}
          motion={reducedMotion ? 0 : 1}
          threadAlpha={blobs?.threadAlpha}
          condense={blobs?.condense}
          api={blobsApi}
          onBuild={setBlobBuild}
        />
      </Galaxy>
    </group>
  );
}
