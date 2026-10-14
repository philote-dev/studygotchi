/**
 * Sky colours for the stage, adapted from the lab palettes
 * (components/lab/space/galaxy/palettes.ts, cosmos/objects/*) to the product's
 * sky tokens in globals.css (`--space-bg`, `--space-star`, `--space-star-soft`,
 * `--space-nebula`). The star tokens are resolved from CSS at runtime so the
 * grain stars match SpaceField exactly; everything below is the far dressing.
 * References: docs/design/world/refs/space/LEDGER.md.
 */
import type { StageTheme } from "../../lib/uniforms";

/** Linear-light rgb + straight alpha. */
export type Rgba = readonly [number, number, number, number];

export interface SkyTokens {
  /** CSS colour strings as resolved from the document (fallbacks mirror globals.css). */
  star: string;
  starSoft: string;
  nebula: string;
  bg: string;
}

export const SKY_TOKEN_FALLBACK: Record<StageTheme, SkyTokens> = {
  dark: { star: "rgb(255, 246, 223)", starSoft: "rgba(185, 216, 234, 0.68)", nebula: "rgba(88, 64, 140, 0.38)", bg: "rgb(8, 7, 22)" },
  light: { star: "rgb(23, 21, 29)", starSoft: "rgba(23, 21, 29, 0.42)", nebula: "rgba(168, 142, 196, 0.22)", bg: "rgb(207, 214, 228)" },
};

/** Near-layer plus-star tints (dark sky only; the light sky keeps ink). */
export const STAR_TINTS = { warm: "#ffe6a8", blue: "#b8dcff" } as const;

export interface GalaxyPalette {
  id: string;
  core: string;
  arm: string;
  tip: string;
  bead: string;
  beadAlt: string;
  /** Bulge glow anchors, dim -> bright. */
  glow: readonly [string, string, string];
}

export const GALAXY_PALETTES: readonly GalaxyPalette[] = [
  { id: "m51", core: "#e9cfa0", arm: "#aebcd0", tip: "#c6d4e8", bead: "#e06a7c", beadAlt: "#8ad7ea", glow: ["#5a4a7a", "#b89a6a", "#f0d9a8"] },
  { id: "m101", core: "#f3e2c2", arm: "#c9d6e6", tip: "#8fb0d8", bead: "#8fb0d8", beadAlt: "#dfe8ff", glow: ["#3f4f86", "#c9b48a", "#f3e2c2"] },
  { id: "orion-dream", core: "#fff0c2", arm: "#a99bd6", tip: "#8ad7ea", bead: "#e9a6c9", beadAlt: "#8ad7ea", glow: ["#58408c", "#c9a0b0", "#fff0c2"] },
];

export interface NebulaPalette {
  deep: string;
  mid: string;
  bright: string;
  heart: string;
  dust: string;
  stars: readonly string[];
}

export const NEBULA_PALETTES: Record<string, NebulaPalette> = {
  orion: { deep: "#2a1a33", mid: "#8a5a7a", bright: "#d87a8a", heart: "#fff4e0", dust: "#140a14", stars: ["#ffffff", "#b8dcff", "#f2a7c6", "#dfe8ff"] },
  carina: { deep: "#0f1f4d", mid: "#2e4f9c", bright: "#6f8fc0", heart: "#dfe8ff", dust: "#0a1230", stars: ["#ffffff", "#f2a7c6", "#dfe8ff", "#b8dcff"] },
};

export interface PlanetaryPalette {
  inner: string;
  a: string;
  b: string;
  c: string;
  dwarf: string;
}

export const PLANETARY_PALETTES: Record<string, PlanetaryPalette> = {
  ring: { inner: "#4fb0c0", a: "#b8d070", b: "#e8963a", c: "#c0401a", dwarf: "#ffffff" },
  butterfly: { inner: "#fff0c2", a: "#f0a060", b: "#e06a7c", c: "#a04ab0", dwarf: "#ffffff" },
  cat: { inner: "#dfe8ff", a: "#6fd3f0", b: "#f0d9a8", c: "#e8963a", dwarf: "#ffffff" },
};

export const CLUSTER_PALETTE = {
  stars: ["#ffffff", "#dfe8ff", "#b8dcff", "#cfe4ff"],
  bright: "#dff0ff",
  glow: ["#1b2a5e", "#3f5fa6", "#8fb0d8"] as const,
} as const;

export const SMUDGE_PALETTE = ["#e8cf9a", "#f0d9a8", "#c9d6e6", "#8fb0d8", "#e9a6c9"] as const;
export const SMUDGE_CORE = "#fff0c2";

/** Parse `rgb(...)` / `rgba(...)` / `#rrggbb` into 0..1 sRGB components + alpha. */
export function parseCssColor(value: string): [number, number, number, number] | null {
  const v = value.trim();
  const m = v.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts.length >= 4 ? parts[3] : 1];
  }
  const h = v.match(/^#([0-9a-f]{6})$/i);
  if (h) {
    const n = parseInt(h[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }
  return null;
}
