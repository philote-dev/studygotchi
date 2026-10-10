import { describe, expect, it } from "vitest";
import { ICE_TOWN_LAYOUT, type IceDistrictKind } from "../layout/biome-layout";
import { buildColliderSet, penetrationDepth } from "../../collision/colliders";
import { iceLandColliders } from "../../collision/ice-town-footprints";
import {
  ICE_LAND_SCALE,
  LANDMARK_FOOTPRINT_M,
  PARADE_CLEARANCE_M,
  WALKER_DISTRICTS,
  WALKER_RADIUS_M,
  createWalkers,
  isParadeLand,
  paradeAnchor,
  paradePoint,
  paradeRadius,
  stepWalkers,
  walkerRadius,
} from "./parade";

const DISTRICTS: IceDistrictKind[] = ["harbour", "town", "lake", "forest", "glacier", "station"];

describe("ice landmark parades", () => {
  it("sends walkers to every district and rings them outside the landmark footprint", () => {
    expect(new Set(WALKER_DISTRICTS)).toEqual(new Set(DISTRICTS));
    for (const id of DISTRICTS) {
      expect(paradeRadius(id)).toBe(LANDMARK_FOOTPRINT_M[id] + PARADE_CLEARANCE_M);
      expect(paradeRadius(id)).toBeGreaterThan(LANDMARK_FOOTPRINT_M[id] + 4);
    }
  });

  it("keeps parade samples outside the building, on land", () => {
    for (const id of DISTRICTS) {
      const [ax, az] = paradeAnchor(ICE_TOWN_LAYOUT, id);
      const minDist = LANDMARK_FOOTPRINT_M[id] + 3.5;
      for (let i = 0; i < 8; i++) {
        const point = paradePoint(ICE_TOWN_LAYOUT, id, (i / 8) * Math.PI * 2);
        const dist = Math.hypot(point.x - ax, point.z - az);
        expect(dist).toBeGreaterThan(minDist);
      }
    }
  });
});

describe("walker bodies", () => {
  it("derives a ~0.9 m body radius from the land's creature scale", () => {
    expect(walkerRadius(ICE_LAND_SCALE)).toBeCloseTo(WALKER_RADIUS_M, 9);
    expect(WALKER_RADIUS_M).toBeGreaterThan(0.8);
    expect(WALKER_RADIUS_M).toBeLessThan(1.0);
  });
});

describe("walkers against the land's colliders", () => {
  const FULL = Object.fromEntries(ICE_TOWN_LAYOUT.districts.map((district) => [district.id, 1]));
  const SEED = 7;
  const HZ = 60;
  const SECONDS = 60;

  function simulate() {
    const set = buildColliderSet(iceLandColliders(ICE_TOWN_LAYOUT, SEED, FULL), 4);
    const walkers = createWalkers(ICE_TOWN_LAYOUT, set);
    let worst = 0;
    let stalled = 0;
    const samples: number[][] = [];
    for (let step = 0; step < HZ * SECONDS; step++) {
      stepWalkers(ICE_TOWN_LAYOUT, walkers, set, 1 / HZ);
      for (const walker of walkers) {
        worst = Math.max(worst, penetrationDepth(set, walker.x, walker.z, walker.r));
        stalled = Math.max(stalled, walker.stall);
        expect(isParadeLand(ICE_TOWN_LAYOUT, walker.x, walker.z)).toBe(true);
      }
      if (step % 300 === 0) samples.push(walkers.flatMap((walker) => [walker.x, walker.z]));
    }
    return { set, walkers, worst, stalled, samples };
  }

  it("registers the real land: hundreds of colliders from every source", () => {
    const items = iceLandColliders(ICE_TOWN_LAYOUT, SEED, FULL);
    const tags = new Set(items.map((item) => item.tag));
    expect(items.length).toBeGreaterThan(300);
    for (const tag of ["building", "anchor", "prop", "dock", "landmark", "forest", "scatter", "landform"]) {
      expect(tags, tag).toContain(tag);
    }
    for (const item of items) {
      expect(Number.isFinite(item.x) && Number.isFinite(item.z)).toBe(true);
      if (item.kind === "circle") expect(item.r).toBeGreaterThan(0);
      else expect(item.hx > 0 && item.hz > 0).toBe(true);
    }
  });

  it("never penetrates a collider, keeps every walker moving, and ends with no overlaps", () => {
    const { walkers, worst, stalled } = simulate();
    expect(walkers).toHaveLength(WALKER_DISTRICTS.length);
    expect(worst).toBeLessThan(1e-3);
    expect(stalled).toBeLessThan(2);
    for (const walker of walkers) expect(walker.travelled, `walker ${walker.index}`).toBeGreaterThanOrEqual(15);
    for (let i = 0; i < walkers.length; i++) {
      for (let j = i + 1; j < walkers.length; j++) {
        const d = Math.hypot(walkers[i].x - walkers[j].x, walkers[i].z - walkers[j].z);
        expect(d).toBeGreaterThanOrEqual(walkers[i].r + walkers[j].r - 1e-3);
      }
    }
  });

  it("runs the partial cast (4 walkers at 50 %) clean as well", () => {
    const HALF = Object.fromEntries(ICE_TOWN_LAYOUT.districts.map((district) => [district.id, 0.5]));
    const set = buildColliderSet(iceLandColliders(ICE_TOWN_LAYOUT, SEED, HALF), 4);
    const walkers = createWalkers(ICE_TOWN_LAYOUT, set, WALKER_DISTRICTS, 4);
    expect(walkers).toHaveLength(4);
    let worst = 0;
    for (let step = 0; step < HZ * 30; step++) {
      stepWalkers(ICE_TOWN_LAYOUT, walkers, set, 1 / HZ);
      for (const walker of walkers) worst = Math.max(worst, penetrationDepth(set, walker.x, walker.z, walker.r));
    }
    expect(worst).toBeLessThan(1e-3);
    for (const walker of walkers) expect(walker.travelled).toBeGreaterThanOrEqual(15);
  });

  it("is deterministic across two runs", () => {
    const a = simulate();
    const b = simulate();
    expect(a.samples).toEqual(b.samples);
    expect(a.walkers.map((walker) => [walker.x, walker.z, walker.heading])).toEqual(
      b.walkers.map((walker) => [walker.x, walker.z, walker.heading]),
    );
  });
});
