/**
 * The hop state machine over the altitude director (S2-3, S2-4, S3-2, S4;
 * permanent since 2026-10-13, gates 2-4). Pure: no React, no three.js, no
 * router. The shell asks it what a pill press or a landmark click means
 * (`onInformation`, `onCourses`, `onBeadClick`, `onLand`) and carries out the
 * side effects it names (route to push, course to lock and mark recent); the
 * stage asks it, every frame, how the layers should look at the director's
 * `L` (`planetPoseAt`, `twinCurvesAt`, `galaxyHandoffAt`, `worldRiseAt`,
 * `speedAt`), or, under reduced motion, how the two rest poses crossfade
 * (`reducedHopAt`).
 *
 * Philote's rules (2026-10-11, 2026-10-13). Two pills, course-keyed ladder:
 *
 *   Information  planet (settled on a course)  -> that course's constellation
 *                constellation                 -> the galaxy
 *                galaxy                        -> nothing
 *                world                         -> the constellation (merged rise)
 *   Courses      constellation                 -> planet locked on that course
 *                galaxy                        -> planet on the most recent course
 *                planet                        -> nothing
 *                world                         -> planet on the world's course
 *   Bead click   galaxy                        -> that course's constellation
 *   Land         planet (landmark click, Land) -> that course's world (the cloud dive)
 *
 * Choreography. World <-> planet is the cloud pass-through, the same curves
 * both ways (`worldRiseAt`, a function of L alone): climbing, the land camera
 * takes the dive path in reverse while the land chrome fades, the cloud deck
 * closes over the lens (full from L 0.46 to 0.68) and, behind it, the world
 * pass goes out and the planet pass comes in with its camera over the
 * landmark; the clouds clear by 0.9 and the planet camera settles on the seat
 * by L 1. Diving (planet -> world, 2026-10-13: "use it going into the world
 * and coming out"), the same frames run backwards: the planet camera drops
 * from the seat to over the landmark, the deck closes, the globe goes out and
 * the land comes in under it, and the land camera breaks out beneath the
 * clouds down the dive path onto the island. The land must be ready before
 * the clouds thin: if it is not, the director parks inside the deck
 * (`CLOUD_HOLD`) until the world layer reports ready, never showing a
 * half-loaded land. Planet -> constellation is the lab pull-back: the planet
 * recedes along its seat ray on the spring (log distance, constant decades
 * per unit of L) to a centred POINT (`POINT_CELLS` cells), its screen position
 * easing from the seat to the viewport centre; the planet chrome (navigator,
 * flag) is gone by L 1.4; the twin blooms out of the planet's screen point
 * (`enterFromL`, 1.4 -> 2.0). Constellation -> galaxy: the twin condenses
 * (`condenseFromL`, 2.05 -> 2.7) onto the current course's blob CORE (its
 * core glow, grown to the bead while the blob is folded) while the galaxy
 * fades in (altitude band 2.3 -> 2.78); the blob blooms out of the core and
 * the ring lands together (`BLOB_BLOOM`, 2.65 -> 2.95).
 * Nothing pauses, nothing pops: every curve is C1 in L and the spring shapes L.
 */
import { altitudeAt, pixelFor, smoothstep, streaksFor } from "./altitude";
import { condenseFromL, enterFromL } from "@/lib/graph/twin/condense";
import { landHref } from "@/lib/world/earth-nav";
import { RUNG_L, type Rung } from "./rungs";

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

export type HopReason = "information" | "courses" | "bead-click" | "land";

export interface HopContext {
  /** The rung the ladder is read from: the director's target while moving, its rest rung otherwise. */
  rung: Rung;
  /** Current route and query (the stage flags ride along on every push). */
  pathname: string;
  search: string;
  /** The course the stage is on: the planet's settled course, or the constellation's course. */
  activeCourseId: string | null;
  mostRecentCourseId: string | null;
  /** The identity's course: the fallback when nothing was opened yet. */
  defaultCourseId: string | null;
  /** Known course ids (an unknown lock target falls back to the default). */
  courseIds: readonly string[];
}

