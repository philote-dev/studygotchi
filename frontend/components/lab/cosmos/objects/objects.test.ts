import { describe, expect, it } from "vitest";
import { binaryBodies, binaryLayout, generateBinary, l1FromDonor, rocheLobe, streamPoint, STREAM_SIGMA_CELLS } from "./BinaryStar";
import { cometCounts, cometState, dustSample, generateComet, ionSample, tailLength, COMET_BUDGET, DUST_AGE_FRACTION } from "./Comet";
import { generateNebula } from "./EmissionNebula";
import { generateGiant } from "./GasGiant";
import { generatePlanetary } from "./PlanetaryNebula";
import { beamAngleToViewer, dot3, generatePulsar, magneticAxis, pulsarFrame, pulsarGeometry, pulseStrength, PULSAR_RHO } from "./Pulsar";
import { clusterCount, CLUSTER_BUDGET, generateCluster } from "./StarCluster";
import { generateRemnant, REMNANT_MAX_POINTS, remnantPointCount } from "./SupernovaRemnant";
import { EXHIBITS } from "./exhibits";
import { focusLayout, gridLayout, scaleLayout, tinyRowsLayout } from "./layout";
import { keplerE, orbitPoint } from "./lib/orbit";
import type { PointBuffers } from "./lib/points";
import { seedFor, seedFromText } from "./lib/rng";
import { backdropPoints } from "./render/StarBackdrop";

const seeds = Array.from({ length: 24 }, (_, i) => seedFromText(`cosmos-${i}`));
const SIZES = [32, 48, 96, 160, 320, 720];

function same(a: PointBuffers, b: PointBuffers): boolean {
  return a.count === b.count && Array.from(a.position).every((v, i) => v === b.position[i]) && Array.from(a.color).every((v, i) => v === b.color[i]) && Array.from(a.aux).every((v, i) => v === b.aux[i]);
}

function oddSizes(b: PointBuffers): boolean {
  return Array.from(b.size).every((s) => Number.isInteger(s) && s % 2 === 1 && s >= 1 && s <= 7);
}

describe("seeded generators are deterministic and distinct", () => {
  it("emission nebula", () => {
    for (const variant of ["orion", "carina", "pillars"] as const) {
      const a = generateNebula(seeds[0], 320, variant, 0.5);
      const b = generateNebula(seeds[0], 320, variant, 0.5);
      expect(b.layers).toEqual(a.layers);
      expect(same(a.stars, b.stars)).toBe(true);
      const c = generateNebula(seeds[1], 320, variant, 0.5);
      expect(same(a.stars, c.stars)).toBe(false);
      if (variant === "pillars") {
        expect(a.pillars.length).toBeGreaterThanOrEqual(2);
        expect(a.layers.at(-1)?.mode).toBe(2);
      }
    }
  });

  it("supernova remnant, comet, binary, cluster, giant, pulsar, planetary", () => {
    expect(same(generateRemnant(seeds[2], 320, "crab", 0.5), generateRemnant(seeds[2], 320, "crab", 0.5))).toBe(true);
    expect(same(generateRemnant(seeds[2], 320, "crab", 0.5), generateRemnant(seeds[3], 320, "crab", 0.5))).toBe(false);
    const c1 = generateComet(seeds[4], 320, 0.65, 0.5, true);
    const c2 = generateComet(seeds[4], 320, 0.65, 0.5, true);
    expect(c1.sun).toEqual(c2.sun);
    expect(same(c1.dust, c2.dust) && same(c1.ion, c2.ion) && same(c1.misc, c2.misc)).toBe(true);
    expect(generateBinary(seeds[5], 320, 0.5)).toEqual(generateBinary(seeds[5], 320, 0.5));
    expect(generateBinary(seeds[5], 320, 0.5).mA).not.toBe(generateBinary(seeds[6], 320, 0.5).mA);
    expect(same(generateCluster(seeds[6], 320, "globular", 1, 0.5).points, generateCluster(seeds[6], 320, "globular", 1, 0.5).points)).toBe(true);
    expect(generateGiant(seeds[7], 320, "jupiter", 0.4, 3, 0.5)).toEqual(generateGiant(seeds[7], 320, "jupiter", 0.4, 3, 0.5));
    expect(generateGiant(seeds[7], 320, "jupiter", 0.4, 3, 0.5).sun).not.toEqual(generateGiant(seeds[8], 320, "jupiter", 0.4, 3, 0.5).sun);
    expect(generatePulsar(seeds[9], 320)).toEqual(generatePulsar(seeds[9], 320));
    expect(generatePlanetary(seeds[10], 320, "ring", 0.5)).toEqual(generatePlanetary(seeds[10], 320, "ring", 0.5));
  });

  it("derives one seed per exhibit from the gallery seed", () => {
    expect(seedFor(123, "comet")).toBe(seedFor(123, "comet"));
    expect(seedFor(123, "comet")).not.toBe(seedFor(123, "pulsar"));
    expect(seedFor(123, "comet")).not.toBe(seedFor(124, "comet"));
  });
});

