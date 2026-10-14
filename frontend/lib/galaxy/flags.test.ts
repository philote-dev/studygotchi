import { describe, expect, it } from "vitest";
import {
  antiRadialSector,
  defaultSector,
  flagGeometry,
  HYSTERESIS_DEG,
  layoutFlags,
  LEADER,
  leaderPath,
  rectCircleOverlap,
  rectsOverlap,
  sectorCandidates,
  SETTLE_FRAMES,
  type FlagAnchor,
  type FlagLayoutInput,
  type FlagSectorState,
} from "./flags";

const VIEW = { x: 0, y: 0, w: 1000, h: 600 };
const CENTRE = { x: 500, y: 300 };
const BULGE = { x: 500, y: 300, r: 50 };

function anchor(id: string, x: number, y: number, extra: Partial<FlagAnchor> = {}): FlagAnchor {
  return { courseId: id, x, y, r: 24, glowR: 10, w: 160, h: 72, priority: 0, ...extra };
}

function solve(anchors: FlagAnchor[], extra: Partial<FlagLayoutInput> = {}) {
  return layoutFlags({ anchors, centre: CENTRE, bulge: BULGE, viewport: VIEW, ...extra });
}

describe("direction rule: anti-radial in screen space, 30 degree sectors", () => {
  it("points away from the galaxy centre: right of the centre -> sector 0, below -> 3, left -> 6, above -> 9", () => {
    expect(antiRadialSector({ x: 700, y: 300 }, CENTRE)).toBe(0);
    expect(antiRadialSector({ x: 500, y: 500 }, CENTRE)).toBe(3);
    expect(antiRadialSector({ x: 300, y: 300 }, CENTRE)).toBe(6);
    expect(antiRadialSector({ x: 500, y: 100 }, CENTRE)).toBe(9);
    // 45 degrees down-right rounds to sector 1 or 2 (30 or 60); exactly between, so either, but deterministic.
    expect(antiRadialSector({ x: 600, y: 400 }, CENTRE)).toBe(antiRadialSector({ x: 600, y: 400 }, CENTRE));
  });

  it("a free anchor takes its anti-radial sector and the flag box lies on the far side of the blob from the centre", () => {
    const [f] = solve([anchor("a", 760, 300)]);
    expect(f.dir).toBe(0);
    expect(f.fallback).toBe(false);
    expect(f.clamped).toBe(false);
    expect(f.rect.x).toBeGreaterThan(760 + 10);
    // The leader starts at the glow edge (+ gap) and runs outward; the box's near edge is the leader end.
    expect(f.start.x).toBeCloseTo(760 + 10 + LEADER.gap, -1);
    expect(f.elbow.x - f.start.x).toBeCloseTo(LEADER.radial, -1);
    expect(f.end.x).toBe(f.rect.x);
    // Sideways: the near edge's middle.
    expect(f.sy).toBe(0);
    expect(f.rect.y + f.rect.h / 2).toBeCloseTo(f.end.y, -1);
  });

  it("an upward flag hangs its bottom corner on the leader end; a downward one its top corner", () => {
    const up = flagGeometry(anchor("u", 500, 120), 9, VIEW, 2, LEADER);
    expect(up.sy).toBe(-1);
    expect(up.rect.y + up.rect.h).toBe(up.end.y);
    const down = flagGeometry(anchor("d", 640, 420), 1, VIEW, 2, LEADER);
    expect(down.sy).toBe(1);
    expect(down.rect.y).toBe(down.end.y);
    expect(down.rect.x).toBe(down.end.x);
    expect(down.sx).toBe(1);
  });

  it("every leader vertex and the box corner sit on the 2 px cell grid", () => {
    const flags = solve([anchor("a", 713.3, 287.7), anchor("b", 311.1, 455.5)]);
    for (const f of flags) {
      for (const p of [f.start, f.elbow, f.end]) {
        expect(p.x % 2).toBe(0);
        expect(p.y % 2).toBe(0);
      }
      expect(f.rect.x % 2).toBe(0);
      expect(f.rect.y % 2).toBe(0);
    }
    expect(leaderPath(flags[0])).toMatch(/^M-?\d+ -?\d+L-?\d+ -?\d+L-?\d+ -?\d+$/);
  });

  it("hysteresis: the sector only changes once the angle has left it by HYSTERESIS_DEG past the edge", () => {
    const r = 200;
    const at = (deg: number) => ({ x: CENTRE.x + r * Math.cos((deg * Math.PI) / 180), y: CENTRE.y + r * Math.sin((deg * Math.PI) / 180) });
    expect(defaultSector(at(0), CENTRE, undefined)).toBe(0);
    // 15 + 3 degrees: still inside the band around sector 0 while it is the previous one.
    expect(defaultSector(at(15 + HYSTERESIS_DEG / 2), CENTRE, 0)).toBe(0);
    // ... but a cold solve already says sector 1.
    expect(defaultSector(at(15 + HYSTERESIS_DEG / 2), CENTRE, undefined)).toBe(1);
    // Past the band: sector 1.
    expect(defaultSector(at(15 + HYSTERESIS_DEG + 1), CENTRE, 0)).toBe(1);
  });
});