export interface HopPlan {
  reason: HopReason;
  /** Rung to request from the director; null = the press does nothing. */
  target: Rung | null;
  /** Route to push at hop start (with the stage flags carried over); null = stay. */
  route: string | null;
  /** Course to select / lock the planet on (null = leave as is). */
  lockCourse: string | null;
  /** Course to mark as the most recently opened (null = none). */
  markRecent: string | null;
  /**
   * When the route is pushed. `start`: at the press (the arriving page warms up
   * under the motion; the leaving page's chrome is ghosted and faded, see
   * `ghost`). `faded`: once what the leaving page shows has faded
   * (`holdDoneAt`), because it must keep rendering until then (the twin
   * collapsing into the planet on the way down).
   */
  pushAt: "start" | "faded";
  /** CSS selector of the leaving page's chrome to snapshot and fade when the route is pushed at start. */
  ghost: string | null;
}

/** The planet rung's DOM chrome (navigator + flag) the pull-back fades. */
export const PLANET_CHROME_SELECTOR = ".earth-planet-chrome";
/** The world rung's DOM chrome (the land rail, the place card) the rise fades before the clouds. */
export const LAND_CHROME_SELECTOR = ".concept-rail, .earth-panel";

export const EARTH_ROUTE = "/earth";
export const KNOWLEDGE_ROUTE = "/knowledge";

/** Query parameters a hop carries from one route to the next (the perf probe and the QA hook; `stage=` is inert and dropped). */
export const CARRIED_PARAMS: readonly string[] = ["perf", "qa"];

/** `route` (which may carry its own query, e.g. `/earth?land=8.223`) with the carried params of the current URL; nothing else rides along. */
export function hopHref(route: string, search: string): string {
  const from = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const i = route.indexOf("?");
  const path = i < 0 ? route : route.slice(0, i);
  const to = new URLSearchParams(i < 0 ? "" : route.slice(i + 1));
  for (const key of CARRIED_PARAMS) for (const value of from.getAll(key)) to.append(key, value);
  const q = to.toString();
  return q ? `${path}?${q}` : path;
}

/** Strip a query to its route for comparisons (`/knowledge?stage=hop` -> `/knowledge`). */
export function routeOf(href: string): string {
  const i = href.indexOf("?");
  return i < 0 ? href : href.slice(0, i);
}

function knownCourse(id: string | null, ctx: HopContext): string | null {
  if (id && (ctx.courseIds.length === 0 || ctx.courseIds.includes(id))) return id;
  return null;
}

const NOOP = (reason: HopReason): HopPlan => ({ reason, target: null, route: null, lockCourse: null, markRecent: null, pushAt: "start", ghost: null });

function routeTo(route: string, ctx: HopContext): string | null {
  return routeOf(ctx.pathname) === route ? null : hopHref(route, ctx.search);
}

export function onInformation(ctx: HopContext): HopPlan {
  const reason: HopReason = "information";
  switch (ctx.rung) {
    case "galaxy":
      return NOOP(reason);
    case "constellation": {
      const course = knownCourse(ctx.activeCourseId, ctx) ?? knownCourse(ctx.defaultCourseId, ctx);
      return { reason, target: "galaxy", route: routeTo(KNOWLEDGE_ROUTE, ctx), lockCourse: null, markRecent: course, pushAt: "start", ghost: null };
    }
    case "planet": {
      const course = knownCourse(ctx.activeCourseId, ctx) ?? knownCourse(ctx.defaultCourseId, ctx);
      if (!course) return NOOP(reason);
      const route = routeTo(KNOWLEDGE_ROUTE, ctx);
      // Up: the knowledge page mounts at once (its twin blooms from 1.4); the planet chrome is
      // ghosted so it fades on the spring instead of vanishing with its page.
      return { reason, target: "constellation", route, lockCourse: course, markRecent: course, pushAt: "start", ghost: route ? PLANET_CHROME_SELECTOR : null };
    }
    case "world": {
      const course = knownCourse(ctx.activeCourseId, ctx) ?? knownCourse(ctx.defaultCourseId, ctx);
      if (!course) return NOOP(reason);
      // The merged rise: one spring request straight to the constellation. The land must keep
      // drawing until the clouds have closed over it (`WORLD_RISE.worldGone`), so the route
      // follows then; its chrome fades live (`worldRiseAt().landChrome`), nothing to ghost.
      return { reason, target: "constellation", route: routeTo(KNOWLEDGE_ROUTE, ctx), lockCourse: course, markRecent: course, pushAt: "faded", ghost: null };
    }
  }
}

