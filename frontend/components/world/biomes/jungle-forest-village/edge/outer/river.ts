/**
 * The river beyond the plate: the lagoon's east outflow continued from the authored last point
 * (116, 46) across the plate edge, down its valley, and fanned into three delta channels at the
 * coast. Pure vertex data; the React side wraps it in BufferGeometry. Widths continue the
 * authored river (9.5 m water in a 14 m wet band) and grow toward the delta.
 */
import { JUNGLE_LAYOUT as L } from '../../layout/jungle-layout'
import { DELTA_CHANNELS, OUTER_RIVER } from '../barriers/geography'
import { type OuterWorld, riverHalfWidth } from './heightfield'

export interface RibbonData {
  position: Float32Array
  index: Uint32Array
}

/** Build a ribbon of varying width whose surface height comes from `heightAt`. */
export function ribbon(
  points: ReadonlyArray<readonly [number, number]>,
  halfWidthAt: (x: number, z: number, t: number) => number,
  heightAt: (x: number, z: number) => number,
  subdivisions = 4,
): RibbonData {
  // Resample the polyline so the surface follows the heightfield between the authored points.
  const dense: Array<[number, number]> = []
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1]
    const [bx, bz] = points[i]
    for (let k = 0; k < subdivisions; k++) {
      const t = k / subdivisions
      dense.push([ax + (bx - ax) * t, az + (bz - az) * t])
    }
  }
  dense.push([points[points.length - 1][0], points[points.length - 1][1]])
  const vertices: number[] = []
  const indices: number[] = []
  for (let i = 0; i < dense.length; i++) {
    const [x, z] = dense[i]
    const previous = dense[Math.max(0, i - 1)]
    const next = dense[Math.min(dense.length - 1, i + 1)]
    const dx = next[0] - previous[0]
    const dz = next[1] - previous[1]
    const length = Math.hypot(dx, dz) || 1
    const half = halfWidthAt(x, z, i / (dense.length - 1))
    const nx = (-dz / length) * half
    const nz = (dx / length) * half
    const y = heightAt(x, z)
    vertices.push(x + nx, y, z + nz, x - nx, y, z - nz)
    if (i > 0) {
      const a = (i - 1) * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  return { position: new Float32Array(vertices), index: new Uint32Array(indices) }
}

/** The main channel, from the authored outflow's end to the sea. */
export function mainChannel(): ReadonlyArray<readonly [number, number]> {
  return OUTER_RIVER
}

/** Two side channels fanning from the delta apex to the coast (the heightfield's valley follows them too). */
export function deltaChannels(): ReadonlyArray<ReadonlyArray<readonly [number, number]>> {
  return DELTA_CHANNELS
}

export interface RiverGeometry {
  water: RibbonData
  wet: RibbonData
  /** Inside the plate the authored river stops at (116, 46); this flat stretch carries it to the seam. */
  insidePlate: boolean
}

/** Water ribbon heights: the flat authored surface inside the plate, the valley floor beyond. */
function surfaceAt(world: OuterWorld, lift: number) {
  return (x: number, z: number) => (Math.abs(x) <= L.worldExtent && Math.abs(z) <= L.worldExtent ? lift : world.riverSurface(x, z) + lift - 0.08)
}

export function buildRiver(world: OuterWorld): { main: RiverGeometry; delta: RiverGeometry[] } {
  const main: RiverGeometry = {
    water: ribbon(mainChannel(), (x) => riverHalfWidth(x), surfaceAt(world, 0.08)),
    wet: ribbon(mainChannel(), (x) => riverHalfWidth(x) + (L.hydrology.wetWidth - L.hydrology.riverWidth) / 2, surfaceAt(world, 0.02)),
    insidePlate: true,
  }
  const delta = deltaChannels().map((points) => ({
    water: ribbon(points, (_x, _z, t) => 2.6 + 3.2 * t, surfaceAt(world, 0.06)),
    wet: ribbon(points, (_x, _z, t) => 4.6 + 4 * t, surfaceAt(world, 0.01)),
    insidePlate: false,
  }))
  return { main, delta }
}
