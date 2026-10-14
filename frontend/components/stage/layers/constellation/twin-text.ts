/**
 * Label typography of the twin: the same font strings the 2D canvas measures
 * and paints with (`spaceTypeface` in KnowledgeCanvas, ported), and a text
 * measurer on a scratch Canvas2D context so collision boxes come from the very
 * same `measureText` the 2D canvas used.
 */

import type { LabelFaces } from "@/lib/graph/twin/buffers";

const FALLBACK: LabelFaces = {
  display: '"Zen Maru Gothic", "M PLUS Rounded 1c", sans-serif',
  ui: '"Instrument Sans", system-ui, sans-serif',
};

/** KnowledgeCanvas `spaceTypeface` for both faces: the loaded `--font-*` token, then the fallbacks. */
export function labelFaces(): LabelFaces {
  if (typeof document === "undefined") return FALLBACK;
  const style = getComputedStyle(document.documentElement);
  const pick = (token: string, fallback: string) => {
    const loaded = style.getPropertyValue(token).trim();
    return loaded ? `${loaded}, ${fallback}` : fallback;
  };
  return { display: pick("--font-display", FALLBACK.display), ui: pick("--font-ui", FALLBACK.ui) };
}

export interface TextMeasurer {
  measure(text: string, font: string): number;
  /**
   * Where Canvas2D puts the `textBaseline: "middle"` baseline below the anchor
   * `y` for this font, in px (the exact float Blink hands to Skia; read as the
   * difference of `actualBoundingBoxAscent` between the alphabetic and middle
   * baselines).
   */
  middleBaseline(font: string): number;
  /** Drop cached widths (after fonts finish loading). */
  reset(): void;
}

/**
 * Where a DOM block with this font and `line-height: size` puts its baseline
 * below its top edge, as Blink lays it out (integer half-leading, so this is
 * not `size/2 + (ascent − descent)/2`). Measured with a zero-height inline
 * marker inside a probe span attached to `host`.
 */
export function domBaselineOffset(host: HTMLElement, font: string, size: number): number {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;left:-10000px;top:0;display:block;white-space:nowrap;visibility:hidden;font:${font};line-height:${size}px;height:${size}px`;
  probe.textContent = "Hxg";
  const marker = document.createElement("span");
  marker.style.cssText = "display:inline-block;width:1px;height:0;vertical-align:baseline";
  probe.appendChild(marker);
  host.appendChild(probe);
  const offset = marker.getBoundingClientRect().top - probe.getBoundingClientRect().top;
  probe.remove();
  return offset;
}

/**
 * The `top` of a DOM label so that its baseline lands on the SAME float the 2D
 * canvas's `fillText(text, x, y)` with `textBaseline: "middle"` used: both
 * renderers then round it the same way, pixel for pixel.
 */
export function labelTop(y: number, canvasMiddleBaseline: number, domBaseline: number): number {
  return y + canvasMiddleBaseline - domBaseline;
}

export function createTextMeasurer(): TextMeasurer {
  let ctx: CanvasRenderingContext2D | null = null;
  const cache = new Map<string, number>();
  const baselines = new Map<string, number>();
  const context = () => {
    if (ctx) return ctx;
    if (typeof document === "undefined") return null;
    ctx = document.createElement("canvas").getContext("2d");
    return ctx;
  };
  return {
    measure(text, font) {
      const key = `${font}\u0000${text}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const c = context();
      if (!c) return text.length * 7;
      c.font = font;
      const width = c.measureText(text).width;
      cache.set(key, width);
      return width;
    },
    middleBaseline(font) {
      const hit = baselines.get(font);
      if (hit !== undefined) return hit;
      const c = context();
      if (!c) return 0;
      c.font = font;
      c.textBaseline = "alphabetic";
      const alphabetic = c.measureText("H").actualBoundingBoxAscent;
      c.textBaseline = "middle";
      const middle = c.measureText("H").actualBoundingBoxAscent;
      c.textBaseline = "alphabetic";
      const offset = alphabetic - middle;
      baselines.set(font, offset);
      return offset;
    },
    reset() {
      cache.clear();
      baselines.clear();
    },
  };
}
