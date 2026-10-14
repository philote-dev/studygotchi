"use client";

import { useMemo } from "react";
import { mulberry32 } from "../lib/rng";
import { PointWriter, SHAPE, usePointsGeometry, usePointsMaterial, type PointBuffers } from "../lib/points";
import type { ObjectTheme } from "../lib/types";

export const BACKDROP = {
  dark: { sky: "#080716", star: "#fff6df", soft: "#8f93b8", warm: "#ffe6a8", blue: "#b8dcff" },
  light: { sky: "#cfd6e4", star: "#17151d", soft: "#6b6a86", warm: "#5a4a2a", blue: "#2f3f6a" },
} as const;

/** Budget: 1 draw, width * height / 2600 points (1280 x 800 -> ~390), 1 in 18 a 3-cell plus star. */
export function backdropPoints(seed: number, width: number, height: number, theme: ObjectTheme): PointBuffers {
  const rng = mulberry32(seed ^ 0xbacd);
  const n = Math.max(40, Math.round((width * height) / 2600));
  const w = new PointWriter(n);
  const p = BACKDROP[theme];
  for (let i = 0; i < n; i++) {
    const x = (rng() - 0.5) * width;
    const y = (rng() - 0.5) * height;
    const big = i % 18 === 0;
    const roll = rng();
    const c = big ? (roll < 0.3 ? p.warm : roll < 0.55 ? p.blue : p.star) : roll < 0.6 ? p.soft : p.star;
    w.push(x, y, 0, c, big ? 3 : 1, rng(), big ? SHAPE.plus : SHAPE.cell);
  }
  return w.finish();
}

/** Grain stars behind the exhibits, in viewport px, dimmed so the objects are the subject. */
export function StarBackdrop({ seed, width, height, theme, fade = 0.55 }: { seed: number; width: number; height: number; theme: ObjectTheme; fade?: number }) {
  const buffers = useMemo(() => backdropPoints(seed, width, height, theme), [seed, width, height, theme]);
  const geometry = usePointsGeometry(buffers);
  const material = usePointsMaterial({ theme, fade });
  return <points geometry={geometry} material={material} position={[0, 0, -600]} frustumCulled={false} renderOrder={-10} />;
}
