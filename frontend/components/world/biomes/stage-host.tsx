"use client";

import { createContext, useContext, type RefObject } from "react";

/**
 * S4-1: when a land renders as a layer of the persistent stage canvas, the
 * canvas element under the scene is the stage's (pointer-events none, at the
 * back of the shell), so everything that used to lean on `gl.domElement` for
 * pointer input, the cursor, drag controls or DOM labels (`Html`) must use the
 * page-side host div instead. The world layer provides it here; without a
 * provider (the land's own canvas) every consumer keeps its old path.
 */
export interface BiomeStageHost {
  /** The `[data-land-mount]` host div on the page: pointer input and DOM labels land here. */
  element: HTMLElement;
  /** The same element as a ref object, for drei `Html`'s `portal` prop. */
  ref: RefObject<HTMLElement>;
}

export const BiomeStageHostContext = createContext<BiomeStageHost | null>(null);

/** The stage host while the land renders through the stage; null on the land's own canvas. */
export function useBiomeStageHost(): BiomeStageHost | null {
  return useContext(BiomeStageHostContext);
}
