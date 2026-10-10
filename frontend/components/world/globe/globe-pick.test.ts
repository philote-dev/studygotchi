import { describe, expect, it } from "vitest";
import {
  globeLayoutSize,
  globePointerNdc,
  isGlobeLandmarkFacing,
  pickGlobeLandmark,
  resolveGlobePointerUp,
} from "./globe-pick";

/** Unit planet at the origin. Camera sits on +Z, well outside the sphere. */
const CENTER = { x: 0, y: 0, z: 0 };
const CAMERA = { x: 0, y: 0, z: 8 };
const FRONT = { id: "front", position: { x: 0, y: 0, z: 1.1 } };
const BACK = { id: "back", position: { x: 0, y: 0, z: -1.1 } };
/** Visual limb: N·(camera − center) = R/D = 0.125. Facing-dot is ~0. */
const LIMB = { id: "limb", position: { x: 0.9921567, y: 0, z: 0.125 } };

const THROUGH_PLANET = {
  rayOrigin: CAMERA,
  rayDirection: { x: 0, y: 0, z: -1 },
  camera: CAMERA,
  globeCenter: CENTER,
};

describe("globe landmark pick", () => {
  it("picks the camera-facing landmark near the pointer", () => {
    expect(
      pickGlobeLandmark({
        ...THROUGH_PLANET,
        landmarks: [FRONT, BACK],
      }),
    ).toBe("front");
  });

  it("rejects a far-side landmark even when the ray goes through the planet", () => {
    expect(
      pickGlobeLandmark({
        ...THROUGH_PLANET,
        landmarks: [BACK],
      }),
    ).toBeNull();
    expect(isGlobeLandmarkFacing(BACK.position, CENTER, CAMERA)).toBe(false);
  });

  it("still picks a facing landmark on the visual limb", () => {
    expect(isGlobeLandmarkFacing(LIMB.position, CENTER, CAMERA)).toBe(true);
    expect(
      pickGlobeLandmark({
        rayOrigin: CAMERA,
        rayDirection: {
          x: LIMB.position.x,
          y: 0,
          z: LIMB.position.z - CAMERA.z,
        },
        camera: CAMERA,
        globeCenter: CENTER,
        landmarks: [LIMB, BACK],
      }),
    ).toBe("limb");
  });

  it("returns the same id for hover and click from one pointer", () => {
    const pointer = {
      ...THROUGH_PLANET,
      landmarks: [FRONT, BACK, LIMB],
    };
    const hoverId = pickGlobeLandmark({ ...pointer, intent: "hover" });
    const clickId = pickGlobeLandmark({ ...pointer, intent: "click" });
    expect(hoverId).toBe("front");
    expect(clickId).toBe(hoverId);
  });

  it("does not pick a facing landmark outside the tight pointer radius", () => {
    const aside = { id: "aside", position: { x: 2, y: 0, z: 1 } };
    expect(isGlobeLandmarkFacing(aside.position, CENTER, CAMERA)).toBe(true);
    expect(
      pickGlobeLandmark({
        ...THROUGH_PLANET,
        landmarks: [aside],
      }),
    ).toBeNull();
  });

  it("picks a facing landmark inside the screen radius even if the world ray is loose", () => {
    const aside = {
      id: "aside",
      position: { x: 2, y: 0, z: 1 },
      screen: { x: 400, y: 300 },
    };
    expect(
      pickGlobeLandmark({
        ...THROUGH_PLANET,
        landmarks: [aside],
        pointer: { x: 430, y: 320 },
        maxScreenPx: 64,
      }),
    ).toBe("aside");
  });

  it("rejects a facing landmark outside the 64px screen radius", () => {
    const aside = {
      id: "aside",
      position: { x: 2, y: 0, z: 1 },
      screen: { x: 400, y: 300 },
    };
    expect(
      pickGlobeLandmark({
        ...THROUGH_PLANET,
        landmarks: [aside],
        pointer: { x: 520, y: 420 },
        maxScreenPx: 64,
      }),
    ).toBeNull();
  });

  it("uses layout pixels for NDC, not a CSS-transformed bounding rect", () => {
    const layout = globeLayoutSize({ clientWidth: 1280, clientHeight: 900 });
    expect(layout).toEqual({ width: 1280, height: 900 });
    const ndc = globePointerNdc(947.2, 522, layout);
    expect(ndc.x).toBeCloseTo(0.48, 5);
    expect(ndc.y).toBeCloseTo(-0.16, 5);
    expect(Math.abs(ndc.x)).toBeLessThan(1);
    expect(Math.abs(ndc.y)).toBeLessThan(1);
    const poisoned = globePointerNdc(947.2, 522, { width: 488, height: 343 });
    expect(Math.abs(poisoned.x)).toBeGreaterThan(1);
  });

  it("selects a facing landmark on pointer up even if the pointer moved a few pixels", () => {
    expect(
      resolveGlobePointerUp({
        facingLandmarkId: "island-a",
        travelPx: 12,
      }),
    ).toEqual({ type: "select", courseId: "island-a" });
  });

  it("settles only when the gesture spun and the pointer is not on a town", () => {
    expect(
      resolveGlobePointerUp({
        facingLandmarkId: null,
        travelPx: 40,
      }),
    ).toEqual({ type: "settle" });
    expect(
      resolveGlobePointerUp({
        facingLandmarkId: null,
        travelPx: 2,
      }),
    ).toEqual({ type: "none" });
  });
});
