"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useIdentity } from "@/lib/identity";
import type { StageDirector } from "@/lib/stage/director";
import { useStageAudioCues } from "@/lib/stage/useStageAudioCues";
import { seedFromStudent } from "@/lib/stage/placement";
import type { Rung } from "@/lib/stage/rungs";
import { resolveCssColor, useReducedMotion, useSpaceAttribute } from "@/components/shell/useSpaceAttribute";
import { HopDriver } from "./hop/HopDriver";
import { HopStreaks } from "./hop/HopStreaks";
import type { HopRuntime } from "./hop/hop-runtime";
import { createGalaxyRungController } from "./layers/galaxy/galaxy-rung-controller";
import { GalaxyRung } from "./layers/galaxy/GalaxyRung";
import { GalaxyRungHost } from "./layers/galaxy/GalaxyRungHost";
import { ConstellationScenery } from "./layers/constellation/ConstellationScenery";
import { SkyLayer } from "./layers/SkyLayer";
import { SKY_TOKEN_FALLBACK, type SkyTokens } from "./layers/sky/sky-palette";
import { createStageFrame, StageComposer, type StageFrame } from "./render/StageComposer";
import { createStagePerfSink, StagePerfOverlay, StagePerfProbe } from "./StagePerf";
import { createStageRegistry, StageContext, type StageApi } from "./StageContext";
import { StageSlotOutlet, useStageCovered } from "./StageSlots";
import { STAGE_CAMERA } from "./lib/view";
import type { StageTheme } from "./lib/uniforms";
import "./stage.css";

export interface StageCanvasProps {
  /** Show the frame-time overlay (`?perf=1`). */
  perf?: boolean;
  /** `?rung=galaxy` (dev / captures): teleport the director here at mount; null = the planet, as always. */
  rung?: Rung | null;
  /** The shell's director (shared with the header and the pages). */
  director: StageDirector;
  /** The hop runtime: the driver, the streaks, the sticky planet slot and the constellation scenery. */
  hop: HopRuntime;
}

/** Resolve the sky tokens from CSS on the given element whenever the theme changes. */
function useSkyTokens(host: React.RefObject<HTMLDivElement | null>, theme: StageTheme): SkyTokens {
  const [tokens, setTokens] = useState<SkyTokens>(SKY_TOKEN_FALLBACK[theme]);
  useEffect(() => {
    const el = host.current;
    const fallback = SKY_TOKEN_FALLBACK[theme];
    if (!el) {
      setTokens(fallback);
      return;
    }
    setTokens({
      star: resolveCssColor(el, "--space-star", fallback.star),
      starSoft: resolveCssColor(el, "--space-star-soft", fallback.starSoft),
      nebula: resolveCssColor(el, "--space-nebula", fallback.nebula),
      bg: resolveCssColor(el, "--space-bg", fallback.bg),
    });
  }, [host, theme]);
  return tokens;
}

/**
 * Steps the altitude director once per frame, after the clock (-10) and before
 * every layer (0). A frame is never worth more than 1/30 s to the spring: after
 * a long frame (the land's scene build under the cloud deck) the camera carries
 * on from where it was instead of jumping ahead, so a stall can never carry a
 * dive past the deck.
 */
export const DIRECTOR_MAX_STEP_S = 1 / 30;

function DirectorStep({ director }: { director: StageDirector }) {
  useFrame((_, delta) => {
    director.step(Math.min(delta, DIRECTOR_MAX_STEP_S));
  }, -5);
  return null;
}

/**
 * The persistent stage: ONE transparent R3F canvas at the very back of the
 * shell (behind the constellation twin and all chrome), mounted once by
 * ProductShell and never remounted across /earth <-> /knowledge. Layers
 * register with the stage registry: the sky (S1) mounts first; the earth page
 * slots the planet (the globe) in through the `planet` slot (S2-2, gate 1)
 * and the ice land through the `world` slot (S4-1, gate 4); the galaxy rung
 * (S3, gate 3), the hop driver, its streaks and the constellation-rung
 * scenery are always mounted (every slice permanent since 2026-10-13).
 * Pointer events pass through (the planet's and the land's input lives on
 * their page-side hosts). Rendering pauses while the shell hides the stage
 * (a land with its own canvas: every developed biome but ice-town, see
 * `OWN_CANVAS_BIOMES`) and while the tab is hidden, since a hidden canvas
 * still costs GPU time otherwise.
 *
 * Device pixel ratio: `[1, 2]`, dropped to 1 when drei's `PerformanceMonitor`
 * sees sustained low frame rates (what the globe's own canvas did). The grain
 * is measured in CSS px (`composer-model.ts`), so the drop never changes the
 * 2 CSS px cell: the pixel-path targets keep the same cell count and the
 * canvas, upscaled by the browser with `image-rendering: pixelated`
 * (`stage.css`), keeps the same blocks on screen.
 */
