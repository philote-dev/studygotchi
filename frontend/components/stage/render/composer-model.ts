/**
 * Pure model of the stage composer's two render paths. No three.js, no React:
 * vitest runs it as is, and `StageComposer` reads its numbers.
 *
 * PIXEL path: the sky (with the hop streaks and the constellation-rung
 * scenery), the planet and the open land render into low-resolution targets
 * at the stage grain, `pixel` CSS px per cell (2 at rest, 3 while a hop is
 * fast), then nearest-upscale to the screen: the `RenderPixelatedPass` look
 * the globe and the ice land shipped with. The cell is measured in CSS px so
 * the look is resolution-independent (the creative-tooling rule): 2 device
 * px at dpr 1, 4 at dpr 2; a Retina screen shows the same blocks, not blocks
 * half the size.
 *
 * NATIVE path: the galaxy rung (blobs, bead anchors, scenery) renders at
 * device resolution over the upscaled sky inside a native target, so its
 * points are crisp glyphs and its glows smooth. The constellation twin is
 * its own full-resolution canvas and never touches the composer.
 */

export type PassPath = "pixel" | "native";

export type StagePassLayer = "sky" | "streaks" | "constellation-scenery" | "planet" | "world" | "clouds" | "galaxy" | "twin";

/** Which path every layer of the stage renders through. */
export const STAGE_PASS_PATHS: Readonly<Record<StagePassLayer, PassPath>> = {
  sky: "pixel",
  streaks: "pixel",
  "constellation-scenery": "pixel",
  planet: "pixel",
  world: "pixel",
  clouds: "pixel",
  galaxy: "native",
  twin: "native",
};

/** The three.js object layer the galaxy subtree lives on, so the sky render (camera layer 0) skips it and the native render draws only it. */
export const NATIVE_OBJECT_LAYER = 1;
export const PIXEL_OBJECT_LAYER = 0;

/**
 * The stage grain at rest, CSS px per cell: the globe's `PRODUCTION_PIXEL_GRAIN`
 * (what its own `RenderPixelatedPass` shipped with, kept by gate 1 on
 * 2026-10-13: "just don't forget that it's pixelated"). `HopDriver` raises it
 * to `HOP_GRAIN_CSS_PX` while a hop is fast (`pixelFor` in `lib/stage/altitude`).
 */
export const REST_GRAIN_CSS_PX = 2;
export const HOP_GRAIN_CSS_PX = 3;

/** Device px per cell for a grain of `pixelCss` CSS px at `dpr` (integer, at least 1). */
export function cellDevicePx(pixelCss: number, dpr: number): number {
  return Math.max(1, Math.round(pixelCss * dpr));
}

/**
 * The planet pass's grain as it lands on screen: the cell in device px and in
 * CSS px (`cell / dpr`). The pixelation guarantee: `cssPerCell` is the grain
 * the frame asked for at every dpr (2 at rest, 3 on the hop ramp), so a
 * Retina screen shows the same blocks as a 1x screen and a dpr drop
 * (`PerformanceMonitor`) changes the device px per cell, never the cell's CSS
 * size or the target's cell count.
 */
export function planetPassGrain(pixelCss: number, dpr: number): { cell: number; cssPerCell: number } {
  const cell = cellDevicePx(pixelCss, dpr);
  return { cell, cssPerCell: cell / dpr };
}

export interface TargetSize {
  w: number;
  h: number;
}

/**
 * The low-res target for a pixel-path pass covering `wCss` x `hCss` CSS px:
 * `RenderPixelatedPass.setSize`'s `(deviceSize / cell) | 0`.
 */
export function pixelTargetSize(wCss: number, hCss: number, dpr: number, pixelCss: number): TargetSize & { cell: number } {
  const cell = cellDevicePx(pixelCss, dpr);
  return {
    cell,
    w: Math.max(1, Math.floor((wCss * dpr) / cell)),
    h: Math.max(1, Math.floor((hCss * dpr) / cell)),
  };
}

/** The land's pass is sized to its host box (fractions of the canvas), like its own `PixelComposer` was sized to its canvas. */
export function hostDeviceSize(box: { w: number; h: number }, wCss: number, hCss: number, dpr: number): TargetSize {
  return {
    w: Math.max(1, Math.round(box.w * wCss * dpr)),
    h: Math.max(1, Math.round(box.h * hCss * dpr)),
  };
}

/** Whether the frame needs the native path: only while the galaxy subtree is shown (its rung root is visible). */
export function nativePathWanted(galaxyShown: boolean): boolean {
  return galaxyShown;
}
