"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { GalaxyLayout } from "@/lib/galaxy/layout";
import { COURSE_PALETTES, SKY } from "@/lib/galaxy/palettes";
import { BLOB_SWAP_MS, buildBlobBuffers, DEFAULT_BLOB_PARAMS, MAX_BLOB_COURSES, placementsFromBeads, swapMixAt, type BlobBuffers, type BlobCourse, type BlobGraph, type BlobParams } from "@/lib/galaxy/blobs";
import { applySkyBlend, STAGE_UNIFORMS, type StageTheme } from "../../lib/uniforms";
import { BLOB_POINT_FRAG, BLOB_POINT_VERT, BLOB_THREAD_FRAG, BLOB_THREAD_VERT } from "./blob-shaders";
import type { BeadHit } from "./CourseBeads";
import { blobColors, GALAXY_RENDER_ORDER } from "./galaxy-layer-model";

export interface BlobAnchor {
  /** World radius of the core glow (the bead's glow quad: the twin's landing disc). */
  glowRadius: number;
  /** World radius of the whole blob (the sparse rim). */
  blobRadius: number;
}

/**
 * Imperative handle on the blob draw for the stage's own pointer path and the
 * hop: lookups and uniform writes only, no React state on the frame path.
 */
export interface CourseBlobsApi {
  /** The blob whose CORE (the bead radius, never the sparse rim) is nearest the ray; null when none. */
  pick(raycaster: THREE.Raycaster): BeadHit | null;
  /** World-space centre of a course's blob and its radii; null when the course has no blob. */
  anchor(courseId: string, outPosition: THREE.Vector3): BlobAnchor | null;
  /** Every blob's world centre and radii (the flag projector); `world` is a scratch vector reused per call. */
  each(fn: (course: BlobCourse, world: THREE.Vector3, anchor: BlobAnchor) => void): void;
  /** Collapse the current course's blob into its core glow (0 full blob .. 1 collapsed): one uniform write. */
  setCondense(value: number): void;
  /** The current blob course list and budget from the last build. */
  readonly buffers: BlobBuffers | null;
  /** The pattern-frame group the blobs sit in (world matrix = roll, inclination, pattern angle). */
  readonly frame: THREE.Object3D | null;
}

export interface CourseBlobsProps {
  /** The placed layout (`placeBlobs`): bead positions are blob centres, bead radii x `blobScale` the blob radii. */
  layout: GalaxyLayout;
  /** Each course's graph: the settled constellation layout or its seeded stand-in. A changed graph crossfades (300 ms). */
  graphs: ReadonlyMap<string, BlobGraph>;
  theme: StageTheme;
  params?: BlobParams;
  /** Blob radius / bead radius. */
  blobScale: number;
  /** The core glow's radius as a fraction of the bead radius (the pick radius is the bead itself). */
  coreGlow: number;
  fade: number;
  /** How much the far third of a blob dims (0 flat .. 0.7). */
  depthDim: number;
  /** 0 freezes the tumble (prefers-reduced-motion). */
  motion: number;
  /** Thread alpha at full fade. */
  threadAlpha?: number;
  /** Initial condense of the current course (the lab's slider); the product drives it per frame through the api. */
  condense?: number;
  onBuild?: (buffers: BlobBuffers) => void;
  api?: RefObject<CourseBlobsApi | null>;
  /** The pattern-frame group the blobs sit in (labs project through it). */
  frameRef?: RefObject<THREE.Group | null>;
}

function perCourseUniforms() {
  return {
    uCentre: { value: Array.from({ length: MAX_BLOB_COURSES }, () => new THREE.Vector3()) },
    uAxis: { value: Array.from({ length: MAX_BLOB_COURSES }, () => new THREE.Vector4(0, 1, 0, 0)) },
    uRadius: { value: new Array<number>(MAX_BLOB_COURSES).fill(0.05) },
    uCondense: { value: new Array<number>(MAX_BLOB_COURSES).fill(0) },
    uSwap: { value: new Array<number>(MAX_BLOB_COURSES).fill(1) },
  };
}

