import { describe, expect, it, vi } from "vitest";
import {
  CHROME_GONE_L,
  CLOUD_HOLD,
  cloudDeckAt,
  diveMustHold,
  galaxyHandoffAt,
  holdDoneAt,
  hopHref,
  onBeadClick,
  onCourses,
  onInformation,
  onLand,
  planetPoseAt,
  POINT_CELLS,
  prefetchFor,
  pullbackSlope,
  reducedHopAt,
  restFadesAt,
  rungSearch,
  speedAt,
  twinCurvesAt,
  WORLD_RISE,
  worldPassFadeAt,
  worldRiseAt,
  type HopContext,
} from "./hop";
import { condenseFromL, enterFromL } from "@/lib/graph/twin/condense";
import { createHopRuntime, type HopEffects } from "@/components/stage/hop/hop-runtime";
import { altitudeAt } from "./altitude";
import { createDirector, REDUCED_HOP_MS } from "./director";

const base: HopContext = {
  rung: "planet",
  pathname: "/earth",
  search: "?stage=planet,twin,galaxy,hop&perf=1&land=8.223",
  activeCourseId: "c1",
  mostRecentCourseId: "c2",
  defaultCourseId: "c0",
  courseIds: ["c0", "c1", "c2"],
};

describe("hop rules", () => {
  it("Information: planet -> that course's constellation on /knowledge, locking and marking it", () => {
    const plan = onInformation(base);
    // `stage=` is inert since 2026-10-13 and no longer rides along; `perf` and `qa` do.
    expect(plan).toEqual({ reason: "information", target: "constellation", route: "/knowledge?perf=1", lockCourse: "c1", markRecent: "c1", pushAt: "start", ghost: ".earth-planet-chrome" });
  });

  it("Information: planet with no course does nothing", () => {
    expect(onInformation({ ...base, activeCourseId: null, defaultCourseId: null }).target).toBeNull();
    expect(onInformation({ ...base, activeCourseId: "nope", defaultCourseId: null }).target).toBeNull();
    // An unknown active course falls back to the default.
    expect(onInformation({ ...base, activeCourseId: "nope" }).lockCourse).toBe("c0");
  });

  it("Information: constellation -> galaxy, same route, no hold; galaxy -> nothing", () => {
    const ctx = { ...base, rung: "constellation" as const, pathname: "/knowledge", search: "?stage=hop" };
    expect(onInformation(ctx)).toEqual({ reason: "information", target: "galaxy", route: null, lockCourse: null, markRecent: "c1", pushAt: "start", ghost: null });
    expect(onInformation({ ...ctx, rung: "galaxy" })).toMatchObject({ target: null, route: null });
  });

  it("Information: world rises to the constellation in one request, the route following once the clouds have closed", () => {
    const ctx = { ...base, rung: "world" as const, search: "?stage=planet,twin,galaxy,hop,world&perf=1&land=8.223" };
    expect(onInformation(ctx)).toEqual({ reason: "information", target: "constellation", route: "/knowledge?perf=1", lockCourse: "c1", markRecent: "c1", pushAt: "faded", ghost: null });
    expect(onInformation({ ...ctx, activeCourseId: null, defaultCourseId: null }).target).toBeNull();
  });

  it("Courses: world rises to the planet on the land's course; the route drops the land and follows once the clouds have closed", () => {
    const ctx = { ...base, rung: "world" as const, search: "?stage=planet,twin,galaxy,hop,world&perf=1&land=8.223" };
    expect(onCourses(ctx)).toEqual({ reason: "courses", target: "planet", route: "/earth?perf=1", lockCourse: "c1", markRecent: null, pushAt: "faded", ghost: null });
    expect(onCourses({ ...ctx, search: "" }).route).toBe("/earth");
  });

  it("Courses: constellation -> planet locked on its course; galaxy -> most recent; planet -> nothing", () => {
    const ctx = { ...base, rung: "constellation" as const, pathname: "/knowledge", search: "" };
    expect(onCourses(ctx)).toEqual({ reason: "courses", target: "planet", route: "/earth", lockCourse: "c1", markRecent: null, pushAt: "faded", ghost: null });
    expect(onCourses({ ...ctx, rung: "galaxy" })).toMatchObject({ target: "planet", route: "/earth", lockCourse: "c2" });
    expect(onCourses({ ...ctx, rung: "galaxy", mostRecentCourseId: null })).toMatchObject({ lockCourse: "c0" });
    expect(onCourses({ ...ctx, rung: "galaxy", mostRecentCourseId: null, defaultCourseId: null })).toMatchObject({ lockCourse: "c1" });
    expect(onCourses(base).target).toBeNull();
    expect(onCourses({ ...base, rung: "world" })).toMatchObject({ target: "planet", lockCourse: "c1" });
  });

  it("Bead click in the galaxy drops into that course's constellation and makes it recent", () => {
    const ctx = { ...base, rung: "galaxy" as const, pathname: "/knowledge", search: "?stage=hop" };
    expect(onBeadClick(ctx, "c2")).toEqual({ reason: "bead-click", target: "constellation", route: null, lockCourse: "c2", markRecent: "c2", pushAt: "start", ghost: null });
    expect(onBeadClick(ctx, "zz").target).toBeNull();
  });

  it("Land: planet -> that course's world, the land route pushed at the press with the planet chrome ghosted", () => {
    expect(onLand(base, "c1", "8.223")).toEqual({ reason: "land", target: "world", route: "/earth?land=8.223&perf=1", lockCourse: "c1", markRecent: "c1", pushAt: "start", ghost: ".earth-planet-chrome" });
    // The course id is the land key when no code is known; an unknown course or any other rung does nothing.
    expect(onLand({ ...base, search: "" }, "c2").route).toBe("/earth?land=c2");
    expect(onLand(base, "zz", "x").target).toBeNull();
    expect(onLand({ ...base, rung: "constellation" }, "c1", "8.223").target).toBeNull();
    expect(onLand({ ...base, rung: "world" }, "c1", "8.223").target).toBeNull();
  });

  it("carries only the perf and qa params across a push, onto a route with its own query too", () => {
    expect(hopHref("/knowledge", "?stage=hop&land=8.223&rung=galaxy&perf=1&course=x&qa=1")).toBe("/knowledge?perf=1&qa=1");
    expect(hopHref("/earth", "")).toBe("/earth");
    expect(hopHref("/earth?land=8.223", "?perf=1&stage=twin")).toBe("/earth?land=8.223&perf=1");
  });

  it("mirrors the rung into the query at rest and drops it on the planet and the world", () => {
    expect(rungSearch("?perf=1&rung=galaxy", "constellation")).toBe("?perf=1&rung=constellation");
    expect(rungSearch("?perf=1&rung=galaxy", "planet")).toBe("?perf=1");
    expect(rungSearch("?land=8.223&rung=galaxy", "world")).toBe("?land=8.223");
    expect(rungSearch("", "galaxy")).toBe("?rung=galaxy");
    expect(rungSearch("", "planet")).toBe("");
  });

  it("prefetches the next rung's route and layout from the planet, the galaxy from a constellation, nothing at the top", () => {
    expect(prefetchFor("planet")).toEqual([{ kind: "route", href: "/knowledge" }, { kind: "layout" }]);
    expect(prefetchFor("constellation")).toEqual([{ kind: "galaxy" }]);
    expect(prefetchFor("galaxy")).toEqual([]);
  });
});