describe("budgets hold at every size and seed", () => {
  it("point counts stay within each exhibit's budget line and sizes are odd cell counts", () => {
    for (const seed of seeds.slice(0, 8)) {
      for (const size of SIZES) {
        const neb = generateNebula(seed, size, "orion", 0.3);
        expect(neb.stars.count).toBeLessThanOrEqual(48);
        expect(neb.layers.length).toBeLessThanOrEqual(3);
        expect(oddSizes(neb.stars)).toBe(true);
        const rem = generateRemnant(seed, size, "veil", 0.2);
        expect(rem.count).toBeLessThanOrEqual(REMNANT_MAX_POINTS);
        expect(rem.count).toBeLessThanOrEqual(remnantPointCount(size));
        expect(oddSizes(rem)).toBe(true);
        const com = generateComet(seed, size, 0.8, 0.9, true);
        expect(com.dust.count).toBeLessThanOrEqual(COMET_BUDGET.dust);
        expect(com.ion.count).toBe(0); // the ion tail is a ribbon now, no particles
        expect(com.misc.count).toBeLessThanOrEqual(COMET_BUDGET.misc);
        expect(com.dust.count).toBe(cometCounts(size).dust);
        for (const kind of ["open", "globular"] as const) {
          const cl = generateCluster(seed, size, kind, 1.5, 0.5);
          expect(cl.points.count).toBeLessThanOrEqual(CLUSTER_BUDGET[kind]);
          expect(cl.points.count).toBe(clusterCount(kind, size, 1.5));
          expect(oddSizes(cl.points)).toBe(true);
          if (kind === "open") expect(cl.bright.length).toBeLessThanOrEqual(6);
        }
        const giant = generateGiant(seed, size, "saturn", 0.5, 4, 0.5);
        expect(giant.moons.count).toBeLessThanOrEqual(4);
        expect(oddSizes(giant.moons)).toBe(true);
        expect(generatePulsar(seed, size).points.count).toBeLessThanOrEqual(7);
        expect(generatePlanetary(seed, size, "cat", 0.5).points.count).toBeLessThanOrEqual(5);
      }
    }
  });

  it("small sizes get fewer points than large ones (LOD)", () => {
    expect(remnantPointCount(32)).toBeLessThan(remnantPointCount(320));
    expect(clusterCount("globular", 32, 1)).toBeLessThan(clusterCount("globular", 320, 1));
    expect(cometCounts(32).dust).toBeLessThan(cometCounts(320).dust);
    expect(generateNebula(seeds[0], 32, "orion", 0.5).stars.count).toBeLessThan(generateNebula(seeds[0], 320, "orion", 0.5).stars.count);
  });

  it("backdrop scales with area and stays sparse", () => {
    const b = backdropPoints(1, 1280, 800, "dark");
    expect(b.count).toBe(Math.round((1280 * 800) / 2600));
    expect(backdropPoints(1, 1280, 800, "dark").count).toBe(b.count);
    expect(Array.from(b.size).filter((s) => s === 3).length).toBeLessThan(b.count / 10);
  });
});