function setAttribute(g: THREE.BufferGeometry, name: string, array: Float32Array, itemSize: number): void {
  const existing = g.getAttribute(name) as THREE.BufferAttribute | undefined;
  if (existing && existing.array.length === array.length) {
    (existing.array as Float32Array).set(array);
    existing.needsUpdate = true;
    return;
  }
  const attribute = new THREE.BufferAttribute(array.slice(), itemSize);
  attribute.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute(name, attribute);
}

interface Swap {
  outgoing: BlobGraph;
  /** Clock seconds the swap began; -1 until the first frame after the rebuild (so the fade starts at 0, not mid-way). */
  startedAt: number;
}

/**
 * Every course as a three-dimensional star cluster in the galaxy's pattern
 * frame: one point draw for all concept stars, one line draw for the backbone
 * threads. Mount as a child of `Galaxy` beside `CourseBeads` (whose glow is
 * the blob's core and whose ring marks the current course).
 */
export function CourseBlobs({ layout, graphs, theme, params = DEFAULT_BLOB_PARAMS, blobScale, coreGlow, fade, depthDim, motion, threadAlpha = 0.5, condense = 0, onBuild, api, frameRef }: CourseBlobsProps) {
  const bundle = useMemo(() => {
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
    const threadGeometry = new THREE.BufferGeometry();
    threadGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
    const shared = perCourseUniforms();
    const pointMaterial = new THREE.ShaderMaterial({
      vertexShader: BLOB_POINT_VERT,
      fragmentShader: BLOB_POINT_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: STAGE_UNIFORMS.uTime,
        uRes: STAGE_UNIFORMS.uRes,
        uCellPx: STAGE_UNIFORMS.uCellPx,
        uFade: { value: 1 },
        uMotion: { value: 1 },
        uCells: { value: 1 },
        uDepthDim: { value: 0.5 },
        uStar: { value: new THREE.Color(SKY.starDark) },
        uColor: { value: Array.from({ length: MAX_BLOB_COURSES }, () => new THREE.Color(1, 1, 1)) },
        ...shared,
      },
    });
    const threadMaterial = new THREE.ShaderMaterial({
      vertexShader: BLOB_THREAD_VERT,
      fragmentShader: BLOB_THREAD_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: STAGE_UNIFORMS.uTime,
        uRes: STAGE_UNIFORMS.uRes,
        uFade: { value: 1 },
        uMotion: { value: 1 },
        uThread: { value: new THREE.Color(SKY.starSoftDark) },
        uThreadAlpha: { value: 0.3 },
        // The thread material shares the per-course uniform OBJECTS, so one write serves both draws.
        ...shared,
      },
    });
    return { pointGeometry, threadGeometry, pointMaterial, threadMaterial, shared };
  }, []);
  const group = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const threadsRef = useRef<THREE.LineSegments>(null);

  // Crossfades: a course whose graph object changed keeps its previous graph as `outgoing` for BLOB_SWAP_MS.
  // Derived during render (not in an effect) so the first buffers built for the new graph already carry the
  // outgoing one: no single frame shows the new layout alone (no pop).
  const [tracked, setTracked] = useState<{ graphs: ReadonlyMap<string, BlobGraph>; swaps: ReadonlyMap<string, Swap> }>(() => ({ graphs, swaps: new Map() }));
  let swaps = tracked.swaps;
  if (tracked.graphs !== graphs) {
    const next = new Map(tracked.swaps);
    for (const [id, g] of graphs) {
      const was = tracked.graphs.get(id);
      // A swap already running keeps fading the older graph; the middle one is skipped (no triple blend).
      if (was && was !== g && !next.has(id)) next.set(id, { outgoing: was, startedAt: -1 });
    }
    for (const id of [...next.keys()]) if (!graphs.has(id)) next.delete(id);
    swaps = next;
    setTracked({ graphs, swaps: next });
  }
  const outgoing = useMemo(() => {
    const m = new Map<string, BlobGraph>();
    for (const [id, s] of swaps) if (graphs.has(id)) m.set(id, s.outgoing);
    return m;
  }, [swaps, graphs]);

  const placements = useMemo(() => placementsFromBeads(layout.beads, blobScale, (b) => (b.kind === "current" ? condense : 0)), [layout, blobScale, condense]);
  const buffers = useMemo(() => buildBlobBuffers({ graphs, placements, params, outgoing }), [graphs, placements, params, outgoing]);
  const buffersRef = useRef<BlobBuffers | null>(null);
  buffersRef.current = buffers;

  // Layout effect: the upload lands before the next animation frame, so no frame draws stale buffers or a
  // swapping course at full `uSwap`.
  useLayoutEffect(() => {
    const { pointGeometry, threadGeometry, shared } = bundle;
    const p = buffers.points;
    setAttribute(pointGeometry, "position", p.local, 3);
    setAttribute(pointGeometry, "aLocal", p.local, 3);
    setAttribute(pointGeometry, "aCourse", p.course, 1);
    setAttribute(pointGeometry, "aWeight", p.weight, 1);
    setAttribute(pointGeometry, "aAlpha", p.alpha, 1);
    setAttribute(pointGeometry, "aRadius", p.radius, 1);
    setAttribute(pointGeometry, "aGen", p.gen, 1);
    pointGeometry.setDrawRange(0, p.count);
    const t = buffers.threads;
    setAttribute(threadGeometry, "position", t.local, 3);
    setAttribute(threadGeometry, "aLocal", t.local, 3);
    setAttribute(threadGeometry, "aCourse", t.course, 1);
    threadGeometry.setDrawRange(0, t.count * 2);
    for (const c of buffers.courses) {
      shared.uCentre.value[c.index].set(c.position[0], c.position[1], c.position[2]);
      shared.uAxis.value[c.index].set(c.axis[0], c.axis[1], c.axis[2], c.omega);
      shared.uRadius.value[c.index] = c.radius;
      shared.uCondense.value[c.index] = c.condense;
      // A course that is not swapping is whole; a swapping one starts at 0 (its ramp runs in useFrame).
      const s = c.swapping ? swaps.get(c.courseId) : undefined;
      shared.uSwap.value[c.index] = !s ? 1 : s.startedAt < 0 ? 0 : shared.uSwap.value[c.index];
    }
    if (pointsRef.current) pointsRef.current.visible = p.count > 0;
    if (threadsRef.current) threadsRef.current.visible = t.count > 0;
    onBuild?.(buffers);
  }, [bundle, buffers, swaps, onBuild]);

  // The crossfade ramp: uSwap 0 -> 1 over BLOB_SWAP_MS per swapping course, then the outgoing graph is dropped.
  useFrame((state) => {
    if (swaps.size === 0) return;
    const now = state.clock.elapsedTime;
    const u = bundle.shared.uSwap.value;
    let done: string[] | null = null;
    for (const c of buffers.courses) {
      if (!c.swapping) continue;
      const s = swaps.get(c.courseId);
      if (!s) continue;
      if (s.startedAt < 0) {
        s.startedAt = now;
        u[c.index] = 0;
        continue;
      }
      const mix = swapMixAt(s.startedAt * 1000, now * 1000, BLOB_SWAP_MS);
      u[c.index] = mix;
      if (mix >= 1) (done ??= []).push(c.courseId);
    }
    if (done) {
      const finished = done;
      setTracked((prev) => {
        const next = new Map(prev.swaps);
        for (const id of finished) next.delete(id);
        return { graphs: prev.graphs, swaps: next };
      });
    }
  });

  useEffect(() => {
    const u = bundle.pointMaterial.uniforms;
    const colors = blobColors(layout, COURSE_PALETTES[theme]);
    for (const c of buffers.courses) (u.uColor.value as THREE.Color[])[c.index].set(colors.get(c.courseId) ?? "#ffffff");
  }, [bundle, buffers, layout, theme]);

  useEffect(() => {
    const dark = theme === "dark";
    (bundle.pointMaterial.uniforms.uStar.value as THREE.Color).set(dark ? SKY.starDark : SKY.starLight);
    (bundle.threadMaterial.uniforms.uThread.value as THREE.Color).set(dark ? SKY.starSoftDark : SKY.starSoftLight);
    applySkyBlend(bundle.pointMaterial, theme);
    applySkyBlend(bundle.threadMaterial, theme);
  }, [bundle, theme]);

  useEffect(() => {
    bundle.pointMaterial.uniforms.uFade.value = fade;
    bundle.threadMaterial.uniforms.uFade.value = fade;
    bundle.pointMaterial.uniforms.uMotion.value = motion;
    bundle.threadMaterial.uniforms.uMotion.value = motion;
    bundle.pointMaterial.uniforms.uDepthDim.value = depthDim;
    bundle.threadMaterial.uniforms.uThreadAlpha.value = threadAlpha;
  }, [bundle, fade, motion, depthDim, threadAlpha]);

  // The handle: picking against the blob cores, world anchors, the per-frame condense write.
  useEffect(() => {
    if (!api) return;
    const world = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const anchorOf = (c: BlobCourse, out: THREE.Vector3): BlobAnchor => {
      const g = group.current;
      out.set(c.position[0], c.position[1], c.position[2]);
      if (g) {
        g.localToWorld(out);
        g.getWorldScale(scale);
      } else scale.set(1, 1, 1);
      const s = Math.max(scale.x, scale.z);
      const bead = c.radius / blobScale;
      return { glowRadius: bead * coreGlow * s, blobRadius: c.radius * s };
    };
    const handle: CourseBlobsApi = {
      get buffers() {
        return buffersRef.current;
      },
      get frame() {
        return group.current;
      },
      pick(raycaster) {
        const b = buffersRef.current;
        if (!b) return null;
        let best: BeadHit | null = null;
        let bestD = Infinity;
        for (const c of b.courses) {
          anchorOf(c, world);
          // The core: the bead radius (the glow and the dense centre), not the sparse rim.
          const r = (c.radius / blobScale) * Math.max(scale.x, scale.z);
          const d = raycaster.ray.distanceToPoint(world);
          if (d <= r && d < bestD) {
            bestD = d;
            best = { courseId: c.courseId, instanceId: c.index };
          }
        }
        return best;
      },
      anchor(courseId, out) {
        const c = buffersRef.current?.courses.find((x) => x.courseId === courseId);
        return c ? anchorOf(c, out) : null;
      },
      each(fn) {
        const b = buffersRef.current;
        if (!b) return;
        for (const c of b.courses) fn(c, world, anchorOf(c, world));
      },
      setCondense(value) {
        const b = buffersRef.current;
        if (!b) return;
        const v = Math.min(1, Math.max(0, value));
        for (const c of b.courses) if (c.current) bundle.shared.uCondense.value[c.index] = v;
      },
    };
    api.current = handle;
    return () => {
      if (api.current === handle) api.current = null;
    };
  }, [api, bundle, blobScale, coreGlow]);

  useEffect(
    () => () => {
      bundle.pointGeometry.dispose();
      bundle.threadGeometry.dispose();
      bundle.pointMaterial.dispose();
      bundle.threadMaterial.dispose();
    },
    [bundle],
  );

  const setGroup = (g: THREE.Group | null) => {
    group.current = g;
    if (frameRef) frameRef.current = g;
  };

  return (
    <group ref={setGroup}>
      <lineSegments ref={threadsRef} geometry={bundle.threadGeometry} material={bundle.threadMaterial} frustumCulled={false} renderOrder={GALAXY_RENDER_ORDER + 8} />
      <points ref={pointsRef} geometry={bundle.pointGeometry} material={bundle.pointMaterial} frustumCulled={false} renderOrder={GALAXY_RENDER_ORDER + 9} />
    </group>
  );
}
