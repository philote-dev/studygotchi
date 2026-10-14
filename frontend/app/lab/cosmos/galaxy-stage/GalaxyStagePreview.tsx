"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { DITHER_MODE, type DitherMode } from "@/lib/light";
import { seedFromText } from "@/lib/stage/rng";
import type { GalaxyCourse, GalaxyLayout } from "@/lib/galaxy/layout";
import { SKY } from "@/lib/galaxy/palettes";
import { generateGalaxySpec } from "@/lib/galaxy/spec";
import { GalaxyLayer } from "@/components/stage/layers/galaxy/GalaxyLayer";
import type { GalaxyLayerBudget } from "@/components/stage/layers/galaxy/galaxy-layer-model";
import { createStageFrame, StageComposer, type StageFrame } from "@/components/stage/render/StageComposer";
import { createStageRegistry, StageContext, type StageApi } from "@/components/stage/StageContext";
import { STAGE_UNIFORMS, stageClock, type StageTheme } from "@/components/stage/lib/uniforms";
import { STAGE_CAMERA } from "@/components/stage/lib/view";
import "./galaxy-stage.css";

/** Light models the preview exposes: the accepted Bayer grid, the IGN grain, the old bands for reference. */
export const LIGHT_MODELS: { id: DitherMode; label: string }[] = [
  { id: "bayer8", label: "Bayer 8" },
  { id: "ign", label: "IGN grain" },
  { id: "bands", label: "bands (old)" },
];

/**
 * A plausible six-course term in the product shape (lab-only data, like the
 * outer-zone lab's fake-courses): two physics, two math, one world-less
 * language course, one archived. `?courses=3|6|12` takes a prefix of twelve.
 */
const day = (d: number) => new Date(Date.UTC(2026, 9, d)).toISOString();
export const PREVIEW_COURSES: readonly GalaxyCourse[] = [
  { id: "8.223", code: "8.223", title: "Classical Mechanics II", conceptCount: 64, mastery: 0.62, hasWorld: true, archived: false, lastOpenedAt: day(11) },
  { id: "18.06", code: "18.06", title: "Linear Algebra", conceptCount: 52, mastery: 0.78, hasWorld: true, archived: false, lastOpenedAt: day(9) },
  { id: "21G.401", code: "21G.401", title: "Korean I", conceptCount: 90, mastery: 0.41, hasWorld: false, archived: false, lastOpenedAt: day(10) },
  { id: "6.1010", code: "6.1010", title: "Fundamentals of Programming", conceptCount: 48, mastery: 0.86, hasWorld: true, archived: false, lastOpenedAt: day(8) },
  { id: "8.044", code: "8.044", title: "Statistical Physics I", conceptCount: 40, mastery: 0.33, hasWorld: false, archived: false, lastOpenedAt: day(7) },
  { id: "7.012", code: "7.012", title: "Introductory Biology", conceptCount: 58, mastery: 0.9, hasWorld: false, archived: true, lastOpenedAt: day(2) },
  { id: "18.100A", code: "18.100A", title: "Real Analysis", conceptCount: 36, mastery: 0.55, hasWorld: false, archived: false, lastOpenedAt: day(6) },
  { id: "6.1210", code: "6.1210", title: "Algorithms", conceptCount: 44, mastery: 0.22, hasWorld: false, archived: false, lastOpenedAt: day(5) },
  { id: "21W.021", code: "21W.021", title: "Writing and Experience", conceptCount: 18, mastery: 0.7, hasWorld: false, archived: false, lastOpenedAt: day(4) },
  { id: "14.01", code: "14.01", title: "Microeconomics", conceptCount: 30, mastery: 0.48, hasWorld: false, archived: false, lastOpenedAt: day(3) },
  { id: "5.111", code: "5.111", title: "Principles of Chemical Science", conceptCount: 50, mastery: 0.83, hasWorld: false, archived: true, lastOpenedAt: day(1) },
  { id: "24.00", code: "24.00", title: "Problems of Philosophy", conceptCount: 22, mastery: 0.95, hasWorld: false, archived: true, lastOpenedAt: null },
];

export interface GalaxyStageInitial {
  seed: string;
  theme: StageTheme;
  fade: number;
  size: number;
  lightModel: DitherMode;
  courses: 3 | 6 | 12;
  current: string | null;
  chrome: boolean;
  /** Freeze the stage clock at this ms (deterministic captures). */
  t: number | null;
  /**
   * Diagnostic: draw an opaque sky-coloured quad behind everything, which makes
   * the stage composite in linear light like the lab's opaque canvas. Off = the
   * product stage as it is today (transparent canvas, browser composites the
   * partial-alpha light in sRGB space, so soft skirts read dimmer).
   */
  backing: boolean;
}

