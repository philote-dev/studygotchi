import { describe, expect, it } from "vitest";
import { seedFromText } from "../lib/rng";
import { buildGalaxyBuffers, GALAXY_COUNTS, KIND, totalGalaxyPoints } from "./galaxy-points";
import {
  armAngle,
  generateGalaxySpec,
  omegaAt,
  patternAngle,
  patternSpeed,
  starPosition,
  thetaAt,
  type GalaxySpec,
} from "./galaxy-spec";
import { STAR_LAYERS } from "./StarField";

const seeds = Array.from({ length: 48 }, (_, i) => seedFromText(`galaxy-${i}`));

describe("seeded galaxy spec", () => {
  it("is deterministic: same seed, same galaxy; different seed, different galaxy", () => {
    const a = generateGalaxySpec(0x5a1a);
    const b = generateGalaxySpec(0x5a1a);
    expect(b).toEqual(a);
    const c = generateGalaxySpec(0x5a1b);
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
    const ba = buildGalaxyBuffers(a);
    const bb = buildGalaxyBuffers(b);
    expect(Array.from(bb.stars.orbit.slice(0, 64))).toEqual(Array.from(ba.stars.orbit.slice(0, 64)));
    expect(Array.from(bb.stars.color.slice(0, 64))).toEqual(Array.from(ba.stars.color.slice(0, 64)));
  });

  it("varies arm count 2-4, bar, companion, palette and tilt across seeds", () => {
    const specs = seeds.map(generateGalaxySpec);
    const arms = new Set(specs.map((s) => s.arms));
    expect(arms).toEqual(new Set([2, 3, 4]));
    expect(specs.some((s) => s.bar)).toBe(true);
    expect(specs.some((s) => !s.bar)).toBe(true);
    expect(specs.some((s) => s.companion)).toBe(true);
    expect(new Set(specs.map((s) => s.palette.id)).size).toBeGreaterThanOrEqual(3);
    expect(specs.some((s) => s.spinDir === 1) && specs.some((s) => s.spinDir === -1)).toBe(true);
    for (const s of specs) {
      expect(s.inclination).toBeGreaterThanOrEqual(0.45);
      expect(s.inclination).toBeLessThanOrEqual(1.05);
      expect(s.twist).toBeGreaterThanOrEqual(1.8);
      expect(s.twist).toBeLessThanOrEqual(3.4);
      if (s.bar) expect(s.arms).toBe(2);
    }
  });

  it("text seeds hash stably and numeric seeds pass through", () => {
    expect(seedFromText("whirlpool")).toBe(seedFromText("whirlpool"));
    expect(seedFromText("whirlpool")).not.toBe(seedFromText("pinwheel"));
    expect(seedFromText("23066")).toBe(23066);
    expect(seedFromText("0x5a1a")).toBe(0x5a1a);
  });
});

