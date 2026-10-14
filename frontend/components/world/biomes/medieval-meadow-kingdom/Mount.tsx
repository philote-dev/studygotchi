"use client";

import { useCallback, useMemo, useState } from "react";
import { MEADOW_KINGDOM, generateKingdom } from "./layout/biome-layout";
import { STATIONS, defaultOverride } from "./camera/stations";
import { BiomeScene } from "./scene/BiomeScene";
import type { LabState } from "./state";
import { useLandArrival } from "../useLandArrival";
import { useReducedMotion, useSpaceAttribute } from "@/components/shell/useSpaceAttribute";
import { useEdgeLab } from "./edge/use-edge-lab";

export function MeadowMount({ progress }: { progress: number }) {
  const fraction = Math.min(1, Math.max(0, progress));
  const { diving, onDiveEnd, station } = useLandArrival();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusDistrict, setFocusDistrict] = useState<string | null>(null);
  const layout = useMemo(() => generateKingdom(7), []);
  // Day/night follows the page colour scheme (bible §6), like the ice land.
  const night = useSpaceAttribute() === "dark";
  const reducedMotion = useReducedMotion();
  // Edge lab (`?edge=none|outer&pose=`): free poses and the baseline comparison; the product default is `outer`.
  const edgeLab = useEdgeLab();
  const state = useMemo<LabState>(
    () => ({
      progress: Object.fromEntries(MEADOW_KINGDOM.districts.map((district) => [district.id, fraction])),
      residents: 8,
      seed: 7,
      night,
      clouds: true,
      snowfall: false,
      whale: true,
      pixel: true,
      showReferences: false,
      station,
      focusDistrict,
      camera: defaultOverride(STATIONS[station]),
      catastrophe: { districtId: null, phase: "calm", startedAt: 0 },
      // A fixed lab pose replaces the arrival dive so captures see the pose, not the flight.
      diving: diving && !edgeLab.pose,
      edgeLab: edgeLab.active,
      edge: edgeLab.mode,
      pose: edgeLab.pose,
      reducedMotion,
    }),
    [diving, edgeLab.active, edgeLab.mode, edgeLab.pose, focusDistrict, fraction, night, reducedMotion, station],
  );
  const onPickDistrict = useCallback((id: string) => {
    setFocusDistrict((current) => (current === id ? null : id));
  }, []);
  return (
    <BiomeScene
      layout={layout}
      state={state}
      onDiveEnd={onDiveEnd}
      onPickDistrict={onPickDistrict}
      hoveredId={hoveredId}
      onHover={setHoveredId}
    />
  );
}