export function onCourses(ctx: HopContext): HopPlan {
  const reason: HopReason = "courses";
  switch (ctx.rung) {
    case "planet":
      return NOOP(reason);
    case "constellation": {
      const course = knownCourse(ctx.activeCourseId, ctx) ?? knownCourse(ctx.mostRecentCourseId, ctx) ?? knownCourse(ctx.defaultCourseId, ctx);
      const route = routeTo(EARTH_ROUTE, ctx);
      // Down: the twin must keep drawing while the graph collapses into the planet, so the route
      // follows once it has (L <= 1.4); the planet itself is already on the stage.
      return { reason, target: "planet", route, lockCourse: course, markRecent: null, pushAt: "faded", ghost: null };
    }
    case "world": {
      const course = knownCourse(ctx.activeCourseId, ctx) ?? knownCourse(ctx.mostRecentCourseId, ctx) ?? knownCourse(ctx.defaultCourseId, ctx);
      // Up to the planet, settling on the land's landmark. The land lives at `/earth?land=`: the
      // route is the planet's `/earth` (the land param is not carried), pushed once the clouds
      // have closed over the land so the earth page swaps the land for the globe unseen.
      return { reason, target: "planet", route: hopHref(EARTH_ROUTE, ctx.search), lockCourse: course, markRecent: null, pushAt: "faded", ghost: null };
    }
    case "galaxy": {
      const course = knownCourse(ctx.mostRecentCourseId, ctx) ?? knownCourse(ctx.defaultCourseId, ctx) ?? knownCourse(ctx.activeCourseId, ctx);
      const route = routeTo(EARTH_ROUTE, ctx);
      return { reason, target: "planet", route, lockCourse: course, markRecent: null, pushAt: "faded", ghost: null };
    }
  }
}

/** A course bead clicked in the galaxy: drop into that course's constellation. */
export function onBeadClick(ctx: HopContext, courseId: string): HopPlan {
  const reason: HopReason = "bead-click";
  const course = knownCourse(courseId, ctx);
  if (!course) return NOOP(reason);
  const route = routeTo(KNOWLEDGE_ROUTE, ctx);
  return { reason, target: "constellation", route, lockCourse: course, markRecent: course, pushAt: "start", ghost: null };
}

/**
 * A landmark clicked (or the flag's Land button) on the planet: the cloud dive
 * into that course's world. The route is the land's (`/earth?land=<code>`),
 * pushed at the press: the earth page mounts the land at once so it is drawn
 * and compiled under the deck (the world pass is invisible above L 0.68), and
 * the planet chrome is ghosted so it fades on the spring (`planetPoseAt().chrome`,
 * gone by L 0.8). From any other rung the press does nothing (the planet's input is
 * only live at the seat).
 */
export function onLand(ctx: HopContext, courseId: string, landKey: string | null = null): HopPlan {
  const reason: HopReason = "land";
  if (ctx.rung !== "planet") return NOOP(reason);
  const course = knownCourse(courseId, ctx);
  if (!course) return NOOP(reason);
  return { reason, target: "world", route: hopHref(landHref(landKey ?? course), ctx.search), lockCourse: course, markRecent: course, pushAt: "start", ghost: PLANET_CHROME_SELECTOR };
}

export type PrefetchIntent = { kind: "route"; href: string } | { kind: "layout" } | { kind: "galaxy" };

/** What hovering Information should warm from `rung`: the next rung's route and data, never a camera move. */
export function prefetchFor(rung: Rung): PrefetchIntent[] {
  switch (rung) {
    case "planet":
    case "world":
      return [{ kind: "route", href: KNOWLEDGE_ROUTE }, { kind: "layout" }];
    case "constellation":
      return [{ kind: "galaxy" }];
    case "galaxy":
      return [];
  }
}

/** Query with `rung=` mirrored (dropped on the planet, the default, and on the world, whose route is `?land=`), everything else kept. */
export function rungSearch(search: string, rung: Rung): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (rung === "planet" || rung === "world") params.delete("rung");
  else params.set("rung", rung);
  const q = params.toString();
  return q ? `?${q}` : "";
}

/* ------------------------------------------------------------------ */
/* World segment (L 0 -> 1): the merged rise                           */
/* ------------------------------------------------------------------ */

/**
 * Thresholds of the world segment on L. The cloud deck is the mask: it is
 * whole from `cloudsFull` to `cloudsThin`, and both layer swaps (world out,
 * planet in) complete inside that window, so no frame shows the land and the
 * globe together. The land camera reaches the top of its dive path at
 * `riseDone`, where the world pass is gone; the planet camera travels from
 * over the landmark to the seat between `approachFrom` and L 1.
 */
