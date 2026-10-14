"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { armPoint, type CourseBead, type GalaxyLayout, type ObjectSlot, type SlotType, type Vec3 } from "./galaxy-layout";
import { buildDiscBuffers, buildHaloBuffers, buildShellBuffers, type GrainBuffers } from "./map-points";
import { MAP_PALETTES, type MapPalette } from "./palettes";
import { POINTS_FRAG, POINTS_VERT, QUAD_FRAG, QUAD_VERT } from "./shaders";
import { MAP_UNIFORMS, type MapTheme } from "./uniforms";

// ---------------------------------------------------------------------------
// Hover / selection model
// ---------------------------------------------------------------------------

export type HoverKind = "bead" | "globular" | "satellite" | "slot";

export interface Hoverable {
  kind: HoverKind;
  id: string;
  /** Position in its group's local frame (disc or halo). */
  local: Vec3;
  frame: "disc" | "halo";
  title: string;
  note: string;
  /** Label anchor offset in the local frame. */
  offset: Vec3;
}

export function hoverables(layout: GalaxyLayout): Hoverable[] {
  const out: Hoverable[] = [];
  for (const b of layout.beads) {
    out.push({
      kind: "bead",
      id: b.courseId,
      local: b.position,
      frame: "disc",
      title: b.name,
      note: `${b.kind === "current" ? "you are here · " : ""}${b.subject} arm ${b.arm + 1} · r ${b.a.toFixed(2)} · mastery ${(b.warmth * 100).toFixed(0)} %${b.hasWorld ? " · has a world" : ""}`,
      // Convex side of the arm plus a lift off the plane, so the pill floats beside the ring instead of over it.
      offset: [b.labelDir[0] * (b.radius + 0.08), 0.1, b.labelDir[1] * (b.radius + 0.08)],
    });
  }
  for (const g of layout.globulars) out.push({ kind: "globular", id: g.courseId, local: g.position, frame: "halo", title: g.name, note: "archived · halo globular", offset: [0, g.radius + 0.06, 0] });
  for (const s of layout.satellites) out.push({ kind: "satellite", id: s.friendId, local: s.position, frame: "halo", title: s.name, note: "friend · satellite dwarf", offset: [0, s.radius + 0.1, 0] });
  for (const s of layout.slots) out.push({ kind: "slot", id: `${s.type}@${s.sector}`, local: s.position, frame: "disc", title: SLOT_LABEL[s.type], note: s.note, offset: [0, s.radius + 0.06, 0] });
  return out;
}

export const SLOT_LABEL: Record<SlotType, string> = {
  blackhole: "black hole",
  nebula: "nebula",
  pulsar: "pulsar",
  comet: "comet",
  binary: "binary",
  "ringed-giant": "ringed giant",
  "white-hole": "white hole",
  "supernova-remnant": "supernova remnant",
};

const SLOT_MODE: Record<SlotType, number> = {
  blackhole: 10,
  nebula: 11,
  pulsar: 12,
  comet: 13,
  binary: 14,
  "ringed-giant": 15,
  "white-hole": 16,
  "supernova-remnant": 17,
};

function slotColor(p: MapPalette, type: SlotType): string {
  switch (type) {
    case "blackhole":
      return p.blackHole;
    case "nebula":
      return p.nebula;
    case "pulsar":
      return p.pulsar;
    case "comet":
      return p.comet;
    case "binary":
      return p.binary;
    case "ringed-giant":
      return p.ringedGiant;
    case "white-hole":
      return p.whiteHole;
    default:
      return p.remnant;
  }
}

// ---------------------------------------------------------------------------
// Grain points
// ---------------------------------------------------------------------------

function grainGeometry(b: GrainBuffers): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(b.position.subarray(0, b.count * 3), 3));
  g.setAttribute("color", new THREE.BufferAttribute(b.color.subarray(0, b.count * 3), 3));
  g.setAttribute("size", new THREE.BufferAttribute(b.size.subarray(0, b.count), 1));
  g.setAttribute("phase", new THREE.BufferAttribute(b.phase.subarray(0, b.count), 1));
  g.setAttribute("dim", new THREE.BufferAttribute(b.dim.subarray(0, b.count), 1));
  return g;
}

