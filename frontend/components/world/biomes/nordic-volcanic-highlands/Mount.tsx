"use client";

import { useMemo } from "react";
import { NORDIC_LAYOUT, progressFromQuery } from "./layout/biome-layout";
import { STATIONS, defaultOverride } from "./camera/stations";
import { BiomeScene } from "./scene/BiomeScene";
import type { LabState } from "./state";
import { useLandArrival } from "../useLandArrival";
import { useReducedMotion, useSpaceAttribute } from "@/components/shell/useSpaceAttribute";
import { useEdgeLab } from "./edge/use-edge-lab";

export function NordicMount({ progress }: { progress: number }) {
  // Edge lab: `?progress=0|0.5|1` audits the land at a fixed band (the page's course progress otherwise).
  const edgeLab = useEdgeLab();
  const override = useMemo(() => {
    if (typeof window === "undefined" || !edgeLab.active) return null;
    const value = new URLSearchParams(window.location.search).get("progress");
    return value === null ? null : progressFromQuery(value);
  }, [edgeLab.active]);
  const fraction = override ?? Math.min(1, Math.max(0, progress));
  const { diving, onDiveEnd, station } = useLandArrival();
  // Day / night follows the page colour scheme (bible §6), as the ice land does.
  const night = useSpaceAttribute() === "dark";
  const reducedMotion = useReducedMotion();
  // Edge lab (`?edge=` / `?pose=`): the outer world is the shipped look; `none` is the baseline.
  const state = useMemo<LabState>(
    () => ({
      progress: Object.fromEntries(NORDIC_LAYOUT.districts.map((district) => [district.id, fraction])),
      residents: 10,
      seed: 7,
      night,
      aurora: true,
      mist: true,
      ambient: true,
      pixel: true,
      station,
      focusDistrict: null,
      camera: defaultOverride(STATIONS[station]),
      catastrophe: { districtId: null, phase: "calm", startedAt: 0 },
      diving,
      edgeLab: edgeLab.active,
      edge: edgeLab.technique,
      pose: edgeLab.pose,
      reducedMotion,
    }),
    [diving, edgeLab.active, edgeLab.pose, edgeLab.technique, fraction, night, reducedMotion, station],
  );
  return (
    <BiomeScene
      layout={NORDIC_LAYOUT}
      state={state}
      onDiveEnd={onDiveEnd}
      onPickDistrict={() => undefined}
    />
  );
}
