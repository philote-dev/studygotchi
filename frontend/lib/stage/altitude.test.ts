import { describe, expect, it } from "vitest";
import {
  CLUSTER_SCALE,
  DEFAULT_CAMERA_CONTEXT,
  DEFAULT_GALAXY_CENTER,
  GALAXY_ARRIVAL_DISTANCE,
  GALAXY_SCALE,
  GALAXY_WORLD_RADIUS,
  KEY_L,
  SEAT_DIR,
  WORLD_SCALE,
  altitudeAt,
  cameraAt,
  distanceAt,
  layerAtL,
  pixelFor,
  streaksFor,
  worldToPlanet,
  zoomRate,
  zoomSlopeAt,
  type Altitude,
} from "./altitude";
import { CLUSTER, PLANET, REST, SPACE, WORLD } from "./geometry";

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const finite = (v: number) => Number.isFinite(v) && !Number.isNaN(v);

/* Ported from the space lab's stage2.test.ts (scale, camera path and altitude bands). */

describe("stage true relative scale", () => {
  it("nests the four layers so the old match-cut sizes coincide in one frame", () => {
    // The world's dive pose (5.2x above arrival) lands at the planet's dive altitude.
    const worldArrival = Math.hypot(...WORLD.arrival.position.map((v, i) => v - WORLD.arrival.target[i]));
    expect(worldArrival * WORLD.diveFactor * WORLD_SCALE).toBeCloseTo(0.55, 9);
    // The cluster's core star is the planet; an arm bead is the whole cluster.
    expect(CLUSTER.coreRadius * CLUSTER_SCALE).toBeCloseTo(PLANET.radius, 9);
    expect(SPACE.beadRadius * GALAXY_SCALE).toBeCloseTo(CLUSTER.radius * CLUSTER_SCALE, 9);
    expect(GALAXY_WORLD_RADIUS).toBeCloseTo(3000, 6);
    // The world's ground sits on the sphere at the marker.
    expect(Math.hypot(...worldToPlanet([0, 0, 0]))).toBeCloseTo(1, 9);
    expect(Math.hypot(...worldToPlanet([16, 0, 0]))).toBeGreaterThan(1);
    expect(Math.hypot(...worldToPlanet([16, 0, 0])) - 1).toBeLessThan(0.002);
  });
});

describe("stage camera path", () => {
  it("rests at the old poses: the seat at L = 1, the cluster rest at L = 2, the galaxy arrival at L = 3", () => {
    const seat = cameraAt(1);
    expect(dist(seat.position, REST.planet.position)).toBeLessThan(1e-6);
    expect(seat.fov).toBeCloseTo(REST.planet.fov, 6);
    const cl = cameraAt(2);
    expect(cl.distance).toBeCloseTo(CLUSTER.restDistance * CLUSTER_SCALE, 6);
    expect(dist(cl.position, SEAT_DIR.map((v) => v * cl.distance))).toBeLessThan(1e-6);
    expect(cl.fov).toBeCloseTo(CLUSTER.restFov, 6);
    const g = cameraAt(3);
    expect(dist(g.target, DEFAULT_GALAXY_CENTER)).toBeLessThan(1e-6);
    expect(g.distance).toBeCloseTo(GALAXY_ARRIVAL_DISTANCE, 6);
    expect(g.fov).toBe(34);
  });

  it("moves the camera monotonically outward in log distance and keeps the FOV in range", () => {
    let last = distanceAt(0);
    for (let L = 0; L <= 3; L += 0.0025) {
      const d = distanceAt(L);
      expect(d, `L=${L}`).toBeGreaterThanOrEqual(last - 1e-9);
      last = d;
      const c = cameraAt(L);
      expect(c.fov).toBeGreaterThanOrEqual(20);
      expect(c.fov).toBeLessThanOrEqual(40);
      expect(c.near).toBeGreaterThan(0);
      expect(c.far).toBeGreaterThan(c.near * 100);
      for (const v of [...c.position, ...c.target, c.fov, c.distance]) expect(finite(v)).toBe(true);
    }
    expect(distanceAt(3) / distanceAt(0)).toBeGreaterThan(1e4);
  });

  it("is C1 in L: position, fov and zoom slope have no kinks at any stop or threshold", () => {
    const e = 1e-4;
    for (const Lk of KEY_L) {
      if (Lk <= 0 || Lk >= 3) continue;
      const a = cameraAt(Lk - e);
      const k = cameraAt(Lk);
      const c = cameraAt(Lk + e);
      // One-sided derivatives at the knot agree (a true kink would differ by O(1), curvature only by O(e)).
      const vl = dist(k.position, a.position) / e;
      const vr = dist(c.position, k.position) / e;
      const ref = Math.max(vl, vr, 1e-6);
      expect(Math.abs(vl - vr) / ref, `position kink at L=${Lk}`).toBeLessThan(0.02);
      const fl = (k.fov - a.fov) / e;
      const fr = (c.fov - k.fov) / e;
      expect(Math.abs(fl - fr), `fov kink at L=${Lk}`).toBeLessThan(0.05);
      expect(Math.abs(zoomSlopeAt(Lk - e) - zoomSlopeAt(Lk + e)), `zoom kink at L=${Lk}`).toBeLessThan(0.02);
    }
    // Continuity everywhere: a 2e-3 step in L never moves the camera by more than ~1.5 % of its distance.
    for (let L = 0.001; L < 3; L += 0.0137) {
      const a = cameraAt(L - 1e-3);
      const b = cameraAt(L + 1e-3);
      expect(dist(a.position, b.position) / a.distance, `jump at L=${L}`).toBeLessThan(0.015);
    }
  });

  it("looks at the ground, then the marker, then the planet / cluster origin, then the galaxy centre", () => {
    expect(dist(cameraAt(0).target, worldToPlanet(WORLD.arrival.target))).toBeLessThan(1e-9);
    expect(dist(cameraAt(0.5).target, PLANET.marker.map((v) => v * PLANET.radius))).toBeLessThan(1e-9);
    for (const L of [1, 1.5, 2, 2.5]) expect(dist(cameraAt(L).target, [0, 0, 0]), `L=${L}`).toBeLessThan(1e-9);
    const ctx = { galaxyCenter: [-1200, 300, -900] as const };
    expect(dist(cameraAt(3, ctx).target, ctx.galaxyCenter)).toBeLessThan(1e-9);
    expect(dist(cameraAt(2.5, ctx).target, [0, 0, 0])).toBeLessThan(1e-9);
    void DEFAULT_CAMERA_CONTEXT;
  });
});

