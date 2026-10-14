"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { BlackHole, type BlackHoleState } from "./blackhole/BlackHole";
import { StarField } from "./field/StarField";
import { gravityClock } from "./lib/clock";
import { HERO_POSE, type GravityFrame, type Vec3 } from "./lib/frame";
import type { GravityTheme } from "./lib/uniforms";
import { LENS_RING } from "./palettes";
import { WhiteHole, type WhiteHoleState } from "./whitehole/WhiteHole";
import { Wormhole, type WormholeState } from "./wormhole/Wormhole";

export type GravityView = "all" | "blackhole" | "whitehole" | "wormhole";

export interface BlackHoleControls {
  size: number;
  intensity: number;
  lens: number;
  tilt: number;
  spin: number;
  beads: number;
  feed: number;
  jets: boolean;
  state: BlackHoleState;
}
export interface WhiteHoleControls {
  size: number;
  intensity: number;
  lens: number;
  pulse: number;
  state: WhiteHoleState;
}
export interface WormholeControls {
  size: number;
  intensity: number;
  lens: number;
  swirl: number;
  state: WormholeState;
}

export interface GravitySceneProps {
  view: GravityView;
  seed: number;
  innerSeed: number;
  theme: GravityTheme;
  frame: RefObject<GravityFrame>;
  frozenT: number | null;
  bh: BlackHoleControls;
  wh: WhiteHoleControls;
  worm: WormholeControls;
  beats: { mastered: number; feedBurst: number; birth: number; traverse: number };
  onTraverse: () => void;
  onHover: (what: string | null) => void;
}

/** Positions in the "all" view; focused views put the object at the origin. */
const ALL_POSITIONS: Record<Exclude<GravityView, "all">, Vec3> = {
  blackhole: [-1.38, 0.04, 0],
  whitehole: [0, 0.04, 0],
  wormhole: [1.38, 0.04, 0],
};
const ORIGIN: Vec3 = [0, 0, 0];

export function GravityScene({ view, seed, innerSeed, theme, frame, frozenT, bh, wh, worm, beats, onTraverse, onHover }: GravitySceneProps) {
  const { size } = useThree();
  useFreeze(frozenT);

  // Frame defaults, before any exhibit writes: hero camera, no flash, every lens slot off.
  useFrame(() => {
    const f = frame.current;
    if (!f) return;
    f.cam = HERO_POSE;
    f.flash = 0;
    f.ringColor.set(LENS_RING[theme]);
    for (const l of f.lenses) l.strength = 0;
  }, -8);

  const showBh = view === "all" || view === "blackhole";
  const showWh = view === "all" || view === "whitehole";
  const showWorm = view === "all" || view === "wormhole";
  const posFor = (k: Exclude<GravityView, "all">) => (view === "all" ? ALL_POSITIONS[k] : ORIGIN);

  return (
    <>
      <StarField seed={seed} theme={theme} fov={HERO_POSE.fov} aspect={size.width / size.height} />
      {showBh ? (
        <BlackHole
          size={bh.size}
          seed={seed}
          theme={theme}
          intensity={bh.intensity}
          position={posFor("blackhole")}
          lensSlot={0}
          lensStrength={bh.lens}
          frame={frame}
          state={bh.state}
          tilt={bh.tilt}
          spinPeriodS={bh.spin}
          beadCount={bh.beads}
          feed={bh.feed}
          jets={bh.jets}
          masteredCount={beats.mastered}
          feedBurstCount={beats.feedBurst}
          onHover={(on) => onHover(on ? "black hole: swell + lens x1.3" : null)}
        />
      ) : null}
      {showWh ? (
        <WhiteHole
          size={wh.size}
          seed={seed}
          theme={theme}
          intensity={wh.intensity}
          position={posFor("whitehole")}
          lensSlot={1}
          lensStrength={wh.lens}
          frame={frame}
          state={wh.state}
          pulsePeriodS={wh.pulse}
          birthCount={beats.birth}
          onHover={(on) => onHover(on ? "white hole: swell + lens x1.25" : null)}
        />
      ) : null}
      {showWorm ? (
        <Wormhole
          size={worm.size}
          seed={seed}
          innerSeed={innerSeed}
          theme={theme}
          intensity={worm.intensity}
          position={posFor("wormhole")}
          lensSlot={2}
          lensStrength={worm.lens}
          frame={frame}
          state={worm.state}
          swirl={worm.swirl}
          traverseCount={beats.traverse}
          onTraverse={onTraverse}
          onHover={(on) => onHover(on ? "wormhole: swell + lens x1.25" : null)}
        />
      ) : null}
    </>
  );
}

function useFreeze(frozenT: number | null) {
  const last = useRef<number | null>(null);
  useEffect(() => {
    gravityClock.frozenAt = frozenT !== null ? frozenT / 1000 : null;
    last.current = frozenT;
    return () => {
      gravityClock.frozenAt = null;
    };
  }, [frozenT]);
}
