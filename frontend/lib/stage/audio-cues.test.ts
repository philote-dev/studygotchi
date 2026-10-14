import { describe, expect, it } from "vitest";
import { STAGE_CUE_SFX, SFX_NAMES } from "@/lib/audio/catalog";
import { createStageCueMapper, DEFAULT_STAGE_CUES, galaxyGateOpen, riserLevel, type StageAudioEvent } from "./audio-cues";
import { createDirector, type DirectorSample } from "./director";
import type { Rung } from "./rungs";

const at = (L: number, v = 0, target?: Rung): DirectorSample => {
  const rung = (["world", "planet", "constellation", "galaxy"] as const)[Math.round(L)];
  return { L, v, rung, target: target ?? rung, moving: v !== 0, held: false };
};

const ofType = <T extends StageAudioEvent["type"]>(cues: StageAudioEvent[], type: T) =>
  cues.filter((c): c is Extract<StageAudioEvent, { type: T }> => c.type === type);

describe("riser level", () => {
  it("is zero at rest and grows with speed, louder higher up", () => {
    expect(riserLevel(at(1, 0))).toBe(0);
    expect(riserLevel(at(1, 0.75))).toBeGreaterThan(0);
    expect(riserLevel(at(1, 1.5))).toBeGreaterThan(riserLevel(at(1, 0.75)));
    expect(riserLevel(at(2.5, 1))).toBeGreaterThan(riserLevel(at(1, 1)));
    expect(riserLevel(at(3, -1.5))).toBe(1);
    expect(riserLevel(at(0, 1.5))).toBeCloseTo(1 - DEFAULT_STAGE_CUES.heightWeight, 3);
  });

  it("caps at the reference speed", () => {
    expect(riserLevel(at(3, 9))).toBe(1);
  });
});

