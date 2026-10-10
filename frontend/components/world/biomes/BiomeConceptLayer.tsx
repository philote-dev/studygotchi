"use client";

import { Html } from "@react-three/drei";
import type { CanvasSpot, CanvasWorld } from "@/lib/world/types";
import type { LocalBiomeId } from "./types";

const FRAME: Record<
  Exclude<LocalBiomeId, "ice-golden" | "island">,
  { x: number; z: number; zOffset: number; y: number }
> = {
  "ice-town": { x: 88, z: 66, zOffset: 7, y: 5 },
  "frontier-town": { x: 112, z: 82, zOffset: 4, y: 5 },
  "coastal-ruins": { x: 82, z: 62, zOffset: 8, y: 7 },
  "jungle-forest-village": { x: 92, z: 68, zOffset: 2, y: 8 },
  "medieval-meadow-kingdom": { x: 92, z: 66, zOffset: 4, y: 6 },
  "nordic-volcanic-highlands": { x: 94, z: 68, zOffset: 3, y: 7 },
};

const STATE_COLOR: Record<CanvasSpot["semantic_state"], string> = {
  frontier: "#d7e8ee",
  exposed: "#f2d2cc",
  developing: "#f2d2cc",
  strong: "#f1e0a6",
  mastered: "#f0d77d",
  struggling: "#dc756f",
  stale: "#d8ccc0",
};

/**
 * One quiet, interactive concept beacon per API place. The scene remains the
 * authored biome; this layer only restores the product selection callbacks
 * that the generic island already exposes.
 */
export function BiomeConceptLayer({
  visual,
  world,
  selectedId,
  hoveredId,
  changedIds,
  onSelect,
  onHover,
}: {
  visual: Exclude<LocalBiomeId, "ice-golden" | "island">;
  world: CanvasWorld | null;
  selectedId: string | null;
  hoveredId: string | null;
  changedIds?: ReadonlySet<string>;
  onSelect(conceptId: string | null): void;
  onHover(conceptId: string | null): void;
}) {
  if (!world) return null;
  const frame = FRAME[visual];

  return (
    <group name="biome-concept-layer">
      {world.places.slice(0, 12).map((place) => {
        const spots = world.spots.filter((spot) => spot.place_id === place.id);
        const spot =
          spots.find((candidate) => candidate.concept_id === selectedId) ??
          spots.find((candidate) => candidate.concept_id === hoveredId) ??
          spots.find((candidate) => candidate.semantic_state !== "frontier") ??
          spots[0];
        if (!spot) return null;
        const active = spot.concept_id === selectedId;
        const hovered = spot.concept_id === hoveredId;
        const changed = changedIds?.has(spot.concept_id) ?? false;
        const position: [number, number, number] = [
          (place.center.x / 10) * frame.x,
          frame.y + Math.max(0, spot.height) * 2.4,
          (place.center.z / 10) * frame.z + frame.zOffset,
        ];

        return (
          <group key={place.id} position={position}>
            <mesh
              onClick={(event) => {
                event.stopPropagation();
                onSelect(active ? null : spot.concept_id);
              }}
              onPointerOver={(event) => {
                event.stopPropagation();
                onHover(spot.concept_id);
              }}
              onPointerOut={() => onHover(null)}
              scale={active || changed ? 1.28 : 1}
            >
              <octahedronGeometry args={[1.25, 0]} />
              <meshBasicMaterial
                color={STATE_COLOR[spot.semantic_state]}
                transparent
                opacity={active ? 0.96 : hovered ? 0.82 : 0.56}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
            <Html center position={[0, 2.4, 0]} zIndexRange={[24, 0]}>
              <button
                type="button"
                className="biome-concept-label"
                data-visible={active || hovered ? "true" : "false"}
                aria-label={`Open ${spot.name}`}
                onFocus={() => onHover(spot.concept_id)}
                onBlur={() => onHover(null)}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(active ? null : spot.concept_id);
                }}
              >
                {spot.name}
              </button>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