describe("pull-back pose", () => {
  const seat = { cx: 0.74, cy: 0.58, radiusPx: 430 };

  it("is exactly the seat at L 1 and a centred 3-cell point at L 2", () => {
    const at1 = planetPoseAt(1, seat);
    expect(at1).toMatchObject({ k: 1, radiusPx: 430, cx: 0.74, cy: 0.58, chrome: 1, opacity: 1, centre: 0 });
    const at2 = planetPoseAt(2, seat);
    expect(at2.radiusPx).toBeCloseTo((POINT_CELLS * 2) / 2, 6);
    expect(at2.cx).toBeCloseTo(0.5, 6);
    expect(at2.cy).toBeCloseTo(0.5, 6);
    expect(at2.chrome).toBe(0);
    expect(at2.centre).toBe(1);
    // Beyond the constellation the point stays a point.
    expect(planetPoseAt(2.6, seat).radiusPx).toBeCloseTo(at2.radiusPx, 6);
    expect(planetPoseAt(0.7, seat)).toMatchObject({ k: 1, radiusPx: 430 });
    // On the rise from a world the planet chrome comes in with the seat (gone under the clouds).
    expect(planetPoseAt(0.7, seat).chrome).toBe(0);
    expect(planetPoseAt(0.9, seat).chrome).toBeGreaterThan(0);
    expect(planetPoseAt(0.9, seat).chrome).toBeLessThan(1);
  });

  it("shrinks monotonically on a log scale and centres before the bloom finishes", () => {
    let prev = planetPoseAt(1, seat);
    for (let L = 1.01; L <= 2; L += 0.01) {
      const p = planetPoseAt(L, seat);
      expect(p.radiusPx).toBeLessThan(prev.radiusPx);
      expect(p.centre).toBeGreaterThanOrEqual(prev.centre);
      expect(p.chrome).toBeLessThanOrEqual(prev.chrome);
      prev = p;
    }
    // Constant zoom rate per L: the ratio over equal steps is equal.
    const a = planetPoseAt(1.2, seat).radiusPx / planetPoseAt(1.4, seat).radiusPx;
    const b = planetPoseAt(1.6, seat).radiusPx / planetPoseAt(1.8, seat).radiusPx;
    expect(a).toBeCloseTo(b, 6);
    expect(planetPoseAt(1.75, seat).centre).toBe(1);
    expect(planetPoseAt(CHROME_GONE_L, seat).chrome).toBe(0);
    expect(planetPoseAt(1.2, seat).chrome).toBeGreaterThan(0);
    expect(planetPoseAt(1.2, seat).chrome).toBeLessThan(1);
    expect(pullbackSlope(430)).toBeCloseTo(Math.log10(430 / 3), 6);
  });
});