/** A sky-coloured opaque plane glued to the camera's far side, drawn before every layer. */
function SkyBacking({ theme }: { theme: StageTheme }) {
  const camera = useThree((s) => s.camera);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: SKY.dark, depthTest: false, depthWrite: false, transparent: false }), []);
  useEffect(() => {
    material.color.set(theme === "dark" ? SKY.dark : SKY.light);
  }, [material, theme]);
  useEffect(() => () => material.dispose(), [material]);
  const distance = (camera as THREE.PerspectiveCamera).far * 0.9;
  const fov = (camera as THREE.PerspectiveCamera).fov ?? STAGE_CAMERA.fov;
  const h = 2 * distance * Math.tan((fov * Math.PI) / 360) * 1.1;
  const aspect = (camera as THREE.PerspectiveCamera).aspect ?? 1.6;
  return (
    <mesh position={[0, 0, -distance]} material={material} renderOrder={-1000} frustumCulled={false}>
      <planeGeometry args={[h * aspect, h]} />
    </mesh>
  );
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
  // Before the composer's clock tick (-10): reset the counters for this frame.
  useFrame(() => gl.info.reset(), -20);
  // After the clock tick, before the layers read it: pin the time for captures.
  useFrame(() => {
    if (frozenT === null) return;
    stageClock.seconds = frozenT / 1000;
    STAGE_UNIFORMS.uTime.value = frozenT / 1000;
  }, -5);
  // After the composer (1): read the frame's totals.
  useFrame(() => {
    const r = gl.info.render;
    const next = { calls: Math.max(0, r.calls - 1), points: r.points, triangles: r.triangles };
    const p = last.current;
    if (next.calls !== p.calls || next.points !== p.points) {
      last.current = next;
      onStats(next);
    }
  }, 2);
  return null;
}

