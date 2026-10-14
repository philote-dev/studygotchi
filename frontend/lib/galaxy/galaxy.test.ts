import { describe, expect, it } from "vitest";
import { seedFromText } from "@/lib/stage/rng";
import {
  ALL_FEATURES,
  buildGalaxyBuffers,
  DRAW_CALL_BUDGET,
  FEATURE_KEYS,
  GALAXY_COUNTS,
  galaxyDrawCalls,
  KIND,
  NO_FEATURES,
  POINT_BUDGET,
  totalGalaxyPoints,
  type GalaxyFeatures,
} from "./points";
import {
  armAngle,
  armRidgeAngle,
  barTwistAmount,
  discDensity,
  generateGalaxySpec,
  MAX_SPURS,
  omegaAt,
  patternAngle,
  patternSpeed,
  ridgeOffset,
  spurBranchAngle,
  spurOffset,
  starPosition,
  thetaAt,
  type GalaxySpec,
} from "./spec";
import { COURSE_PALETTES, GALAXY_THEMES, inkify, STELLAR_DARK, STELLAR_LIGHT, stellarColors } from "./palettes";

const seeds = Array.from({ length: 48 }, (_, i) => seedFromText(`galaxy-${i}`));

/**
 * Base fields of the lab galaxy (components/lab/space/galaxy/galaxy-spec.ts)
 * for the capture seeds, pinned when the module moved out of the lab: the
 * same seed must stay the same galaxy as every lab capture and A/B.
 */
const LAB_BASE_FIELDS: Record<string, Record<string, unknown>> = {
  whirlpool: {"seed":2816195965,"arms":2,"bar":false,"barLength":0,"b":2.7099523436278106,"twist":2.7099523436278106,"spinDir":-1,"inclination":0.9330300191882999,"roll":0.4331992884166539,"coreSize":0.13985817142762244,"beadDensity":0.03014276687055826,"companion":true,"companionArm":1,"companionRadius":1.024474575817585,"palette":{"id":"orion-dream","ref":"09-orion-nebula-hubble.jpg (sky tint) + SPIRAL_PALETTE","core":"#fff0c2","arm":"#a99bd6","tip":"#8ad7ea","bead":"#e9a6c9","beadAlt":"#8ad7ea","dust":"#131a3a","companion":"#ffe6a8","haze":"#58408c"},"hazeCount":1,"patternPeriodS":48,"v0":0.06544984694978735,"aCore":0.1258723542848602,"eccentricity":0.17055603372804934,"barEccentricity":0.5,"thickness":0.027980640553869306,"thetaBar":0.14707672930755636,"starCount":3400},
  pinwheel: {"seed":2357329115,"arms":2,"bar":false,"barLength":0,"b":-2.613203986361623,"twist":2.613203986361623,"spinDir":1,"inclination":1.004830656386912,"roll":0.2913150695152581,"coreSize":0.2162456747703254,"beadDensity":0.05503304474987089,"companion":false,"companionArm":1,"companionRadius":1.0462141223764048,"palette":{"id":"orion-dream","ref":"09-orion-nebula-hubble.jpg (sky tint) + SPIRAL_PALETTE","core":"#fff0c2","arm":"#a99bd6","tip":"#8ad7ea","bead":"#e9a6c9","beadAlt":"#8ad7ea","dust":"#131a3a","companion":"#ffe6a8","haze":"#58408c"},"hazeCount":1,"patternPeriodS":48,"v0":0.06544984694978735,"aCore":0.19462110729329288,"eccentricity":0.17665135006631358,"barEccentricity":0.5,"thickness":0.023628276668023317,"thetaBar":2.0044912621469075,"starCount":3400},
  andromeda: {"seed":2302167956,"arms":3,"bar":false,"barLength":0,"b":-2.598848279938102,"twist":2.598848279938102,"spinDir":1,"inclination":0.9238407877273858,"roll":-0.25778583772480484,"coreSize":0.10930102244019509,"beadDensity":0.024320672964677215,"companion":true,"companionArm":1,"companionRadius":1.1184192007686944,"palette":{"id":"ngc1300","ref":"03-ngc1300-barred-spiral-hubble.jpg","core":"#f2c9a4","arm":"#9fb6d6","tip":"#c7d6ea","bead":"#d9b58f","beadAlt":"#8ad7ea","dust":"#6b3f3a","companion":"#f0d9a8","haze":"#4a3f6a"},"hazeCount":1,"patternPeriodS":48,"v0":0.06544984694978735,"aCore":0.09837092019617558,"eccentricity":0.11958657339810172,"barEccentricity":0.5,"thickness":0.04830747236963362,"thetaBar":5.176728860335935,"starCount":3400},
};

