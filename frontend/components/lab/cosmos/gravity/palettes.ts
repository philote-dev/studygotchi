/**
 * Gravity palettes. Black hole swatches are the EHT / Schnittman ramp from
 * docs/design/world/refs/space/LEDGER.md (11, 12, 13, 13b); the white hole is
 * the deliberate mirror (cool cyan and cream on dark, ink and Saturn blue on
 * paper); the wormhole is Launch Star lilac and cream with a cyan rim.
 */
import type { GravityTheme } from "./lib/uniforms";

export const SKY = {
  dark: "#080716",
  light: "#cfd6e4",
  starDark: "#fff6df",
  starSoftDark: "#b9d8ea",
  starWarm: "#ffe6a8",
  starBlue: "#b8dcff",
  starLight: "#17151d",
  starSoftLight: "#4a4760",
} as const;

export interface BlackHolePalette {
  gold: string;
  amber: string;
  edge: string;
  dim: string;
  rim: string;
  flash: string;
  jet: string;
  feed: string;
}

export const BLACK_HOLE: Record<GravityTheme, BlackHolePalette> = {
  dark: { gold: "#ffd36a", amber: "#f6ac3d", edge: "#e58a2c", dim: "#a81e08", rim: "#131a3a", flash: "#fff0c2", jet: "#9fd3ff", feed: "#ffc24a" },
  light: { gold: "#d9a92e", amber: "#dc756f", edge: "#b85a3a", dim: "#4f6ea8", rim: "#17151d", flash: "#ffffff", jet: "#3b5aa0", feed: "#b85a3a" },
};

export interface WhiteHolePalette {
  core: string;
  band1: string;
  band2: string;
  band3: string;
  ray: string;
  particle: string;
  particleAlt: string;
  shock: string;
  flash: string;
}

export const WHITE_HOLE: Record<GravityTheme, WhiteHolePalette> = {
  dark: { core: "#ffffff", band1: "#fff8e6", band2: "#a6ecf5", band3: "#5fb9dc", ray: "#8ad7ea", particle: "#c6f3ff", particleAlt: "#fff0c2", shock: "#e6fbff", flash: "#eafcff" },
  light: { core: "#ffffff", band1: "#eef7fb", band2: "#8fc6e0", band3: "#4f6ea8", ray: "#5b5884", particle: "#17151d", particleAlt: "#4f6ea8", shock: "#2e3f78", flash: "#ffffff" },
};

export interface WormholePalette {
  rimOuter: string;
  rimMid: string;
  rimInner: string;
  sparkle: string;
  sparkleAlt: string;
  innerTint: string;
  flash: string;
}

export const WORMHOLE: Record<GravityTheme, WormholePalette> = {
  dark: { rimOuter: "#5a4a9a", rimMid: "#c6baec", rimInner: "#fff0c2", sparkle: "#ffe6a8", sparkleAlt: "#8ad7ea", innerTint: "#9c8fd8", flash: "#f4efff" },
  light: { rimOuter: "#5b5884", rimMid: "#8f88c0", rimInner: "#ffffff", sparkle: "#d9a92e", sparkleAlt: "#4f6ea8", innerTint: "#3b3560", flash: "#ffffff" },
};

/** Faint Einstein-ring tint for the shared lens pass. */
export const LENS_RING = { dark: "#fff0c2", light: "#2a2640" } as const;
