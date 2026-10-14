/**
 * The hop's shared per-frame state and its discrete controller, one instance
 * per shell. No React, no three.js: `HopProvider` owns it, `HopDriver`
 * (inside the stage canvas) fills the per-frame fields from the director each
 * frame, the planet layer / world layer / galaxy rung / twin read and write
 * the anchors, and the header, the globe host and the land rail call `run()`
 * with a plan from `lib/stage/hop.ts`.
 *
 * Side effects a plan names (route push, course lock, recency, the chrome
 * ghost) are injected by the provider so this stays testable:
 * `createHopRuntime(director, effects)`.
 */
import type { CondenseAnchor } from "@/lib/graph/twin/condense";
import type { StageDirector } from "@/lib/stage/director";
import {
  CLOUD_HOLD,
  diveMustHold,
  galaxyHandoffAt,
  holdDoneAt,
  planetPoseAt,
  speedAt,
  twinCurvesAt,
  worldRiseAt,
  type GalaxyHandoff,
  type HopPlan,
  type PlanetPose,
  type PlanetSeat,
  type Speed,
  type TwinCurves,
  type WorldRise,
} from "@/lib/stage/hop";
import type { Rung } from "@/lib/stage/rungs";

export interface HopFrameState {
  L: number;
  v: number;
  moving: boolean;
  /** The globe centre and radius at the seat, written by the planet layer from its camera (null until it has drawn). */
  seat: PlanetSeat | null;
  /** The pull-back pose at `L` (identity at the seat). */
  pose: PlanetPose;
  /** The planet's screen point for the twin's bloom, CSS px of the viewport; null until the seat is known. */
  planetAnchor: CondenseAnchor | null;
  /** The current course's bead on screen, written by the galaxy rung; null while the galaxy has no layout. */
  galaxyAnchor: CondenseAnchor | null;
  twin: TwinCurves;
  /** The world segment (S4-2 and the cloud dive): land camera rise, cloud deck, world / planet swap, land chrome, planet approach. */
  world: WorldRise;
  /** The galaxy hand-off (the current blob folded into its core while the twin lands). */
  galaxy: GalaxyHandoff;
  /** The planet pass's opacity this frame (its altitude band times the world swap; the crossfade under reduced motion). */
  planetFade: number;
  /** The world pass's opacity this frame. */
  worldFade: number;
  speed: Speed;
  /** Viewport in CSS px (the stage canvas). */
  width: number;
  height: number;
  /** Zoom decades per unit of L for the speed dressing (from the seat radius; a default until the seat is known). */
  slope: number;
}

export interface HopEffects {
  push(href: string): void;
  replaceSearch(search: string): void;
  lockCourse(courseId: string): void;
  markRecent(courseId: string): void;
  prefetchRoute(href: string): void;
  warmLayout(): void;
  /** Snapshot the leaving page's chrome (`selector`) so it can fade after its page is gone; returns the remover. */
  ghost(selector: string): () => void;
}

export interface HopFlight {
  from: Rung;
  to: Rung;
  reason: HopPlan["reason"];
  /** A route still to push once the leaving page has faded (`holdDoneAt`). */
  pendingRoute: string | null;
  /**
   * The course to mark as most recently opened, applied at rest: recency
   * re-keys the galaxy rung (its courses, layout and scenery rebuild, then a
   * warm pass), a ~50 ms synchronous re-render of the stage root that used
   * to land on the first frames of every hop. Nothing in flight reads it.
   */
  pendingRecent: string | null;
  /** The cloud dive is parked inside the deck, waiting for the world layer (`CLOUD_HOLD`). */
  holding: boolean;
}

export interface HopRuntime {
  readonly director: StageDirector;
  readonly state: HopFrameState;
  readonly effects: HopEffects;
  /** The hop in flight, null at rest. */
  flight: HopFlight | null;
  /** Probe: the stage renderer's compiled programs (set by the driver inside the canvas). */
  programs: (() => string[]) | null;
  /** Run a plan: side effects, route (now or deferred), then the director request. False when the plan is a no-op. */
  run(plan: HopPlan): boolean;
  /** Called by the driver each frame after the pose is written: pushes a deferred route when its page has faded, drops ghosts when they are gone, parks and releases the dive. */
  tick(): void;
  /** Discrete changes (flight start / end) for React subscribers. */
  subscribe(fn: () => void): () => void;
  version(): number;
  /** The default seat before the planet layer reports one: the product's seat anchor at this viewport. */
  defaultSeat(width: number, height: number): PlanetSeat;
}

