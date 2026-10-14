/**
 * Galaxy palettes read off the NASA / ESA / ESO references in
 * docs/design/world/refs/space/LEDGER.md (estimated swatches, see that file
 * for credits). Each palette is one "colour story": warm core, cooler arm,
 * bluer tips, pink or blue beads, brown dust, a warm companion.
 */
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
