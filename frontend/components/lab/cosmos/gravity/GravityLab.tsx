"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { GravityScene, type BlackHoleControls, type GravityView, type WhiteHoleControls, type WormholeControls } from "./GravityScene";
import { createGravityFrame } from "./lib/frame";
import { seedFromText } from "./lib/rng";
import type { GravityTheme } from "./lib/uniforms";
import { SKY } from "./palettes";
import { GravityComposer } from "./render/GravityComposer";
import "./gravity-lab.css";

export type GravityBeat = "mastered" | "feed" | "birth" | "traverse";

export interface GravityLabInitial {
  view: GravityView;
  seed: string;
  theme: GravityTheme;
  cell: number;
  /** Radius in CSS px for the focused exhibit (ignored in the "all" view). */
  size: number | null;
  tilt: number | null;
  feed: number | null;
  jets: boolean | null;
  lens: number | null;
  swirl: number | null;
  intensity: number | null;
  /** Auto-play this beat ~2.5 s after the first frames (or immediately when `t` freezes the clock). */
  beat: GravityBeat | null;
  /** Freeze every clock at this ms (frame captures). */
  t: number | null;
  chrome: boolean;
}

const VIEWS: { id: GravityView; label: string }[] = [
  { id: "all", label: "All three" },
  { id: "blackhole", label: "Black hole" },
  { id: "whitehole", label: "White hole" },
  { id: "wormhole", label: "Wormhole" },
];

const DEFAULT_BH: BlackHoleControls = { size: 96, intensity: 1, lens: 1, tilt: 0.7, spin: 110, beads: 3, feed: 0.25, jets: false, state: "idle" };
const DEFAULT_WH: WhiteHoleControls = { size: 80, intensity: 1, lens: 1, pulse: 4, state: "alive" };
const DEFAULT_WORM: WormholeControls = { size: 88, intensity: 1, lens: 1, swirl: 0.5, state: "open" };

/** Flags `<html data-lab-ready>` after a dozen rendered frames; capture scripts wait for it. */
function ReadyFlag({ readyKey, onReady }: { readyKey: string; onReady: () => void }) {
  const frames = useRef(0);
  useEffect(() => {
    frames.current = 0;
    document.documentElement.dataset.labReady = "false";
  }, [readyKey]);
  useFrame(() => {
    if (frames.current >= 12) return;
    frames.current++;
    if (frames.current === 12) {
      document.documentElement.dataset.labReady = "true";
      onReady();
    }
  }, 2);
  return null;
}

