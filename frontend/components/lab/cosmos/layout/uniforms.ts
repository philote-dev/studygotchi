import { Vector2 } from "three";

/**
 * Shared-by-reference uniforms for every map material. The composer writes
 * them once per frame. `uRes` is the pixel pass's low-resolution target size,
 * so one cell is one texel and vertex shaders can snap to the grid.
 */
export const MAP_UNIFORMS = {
  uTime: { value: 0 },
  uRes: { value: new Vector2(640, 360) },
  /** 0 = dark sky (additive), 1 = light sky (normal blend, toned). */
  uLight: { value: 0 },
};

export type MapTheme = "dark" | "light";