function GrainPoints({ buffers, theme, alpha, additive = true, renderOrder = 0 }: { buffers: GrainBuffers; theme: MapTheme; alpha: number; additive?: boolean; renderOrder?: number }) {
  const geometry = useMemo(() => grainGeometry(buffers), [buffers]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: POINTS_VERT,
        fragmentShader: POINTS_FRAG,
        vertexColors: true,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: { uTime: MAP_UNIFORMS.uTime, uRes: MAP_UNIFORMS.uRes, uLight: MAP_UNIFORMS.uLight, uAlpha: { value: alpha } },
      }),
    [alpha],
  );
  useEffect(() => {
    material.blending = additive && theme === "dark" ? THREE.AdditiveBlending : THREE.NormalBlending;
    material.needsUpdate = true;
  }, [material, theme, additive]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={renderOrder} />;
}

// ---------------------------------------------------------------------------
// Instanced quads
// ---------------------------------------------------------------------------

interface QuadInstance {
  position: Vec3;
  size: number;
  color: string;
  alpha: number;
  mode: number;
  p0?: number;
  p1?: number;
  phase?: number;
  /** Instance ids let the scene flip alpha for hover / selection without rebuilding. */
  tag?: string;
}

function QuadField({ instances, theme, billboard, flat, renderOrder = 1, dynamicAlpha }: { instances: QuadInstance[]; theme: MapTheme; billboard: boolean; flat: boolean; renderOrder?: number; dynamicAlpha?: Map<string, number> }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const count = Math.max(1, instances.length);
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(2, 2);
    const colors = new Float32Array(count * 3);
    const params = new Float32Array(count * 4);
    const phases = new Float32Array(count);
    const c = new THREE.Color();
    instances.forEach((q, i) => {
      c.set(q.color);
      colors.set([c.r, c.g, c.b], i * 3);
      params.set([q.alpha, q.mode, q.p0 ?? 0, q.p1 ?? 0], i * 4);
      phases[i] = q.phase ?? 0;
    });
    g.setAttribute("iColor", new THREE.InstancedBufferAttribute(colors, 3));
    g.setAttribute("iParams", new THREE.InstancedBufferAttribute(params, 4));
    g.setAttribute("iPhase", new THREE.InstancedBufferAttribute(phases, 1));
    return g;
  }, [instances, count]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: QUAD_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { uLight: MAP_UNIFORMS.uLight, uTime: MAP_UNIFORMS.uTime, uBillboard: { value: billboard ? 1 : 0 } },
      }),
    [billboard],
  );
  useEffect(() => {
    material.blending = theme === "dark" ? THREE.AdditiveBlending : THREE.NormalBlending;
    material.needsUpdate = true;
  }, [material, theme]);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    if (flat) q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    instances.forEach((inst, i) => {
      pos.set(inst.position[0], inst.position[1], inst.position[2]);
      scl.set(inst.size, inst.size, 1);
      mat.compose(pos, q, scl);
      m.setMatrixAt(i, mat);
    });
    m.count = instances.length;
    m.instanceMatrix.needsUpdate = true;
  }, [instances, flat]);
  // Hover / selection: rewrite only the alpha lane of tagged instances.
  useEffect(() => {
    if (!dynamicAlpha) return;
    const attr = geometry.getAttribute("iParams") as THREE.InstancedBufferAttribute;
    let dirty = false;
    instances.forEach((q, i) => {
      if (!q.tag) return;
      const a = dynamicAlpha.get(q.tag) ?? 0;
      if (attr.getX(i) !== a) {
        attr.setX(i, a);
        dirty = true;
      }
    });
    if (dirty) attr.needsUpdate = true;
  }, [dynamicAlpha, geometry, instances]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return <instancedMesh ref={mesh} args={[geometry, material, count]} frustumCulled={false} renderOrder={renderOrder} />;
}

// ---------------------------------------------------------------------------
// Instance builders
// ---------------------------------------------------------------------------

function mixHex(a: string, b: string, t: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}

