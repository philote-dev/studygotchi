import { describe, expect, it } from "vitest";
import { GLOBE_FOCUS_DIRECTION, seatedCameraPosition } from "@/components/world/globe/globe-seat";
import { BACKDROP_SAFE_AREAS, boxesOverlap, seedFromStudent } from "./placement";
import {
  PLANET_SCENERY_LIMITS,
  boxClearance,
  cameraFrame,
  discBox,
  moonPosition,
  placePlanetScenery,
  projectCamera,
  sceneryClearance,
  sceneryFade,
  toCamera,
  toWorld,
  unprojectCamera,
  type PlanetSceneryInput,
} from "./planet-scenery";

const GLOBE_RADIUS = 4.55;
const GLOBE_CENTER = [0, -0.7, 0] as const;
const FOV = 26;

function inputFor(seed: number, width: number, height: number): PlanetSceneryInput {
  const seat = seatedCameraPosition({ width, height }, FOV, GLOBE_RADIUS);
  return {
    seed,
    eye: seat.position,
    lookAt: seat.lookAt,
    fovDeg: FOV,
    aspect: width / height,
    globeCenter: GLOBE_CENTER,
    globeRadius: GLOBE_RADIUS,
    landmarkDir: GLOBE_FOCUS_DIRECTION,
  };
}

const VIEWPORTS: [number, number][] = [
  [1440, 900],
  [1920, 1080],
  [1280, 800],
  [1680, 1050],
];
const SEEDS = Array.from({ length: 40 }, (_, i) => seedFromStudent(`student-${i}`));

describe("camera frame", () => {
  it("round-trips world <-> camera space and projects the seat anchor where the globe is seated", () => {
    const input = inputFor(1, 1440, 900);
    const f = cameraFrame(input.eye, input.lookAt, FOV, input.aspect);
    const p = [1.2, -0.3, 2.5] as const;
    const back = toWorld(f, toCamera(f, p));
    expect(back[0]).toBeCloseTo(p[0], 9);
    expect(back[1]).toBeCloseTo(p[1], 9);
    expect(back[2]).toBeCloseTo(p[2], 9);
    // The look-at point projects to the frame centre.
    const centre = projectCamera(f, toCamera(f, input.lookAt))!;
    expect(centre.u).toBeCloseTo(0.5, 6);
    expect(centre.v).toBeCloseTo(0.5, 6);
    // The globe sits where the seat anchors it (0.74, 0.58), give or take the perspective of the pitch.
    const g = projectCamera(f, toCamera(f, GLOBE_CENTER))!;
    expect(g.u).toBeGreaterThan(0.68);
    expect(g.u).toBeLessThan(0.78);
    expect(g.v).toBeGreaterThan(0.5);
    expect(g.v).toBeLessThan(0.64);
    const un = unprojectCamera(f, g.u, g.v, g.depth);
    const gc = toCamera(f, GLOBE_CENTER);
    expect(un[0]).toBeCloseTo(gc[0], 6);
    expect(un[1]).toBeCloseTo(gc[1], 6);
    expect(un[2]).toBeCloseTo(gc[2], 6);
    expect(projectCamera(f, [0, 0, 1])).toBeNull();
  });
});

describe("keep-outs", () => {
  const s = placePlanetScenery(inputFor(SEEDS[0], 1440, 900));
  const view = s.view;

  it("measures box clearance as a gap when apart and a penetration when overlapping", () => {
    const a = discBox(0.5, 0.5, 0.05, 1.6);
    expect(boxClearance(a, { x0: 0.7, y0: 0.4, x1: 0.9, y1: 0.6 }, 1.6)).toBeCloseTo((0.7 - a.x1) * 1.6, 9);
    expect(boxClearance(a, { x0: 0.4, y0: 0.6, x1: 0.6, y1: 0.8 }, 1.6)).toBeCloseTo(0.6 - a.y1, 9);
    expect(boxClearance(a, { x0: 0.45, y0: 0.45, x1: 0.55, y1: 0.55 }, 1.6)).toBeLessThan(0);
  });

  it("hides a moon on the active landmark, on the globe's face in front of it, and under the flag panel", () => {
    expect(sceneryFade(view, view.seat.u, view.seat.v, 0.03, true)).toBe(0);
    expect(sceneryFade(view, view.globe.u, view.globe.v - view.globe.radius * 0.5, 0.03, true)).toBe(0);
    // The same spot behind the globe is not a face crossing (the depth buffer hides it where it should).
    expect(sceneryClearance(view, view.globe.u, view.globe.v + view.globe.radius * 0.95, 0.03, false)).toBeGreaterThan(
      sceneryClearance(view, view.globe.u, view.globe.v + view.globe.radius * 0.95, 0.03, true),
    );
    expect(sceneryFade(view, 0.15, 0.5, 0.03, false)).toBe(0);
    expect(sceneryFade(view, 0.5, 0.05, 0.03, false)).toBe(0);
    // Open sky left of the globe is fully shown.
    expect(sceneryFade(view, 0.36, 0.45, 0.03, false)).toBe(1);
    // The ramp is continuous: a sweep from the panel into the sky never jumps.
    let prev = 0;
    for (let u = 0.3; u <= 0.4; u += 0.002) {
      const f = sceneryFade(view, u, 0.45, 0.03, false);
      expect(f).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(f - prev).toBeLessThan(0.2);
      prev = f;
    }
    expect(prev).toBe(1);
  });
});

