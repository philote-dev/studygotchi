"use client";

import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactElement, type ReactNode } from "react";

/**
 * Slots let a page component hand a layer to the persistent stage canvas,
 * which lives above the page in `ProductShell`: the earth page keeps owning
 * the globe's (and the land's) state and callbacks and renders only a
 * transparent host div for pointer input, while the layer itself mounts
 * inside the stage canvas through `StageSlotOutlet` (the only globe path
 * since gate 1, the only ice-land path since gate 4, 2026-10-13). The store is
 * external (not React state) so slotting re-renders only the outlet, never
 * the shell.
 */
export type StageSlotName = "planet" | "world";

export interface StageSlots {
  get(name: StageSlotName): ReactElement | null;
  set(name: StageSlotName, element: ReactElement | null): void;
  /**
   * An opaque page canvas covers the stage (a land with its own canvas, `OWN_CANVAS_BIOMES`):
   * the stage pauses its frame loop while the director rests, since a hidden canvas still costs
   * GPU time. Counted, so two covers never uncover early.
   */
  cover(on: boolean): void;
  covered(): boolean;
  subscribe(fn: () => void): () => void;
  /** Bumps on every `set` / `cover`; the outlet's external-store snapshot. */
  version(): number;
}

export function createStageSlots(): StageSlots {
  const slots = new Map<StageSlotName, ReactElement>();
  const listeners = new Set<() => void>();
  let version = 0;
  let covers = 0;
  const notify = () => {
    version++;
    for (const fn of listeners) fn();
  };
  return {
    get: (name) => slots.get(name) ?? null,
    set(name, element) {
      if (element) slots.set(name, element);
      else slots.delete(name);
      notify();
    },
    cover(on) {
      covers = Math.max(0, covers + (on ? 1 : -1));
      notify();
    },
    covered: () => covers > 0,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    version: () => version,
  };
}

const NO_SLOTS = createStageSlots();

export const StageSlotsContext = createContext<StageSlots>(NO_SLOTS);

/** Outside `ProductShell` this is an inert store (nothing renders what is slotted). */
export function useStageSlots(): StageSlots {
  return useContext(StageSlotsContext);
}

export function StageSlotsProvider({ children }: { children: ReactNode }) {
  const slots = useMemo(createStageSlots, []);
  return <StageSlotsContext.Provider value={slots}>{children}</StageSlotsContext.Provider>;
}

/** Mark the stage as covered by an opaque page canvas while the caller is mounted. */
export function useStageCover(on = true): void {
  const slots = useStageSlots();
  useEffect(() => {
    if (!on) return;
    slots.cover(true);
    return () => slots.cover(false);
  }, [slots, on]);
}

/** Whether an opaque page canvas covers the stage right now (re-renders on change). */
export function useStageCovered(): boolean {
  const slots = useStageSlots();
  return useSyncExternalStore(slots.subscribe, slots.covered, slots.covered);
}

/** Keep `element` mounted in the stage's named slot while the caller is mounted. */
export function useStageSlot(name: StageSlotName, element: ReactElement | null): void {
  const slots = useStageSlots();
  useEffect(() => {
    slots.set(name, element);
  }, [slots, name, element]);
  useEffect(() => () => slots.set(name, null), [slots, name]);
}

/**
 * Inside the stage canvas: renders whatever the pages slotted. `sticky` (the
 * planet) keeps the last element a page slotted mounted after that page is
 * gone, so the planet layer outlives /earth during a pull-back or a dive and
 * is never remounted (no program compiles, no pop); the next page's element
 * replaces it.
 */
export function StageSlotOutlet({ names, sticky = false }: { names: readonly StageSlotName[]; sticky?: boolean }) {
  const slots = useStageSlots();
  useSyncExternalStore(slots.subscribe, slots.version, slots.version);
  const last = useRef(new Map<StageSlotName, ReactElement>());
  return (
    <>
      {names.map((name) => {
        let element = slots.get(name);
        if (sticky) {
          if (element) last.current.set(name, element);
          else element = last.current.get(name) ?? null;
        }
        return <Fragment key={name}>{element}</Fragment>;
      })}
    </>
  );
}