describe("galaxy kinematics", () => {
  const spec = generateGalaxySpec(0x5a1a);

  it("rotates the pattern rigidly at one slow speed (48 s per turn)", () => {
    expect(Math.abs(patternSpeed(spec))).toBeCloseTo((Math.PI * 2) / 48, 9);
    // The arm angle at every radius advances by the same amount: no winding.
    for (const s of [spec, generateGalaxySpec(7), generateGalaxySpec(99)]) {
      const t = 17;
      const shiftInner = armAngle(s, 0.3) + patternAngle(s, t) - armAngle(s, 0.3);
      const shiftOuter = armAngle(s, 0.9) + patternAngle(s, t) - armAngle(s, 0.9);
      expect(shiftOuter).toBeCloseTo(shiftInner, 12);
    }
  });

  it("gives stars a flat rotation curve: v = omega * a is constant outside the core, inner stars lap outer ones", () => {
    for (const s of seeds.slice(0, 12).map(generateGalaxySpec)) {
      const v1 = Math.abs(omegaAt(s, 0.4)) * 0.4;
      const v2 = Math.abs(omegaAt(s, 0.9)) * 0.9;
      expect(v2).toBeCloseTo(v1, 9);
      expect(Math.abs(omegaAt(s, 0.3))).toBeGreaterThan(Math.abs(omegaAt(s, 0.9)));
      // Solid body inside the core: omega stops growing.
      expect(Math.abs(omegaAt(s, s.aCore * 0.5))).toBeCloseTo(Math.abs(omegaAt(s, s.aCore)), 9);
    }
  });

  it("makes every layer share the spin direction", () => {
    for (const s of seeds.slice(0, 12).map(generateGalaxySpec)) {
      expect(Math.sign(patternSpeed(s))).toBe(s.spinDir);
      expect(Math.sign(omegaAt(s, 0.5))).toBe(s.spinDir);
      expect(Math.sign(omegaAt(s, 1.0))).toBe(s.spinDir);
    }
  });

  it("trails the arms: outer tips lag the rotation (d theta / d a has the opposite sign to the spin)", () => {
    for (const s of seeds.map(generateGalaxySpec)) {
      const a0 = Math.max(0.5, s.barLength + 0.1);
      const slope = thetaAt(s, a0 + 0.2) - thetaAt(s, a0);
      expect(Math.sign(slope)).toBe(-s.spinDir);
    }
  });

  it("keeps the bar straight inside its length and starts the arms at the bar ends", () => {
    const barred = seeds.map(generateGalaxySpec).find((s) => s.bar)!;
    expect(thetaAt(barred, barred.barLength * 0.3)).toBe(barred.thetaBar);
    expect(thetaAt(barred, barred.barLength * 0.9)).toBe(barred.thetaBar);
    expect(thetaAt(barred, barred.barLength)).toBeCloseTo(barred.thetaBar, 12);
    expect(thetaAt(barred, barred.barLength * 2)).not.toBe(barred.thetaBar);
  });

  it("lets a star drift through the arm while the crowding stays put", () => {
    // A star on the crowding ridge at t = 0 (psi0 = arm angle) at a = 0.85.
    const a = 0.85;
    const sample = { a, eScale: 1, psi0: armAngle(spec, a), dTheta: 0, kind: KIND.disc };
    const rel = (t: number) => {
      const p = starPosition(spec, sample, t);
      const arm = armAngle(spec, a) + patternAngle(spec, t);
      return Math.atan2(Math.sin(p.psi - arm), Math.cos(p.psi - arm));
    };
    expect(Math.abs(rel(0))).toBeLessThan(1e-9);
    // Outside corotation the star lags the pattern; after 20 s it has left the ridge.
    expect(Math.abs(rel(20))).toBeGreaterThan(0.3);
    // Radius oscillates around a (epicycle), never blows up: the orbits never cross.
    for (let t = 0; t < 200; t += 5) {
      const r = starPosition(spec, sample, t).r;
      expect(r).toBeGreaterThan(a * (1 - 0.2));
      expect(r).toBeLessThan(a * (1 + 0.2));
    }
  });

  it("places dust on the inner / trailing edge and beads on the outer edge of the arms", () => {
    const b = buildGalaxyBuffers(spec);
    const dustOffsets = Array.from({ length: b.dust.count }, (_, i) => b.dust.orbit[i * 4 + 3]);
    expect(dustOffsets.every((d) => Math.sign(d) === -spec.spinDir)).toBe(true);
    const beadOffsets: number[] = [];
    for (let i = 0; i < b.stars.count; i++) if (b.stars.kind[i] === KIND.bead) beadOffsets.push(b.stars.orbit[i * 4 + 3]);
    expect(beadOffsets.length).toBeGreaterThan(20);
    expect(beadOffsets.every((d) => Math.sign(d) === spec.spinDir)).toBe(true);
  });

  it("stays inside the point budget with the three-layer star field", () => {
    const b = buildGalaxyBuffers({ ...spec, companion: true } as GalaxySpec);
    const galaxy = totalGalaxyPoints(b);
    expect(galaxy).toBe(GALAXY_COUNTS.disc + GALAXY_COUNTS.bulge + GALAXY_COUNTS.companion + GALAXY_COUNTS.dust);
    expect(galaxy + 1500).toBeLessThanOrEqual(6000);
    expect(STAR_LAYERS.reduce((s, l) => s + l.share, 0)).toBeCloseTo(1, 9);
    expect(STAR_LAYERS.filter((l) => l.size > 1).length).toBe(1);
  });
});