describe("structure", () => {
  it("remnant filaments sit on a lumpy shell around the centre with front/back depth in aux.x", () => {
    const rem = generateRemnant(seeds[11], 320, "crab", 0);
    let front = 0;
    for (let i = 0; i < rem.count; i++) {
      // Generator squashes the unit shell to 0.74 x 0.64 x 0.74 so the oval fits the box.
      const x = rem.position[i * 3] / 0.74;
      const y = rem.position[i * 3 + 1] / 0.64;
      const z = rem.position[i * 3 + 2] / 0.74;
      const r = Math.hypot(x, y, z);
      expect(r).toBeGreaterThan(0.75);
      expect(r).toBeLessThan(1.25);
      if (rem.aux[i * 4] > 0) front++;
    }
    expect(front).toBeGreaterThan(rem.count * 0.3);
    expect(front).toBeLessThan(rem.count * 0.7);
  });

  it("globular cluster is centrally concentrated; open cluster is not", () => {
    const g = generateCluster(seeds[12], 320, "globular", 1, 0);
    const o = generateCluster(seeds[12], 320, "open", 1, 0);
    const inner = (b: PointBuffers, r: number) => {
      let n = 0;
      for (let i = 0; i < b.count; i++) if (Math.hypot(b.position[i * 3], b.position[i * 3 + 1]) < r) n++;
      return n / b.count;
    };
    expect(inner(g.points, 0.25)).toBeGreaterThan(0.45);
    expect(inner(o.points, 0.25)).toBeLessThan(0.45);
  });

  it("comet orbit keeps the sun at a focus and tails have a flow phase in [0, 1)", () => {
    const c = generateComet(seeds[13], 320, 0.7, 0.5, true);
    // misc = nucleus, sun halo, sun core, then the orbit dots (aux.x = 0).
    expect(c.misc.aux[0]).toBe(1);
    expect(c.misc.aux[4]).toBe(3);
    expect(c.misc.aux[8]).toBe(2);
    for (let i = 3; i < c.misc.count; i++) {
      const kind = c.misc.aux[i * 4];
      expect(kind === 0 || kind === 4 || kind === 9).toBe(true);
      if (kind !== 0) continue; // guide dots and sprinkle grains are placed in the shader
      const x = c.misc.position[i * 3] - c.sun[0];
      const y = c.misc.position[i * 3 + 1] - c.sun[1];
      const d = Math.hypot(x, y);
      expect(d).toBeGreaterThanOrEqual(c.a * (1 - c.e) - 1e-6);
      expect(d).toBeLessThanOrEqual(c.a * (1 + c.e) + 1e-6);
    }
    expect(c.dust.count).toBeLessThanOrEqual(40);
    for (let i = 0; i < c.dust.count; i++) {
      expect(c.dust.position[i * 3]).toBeGreaterThanOrEqual(0);
      expect(c.dust.position[i * 3]).toBeLessThan(1);
    }
  });

  it("kepler solver converges and the orbit distance matches the vis-viva bounds", () => {
    for (const e of [0, 0.3, 0.65, 0.85]) {
      for (let k = 0; k < 24; k++) {
        const M = (k / 24) * Math.PI * 2;
        const E = keplerE(M, e);
        expect(Math.abs(E - e * Math.sin(E) - M)).toBeLessThan(1e-6);
        const p = orbitPoint(1, e, M);
        const d = Math.hypot(p.x, p.y);
        expect(d).toBeGreaterThanOrEqual(1 - e - 1e-9);
        expect(d).toBeLessThanOrEqual(1 + e + 1e-9);
      }
    }
  });

  it("gas giant moons orbit outside the rings' inner edge and never overlap", () => {
    for (const seed of seeds.slice(0, 10)) {
      const g = generateGiant(seed, 320, "jupiter", 0.4, 4, 0.5);
      const radii = Array.from({ length: g.moons.count }, (_, i) => g.moons.aux[i * 4]);
      for (let i = 0; i < radii.length; i++) {
        expect(radii[i]).toBeGreaterThan(1.3);
        if (i > 0) expect(radii[i] - radii[i - 1]).toBeGreaterThan(0.2);
      }
      expect(Math.hypot(...g.sun)).toBeCloseTo(1, 6);
    }
  });
});