export function GalaxyStagePreview({ initial }: { initial: GalaxyStageInitial }) {
  const [seedText, setSeedText] = useState(initial.seed);
  const [theme, setTheme] = useState<StageTheme>(initial.theme);
  const [fade, setFade] = useState(initial.fade);
  const [size, setSize] = useState(initial.size);
  const [lightModel, setLightModel] = useState<DitherMode>(initial.lightModel);
  const [courseCount, setCourseCount] = useState<3 | 6 | 12>(initial.courses);
  const [currentId, setCurrentId] = useState<string | null>(initial.current);
  const [clicked, setClicked] = useState<string | null>(null);
  const [stats, setStats] = useState<RenderStats | null>(null);
  const [build, setBuild] = useState<{ layout: GalaxyLayout; budget: GalaxyLayerBudget } | null>(null);

  const seed = useMemo(() => seedFromText(seedText), [seedText]);
  const spec = useMemo(() => generateGalaxySpec(seed), [seed]);
  const courses = useMemo(() => PREVIEW_COURSES.slice(0, courseCount), [courseCount]);
  const frame = useRef<StageFrame>(createStageFrame(initial.theme));
  const api = useMemo<StageApi>(() => {
    const registry = createStageRegistry();
    // The composer runs the main-scene pass only while a `sky` layer is registered (planet-only
    // stages skip it); this preview has no sky layer, so an empty stand-in keeps the pass on.
    registry.register("sky", new THREE.Group());
    return { registry, frame, seed: seedFromText(initial.seed) };
  }, [initial.seed]);
  frame.current.theme = theme;

  const reroll = useCallback(() => setSeedText(String(Math.floor(Math.random() * 0xffffff))), []);
  const onBeadClick = useCallback((id: string) => setClicked(id), []);
  const onBuild = useCallback((info: { layout: GalaxyLayout; budget: GalaxyLayerBudget }) => setBuild(info), []);
  const onReady = useCallback(() => {
    document.documentElement.dataset.stageReady = "true";
    document.documentElement.dataset.labReady = "true";
  }, []);
  const readyKey = `${seed}|${theme}|${fade}|${size}|${lightModel}|${courseCount}|${currentId}|${initial.t}`;
  useEffect(() => {
    document.documentElement.dataset.labReady = "false";
    const id = window.setTimeout(() => {
      document.documentElement.dataset.labReady = "true";
    }, 400);
    return () => window.clearTimeout(id);
  }, [readyKey]);
  useEffect(
    () => () => {
      delete document.documentElement.dataset.stageReady;
      delete document.documentElement.dataset.labReady;
    },
    [],
  );

  const sky = theme === "dark" ? SKY.dark : SKY.light;
  const budget = build?.budget ?? null;
  const layout = build?.layout ?? null;
  const p = spec.palette;

  return (
    <div className="galaxy-stage" data-theme={theme} data-chrome={initial.chrome ? "1" : "0"} data-clicked={clicked ?? ""} style={{ "--gs-bg": sky } as React.CSSProperties}>
      <header className="galaxy-stage__bar galaxy-stage__chrome">
        <span className="galaxy-stage__title">Cosmos · galaxy stage layer</span>
        <div className="galaxy-stage__tabs" role="tablist" aria-label="Light model">
          {LIGHT_MODELS.map((l) => (
            <button key={l.id} role="tab" aria-selected={lightModel === l.id} className="galaxy-stage__tab" onClick={() => setLightModel(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
        <div className="galaxy-stage__tabs" role="tablist" aria-label="Courses">
          {([3, 6, 12] as const).map((n) => (
            <button key={n} role="tab" aria-selected={courseCount === n} className="galaxy-stage__tab" onClick={() => setCourseCount(n)}>
              {n} courses
            </button>
          ))}
        </div>
        <label className="galaxy-stage__field">
          seed
          <input type="text" value={seedText} onChange={(e) => setSeedText(e.target.value)} spellCheck={false} aria-label="Galaxy seed" />
        </label>
        <button className="galaxy-stage__btn" onClick={reroll}>
          Reroll
        </button>
        <button className="galaxy-stage__btn" aria-pressed={theme === "light"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "Dark sky" : "Light sky"}
        </button>
        <label className="galaxy-stage__field">
          fade {fade.toFixed(2)}
          <input type="range" min={0} max={1} step={0.01} value={fade} onChange={(e) => setFade(Number(e.target.value))} aria-label="Layer fade" />
        </label>
        <label className="galaxy-stage__field">
          size {size.toFixed(2)}
          <input type="range" min={0.1} max={1.2} step={0.01} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Disc size" />
        </label>
      </header>

      <div className="galaxy-stage__stage">
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
            {initial.backing ? <SkyBacking theme={theme} /> : null}
            <GalaxyLayer seed={seed} theme={theme} courses={courses} currentCourseId={currentId} fade={fade} size={size} lightModel={lightModel} onBeadClick={onBeadClick} onBuild={onBuild} />
            <StageComposer frame={frame} onReady={onReady} />
          </StageContext.Provider>
        </Canvas>

        <aside className="galaxy-stage__side galaxy-stage__chrome">
          <h2>Budgets</h2>
          <dl className="galaxy-stage__kv">
            <dt>draws</dt>
            <dd data-over={stats && budget && stats.calls > budget.drawCallBudget ? "1" : "0"} data-stat="draws">
              {stats ? stats.calls : "…"} measured · {budget ? `${budget.drawCalls} / ${budget.drawCallBudget}` : "…"} budget
            </dd>
            <dt>points</dt>
            <dd data-over={stats && budget && stats.points > budget.pointBudget ? "1" : "0"} data-stat="points">
              {stats ? stats.points : "…"} measured · {budget ? `${budget.points} / ${budget.pointBudget}` : "…"}
            </dd>
            <dt>beads</dt>
            <dd>{budget ? `${budget.beadInstances} quads in 1 draw` : "…"}</dd>
            <dt>fade</dt>
            <dd>{fade === 0 ? "0 · layer hidden, programs warm" : fade.toFixed(2)}</dd>
            <dt>composite</dt>
            <dd>{initial.backing ? "opaque backing (linear, = lab canvas)" : "stage transparent canvas (?backing=1 to compare)"}</dd>
          </dl>
          <h2>Seed {spec.seed}</h2>
          <dl className="galaxy-stage__kv">
            <dt>arms</dt>
            <dd>
              {spec.arms}
              {spec.bar ? ` + bar (${spec.barLength.toFixed(2)} R)` : ""}
            </dd>
            <dt>pitch</dt>
            <dd>{((Math.atan(1 / spec.twist) * 180) / Math.PI).toFixed(1)}°</dd>
            <dt>tilt</dt>
            <dd>
              {((spec.inclination * 180) / Math.PI).toFixed(0)}° · roll {((spec.roll * 180) / Math.PI).toFixed(0)}°
            </dd>
            <dt>palette</dt>
            <dd>{p.id}</dd>
            <dt>light</dt>
            <dd>
              {lightModel} ({DITHER_MODE[lightModel]})
            </dd>
          </dl>
          <h2>Courses on the arms</h2>
          <p>Click a bead: the layer reports the course, nothing navigates.</p>
          <ul className="galaxy-stage__courses">
            {courses.map((c) => {
              const bead = layout?.beads.find((b) => b.courseId === c.id) ?? null;
              const glob = layout?.globulars.find((g) => g.courseId === c.id) ?? null;
              const isCurrent = layout?.current?.courseId === c.id;
              return (
                <li key={c.id} data-current={isCurrent ? "1" : "0"} data-clicked={clicked === c.id ? "1" : "0"} data-archived={c.archived ? "1" : "0"} onClick={() => setCurrentId(c.id)} role="button" tabIndex={0}>
                  <span>
                    {c.code}
                    {isCurrent ? " · here" : ""}
                    {clicked === c.id ? " · clicked" : ""}
                  </span>
                  <small>{bead ? `arm ${bead.arm + 1} · r ${bead.a.toFixed(2)}` : glob ? "halo" : "…"}</small>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}