/** Flat quads in the disc plane: bulge, bead glows + cores + rings, object markers. */
function discQuads(layout: GalaxyLayout, p: MapPalette): QuadInstance[] {
  const out: QuadInstance[] = [];
  // Disc body: one wide lilac glow so the arms sit on a disc, not on black (Hurt map).
  out.push({ position: [0, 0, 0], size: 0.98, color: p.disc, alpha: 0.1, mode: 0 });
  // Arm ribbons: many overlapping soft glows along each spine so the arm reads as a ribbon, not beads.
  for (const arm of layout.arms) {
    const n = arm.kind === "major" ? 44 : arm.kind === "minor" ? 26 : 10;
    for (let i = 0; i < n; i++) {
      const a = arm.aStart + ((arm.aEnd - arm.aStart) * (i + 0.5)) / n;
      out.push({ position: armPoint(layout.shape, arm, a), size: (arm.kind === "spur" ? 0.045 : 0.06) + 0.045 * a, color: p.arm, alpha: arm.kind === "major" ? 0.085 : 0.06, mode: 0 });
    }
  }
  // Bulge: a cream ball plus the bar as a tilted ellipse.
  out.push({ position: [0, 0, 0], size: layout.shape.bulgeSigma * 1.7, color: p.core, alpha: 0.6, mode: 0 });
  out.push({ position: [0, 0, 0], size: layout.shape.barHalfLength * 1.12, color: p.bar, alpha: 0.4, mode: 7, p0: 0.4, p1: 0 });
  for (const b of layout.beads) {
    const glow = b.kind === "current" ? mixHex(p.beadWarm, p.youAreHere, 0.5) : mixHex(p.beadCool, p.beadWarm, b.warmth);
    out.push({ position: b.position, size: b.radius, color: glow, alpha: b.kind === "current" ? 0.75 : 0.55 + 0.2 * b.warmth, mode: 0, phase: b.a });
  }
  for (const b of layout.beads) {
    if (b.hasWorld) out.push({ position: [b.position[0], b.position[1] + 0.001, b.position[2]], size: b.radius * 0.34, color: p.beadWorldCore, alpha: 1, mode: 3 });
    else out.push({ position: [b.position[0], b.position[1] + 0.001, b.position[2]], size: b.radius * 0.22, color: "#fffaf0", alpha: 0.95, mode: 0 });
  }
  for (const b of layout.beads) {
    const ringSize = b.radius * 1.3;
    if (b.kind === "current") out.push({ position: b.position, size: ringSize, color: p.youAreHere, alpha: 0.95, mode: 1, p0: 0.06, phase: 0.2 });
    out.push({ position: b.position, size: ringSize, color: p.ringHover, alpha: 0, mode: 2, p0: 0.05, tag: `hover:${b.courseId}` });
    out.push({ position: b.position, size: ringSize * 1.08, color: p.youAreHere, alpha: 0, mode: 1, p0: 0.05, tag: `select:${b.courseId}` });
  }
  layout.slots.forEach((s, i) => {
    const p1 = s.heading ? Math.atan2(-s.heading[2], s.heading[0]) : 0;
    out.push({ position: s.position, size: s.radius * (s.type === "nebula" ? 1.0 : 1.5), color: slotColor(p, s.type), alpha: s.type === "nebula" ? 0.55 : 0.9, mode: SLOT_MODE[s.type], p0: 0, p1, phase: (i + 1) / (layout.slots.length + 1) });
  });
  return out;
}

/** Billboard quads in the halo frame: globular glows, satellite haze + bar + knot. */
function haloQuads(layout: GalaxyLayout, p: MapPalette): QuadInstance[] {
  const out: QuadInstance[] = [];
  for (const g of layout.globulars) out.push({ position: g.position, size: g.radius * 0.9, color: p.globularGlow, alpha: 0.14, mode: 0 });
  for (const s of layout.satellites) {
    out.push({ position: s.position, size: s.radius * 1.45, color: p.satelliteHaze, alpha: 0.08, mode: 0 });
    out.push({ position: s.position, size: s.radius * 1.05, color: p.satelliteBar, alpha: 0.24, mode: 7, p0: 0.38, p1: s.yaw });
    const kx = Math.cos(s.yaw) * s.knotSide * s.radius * 0.8;
    const kz = Math.sin(s.yaw) * s.knotSide * s.radius * 0.8;
    out.push({ position: [s.position[0] + kx, s.position[1], s.position[2] + kz], size: s.radius * 0.3, color: p.satelliteKnot, alpha: 0.9, mode: 0 });
  }
  return out;
}

