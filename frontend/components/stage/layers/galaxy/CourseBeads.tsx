"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { DITHER_MODE, type DitherMode } from "@/lib/light";
import type { GalaxyLayout } from "@/lib/galaxy/layout";
import { COURSE_PALETTES, SKY } from "@/lib/galaxy/palettes";
import { applySkyBlend, STAGE_UNIFORMS, type StageTheme } from "../../lib/uniforms";
import { BEAD_FRAG, BEAD_VERT } from "./bead-shaders";
import { BEAD_ANCHOR, beadGrowAt, beadInstances, courseIndexOf, GALAXY_RENDER_ORDER, type BeadAnchorScale } from "./galaxy-layer-model";

export interface BeadHit {
  courseId: string;
  /** The blob's dense course index (`aCourse`). */
  instanceId: number;
}

/**
 * Imperative handle on the anchor draw: uniform writes and a lookup, no
 * React state. Picking lives on `CourseBlobsApi` (the blob core), not here.
 */
export interface CourseBeadsApi {
  /** Ring the hovered course's glow (null clears). */
  setHover(courseId: string | null): void;
  /** The hop's collapse of the current course's blob (0 full blob .. 1 collapsed): grows its glow back to the bead. */
  setCondense(value: number): void;
  /** World-space centre and current radius of a course's glow quad (the twin's landing disc); null when the course has no bead. */
  anchor(courseId: string, outPosition: THREE.Vector3): { radius: number } | null;
}

export interface CourseBeadsProps {
  layout: GalaxyLayout;
  theme: StageTheme;
  fade: number;
  lightModel: DitherMode;
  /** The blob's anchor sizes (glow = core glow, ring = blob rim); defaults to the product's. */
  anchorScale?: BeadAnchorScale;
  /** Receives the hover / condense / anchor handle while mounted. */
  api?: RefObject<CourseBeadsApi | null>;
  /** R3F click on an anchor quad (a canvas that takes pointer input, e.g. the galaxy-stage lab); the product stage picks through `CourseBlobsApi`. */
  onBeadClick?: (courseId: string) => void;
}

/**
 * The blob ANCHORS: one instanced draw of flat quads in the galaxy's pattern
 * frame (mount it as a child of `Galaxy`, which rotates the frame): the core
 * glow + core of every course's blob, the ring around the current course's
 * blob, and the halo globulars of archived courses. The glow and core are
 * what the twin condenses onto and what a click picks (`CourseBlobsApi`).
 */
export function CourseBeads({ layout, theme, fade, lightModel, anchorScale = BEAD_ANCHOR, api, onBeadClick }: CourseBeadsProps) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const instances = useMemo(() => beadInstances(layout, COURSE_PALETTES[theme], anchorScale), [layout, theme, anchorScale]);
  const courseIndex = useMemo(() => courseIndexOf(instances), [instances]);
  const count = Math.max(1, instances.length);
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(2, 2);
    const colors = new Float32Array(count * 3);
    const params = new Float32Array(count * 4);
    const course = new Float32Array(count);
    const c = new THREE.Color();
    instances.forEach((q, i) => {
      c.set(q.color);
      colors.set([c.r, c.g, c.b], i * 3);
      params.set([q.alpha, q.mode, q.p0, q.phase], i * 4);
      course[i] = courseIndex.get(q.courseId) ?? -1;
    });
    g.setAttribute("iColor", new THREE.InstancedBufferAttribute(colors, 3));
    g.setAttribute("iParams", new THREE.InstancedBufferAttribute(params, 4));
    g.setAttribute("iCourse", new THREE.InstancedBufferAttribute(course, 1));
    return g;
  }, [instances, count, courseIndex]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: BEAD_VERT,
        fragmentShader: BEAD_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uRes: STAGE_UNIFORMS.uRes,
          uLight: STAGE_UNIFORMS.uLight,
          uTime: STAGE_UNIFORMS.uTime,
          uFade: { value: 1 },
          uHover: { value: -1 },
          uCurrent: { value: -1 },
          uCondense: { value: 0 },
          uGrow: { value: new THREE.Vector2(1, 1) },
          uDither: { value: DITHER_MODE.bayer8 },
          uPaper: { value: new THREE.Color(SKY.light) },
        },
      }),
    [],
  );
  useEffect(() => applySkyBlend(material, theme), [material, theme]);
  useEffect(() => {
    material.uniforms.uFade.value = fade;
  }, [material, fade]);
  useEffect(() => {
    material.uniforms.uDither.value = DITHER_MODE[lightModel];
  }, [material, lightModel]);
  useEffect(() => {
    const grow = beadGrowAt(anchorScale);
    (material.uniforms.uGrow.value as THREE.Vector2).set(grow.glow, grow.ring);
    material.uniforms.uCurrent.value = layout.current ? (courseIndex.get(layout.current.courseId) ?? -1) : -1;
  }, [material, anchorScale, layout, courseIndex]);

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    instances.forEach((q, i) => {
      pos.set(q.position[0], q.position[1], q.position[2]);
      scl.set(q.size, q.size, 1);
      mat.compose(pos, flat, scl);
      m.setMatrixAt(i, mat);
    });
    m.count = instances.length;
    m.instanceMatrix.needsUpdate = true;
  }, [instances]);

  // The handle. Re-bound whenever the instances change (new layout or theme).
  useEffect(() => {
    if (!api) return;
    const scale = new THREE.Vector3();
    const grow = beadGrowAt(anchorScale);
    const handle: CourseBeadsApi = {
      setHover(courseId) {
        material.uniforms.uHover.value = courseId === null ? -1 : (courseIndex.get(courseId) ?? -1);
      },
      setCondense(value) {
        material.uniforms.uCondense.value = Math.min(1, Math.max(0, value));
      },
      anchor(courseId, out) {
        const m = mesh.current;
        const q = instances.find((inst) => inst.courseId === courseId && inst.mode === 0);
        if (!m || !q) return null;
        out.set(q.position[0], q.position[1], q.position[2]);
        m.localToWorld(out);
        m.getWorldScale(scale);
        const current = layout.current?.courseId === courseId;
        const g = current ? 1 + (grow.glow - 1) * (material.uniforms.uCondense.value as number) : 1;
        return { radius: q.size * g * Math.max(scale.x, scale.z) };
      },
    };
    api.current = handle;
    return () => {
      if (api.current === handle) api.current = null;
    };
  }, [api, instances, courseIndex, material, anchorScale, layout]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  const onClick = onBeadClick
    ? (e: ThreeEvent<MouseEvent>) => {
        const id = e.instanceId;
        if (id === undefined || id >= instances.length) return;
        e.stopPropagation();
        onBeadClick(instances[id].courseId);
      }
    : undefined;

  return <instancedMesh ref={mesh} args={[geometry, material, count]} frustumCulled={false} renderOrder={GALAXY_RENDER_ORDER + 7} onClick={onClick} />;
}
