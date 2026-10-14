"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { altitudeAt } from "@/lib/stage/altitude";
import { constellationSceneryAsPlaced, placeConstellationScenery } from "@/lib/stage/constellation-scenery";
import { bucketAspect, type SkyPlacement } from "@/lib/stage/placement";
import { applySkyBlend, STAGE_UNIFORMS, type StageTheme } from "../../lib/uniforms";
import { STAGE_CAMERA } from "../../lib/view";
import { useStage, useStageDirector, useStageLayer } from "../../StageContext";
import { QUAD_CAPACITY, SkyPointWriter, writeObjects, type QuadInstances } from "../sky/sky-build";
import type { SkyTokens } from "../sky/sky-palette";
import { POINTS_FRAG, POINTS_VERT, QUAD_FRAG, QUAD_VERT } from "../sky/sky-shaders";

/** Same shape as the sky builder's private quad writer (`writeObjects` types it structurally). */
class QuadWriter {
  readonly matrices = new Float32Array(QUAD_CAPACITY * 16);
  readonly kind = new Float32Array(QUAD_CAPACITY);
  readonly params = new Float32Array(QUAD_CAPACITY * 4);
  readonly params2 = new Float32Array(QUAD_CAPACITY * 4);
  readonly c0 = new Float32Array(QUAD_CAPACITY * 3);
  readonly c1 = new Float32Array(QUAD_CAPACITY * 3);
  readonly c2 = new Float32Array(QUAD_CAPACITY * 3);
  readonly c3 = new Float32Array(QUAD_CAPACITY * 3);
  count = 0;
  push(matrix: Float32Array, kind: number, params: readonly number[], params2: readonly number[], colors: readonly [{ r: number; g: number; b: number }, { r: number; g: number; b: number }, { r: number; g: number; b: number }, { r: number; g: number; b: number }]): void {
    if (this.count >= QUAD_CAPACITY) return;
    const i = this.count++;
    this.matrices.set(matrix, i * 16);
    this.kind[i] = kind;
    this.params.set(params, i * 4);
    this.params2.set(params2, i * 4);
    const cs = [this.c0, this.c1, this.c2, this.c3];
    colors.forEach((c, k) => cs[k].set([c.r, c.g, c.b], i * 3));
  }
  finish(): QuadInstances {
    const n = this.count;
    return { count: n, matrices: this.matrices.subarray(0, n * 16), kind: this.kind.subarray(0, n), params: this.params.subarray(0, n * 4), params2: this.params2.subarray(0, n * 4), c0: this.c0.subarray(0, n * 3), c1: this.c1.subarray(0, n * 3), c2: this.c2.subarray(0, n * 3), c3: this.c3.subarray(0, n * 3) };
  }
}

/** The constellation band of the altitude model: in from L 1.4, full by 1.75, out between 2.35 and 2.62. */
export function constellationSceneryFade(L: number): number {
  return altitudeAt(L).clusterStars;
}

/** Below this fade nothing is drawn (programs stay compiled through the warm pass). */
const HIDE_BELOW = 0.002;

/**
 * S2-5: the constellation rung's scenery, drawn by the sky layer's object
 * recipes (one instanced quad draw, one points draw) in the stage root scene
 * at the backdrop depths, around the graph and never under it, fading with
 * the constellation band. Always mounted; hidden (not unmounted) outside the
 * band, so the stage's warm pass keeps its programs compiled.
 */