const FIELDS = Object.keys(altitudeAt(1)).filter((k) => k !== "L") as (keyof Altitude)[];

describe("stage altitude bands", () => {
  it("keeps every band in range, finite and continuous through every stop", () => {
    let prev = altitudeAt(-0.1);
    for (let L = -0.1; L <= 3.1; L += 0.001) {
      const a = altitudeAt(L);
      for (const k of FIELDS) {
        const v = a[k];
        expect(finite(v), `${k} at ${L}`).toBe(true);
        expect(v, `${k} at ${L}`).toBeGreaterThanOrEqual(0);
        expect(v, `${k} at ${L}`).toBeLessThanOrEqual(1 + 1e-9);
        expect(Math.abs(v - prev[k]), `${k} jumps at ${L}`).toBeLessThan(0.012);
      }
      prev = a;
    }
  });

  it("shows exactly the resting layer at each stop", () => {
    const w = altitudeAt(0);
    expect(w.worldProps).toBe(1);
    expect(w.worldGround).toBe(1);
    expect(w.markerPin).toBe(0);
    expect(w.markerScale).toBeCloseTo(0.26, 6);
    expect(w.coreBright + w.clusterStars + w.galaxy + w.puffs).toBe(0);
    const p = altitudeAt(1);
    expect(p.worldProps).toBe(0);
    expect(p.markerScale).toBe(1);
    expect(p.markerPin).toBe(1);
    expect(p.planetFeatures).toBe(1);
    expect(p.planetTint).toBe(0);
    expect(p.coreBright + p.clusterStars + p.clusterLines + p.galaxy + p.beads + p.puffs).toBe(0);
    const c = altitudeAt(2);
    expect(c.coreBright).toBe(1);
    expect(c.clusterStars).toBe(1);
    expect(c.clusterPop).toBe(1);
    expect(c.clusterLines).toBe(1);
    expect(c.planetFeatures).toBe(0);
    expect(c.planetTint).toBe(1);
    expect(c.markerOpacity).toBe(0);
    expect(c.galaxy + c.beads + c.ring).toBe(0);
    const g = altitudeAt(3);
    expect(g.galaxy).toBe(1);
    expect(g.beads).toBe(1);
    expect(g.ring).toBe(1);
    expect(g.coreBright + g.clusterStars + g.clusterLines).toBe(0);
  });

  it("hands each continuity object over before the other side is gone (planet -> core star, core star -> arm bead)", () => {
    // Planet tint reaches the core's cream no later than the core sprite is fully bright.
    for (let L = 1.5; L <= 2; L += 0.01) expect(altitudeAt(L).planetTint).toBeGreaterThanOrEqual(altitudeAt(L).coreBright - 1e-9);
    // While the core fades out the arm bead is already in: something 3 cells wide is always drawn at the origin.
    for (let L = 2.3; L <= 2.8; L += 0.01) expect(altitudeAt(L).coreBright + altitudeAt(L).beads, `L=${L}`).toBeGreaterThanOrEqual(0.98);
    // The marker shrinks into the ground while the props are still fading in on the way down.
    expect(altitudeAt(0.5).markerFlat).toBe(1);
    expect(altitudeAt(0.5).markerPin).toBe(0);
    expect(altitudeAt(0.8).worldProps).toBeGreaterThan(0);
    expect(altitudeAt(0.8).worldClouds).toBe(0);
    expect(altitudeAt(0.8).markerScale).toBeLessThan(1);
    // Cloud puffs peak at the deck and are gone at both stops.
    expect(altitudeAt(0.5).puffs).toBe(1);
    expect(altitudeAt(0).puffs).toBe(0);
    expect(altitudeAt(1).puffs).toBe(0);
    expect(layerAtL(1.4)).toBe("planet");
    expect(layerAtL(1.6)).toBe("cluster");
  });

  it("drives the streak tunnel and the pixel size from speed only (integer, with hysteresis)", () => {
    expect(streaksFor(0).density).toBe(0);
    expect(streaksFor(2).density).toBeGreaterThan(0.25);
    expect(streaksFor(-2).density).toBe(streaksFor(2).density);
    expect(pixelFor(0, 2)).toBe(2);
    expect(pixelFor(1.5, 2)).toBe(3);
    expect(pixelFor(1.0, 3)).toBe(3);
    expect(pixelFor(0.5, 3)).toBe(2);
    expect(Number.isInteger(pixelFor(1.3, 2))).toBe(true);
    expect(zoomRate(1.5, 1)).toBeCloseTo(zoomSlopeAt(1.5), 9);
    expect(zoomSlopeAt(1.5)).toBeGreaterThan(0);
  });
});
