"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CondenseAnchor } from "@/lib/graph/twin/condense";
import { layoutService } from "@/lib/graph/worker/layout-service";
import { smoothstep } from "@/lib/stage/altitude";
import { useHop } from "../../hop/HopProvider";
import { ConstellationTwin, type TwinDrive } from "./ConstellationTwin";

interface DevParams {
  condense: number;
  enter: number;
  anchor: CondenseAnchor | null;
}

/** `?condense=0.5`, `?enter=0.5`, `?anchor=x,y[,r]` (CSS px of the constellation box): capture-only drivers of the T-4 curves. */
export function twinDevParams(search: string): DevParams {
  const params = new URLSearchParams(search);
  const num = (key: string, fallback: number) => {
    const raw = params.get(key);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  const anchorRaw = params.get("anchor");
  let anchor: CondenseAnchor | null = null;
  if (anchorRaw) {
    const [x, y, r] = anchorRaw.split(",").map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) anchor = { x, y, radius: Number.isFinite(r) ? r : 30 };
  }
  return { condense: num("condense", 0), enter: num("enter", 1), anchor };
}

// The twin is the only constellation renderer (gate 2, 2026-10-13): the layout owner's first
// layout memo runs during the same commit that mounts the twin, i.e. before the twin's effects,
// so the decision to settle in the layout Worker is made at module load.
if (typeof window !== "undefined") layoutService.defer = true;

/** Ramp (ms) the twin fades in over once it first has positions: a late layout never pops. */
export const TWIN_READY_RAMP_MS = 180;

/**
 * The hop's per-frame driver for the twin (S2-3 / S3-2): `enter` and
 * `condense` from the director through `twinCurvesAt` (1 and 0 under reduced
 * motion), the bloom anchor from the planet's live screen point, the condense
 * anchor from the current course's galaxy bead, and the twin's opacity (its
 * own band times a short readiness ramp, so a layout that lands mid-hop fades
 * in instead of popping). The constellation chrome (`.sg-constellation`, a
 * sibling) follows the chrome curve. Pure DOM style writes on change only.
 */
export function createHopTwinDrive(read: () => { enter: number; condense: number; opacity: number; chrome: number; planetAnchor: CondenseAnchor | null; galaxyAnchor: CondenseAnchor | null }, now: () => number = () => performance.now()): TwinDrive {
  let readyAt: number | null = null;
  let lastOpacity = -1;
  let lastChrome = -1;
  return (runtime, root) => {
    const s = read();
    runtime.enter = s.enter;
    runtime.condense = s.condense;
    runtime.planetAnchor = s.planetAnchor;
    runtime.galaxyAnchor = s.galaxyAnchor;
    const has = runtime.layout !== null && !runtime.settling && runtime.nodes.length > 0;
    const t = now();
    if (!has) readyAt = null;
    else if (readyAt === null) readyAt = t;
    const ramp = readyAt === null ? 0 : smoothstep(0, TWIN_READY_RAMP_MS, t - readyAt);
    const opacity = Math.round(s.opacity * ramp * 1000) / 1000;
    if (root && opacity !== lastOpacity) {
      lastOpacity = opacity;
      root.style.opacity = opacity >= 1 ? "" : String(opacity);
      // Probe surface for the captures: why the twin is (not) showing.
      root.dataset.hopHas = has ? (runtime.settling ? "settling" : "1") : runtime.layout === null ? "no-layout" : runtime.settling ? "settling" : "no-nodes";
    }
    const chrome = Math.round(s.chrome * 1000) / 1000;
    if (root && chrome !== lastChrome) {
      lastChrome = chrome;
      const page = root.parentElement?.querySelector<HTMLElement>(":scope > .sg-constellation") ?? null;
      if (page) {
        // Explicit at 1 too: hop.css starts the constellation chrome at 0 on the spring.
        page.style.opacity = String(chrome);
        page.style.pointerEvents = chrome >= 1 ? "" : "none";
      }
    }
  };
}

/**
 * Mounts the constellation twin (standalone mode) on /knowledge: the one
 * constellation renderer since gate 2 (2026-10-13; the Canvas2D drawing path
 * was deleted the same day, `KnowledgeCanvas` now only owns the layout). The
 * director drives `enter` / `condense` through `createHopTwinDrive`; under
 * `prefers-reduced-motion: reduce` the graph renders static (whole, no bloom
 * or condensation, no arrival pops or weak-trace pulse) and crossfades with
 * the hop.
 */
export function ConstellationTwinMount() {
  const [params, setParams] = useState<DevParams>({ condense: 0, enter: 1, anchor: null });
  const hop = useHop();
  const hopRef = useRef(hop);
  hopRef.current = hop;
  useEffect(() => {
    setParams(twinDevParams(window.location.search));
  }, []);
  // The page mounts mid-hop: its DOM commit, the twin's WebGL context and the glyph compile used
  // to share one frame (a 45-70 ms stall at the route change). The twin's canvas mounts two frames
  // after the page (it is invisible until L 1.4 anyway); the compile is one more frame later
  // (TwinScene). At rest (a cold load) nothing is staged.
  const [staged, setStaged] = useState(false);
  useEffect(() => {
    if (!hopRef.current.director.sample().moving) {
      setStaged(true);
      return;
    }
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => setStaged(true));
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  const drive = useMemo(
    () =>
      createHopTwinDrive(() => {
        const st = hopRef.current.runtime.state;
        return { ...st.twin, planetAnchor: st.planetAnchor, galaxyAnchor: st.galaxyAnchor };
      }),
    [],
  );
  return staged ? <ConstellationTwin condense={params.condense} enter={params.enter} anchor={params.anchor} drive={drive} /> : null;
}