describe("comet tails follow the physics", () => {
  const period = 30;
  const tailLen = 0.7;
  const specs = seeds.slice(0, 6).map((s, i) => generateComet(s, 320, 0.4 + 0.08 * i, 0.5, true));
  const angleAbout = (sun: [number, number], p: [number, number]) => Math.atan2(p[1] - sun[1], p[0] - sun[0]);
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

  it("ion tail points exactly anti-sunward from the nucleus", () => {
    for (const spec of specs) {
      for (let t = 0; t < period; t += period / 17) {
        const st = cometState(spec, period, t);
        for (const s of [0.05, 0.4, 0.95]) {
          const p = ionSample(spec, period, tailLen, t, s, 0);
          const d = [p[0] - st.pos[0], p[1] - st.pos[1]];
          const len = Math.hypot(d[0], d[1]);
          expect(len).toBeGreaterThan(0);
          expect((d[0] * st.away[0] + d[1] * st.away[1]) / len).toBeGreaterThan(0.9999);
          // and `away` really is the radial from the sun through the nucleus
          const radial = [st.pos[0] - spec.sun[0], st.pos[1] - spec.sun[1]];
          const rl = Math.hypot(radial[0], radial[1]);
          expect((radial[0] * st.away[0] + radial[1] * st.away[1]) / rl).toBeCloseTo(1, 9);
        }
      }
    }
  });

  it("dust grains sit on the past trajectory, pushed radially, so they trail behind along the orbit", () => {
    for (const spec of specs) {
      for (let t = 1; t < period; t += period / 11) {
        const now = cometState(spec, period, t);
        let prevAge = -1;
        let prevBehind = 0;
        for (const age01 of [0.1, 0.3, 0.6, 0.9]) {
          const { pos, emitted, age } = dustSample(spec, period, tailLen, t, age01, 0);
          expect(age).toBeGreaterThan(prevAge);
          prevAge = age;
          // Emission point is where the nucleus was `age` seconds ago.
          const past = cometState(spec, period, t - age);
          expect(emitted.pos[0]).toBeCloseTo(past.pos[0], 9);
          expect(emitted.pos[1]).toBeCloseTo(past.pos[1], 9);
          // The push points between the radial at emission and the radial now, so the grain's position angle
          // about the sun stays between its emission angle and the nucleus's: behind along the orbit, never ahead...
          const aNow = angleAbout(spec.sun, now.pos);
          const aGrain = wrap(aNow - angleAbout(spec.sun, pos)) * spec.dir;
          const aEmit = wrap(aNow - angleAbout(spec.sun, emitted.pos)) * spec.dir;
          expect(aGrain).toBeGreaterThan(0);
          expect(aGrain).toBeLessThanOrEqual(aEmit + 1e-9);
          // ...further back the older the grain.
          expect(aGrain).toBeGreaterThanOrEqual(prevBehind - 1e-9);
          prevBehind = aGrain;
          // and the push only ever moves the grain away from the sun
          const rGrain = Math.hypot(pos[0] - spec.sun[0], pos[1] - spec.sun[1]);
          expect(rGrain).toBeGreaterThanOrEqual(emitted.r - 1e-9);
        }
        expect(prevAge).toBeCloseTo(0.9 * period * DUST_AGE_FRACTION, 9);
      }
    }
  });

  it("never lets the dust tail lead: every grain lies in the sector between -v and anti-sun, at every phase", () => {
    const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    let worst = 0;
    for (const spec of specs) {
      for (let k = 0; k < 40; k++) {
        const t = (k / 40) * period;
        const now = cometState(spec, period, t);
        const aRev = Math.atan2(-now.vel[1], -now.vel[0]);
        const aAway = Math.atan2(now.away[1], now.away[0]);
        const span = wrapA(aAway - aRev); // signed arc from -v to anti-sun (short way)
        for (const age01 of [0.05, 0.2, 0.4, 0.6, 0.8, 1]) {
          const { pos } = dustSample(spec, period, tailLen, t, age01, 0);
          const d = [pos[0] - now.pos[0], pos[1] - now.pos[1]];
          if (Math.hypot(d[0], d[1]) < 1e-6) continue;
          const aD = Math.atan2(d[1], d[0]);
          // fraction of the way from -v to anti-sun; inside the sector when 0..1
          const f = wrap(aD - aRev) / span;
          const outside = Math.max(0, -f, f - 1) * Math.abs(span);
          worst = Math.max(worst, outside);
          // never on the forward side: no grain is closer to +v than to -v while also outside the sector
          expect(outside).toBeLessThan((6 * Math.PI) / 180);
        }
      }
    }
    expect(worst).toBeLessThan((6 * Math.PI) / 180);
  });

  it("tail length grows toward perihelion: monotonic in 1 / r, clamped", () => {
    let prev = Infinity;
    for (let r = 0.1; r <= 1.2; r += 0.05) {
      const L = tailLength(tailLen, r);
      expect(L).toBeLessThanOrEqual(prev + 1e-12);
      expect(L).toBeGreaterThanOrEqual(tailLen * 0.3 - 1e-12);
      expect(L).toBeLessThanOrEqual(tailLen * 1.15 + 1e-12);
      prev = L;
    }
    const spec = specs[3];
    const peri = tailLength(tailLen, spec.a * (1 - spec.e));
    const aph = tailLength(tailLen, spec.a * (1 + spec.e));
    expect(peri).toBeGreaterThan(aph);
  });
});

