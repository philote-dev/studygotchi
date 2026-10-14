/**
 * Galaxy palettes read off the NASA / ESA / ESO references in
 * docs/design/world/refs/space/LEDGER.md (estimated swatches, see that file
 * for credits). Each palette is one "colour story": warm core, cooler arm,
 * bluer tips, pink or blue beads, brown dust, a warm companion.
 *
 * Adds the OBAFGKM stellar classes (one quantised list per theme, so every
 * star in a theme is one of eight colours), `inkify()`, the light-theme
 * darkening used for glow colours, and the per-theme course palette for the
 * beads on the arms. Product module (moved from `components/lab/cosmos/
 * galaxy/palettes.ts`; bead swatches from the outer-zone lab's palettes).
 */
import { Color } from "three";

export type GalaxyTheme = "dark" | "light";

export interface GalaxyPalette {
  id: string;
  ref: string;
  core: string;
  arm: string;
  tip: string;
  bead: string;
  beadAlt: string;
  dust: string;
  companion: string;
  haze: string;
}

export const GALAXY_PALETTES: readonly GalaxyPalette[] = [
  {
    id: "m51",
    ref: "02-m51-whirlpool-hubble.jpg",
    core: "#e9cfa0",
    arm: "#aebcd0",
    tip: "#c6d4e8",
    bead: "#e06a7c",
    beadAlt: "#8ad7ea",
    dust: "#3e2a24",
    companion: "#f0d9a8",
    haze: "#5a4a7a",
  },
  {
    id: "m101",
    ref: "01-m101-pinwheel-hubble.jpg",
    core: "#f3e2c2",
    arm: "#c9d6e6",
    tip: "#8fb0d8",
    bead: "#8fb0d8",
    beadAlt: "#dfe8ff",
    dust: "#5a3e35",
    companion: "#e8cf9a",
    haze: "#3f4f86",
  },
  {
    id: "ngc1300",
    ref: "03-ngc1300-barred-spiral-hubble.jpg",
    core: "#f2c9a4",
    arm: "#9fb6d6",
    tip: "#c7d6ea",
    bead: "#d9b58f",
    beadAlt: "#8ad7ea",
    dust: "#6b3f3a",
    companion: "#f0d9a8",
    haze: "#4a3f6a",
  },
  {
    id: "m31",
    ref: "05-m31-andromeda-mosaic-hubble.jpg",
    core: "#f0d6a6",
    arm: "#b89a7a",
    tip: "#6f8fc0",
    bead: "#6f8fc0",
    beadAlt: "#e9a6c9",
    dust: "#3a2a26",
    companion: "#e8cf9a",
    haze: "#4f4a6a",
  },
  {
    id: "orion-dream",
    ref: "09-orion-nebula-hubble.jpg (sky tint) + SPIRAL_PALETTE",
    core: "#fff0c2",
    arm: "#a99bd6",
    tip: "#8ad7ea",
    bead: "#e9a6c9",
    beadAlt: "#8ad7ea",
    dust: "#131a3a",
    companion: "#ffe6a8",
    haze: "#58408c",
  },
];

export const SKY = {
  dark: "#080716",
  light: "#cfd6e4",
  starDark: "#fff6df",
  starSoftDark: "#b9d8ea",
  starLight: "#17151d",
  starSoftLight: "#4a4760",
  milkyWay: "#e6dcc8",
  milkyWayDust: "#4a3426",
} as const;

export const BLACK_HOLE_PALETTE = {
  dark: { gold: "#ffd36a", amber: "#f6ac3d", edge: "#e58a2c", dim: "#a81e08", rim: "#131a3a", flash: "#fff0c2" },
  light: { gold: "#d9a92e", amber: "#dc756f", edge: "#b85a3a", dim: "#4f6ea8", rim: "#17151d", flash: "#ffffff" },
} as const;

