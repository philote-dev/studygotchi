"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EDGE_INDICES, WEAK_DASH, type EdgeBuffers } from "@/lib/graph/twin/buffers";
import { orthoFrom2D } from "@/lib/graph/twin/camera";
import type { Camera2D, TwinSize } from "@/lib/graph/twin/types";
import { DUST_FRAG, DUST_VERT, EDGE_FRAG, EDGE_VERT, NODE_FRAG, NODE_VERT } from "./glyph-shaders";
import type { TwinController, TwinFrameOutput } from "./twin-controller";
import type { TwinSourceFrame } from "./twin-source";

/** Premultiplied "over", no depth: the twin is drawn back to front in one layer. */
function glyphMaterial(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    toneMapped: false,
  });
}

/** A unit quad (±1) instanced `count` times. */
function instancedQuad(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

function setInstanced(g: THREE.InstancedBufferGeometry, name: string, array: Float32Array, itemSize: number): void {
  const existing = g.getAttribute(name) as THREE.InstancedBufferAttribute | undefined;
  if (existing && existing.array === array) {
    existing.needsUpdate = true;
    return;
  }
  if (existing && existing.array.length === array.length) {
    (existing.array as Float32Array).set(array);
    existing.needsUpdate = true;
    return;
  }
  const attribute = new THREE.InstancedBufferAttribute(array.slice(), itemSize);
  attribute.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute(name, attribute);
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

function uploadEdges(eg: THREE.BufferGeometry, edges: EdgeBuffers): void {
  setAttribute(eg, "position", edges.position, 3);
  setAttribute(eg, "aNormal", edges.normal, 2);
  setAttribute(eg, "aSide", edges.side, 1);
  setAttribute(eg, "aHalf", edges.half, 1);
  setAttribute(eg, "aColor", edges.color, 4);
  setAttribute(eg, "aAlong", edges.along, 1);
  if (!eg.index || eg.index.array.length !== edges.index.length) eg.setIndex(new THREE.BufferAttribute(edges.index, 1));
  eg.setDrawRange(0, edges.count * EDGE_INDICES);
}

export interface TwinSceneProps {
  controller: TwinController;
  /** Pull the newest frame from the source (the 2D controller) each tick. */
  read: () => TwinSourceFrame | null;
  /** The orthographic camera to drive (the standalone canvas's, or the overlay pass's). */
  camera: THREE.OrthographicCamera;
  /** Called after a frame was uploaded and will be drawn. */
  onDrawn?: (output: TwinFrameOutput) => void;
}

/**
 * The twin's GL content: dust, edges, nodes as three draws, rebuilt only when
 * the controller reports a changed frame, with the camera set from the 2D
 * `{x, y, k}` every frame. Labels are DOM (`TwinLabels`), fed by the same
 * controller.
 */
export function TwinScene({ controller, read, camera, onDrawn }: TwinSceneProps) {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const uniforms = useMemo(() => ({ uK: { value: 1 } }), []);
  const bundle = useMemo(() => {
    const dustGeometry = instancedQuad();
    const dustMaterial = glyphMaterial(DUST_VERT, DUST_FRAG, { uK: uniforms.uK });
    const nodeGeometry = instancedQuad();
    const nodeMaterial = glyphMaterial(NODE_VERT, NODE_FRAG, { uK: uniforms.uK, uStar: { value: new THREE.Vector3(1, 1, 1) } });
    const edgeGeometry = new THREE.BufferGeometry();
    const edgeMaterial = glyphMaterial(EDGE_VERT, EDGE_FRAG, {
      uK: uniforms.uK,
      uDash: { value: new THREE.Vector2(0, 0) },
      uDashOffset: { value: 0 },
    });
    // Weak traces: the same strips, dashed [5, 9] with the 2D's lineDashOffset.
    const weakGeometry = new THREE.BufferGeometry();
    const weakMaterial = glyphMaterial(EDGE_VERT, EDGE_FRAG, {
      uK: uniforms.uK,
      uDash: { value: new THREE.Vector2(WEAK_DASH[0], WEAK_DASH[1]) },
      uDashOffset: { value: 0 },
    });
    return { dustGeometry, dustMaterial, nodeGeometry, nodeMaterial, edgeGeometry, edgeMaterial, weakGeometry, weakMaterial };
  }, [uniforms]);
  useEffect(
    () => () => {
      bundle.dustGeometry.dispose();
      bundle.dustMaterial.dispose();
      bundle.nodeGeometry.dispose();
      bundle.nodeMaterial.dispose();
      bundle.edgeGeometry.dispose();
      bundle.edgeMaterial.dispose();
      bundle.weakGeometry.dispose();
      bundle.weakMaterial.dispose();
    },
    [bundle],
  );

  const dustRef = useRef<THREE.Mesh>(null);
  const nodeRef = useRef<THREE.Mesh>(null);
  const edgeRef = useRef<THREE.Mesh>(null);
  const weakRef = useRef<THREE.Mesh>(null);
  const uploaded = useRef(0);

  // Pre-warm: compile the four glyph programs before the first draw (the meshes are visible with
  // no instances yet), so the first frame with a layout, which may land mid-hop, meets no shader
  // stall. On the canvas's first frame rather than in the commit: the page's DOM commit and the
  // WebGL context creation already share that frame (S4-2 stall diagnosis), the compile is the
  // next one's.
  const compiled = useRef<typeof bundle | null>(null);
  useFrame(() => {
    if (compiled.current === bundle) return;
    compiled.current = bundle;
    gl.compile(scene, camera);
  }, -1);

  const applyCamera = (cam: Camera2D, size: TwinSize) => {
    const f = orthoFrom2D(cam, size);
    camera.left = f.left;
    camera.right = f.right;
    camera.top = f.top;
    camera.bottom = f.bottom;
    camera.near = f.near;
    camera.far = f.far;
    camera.position.set(f.position.x, f.position.y, f.position.z);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    uniforms.uK.value = cam.k;
  };

  useFrame(() => {
    const frame = read();
    const output = controller.update(frame) ?? controller.current;
    const visible = output !== null;
    if (dustRef.current) dustRef.current.visible = visible;
    if (nodeRef.current) nodeRef.current.visible = visible;
    if (edgeRef.current) edgeRef.current.visible = visible;
    if (weakRef.current) weakRef.current.visible = visible && (output?.weakEdges.count ?? 0) > 0;
    if (!output) return;
    applyCamera(output.frame.cam, output.frame.size);
    if (output.version === uploaded.current) return;
    uploaded.current = output.version;

    const { dust, nodes, edges, weakEdges } = output;
    setInstanced(bundle.dustGeometry, "aPos", dust.position, 2);
    setInstanced(bundle.dustGeometry, "aRadius", dust.radius, 1);
    setInstanced(bundle.dustGeometry, "aColor", dust.color, 4);
    bundle.dustGeometry.instanceCount = dust.count;

    setInstanced(bundle.nodeGeometry, "aPos", nodes.position, 2);
    setInstanced(bundle.nodeGeometry, "aCore", nodes.core, 1);
    setInstanced(bundle.nodeGeometry, "aGlow", nodes.glow, 1);
    setInstanced(bundle.nodeGeometry, "aRayLen", nodes.rayLength, 1);
    setInstanced(bundle.nodeGeometry, "aRayAngle", nodes.rayAngle, 1);
    setInstanced(bundle.nodeGeometry, "aOpacity", nodes.opacity, 1);
    setInstanced(bundle.nodeGeometry, "aAlpha", nodes.alpha, 1);
    bundle.nodeGeometry.instanceCount = nodes.count;
    (bundle.nodeMaterial.uniforms.uStar.value as THREE.Vector3).set(...nodes.starColor);

    uploadEdges(bundle.edgeGeometry, edges);
    uploadEdges(bundle.weakGeometry, weakEdges);
    bundle.weakMaterial.uniforms.uDashOffset.value = output.weakDashOffset;

    onDrawn?.(output);
    invalidate();
  }, -1);

  return (
    <group>
      <mesh ref={dustRef} geometry={bundle.dustGeometry} material={bundle.dustMaterial} frustumCulled={false} renderOrder={0} />
      <mesh ref={edgeRef} geometry={bundle.edgeGeometry} material={bundle.edgeMaterial} frustumCulled={false} renderOrder={1} />
      <mesh ref={weakRef} geometry={bundle.weakGeometry} material={bundle.weakMaterial} frustumCulled={false} renderOrder={2} />
      <mesh ref={nodeRef} geometry={bundle.nodeGeometry} material={bundle.nodeMaterial} frustumCulled={false} renderOrder={3} />
    </group>
  );
}