describe("fallback: rotate in 30 degree steps toward the nearest free sector", () => {
  it("candidates alternate +30 / -30 outward and end opposite", () => {
    expect(sectorCandidates(0)).toEqual([0, 1, 11, 2, 10, 3, 9, 4, 8, 5, 7, 6]);
    expect(sectorCandidates(10)).toEqual([10, 11, 9, 0, 8, 1, 7, 2, 6, 3, 5, 4]);
  });

  it("a blob near the right edge cannot point right: the flag rotates to the nearest sector that stays inside the stage", () => {
    const [f] = solve([anchor("edge", 960, 300)]);
    expect(f.defaultDir).toBe(0);
    expect(f.fallback).toBe(true);
    expect(f.clamped).toBe(false);
    expect(f.rect.x + f.rect.w).toBeLessThanOrEqual(VIEW.w - LEADER.inset);
    expect(f.rect.y).toBeGreaterThanOrEqual(LEADER.inset);
    expect(f.rect.y + f.rect.h).toBeLessThanOrEqual(VIEW.h - LEADER.inset);
    // Nearest first: sectors 1, 11, 2, 10 still extend the box to the right (off the stage); the first that fits is
    // straight down (3) or straight up (9), where the box extends toward the roomier (left) half. Never the opposite (6).
    expect([3, 9]).toContain(f.dir);
    expect(f.sx).toBe(-1);
  });

  it("a longer leader is tried before giving up: a blob boxed in at the standard length reaches past its neighbours", () => {
    // Neighbours around a blob at every short-leader sector; the ring of flags at reach 1 is blocked but reach 1.75 clears.
    const centre = anchor("c", 500, 300, { r: 16, glowR: 8, w: 100, h: 40 });
    const ring = Array.from({ length: 6 }, (_, i) => {
      const t = (i / 6) * Math.PI * 2 + 0.2;
      return anchor(`n${i}`, 500 + 70 * Math.cos(t), 300 + 70 * Math.sin(t), { r: 16, glowR: 8, w: 100, h: 40, priority: 1 });
    });
    const flags = layoutFlags({ anchors: [centre, ...ring], centre: { x: 200, y: 300 }, bulge: { x: 200, y: 300, r: 20 }, viewport: VIEW });
    const fc = flags.find((f) => f.courseId === "c")!;
    expect(fc.clamped).toBe(false);
    expect(fc.reach).toBeGreaterThan(1);
    for (const o of ring) expect(rectCircleOverlap(fc.rect, { x: o.x, y: o.y, r: o.r })).toBe(false);
  });

  it("a chrome safe area blocks like the stage edge: the flag avoids the side panel", () => {
    const panel = { x: 700, y: 0, w: 300, h: 600 };
    const [free] = solve([anchor("a", 640, 300)]);
    const [dodge] = solve([anchor("a", 640, 300)], { obstacles: [panel] });
    expect(free.fallback).toBe(false);
    expect(dodge.fallback).toBe(true);
    expect(rectsOverlap(dodge.rect, panel)).toBe(false);
  });

  it("a flag never covers the bulge: a fallback that would swing back over it is skipped", () => {
    const [outer] = solve([anchor("o", 620, 300)]);
    expect(rectCircleOverlap(outer.rect, BULGE)).toBe(false);
    // The default (right) is blocked by a neighbour; the sectors that swing back toward the centre are rejected.
    const a = anchor("a", 600, 300, { w: 120, h: 56 });
    const b = anchor("b", 690, 300, { w: 120, h: 56, priority: 1 });
    const flags = solve([a, b]);
    const fa = flags.find((f) => f.courseId === "a")!;
    expect(fa.fallback).toBe(true);
    expect(fa.clamped).toBe(false);
    expect(rectCircleOverlap(fa.rect, BULGE)).toBe(false);
    expect(rectCircleOverlap(fa.rect, { x: b.x, y: b.y, r: b.r })).toBe(false);
  });

  it("when no sector is free the least-bad one is taken and the box is clamped into the stage", () => {
    const tiny = { x: 0, y: 0, w: 220, h: 120 };
    const [f] = layoutFlags({ anchors: [anchor("t", 110, 60, { w: 160, h: 72 })], centre: { x: 110, y: 60 }, bulge: { x: 110, y: 60, r: 0 }, viewport: tiny });
    expect(f.clamped).toBe(true);
    expect(f.rect.x).toBeGreaterThanOrEqual(LEADER.inset);
    expect(f.rect.x + f.rect.w).toBeLessThanOrEqual(tiny.w - LEADER.inset);
    expect(f.rect.y).toBeGreaterThanOrEqual(LEADER.inset);
    expect(f.rect.y + f.rect.h).toBeLessThanOrEqual(tiny.h - LEADER.inset);
  });
});