export const WORLD_RISE = {
  /** Land chrome (rail, place card) gone by here. */
  chromeGone: 0.3,
  cloudsIn: 0.28,
  cloudsFull: 0.46,
  cloudsThin: 0.68,
  cloudsGone: 0.9,
  /** World pass: whole up to here, gone by `worldGone` (under the whole deck). */
  worldFull: 0.5,
  worldGone: 0.68,
  /** Planet pass: nothing up to here, whole by `planetFull`. */
  planetIn: 0.5,
  planetFull: 0.68,
  /** The land camera's reverse dive spans L 0 .. riseDone. */
  riseDone: 0.7,
  /** The planet camera leaves its over-the-landmark pose here (as the clouds thin) and is on the seat at L 1. */
  approachFrom: 0.7,
  /** Planet chrome (navigator, flag) fades in from here on the way up to the seat. */
  planetChromeIn: 0.8,
} as const;

export interface WorldRise {
  L: number;
  /** 0 at the land's station pose, 1 at the top of the dive path (easing is the rig's). */
  rise: number;
  /** Cloud deck coverage on the lens: 0 clear, 1 whole. */
  clouds: number;
  /** World pass opacity. */
  world: number;
  /** Planet pass share below its rung (times the galaxy band above). */
  planet: number;
  /** Land chrome opacity. */
  landChrome: number;
  /** 0 planet camera over the landmark, 1 on the seat. */
  approach: number;
}

/** World pass opacity by altitude: whole at rest and up to the cloud deck, gone under the full deck. */
export function worldPassFadeAt(L: number): number {
  return 1 - smoothstep(WORLD_RISE.worldFull, WORLD_RISE.worldGone, L);
}

/** The planet pass's share below its rung: nothing inside the world, whole under the full deck, 1 from the planet up. */
export function planetFromWorldFadeAt(L: number): number {
  return smoothstep(WORLD_RISE.planetIn, WORLD_RISE.planetFull, L);
}

/** Cloud deck coverage: closes over the lens before the swap, whole through it, clear again on the planet side. */
export function cloudDeckAt(L: number): number {
  return smoothstep(WORLD_RISE.cloudsIn, WORLD_RISE.cloudsFull, L) * (1 - smoothstep(WORLD_RISE.cloudsThin, WORLD_RISE.cloudsGone, L));
}

/** The world segment at `L`: identity at rest on the world (L 0) and on the planet (L >= 1). */
export function worldRiseAt(L: number): WorldRise {
  return {
    L,
    rise: Math.min(1, Math.max(0, L / WORLD_RISE.riseDone)),
    clouds: cloudDeckAt(L),
    world: worldPassFadeAt(L),
    planet: planetFromWorldFadeAt(L),
    landChrome: 1 - smoothstep(0, WORLD_RISE.chromeGone, L),
    approach: smoothstep(WORLD_RISE.approachFrom, 1, L),
  };
}

/**
 * The cloud dive's readiness hold. Descending toward the world, the moment
 * the deck is whole (`trigger` = `WORLD_RISE.cloudsThin`, the top of the full
 * deck, 0.46 .. 0.68) with the world layer not yet drawn, the runtime parks
 * the spring at `L` (`StageDirector.hold`): the deck stays whole, the land
 * mounts and compiles under it (its scene graph is a synchronous build, its
 * programs compile in parallel), the streaks are already gone (`speedAt`:
 * none inside the atmosphere) and the deck's own slow drift is the only
 * motion. The dive resumes the moment the world reports ready. A critically
 * damped spring retargeted from `trigger` to `L` at the dive's cruise speed
 * dips to ~0.52, still inside the full deck; the stage steps the director
 * by at most 1/30 s per frame, so a long frame never carries it past the
 * deck. The rise never holds (the planet is always compiled).
 */
export const CLOUD_HOLD = { trigger: 0.68, L: 0.6 } as const;

/** Whether a dive at `L` heading to the world must park: inside the deck with the land not ready. */
export function diveMustHold(L: number, to: Rung, worldReady: boolean): boolean {
  return to === "world" && !worldReady && L <= CLOUD_HOLD.trigger;
}

/* ------------------------------------------------------------------ */
/* Reduced motion: the crossfade at rest poses                          */
/* ------------------------------------------------------------------ */