describe("planet scenery placement", () => {
  it("is deterministic per seed and differs between students", () => {
    const a = placePlanetScenery(inputFor(SEEDS[0], 1440, 900));
    const b = placePlanetScenery(inputFor(SEEDS[0], 1440, 900));
    const c = placePlanetScenery(inputFor(SEEDS[1], 1440, 900));
    expect(a).toEqual(b);
    expect(a.moons.map((m) => m.phase)).not.toEqual(c.moons.map((m) => m.phase));
    expect(a.station.screen).not.toEqual(c.station.screen);
  });

  it("places two moons on circular orbits and one station for every seed and viewport", () => {
    for (const [w, h] of VIEWPORTS) {
      for (const seed of SEEDS) {
        const s = placePlanetScenery(inputFor(seed, w, h));
        expect(s.moons.map((m) => m.id)).toEqual(["moon-a", "moon-b"]);
        for (const m of s.moons) {
          expect(m.orbitRadius).toBeGreaterThan(GLOBE_RADIUS * 1.2);
          expect(m.radius).toBeGreaterThan(0);
          expect(Math.hypot(...m.e1)).toBeCloseTo(1, 6);
          expect(Math.hypot(...m.e2)).toBeCloseTo(1, 6);
          expect(Math.abs(m.e1[0] * m.e2[0] + m.e1[1] * m.e2[1] + m.e1[2] * m.e2[2])).toBeLessThan(1e-6);
        }
        expect(s.station.scale).toBeGreaterThan(0);
      }
    }
  });

  it("gives every moon a clean visible arc and parks the station clear of the seat, the globe face and the chrome", () => {
    for (const [w, h] of VIEWPORTS) {
      for (const seed of SEEDS) {
        const s = placePlanetScenery(inputFor(seed, w, h));
        for (const m of s.moons) {
          expect(m.visible, `seed ${seed} ${w}x${h} ${m.id} clean arc`).toBeGreaterThanOrEqual(PLANET_SCENERY_LIMITS.minVisible);
          // Most of what shows is clean; the rest is hidden by `sceneryFade` at render time.
          expect(m.hidden, `seed ${seed} ${w}x${h} ${m.id} hidden share`).toBeLessThanOrEqual(m.visible);
        }
        expect(s.station.violations, `seed ${seed} ${w}x${h} station`).toBe(0);
        const st = s.station.screen;
        const box = discBox(st.u, st.v, st.half, s.view.aspect);
        expect(box.x0).toBeGreaterThan(0);
        expect(box.y0).toBeGreaterThan(0);
        expect(box.x1).toBeLessThan(1);
        expect(box.y1).toBeLessThan(1);
        expect(BACKDROP_SAFE_AREAS.some((a) => boxesOverlap(box, a))).toBe(false);
        expect(Math.hypot((st.u - s.view.seat.u) * s.view.aspect, st.v - s.view.seat.v)).toBeGreaterThan(s.view.seat.radius + st.half);
        expect(Math.hypot((st.u - s.view.globe.u) * s.view.aspect, st.v - s.view.globe.v)).toBeGreaterThan(s.view.globe.radius + st.half);
        expect(sceneryFade(s.view, st.u, st.v, st.half, true)).toBe(1);
      }
    }
  });

  it("treats extra keep-out boxes (the far sky's galaxy hint) like chrome", () => {
    const base = placePlanetScenery(inputFor(SEEDS[0], 1440, 900));
    // A box right where the station landed: the station moves and the box hides moons in it.
    const st = base.station.screen;
    const box = { x0: st.u - 0.06, y0: st.v - 0.06, x1: st.u + 0.06, y1: st.v + 0.06 };
    const s = placePlanetScenery({ ...inputFor(SEEDS[0], 1440, 900), keepOut: [box] });
    expect(s.station.violations).toBe(0);
    expect(boxesOverlap(discBox(s.station.screen.u, s.station.screen.v, s.station.screen.half, s.view.aspect), box)).toBe(false);
    expect(sceneryFade(s.view, st.u, st.v, 0.02, false)).toBe(0);
    expect(s.view.safeAreas).toHaveLength(BACKDROP_SAFE_AREAS.length + 1);
  });

  it("walks each moon around a circle of its orbit radius about the globe centre", () => {
    const s = placePlanetScenery(inputFor(SEEDS[3], 1440, 900));
    for (const m of s.moons) {
      for (let t = 0; t < m.periodS; t += m.periodS / 7) {
        const p = moonPosition(m, GLOBE_CENTER, t);
        const d = Math.hypot(p[0] - GLOBE_CENTER[0], p[1] - GLOBE_CENTER[1], p[2] - GLOBE_CENTER[2]);
        expect(d).toBeCloseTo(m.orbitRadius, 6);
      }
      const a = moonPosition(m, GLOBE_CENTER, 0);
      const b = moonPosition(m, GLOBE_CENTER, m.periodS);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(1e-6);
    }
  });
});
