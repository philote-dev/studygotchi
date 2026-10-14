/**
 * `@/lib/galaxy`: the seeded galaxy recipe (spec), its point buffers, the
 * palettes, the course layout, the course blobs (mapping, placement) and the
 * hover flags' layout. Pure TS: no three.js objects beyond `Color`, so
 * everything runs in vitest and could run in a Worker. The renderer lives in
 * `components/stage/layers/galaxy/`.
 */
export * from "./spec";
export * from "./points";
export * from "./palettes";
export * from "./layout";
export * from "./blobs";
export * from "./placement";
export * from "./flags";