/** `PLANET_SEAT` of globe-seat.ts: the globe centre sits at (0.74, 0.58), its radius 1.08 of the limiting half-axis. */
const SEAT_ANCHOR = { x: 0.74, y: 0.58, radiusFit: 1.08 };

export function createHopRuntime(director: StageDirector, effects: HopEffects): HopRuntime {
  const listeners = new Set<() => void>();
  let version = 0;
  let removeGhost: (() => void) | null = null;
  const notify = () => {
    version++;
    for (const fn of listeners) fn();
  };
  const defaultSeat = (width: number, height: number): PlanetSeat => ({
    cx: SEAT_ANCHOR.x,
    cy: SEAT_ANCHOR.y,
    radiusPx: (Math.min(width, height) / 2) * SEAT_ANCHOR.radiusFit,
  });
  const seat0 = defaultSeat(1280, 800);
  const L0 = director.sample().L;
  const state: HopFrameState = {
    L: L0,
    v: 0,
    moving: false,
    seat: null,
    pose: planetPoseAt(L0, seat0),
    planetAnchor: null,
    galaxyAnchor: null,
    twin: twinCurvesAt(L0),
    world: worldRiseAt(L0),
    galaxy: galaxyHandoffAt(L0),
    planetFade: L0 >= 0.68 ? 1 : 0,
    worldFade: L0 <= 0.5 ? 1 : 0,
    speed: speedAt(L0, 0, 2, 2),
    width: 1280,
    height: 800,
    slope: 2.15,
  };
  const dropGhost = () => {
    if (!removeGhost) return;
    removeGhost();
    removeGhost = null;
  };

  const runtime: HopRuntime = {
    director,
    state,
    effects,
    flight: null,
    programs: null,
    run(plan) {
      if (!plan.target) return false;
      const s = director.sample();
      const from = s.moving ? s.target : s.rung;
      if (plan.lockCourse) effects.lockCourse(plan.lockCourse);
      let pendingRoute: string | null = null;
      if (plan.route) {
        if (plan.pushAt === "start") {
          dropGhost();
          if (plan.ghost) removeGhost = effects.ghost(plan.ghost);
          effects.push(plan.route);
        } else pendingRoute = plan.route;
      }
      // A re-press mid-flight keeps the earlier recency if this plan has none.
      const pendingRecent = plan.markRecent ?? runtime.flight?.pendingRecent ?? null;
      runtime.flight = { from, to: plan.target, reason: plan.reason, pendingRoute, pendingRecent, holding: false };
      director.request(plan.target);
      // A plan that asks for a rung the director already rests on never moves: settle its effects now.
      if (!director.sample().moving) settle();
      notify();
      return true;
    },
    tick() {
      const flight = runtime.flight;
      if (!flight) {
        if (removeGhost && !director.sample().moving) dropGhost();
        return;
      }
      // The cloud dive's readiness hold: park inside the deck until the land has drawn, then go on.
      const worldReady = director.readiness.get("world");
      if (flight.to === "world") {
        if (!flight.holding && diveMustHold(state.L, flight.to, worldReady)) {
          flight.holding = true;
          director.hold(CLOUD_HOLD.L, "world");
          notify();
        } else if (flight.holding && worldReady) {
          flight.holding = false;
          director.request("world");
          notify();
        }
      }
      // A deferred route goes once what the leaving page shows has faded; under reduced motion only
      // at rest (the crossfade has no cloud deck to hide the swap behind), which `settle` does.
      if (flight.pendingRoute && !director.reducedMotion && (holdDoneAt(state.L, flight.from, flight.to) || !director.sample().moving)) {
        const href = flight.pendingRoute;
        flight.pendingRoute = null;
        effects.push(href);
      }
      // The ghosted chrome has faded: remove it (and always at rest).
      if (removeGhost && (state.pose.chrome <= 0 || !director.sample().moving)) dropGhost();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    version: () => version,
    defaultSeat,
  };

  /** At rest: the route still pending goes, the recency lands, the ghost is dropped, the flight ends. */
  function settle(): void {
    const flight = runtime.flight;
    if (flight?.pendingRoute) {
      effects.push(flight.pendingRoute);
      flight.pendingRoute = null;
    }
    if (flight?.pendingRecent) {
      effects.markRecent(flight.pendingRecent);
      flight.pendingRecent = null;
    }
    dropGhost();
    if (runtime.flight) {
      runtime.flight = null;
      notify();
    }
  }

  director.onRest(settle);

  return runtime;
}