const DEEP_RADIUS = 7.6;
/** One pixel-pass cell at the deep shell, in world units, for the default camera distance. */
const DEEP_CELL = 0.024;

function deepQuads(layout: GalaxyLayout, p: MapPalette): QuadInstance[] {
  return layout.deepField.map((s, i) => {
    const position: Vec3 = [s.dir[0] * DEEP_RADIUS, s.dir[1] * DEEP_RADIUS, s.dir[2] * DEEP_RADIUS];
    const size = DEEP_CELL * s.cells;
    const angle = (i * 2.399) % Math.PI;
    if (s.kind === "elliptical") return { position, size, color: s.group === "field" ? p.smudgeWarm : s.cells > 2 ? p.smudgeWhite : p.smudgeGold, alpha: s.group === "field" ? 0.5 : 0.7, mode: 4, p0: 0.65, p1: angle };
    if (s.kind === "spiral") return { position, size, color: p.smudgeBlue, alpha: 0.6, mode: 5 };
    return { position, size: size * 1.4, color: p.smudgeGold, alpha: 0.45, mode: 6, p1: angle };
  });
}

// ---------------------------------------------------------------------------
// Guides
// ---------------------------------------------------------------------------

function Guides({ layout, p }: { layout: GalaxyLayout; p: MapPalette }) {
  const geometry = useMemo(() => {
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    const seg = (a: Vec3, b: Vec3, hex: string) => {
      c.set(hex);
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    const poly = (pts: Vec3[], hex: string) => {
      for (let i = 0; i + 1 < pts.length; i++) seg(pts[i], pts[i + 1], hex);
    };
    const circle = (cx: number, cz: number, r: number, hex: string, n = 64) => {
      const pts: Vec3[] = [];
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI * 2;
        pts.push([cx + r * Math.cos(t), 0, cz + r * Math.sin(t)]);
      }
      poly(pts, hex);
    };
    for (const arm of layout.arms) {
      const pts: Vec3[] = [];
      for (let i = 0; i <= 48; i++) pts.push(armPoint(layout.shape, arm, arm.aStart + ((arm.aEnd - arm.aStart) * i) / 48));
      poly(pts, arm.kind === "major" ? p.guideArm : p.guideMinor);
    }
    const bh = layout.shape.barHalfLength;
    seg([-bh * Math.cos(layout.shape.barAngle), 0, -bh * Math.sin(layout.shape.barAngle)], [bh * Math.cos(layout.shape.barAngle), 0, bh * Math.sin(layout.shape.barAngle)], p.guideArm);
    for (let s = 0; s < 6; s++) {
      const t = (s / 6) * Math.PI * 2;
      seg([0.2 * Math.cos(t), 0, 0.2 * Math.sin(t)], [1.08 * Math.cos(t), 0, 1.08 * Math.sin(t)], p.guideSector);
    }
    circle(0, 0, 1, p.guideDepth);
    circle(0, 0, 2, p.guideDepth, 96);
    circle(layout.focal.position[0], layout.focal.position[2], layout.focal.radius, p.guideFocal, 48);
    for (const s of layout.slots) {
      const anchor = s.anchorCourseId ? layout.beads.find((b) => b.courseId === s.anchorCourseId) : null;
      if (anchor && s.type !== "nebula") seg(s.position, anchor.position, p.guideFocal);
      if (s.heading) seg(s.position, [s.position[0] + s.heading[0] * 0.3, s.position[1], s.position[2] + s.heading[2] * 0.3], p.guideFocal);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [layout, p]);
  const material = useMemo(() => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }), []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return (
    <>
      <lineSegments geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />
      {layout.arms.map((arm) => {
        const end = armPoint(layout.shape, arm, arm.aEnd);
        return (
          <Html key={arm.index} position={[end[0] * 1.06, end[1], end[2] * 1.06]} center zIndexRange={[20, 0]} wrapperClass="cosmos-lab__html">
            <div className="cosmos-lab__guide-label">
              {arm.kind} arm {arm.index + 1}
              {arm.subjects.length ? ` · ${arm.subjects.join(" · ")}` : ""}
            </div>
          </Html>
        );
      })}
      <Html position={[0, 0, -1.02]} center zIndexRange={[20, 0]} wrapperClass="cosmos-lab__html">
        <div className="cosmos-lab__guide-label">disc · 1 R · spins 1 turn / 240 s</div>
      </Html>
      <Html position={[0, 0, -2.04]} center zIndexRange={[20, 0]} wrapperClass="cosmos-lab__html">
        <div className="cosmos-lab__guide-label">halo · 2 R · counter 1 turn / 600 s · globulars + satellites</div>
      </Html>
      <Html position={[layout.focal.position[0], 0, layout.focal.position[2] + layout.focal.radius + 0.05]} center zIndexRange={[20, 0]} wrapperClass="cosmos-lab__html">
        <div className="cosmos-lab__guide-label cosmos-lab__guide-label--focal">focal region · the only saturated warm</div>
      </Html>
    </>
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export interface MapSceneProps {
  layout: GalaxyLayout;
  theme: MapTheme;
  guides: boolean;
  /** Turns per minute of auto-orbit; 0 = off. */
  orbit: number;
  hovered: string | null;
  selected: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  children?: ReactNode;
}

const TAU = Math.PI * 2;

export function MapScene({ layout, theme, guides, orbit, hovered, selected, onHover, onSelect }: MapSceneProps) {
  const p = MAP_PALETTES[theme];
  const discGroup = useRef<THREE.Group>(null);
  const haloGroup = useRef<THREE.Group>(null);
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size, pointer, gl } = useThree();

  const disc = useMemo(() => buildDiscBuffers(layout, p), [layout, p]);
  const halo = useMemo(() => buildHaloBuffers(layout, p), [layout, p]);
  const shellRadius = layout.depths.find((d) => d.name === "deep-field")?.radius ?? 8;
  const shell = useMemo(() => buildShellBuffers(layout.seed, shellRadius, p), [layout.seed, shellRadius, p]);
  const discQ = useMemo(() => discQuads(layout, p), [layout, p]);
  const haloQ = useMemo(() => haloQuads(layout, p), [layout, p]);
  const deepQ = useMemo(() => deepQuads(layout, p), [layout, p]);
  const items = useMemo(() => hoverables(layout), [layout]);

  const dynamicAlpha = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of layout.beads) {
      m.set(`hover:${b.courseId}`, hovered === b.courseId && selected !== b.courseId ? 0.85 : 0);
      m.set(`select:${b.courseId}`, selected === b.courseId ? 0.95 : 0);
    }
    return m;
  }, [layout, hovered, selected]);

  // Hover by projection: no raycasts, no hit meshes.
  const hoverRef = useRef<string | null>(null);
  const world = useMemo(() => new THREE.Vector3(), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const t = MAP_UNIFORMS.uTime.value;
    const discSpin = layout.depths[1].spin;
    const haloSpin = layout.depths[2].spin;
    if (discGroup.current) discGroup.current.rotation.y = t * discSpin * TAU;
    if (haloGroup.current) haloGroup.current.rotation.y = t * haloSpin * TAU;

    let best: string | null = null;
    let bestD = (28 / size.height) * 2;
    for (const it of items) {
      const g = it.frame === "disc" ? discGroup.current : haloGroup.current;
      if (!g) continue;
      world.set(it.local[0], it.local[1], it.local[2]).applyMatrix4(g.matrixWorld).project(camera);
      if (world.z > 1) continue;
      const dx = (world.x - pointer.x) * (size.width / size.height);
      const dy = world.y - pointer.y;
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = it.id;
      }
    }
    if (best !== hoverRef.current) {
      hoverRef.current = best;
      onHover(best);
    }

    // Selection eases the orbit target onto the bead (ease-out); deselect eases home.
    const c = controls.current;
    if (c) {
      const sel = selected ? items.find((it) => it.id === selected) : null;
      if (sel) {
        const g = sel.frame === "disc" ? discGroup.current : haloGroup.current;
        if (g) target.set(sel.local[0], sel.local[1], sel.local[2]).applyMatrix4(g.matrixWorld);
      } else target.set(0, 0, 0);
      c.target.lerp(target, 0.08);
      c.autoRotate = orbit > 0;
      c.autoRotateSpeed = orbit;
    }
  }, -2);

  useEffect(() => {
    const el = gl.domElement;
    let downAt: [number, number] | null = null;
    const down = (e: PointerEvent) => {
      downAt = [e.clientX, e.clientY];
    };
    const up = (e: PointerEvent) => {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
      downAt = null;
      if (moved > 6) return; // an orbit drag, not a click
      const h = hoverRef.current;
      onSelect(h && h === selected ? null : h);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
    };
  }, [gl, onSelect, selected]);

  const current = layout.beads.find((b) => b.kind === "current") ?? null;
  const labelFor = (it: Hoverable, cls: string) => (
    <Html key={`${it.kind}:${it.id}`} position={[it.local[0] + it.offset[0], it.local[1] + it.offset[1], it.local[2] + it.offset[2]]} center zIndexRange={[30, 0]} wrapperClass="cosmos-lab__html">
      <div className={`cosmos-lab__label ${cls}`}>
        <strong>{it.title}</strong>
        {cls !== "cosmos-lab__label--current" || hovered === it.id || selected === it.id ? <span>{it.note}</span> : null}
      </div>
    </Html>
  );
  const discLabels: ReactNode[] = [];
  const haloLabels: ReactNode[] = [];
  for (const it of items) {
    const isCurrent = it.kind === "bead" && current?.courseId === it.id;
    const show = isCurrent || hovered === it.id || selected === it.id;
    if (!show) continue;
    const cls = isCurrent ? "cosmos-lab__label--current" : selected === it.id ? "cosmos-lab__label--selected" : "cosmos-lab__label--hover";
    (it.frame === "disc" ? discLabels : haloLabels).push(labelFor(it, cls));
  }

  return (
    <>
      <OrbitControls ref={controls} makeDefault enablePan={false} enableDamping dampingFactor={0.08} minDistance={2.2} maxDistance={7} minPolarAngle={0.25} maxPolarAngle={Math.PI - 0.25} rotateSpeed={0.6} zoomSpeed={0.7} />
      {/* Deep field + three-shell stars: camera parallax only. */}
      <GrainPoints buffers={shell} theme={theme} alpha={1} renderOrder={0} />
      <QuadField instances={deepQ} theme={theme} billboard flat={false} renderOrder={0} />
      {/* Halo frame: counter-rotates slowly. */}
      <group ref={haloGroup}>
        <GrainPoints buffers={halo} theme={theme} alpha={0.95} renderOrder={1} />
        <QuadField instances={haloQ} theme={theme} billboard flat={false} renderOrder={1} />
        {haloLabels}
      </group>
      {/* Disc frame: the subject. */}
      <group ref={discGroup}>
        <GrainPoints buffers={disc.stars} theme={theme} alpha={0.95} renderOrder={2} />
        <GrainPoints buffers={disc.dust} theme={theme} alpha={0.78} additive={false} renderOrder={3} />
        <QuadField instances={discQ} theme={theme} billboard={false} flat renderOrder={4} dynamicAlpha={dynamicAlpha} />
        {guides ? <Guides layout={layout} p={p} /> : null}
        {discLabels}
      </group>
    </>
  );
}

export function sceneBudget(layout: GalaxyLayout): { drawCalls: number; points: number; quads: number } {
  const disc = buildDiscBuffers(layout);
  const halo = buildHaloBuffers(layout);
  const shell = buildShellBuffers(layout.seed, 8);
  const quads = discQuads(layout, MAP_PALETTES.dark).length + haloQuads(layout, MAP_PALETTES.dark).length + layout.deepField.length;
  // shell, deep field, halo grain, halo quads, disc stars, dust, disc quads (+1 line batch with guides).
  return { drawCalls: 7, points: disc.stars.count + disc.dust.count + halo.count + shell.count, quads };
}

export type { CourseBead, ObjectSlot };