describe("seeded galaxy spec (polish fork)", () => {
  it("is deterministic: same seed, same galaxy; different seed, different galaxy", () => {
    const a = generateGalaxySpec(0x5a1a);
    const b = generateGalaxySpec(0x5a1a);
    expect(b).toEqual(a);
    const c = generateGalaxySpec(0x5a1b);
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
    const ba = buildGalaxyBuffers(a);
    const bb = buildGalaxyBuffers(b);
    expect(Array.from(bb.stars.orbit.slice(0, 64))).toEqual(Array.from(ba.stars.orbit.slice(0, 64)));
    expect(Array.from(bb.young.orbit.slice(0, 64))).toEqual(Array.from(ba.young.orbit.slice(0, 64)));
    expect(Array.from(bb.stars.cls.slice(0, 64))).toEqual(Array.from(ba.stars.cls.slice(0, 64)));
  });

  it("keeps every base field identical to the lab galaxy for the capture seeds (same seed, same galaxy)", () => {
    for (const [name, lab] of Object.entries(LAB_BASE_FIELDS)) {
      const spec = generateGalaxySpec(seedFromText(name)) as unknown as Record<string, unknown>;
      for (const key of Object.keys(lab)) expect(spec[key], `${name}.${key}`).toEqual(lab[key]);
    }
  });

  it("varies arm count 2-4, bar, companion, palette and tilt across seeds", () => {
    const specs = seeds.map(generateGalaxySpec);
    expect(new Set(specs.map((s) => s.arms))).toEqual(new Set([2, 3, 4]));
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

  it("seeds the polish fields inside their design ranges", () => {
    for (const s of seeds.map(generateGalaxySpec)) {
      expect(s.spurs.length).toBeGreaterThanOrEqual(4);
      expect(s.spurs.length).toBeLessThanOrEqual(MAX_SPURS);
      expect(s.dustSpurs.length).toBeLessThanOrEqual(MAX_SPURS);
      expect(s.globulars.length).toBeGreaterThanOrEqual(2);
      expect(s.globulars.length).toBeLessThanOrEqual(3);
      expect(s.backgroundGalaxies.length).toBeGreaterThanOrEqual(2);
      expect(s.backgroundGalaxies.length).toBeLessThanOrEqual(3);
      expect(s.hiiComplexes.length).toBeGreaterThanOrEqual(1);
      expect(s.hiiComplexes.length).toBeLessThanOrEqual(2);
      expect(s.flashPeriodS).toBeGreaterThanOrEqual(6);
      expect(s.flashPeriodS).toBeLessThanOrEqual(12);
      expect(s.cometPeriodS).toBeGreaterThanOrEqual(30);
      expect(s.cometPeriodS).toBeLessThanOrEqual(60);
      expect(s.bridge).toBe(s.companion);
      for (const g of s.globulars) expect(Math.abs(g.y)).toBeGreaterThan(0.1);
      // Light model: a soft-to-cuspy Sérsic bulge and arms wider inward than outward.
      expect(s.bulgeSersic).toBeGreaterThanOrEqual(1.5);
      expect(s.bulgeSersic).toBeLessThanOrEqual(3);
      expect(s.bulgeRe).toBeGreaterThan(0.2);
      expect(s.bulgeRe).toBeLessThan(0.4);
      expect(s.armSigmaIn).toBeGreaterThan(s.armSigmaOut);
    }
  });

  it("matches the arm field amplitude to the disc point density: zero outside the sampled radii, falling outward", () => {
    expect(discDensity(0.05)).toBe(0);
    expect(discDensity(1.05)).toBe(0);
    let prev = discDensity(0.3);
    for (let a = 0.35; a <= 1.02; a += 0.05) {
      const d = discDensity(a);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(prev);
      prev = d;
    }
    // Histogram of the actual disc samples agrees with the analytic surface density (within sampling noise).
    const s = generateGalaxySpec(0x5a1a);
    const b = buildGalaxyBuffers(s);
    const ring = (lo: number, hi: number) => {
      let n = 0;
      for (const buf of [b.stars, b.young]) for (let i = 0; i < buf.count; i++) if ((buf.kind[i] === KIND.disc || buf.kind[i] === KIND.young) && buf.orbit[i * 4] >= lo && buf.orbit[i * 4] < hi) n++;
      return n / (Math.PI * (hi * hi - lo * lo));
    };
    const inner = ring(0.3, 0.4) / ring(0.8, 0.9);
    const predicted = discDensity(0.35) / discDensity(0.85);
    expect(inner / predicted).toBeGreaterThan(0.75);
    expect(inner / predicted).toBeLessThan(1.35);
  });

  it("branches spurs 20 to 40 degrees off their arm, on the open (more radial) side", () => {
    for (const s of seeds.map(generateGalaxySpec)) {
      for (const spur of s.spurs) {
        const deg = (spurBranchAngle(s, spur) * 180) / Math.PI;
        expect(deg).toBeGreaterThanOrEqual(19.9);
        expect(deg).toBeLessThanOrEqual(40.1);
        expect(Math.sign(spur.slope)).toBe(-Math.sign(s.b));
        // Zero outside the spur, growing along it.
        expect(spurOffset(spur, spur.a0 * 0.99)).toBe(0);
        expect(spurOffset(spur, spur.a0 * Math.exp(spur.len * 1.01))).toBe(0);
        expect(Math.abs(spurOffset(spur, spur.a0 * Math.exp(spur.len * 0.5)))).toBeGreaterThan(0);
      }
    }
  });
});

describe("galaxy kinematics (unchanged from the lab)", () => {
  const spec = generateGalaxySpec(0x5a1a);

  it("rotates the pattern rigidly at one slow speed (48 s per turn)", () => {
    expect(Math.abs(patternSpeed(spec))).toBeCloseTo((Math.PI * 2) / 48, 9);
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
      const a0 = Math.max(0.5, s.barLength * 1.3 + 0.1);
      const slope = thetaAt(s, a0 + 0.2) - thetaAt(s, a0);
      expect(Math.sign(slope)).toBe(-s.spinDir);
    }
  });

  it("keeps the bar straight inside its length and leaves the arm ridge from the bar ends", () => {
    const barred = seeds.map(generateGalaxySpec).filter((s) => s.bar);
    expect(barred.length).toBeGreaterThan(0);
    for (const s of barred) {
      expect(thetaAt(s, s.barLength * 0.3)).toBe(s.thetaBar);
      expect(thetaAt(s, s.barLength * 0.9)).toBe(s.thetaBar);
      expect(thetaAt(s, s.barLength * 2)).not.toBe(s.thetaBar);
      expect(Math.abs(barTwistAmount(s))).toBeLessThanOrEqual(Math.PI / s.arms + 1e-9);
      // Past the blend the visible ridge of each arm continues from a bar end (the ends are pi
      // apart, so compare modulo pi) with the arm's own winding.
      const a = s.barLength * 1.3;
      for (let k = 0; k < s.arms; k++) {
        const expected = s.thetaBar + s.b * Math.log(1.3);
        const diff = armRidgeAngle(s, a, k) - expected;
        expect(Math.abs(diff - Math.PI * Math.round(diff / Math.PI))).toBeLessThan(1e-9);
      }
    }
    // Unbarred galaxies are untouched.
    for (const s of seeds.map(generateGalaxySpec).filter((x) => !x.bar)) expect(barTwistAmount(s)).toBe(0);
  });

  it("puts the visible ridge where the crowding factor 1/(dr/da) peaks", () => {
    for (const s of seeds.slice(0, 16).map(generateGalaxySpec)) {
      const a = Math.max(0.6, s.barLength * 1.4 + 0.1);
      const m = s.arms;
      const e = s.eccentricity;
      const dens = (psi: number) => 1 / Math.max(0.06, 1 + e * Math.cos(m * (psi - thetaAt(s, a))) + e * m * s.b * Math.sin(m * (psi - thetaAt(s, a))));
      let best = 0;
      let bestPsi = 0;
      for (let i = 0; i < 3600; i++) {
        const psi = (i / 3600) * Math.PI * 2;
        const d = dens(psi);
        if (d > best) {
          best = d;
          bestPsi = psi;
        }
      }
      const period = (Math.PI * 2) / m;
      const diff = bestPsi - armRidgeAngle(s, a, 0);
      const residue = diff - period * Math.round(diff / period);
      expect(Math.abs(residue)).toBeLessThan(0.02);
      expect(ridgeOffset(s)).toBeGreaterThan(0);
    }
  });

  it("lets a star drift through the arm while the crowding stays put", () => {
    const a = 0.85;
    const sample = { a, eScale: 1, psi0: armAngle(spec, a), dTheta: 0, kind: KIND.disc };
    const rel = (t: number) => {
      const p = starPosition(spec, sample, t);
      const arm = armAngle(spec, a) + patternAngle(spec, t);
      return Math.atan2(Math.sin(p.psi - arm), Math.cos(p.psi - arm));
    };
    expect(Math.abs(rel(0))).toBeLessThan(1e-9);
    expect(Math.abs(rel(20))).toBeGreaterThan(0.3);
    for (let t = 0; t < 200; t += 5) {
      const r = starPosition(spec, sample, t).r;
      expect(r).toBeGreaterThan(a * (1 - 0.2));
      expect(r).toBeLessThan(a * (1 + 0.2));
    }
  });

  it("keeps spur stars on bounded epicycles too, and rides the companion, bridge and halo at their own speeds", () => {
    const s = generateGalaxySpec(0x5a1a);
    const spur = s.spurs[0];
    const a = spur.a0 * Math.exp(spur.len * 0.5);
    const sample = { a, eScale: 1, psi0: 1, dTheta: spurOffset(spur, a), kind: KIND.spur };
    for (let t = 0; t < 200; t += 7) {
      const r = starPosition(s, sample, t).r;
      expect(r).toBeGreaterThan(a * 0.8);
      expect(r).toBeLessThan(a * 1.2);
    }
    const psiAfter = (kind: number, aa: number) => starPosition(s, { a: aa, eScale: 0, psi0: 0, dTheta: 0, kind }, 10).psi;
    expect(psiAfter(KIND.companion, 1.05)).toBeCloseTo(patternSpeed(s) * 10, 9);
    expect(psiAfter(KIND.bridge, 1.0)).toBeCloseTo(patternSpeed(s) * 10, 9);
    expect(psiAfter(KIND.halo, 0.8)).toBeCloseTo(omegaAt(s, 0.8) * 5, 9);
    expect(psiAfter(KIND.globular, 0.8)).toBeCloseTo(omegaAt(s, 0.8) * 3.5, 9);
  });

  it("places dust on the inner / trailing edge and beads on the outer edge of the arms", () => {
    const b = buildGalaxyBuffers(spec);
    const dustOffsets = Array.from({ length: b.dust.count }, (_, i) => b.dust.orbit[i * 4 + 3]);
    expect(dustOffsets.every((d) => Math.sign(d) === -spec.spinDir)).toBe(true);
    const beadOffsets: number[] = [];
    for (let i = 0; i < b.young.count; i++) if (b.young.kind[i] === KIND.bead) beadOffsets.push(b.young.orbit[i * 4 + 3]);
    expect(beadOffsets.length).toBeGreaterThan(20);
    expect(beadOffsets.every((d) => Math.sign(d) === spec.spinDir)).toBe(true);
  });
});

describe("polish buffers", () => {
  const count = (b: { kind: Float32Array; count: number }, kind: number) => {
    let n = 0;
    for (let i = 0; i < b.count; i++) if (b.kind[i] === kind) n++;
    return n;
  };

  it("keeps the lab's disc, bulge, companion and dust orbits byte-for-byte (old stream untouched)", () => {
    // The lab disc loop and this fork's disc loop consume the same rng in the same order: the first
    // disc star of each must land on the same orbit (a, eScale, psi0) whichever buffer it went to.
    for (const seed of seeds.slice(0, 6)) {
      const s = generateGalaxySpec(seed);
      const b = buildGalaxyBuffers(s);
      const firstOld = b.stars.orbit.slice(0, 3);
      const firstYoung = b.young.orbit.slice(0, 3);
      expect(firstOld[0]).toBeGreaterThan(0.06);
      expect(firstYoung[0]).toBeGreaterThan(0.06);
      expect(count(b.stars, KIND.disc) + count(b.young, KIND.young) + count(b.young, KIND.bead) - s.hiiComplexes.length * 8).toBe(GALAXY_COUNTS.disc);
      expect(count(b.stars, KIND.bulge)).toBe(GALAXY_COUNTS.bulge);
      expect(count(b.stars, KIND.companion)).toBe(s.companion ? GALAXY_COUNTS.companion : 0);
      expect(b.dust.count).toBe(GALAXY_COUNTS.dust);
    }
  });

  it("stays inside the point and draw-call budgets for every seed and feature set", () => {
    let max = 0;
    for (const seed of seeds) {
      const s = generateGalaxySpec(seed);
      const b = buildGalaxyBuffers(s);
      const total = totalGalaxyPoints(b);
      max = Math.max(max, total);
      expect(total + 1500).toBeLessThanOrEqual(POINT_BUDGET);
    }
    expect(max).toBeGreaterThan(4500);
    expect(galaxyDrawCalls(ALL_FEATURES)).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
    expect(galaxyDrawCalls(NO_FEATURES)).toBe(4);
    for (const key of FEATURE_KEYS) {
      const one: GalaxyFeatures = { ...NO_FEATURES, [key]: true };
      expect(galaxyDrawCalls(one)).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
    }
  });

  it("builds every polish population and keeps the young stars in the arms", () => {
    const s = { ...generateGalaxySpec(0x5a1a), companion: true, bridge: true } as GalaxySpec;
    const b = buildGalaxyBuffers(s);
    expect(count(b.stars, KIND.halo)).toBe(s.haloCount);
    expect(count(b.stars, KIND.globular)).toBe(s.globulars.length * 36);
    expect(count(b.stars, KIND.bridge)).toBe(100);
    expect(count(b.young, KIND.spur)).toBe(s.spurs.length * 20);
    expect(count(b.young, KIND.cluster)).toBe(12);
    const young = count(b.young, KIND.young);
    expect(young / GALAXY_COUNTS.disc).toBeGreaterThan(0.15);
    expect(young / GALAXY_COUNTS.disc).toBeLessThan(0.4);
    for (let i = 0; i < b.young.count; i++) {
      if (b.young.kind[i] === KIND.young) expect(b.young.orbit[i * 4 + 1]).toBe(1); // hug the crowding
    }
    // Globular clumps: shared radius, offsets in position.xz, out of the plane.
    for (let i = 0; i < b.stars.count; i++) {
      if (b.stars.kind[i] !== KIND.globular) continue;
      expect(Math.abs(b.stars.position[i * 3]) + Math.abs(b.stars.position[i * 3 + 2])).toBeGreaterThan(0);
      expect(Math.abs(b.stars.position[i * 3 + 1])).toBeGreaterThan(0.02);
    }
  });

  it("quantises stellar colour to eight classes per theme, by population", () => {
    const s = generateGalaxySpec(0x5a1a);
    const b = buildGalaxyBuffers(s);
    const classes = new Set<number>();
    for (const buf of [b.stars, b.young, b.dust]) for (let i = 0; i < buf.count; i++) classes.add(buf.cls[i]);
    expect(classes.size).toBeLessThanOrEqual(8);
    for (const c of classes) expect(Number.isInteger(c) && c >= 0 && c < 8).toBe(true);
    // Young arm stars are blue-white (O/B, A, F); bulge stars are gold / orange / red.
    for (let i = 0; i < b.young.count; i++) if (b.young.kind[i] === KIND.young) expect(b.young.cls[i]).toBeLessThanOrEqual(2);
    for (let i = 0; i < b.stars.count; i++) if (b.stars.kind[i] === KIND.bulge) expect(b.stars.cls[i]).toBeGreaterThanOrEqual(2);
    expect(STELLAR_DARK.length).toBe(8);
    expect(STELLAR_LIGHT.length).toBe(8);
    expect(new Set(stellarColors("dark", s.palette)).size).toBe(8);
    expect(new Set(stellarColors("light", s.palette)).size).toBe(8);
    expect(inkify("#e9cfa0")).toBe(inkify("#e9cfa0"));
    expect(inkify("#e9cfa0")).not.toBe("#e9cfa0");
  });

  it("exports a course palette per theme with the gold reserved for the current course", () => {
    for (const theme of ["dark", "light"] as const) {
      const p = COURSE_PALETTES[theme];
      expect(GALAXY_THEMES[theme].course).toBe(p);
      expect(GALAXY_THEMES[theme].stellar).toHaveLength(8);
      for (const hex of Object.values(p)) expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.youAreHere).not.toBe(p.beadWarm);
    }
    expect(COURSE_PALETTES.dark.sky).not.toBe(COURSE_PALETTES.light.sky);
  });
});