describe("pulsar is an oblique rotator", () => {
  const geos = seeds.slice(0, 10).map((s, i) => pulsarGeometry(generatePulsar(s, 320), 0.5 + 0.15 * i));

  it("keeps the magnetic axis at alpha from the rotation axis at every phase (alpha never 90 degrees by default)", () => {
    for (const g of geos) {
      expect(g.alpha).toBeGreaterThanOrEqual((25 * Math.PI) / 180);
      expect(g.alpha).toBeLessThanOrEqual((70 * Math.PI) / 180);
      for (let t = 0; t < 3 * g.period; t += g.period / 23) {
        const { omega, e1, e2 } = pulsarFrame(g, t);
        expect(Math.hypot(...omega)).toBeCloseTo(1, 9);
        expect(dot3(omega, e1)).toBeCloseTo(0, 9);
        expect(dot3(e1, e2)).toBeCloseTo(0, 9);
        const m = magneticAxis(g, t);
        expect(Math.hypot(...m)).toBeCloseTo(1, 9);
        expect(Math.acos(dot3(m, omega))).toBeCloseTo(g.alpha, 9);
      }
    }
  });

  it("sweeps the beam tip on a circle around the rotation axis (it wobbles, it does not spin flat)", () => {
    for (const g of geos) {
      // Projected beam direction changes continuously and its screen length varies (foreshortening).
      const lens = new Set<number>();
      for (let k = 0; k < 12; k++) {
        const m = magneticAxis(g, (k / 12) * g.period);
        lens.add(Math.round(Math.hypot(m[0], m[1]) * 100));
      }
      expect(lens.size).toBeGreaterThan(3);
    }
  });

  it("pulses exactly when a beam sweeps closest to the viewer, once per period", () => {
    for (const g of geos) {
      let best = Infinity;
      let tBest = 0;
      for (let k = 0; k < 2000; k++) {
        const t = (k / 2000) * g.period;
        const a = beamAngleToViewer(magneticAxis(g, t));
        if (a < best) {
          best = a;
          tBest = t;
        }
      }
      // Closest approach equals |zeta - alpha| (the beam grazes the line of sight by delta) ...
      expect(best).toBeCloseTo(Math.abs(g.zeta - g.alpha), 3);
      expect(best).toBeLessThan(PULSAR_RHO);
      // ... and that is when the pulse is strongest, repeating one period later, dark half a period away.
      const s0 = pulseStrength(g, tBest);
      expect(s0).toBeGreaterThan(0.3);
      expect(pulseStrength(g, tBest + g.period)).toBeCloseTo(s0, 3);
      expect(pulseStrength(g, tBest + g.period / 2)).toBeLessThan(s0);
      expect(pulseStrength(g, tBest + g.period / 2)).toBe(0);
      // phase of closest approach is cos(phi) = 1 (e1 points toward the viewer's projection)
      const phi = g.spin * ((tBest * Math.PI * 2) / g.period) + g.phase;
      expect(Math.cos(phi)).toBeGreaterThan(0.999);
    }
  });
});

