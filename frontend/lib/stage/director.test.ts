import { describe, expect, it } from "vitest";
import { createDirector, createReadiness } from "./director";
import { DEFAULT_SPRING } from "./spring";

function run(d: ReturnType<typeof createDirector>, seconds: number, dt = 1 / 120, onStep?: (t: number) => void) {
  for (let t = 0; t < seconds; t += dt) {
    d.step(dt);
    onStep?.(t + dt);
  }
}

describe("stage director", () => {
  it("starts at rest on the planet and reports no motion", () => {
    const d = createDirector();
    expect(d.sample()).toEqual({ L: 1, v: 0, rung: "planet", target: "planet", moving: false, held: false });
    const s = d.step(1 / 60);
    expect(s.moving).toBe(false);
    expect(s.L).toBe(1);
    expect(s.v).toBe(0);
  });

  it("runs the lab spring from the planet to the constellation and settles on L = 2", () => {
    const d = createDirector("planet", DEFAULT_SPRING);
    d.request("constellation");
    expect(d.sample().moving).toBe(true);
    expect(d.sample().target).toBe("constellation");
    let arrived = 0;
    let maxL = 1;
    run(d, 3, 1 / 120, (t) => {
      const s = d.sample();
      maxL = Math.max(maxL, s.L);
      if (!arrived && Math.abs(s.L - 2) < 0.02) arrived = t;
    });
    // In the brief's 1.2 .. 1.8 s window, no overshoot, and at rest exactly on the stop.
    expect(arrived).toBeGreaterThan(1.1);
    expect(arrived).toBeLessThan(1.8);
    expect(maxL).toBeLessThanOrEqual(2);
    expect(d.sample()).toMatchObject({ L: 2, v: 0, rung: "constellation", target: "constellation", moving: false });
  });

  it("reads the rung from the nearest stop while moving and reports the velocity of the step", () => {
    const d = createDirector();
    d.request("galaxy");
    run(d, 0.5);
    const s = d.sample();
    expect(s.moving).toBe(true);
    expect(s.v).toBeGreaterThan(0);
    expect(s.L).toBeGreaterThan(1);
    expect(s.L).toBeLessThan(3);
    expect(s.rung).toBe(Math.round(s.L) === 1 ? "planet" : Math.round(s.L) === 2 ? "constellation" : "galaxy");
    expect(s.target).toBe("galaxy");
  });

  it("fires onRest once per arrival and not for a teleport or a no-op request", () => {
    const d = createDirector();
    const rests: string[] = [];
    const off = d.onRest((rung) => rests.push(rung));
    d.request("planet");
    run(d, 0.5);
    expect(rests).toEqual([]);
    d.request("constellation");
    run(d, 3);
    expect(rests).toEqual(["constellation"]);
    run(d, 1);
    expect(rests).toEqual(["constellation"]);
    d.teleport("galaxy");
    expect(d.sample()).toMatchObject({ L: 3, v: 0, rung: "galaxy", moving: false });
    run(d, 0.5);
    expect(rests).toEqual(["constellation"]);
    off();
    d.request("planet");
    run(d, 3);
    expect(rests).toEqual(["constellation"]);
    expect(d.sample().rung).toBe("planet");
  });

  it("retargets mid-flight without a velocity jump", () => {
    const d = createDirector();
    d.request("galaxy");
    run(d, 0.4);
    const before = d.sample();
    d.request("constellation");
    const after = d.sample();
    expect(after.L).toBe(before.L);
    expect(after.target).toBe("constellation");
    run(d, 3);
    expect(d.sample()).toMatchObject({ L: 2, rung: "constellation", moving: false });
  });

  it("parks at a held altitude on the way to a rung, reporting the rung as the target and no rest, until released", () => {
    const d = createDirector("planet");
    const rests: string[] = [];
    d.onRest((rung) => rests.push(rung));
    d.hold(0.55, "world");
    expect(d.sample()).toMatchObject({ target: "world", moving: true, held: true });
    run(d, 3);
    expect(Math.abs(d.sample().L - 0.55)).toBeLessThan(0.01);
    expect(d.sample()).toMatchObject({ rung: "planet", target: "world", moving: true, held: true });
    expect(rests).toEqual([]);
    d.request("world");
    expect(d.sample().held).toBe(false);
    run(d, 3);
    expect(d.sample()).toMatchObject({ L: 0, rung: "world", target: "world", moving: false, held: false });
    expect(rests).toEqual(["world"]);
    // A teleport ends a hold outright.
    d.hold(0.55, "world");
    d.teleport("planet");
    expect(d.sample()).toMatchObject({ L: 1, held: false, moving: false });
  });

  it("keeps a readiness register per layer", () => {
    const r = createReadiness();
    const seen: [string, boolean][] = [];
    r.subscribe((layer, ready) => seen.push([layer, ready]));
    expect(r.get("planet")).toBe(false);
    expect(r.all(["sky"])).toBe(false);
    r.set("sky", true);
    r.set("planet", true);
    r.set("planet", true);
    expect(r.get("planet")).toBe(true);
    expect(r.all(["sky", "planet"])).toBe(true);
    expect(r.all(["sky", "planet", "constellation"])).toBe(false);
    r.set("planet", false);
    expect(r.all(["sky", "planet"])).toBe(false);
    expect(seen).toEqual([
      ["sky", true],
      ["planet", true],
      ["planet", false],
    ]);
    const d = createDirector();
    d.readiness.set("planet", true);
    expect(d.readiness.get("planet")).toBe(true);
  });
});
