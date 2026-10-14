/**
 * Outer-zone palettes read off the ledger refs (27 Hurt map, 25 M33, 22 LMC,
 * 23 Omega Centauri, 18 HUDF, 24 Westerlund 2) and the product sky. Dark is
 * additive on indigo; light is ink on paper and runs through `themeTone`, so
 * these are the colours before the tone, picked a little brighter for paper.
 */
import { SKY } from "../../space/galaxy/palettes";

export interface MapPalette {
  sky: string;
  core: string;
  bar: string;
  arm: string;
  disc: string;
  tip: string;
  hii: string;
  dust: string;
  star: string;
  starSoft: string;
  /** Beads. */
  beadCool: string;
  beadWarm: string;
  beadWorldCore: string;
  youAreHere: string;
  ringHover: string;
  /** Halo. */
  globularCore: string;
  globularWarm: string;
  globularCool: string;
  globularGlow: string;
  satelliteBar: string;
  satelliteKnot: string;
  satelliteHaze: string;
  /** Deep field. */
  smudgeWarm: string;
  smudgeGold: string;
  smudgeBlue: string;
  smudgeWhite: string;
  /** Object markers. */
  blackHole: string;
  nebula: string;
  pulsar: string;
  comet: string;
  binary: string;
  ringedGiant: string;
  whiteHole: string;
  remnant: string;
  /** Guides. */
  guideArm: string;
  guideMinor: string;
  guideFocal: string;
  guideDepth: string;
  guideSector: string;
  label: string;
  labelHalo: string;
}

export const MAP_PALETTES: Record<"dark" | "light", MapPalette> = {
  dark: {
    sky: SKY.dark,
    core: "#fff0c2",
    bar: "#f0dcb0",
    arm: "#aebcd0",
    disc: "#7a84b8",
    tip: "#8fb0d8",
    hii: "#e8788a",
    dust: "#3e2a24",
    star: SKY.starDark,
    starSoft: SKY.starSoftDark,
    beadCool: "#a99bd6",
    beadWarm: "#ffe6a8",
    beadWorldCore: "#8fb0d8",
    youAreHere: "#ffd36a",
    ringHover: "#c6baec",
    globularCore: "#f0ece0",
    globularWarm: "#e8a070",
    globularCool: "#8ab0e8",
    globularGlow: "#e9e6e0",
    satelliteBar: "#d9a8a8",
    satelliteKnot: "#e8d8a0",
    satelliteHaze: "#8a94b0",
    smudgeWarm: "#e08a3a",
    smudgeGold: "#f5d9a8",
    smudgeBlue: "#8fb0d8",
    smudgeWhite: "#fde6e0",
    blackHole: "#f6ac3d",
    nebula: "#d87a8a",
    pulsar: "#8ad7ea",
    comet: "#dfe8ff",
    binary: "#fff6df",
    ringedGiant: "#c9b48a",
    whiteHole: "#fff4e0",
    remnant: "#6fd3f0",
    guideArm: "#c6baec",
    guideMinor: "#8a84b8",
    guideFocal: "#ffd36a",
    guideDepth: "#5b5884",
    guideSector: "#3f3a66",
    label: "#fff6df",
    labelHalo: "rgba(8, 7, 22, 0.82)",
  },
  light: {
    sky: SKY.light,
    core: "#f6e2b8",
    bar: "#e9cfa0",
    arm: "#9fa8c8",
    disc: "#8f96c0",
    tip: "#7f9fd0",
    hii: "#e06a7c",
    dust: "#e8ecf4",
    star: "#fff6df",
    starSoft: "#dfe4f0",
    beadCool: "#8f86c8",
    beadWarm: "#f2c56a",
    beadWorldCore: "#5f7fb8",
    youAreHere: "#f0b63a",
    ringHover: "#6a6690",
    globularCore: "#efe9df",
    globularWarm: "#e8a070",
    globularCool: "#7fa3e0",
    globularGlow: "#e0dcd8",
    satelliteBar: "#d49ea0",
    satelliteKnot: "#e8cf8a",
    satelliteHaze: "#9aa2c0",
    smudgeWarm: "#d9823b",
    smudgeGold: "#e8cf9a",
    smudgeBlue: "#7f9fd0",
    smudgeWhite: "#f8ece8",
    blackHole: "#e58a2c",
    nebula: "#dc756f",
    pulsar: "#5fb8d8",
    comet: "#c9d4e6",
    binary: "#f5f0e8",
    ringedGiant: "#c9b48a",
    whiteHole: "#fff8ec",
    remnant: "#4fa8c8",
    guideArm: "#5b5884",
    guideMinor: "#8a86b0",
    guideFocal: "#d9a92e",
    guideDepth: "#8a8ea8",
    guideSector: "#aeb3c8",
    label: "#17151d",
    labelHalo: "rgba(244, 241, 251, 0.9)",
  },
};