describe("binary sizes follow the masses", () => {
  it("lighter donor rides the larger orbit, accretor is smaller and heavier, stream thinner than both, one period", () => {
    for (const seed of seeds.slice(0, 12)) {
      const s = generateBinary(seed, 320, 0.5);
      const lay = binaryLayout(s, 0.8, 0.98);
      expect(s.mB).toBeGreaterThan(s.mA);
      expect(lay.orbitA).toBeGreaterThan(lay.orbitB);
      expect(lay.orbitA / lay.orbitB).toBeCloseTo(s.mB / s.mA, 9);
      expect(lay.orbitA + lay.orbitB).toBeCloseTo(0.8, 9);
      expect(lay.rA).toBeGreaterThan(lay.rB);
      expect(lay.rA).toBeLessThan(lay.orbitA + lay.orbitB);
      // the stream ribbon (sigma 1.4 cells) is thinner than the accretor glow at every size >= 32 px
      expect(lay.rB).toBeGreaterThanOrEqual(0.05 * 0.9);
      for (const size of [96, 320, 720]) expect((STREAM_SIGMA_CELLS * 4) / size).toBeLessThan(lay.rB * 2);
    }
    // Eggleton sanity: equal masses -> r_L / a ~ 0.38; the lobe shrinks for a lighter donor.
    expect(rocheLobe(1)).toBeCloseTo(0.379, 2);
    expect(rocheLobe(0.5)).toBeLessThan(rocheLobe(1));
  });

  it("stream leaves the donor's L1 side, bends prograde with the orbital motion (not a straight spoke) and lands on the disc", () => {
    for (const seed of seeds.slice(0, 12)) {
      const s = generateBinary(seed, 320, 0.5);
      const sep = 0.8;
      const lay = binaryLayout(s, sep, 0.98);
      const l1 = l1FromDonor(s, sep);
      expect(l1).toBeGreaterThan(lay.rA * 0.78);
      expect(l1).toBeLessThan(sep * 0.5); // L1 sits closer to the lighter donor
      for (let k = 0; k < 8; k++) {
        const b = binaryBodies(s, sep, 10, (k / 8) * 10);
        const p0 = streamPoint(b, lay.rA, lay.rB, 0);
        const mid = streamPoint(b, lay.rA, lay.rB, 0.5);
        const end = streamPoint(b, lay.rA, lay.rB, 1);
        // starts on the accretor-facing (L1) side of the donor, inside its lobe
        expect((p0[0] - b.A[0]) * b.ab[0] + (p0[1] - b.A[1]) * b.ab[1]).toBeGreaterThan(0.5 * lay.rA);
        // midpoint is pushed off the line of centres toward the donor's velocity (prograde), by a visible amount
        const off = (mid[0] - (b.A[0] + b.B[0]) / 2) * b.perp[0] + (mid[1] - (b.A[1] + b.B[1]) / 2) * b.perp[1];
        const progradeSign = Math.sign(b.vA[0] * b.perp[0] + b.vA[1] * b.perp[1]);
        expect(Math.sign(off)).toBe(progradeSign);
        expect(Math.abs(off)).toBeGreaterThan(0.05 * sep);
        // ends on the accretor's disc, on the leading edge
        expect(Math.hypot(end[0] - b.B[0], end[1] - b.B[1])).toBeLessThan(3.2 * lay.rB);
        expect(Math.sign((end[0] - b.B[0]) * b.perp[0] + (end[1] - b.B[1]) * b.perp[1])).toBe(progradeSign);
      }
    }
  });
});

