import { describe, expect, it } from "vitest";
import { PRODUCTION_PIXEL_GRAIN } from "@/components/world/globe/globe-spec";
import { pixelFor } from "@/lib/stage/altitude";
import {
  cellDevicePx,
  HOP_GRAIN_CSS_PX,
  hostDeviceSize,
  NATIVE_OBJECT_LAYER,
  nativePathWanted,
  PIXEL_OBJECT_LAYER,
  pixelTargetSize,
  planetPassGrain,
  REST_GRAIN_CSS_PX,
  STAGE_PASS_PATHS,
} from "./composer-model";

describe("stage composer pass model", () => {
  it("sends the pixel-look layers through the pixel path and the galaxy and twin through the native path", () => {
    expect(STAGE_PASS_PATHS.sky).toBe("pixel");
    expect(STAGE_PASS_PATHS.planet).toBe("pixel");
    expect(STAGE_PASS_PATHS.world).toBe("pixel");
    expect(STAGE_PASS_PATHS.clouds).toBe("pixel");
    expect(STAGE_PASS_PATHS.streaks).toBe("pixel");
    expect(STAGE_PASS_PATHS["constellation-scenery"]).toBe("pixel");
    expect(STAGE_PASS_PATHS.galaxy).toBe("native");
    expect(STAGE_PASS_PATHS.twin).toBe("native");
  });

  it("keeps the galaxy on its own object layer, apart from the sky's", () => {
    expect(NATIVE_OBJECT_LAYER).not.toBe(PIXEL_OBJECT_LAYER);
    expect(PIXEL_OBJECT_LAYER).toBe(0);
  });

  it("measures the grain in CSS px: 2 device px per cell at dpr 1, 4 at dpr 2 (resolution-independent)", () => {
    expect(cellDevicePx(2, 1)).toBe(2);
    expect(cellDevicePx(2, 2)).toBe(4);
    expect(cellDevicePx(3, 2)).toBe(6);
    expect(cellDevicePx(2, 1.5)).toBe(3);
    expect(cellDevicePx(1, 0.5)).toBe(1);
  });

  it("sizes the pixel-path targets like RenderPixelatedPass.setSize: (device size / cell) | 0, the same cell count at dpr 1 and 2", () => {
    expect(pixelTargetSize(1440, 900, 1, 2)).toEqual({ cell: 2, w: 720, h: 450 });
    expect(pixelTargetSize(1440, 900, 2, 2)).toEqual({ cell: 4, w: 720, h: 450 });
    // The hop's fast grain: 3 CSS px per cell.
    expect(pixelTargetSize(1440, 900, 1, 3)).toEqual({ cell: 3, w: 480, h: 300 });
    expect(pixelTargetSize(1440, 900, 2, 3)).toEqual({ cell: 6, w: 480, h: 300 });
    // Odd sizes floor, never round up past the canvas.
    expect(pixelTargetSize(1439, 899, 1, 2)).toEqual({ cell: 2, w: 719, h: 449 });
    expect(pixelTargetSize(1, 1, 1, 2)).toEqual({ cell: 2, w: 1, h: 1 });
  });

  it("sizes the land's pass to its host box in device px, like its own canvas", () => {
    expect(hostDeviceSize({ w: 1, h: 1 }, 1440, 900, 1)).toEqual({ w: 1440, h: 900 });
    expect(hostDeviceSize({ w: 0.5, h: 0.5 }, 1440, 900, 2)).toEqual({ w: 1440, h: 900 });
    expect(hostDeviceSize({ w: 0, h: 0 }, 1440, 900, 1)).toEqual({ w: 1, h: 1 });
  });

  it("wants the native path only while the galaxy is shown", () => {
    expect(nativePathWanted(false)).toBe(false);
    expect(nativePathWanted(true)).toBe(true);
  });

  describe("pixelation guarantee (gate 1, 2026-10-13): the planet pass grain is 2 CSS px per cell at rest", () => {
    it("the rest grain is the globe's PRODUCTION_PIXEL_GRAIN and the hop ramp's fast grain is pixelFor's 3", () => {
      expect(REST_GRAIN_CSS_PX).toBe(2);
      expect(REST_GRAIN_CSS_PX).toBe(PRODUCTION_PIXEL_GRAIN);
      expect(HOP_GRAIN_CSS_PX).toBe(3);
      // `pixelFor` only ever answers with the two grains.
      expect(pixelFor(0, 2)).toBe(REST_GRAIN_CSS_PX);
      expect(pixelFor(2, 2)).toBe(HOP_GRAIN_CSS_PX);
      expect(pixelFor(0, 3)).toBe(REST_GRAIN_CSS_PX);
    });

    it("is 2 CSS px per cell at dpr 1 and 2 (2 and 4 device px), and 3 during the hop ramp", () => {
      expect(planetPassGrain(REST_GRAIN_CSS_PX, 1)).toEqual({ cell: 2, cssPerCell: 2 });
      expect(planetPassGrain(REST_GRAIN_CSS_PX, 2)).toEqual({ cell: 4, cssPerCell: 2 });
      expect(planetPassGrain(REST_GRAIN_CSS_PX, 3)).toEqual({ cell: 6, cssPerCell: 2 });
      expect(planetPassGrain(HOP_GRAIN_CSS_PX, 1)).toEqual({ cell: 3, cssPerCell: 3 });
      expect(planetPassGrain(HOP_GRAIN_CSS_PX, 2)).toEqual({ cell: 6, cssPerCell: 3 });
      expect(planetPassGrain(HOP_GRAIN_CSS_PX, 3)).toEqual({ cell: 9, cssPerCell: 3 });
    });

    it("a PerformanceMonitor dpr drop (2 -> 1) keeps the cell at 2 CSS px and the planet target at the same cell count", () => {
      const native = pixelTargetSize(1440, 900, 2, REST_GRAIN_CSS_PX);
      const dropped = pixelTargetSize(1440, 900, 1, REST_GRAIN_CSS_PX);
      expect(native).toEqual({ cell: 4, w: 720, h: 450 });
      expect(dropped).toEqual({ cell: 2, w: 720, h: 450 });
      expect(planetPassGrain(REST_GRAIN_CSS_PX, 2).cssPerCell).toBe(planetPassGrain(REST_GRAIN_CSS_PX, 1).cssPerCell);
      // And mid-hop at the fast grain.
      expect(pixelTargetSize(1440, 900, 2, HOP_GRAIN_CSS_PX)).toEqual({ cell: 6, w: 480, h: 300 });
      expect(pixelTargetSize(1440, 900, 1, HOP_GRAIN_CSS_PX)).toEqual({ cell: 3, w: 480, h: 300 });
    });
  });
});
