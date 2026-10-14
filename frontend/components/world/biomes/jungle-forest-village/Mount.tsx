"use client";

import { useMemo } from "react";
import { JUNGLE_LAYOUT as L } from "./layout/jungle-layout";
import { STATIONS, defaultOverride } from "./camera/stations";
import { JungleScene } from "./scene/JungleScene";
import type { JungleState } from "./jungle-state";
import { useLandArrival } from "../useLandArrival";
import { useReducedMotion, useSpaceAttribute } from "@/components/shell/useSpaceAttribute";
import { useEdgeLab } from "./edge/use-edge-lab";

export function JungleMount({ progress }: { progress: number }) {
  const fraction = Math.min(1, Math.max(0, progress));
  const { diving, onDiveEnd, station } = useLandArrival();
  // Day / night follows the page colour scheme (bible §6), like the ice land.
  const night = useSpaceAttribute() === "dark";
  const reducedMotion = useReducedMotion();
  // Edge lab (`?edge=none|outer&pose=<id>`): the outer world is the product default.
  const edgeLab = useEdgeLab();
  const state = useMemo<JungleState>(
    () => ({
      progress: Object.fromEntries(L.districts.map((district) => [district.id, fraction])),
      residents: 10,
      seed: 7,
      night,
      mist: true,
      birds: true,
      waterEvent: true,
      pixel: true,
      station,
      focusDistrict: null,
      camera: defaultOverride(STATIONS[station]),
      catastrophe: { districtId: null, phase: "calm", startedAt: 0 },
      // A fixed lab pose replaces the arrival dive.
      diving: diving && !edgeLab.pose,
      comparison: false,
      edge: edgeLab.mode,
      edgeLab: edgeLab.active,
      pose: edgeLab.pose,
      reducedMotion,
    }),
    [diving, edgeLab.active, edgeLab.mode, edgeLab.pose, fraction, night, reducedMotion, station],
  );
  return <JungleScene state={state} onDiveEnd={onDiveEnd} />;
}
