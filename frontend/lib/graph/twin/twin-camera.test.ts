import { describe, expect, it } from "vitest";
import fixture from "./parity-fixture.json";
import { screenFromWorld } from "./camera";
import { hitClusterLabel, hitNode, pickRadius } from "./twin-hit";
import { easeOutCubic, fitTarget, FIT_CLUSTER_ZOOM, MAX_ZOOM, MIN_ZOOM, pan, tweenCamera, TwinCamera, wheelZoom, zoomByTarget } from "./twin-camera";

const size = { w: 1440, h: 900 };

describe("twin camera rules (ported from KnowledgeCanvas)", () => {
  it("fit frames the padded bounds at 92 %, capped by the cluster zoom", () => {
    // Nodes spanning 1000 × 100 world units: width-limited, k = 1440 / 1120 · 0.92 = 1.18 -> capped at 0.81.
    const nodes = [
      { x: 0, y: 0, radius: 0 },
      { x: 1000, y: 100, radius: 0 },
    ];
    const fit = fitTarget(nodes, size, FIT_CLUSTER_ZOOM)!;
    expect(fit.k).toBeCloseTo(FIT_CLUSTER_ZOOM);
    expect(fit.x).toBe(500);
    expect(fit.y).toBe(50);
    const subset = fitTarget([{ x: 0, y: 0, radius: 0 }], size)!;
    expect(subset.k).toBe(MAX_ZOOM); // a point: (1440/120)·0.92 = 11 -> clamped
    expect(fitTarget([], size)).toBeNull();
    expect(fitTarget(nodes, { w: 0, h: 0 })).toBeNull();
  });

  it("zoomBy and wheel clamp to [0.18, 3.2]; wheel keeps the world point under the pointer", () => {
    expect(zoomByTarget({ x: 1, y: 2, k: 3 }, 1.35).k).toBe(MAX_ZOOM);
    expect(zoomByTarget({ x: 1, y: 2, k: 0.2 }, 1 / 1.35).k).toBe(MIN_ZOOM);
    const cam = { x: 10, y: -20, k: 0.5 };
    const px = 300;
    const py = 700;
    const before = { x: (px - 720) / cam.k + cam.x, y: (py - 450) / cam.k + cam.y };
    const after = wheelZoom(cam, size, px, py, -120);
    expect(after.k).toBeCloseTo(0.5 * Math.exp(120 * 0.0016));
    const s = screenFromWorld(after, size, before.x, before.y);
    expect(s.sx).toBeCloseTo(px, 9);
    expect(s.sy).toBeCloseTo(py, 9);
  });

  it("pan moves the camera by the pointer delta over k", () => {
    expect(pan({ x: 0, y: 0, k: 2 }, 10, -4)).toEqual({ x: -5, y: 2, k: 2 });
  });

  it("the tween is easeOutCubic over the duration and lands exactly on the target", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
    expect(easeOutCubic(1)).toBe(1);
    const from = { x: 0, y: 0, k: 1 };
    const target = { x: 100, y: -50, k: 2 };
    const mid = tweenCamera(from, target, 1000, 380, 1190);
    expect(mid.done).toBe(false);
    expect(mid.cam.x).toBeCloseTo(100 * easeOutCubic(0.5));
    expect(mid.cam.k).toBeCloseTo(1 + easeOutCubic(0.5));
    const end = tweenCamera(from, target, 1000, 380, 1500);
    expect(end.done).toBe(true);
    expect(end.cam).toEqual(target);
  });

  it("TwinCamera: instant for duration 0, stepped tweens otherwise, set() cancels", () => {
    const c = new TwinCamera();
    c.animateTo({ x: 5, y: 5, k: 1.5 }, 0, 0);
    expect(c.cam).toEqual({ x: 5, y: 5, k: 1.5 });
    expect(c.step(10)).toBe(false);
    c.animateTo({ x: 15, y: 5, k: 1.5 }, 100, 100);
    expect(c.step(150)).toBe(true);
    expect(c.cam.x).toBeCloseTo(5 + 10 * easeOutCubic(0.5));
    c.set({ x: 0, y: 0, k: 1 });
    expect(c.tween).toBeNull();
    expect(c.step(200)).toBe(false);
  });
});

describe("hit testing", () => {
  const zoomedIn = fixture.states["zoomed-in"];
  const nodes = zoomedIn.sampleNodes.map((n) => ({ ...n, kind: n.kind as "concept" | "resource" }));
  const anchor = { ...zoomedIn.anchorNode, kind: zoomedIn.anchorNode.kind as "concept" | "resource" };

  it("picks the star under the pointer within glow·0.55 + 8 px, nearest first", () => {
    const all = [...nodes, anchor];
    expect(hitNode(zoomedIn.camera, size, all, 720, 450)?.id).toBe(anchor.id);
    const r = pickRadius(anchor, zoomedIn.camera.k);
    expect(hitNode(zoomedIn.camera, size, all, 720 + r - 0.5, 450)?.id).toBe(anchor.id);
    expect(hitNode(zoomedIn.camera, size, all, 720 + r + 0.5, 450)).toBeNull();
  });

  it("cluster label boxes: last painted wins", () => {
    const boxes = [
      { x0: 0, y0: 0, x1: 100, y1: 20, memberIds: ["a"] },
      { x0: 50, y0: 0, x1: 150, y1: 20, memberIds: ["b"] },
    ];
    expect(hitClusterLabel(boxes, 75, 10)?.memberIds).toEqual(["b"]);
    expect(hitClusterLabel(boxes, 25, 10)?.memberIds).toEqual(["a"]);
    expect(hitClusterLabel(boxes, 25, 30)).toBeNull();
  });
});
