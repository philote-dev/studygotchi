/**
 * The altitude director: one spring on `L` between the rungs, stepped once
 * per frame by the stage, read by every layer. Pure, no three.js, no React:
 * `ProductShell` owns one instance and hands it out through the stage context.
 *
 * The director only ever moves the spring's target (`request`), parks it at
 * an altitude on the way to a rung (`hold`: the cloud dive waiting for the
 * land to be ready) or jumps the whole state for a restore (`teleport`); the
 * camera pose, fades and streaks that follow `L` are the hop's business
 * (`lib/stage/hop.ts`), which reads `sample()` and the altitude bands. Layers
 * report readiness here so a hop can wait for the layer it is heading to.
 *
 * Reduced motion (`setReducedMotion(true)`) replaces the spring with a
 * `REDUCED_HOP_MS` linear tween of `L`: the hop runtime turns that into a
 * crossfade between the two rungs' rest poses (`reducedHopAt`), nothing travels.
 */
import { DEFAULT_SPRING, atRest, createSpring, retarget, stepSpring, type SpringParams, type SpringState } from "./spring";
import { RUNG_L, rungAt, type Rung } from "./rungs";

export type StageLayerId = "sky" | "world" | "planet" | "constellation" | "galaxy";

/** Reduced motion: a hop is a linear tween of `L` this long, read as a crossfade. */
export const REDUCED_HOP_MS = 200;

export interface DirectorSample {
  /** Altitude on the log-distance axis (world 0 .. galaxy 3). */
  L: number;
  /** dL/dt over the last step (L per second); 0 at rest. */
  v: number;
  /** Nearest rest stop to `L`. */
  rung: Rung;
  /** The rung the spring is heading to (equals `rung` at rest; the held-for rung while parked). */
  target: Rung;
  /** True while the spring is travelling, still settling, or parked by `hold`. */
  moving: boolean;
  /** True while parked by `hold` (the camera waits inside the clouds). */
  held: boolean;
}

export interface LayerReadiness {
  set(layer: StageLayerId, ready: boolean): void;
  get(layer: StageLayerId): boolean;
  /** True when every listed layer has reported ready (a layer that never reported counts as not ready). */
  all(layers: readonly StageLayerId[]): boolean;
  subscribe(fn: (layer: StageLayerId, ready: boolean) => void): () => void;
}

export interface StageDirector {
  readonly params: SpringParams;
  readonly readiness: LayerReadiness;
  /** Point the spring at a rung; mid-flight this only bends the path (no velocity jump). */
  request(rung: Rung): void;
  /**
   * Park the spring at altitude `L` on the way to `rung` (reported as the target): the sample stays
   * `moving` (no rest event) until `request(rung)` releases it or a teleport ends the flight.
   */
  hold(L: number, rung: Rung): void;
  /** Jump to a rung with no motion (a restore). */
  teleport(rung: Rung): void;
  /** Jump to an exact altitude and rest there (captures and stills; `teleport` for product use). */
  teleportTo(L: number): void;
  /** Reduced motion: requests become `REDUCED_HOP_MS` linear tweens instead of the spring. */
  setReducedMotion(on: boolean): void;
  readonly reducedMotion: boolean;
  /** Advance by `dt` seconds (the stage calls this once per frame, before the layers). */
  step(dt: number): DirectorSample;
  /** The sample produced by the last `step` (or the initial rest state). */
  sample(): DirectorSample;
  /** Called once each time the spring comes to rest on a rung after moving. */
  onRest(fn: (rung: Rung) => void): () => void;
}

export function createReadiness(): LayerReadiness {
  const ready = new Map<StageLayerId, boolean>();
  const listeners = new Set<(layer: StageLayerId, ready: boolean) => void>();
  return {
    set(layer, value) {
      if (ready.get(layer) === value) return;
      ready.set(layer, value);
      for (const fn of listeners) fn(layer, value);
    },
    get(layer) {
      return ready.get(layer) === true;
    },
    all(layers) {
      return layers.every((layer) => ready.get(layer) === true);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export function createDirector(initial: Rung = "planet", params: SpringParams = DEFAULT_SPRING): StageDirector {
  const spring = createSpring(RUNG_L[initial]);
  const restListeners = new Set<(rung: Rung) => void>();
  let heldFor: Rung | null = null;
  let reduced = false;
  /** Reduced motion: the linear tween in flight (null otherwise). */
  let tween: { from: number; to: number; t: number } | null = null;
  let wasMoving = false;

  const sampleOf = (s: SpringState, v: number): DirectorSample => {
    const rung = rungAt(s.x);
    const held = heldFor !== null;
    return { L: s.x, v, rung, target: heldFor ?? rungAt(s.target), moving: held || tween !== null || !atRest(s), held };
  };
  let last = sampleOf(spring, 0);

  const aim = (L: number) => {
    if (reduced) {
      spring.target = L;
      spring.v = 0;
      tween = L === spring.x ? null : { from: spring.x, to: L, t: 0 };
    } else retarget(spring, L, params);
  };

  const director: StageDirector = {
    params,
    readiness: createReadiness(),
    get reducedMotion() {
      return reduced;
    },
    request(rung) {
      heldFor = null;
      aim(RUNG_L[rung]);
      last = sampleOf(spring, last.v);
      wasMoving = wasMoving || last.moving;
    },
    hold(L, rung) {
      heldFor = rung;
      aim(Math.max(0, Math.min(3, L)));
      last = sampleOf(spring, last.v);
      wasMoving = true;
    },
    teleport(rung) {
      this.teleportTo(RUNG_L[rung]);
    },
    teleportTo(L) {
      heldFor = null;
      tween = null;
      spring.x = Math.max(0, Math.min(3, L));
      spring.target = spring.x;
      spring.v = 0;
      wasMoving = false;
      last = sampleOf(spring, 0);
    },
    setReducedMotion(on) {
      if (on === reduced) return;
      reduced = on;
      // A flight in progress finishes the way it started; only new requests change mode.
    },
    step(dt) {
      const prev = spring.x;
      if (tween) {
        tween.t += Math.max(0, dt);
        const k = Math.min(1, tween.t / (REDUCED_HOP_MS / 1000));
        spring.x = tween.from + (tween.to - tween.from) * k;
        if (k >= 1) {
          spring.x = tween.to;
          tween = null;
        }
      } else stepSpring(spring, dt, params);
      const v = dt > 0 ? (spring.x - prev) / dt : 0;
      last = sampleOf(spring, v);
      if (last.moving) wasMoving = true;
      else if (wasMoving) {
        wasMoving = false;
        for (const fn of restListeners) fn(last.rung);
      }
      return last;
    },
    sample() {
      return last;
    },
    onRest(fn) {
      restListeners.add(fn);
      return () => {
        restListeners.delete(fn);
      };
    },
  };
  return director;
}