/**
 * OBAFGKM, cute edition. Index = stellar class attribute on every point.
 * 0 O/B blue-white (young arms, open clusters), 1 A white, 2 F cream,
 * 3 G gold, 4 K orange (bulge, halo), 5 M red giant (sprinkled),
 * 6 HII pink, 7 HII alt (cyan / magenta per palette).
 * Exactly eight colours per theme: the light list is ink on cream paper, not
 * a filter of the dark list, so each theme is tuned by eye.
 */
export const STELLAR_CLASS = { OB: 0, A: 1, F: 2, G: 3, K: 4, M: 5, HII: 6, HII_ALT: 7 } as const;
export const STELLAR_DARK: readonly string[] = ["#9fc5ff", "#dfe8ff", "#fff6df", "#f7d78a", "#eeae7a", "#e07a6a", "#e06a7c", "#8ad7ea"];
export const STELLAR_LIGHT: readonly string[] = ["#3b5fa8", "#4a4770", "#17151d", "#a0781e", "#a85a2a", "#8a2e2e", "#b8405a", "#2e7d93"];

const hsl = { h: 0, s: 0, l: 0 };

/** Light-theme version of a glow colour: ink on paper. Deterministic, no theme filter. */
export function inkify(hex: string, lightness = 0.34): string {
  const c = new Color(hex);
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.25 + 0.08), Math.min(lightness, Math.max(0.14, hsl.l * 0.5)));
  return `#${c.getHexString()}`;
}

/** Stellar class list for a theme, with the two HII slots taken from the palette. */
export function stellarColors(theme: GalaxyTheme, palette: GalaxyPalette): string[] {
  const base = theme === "dark" ? [...STELLAR_DARK] : [...STELLAR_LIGHT];
  base[STELLAR_CLASS.HII] = theme === "dark" ? palette.bead : inkify(palette.bead, 0.36);
  base[STELLAR_CLASS.HII_ALT] = theme === "dark" ? palette.beadAlt : inkify(palette.beadAlt, 0.36);
  return base;
}

/**
 * Course beads on the arms (outer-zone lab swatches: 27 Hurt map, 24
 * Westerlund 2, 23 Omega Centauri). Dark is additive light on indigo; light is
 * ink on paper. The current course owns the only saturated gold on the rung.
 */
export interface CoursePalette {
  sky: string;
  /** Bead glow at mastery 0 (cool lilac) and 1 (warm cream). */
  beadCool: string;
  beadWarm: string;
  /** One-cell core of a plain bead and the planet core of a course with a world. */
  beadCore: string;
  beadWorldCore: string;
  /** The "you are here" ring and the current bead's glow tint. */
  youAreHere: string;
  ringHover: string;
  /** Archived courses in the halo. */
  globularGlow: string;
  globularCore: string;
}

export const COURSE_PALETTES: Record<GalaxyTheme, CoursePalette> = {
  dark: {
    sky: SKY.dark,
    beadCool: "#a99bd6",
    beadWarm: "#ffe6a8",
    beadCore: "#fffaf0",
    beadWorldCore: "#8fb0d8",
    youAreHere: "#ffd36a",
    ringHover: "#c6baec",
    globularGlow: "#e9e6e0",
    globularCore: "#f0ece0",
  },
  light: {
    sky: SKY.light,
    beadCool: "#8f86c8",
    beadWarm: "#f2c56a",
    beadCore: "#2a2436",
    beadWorldCore: "#5f7fb8",
    youAreHere: "#f0b63a",
    ringHover: "#6a6690",
    globularGlow: "#e0dcd8",
    globularCore: "#4a4760",
  },
};

/** Both themes of every palette the galaxy rung uses, for callers that switch at runtime. */
export const GALAXY_THEMES = {
  dark: { sky: SKY.dark, star: SKY.starDark, starSoft: SKY.starSoftDark, stellar: STELLAR_DARK, course: COURSE_PALETTES.dark },
  light: { sky: SKY.light, star: SKY.starLight, starSoft: SKY.starSoftLight, stellar: STELLAR_LIGHT, course: COURSE_PALETTES.light },
} as const satisfies Record<GalaxyTheme, unknown>;