describe("twin curves and the galaxy hand-off", () => {
  it("blooms with enterFromL and is invisible before the bloom starts", () => {
    expect(twinCurvesAt(1).opacity).toBe(0);
    expect(twinCurvesAt(1.4).opacity).toBe(0);
    expect(twinCurvesAt(1.6).opacity).toBeGreaterThan(0);
    expect(twinCurvesAt(2)).toMatchObject({ enter: 1, condense: 0, opacity: 1, chrome: 1 });
    expect(twinCurvesAt(1.7).enter).toBe(enterFromL(1.7));
  });

  it("condenses with condenseFromL and hands over to the bead at the top", () => {
    expect(twinCurvesAt(2.4).condense).toBe(condenseFromL(2.4));
    expect(twinCurvesAt(2.4).opacity).toBe(1);
    expect(twinCurvesAt(3)).toMatchObject({ condense: 1, opacity: 0, chrome: 0 });
    const h = galaxyHandoffAt(2.6);
    expect(h.galaxy).toBe(altitudeAt(2.6).galaxy);
    expect(h.condense).toBe(condenseFromL(2.6));
    expect(galaxyHandoffAt(2).galaxy).toBe(0);
    expect(galaxyHandoffAt(3)).toMatchObject({ galaxy: 1, ring: 1, condense: 1 });
    // The graph lands on the bead (condense 1 at 2.7) before the ring is full (2.95).
    expect(galaxyHandoffAt(2.7).condense).toBe(1);
    expect(galaxyHandoffAt(2.7).ring).toBeLessThan(1);
  });
});

describe("speed dressing", () => {
  it("is quiet at rest and raises the integer cell size only while fast", () => {
    expect(speedAt(1, 0, 2.15, 2)).toEqual({ rate: 0, streaks: { density: 0, speed: 0.5 }, pixel: 2, direction: 0 });
    const fast = speedAt(1.5, 1.5, 2.15, 2);
    expect(fast.pixel).toBe(3);
    // The warp tunnel streams toward the viewer while climbing and away while descending.
    expect(fast.direction).toBe(1);
    expect(speedAt(1.5, -1.5, 2.15, 2).direction).toBe(-1);
    expect(fast.streaks.density).toBeGreaterThan(0.3);
    expect(Number.isInteger(fast.pixel)).toBe(true);
    // Hysteresis: once at 3 it only drops back below 0.7 decades/s.
    expect(speedAt(1.5, 0.4, 2.15, 3).pixel).toBe(3);
    expect(speedAt(1.5, 0.2, 2.15, 3).pixel).toBe(2);
    // No streaks inside the atmosphere.
    expect(speedAt(0.5, 1.5, 2.15, 2).streaks.density).toBe(0);
  });
});

