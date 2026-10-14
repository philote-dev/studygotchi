import { describe, expect, it } from "vitest";
import { DEFAULT_SPRING, atRest, createSpring, hopDurationEstimate, nearestStop, retarget, settleToStop, stepSpring, wheelNudge, type SpringParams } from "./spring";

const finite = (v: number) => Number.isFinite(v) && !Number.isNaN(v);

function run(s: ReturnType<typeof createSpring>, seconds: number, p: SpringParams, dt = 1 / 120, onStep?: (t: number) => void) {
  for (let t = 0; t < seconds; t += dt) {
    stepSpring(s, dt, p);
    onStep?.(t + dt);
  }
  return s;
}

/* Ported from the space lab's stage2.test.ts (spring half). */
describe("stage spring", () => {
  const P = DEFAULT_SPRING;
  const NO_KICK: SpringParams = { ...P, kick: 0 };

  it("is critically damped: approaches a stop monotonically, never overshoots, and settles", () => {
    const s = retarget(createSpring(1), 2, NO_KICK);
    let maxX = 1;
    run(s, 3, NO_KICK, 1 / 120, () => {
      expect(s.x).toBeLessThanOrEqual(2 + 1e-9);
      maxX = Math.max(maxX, s.x);
    });
    expect(maxX).toBeLessThanOrEqual(2);
    expect(atRest(s)).toBe(true);
    expect(s.x).toBe(2);
    // A 1 L hop is in the brief's 1.2 .. 1.8 s window; the dive back is faster.
    const up = hopDurationEstimate(1, P);
    expect(up).toBeGreaterThan(1.1);
    expect(up).toBeLessThan(1.8);
    const down = hopDurationEstimate(1, { ...P, omega: P.omega * P.returnFactor });
    expect(down).toBeLessThan(up);
  });

  it("keeps L and dL/dt continuous: large frames integrate like small ones and nothing is NaN", () => {
    const a = retarget(createSpring(1), 3, P);
    const b = retarget(createSpring(1), 3, P);
    for (let t = 0; t < 2; t += 1 / 30) {
      stepSpring(a, 1 / 30, P);
      for (let i = 0; i < 8; i++) stepSpring(b, 1 / 240, P);
      expect(finite(a.x) && finite(a.v)).toBe(true);
      expect(Math.abs(a.x - b.x)).toBeLessThan(2e-3);
      expect(Math.abs(a.v - b.v)).toBeLessThan(2e-2);
    }
    // Frame-to-frame velocity change is bounded by the acceleration (no discontinuity).
    const s = retarget(createSpring(0), 3, NO_KICK);
    let vPrev = 0;
    run(s, 3, NO_KICK, 1 / 120, () => {
      expect(Math.abs(s.v - vPrev)).toBeLessThan(P.omega * P.omega * 3 * (1 / 120) * 1.01);
      vPrev = s.v;
    });
    stepSpring(s, 0, P);
    stepSpring(s, -1, P);
    expect(finite(s.x) && finite(s.v)).toBe(true);
  });

  it("chains planet -> galaxy without stopping at the cluster, cruising at the speed cap", () => {
    const s = retarget(createSpring(1), 3, P);
    let minVThroughCluster = Infinity;
    let maxV = 0;
    run(s, 4, P, 1 / 120, () => {
      if (s.x > 1.85 && s.x < 2.15) minVThroughCluster = Math.min(minVThroughCluster, Math.abs(s.v));
      maxV = Math.max(maxV, Math.abs(s.v));
    });
    expect(minVThroughCluster).toBeGreaterThan(1.2);
    expect(maxV).toBeLessThanOrEqual(P.vMax + 1e-9);
    expect(s.x).toBe(3);
    // The capped long hop takes longer than a single one but less than two of them.
    const one = hopDurationEstimate(1, P);
    const two = hopDurationEstimate(2, P);
    expect(two).toBeGreaterThan(one * 1.2);
    expect(two).toBeLessThan(one * 2);
  });

  it("retargets mid-flight with no velocity discontinuity; the kick only applies from rest", () => {
    const s = retarget(createSpring(1), 3, P);
    expect(s.v).toBe(P.kick);
    run(s, 0.4, P);
    const vBefore = s.v;
    const xBefore = s.x;
    retarget(s, 2, P);
    expect(s.v).toBe(vBefore);
    expect(s.x).toBe(xBefore);
    expect(s.target).toBe(2);
    run(s, 3, P);
    expect(s.x).toBe(2);
    // From rest, the kick points toward the target, whichever way.
    const down = retarget(createSpring(2), 1, P);
    expect(down.v).toBe(-P.kick);
    // Returns run on the stiffer spring: a dive settles sooner than the same climb.
    const climb = retarget(createSpring(1), 2, NO_KICK);
    const dive = retarget(createSpring(2), 1, NO_KICK);
    let tClimb = 0;
    let tDive = 0;
    run(climb, 4, NO_KICK, 1 / 120, (t) => {
      if (!tClimb && Math.abs(climb.x - 2) < 0.02) tClimb = t;
    });
    run(dive, 4, NO_KICK, 1 / 120, (t) => {
      if (!tDive && Math.abs(dive.x - 1) < 0.02) tDive = t;
    });
    expect(tDive).toBeLessThan(tClimb);
  });

  it("blends wheel input into a running hop and settles to the nearest stop afterwards", () => {
    const s = retarget(createSpring(1), 2, NO_KICK);
    run(s, 0.3, NO_KICK);
    const v = s.v;
    const x = s.x;
    wheelNudge(s, 120);
    expect(s.v).toBe(v);
    expect(s.x).toBe(x);
    expect(s.target).toBeCloseTo(2 + 120 * 0.0022, 9);
    wheelNudge(s, 1e6);
    expect(s.target).toBe(3);
    wheelNudge(s, -1e7);
    expect(s.target).toBe(0);
    // Idle after a fling past a threshold: the attractor is the stop ahead, not behind.
    const f = createSpring(1);
    f.v = 1.6;
    f.target = 1.45;
    settleToStop(f);
    expect(f.target).toBe(2);
    const g = createSpring(1.2);
    g.target = 1.2;
    settleToStop(g);
    expect(g.target).toBe(1);
    expect(nearestStop(2.49)).toBe(2);
    expect(nearestStop(3.4)).toBe(3);
  });
});
