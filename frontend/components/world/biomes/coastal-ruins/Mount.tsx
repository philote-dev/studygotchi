"use client";

import { useMemo } from "react";
import { COASTAL_RUINS_LAYOUT as layout } from "./layout/biome-layout";
import { STATIONS, defaultOverride } from "./camera/stations";
import { BiomeScene } from "./scene/BiomeScene";
import type { LabState } from "./state";
import { useLandArrival } from "../useLandArrival";
import { useReducedMotion, useSpaceAttribute } from "@/components/shell/useSpaceAttribute";
import { useEdgeLab } from "./edge/use-edge-lab";

export function CoastalMount({ progress }: { progress: number }) {
  const fraction = Math.min(1, Math.max(0, progress));
  const { diving, onDiveEnd, station } = useLandArrival();
  // Day/night follows the page colour scheme, like the ice land.
  const night = useSpaceAttribute() === "dark";
  const reducedMotion = useReducedMotion();
  // Edge lab (`?edge=` / `?pose=`): the outer world is on by default; the lab adds the panel and fixed poses.
  const edgeLab = useEdgeLab();
  const state = useMemo<LabState>(
    () => ({
      progress: Object.fromEntries(layout.districts.map((district) => [district.id, fraction])),
      residents: Math.max(8, Math.round(fraction * 18)),
      seed: 7,
      night,
      clouds: true,
      boatEvent: true,
      pixel: true,
      markerMode: false,
      // A lab pose skips the arrival dive so the capture harness gets its frame at once.
      station: edgeLab.active ? "overview" : station,
      focusDistrict: null,
      camera: defaultOverride(STATIONS[edgeLab.active ? "overview" : station]),
      catastrophe: { districtId: null, phase: "calm", startedAt: 0 },
      diving: edgeLab.active ? false : diving,
      edge: edgeLab.mode,
      edgeLab: edgeLab.active,
      pose: edgeLab.pose,
      reducedMotion,
    }),
    [diving, edgeLab.active, edgeLab.mode, edgeLab.pose, fraction, night, reducedMotion, station],
  );
  return <BiomeScene layout={layout} state={state} onDiveEnd={onDiveEnd} />;
}