describe("scale convention", () => {
  it("every exhibit declares a box size in scene units and the ordering matches the convention", () => {
    const su = Object.fromEntries(EXHIBITS.map((e) => [e.id, e.su]));
    for (const e of EXHIBITS) expect(e.su).toBeGreaterThan(0);
    expect(su.giant).toBeLessThan(su.pulsar);
    expect(su.pulsar).toBeLessThan(su.comet);
    expect(su.comet).toBeLessThan(su.binary);
    expect(su.binary).toBeLessThanOrEqual(su.cluster);
    expect(su.cluster).toBeLessThan(su.planetary);
    expect(su.planetary).toBeLessThan(su.supernova);
    expect(su.supernova).toBeLessThan(su.nebula);
  });

  it("relative-scale rows draw at one px per su each, tiles never below 8 px and never overlapping", () => {
    const { tiles, rows } = scaleLayout(
      EXHIBITS.map((e) => ({ id: e.id, su: e.su })),
      1280,
      760,
    );
    expect(rows.length).toBe(2);
    for (const row of rows) {
      const rowTiles = tiles.filter((t) => t.y === row.y);
      for (const t of rowTiles) {
        const su = EXHIBITS.find((e) => e.id === t.id)!.su;
        expect(t.size).toBeGreaterThanOrEqual(8);
        if (su * row.pxPerSu >= 8) expect(Math.abs(t.size - su * row.pxPerSu)).toBeLessThanOrEqual(2);
        expect(Math.abs(t.x) + t.size / 2).toBeLessThanOrEqual(640);
      }
      const sorted = [...rowTiles].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i].x - sorted[i].size / 2).toBeGreaterThanOrEqual(sorted[i - 1].x + sorted[i - 1].size / 2);
    }
    expect(rows[0].pxPerSu).toBeGreaterThan(rows[1].pxPerSu);
  });
});

describe("layout", () => {
  it("grid tiles are even, equal, inside the stage and non-overlapping", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const tiles = gridLayout(ids, 1280, 760);
    expect(tiles.length).toBe(8);
    for (const t of tiles) {
      expect(Math.abs(t.x % 2)).toBe(0);
      expect(Math.abs(t.y % 2)).toBe(0);
      expect(Math.abs(t.size % 2)).toBe(0);
      expect(Math.abs(t.x) + t.size / 2).toBeLessThanOrEqual(640);
      expect(Math.abs(t.y) + t.size / 2).toBeLessThanOrEqual(380);
    }
    for (let i = 0; i < tiles.length; i++)
      for (let j = i + 1; j < tiles.length; j++) {
        const a = tiles[i];
        const b = tiles[j];
        expect(Math.abs(a.x - b.x) >= a.size || Math.abs(a.y - b.y) >= a.size).toBe(true);
      }
  });

  it("focus layout puts a 32 px and a 96 px preview beside the large one", () => {
    const f = focusLayout("x", 1280, 760);
    expect(f.tiny.size).toBe(32);
    expect(f.mid.size).toBe(96);
    expect(f.large.size).toBeGreaterThan(400);
    expect(f.tiny.x).toBeGreaterThan(f.large.x + f.large.size / 2);
    expect(tinyRowsLayout(["a", "b"], 1280, 760).map((t) => t.size)).toEqual([32, 32, 48, 48, 96, 96]);
  });
});
