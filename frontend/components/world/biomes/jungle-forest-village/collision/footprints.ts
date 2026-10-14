/**
 * Collider footprints for the jungle land, derived from the same placement data the meshes are
 * placed from (`layout/placements.ts`), so the shapes cannot drift from the geometry. The scene
 * registers these through the shared `ColliderProvider`; the vitest walker simulation builds the
 * same union with `jungleLandColliders`, so both see exactly the same set.
 *
 * Conventions follow `collision/colliders.ts`: world XZ metres, box yaw = three's rotation.y.
 */
import type { Collider } from '../../collision/colliders'
import type { SeededDistrict } from '../layout/jungle-layout'
import { junglePlacements, type Placement, type PlacementKind } from '../layout/placements'

export type FootprintTag = 'hut' | 'trunk' | 'rock' | 'totem' | 'dock' | 'fence'

/** Which family each placement kind belongs to (the report counts colliders by these). */
export const TAG_OF: Record<PlacementKind, FootprintTag> = {
  'mother-tree': 'trunk',
  treehouse: 'trunk',
  tree: 'trunk',
  ladder: 'totem',
  'stilt-home': 'hut',
  hut: 'hut',
  archive: 'hut',
  stall: 'hut',
  shed: 'hut',
  mill: 'hut',
  pier: 'dock',
  boardwalk: 'dock',
  footbridge: 'dock',
  'rope-bridge': 'dock',
  canoe: 'dock',
  shelf: 'rock',
  rock: 'rock',
  cliff: 'rock',
  'gate-block': 'rock',
  log: 'rock',
  'gate-pillar': 'totem',
  'gate-root': 'totem',
  wheel: 'totem',
  shrine: 'totem',
  lamp: 'totem',
  fence: 'fence',
}

/** Kinds whose footprint is a circle (one radius in `size`); every other kind is a box (two half-extents). */
const CIRCLE_KINDS: ReadonlySet<PlacementKind> = new Set<PlacementKind>(['mother-tree', 'treehouse', 'tree', 'ladder', 'gate-root', 'rock', 'lamp', 'shrine'])

export function placementCollider(placement: Placement): Collider {
  const tag = TAG_OF[placement.kind]
  if (CIRCLE_KINDS.has(placement.kind)) {
    return { kind: 'circle', x: placement.x, z: placement.z, r: placement.size[0] * placement.scale, tag, id: placement.id }
  }
  return {
    kind: 'box',
    x: placement.x,
    z: placement.z,
    hx: placement.size[0] * placement.scale,
    hz: placement.size[1] * placement.scale,
    yaw: placement.yaw,
    tag,
    id: placement.id,
  }
}

/** Every collider the jungle scene registers at this seed and progress. */
export function jungleLandColliders(districts: SeededDistrict[], progress: Record<string, number>, seed: number): Collider[] {
  return junglePlacements(districts, progress, seed).map(placementCollider)
}

export function countByTag(colliders: readonly Collider[]): Record<FootprintTag, number> {
  const out: Record<FootprintTag, number> = { hut: 0, trunk: 0, rock: 0, totem: 0, dock: 0, fence: 0 }
  for (const collider of colliders) if (collider.tag) out[collider.tag as FootprintTag] += 1
  return out
}