describe("stage cue mapper", () => {
  it("emits nothing while the spring sits on a rung", () => {
    const m = createStageCueMapper();
    const cues: StageAudioEvent[] = [];
    for (let t = 0; t < 2000; t += 16) cues.push(...m.sample(at(1), t));
    expect(cues).toEqual([]);
    expect(m.stop()).toEqual([]);
  });

  it("throttles the riser to at most 10 updates a second and ends the run with 0", () => {
    const m = createStageCueMapper();
    const cues: StageAudioEvent[] = [];
    // 1 s of flight at 60 fps, then 1 s at rest.
    for (let t = 0; t < 1000; t += 1000 / 60) cues.push(...m.sample(at(1.5, 1.2, "constellation"), t));
    const inFlight = ofType(cues, "stage-riser");
    expect(inFlight.length).toBeGreaterThanOrEqual(9);
    expect(inFlight.length).toBeLessThanOrEqual(10);
    for (const c of inFlight) expect(c.intensity).toBeGreaterThan(0);
    const after: StageAudioEvent[] = [];
    for (let t = 1000; t < 2000; t += 1000 / 60) after.push(...m.sample(at(2, 0), t));
    const settled = ofType(after, "stage-riser");
    expect(settled).toEqual([{ type: "stage-riser", intensity: 0 }]);
  });

  it("has hysteresis: a crawl below the on threshold stays silent, and a run only stops below the off threshold", () => {
    const m = createStageCueMapper();
    const vOn = DEFAULT_STAGE_CUES.riserOn * DEFAULT_STAGE_CUES.riserVRef; // level == riserOn at L=3
    // Just under the on threshold: nothing.
    expect(ofType(m.sample(at(3, vOn * 0.9), 0), "stage-riser")).toEqual([]);
    // Over it: on.
    const on = ofType(m.sample(at(3, vOn * 2), 200), "stage-riser");
    expect(on).toHaveLength(1);
    expect(on[0].intensity).toBeGreaterThan(DEFAULT_STAGE_CUES.riserOn);
    // Between off and on: still updating (no stutter).
    const between = DEFAULT_STAGE_CUES.riserOff * 1.5 * DEFAULT_STAGE_CUES.riserVRef;
    const mid = ofType(m.sample(at(3, between), 400), "stage-riser");
    expect(mid).toHaveLength(1);
    expect(mid[0].intensity).toBeGreaterThan(0);
    // Below off: one final zero, then silence.
    expect(ofType(m.sample(at(3, 0.001), 600), "stage-riser")).toEqual([{ type: "stage-riser", intensity: 0 }]);
    expect(ofType(m.sample(at(3, 0.001), 800), "stage-riser")).toEqual([]);
  });

  it("fires hop-start once when the target changes, with direction", () => {
    const m = createStageCueMapper();
    expect(ofType(m.sample(at(1), 0), "stage-hop")).toEqual([]);
    expect(ofType(m.sample(at(1, 0.4, "galaxy"), 16), "stage-hop")).toEqual([
      { type: "stage-hop", from: "planet", to: "galaxy", up: true },
    ]);
    expect(ofType(m.sample(at(1.2, 1, "galaxy"), 32), "stage-hop")).toEqual([]);
    expect(ofType(m.sample(at(1.4, 1, "constellation"), 48), "stage-hop")).toEqual([
      { type: "stage-hop", from: "galaxy", to: "constellation", up: false },
    ]);
  });

  it("turns an arrival into a hit note carrying the rung, one kind per rung", () => {
    const m = createStageCueMapper();
    const kinds = (["world", "planet", "constellation", "galaxy"] as const).map((rung) => m.rest(rung));
    expect(kinds).toEqual([
      [{ type: "stage-arrive", rung: "world" }],
      [{ type: "stage-arrive", rung: "planet" }],
      [{ type: "stage-arrive", rung: "constellation" }],
      [{ type: "stage-arrive", rung: "galaxy" }],
    ]);
    const sfx = new Set([STAGE_CUE_SFX["arrive-planet"], STAGE_CUE_SFX["arrive-constellation"], STAGE_CUE_SFX["arrive-galaxy"]]);
    expect(sfx.size).toBe(3);
  });

  it("opens the galaxy ambience gate only at L >= 2.6, on edges, and closes it on stop", () => {
    expect(galaxyGateOpen(2.59)).toBe(false);
    expect(galaxyGateOpen(2.6)).toBe(true);
    const m = createStageCueMapper();
    expect(ofType(m.sample(at(2.5, 1, "galaxy"), 0), "stage-galaxy-ambience")).toEqual([]);
    expect(ofType(m.sample(at(2.6, 1, "galaxy"), 16), "stage-galaxy-ambience")).toEqual([{ type: "stage-galaxy-ambience", on: true }]);
    expect(ofType(m.sample(at(2.9, 0.5, "galaxy"), 32), "stage-galaxy-ambience")).toEqual([]);
    expect(ofType(m.sample(at(2.4, -1, "planet"), 48), "stage-galaxy-ambience")).toEqual([{ type: "stage-galaxy-ambience", on: false }]);
    // Settle at the galaxy: the riser closes (gap elapsed) and the gate reopens; stop() closes the gate.
    expect(m.sample(at(3, 0, "planet"), 200)).toEqual([
      { type: "stage-galaxy-ambience", on: true },
      { type: "stage-riser", intensity: 0 },
    ]);
    expect(m.stop()).toEqual([{ type: "stage-galaxy-ambience", on: false }]);
  });

  it("follows a real director hop: hop, riser run, gate, arrival, then silence", () => {
    const d = createDirector("planet");
    const m = createStageCueMapper();
    const cues: StageAudioEvent[] = [];
    d.onRest((rung) => cues.push(...m.rest(rung)));
    const dt = 1 / 120;
    let t = 0;
    const tick = () => {
      d.step(dt);
      t += dt * 1000;
      cues.push(...m.sample(d.sample(), t));
    };
    for (let i = 0; i < 60; i++) tick();
    d.request("galaxy");
    for (let i = 0; i < 120 * 4; i++) tick();
    const types = cues.map((c) => c.type);
    expect(types.indexOf("stage-hop")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("stage-hop")).toBeLessThan(types.indexOf("stage-riser"));
    expect(types.indexOf("stage-galaxy-ambience")).toBeLessThan(types.indexOf("stage-arrive"));
    expect(ofType(cues, "stage-arrive")).toEqual([{ type: "stage-arrive", rung: "galaxy" }]);
    const risers = ofType(cues, "stage-riser");
    expect(risers.length).toBeLessThanOrEqual(42); // <= 10/s over ~4 s of flight + settling
    expect(risers.at(-1)).toEqual({ type: "stage-riser", intensity: 0 });
    expect(Math.max(...risers.map((r) => r.intensity))).toBeGreaterThan(0.4);
    // Once settled, a further second is silent.
    const before = cues.length;
    for (let i = 0; i < 120; i++) tick();
    expect(cues.length).toBe(before);
  });
});

describe("stage cue catalog", () => {
  it("maps every kind with an asset to a typed kit sound, and leaves the missing ones null", () => {
    for (const [kind, sfx] of Object.entries(STAGE_CUE_SFX)) {
      if (sfx !== null) expect(SFX_NAMES, kind).toContain(sfx);
    }
    expect(STAGE_CUE_SFX.riser).toBeNull();
    expect(STAGE_CUE_SFX["galaxy-ambience"]).toBeNull();
  });
});