export function ConstellationScenery({ seed, theme, tokens, reducedMotion = false }: { seed: number; theme: StageTheme; tokens: SkyTokens; reducedMotion?: boolean }) {
  const root = useStageLayer<THREE.Group>("constellation");
  const director = useStageDirector();
  const { frame } = useStage();
  const size = useThree((s) => s.size);
  const aspect = bucketAspect(size.width, size.height);
  const scenery = useMemo(() => placeConstellationScenery({ seed, aspect }), [seed, aspect]);
  const built = useMemo(() => {
    const points = new SkyPointWriter(300);
    const quads = new QuadWriter();
    const placement: SkyPlacement = { seed, rung: "backdrop", aspect, galaxy: { u: 0.5, v: 0.5, size: 0, tilt: 0, roll: 0, depth: 1, seed: 0 }, objects: constellationSceneryAsPlaced(scenery), safeAreas: [] };
    writeObjects(points, quads, { theme, fovDeg: STAGE_CAMERA.fov, aspect, placement });
    return { points: points.finish(), quads: quads.finish() };
    // The tokens only colour the sky's own stars; the recipes carry their palettes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenery, theme, seed, aspect, tokens]);

  const pointsGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = built.points;
    g.setAttribute("position", new THREE.BufferAttribute(p.position, 3));
    g.setAttribute("color", new THREE.BufferAttribute(p.color, 3));
    g.setAttribute("size", new THREE.BufferAttribute(p.size, 1));
    g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(p.alpha), 1));
    g.setAttribute("phase", new THREE.BufferAttribute(p.phase, 1));
    g.setAttribute("shape", new THREE.BufferAttribute(p.shape, 1));
    g.setAttribute("drift", new THREE.BufferAttribute(p.drift, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, [built]);
  const pointsMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: POINTS_VERT,
        fragmentShader: POINTS_FRAG,
        vertexColors: true,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: { uTime: STAGE_UNIFORMS.uTime, uRes: STAGE_UNIFORMS.uRes, uCellPx: STAGE_UNIFORMS.uCellPx, uLight: STAGE_UNIFORMS.uLight, uDrift: { value: 0 } },
      }),
    [],
  );
  const quadMesh = useMemo(() => {
    const q = built.quads;
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute("iKind", new THREE.InstancedBufferAttribute(q.kind, 1));
    geometry.setAttribute("iParams", new THREE.InstancedBufferAttribute(q.params, 4));
    geometry.setAttribute("iParams2", new THREE.InstancedBufferAttribute(q.params2, 4));
    geometry.setAttribute("iC0", new THREE.InstancedBufferAttribute(q.c0, 3));
    geometry.setAttribute("iC1", new THREE.InstancedBufferAttribute(q.c1, 3));
    geometry.setAttribute("iC2", new THREE.InstancedBufferAttribute(q.c2, 3));
    geometry.setAttribute("iC3", new THREE.InstancedBufferAttribute(q.c3, 3));
    const material = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: QUAD_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: { uTime: STAGE_UNIFORMS.uTime, uRes: STAGE_UNIFORMS.uRes, uLight: STAGE_UNIFORMS.uLight, uFade: { value: 1 }, uMotion: { value: 1 } },
    });
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, q.count));
    mesh.instanceMatrix.array.set(q.matrices);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = q.count;
    mesh.frustumCulled = false;
    // Over the far galaxy hint (0), under the sky's star grain (1): the grain sprinkles over a nebula.
    mesh.renderOrder = 0.5;
    return mesh;
  }, [built]);

  useEffect(() => {
    applySkyBlend(pointsMaterial, theme);
    applySkyBlend(quadMesh.material as THREE.Material, theme);
    const f = frame.current;
    if (f) f.warm = true;
  }, [pointsMaterial, quadMesh, theme, frame]);
  useEffect(() => {
    (quadMesh.material as THREE.ShaderMaterial).uniforms.uMotion.value = reducedMotion ? 0 : 1;
  }, [quadMesh, reducedMotion]);
  useEffect(() => () => pointsGeometry.dispose(), [pointsGeometry]);
  useEffect(() => () => pointsMaterial.dispose(), [pointsMaterial]);
  useEffect(
    () => () => {
      quadMesh.geometry.dispose();
      (quadMesh.material as THREE.Material).dispose();
    },
    [quadMesh],
  );

  const lastFade = useRef(-1);
  useEffect(() => {
    lastFade.current = -1;
  }, [pointsGeometry]);
  useFrame(() => {
    const fade = constellationSceneryFade(director.sample().L);
    const group = root.current;
    if (group) group.visible = fade > HIDE_BELOW;
    if (fade === lastFade.current) return;
    lastFade.current = fade;
    (quadMesh.material as THREE.ShaderMaterial).uniforms.uFade.value = fade;
    const attr = pointsGeometry.getAttribute("alpha") as THREE.BufferAttribute;
    const base = built.points.alpha;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < base.length; i++) arr[i] = base[i] * fade;
    attr.needsUpdate = true;
  }, -1);

  return (
    <group ref={root} name="stage-constellation-scenery" visible={false}>
      <primitive object={quadMesh} />
      <points geometry={pointsGeometry} material={pointsMaterial} frustumCulled={false} renderOrder={0.6} />
    </group>
  );
}