export function GravityLab({ initial }: { initial: GravityLabInitial }) {
  const [view, setView] = useState<GravityView>(initial.view);
  const [seedText, setSeedText] = useState(initial.seed);
  const [theme, setTheme] = useState<GravityTheme>(initial.theme);
  const [cell, setCell] = useState(initial.cell);
  const [maxCells, setMaxCells] = useState(16);
  const [swap, setSwap] = useState(false);
  const [bh, setBh] = useState<BlackHoleControls>(() => ({
    ...DEFAULT_BH,
    ...(initial.view === "blackhole" && initial.size !== null ? { size: initial.size } : {}),
    ...(initial.tilt !== null ? { tilt: initial.tilt } : {}),
    ...(initial.feed !== null ? { feed: initial.feed } : {}),
    ...(initial.jets !== null ? { jets: initial.jets } : {}),
    ...(initial.lens !== null ? { lens: initial.lens } : {}),
    ...(initial.intensity !== null ? { intensity: initial.intensity } : {}),
  }));
  const [wh, setWh] = useState<WhiteHoleControls>(() => ({
    ...DEFAULT_WH,
    ...(initial.view === "whitehole" && initial.size !== null ? { size: initial.size } : {}),
    ...(initial.lens !== null ? { lens: initial.lens } : {}),
    ...(initial.intensity !== null ? { intensity: initial.intensity } : {}),
  }));
  const [worm, setWorm] = useState<WormholeControls>(() => ({
    ...DEFAULT_WORM,
    ...(initial.view === "wormhole" && initial.size !== null ? { size: initial.size } : {}),
    ...(initial.lens !== null ? { lens: initial.lens } : {}),
    ...(initial.swirl !== null ? { swirl: initial.swirl } : {}),
    ...(initial.intensity !== null ? { intensity: initial.intensity } : {}),
  }));
  const [beats, setBeats] = useState({ mastered: 0, feedBurst: 0, birth: 0, traverse: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [panel, setPanel] = useState(true);
  const [ready, setReady] = useState(false);
  const autoBeatFired = useRef(false);

  const baseSeed = useMemo(() => seedFromText(seedText), [seedText]);
  const farSeed = useMemo(() => (baseSeed ^ 0x5eed1e55) >>> 0, [baseSeed]);
  // The traverse swaps which field is "here": outer and inner trade seeds.
  const seed = swap ? farSeed : baseSeed;
  const innerSeed = swap ? baseSeed : farSeed;
  const frame = useRef(createGravityFrame(theme));

  useEffect(() => {
    frame.current.theme = theme;
  }, [theme]);
  useEffect(() => {
    frame.current.pixel = cell;
  }, [cell]);
  useEffect(() => {
    frame.current.maxCells = maxCells;
  }, [maxCells]);

  const reroll = useCallback(() => setSeedText(String(Math.floor(Math.random() * 0xffffff))), []);
  const play = useCallback((beat: GravityBeat) => {
    setBeats((b) =>
      beat === "mastered" ? { ...b, mastered: b.mastered + 1 } : beat === "feed" ? { ...b, feedBurst: b.feedBurst + 1 } : beat === "birth" ? { ...b, birth: b.birth + 1 } : { ...b, traverse: b.traverse + 1 },
    );
  }, []);
  const onTraverse = useCallback(() => setSwap((s) => !s), []);
  const onReady = useCallback(() => setReady(true), []);

  // `?beat=` auto-plays once: immediately when frozen (so `?t=` picks the frame), else after a settle.
  useEffect(() => {
    if (!initial.beat || autoBeatFired.current || !ready) return;
    autoBeatFired.current = true;
    const beat = initial.beat;
    if (initial.t !== null) {
      play(beat);
      return;
    }
    const id = window.setTimeout(() => play(beat), 2500);
    return () => window.clearTimeout(id);
  }, [initial.beat, initial.t, play, ready]);

  const sky = theme === "dark" ? SKY.dark : SKY.light;
  const readyKey = `${view}|${seed}|${theme}|${cell}|${initial.t}|${bh.size}|${wh.size}|${worm.size}`;
  const focusedSize = view === "blackhole" ? bh.size : view === "whitehole" ? wh.size : view === "wormhole" ? worm.size : null;

  return (
    <div className="gravity-lab" data-theme={theme} data-chrome={initial.chrome ? "1" : "0"} data-view={view}>
      <header className="gravity-lab__bar gravity-lab__chrome">
        <span className="gravity-lab__title">Cosmos lab · gravity</span>
        <div className="gravity-lab__tabs" role="tablist">
          {VIEWS.map((v) => (
            <button key={v.id} role="tab" aria-selected={view === v.id} className="gravity-lab__tab" onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <label className="gravity-lab__field">
          seed
          <input type="text" value={seedText} onChange={(e) => setSeedText(e.target.value)} spellCheck={false} aria-label="Sky seed" />
        </label>
        <button className="gravity-lab__btn" onClick={reroll}>
          Reroll
        </button>
        <button className="gravity-lab__btn" aria-pressed={theme === "light"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "Dark sky" : "Light sky"}
        </button>
        <label className="gravity-lab__field">
          cell {cell}px
          <input type="range" min={1} max={4} step={1} value={cell} onChange={(e) => setCell(Number(e.target.value))} />
        </label>
        <label className="gravity-lab__field">
          lens cap {maxCells} cells
          <input type="range" min={4} max={40} step={1} value={maxCells} onChange={(e) => setMaxCells(Number(e.target.value))} />
        </label>
        <button className="gravity-lab__btn" aria-pressed={panel} onClick={() => setPanel((p) => !p)}>
          controls
        </button>
      </header>

      <div className="gravity-lab__stage">
        <Canvas
          flat
          dpr={[1, 2]}
          gl={{ antialias: false, alpha: false, powerPreference: "high-performance" }}
          camera={{ fov: 40, near: 0.1, far: 200, position: [0, 0, 3.3] }}
          frameloop="always"
          style={{ background: sky }}
        >
          <color attach="background" args={[sky]} />
          <GravityScene
            view={view}
            seed={seed}
            innerSeed={innerSeed}
            theme={theme}
            frame={frame}
            frozenT={initial.t}
            bh={bh}
            wh={wh}
            worm={worm}
            beats={beats}
            onTraverse={onTraverse}
            onHover={setHover}
          />
          <GravityComposer frame={frame} />
          <ReadyFlag readyKey={readyKey} onReady={onReady} />
        </Canvas>

        <aside className="gravity-lab__side gravity-lab__chrome" hidden={!panel}>
          {view === "all" || view === "blackhole" ? (
            <section className="gravity-lab__section">
              <h2>Black hole v2</h2>
              <p>EHT proportions, far side lensed over the top, Doppler left, 1-cell photon ring, Keplerian grain, {bh.beads} beads. Hover to swell.</p>
              <div className="gravity-lab__grid">
                <Slider label={`size ${bh.size}px`} min={12} max={260} value={bh.size} onChange={(v) => setBh({ ...bh, size: v })} />
                <Slider label={`tilt ${bh.tilt.toFixed(2)}`} min={0} max={1} step={0.05} value={bh.tilt} onChange={(v) => setBh({ ...bh, tilt: v })} />
                <Slider label={`lens ${bh.lens.toFixed(2)}`} min={0} max={1.6} step={0.05} value={bh.lens} onChange={(v) => setBh({ ...bh, lens: v })} />
                <Slider label={`spin ${bh.spin}s`} min={30} max={240} step={5} value={bh.spin} onChange={(v) => setBh({ ...bh, spin: v })} />
                <Slider label={`beads ${bh.beads}`} min={3} max={5} step={1} value={bh.beads} onChange={(v) => setBh({ ...bh, beads: v })} />
                <Slider label={`feed ${bh.feed.toFixed(2)}`} min={0} max={1} step={0.05} value={bh.feed} onChange={(v) => setBh({ ...bh, feed: v })} />
                <Slider label={`intensity ${bh.intensity.toFixed(2)}`} min={0} max={1} step={0.05} value={bh.intensity} onChange={(v) => setBh({ ...bh, intensity: v })} />
              </div>
              <div className="gravity-lab__row">
                <button className="gravity-lab__btn" aria-pressed={bh.jets} onClick={() => setBh({ ...bh, jets: !bh.jets })}>
                  jets
                </button>
                <button className="gravity-lab__btn" aria-pressed={bh.state === "feeding"} onClick={() => setBh({ ...bh, state: bh.state === "feeding" ? "idle" : "feeding" })}>
                  feeding
                </button>
                <button className="gravity-lab__btn gravity-lab__btn--primary" onClick={() => play("mastered")}>
                  Mastered
                </button>
                <button className="gravity-lab__btn" onClick={() => play("feed")}>
                  Feed burst
                </button>
              </div>
              <div className="gravity-lab__budget">1 draw at rest (+1 feed ≤96 pts, +1 jets, +1 beats 14 pts) · lens slot 0</div>
            </section>
          ) : null}
          {view === "all" || view === "whitehole" ? (
            <section className="gravity-lab__section">
              <h2>White hole</h2>
              <p>The mirror: banded cool core, fountain outward, inverted lens (stars bunch into a ring just outside), {wh.pulse}s pulse.</p>
              <div className="gravity-lab__grid">
                <Slider label={`size ${wh.size}px`} min={12} max={260} value={wh.size} onChange={(v) => setWh({ ...wh, size: v })} />
                <Slider label={`lens ${wh.lens.toFixed(2)}`} min={0} max={1.6} step={0.05} value={wh.lens} onChange={(v) => setWh({ ...wh, lens: v })} />
                <Slider label={`pulse ${wh.pulse.toFixed(1)}s`} min={3} max={5} step={0.1} value={wh.pulse} onChange={(v) => setWh({ ...wh, pulse: v })} />
                <Slider label={`intensity ${wh.intensity.toFixed(2)}`} min={0} max={1} step={0.05} value={wh.intensity} onChange={(v) => setWh({ ...wh, intensity: v })} />
              </div>
              <div className="gravity-lab__row">
                <button className="gravity-lab__btn" aria-pressed={wh.state === "dormant"} onClick={() => setWh({ ...wh, state: wh.state === "dormant" ? "alive" : "dormant" })}>
                  dormant
                </button>
                <button className="gravity-lab__btn gravity-lab__btn--primary" onClick={() => play("birth")}>
                  Birth
                </button>
              </div>
              <div className="gravity-lab__budget">2 draws (core quad, ≤160 fountain pts) · lens slot 1, sign −1</div>
            </section>
          ) : null}
          {view === "all" || view === "wormhole" ? (
            <section className="gravity-lab__section">
              <h2>Wormhole</h2>
              <p>A round glowing door onto a second seeded sky (render-to-texture), rim lensing, slow swirl. Traverse dollies in, whites out, and swaps the skies.</p>
              <div className="gravity-lab__grid">
                <Slider label={`size ${worm.size}px`} min={12} max={260} value={worm.size} onChange={(v) => setWorm({ ...worm, size: v })} />
                <Slider label={`lens ${worm.lens.toFixed(2)}`} min={0} max={1.6} step={0.05} value={worm.lens} onChange={(v) => setWorm({ ...worm, lens: v })} />
                <Slider label={`swirl ${worm.swirl.toFixed(2)}`} min={0} max={1} step={0.05} value={worm.swirl} onChange={(v) => setWorm({ ...worm, swirl: v })} />
                <Slider label={`intensity ${worm.intensity.toFixed(2)}`} min={0} max={1} step={0.05} value={worm.intensity} onChange={(v) => setWorm({ ...worm, intensity: v })} />
              </div>
              <div className="gravity-lab__row">
                <button className="gravity-lab__btn" aria-pressed={worm.state === "closed"} onClick={() => setWorm({ ...worm, state: worm.state === "closed" ? "open" : "closed" })}>
                  closed
                </button>
                <button className="gravity-lab__btn gravity-lab__btn--primary" onClick={() => play("traverse")}>
                  Traverse
                </button>
              </div>
              <div className="gravity-lab__budget">2 draws + 1 RT pass (420 pts, ≤256²) · lens slot 2 · {swap ? "far sky is outside" : "home sky is outside"}</div>
            </section>
          ) : null}
        </aside>

        <div className="gravity-lab__readout gravity-lab__chrome" aria-live="polite">
          <div>
            view <strong>{view}</strong>
            {focusedSize !== null ? (
              <>
                {" "}
                · R <strong>{focusedSize}px</strong>
              </>
            ) : null}{" "}
            · cell <strong>{cell}px</strong>
          </div>
          <div>
            passes <strong>3</strong> (sky pixel, lens+overlay, output) + <strong>{view === "all" || view === "wormhole" ? 1 : 0}</strong> RT · stars <strong>3200</strong>
          </div>
          <div style={{ color: "var(--lab-muted)" }}>{hover ?? "hover an object"}</div>
        </div>
      </div>
    </div>
  );
}

function Slider({ label, min, max, step = 1, value, onChange }: { label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="gravity-lab__field">
      {label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