describe("deferred push", () => {
  it("goes once the planet chrome is gone on the way up, once the twin collapsed on the way down", () => {
    expect(holdDoneAt(1.2, "planet", "constellation")).toBe(false);
    expect(holdDoneAt(1.4, "planet", "constellation")).toBe(true);
    expect(holdDoneAt(1.6, "constellation", "planet")).toBe(false);
    expect(holdDoneAt(1.39, "constellation", "planet")).toBe(true);
    expect(holdDoneAt(2.5, "constellation", "galaxy")).toBe(true);
  });

  it("from a world it goes once the clouds have closed over the land, whichever rung is next", () => {
    expect(holdDoneAt(0.5, "world", "constellation")).toBe(false);
    expect(holdDoneAt(0.5, "world", "planet")).toBe(false);
    expect(holdDoneAt(WORLD_RISE.worldGone, "world", "constellation")).toBe(true);
    expect(holdDoneAt(WORLD_RISE.worldGone, "world", "planet")).toBe(true);
    expect(worldPassFadeAt(WORLD_RISE.worldGone)).toBe(0);
  });
});

describe("world segment (the merged rise)", () => {
  it("is the identity at both rungs: nothing changes at rest on the world or on the planet", () => {
    expect(worldRiseAt(0)).toMatchObject({ rise: 0, clouds: 0, world: 1, planet: 0, landChrome: 1, approach: 0 });
    expect(worldRiseAt(1)).toMatchObject({ rise: 1, clouds: 0, world: 0, planet: 1, landChrome: 0, approach: 1 });
    expect(worldRiseAt(2)).toMatchObject({ clouds: 0, world: 0, planet: 1, approach: 1 });
  });

  it("the cloud deck is whole while the world goes out and the planet comes in (the mask hides the swap)", () => {
    expect(cloudDeckAt(0.5)).toBe(1);
    expect(cloudDeckAt(0.68)).toBe(1);
    expect(cloudDeckAt(0.3)).toBeGreaterThan(0);
    expect(cloudDeckAt(0.9)).toBe(0);
    for (let L = 0; L <= 1; L += 0.004) {
      const r = worldRiseAt(L);
      const swapping = r.world < 1 && r.planet > 0;
      const mixed = (r.world > 0 && r.world < 1) || (r.planet > 0 && r.planet < 1) || swapping && r.world > 0;
      if (mixed) expect(r.clouds, `L ${L.toFixed(3)}`).toBe(1);
      // Never land and globe together in the clear.
      if (r.clouds < 1) expect(Math.min(r.world, r.planet), `L ${L.toFixed(3)}`).toBe(0);
    }
  });

  it("orders the beats: chrome gone, clouds in, world out by 0.68 under the deck, planet in, clouds clear, seat by 1", () => {
    expect(worldRiseAt(WORLD_RISE.chromeGone).landChrome).toBe(0);
    expect(worldRiseAt(0.15).landChrome).toBeGreaterThan(0);
    expect(worldRiseAt(0.15).clouds).toBe(0);
    expect(worldRiseAt(0.75).world).toBe(0);
    expect(worldRiseAt(0.75).planet).toBe(1);
    expect(worldRiseAt(0.75).clouds).toBeGreaterThan(0);
    expect(worldRiseAt(0.75).approach).toBeGreaterThan(0);
    expect(worldRiseAt(0.75).approach).toBeLessThan(1);
    expect(worldRiseAt(WORLD_RISE.riseDone).rise).toBe(1);
    // Monotone in L.
    let prev = worldRiseAt(0);
    for (let L = 0.01; L <= 1; L += 0.01) {
      const r = worldRiseAt(L);
      expect(r.rise).toBeGreaterThanOrEqual(prev.rise);
      expect(r.world).toBeLessThanOrEqual(prev.world);
      expect(r.planet).toBeGreaterThanOrEqual(prev.planet);
      expect(r.landChrome).toBeLessThanOrEqual(prev.landChrome);
      expect(r.approach).toBeGreaterThanOrEqual(prev.approach);
      prev = r;
    }
  });

  it("the merged rise is one spring request: the chain never rests on the planet on its way to the constellation", () => {
    const director = createDirector("world");
    const rests: string[] = [];
    director.onRest((rung) => rests.push(rung));
    const effects = { push: vi.fn(), replaceSearch: vi.fn(), lockCourse: vi.fn(), markRecent: vi.fn(), prefetchRoute: vi.fn(), warmLayout: vi.fn(), ghost: vi.fn(() => () => {}) };
    const runtime = createHopRuntime(director, effects);
    const plan = onInformation({ ...base, rung: "world", pathname: "/earth", search: "?land=8.223&stage=hop" });
    expect(runtime.run(plan)).toBe(true);
    expect(effects.push).not.toHaveBeenCalled();
    expect(runtime.flight).toMatchObject({ from: "world", to: "constellation", pendingRoute: "/knowledge", holding: false });
    let passedPlanet = false;
    for (let t = 0; t < 6 && director.sample().moving; t += 1 / 120) {
      const s = director.step(1 / 120);
      runtime.state.L = s.L;
      runtime.tick();
      if (Math.abs(s.L - 1) < 0.02) passedPlanet = true;
      // The route goes once the land is under the clouds, not before.
      if (s.L < WORLD_RISE.worldGone) expect(effects.push).not.toHaveBeenCalled();
    }
    expect(passedPlanet).toBe(true);
    expect(director.sample()).toMatchObject({ L: 2, rung: "constellation", moving: false });
    expect(rests).toEqual(["constellation"]);
    expect(effects.push).toHaveBeenCalledTimes(1);
    expect(effects.push).toHaveBeenCalledWith("/knowledge");
    expect(runtime.flight).toBeNull();
  });
});