/** Each rung's rest fades: which layer is whole while resting there. */
export interface RestFades {
  world: number;
  planet: number;
  twin: number;
}

export function restFadesAt(rung: Rung): RestFades {
  return { world: rung === "world" ? 1 : 0, planet: rung === "planet" ? 1 : 0, twin: rung === "constellation" ? 1 : 0 };
}

export interface ReducedHop extends RestFades {
  /** 0 at the leaving rung's rest pose, 1 at the arriving rung's. */
  x: number;
}

/**
 * Reduced motion (`prefers-reduced-motion: reduce`): a hop is a
 * `REDUCED_HOP_MS` tween of `L` from one rung to the next, read here as a
 * crossfade of the two rest poses: the leaving layer fades out while the
 * arriving one fades in, both drawn at their rest pose (planet at the seat,
 * land at its station, graph whole); no camera travel, no clouds, no streaks,
 * no grain ramp. The galaxy keeps its own altitude band (a fade too). A land
 * that is not ready yet stays at 0 (the planet fades to the sky and the land
 * comes in once it has drawn), so no frame shows a half-loaded land.
 */
export function reducedHopAt(L: number, from: Rung, to: Rung, worldReady = true): ReducedHop {
  const a = RUNG_L[from];
  const b = RUNG_L[to];
  const x = a === b ? 1 : Math.min(1, Math.max(0, (L - a) / (b - a)));
  const fa = restFadesAt(from);
  const fb = restFadesAt(to);
  const mix = (p: number, q: number) => p + (q - p) * x;
  const world = mix(fa.world, fb.world);
  return { x, world: to === "world" && !worldReady ? 0 : world, planet: mix(fa.planet, fb.planet), twin: mix(fa.twin, fb.twin) };
}

/* ------------------------------------------------------------------ */
/* Pull-back pose (L 1 -> 2)                                           */
/* ------------------------------------------------------------------ */

/** The planet's end state: a point this many cells across (open decision 11; 3 reads as a point, not a star). */
export const POINT_CELLS = 3;
/** The planet is centred by here (before the bloom finishes at 2.0). */
export const CENTRE_BY_L = 1.75;
/** Planet chrome (navigator, flag) is gone by here. */
export const CHROME_GONE_L = 1.4;

export interface PlanetSeat {
  /** The globe centre on screen, viewport fractions (x right, y down). */
  cx: number;
  cy: number;
  /** The globe's screen radius at the seat, CSS px. */
  radiusPx: number;
}

export interface PlanetPose {
  L: number;
  /** Camera distance factor over the seat (1 at the seat); the globe's screen radius is `seat.radiusPx / k`. */
  k: number;
  radiusPx: number;
  /** Where the globe centre sits on screen, viewport fractions. */
  cx: number;
  cy: number;
  /** 0 at the seat, 1 centred. */
  centre: number;
  /** Opacity of the planet chrome (navigator, flag). */
  chrome: number;
  /** Opacity of the planet pass itself (1 through the pull-back; the galaxy band fades it above 2.3). */
  opacity: number;
}

/** The pose at `L`: at rest on the planet (L <= 1) it is exactly the seat, so nothing changes until a hop. */
export function planetPoseAt(L: number, seat: PlanetSeat, cellPx = 2): PlanetPose {
  const s = Math.min(1, Math.max(0, L - 1));
  const pointPx = (POINT_CELLS * cellPx) / 2;
  const seatR = Math.max(pointPx, seat.radiusPx);
  // Log-distance interpolation: a constant zoom rate per unit of L, the spring shapes it.
  const radiusPx = seatR * Math.pow(pointPx / seatR, s);
  const k = seatR / radiusPx;
  const centre = smoothstep(1, CENTRE_BY_L, L);
  return {
    L,
    k,
    radiusPx,
    cx: seat.cx + (0.5 - seat.cx) * centre,
    cy: seat.cy + (0.5 - seat.cy) * centre,
    centre,
    // Gone by 1.4 on the pull-back; on the rise from a world it comes in with the seat (from 0.8).
    chrome: L < 1 ? smoothstep(WORLD_RISE.planetChromeIn, 1, L) : 1 - smoothstep(1, CHROME_GONE_L, L),
    opacity: 1,
  };
}

