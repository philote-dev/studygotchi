import { describe, expect, it } from "vitest";
import { beadRadiusFor } from "@/lib/galaxy/layout";
import {
  BEAD_CORE_PX,
  BEAD_GLOW_PX,
  beadPoint,
  beadScreenRadius,
  condenseCurves,
  condenseFromL,
  condenseGlyph,
  condensePoint,
  effectiveCondense,
  enterFromL,
} from "./condense";

const steps = Array.from({ length: 101 }, (_, i) => i / 100);

describe("condense curves", () => {
  it("t = 0 is the untouched graph and t = 1 the bead", () => {
    const zero = condenseCurves(0);
    expect(zero).toEqual({ t: 0, blend: 0, edges: 1, dust: 1, clusterLabels: 1, nodeLabels: 1 });
    const one = condenseCurves(1);
    expect(one.blend).toBe(1);
    expect(one.edges).toBe(0);
    expect(one.dust).toBe(0);
    expect(one.clusterLabels).toBe(0);
    expect(one.nodeLabels).toBe(0);
  });

  it("every curve is monotone and continuous (no pop at either end)", () => {
    let prev = condenseCurves(0);
    for (const t of steps.slice(1)) {
      const c = condenseCurves(t);
      expect(c.blend).toBeGreaterThanOrEqual(prev.blend);
      for (const key of ["edges", "dust", "clusterLabels", "nodeLabels"] as const) {
        expect(c[key]).toBeLessThanOrEqual(prev[key]);
        expect(Math.abs(c[key] - prev[key])).toBeLessThan(0.08); // no jumps between 1 % steps (steepest: labels over 0.2)
      }
      prev = c;
    }
    // Zero slope at the ends: the first and last steps move less than a linear ramp would.
    expect(condenseCurves(0.01).blend).toBeLessThan(0.01);
    expect(1 - condenseCurves(0.99).blend).toBeLessThan(0.01);
  });

  it("cluster labels go first, then node labels by 0.3, edges by 0.6, dust by 0.85", () => {
    expect(condenseCurves(0.2).clusterLabels).toBe(0);
    expect(condenseCurves(0.2).nodeLabels).toBeGreaterThan(0);
    expect(condenseCurves(0.3).nodeLabels).toBe(0);
    expect(condenseCurves(0.3).edges).toBeGreaterThan(0);
    expect(condenseCurves(0.6).edges).toBe(0);
    expect(condenseCurves(0.6).dust).toBeGreaterThan(0);
    expect(condenseCurves(0.85).dust).toBe(0);
  });

  it("is clamped outside [0, 1]", () => {
    expect(condenseCurves(-1)).toEqual(condenseCurves(0));
    expect(condenseCurves(2)).toEqual(condenseCurves(1));
  });
});

describe("bead geometry", () => {
  const anchor = { x: 700, y: 400, radius: 30 };

  it("bead points are seeded, inside the disc and stable", () => {
    for (const id of ["a", "b", "0240617f-dc4b-4c3f-8107-8c9eb5143998"]) {
      const p = beadPoint(id, anchor);
      expect(Math.hypot(p.x - anchor.x, p.y - anchor.y)).toBeLessThanOrEqual(anchor.radius + 1e-9);
      expect(beadPoint(id, anchor)).toEqual(p);
    }
    expect(beadPoint("a", anchor)).not.toEqual(beadPoint("b", anchor));
  });

  it("positions lerp from the layout to the bead point", () => {
    expect(condensePoint(10, 20, "a", anchor, 0)).toEqual({ x: 10, y: 20 });
    const target = beadPoint("a", anchor);
    expect(condensePoint(10, 20, "a", anchor, 1)).toEqual(target);
    const mid = condensePoint(10, 20, "a", anchor, 0.5);
    expect(mid.x).toBeCloseTo((10 + target.x) / 2);
    expect(mid.y).toBeCloseTo((20 + target.y) / 2);
  });

  it("glyphs shrink to one cell", () => {
    expect(condenseGlyph(3, 18, 12, 0)).toEqual({ core: 3, glow: 18, rayLength: 12 });
    expect(condenseGlyph(3, 18, 12, 1)).toEqual({ core: BEAD_CORE_PX, glow: BEAD_GLOW_PX, rayLength: 0 });
  });

  it("the bead radius follows the galaxy's bead radius for the course", () => {
    const size = { w: 1440, h: 900 };
    expect(beadScreenRadius(186, size)).toBeCloseTo(beadRadiusFor(186) * 0.4 * 900);
    expect(beadScreenRadius(5, size)).toBeLessThan(beadScreenRadius(186, size));
  });
});

describe("condense + enter", () => {
  const galaxy = { x: 100, y: 100, radius: 20 };
  const planet = { x: 700, y: 450, radius: 10 };

  it("enter = 1 / condense = 0 is the plain graph; enter = 0 collapses onto the planet point", () => {
    expect(effectiveCondense(0, 1, galaxy, planet)).toEqual({ t: 0, anchor: galaxy });
    expect(effectiveCondense(0, 0, galaxy, planet)).toEqual({ t: 1, anchor: planet });
    expect(effectiveCondense(0.7, 1, galaxy, planet)).toEqual({ t: 0.7, anchor: galaxy });
    expect(effectiveCondense(0.2, 0.5, galaxy, planet)).toEqual({ t: 0.5, anchor: planet });
  });

  it("altitude bands: condensed between the constellation and galaxy rungs, entered between planet and constellation", () => {
    expect(condenseFromL(2)).toBe(0);
    expect(condenseFromL(3)).toBe(1);
    expect(condenseFromL(2.4)).toBeGreaterThan(0.3);
    expect(enterFromL(1)).toBe(0);
    expect(enterFromL(2)).toBe(1);
    for (let i = 1; i < steps.length; i += 1) {
      expect(condenseFromL(1 + steps[i] * 2)).toBeGreaterThanOrEqual(condenseFromL(1 + steps[i - 1] * 2));
      expect(enterFromL(1 + steps[i] * 2)).toBeGreaterThanOrEqual(enterFromL(1 + steps[i - 1] * 2));
    }
  });
});