const effectsOf = () => ({ push: vi.fn<(href: string) => void>(), replaceSearch: vi.fn<(search: string) => void>(), lockCourse: vi.fn<(id: string) => void>(), markRecent: vi.fn<(id: string) => void>(), prefetchRoute: vi.fn<(href: string) => void>(), warmLayout: vi.fn<() => void>(), ghost: vi.fn<(selector: string) => () => void>(() => () => {}) }) satisfies HopEffects;

describe("the cloud dive (planet -> world)", () => {
  it("is the rise read backwards: the same curves of L mask the swap under the whole deck both ways", () => {
    // `worldRiseAt` is a function of L alone, so a dive sample at L equals the rise sample at L.
    for (let L = 0; L <= 1; L += 0.02) {
      const down = worldRiseAt(L);
      const up = worldRiseAt(L);
      expect(down).toEqual(up);
    }
    // Reading the dive top-down: planet whole and no clouds at the seat, deck closing by 0.68, the globe out and
    // the land in under the whole deck, the deck clearing by 0.28, the land whole and the chrome back by 0.
    expect(worldRiseAt(1)).toMatchObject({ clouds: 0, planet: 1, world: 0, landChrome: 0 });
    expect(worldRiseAt(0.68)).toMatchObject({ clouds: 1, planet: 1, world: 0 });
    expect(worldRiseAt(0.5)).toMatchObject({ clouds: 1, planet: 0, world: 1 });
    expect(worldRiseAt(0.28).clouds).toBe(0);
    expect(worldRiseAt(0)).toMatchObject({ clouds: 0, planet: 0, world: 1, landChrome: 1, rise: 0 });
    // The hold altitude sits inside the whole deck with the land drawn (compiling) under it.
    expect(cloudDeckAt(CLOUD_HOLD.L)).toBe(1);
    expect(cloudDeckAt(CLOUD_HOLD.trigger)).toBe(1);
    expect(worldPassFadeAt(CLOUD_HOLD.L)).toBeGreaterThan(0);
    expect(cloudDeckAt(CLOUD_HOLD.L - 0.06)).toBe(1);
  });

  it("holds inside the deck only on the way to a world that is not ready", () => {
    expect(diveMustHold(0.9, "world", false)).toBe(false);
    expect(diveMustHold(0.7, "world", false)).toBe(false);
    expect(diveMustHold(CLOUD_HOLD.trigger, "world", false)).toBe(true);
    expect(CLOUD_HOLD.trigger).toBe(WORLD_RISE.cloudsThin);
    expect(diveMustHold(0.5, "world", false)).toBe(true);
    expect(diveMustHold(0.5, "world", true)).toBe(false);
    expect(diveMustHold(0.5, "planet", false)).toBe(false);
    expect(diveMustHold(0.5, "constellation", false)).toBe(false);
  });

  it("runs as one request from the planet: the land route goes at the press, the camera parks in the clouds until the land draws, then breaks out onto the island", () => {
    const director = createDirector("planet");
    const effects = effectsOf();
    const runtime = createHopRuntime(director, effects);
    const rests: string[] = [];
    director.onRest((rung) => rests.push(rung));
    expect(runtime.run(onLand({ ...base, search: "" }, "c1", "8.223"))).toBe(true);
    expect(effects.push).toHaveBeenCalledWith("/earth?land=8.223");
    expect(effects.lockCourse).toHaveBeenCalledWith("c1");
    expect(effects.ghost).toHaveBeenCalledWith(".earth-planet-chrome");
    expect(runtime.flight).toMatchObject({ from: "planet", to: "world", reason: "land", holding: false });
    const step = () => {
      const s = director.step(1 / 120);
      runtime.state.L = s.L;
      runtime.state.pose = planetPoseAt(s.L, { cx: 0.74, cy: 0.58, radiusPx: 430 });
      runtime.tick();
      return s;
    };
    // The land never reports ready: the camera parks inside the deck and stays there.
    let minL = 1;
    for (let t = 0; t < 4; t += 1 / 120) minL = Math.min(minL, step().L);
    expect(runtime.flight?.holding).toBe(true);
    expect(director.sample()).toMatchObject({ moving: true, held: true, target: "world" });
    expect(Math.abs(director.sample().L - CLOUD_HOLD.L)).toBeLessThan(0.01);
    // The dip past the hold altitude stays inside the whole deck: no frame shows the land in the clear.
    expect(cloudDeckAt(minL)).toBe(1);
    expect(rests).toEqual([]);
    // The land draws: the dive resumes and rests on the world.
    director.readiness.set("world", true);
    for (let t = 0; t < 4 && director.sample().moving; t += 1 / 120) step();
    expect(runtime.flight).toBeNull();
    expect(director.sample()).toMatchObject({ L: 0, rung: "world", moving: false, held: false });
    expect(rests).toEqual(["world"]);
    expect(effects.markRecent).toHaveBeenCalledWith("c1");
  });

  it("never holds when the land is ready before the camera reaches the deck", () => {
    const director = createDirector("planet");
    const runtime = createHopRuntime(director, effectsOf());
    director.readiness.set("world", true);
    runtime.run(onLand({ ...base, search: "" }, "c1", "8.223"));
    let held = false;
    for (let t = 0; t < 4 && director.sample().moving; t += 1 / 120) {
      const s = director.step(1 / 120);
      runtime.state.L = s.L;
      runtime.tick();
      held = held || s.held;
    }
    expect(held).toBe(false);
    expect(director.sample()).toMatchObject({ L: 0, rung: "world", moving: false });
  });

  it("Escape mid-dive turns it into the rise: Courses from the (target) world rung releases the hold", () => {
    const director = createDirector("planet");
    const runtime = createHopRuntime(director, effectsOf());
    runtime.run(onLand({ ...base, search: "" }, "c1", "8.223"));
    for (let t = 0; t < 2; t += 1 / 120) {
      runtime.state.L = director.step(1 / 120).L;
      runtime.tick();
    }
    expect(director.sample().held).toBe(true);
    expect(runtime.run(onCourses({ ...base, rung: "world", search: "?land=8.223" }))).toBe(true);
    expect(director.sample()).toMatchObject({ held: false, target: "planet", moving: true });
    for (let t = 0; t < 4 && director.sample().moving; t += 1 / 120) {
      runtime.state.L = director.step(1 / 120).L;
      runtime.tick();
    }
    expect(director.sample()).toMatchObject({ L: 1, rung: "planet", moving: false });
  });
});