export function StageCanvas({ perf = false, rung = null, director, hop }: StageCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const theme = useSpaceAttribute();
  const reducedMotion = useReducedMotion();
  const tokens = useSkyTokens(host, theme);
  const identity = useIdentity();
  const seed = useMemo(() => seedFromStudent(identity.studentId), [identity.studentId]);
  const galaxyController = useMemo(createGalaxyRungController, []);
  const frame = useRef<StageFrame>(createStageFrame(theme));
  const sink = useRef(createStagePerfSink());
  // Set after mount: the server has no mount time, so the first client render must not either.
  const [mountedAt, setMountedAt] = useState<number | null>(null);
  const [hidden, setHidden] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const [dpr, setDpr] = useState<[number, number]>([1, 2]);
  useStageAudioCues(director);
  const registry = useMemo(createStageRegistry, []);
  const api = useMemo<StageApi>(() => ({ registry, frame, director, seed }), [registry, director, seed]);

  frame.current.theme = theme;
  // The sky colour the composer clears the low-res target to: the live `--space-bg` token.
  frame.current.bg.set(tokens.bg);

  useEffect(() => {
    setMountedAt(Date.now());
  }, []);

  // Dev / captures (`?rung=galaxy`, or the rung mirrored at rest): start at that stop with no motion.
  // The planet otherwise; a land (`?land=`) teleports the director to the world itself when it mounts.
  useEffect(() => {
    if (rung && rung !== "planet" && rung !== "world") director.teleport(rung);
  }, [director, rung]);

  // display:none upstream -> stop the frame loop.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      setHidden(!rect || rect.width === 0 || rect.height === 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // An opaque land canvas over the stage (every developed biome but ice-town, `OWN_CANVAS_BIOMES`):
  // pause while the director rests behind it; a hop (its request, or Escape) wakes the loop so the
  // spring runs on and the route follows, and the loop pauses again once it rests under the land.
  const covered = useStageCovered();
  const [restingCovered, setRestingCovered] = useState(false);
  useEffect(() => {
    if (!covered) {
      setRestingCovered(false);
      return;
    }
    const sync = () => setRestingCovered(!director.sample().moving);
    sync();
    const offRest = director.onRest(sync);
    const offHop = hop.subscribe(sync);
    return () => {
      offRest();
      offHop();
    };
  }, [covered, director, hop]);

  // Hidden tab -> stop the frame loop (ported from the globe's own canvas, which went to `demand`).
  useEffect(() => {
    const sync = () => setTabHidden(document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const onReady = useCallback(() => {
    document.documentElement.dataset.stageReady = "true";
    director.readiness.set("sky", true);
  }, [director]);
  useEffect(
    () => () => {
      delete document.documentElement.dataset.stageReady;
    },
    [],
  );

  return (
    <>
      <div ref={host} className="sg-stage" data-mounted-at={mountedAt ?? undefined} data-theme={theme} aria-hidden>
        <Canvas
          dpr={dpr}
          frameloop={hidden || tabHidden || restingCovered ? "never" : "always"}
          flat
          camera={{ fov: STAGE_CAMERA.fov, near: STAGE_CAMERA.near, far: STAGE_CAMERA.far, position: STAGE_CAMERA.position, rotation: STAGE_CAMERA.rotation }}
          gl={{ alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: "high-performance", stencil: false, depth: false }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0);
            gl.autoClear = true;
          }}
          style={{ pointerEvents: "none" }}
          fallback={null}
        >
          <StageContext.Provider value={api}>
            <PerformanceMonitor onDecline={() => setDpr([1, 1])} />
            {perf ? <StagePerfProbe sink={sink} /> : null}
            <DirectorStep director={director} />
            <HopDriver runtime={hop} />
            <SkyLayer seed={seed} theme={theme} tokens={tokens} reducedMotion={reducedMotion} />
            <HopStreaks runtime={hop} theme={theme} />
            <ConstellationScenery seed={seed} theme={theme} tokens={tokens} reducedMotion={reducedMotion} />
            <StageSlotOutlet names={["planet"]} sticky />
            <StageSlotOutlet names={["world"]} />
            <GalaxyRung seed={seed} theme={theme} reducedMotion={reducedMotion} controller={galaxyController} />
            <StageComposer frame={frame} onReady={onReady} />
          </StageContext.Provider>
        </Canvas>
      </div>
      {/* Outside .sg-stage (its own stacking context at z 0) so the overlay sits over the page chrome. */}
      {perf ? <StagePerfOverlay sink={sink} /> : null}
      {/* The galaxy rung's pointer surface and flags: over the page, under the header; inert off the rung. */}
      <GalaxyRungHost controller={galaxyController} />
    </>
  );
}
