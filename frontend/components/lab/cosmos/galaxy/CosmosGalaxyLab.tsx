"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Galaxy as LabGalaxy } from "../../space/galaxy/Galaxy";
import { StarShell } from "../../space/galaxy/StarField";
import { createLabFrame, labClock, LabRegistryContext, useLabRegistry, type LabFrame, type LabRegistry } from "../../space/lib/lab-frame";
import type { LabTheme } from "../../space/lib/lab-uniforms";
import { seedFromText } from "../../space/lib/rng";
import { LabComposer } from "../../space/render/LabComposer";
import { Galaxy } from "./Galaxy";
import type { DitherMode } from "@/lib/light";
import { ALL_FEATURES, buildGalaxyBuffers, DRAW_CALL_BUDGET, FEATURE_KEYS, galaxyDrawCalls, NO_FEATURES, POINT_BUDGET, totalGalaxyPoints, type GalaxyFeatures } from "@/lib/galaxy/points";
import { generateGalaxySpec, spurBranchAngle, type GalaxySpec } from "@/lib/galaxy/spec";
import { SKY } from "@/lib/galaxy/palettes";
import "./cosmos-galaxy.css";

export type AbLayout = "split" | "a" | "b";
export type AbSize = "hero" | "corner";
/** Light model choices exposed in the lab: the lab's bands, or the shared light module's dithers. */
export const LIGHT_MODELS: { id: DitherMode; label: string }[] = [
  { id: "bands", label: "bands (old)" },
  { id: "bayer8", label: "dither · Bayer 8" },
  { id: "ign", label: "dither · blue-ish" },
];

export interface CosmosGalaxyInitial {
  seed: string;
  theme: LabTheme;
  layout: AbLayout;
  size: AbSize;
  features: GalaxyFeatures;
  lightModel: DitherMode;
  chrome: boolean;
  /** Freeze the lab clock at this ms (deterministic captures). */
  t: number | null;
  cell: number;
}

export const FEATURE_LABELS: Record<keyof GalaxyFeatures, { title: string; what: string }> = {
  core: { title: "1 · Core + bar", what: "3-band bulge (cream → gold → orange), nucleus, salmon bar, arms leaving the bar ends" },
  arms: { title: "2 · Arms", what: "luminous arm field, young blue ridge on the outer edge, spurs at 20–40°, width tapering outward" },
  dust: { title: "3 · Dust lanes", what: "dark lanes on the inner edge, broken into filaments, feathers crossing the arms, bar lanes" },
  hii: { title: "4 · HII + clusters", what: "beads with a 2-band halo, blue open clusters, giant HII complexes" },
  colour: { title: "5 · OBAFGKM", what: "eight quantised stellar colours per theme, by population" },
  halo: { title: "6 · Halo + company", what: "spheroidal halo, globular clusters, tidal bridge to the companion, background galaxies" },
  depth: { title: "7 · Depth", what: "taller bulge, far side hidden behind the ball (Sombrero), zodiacal glow, counter-rotating far layer" },
  life: { title: "8 · Life", what: "rare one-cell flashes in the arms, a comet every 30–60 s, breathing HII halos" },
};

