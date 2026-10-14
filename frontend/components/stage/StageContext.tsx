"use client";

import { createContext, useContext, useEffect, useRef, type RefObject } from "react";
import type * as THREE from "three";
import { createDirector, type StageDirector, type StageLayerId } from "@/lib/stage/director";
import { seedFromStudent } from "@/lib/stage/placement";
import type { StageFrame } from "./render/StageComposer";

/**
 * Layer registry for the persistent stage. Each slice mounts one named layer
 * (`sky` S1, `planet` S2; `constellation`, `galaxy`, `world` later) and
 * registers its root object (a group in the main scene, or a whole scene of
 * its own for a layer the composer renders with its own camera), so the
 * director can show, hide or move layers without knowing their insides.
 */
export type StageLayerName = StageLayerId;

export interface StageRegistry {
  layers: Map<StageLayerName, THREE.Object3D>;
  register(name: StageLayerName, object: THREE.Object3D | null): void;
}

export interface StageApi {
  registry: StageRegistry;
  /** Mutable per-frame state the composer reads (theme, pixel size, the planet pass). */
  frame: RefObject<StageFrame>;
  /**
   * The altitude director: one spring on `L`, stepped by the stage before any
   * layer's frame. The product stage always provides it; a lab preview that
   * builds a bare api may leave it out and gets a resting fallback.
   */
  director?: StageDirector;
  /** Per-student seed every rung's placement generator keys off (sandbox seed when absent). */
  seed?: number;
}

export const StageContext = createContext<StageApi | null>(null);

export function useStage(): StageApi {
  const api = useContext(StageContext);
  if (!api) throw new Error("useStage outside StageCanvas");
  return api;
}

let fallbackDirector: StageDirector | null = null;

/** The stage's director (`sample()` inside `useFrame` for per-frame `L`, `v`, rung, moving). */
export function useStageDirector(): StageDirector {
  const { director } = useStage();
  if (director) return director;
  if (!fallbackDirector) fallbackDirector = createDirector("planet");
  return fallbackDirector;
}

/** The per-student seed the stage was mounted with. */
export function useStageSeed(): number {
  return useStage().seed ?? seedFromStudent(null);
}

export function createStageRegistry(): StageRegistry {
  const layers = new Map<StageLayerName, THREE.Object3D>();
  return {
    layers,
    register(name, object) {
      if (object) layers.set(name, object);
      else layers.delete(name);
    },
  };
}

/** Register the group this ref is attached to as a named layer for the stage's lifetime. */
export function useStageLayer<T extends THREE.Object3D>(name: StageLayerName): RefObject<T | null> {
  const { registry } = useStage();
  const ref = useRef<T | null>(null);
  useEffect(() => {
    registry.register(name, ref.current);
    return () => registry.register(name, null);
  }, [name, registry]);
  return ref;
}
