"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ICE_TOWN_LAYOUT as layout, districtOrder } from "./layout/biome-layout";
import { adjacentCourseId, isInteractiveKeyboardTarget, keyboardNavigationStep } from "@/components/world/globe/globe-input";
import { STATIONS, defaultOverride } from "./camera/stations";
import { BiomeScene } from "./scene/BiomeScene";
import { catastropheSteps } from "./scene/catastrophe-sequence";
import type { CatastrophePhase, LabState } from "./state";
import type { IceDemoState } from "@/lib/world/demo-theater";
import { useReducedMotion, useSpaceAttribute } from "@/components/shell/useSpaceAttribute";
import { useEdgeLab } from "./edge/use-edge-lab";

/**
 * Plays the locked catastrophe sequence (blizzard → bang → ruin, recovery → calm) off the demo
 * theater's fail / pass / idle events, using PHASE_SECONDS from state.ts.
 */
function useCatastrophePhase(event: IceDemoState["event"] | undefined, reducedMotion: boolean): CatastrophePhase {
  const [phase, setPhase] = useState<CatastrophePhase>("calm");
  const phaseRef = useRef<CatastrophePhase>("calm");
  phaseRef.current = phase;

  useEffect(() => {
    const steps = catastropheSteps(event ?? "idle", phaseRef.current, reducedMotion);
    const timers: ReturnType<typeof setTimeout>[] = [];
    let elapsed = 0;
    steps.forEach((step, index) => {
      if (index === 0) setPhase(step.phase);
      else timers.push(setTimeout(() => setPhase(step.phase), elapsed));
      if (Number.isFinite(step.holdMs)) elapsed += step.holdMs;
    });
    return () => timers.forEach(clearTimeout);
    // Re-plan only when the event changes; the current phase is read from the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, reducedMotion]);

  return phase;
}

export function IceTownMount({
  progress,
  focusDistrict = null,
  iceDemo,
  onFocusDistrict,
}: {
  progress: number;
  focusDistrict?: string | null;
  iceDemo?: IceDemoState;
  onFocusDistrict?: (id: string | null) => void;
}) {
  const fraction = Math.min(1, Math.max(0, progress));
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [localFocus, setLocalFocus] = useState<string | null>(null);
  const focus = onFocusDistrict ? focusDistrict : (focusDistrict ?? localFocus);
  // Day/night follows the page colour scheme (bible §6); the fail beat is a storm, not a night.
  const night = useSpaceAttribute() === "dark";
  const reducedMotion = useReducedMotion();
  const phase = useCatastrophePhase(iceDemo?.event, reducedMotion);
  // Edge lab (`?edge=`): free camera, optional outer-world technique and comparison pose.
  const edgeLab = useEdgeLab();
  const state = useMemo<LabState>(
    () => ({
      edgeLab: edgeLab.active,
      edge: edgeLab.technique,
      pose: edgeLab.pose,
      progress: Object.fromEntries(layout.districts.map((district) => [district.id, fraction])),
      residents: 0,
      seed: 7,
      night,
      // Handoff defaults: clouds on, whale on (rare event), snowfall night only (BiomeScene).
      clouds: true,
      snowfall: false,
      whale: true,
      // Locked: fixed 2 px DS pixel pass at every station.
      pixel: true,
      station: focus ? "district" : "overview",
      focusDistrict: focus,
      camera: defaultOverride(STATIONS.overview),
      catastrophe: {
        districtId: phase === "calm" ? null : "*",
        phase,
        startedAt: 0,
      },
      diving: false,
    }),
    [edgeLab.active, edgeLab.pose, edgeLab.technique, focus, fraction, night, phase],
  );
  const onPickDistrict = useCallback(
    (id: string) => {
      const next = focus === id ? null : id;
      setLocalFocus(next);
      onFocusDistrict?.(next);
    },
    [focus, onFocusDistrict],
  );

  // Keyboard: Escape returns from the district station to the overview (ship handoff §6 ii);
  // Left / Right step through the districts in topic order, the same idiom the globe uses for
  // courses. Typing targets are left alone.
  const focusRef = useRef(focus);
  focusRef.current = focus;
  useEffect(() => {
    const order = districtOrder(layout).map((district) => district.id);
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isInteractiveKeyboardTarget(event.target)) return;
      if (event.key === "Escape") {
        if (!focusRef.current) return;
        setLocalFocus(null);
        onFocusDistrict?.(null);
        return;
      }
      const step = keyboardNavigationStep({
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        interactiveTarget: false,
      });
      if (step === null) return;
      const next = adjacentCourseId(order, focusRef.current, step);
      if (!next) return;
      event.preventDefault();
      setLocalFocus(next);
      onFocusDistrict?.(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFocusDistrict]);

  return (
    <BiomeScene
      layout={layout}
      state={state}
      onDiveEnd={() => undefined}
      onPickDistrict={onPickDistrict}
      hoveredId={hoveredId}
      onHover={setHoveredId}
    />
  );
}