describe("collision avoidance between flags and blobs", () => {
  it("two neighbouring blobs on the same ray get flags that do not overlap each other or either blob", () => {
    const a = anchor("a", 690, 300, { w: 120, h: 56 });
    const b = anchor("b", 760, 300, { w: 120, h: 56 });
    const flags = solve([a, b]);
    const [fa, fb] = [flags.find((f) => f.courseId === "a")!, flags.find((f) => f.courseId === "b")!];
    expect(rectsOverlap(fa.rect, fb.rect)).toBe(false);
    for (const f of flags) {
      for (const o of [a, b]) {
        if (o.courseId === f.courseId) continue;
        expect(rectCircleOverlap(f.rect, { x: o.x, y: o.y, r: o.r })).toBe(false);
      }
    }
    // The farther one keeps its default (placed first); the inner one is the one that rotated.
    expect(fb.fallback).toBe(false);
    expect(fa.fallback).toBe(true);
  });

  it("priority places first: the current course keeps its anti-radial even when it is the inner blob", () => {
    // b is farther out (placed first by distance) and its anti-radial box would cross a's; a's priority wins the default.
    const a = anchor("a", 690, 300, { w: 120, h: 56, priority: 2 });
    const b = anchor("b", 740, 350, { w: 120, h: 56, r: 14, glowR: 6 });
    const flags = solve([a, b]);
    expect(flags[0].courseId).toBe("a");
    expect(flags[0].fallback).toBe(false);
    expect(flags[1].fallback).toBe(true);
    expect(rectsOverlap(flags[0].rect, flags[1].rect)).toBe(false);
  });

  it("twelve blobs on a ring all get non-overlapping flags clear of every blob and the bulge", () => {
    const anchors = Array.from({ length: 12 }, (_, i) => {
      const t = (i / 12) * Math.PI * 2 + 0.13;
      return anchor(`c${i}`, CENTRE.x + 210 * Math.cos(t), CENTRE.y + 150 * Math.sin(t), { w: 120, h: 56 });
    });
    const flags = solve(anchors, { viewport: { x: 0, y: 0, w: 1280, h: 720 }, centre: { x: 640, y: 360 }, bulge: { x: 640, y: 360, r: 50 } });
    expect(flags).toHaveLength(12);
    for (let i = 0; i < flags.length; i++) {
      expect(flags[i].clamped).toBe(false);
      expect(rectCircleOverlap(flags[i].rect, BULGE)).toBe(false);
      for (const o of anchors) {
        if (o.courseId === flags[i].courseId) continue;
        expect(rectCircleOverlap(flags[i].rect, { x: o.x, y: o.y, r: o.r })).toBe(false);
      }
      for (let j = i + 1; j < flags.length; j++) expect(rectsOverlap(flags[i].rect, flags[j].rect)).toBe(false);
    }
  });
});

describe("determinism and settling", () => {
  it("equal input gives equal output, whatever the anchor order", () => {
    const anchors = [anchor("a", 720, 300), anchor("b", 790, 300), anchor("c", 500, 120), anchor("d", 300, 420)];
    const one = solve(anchors);
    const two = solve([...anchors].reverse());
    expect(one).toEqual(two);
    expect(JSON.stringify(one)).toBe(JSON.stringify(solve(anchors)));
  });

  it("a placed flag keeps its fallback sector while the blocker is there and returns to the default only after SETTLE_FRAMES free frames", () => {
    const a = anchor("a", 690, 300, { w: 120, h: 56 });
    const b = anchor("b", 760, 300, { w: 120, h: 56 });
    let prev = new Map<string, FlagSectorState>();
    let flags = solve([a, b], { prev });
    const fa = flags.find((f) => f.courseId === "a")!;
    expect(fa.fallback).toBe(true);
    const held = fa.dir;
    prev = new Map(flags.map((f) => [f.courseId, f.state]));
    // Blocker still there: the sector holds frame after frame.
    for (let i = 0; i < 5; i++) {
      flags = solve([a, b], { prev });
      expect(flags.find((f) => f.courseId === "a")!.dir).toBe(held);
      prev = new Map(flags.map((f) => [f.courseId, f.state]));
    }
    // Blocker gone: the default is free again, but the flag waits SETTLE_FRAMES frames before moving back.
    for (let i = 1; i < SETTLE_FRAMES; i++) {
      flags = solve([a], { prev });
      expect(flags[0].dir).toBe(held);
      expect(flags[0].state.pendingDir).toBe(0);
      prev = new Map(flags.map((f) => [f.courseId, f.state]));
    }
    flags = solve([a], { prev });
    expect(flags[0].dir).toBe(0);
    expect(flags[0].fallback).toBe(false);
  });

  it("a sector that becomes blocked is left at once (no waiting with a flag over a blob)", () => {
    const a = anchor("a", 690, 300, { w: 120, h: 56 });
    let flags = solve([a]);
    expect(flags[0].dir).toBe(0);
    const prev = new Map(flags.map((f) => [f.courseId, f.state]));
    flags = solve([a, anchor("b", 760, 300, { w: 120, h: 56 })], { prev });
    const fa = flags.find((f) => f.courseId === "a")!;
    expect(fa.dir).not.toBe(0);
    expect(fa.state.pendingFrames).toBe(0);
  });
});