/** Decades of zoom per unit of L on the pull-back (log10 of the seat-to-point ratio). */
export function pullbackSlope(seatRadiusPx: number, cellPx = 2): number {
  const pointPx = (POINT_CELLS * cellPx) / 2;
  return Math.log10(Math.max(pointPx, seatRadiusPx) / pointPx);
}

/* ------------------------------------------------------------------ */
/* Twin and galaxy hand-off                                            */
/* ------------------------------------------------------------------ */

export interface TwinCurves {
  /** T-4: 0 collapsed at the planet point, 1 the full graph (`enterFromL`). */
  enter: number;
  /** T-4: 0 the full graph, 1 collapsed on the galaxy bead (`condenseFromL`). */
  condense: number;
  /** The twin's own opacity: in with the bloom, out once it sits on the bead. */
  opacity: number;
  /** The constellation chrome (toolbar, docks, legend). */
  chrome: number;
}

export function twinCurvesAt(L: number): TwinCurves {
  const enter = enterFromL(L);
  const condense = condenseFromL(L);
  return {
    enter,
    condense,
    opacity: smoothstep(0, 0.3, enter) * (1 - smoothstep(0.8, 1, condense)),
    chrome: smoothstep(1.75, 2.0, L) * (1 - smoothstep(2.05, 2.3, L)),
  };
}

export interface GalaxyHandoff {
  condense: number;
  /** Galaxy layer opacity (altitude band). */
  galaxy: number;
  beads: number;
  ring: number;
  /**
   * The current course's BLOB collapsed into its core glow (1) or whole (0).
   * The twin's stars land on the core glow (grown to the bead, `blob` 1) by
   * L 2.7; the blob then blooms out of it with the ring (2.65 -> 2.95), so
   * the graph's stars and the blob's never show together. Read backwards on
   * a bead click: the blob folds into its core before the twin blooms.
   */
  blob: number;
}

/** The current blob is whole by here (with the ring, `altitudeAt().ring` 2.65 -> 2.95). */
export const BLOB_BLOOM = { from: 2.65, to: 2.95 } as const;

export function galaxyHandoffAt(L: number): GalaxyHandoff {
  const alt = altitudeAt(L);
  return { condense: condenseFromL(L), galaxy: alt.galaxy, beads: alt.beads, ring: alt.ring, blob: 1 - smoothstep(BLOB_BLOOM.from, BLOB_BLOOM.to, L) };
}

/* ------------------------------------------------------------------ */
/* Speed dressing                                                      */
/* ------------------------------------------------------------------ */

export interface Speed {
  /** Decades per second. */
  rate: number;
  streaks: { density: number; speed: number };
  /** Integer cell size, 2 at rest, 3 while fast (hysteresis on `current`). */
  pixel: number;
  /**
   * Direction of travel along the ladder: `1` climbing (planet -> constellation -> galaxy,
   * the warp tunnel streams toward the viewer), `-1` descending (back toward the planet,
   * the tunnel streams away into the centre), `0` at rest (keeps the last heading).
   */
  direction: 1 | -1 | 0;
}

/** Streak density and the cell size from the spring velocity; `slope` is the zoom in decades per L. */
export function speedAt(L: number, v: number, slope: number, currentPixel: number): Speed {
  const rate = Math.abs(v) * slope;
  const streaks = streaksFor(rate);
  // Star streaks belong to space: none inside the atmosphere (the world rung).
  streaks.density *= smoothstep(0.85, 1.25, L);
  const direction: Speed["direction"] = v > 1e-4 ? 1 : v < -1e-4 ? -1 : 0;
  return { rate, streaks, pixel: pixelFor(rate, currentPixel), direction };
}

/* ------------------------------------------------------------------ */
/* Deferred route push                                                 */
/* ------------------------------------------------------------------ */

/**
 * When a `pushAt: "faded"` route may go: what the leaving page shows has
 * faded. Up, the planet chrome is gone by L 1.4; down, the twin has collapsed
 * into the planet by L 1.4 (its opacity band). From a world (up to the planet
 * or straight to the constellation) the land must draw until the cloud deck
 * has closed over it (`WORLD_RISE.worldGone`). A hop that never changes route has nothing to
 * wait for.
 */
export function holdDoneAt(L: number, from: Rung, to: Rung): boolean {
  if (from === to) return true;
  if (from === "world") return L >= WORLD_RISE.worldGone;
  if (to === "constellation" || to === "galaxy") return L >= CHROME_GONE_L;
  return L <= CHROME_GONE_L;
}
