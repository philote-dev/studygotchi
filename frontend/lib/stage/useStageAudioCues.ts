"use client";

/**
 * Mounts the stage spring's audio cues (X-2) on a director: every frame the mapper reads
 * `director.sample()` and the director's `onRest` arrivals, and the resulting cues go to the
 * audio director through `emit`. Pure wiring; the rules live in `./audio-cues.ts`.
 *
 * One line in `StageCanvas`, next to the `createDirector` memo:
 *
 *     useStageAudioCues(director);
 *
 * With no `subscribe` the hook runs its own `requestAnimationFrame` loop, so it can live outside
 * the R3F `<Canvas>` (one frame behind `DirectorStep` at most). A layer inside the canvas can
 * instead hand in a `subscribe` that calls back from `useFrame`.
 */
import { useEffect } from "react";
import { emit as emitAudio, type AudioEvent } from "@/lib/audio/events";
import { createStageCueMapper, type StageCueParams } from "./audio-cues";
import type { StageDirector } from "./director";

export interface StageAudioCuesOptions {
  /** Called once per frame when provided; otherwise the hook runs a rAF loop. Returns an unsubscribe. */
  subscribe?: (tick: () => void) => () => void;
  /** Where cues go (default: the audio director's `emit`). */
  emit?: (event: AudioEvent) => void;
  /** Monotonic clock in ms (default `performance.now`). */
  now?: () => number;
  params?: StageCueParams;
}

export function useStageAudioCues(director: StageDirector | null | undefined, options: StageAudioCuesOptions = {}): void {
  const { subscribe, emit: emitOption, now: nowOption, params } = options;

  useEffect(() => {
    if (!director || typeof window === "undefined") return;
    const send = emitOption ?? emitAudio;
    const now = nowOption ?? (() => performance.now());
    const mapper = createStageCueMapper(params);

    const tick = () => {
      for (const cue of mapper.sample(director.sample(), now())) send(cue);
    };
    const offRest = director.onRest((rung) => {
      for (const cue of mapper.rest(rung)) send(cue);
    });

    let unsubscribe: () => void;
    if (subscribe) {
      unsubscribe = subscribe(tick);
    } else {
      let frame = 0;
      const loop = () => {
        tick();
        frame = window.requestAnimationFrame(loop);
      };
      frame = window.requestAnimationFrame(loop);
      unsubscribe = () => window.cancelAnimationFrame(frame);
    }

    return () => {
      offRest();
      unsubscribe();
      for (const cue of mapper.stop()) send(cue);
    };
  }, [director, subscribe, emitOption, nowOption, params]);
}