function Layer({ name, children }: { name: string; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const registry = useLabRegistry();
  useLayoutEffect(() => {
    const g = ref.current;
    if (!g) return;
    g.visible = false;
    registry.set(name, g);
    return () => {
      registry.delete(name);
    };
  }, [name, registry]);
  return <group ref={ref}>{children}</group>;
}

/** Flags `<html data-lab-ready>` after a dozen rendered frames; capture scripts wait for it. */
function ReadyFlag({ readyKey }: { readyKey: string }) {
  const frames = useRef(0);
  useEffect(() => {
    frames.current = 0;
    document.documentElement.dataset.labReady = "false";
  }, [readyKey]);
  useFrame(() => {
    if (frames.current >= 12) return;
    frames.current++;
    if (frames.current === 12) document.documentElement.dataset.labReady = "true";
  }, 2);
  return null;
}

const HERO_DISTANCE = 3.3;
const SPLIT_DISTANCE = 4.7;
const CORNER_PX = 112;
const FOV = 40;

/** Camera distance that puts a 2-unit disc at `px` pixels for a viewport `height` px tall. */
export function cornerDistance(height: number, px = CORNER_PX, fov = FOV): number {
  return height / (px * Math.tan((fov * Math.PI) / 360));
}

function AbScene({
  spec,
  theme,
  layout,
  size,
  features,
  lightModel,
  frame,
  frozenT,
}: {
  spec: GalaxySpec;
  theme: LabTheme;
  layout: AbLayout;
  size: AbSize;
  features: GalaxyFeatures;
  lightModel: DitherMode;
  frame: RefObject<LabFrame>;
  frozenT: number | null;
}) {
  const height = useThree((s) => s.size.height);
  useEffect(() => {
    labClock.frozenAt = frozenT !== null ? frozenT / 1000 : null;
    return () => {
      labClock.frozenAt = null;
    };
  }, [frozenT]);
  const distance = size === "corner" ? cornerDistance(height) : layout === "split" ? SPLIT_DISTANCE : HERO_DISTANCE;
  const dx = layout === "split" ? (size === "corner" ? 2.4 : 1.5) : 0;
  // Each side is turned to face the camera as if it sat on the axis, so perspective cannot
  // tilt A and B differently (a 53-degree disc viewed 18 degrees off-axis changes its ellipse a lot).
  const face = Math.atan2(dx, distance);
  useFrame(() => {
    const f = frame.current;
    if (!f) return;
    const t = labClock.seconds;
    const drift = distance / HERO_DISTANCE;
    const pose = {
      position: [Math.sin(t / 37) * 0.22 * drift, (0.08 + Math.sin(t / 53) * 0.06) * drift, distance] as const,
      target: [0, 0, 0] as const,
      fov: FOV,
    };
    f.layersA = ["ab"];
    f.layersB = ["ab"];
    f.camA = pose;
    f.camB = pose;
    f.mix = 0;
    f.flash = 0;
    f.lens.active = false;
  });
  return (
    <Layer name="ab">
      {layout !== "b" ? (
        <group position={[-dx, 0, 0]} rotation-y={face}>
          <LabGalaxy spec={spec} theme={theme} radius={1} />
        </group>
      ) : null}
      {layout !== "a" ? (
        <group position={[dx, 0, 0]} rotation-y={-face}>
          <Galaxy spec={spec} theme={theme} radius={1} features={features} lightModel={lightModel} />
        </group>
      ) : null}
      <StarShell seed={spec.seed} theme={theme} radius={40} count={1500} />
    </Layer>
  );
}

export function CosmosGalaxyLab({ initial }: { initial: CosmosGalaxyInitial }) {
  const [seedText, setSeedText] = useState(initial.seed);
  const [theme, setTheme] = useState<LabTheme>(initial.theme);
  const [layout, setLayout] = useState<AbLayout>(initial.layout);
  const [size, setSize] = useState<AbSize>(initial.size);
  const [features, setFeatures] = useState<GalaxyFeatures>(initial.features);
  const [lightModel, setLightModel] = useState<DitherMode>(initial.lightModel);
  const [cell, setCell] = useState(initial.cell);
  const [frozenT, setFrozenT] = useState<number | null>(initial.t);

  const seed = useMemo(() => seedFromText(seedText), [seedText]);
  const spec = useMemo(() => generateGalaxySpec(seed), [seed]);
  const frame = useRef(createLabFrame(theme));
  const registry = useMemo<LabRegistry>(() => new Map(), []);
  const points = useMemo(() => totalGalaxyPoints(buildGalaxyBuffers(spec)), [spec]);
  const draws = galaxyDrawCalls(features);

  useEffect(() => {
    frame.current.theme = theme;
  }, [theme]);
  useEffect(() => {
    frame.current.pixel = cell;
  }, [cell]);

  const reroll = useCallback(() => setSeedText(String(Math.floor(Math.random() * 0xffffff))), []);
  const toggle = useCallback((key: keyof GalaxyFeatures) => setFeatures((f) => ({ ...f, [key]: !f[key] })), []);

  const sky = theme === "dark" ? SKY.dark : SKY.light;
  const onList = FEATURE_KEYS.filter((k) => features[k]).join(",");
  const readyKey = `${seed}|${theme}|${layout}|${size}|${onList}|${lightModel}|${cell}|${frozenT}`;
  const p = spec.palette;
  const branch = spec.spurs.map((s) => (spurBranchAngle(spec, s) * 180) / Math.PI);

  return (
    <div className="cosmos-galaxy" data-theme={theme} data-chrome={initial.chrome ? "1" : "0"} data-layout={layout}>
      <header className="cosmos-galaxy__bar cosmos-galaxy__chrome">
        <span className="cosmos-galaxy__title">Cosmos · galaxy polish A/B</span>
        <div className="cosmos-galaxy__tabs" role="tablist" aria-label="Layout">
          {(["split", "a", "b"] as const).map((l) => (
            <button key={l} role="tab" aria-selected={layout === l} className="cosmos-galaxy__tab" onClick={() => setLayout(l)}>
              {l === "split" ? "A | B" : l === "a" ? "A · lab" : "B · polished"}
            </button>
          ))}
        </div>
        <div className="cosmos-galaxy__tabs" role="tablist" aria-label="Size">
          {(["hero", "corner"] as const).map((s) => (
            <button key={s} role="tab" aria-selected={size === s} className="cosmos-galaxy__tab" onClick={() => setSize(s)}>
              {s === "hero" ? "Hero" : `${CORNER_PX} px corner`}
            </button>
          ))}
        </div>
        <div className="cosmos-galaxy__tabs" role="tablist" aria-label="Light model">
          {LIGHT_MODELS.map((l) => (
            <button key={l.id} role="tab" aria-selected={lightModel === l.id} className="cosmos-galaxy__tab" onClick={() => setLightModel(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
        <label className="cosmos-galaxy__field">
          seed
          <input type="text" value={seedText} onChange={(e) => setSeedText(e.target.value)} spellCheck={false} aria-label="Galaxy seed" />
        </label>
        <button className="cosmos-galaxy__btn" onClick={reroll}>
          Reroll
        </button>
        <button className="cosmos-galaxy__btn" aria-pressed={theme === "light"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "Dark sky" : "Light sky"}
        </button>
        <label className="cosmos-galaxy__field">
          cell {cell}px
          <input type="range" min={1} max={4} step={1} value={cell} onChange={(e) => setCell(Number(e.target.value))} />
        </label>
        <label className="cosmos-galaxy__field">
          freeze {frozenT === null ? "off" : `${(frozenT / 1000).toFixed(1)}s`}
          <input
            type="range"
            min={-1}
            max={120}
            step={1}
            value={frozenT === null ? -1 : frozenT / 1000}
            onChange={(e) => {
              const v = Number(e.target.value);
              setFrozenT(v < 0 ? null : v * 1000);
            }}
          />
        </label>
      </header>

      <div className="cosmos-galaxy__stage">
        <Canvas
          flat
          dpr={[1, 2]}
          gl={{ antialias: false, alpha: false, powerPreference: "high-performance" }}
          camera={{ fov: FOV, near: 0.1, far: 20000, position: [0, 0, HERO_DISTANCE] }}
          frameloop="always"
          style={{ background: sky }}
        >
          <LabRegistryContext.Provider value={registry}>
            <color attach="background" args={[sky]} />
            <AbScene spec={spec} theme={theme} layout={layout} size={size} features={features} lightModel={lightModel} frame={frame} frozenT={frozenT} />
            <LabComposer frame={frame} />
            <ReadyFlag readyKey={readyKey} />
          </LabRegistryContext.Provider>
        </Canvas>

        {layout === "split" ? (
          <>
            <span className="cosmos-galaxy__tag cosmos-galaxy__tag--a cosmos-galaxy__chrome">A · lab galaxy</span>
            <span className="cosmos-galaxy__tag cosmos-galaxy__tag--b cosmos-galaxy__chrome">B · polished</span>
          </>
        ) : null}

        <aside className="cosmos-galaxy__side cosmos-galaxy__chrome">
          <h2>Improvements</h2>
          <div className="cosmos-galaxy__row">
            <button className="cosmos-galaxy__btn" onClick={() => setFeatures(ALL_FEATURES)}>
              all on
            </button>
            <button className="cosmos-galaxy__btn" onClick={() => setFeatures(NO_FEATURES)}>
              all off (= lab)
            </button>
          </div>
          <ul className="cosmos-galaxy__features">
            {FEATURE_KEYS.map((key) => (
              <li key={key}>
                <button className="cosmos-galaxy__feature" aria-pressed={features[key]} onClick={() => toggle(key)}>
                  <span className="cosmos-galaxy__feature-title">{FEATURE_LABELS[key].title}</span>
                  <span className="cosmos-galaxy__feature-what">{FEATURE_LABELS[key].what}</span>
                </button>
              </li>
            ))}
          </ul>
          <h2>Light model</h2>
          <p>
            {lightModel === "bands"
              ? "Lab bands: hard alpha steps and three bulge rings."
              : "shared/light: Sérsic bulge, Gaussian arm cross-section with density-matched amplitude, exponential skirt; profiles dithered in cell space through 3–8 palette steps."}
          </p>
          <h2>Budgets</h2>
          <dl className="cosmos-galaxy__kv">
            <dt>points</dt>
            <dd>
              {points} / {POINT_BUDGET} (+1500 star shell)
            </dd>
            <dt>draws</dt>
            <dd>
              {draws} / {DRAW_CALL_BUDGET} (lab: 3)
            </dd>
          </dl>
          <h2>Seed {spec.seed}</h2>
          <dl className="cosmos-galaxy__kv">
            <dt>arms</dt>
            <dd>
              {spec.arms}
              {spec.bar ? ` + bar (${spec.barLength.toFixed(2)} R)` : ""}
              {spec.armAsymmetry > 0.1 ? ` · asym ${spec.armAsymmetry.toFixed(2)}` : ""}
            </dd>
            <dt>pitch</dt>
            <dd>{((Math.atan(1 / spec.twist) * 180) / Math.PI).toFixed(1)}°</dd>
            <dt>spurs</dt>
            <dd>
              {spec.spurs.length} at {Math.min(...branch).toFixed(0)}–{Math.max(...branch).toFixed(0)}° · {spec.dustSpurs.length} dust feathers
            </dd>
            <dt>tilt</dt>
            <dd>
              {((spec.inclination * 180) / Math.PI).toFixed(0)}° · roll {((spec.roll * 180) / Math.PI).toFixed(0)}°
            </dd>
            <dt>company</dt>
            <dd>
              {spec.companion ? "companion + bridge" : "no companion"} · {spec.globulars.length} globulars · {spec.backgroundGalaxies.length} far galaxies
            </dd>
            <dt>HII</dt>
            <dd>
              {(spec.beadDensity * 100).toFixed(1)} % beads · {spec.hiiComplexes.length} giant complex{spec.hiiComplexes.length > 1 ? "es" : ""}
            </dd>
            <dt>life</dt>
            <dd>
              flash every {spec.flashPeriodS.toFixed(0)} s · comet every {spec.cometPeriodS.toFixed(0)} s
            </dd>
            <dt>palette</dt>
            <dd>
              <span className="cosmos-galaxy__swatches" title={p.ref}>
                {[p.core, p.arm, p.tip, p.bead, p.dust].map((c, i) => (
                  <i key={`${i}-${c}`} style={{ background: c }} />
                ))}
              </span>{" "}
              {p.id}
            </dd>
          </dl>
        </aside>
      </div>
    </div>
  );
}