describe("reduced motion: the crossfade at rest poses", () => {
  it("names each rung's whole layer at rest", () => {
    expect(restFadesAt("world")).toEqual({ world: 1, planet: 0, twin: 0 });
    expect(restFadesAt("planet")).toEqual({ world: 0, planet: 1, twin: 0 });
    expect(restFadesAt("constellation")).toEqual({ world: 0, planet: 0, twin: 1 });
    expect(restFadesAt("galaxy")).toEqual({ world: 0, planet: 0, twin: 0 });
  });

  it("crossfades the leaving and arriving layers along the tween, both ways, and is the identity at rest", () => {
    expect(reducedHopAt(1, "planet", "constellation")).toEqual({ x: 0, world: 0, planet: 1, twin: 0 });
    expect(reducedHopAt(1.5, "planet", "constellation")).toEqual({ x: 0.5, world: 0, planet: 0.5, twin: 0.5 });
    expect(reducedHopAt(2, "planet", "constellation")).toEqual({ x: 1, world: 0, planet: 0, twin: 1 });
    expect(reducedHopAt(1.5, "constellation", "planet")).toEqual({ x: 0.5, world: 0, planet: 0.5, twin: 0.5 });
    expect(reducedHopAt(0.25, "planet", "world")).toMatchObject({ x: 0.75, world: 0.75, planet: 0.25 });
    expect(reducedHopAt(0.25, "world", "constellation")).toMatchObject({ x: 0.125, world: 0.875, twin: 0.125 });
    expect(reducedHopAt(3, "galaxy", "galaxy")).toEqual({ x: 1, world: 0, planet: 0, twin: 0 });
    expect(reducedHopAt(2, "constellation", "constellation")).toEqual({ x: 1, world: 0, planet: 0, twin: 1 });
    // A land that has not drawn yet stays at 0: the planet fades to the sky, never a half-loaded land.
    expect(reducedHopAt(0.25, "planet", "world", false)).toMatchObject({ world: 0, planet: 0.25 });
  });

  it("the director tweens L linearly over REDUCED_HOP_MS instead of running the spring, and still rests on the rung", () => {
    const director = createDirector("planet");
    director.setReducedMotion(true);
    const rests: string[] = [];
    director.onRest((rung) => rests.push(rung));
    director.request("constellation");
    expect(director.sample().moving).toBe(true);
    director.step(REDUCED_HOP_MS / 2000);
    expect(director.sample().L).toBeCloseTo(1.5, 6);
    director.step(REDUCED_HOP_MS / 2000);
    expect(director.sample()).toMatchObject({ L: 2, rung: "constellation", moving: false });
    expect(rests).toEqual(["constellation"]);
    // Down is the same length (no return factor), and a hold tweens to its altitude too.
    director.request("world");
    director.step(0.1);
    expect(director.sample().L).toBeCloseTo(1, 6);
    director.hold(CLOUD_HOLD.L, "world");
    director.step(1);
    expect(director.sample()).toMatchObject({ L: CLOUD_HOLD.L, held: true, moving: true, target: "world" });
    expect(rests).toEqual(["constellation"]);
  });

  it("the runtime pushes a deferred route only at rest under reduced motion (no deck to hide the swap)", () => {
    const director = createDirector("world");
    director.setReducedMotion(true);
    const effects = effectsOf();
    const runtime = createHopRuntime(director, effects);
    runtime.run(onCourses({ ...base, rung: "world", search: "?land=8.223" }));
    for (let t = 0; t < 0.15; t += 1 / 120) {
      runtime.state.L = director.step(1 / 120).L;
      runtime.tick();
      expect(effects.push).not.toHaveBeenCalled();
    }
    for (let t = 0; t < 0.2 && director.sample().moving; t += 1 / 120) {
      runtime.state.L = director.step(1 / 120).L;
      runtime.tick();
    }
    expect(director.sample()).toMatchObject({ L: 1, rung: "planet", moving: false });
    expect(effects.push).toHaveBeenCalledTimes(1);
    expect(effects.push).toHaveBeenCalledWith("/earth");
  });
});
