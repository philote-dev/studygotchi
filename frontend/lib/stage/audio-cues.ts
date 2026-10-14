/**
 * Stage spring -> audio cues (X-2). A pure mapper from the altitude director's per-frame
 * samples (and its `onRest` arrivals) to `AudioEvent`s, so the sound of a hop is derived from
 * the same `L` and `v` the camera follows and cannot drift from the picture.
 *
 * Four cues, tiered the way game-feel tiers juice (small for the continuous layer, one hit per
 * arrival, nothing for idling):
 *
 *   riser            continuous; level follows |v| (speed) scaled by L (height), <= 10 updates/s,
 *                    with on/off hysteresis so a spring at rest emits nothing at all. The last
 *                    update of a run is always `intensity: 0`.
 *   hop-start        the moment a `request` changes the spring's target (`from` -> `to`, `up`).
 *   rung-arrive      the director's `onRest`: one hit note with the rung as payload.
 *   galaxy-ambience  the astral music-layer gate: true only while L >= 2.6, emitted on change.
 *
 * Time is passed in (ms), nothing here touches the runtime or the clock; `useStageAudioCues`
 * drives it from a frame loop and forwards the cues to `emit`.
 */
import type { AudioEvent } from "@/lib/audio/events";
import type { DirectorSample } from "./director";
import { L_MAX, RUNG_L, type Rung } from "./rungs";

export type StageAudioEvent = Extract<
  AudioEvent,
  { type: "stage-riser" | "stage-hop" | "stage-arrive" | "stage-galaxy-ambience" }
>;

export interface StageCueParams {
  /** Minimum gap between riser updates (ms). 100 = 10 updates/s. */
  riserGapMs: number;
  /** Speed (L/s) that reads as a full-level riser; the spring's `vMax` (1.5) is a natural choice. */
  riserVRef: number;
  /** The riser switches on above this level ... */
  riserOn: number;
  /** ... and off below this one (lower, so a settling spring does not stutter). */
  riserOff: number;
  /** Height weighting: level = speed * (1 - heightWeight + heightWeight * L / L_MAX). */
  heightWeight: number;
  /** Altitude at and above which the astral layer is open. */
  galaxyGateL: number;
}

export const DEFAULT_STAGE_CUES: StageCueParams = {
  riserGapMs: 100,
  riserVRef: 1.5,
  riserOn: 0.08,
  riserOff: 0.03,
  heightWeight: 0.4,
  galaxyGateL: 2.6,
};

/** The raw riser level for a sample (before throttle and hysteresis): 0 .. 1. */
export function riserLevel(sample: Pick<DirectorSample, "L" | "v">, p: StageCueParams = DEFAULT_STAGE_CUES): number {
  const speed = Math.min(1, Math.abs(sample.v) / p.riserVRef);
  const height = Math.max(0, Math.min(1, sample.L / L_MAX));
  const level = speed * (1 - p.heightWeight + p.heightWeight * height);
  return Math.round(level * 1000) / 1000;
}

/** The astral layer gate for an altitude. */
export function galaxyGateOpen(L: number, p: StageCueParams = DEFAULT_STAGE_CUES): boolean {
  return L >= p.galaxyGateL;
}

export interface StageCueMapper {
  /** Feed the director's latest sample; `nowMs` is any monotonic clock in milliseconds. */
  sample(sample: DirectorSample, nowMs: number): StageAudioEvent[];
  /** Feed a director `onRest` arrival. */
  rest(rung: Rung): StageAudioEvent[];
  /** Close every open layer (riser to 0, gate to false) for an unmount. */
  stop(): StageAudioEvent[];
}

export function createStageCueMapper(p: StageCueParams = DEFAULT_STAGE_CUES): StageCueMapper {
  let lastTarget: Rung | null = null;
  let riserOn = false;
  let lastRiserAt = -Infinity;
  let gateOpen = false;

  return {
    sample(s, nowMs) {
      const out: StageAudioEvent[] = [];

      // hop-start: the target moved (the first sample only primes the mapper; no hop yet).
      if (lastTarget === null) {
        lastTarget = s.target;
      } else if (s.target !== lastTarget) {
        out.push({ type: "stage-hop", from: lastTarget, to: s.target, up: RUNG_L[s.target] > RUNG_L[lastTarget] });
        lastTarget = s.target;
      }

      // galaxy-ambience gate: edge-triggered.
      const open = galaxyGateOpen(s.L, p);
      if (open !== gateOpen) {
        gateOpen = open;
        out.push({ type: "stage-galaxy-ambience", on: open });
      }

      // riser: throttled, hysteretic, silent at rest.
      if (nowMs - lastRiserAt >= p.riserGapMs) {
        const level = riserLevel(s, p);
        if (riserOn) {
          if (level < p.riserOff) {
            riserOn = false;
            out.push({ type: "stage-riser", intensity: 0 });
          } else {
            out.push({ type: "stage-riser", intensity: level });
          }
          lastRiserAt = nowMs;
        } else if (level > p.riserOn) {
          riserOn = true;
          out.push({ type: "stage-riser", intensity: level });
          lastRiserAt = nowMs;
        }
      }

      return out;
    },
    rest(rung) {
      return [{ type: "stage-arrive", rung }];
    },
    stop() {
      const out: StageAudioEvent[] = [];
      if (riserOn) {
        riserOn = false;
        out.push({ type: "stage-riser", intensity: 0 });
      }
      if (gateOpen) {
        gateOpen = false;
        out.push({ type: "stage-galaxy-ambience", on: false });
      }
      return out;
    },
  };
}
