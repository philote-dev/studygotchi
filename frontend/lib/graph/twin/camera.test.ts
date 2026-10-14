import { describe, expect, it } from "vitest";
import fixture from "./parity-fixture.json";
import { orthoFrom2D, projectThroughMatrix, screenFromWorld, viewProjectionMatrix, worldFromScreen } from "./camera";

const zoomedOut = fixture.states["zoomed-out"];
const zoomedIn = fixture.states["zoomed-in"];

/**
 * The 2D canvas recorded its cluster-label hit boxes in screen space: the box
 * is centred on the label anchor, which sits 18 px above the cluster centre and
 * is then padded symmetrically (±3 / ±2, then ±10 / ±8). So the recorded centre
 * is an independent reading of `screenFromWorld(cluster)`.
 */
function recordedCentre(box: { x0: number; y0: number; x1: number; y1: number }) {
  return { sx: (box.x0 + box.x1) / 2, sy: (box.y0 + box.y1) / 2 + 18 };
}

describe("twin camera: world -> screen matches the 2D canvas", () => {
  it("screenFromWorld reproduces the recorded cluster label positions (dpr 1)", () => {
    for (const box of zoomedOut.clusterLabelBoxes) {
      const cluster = zoomedOut.clusters.find((c) => c.id === box.clusterId)!;
      const want = recordedCentre(box);
      const got = screenFromWorld(zoomedOut.camera, zoomedOut.size, cluster.x, cluster.y);
      expect(Math.abs(got.sx - want.sx)).toBeLessThan(0.5);
      expect(Math.abs(got.sy - want.sy)).toBeLessThan(0.5);
    }
    expect(zoomedOut.clusterLabelBoxes.length).toBeGreaterThanOrEqual(6);
  });

  it("the ortho matrix projects every recorded label to the same CSS px at dpr 1 and dpr 2", () => {
    const m = viewProjectionMatrix(orthoFrom2D(zoomedOut.camera, zoomedOut.size));
    for (const dpr of [1, 2]) {
      const boxes = dpr === 1 ? zoomedOut.clusterLabelBoxes : zoomedOut.clusterLabelBoxesAt2x;
      for (const box of boxes) {
        const cluster = zoomedOut.clusters.find((c) => c.id === box.clusterId)!;
        const want = recordedCentre(box);
        const css = projectThroughMatrix(m, zoomedOut.size, cluster.x, cluster.y);
        // Device pixels are CSS px × dpr on both renderers; the tolerance is 0.5 device px.
        expect(Math.abs(css.sx * dpr - want.sx * dpr)).toBeLessThan(0.5);
        expect(Math.abs(css.sy * dpr - want.sy * dpr)).toBeLessThan(0.5);
      }
    }
  });

  it("the ortho matrix equals screenFromWorld for sample nodes at both zooms", () => {
    for (const state of [zoomedOut, zoomedIn]) {
      const m = viewProjectionMatrix(orthoFrom2D(state.camera, state.size));
      for (const node of state.sampleNodes) {
        const want = screenFromWorld(state.camera, state.size, node.x, node.y);
        const got = projectThroughMatrix(m, state.size, node.x, node.y);
        expect(got.sx).toBeCloseTo(want.sx, 6);
        expect(got.sy).toBeCloseTo(want.sy, 6);
      }
    }
  });

  it("zoomed-in: the camera sits on the hover anchor, which lands at the canvas centre", () => {
    const { camera, size, anchorNode } = zoomedIn;
    expect(camera.x).toBe(anchorNode.x);
    expect(camera.y).toBe(anchorNode.y);
    const m = viewProjectionMatrix(orthoFrom2D(camera, size));
    const got = projectThroughMatrix(m, size, anchorNode.x, anchorNode.y);
    expect(got.sx).toBeCloseTo(720, 6);
    expect(got.sy).toBeCloseTo(450, 6);
  });

  it("world +y runs down the screen and the frustum is w/k by h/k", () => {
    const f = orthoFrom2D({ x: 0, y: 0, k: 2 }, { w: 1440, h: 900 });
    expect(f.right - f.left).toBeCloseTo(720);
    expect(f.bottom - f.top).toBeCloseTo(450);
    expect(f.top).toBeLessThan(f.bottom);
    const m = viewProjectionMatrix(f);
    const below = projectThroughMatrix(m, { w: 1440, h: 900 }, 0, 10);
    expect(below.sy).toBeCloseTo(470);
    expect(below.sx).toBeCloseTo(720);
  });

  it("worldFromScreen inverts screenFromWorld", () => {
    const cam = zoomedOut.camera;
    const size = zoomedOut.size;
    const s = screenFromWorld(cam, size, 123.4, -56.7);
    const w = worldFromScreen(cam, size, s.sx, s.sy);
    expect(w.x).toBeCloseTo(123.4, 9);
    expect(w.y).toBeCloseTo(-56.7, 9);
  });
});
