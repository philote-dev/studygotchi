import type { ComponentType } from "react";

export type ObjectTheme = "dark" | "light";

/** Props every exhibit shares. Objects draw in a [-1, 1] box; the parent scales it to `size` px. */
export interface ObjectBase {
  seed: number;
  /** Rendered width in CSS px: generators pick point counts (LOD) from it. */
  size: number;
  theme: ObjectTheme;
  /** Glow / alpha multiplier, 0.4 to 1.6. */
  intensity: number;
  /** 0 = Hubble, 1 = Kirby: rounder shapes, fewer bands, warmer highlights. */
  cute: number;
  /** Draw in-canvas teaching guides (orbits, arrows, ghosts); the DOM labels live in ExplainOverlay. */
  explain?: boolean;
}

export type KnobValue = number | string;
export type Params = Record<string, KnobValue>;

export type Knob =
  | { key: string; label: string; min: number; max: number; step: number }
  | { key: string; label: string; options: readonly string[] };

export interface ExhibitAction<P extends Params> {
  label: string;
  /** Returns the params patch; `now` is the cosmos clock in seconds. */
  run: (params: P, now: number) => Partial<P>;
}

/**
 * Scale convention: one SCENE UNIT (su) is the glow of a typical main-sequence
 * star (the comet's sun, the binary's accretor, a pulsar's halo). Every exhibit
 * declares the width of its [-1, 1] box in su, so the "Relative scale" view
 * can draw them at one px-per-su and proportions can be judged:
 *   comet nucleus (1 cell) << moon (0.1-0.25 su) < gas giant (0.8 su) < star glow (1 su)
 *   < binary separation (4 su) < protoplanetary disc (3 su) < clusters (10 su)
 *   < planetary nebula (12 su) < supernova remnant (16 su) < emission nebula (40 su).
 * Crisp sprites (moons, craft, the nucleus) keep a minimum of 1 cell whatever the size.
 */
export interface Exhibit<P extends Params = Params> {
  id: string;
  title: string;
  /** Which reference(s) it leans on. */
  ref: string;
  /** Draw calls and point counts at the large size. */
  budget: string;
  /** What it could mean in the app. */
  meaning: string;
  /** Width of the exhibit's box in scene units (see the convention above). */
  su: number;
  knobs: Knob[];
  defaults: P;
  actions?: ExhibitAction<P>[];
  /** Seeded facts for the side panel (masses, angles, radii). */
  readout?: (seed: number, params: P) => [string, string][];
  Component: ComponentType<ObjectBase & { params: P }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyExhibit = Exhibit<any>;
