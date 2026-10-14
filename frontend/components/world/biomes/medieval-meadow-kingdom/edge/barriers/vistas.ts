/**
 * Geometry for the four vista landmarks and the far mill: each merged into one vertex-coloured
 * buffer (one draw call), built in a local frame whose +z faces the pose camera and whose y = 0 is
 * the ground at the site, so the group is placed at the sampled height and turned by the vista's
 * yaw. Aerial perspective is baked into the colours (these are far places and must read paler
 * than the hedgerows in front of them).
 */
import * as THREE from 'three'
import { MEADOW_PALETTE as P, seeded } from '../../layout/biome-layout'
import { Batch, place } from '../outer/batch'
import { skyColour, type OuterGrade } from '../outer/palette'
import type { Vista } from './geography'

export interface VistaBuild {
  geometry: THREE.BufferGeometry
  /** Local position of the one light and its radius. */
  lamp: [number, number, number]
  lampRadius: number
  /** Windmill only: where the sails turn (local), and their radius. */
  sails?: { position: [number, number, number]; radius: number }
}

const SLATE = '#475463'
const WALL_PALE = '#ead8ad'
const WALL_WARM = '#d5c49d'

/** A gabled roof: a triangular prism with the ridge along local x, base at y = 0, `pitch` tall. */
function gable(width: number, depth: number, pitch: number): number[] {
  const hx = width / 2
  const hz = depth / 2
  const tris: number[] = []
  const push = (...v: number[]) => tris.push(...v)
  // Two slopes.
  push(-hx, 0, hz, hx, 0, hz, hx, pitch, 0)
  push(-hx, 0, hz, hx, pitch, 0, -hx, pitch, 0)
  push(hx, 0, -hz, -hx, 0, -hz, -hx, pitch, 0)
  push(hx, 0, -hz, -hx, pitch, 0, hx, pitch, 0)
  // Gable ends.
  push(hx, 0, hz, hx, 0, -hz, hx, pitch, 0)
  push(-hx, 0, -hz, -hx, 0, hz, -hx, pitch, 0)
  return tris
}

function box(batch: Batch, w: number, h: number, d: number, x: number, y: number, z: number, colour: string, yaw = 0): void {
  const geo = new THREE.BoxGeometry(w, h, d)
  batch.geo(geo, place(x, y, z, yaw), colour)
  geo.dispose()
}

function cylinder(batch: Batch, rTop: number, rBottom: number, h: number, sides: number, x: number, y: number, z: number, colour: string): void {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, h, sides)
  batch.geo(geo, place(x, y, z), colour)
  geo.dispose()
}

function cone(batch: Batch, r: number, h: number, sides: number, x: number, y: number, z: number, colour: string, yaw = 0): void {
  const geo = new THREE.ConeGeometry(r, h, sides)
  batch.geo(geo, place(x, y, z, yaw), colour)
  geo.dispose()
}

/** A house: walls and a four-sided roof turned 45° like the authored `House`. */
function house(batch: Batch, x: number, z: number, w: number, d: number, h: number, yaw: number, wall: string, roof: string): void {
  box(batch, w, h, d, x, h / 2, z, wall, yaw)
  cone(batch, Math.max(w, d) * 0.72, h * 0.6, 4, x, h + h * 0.3, z, roof, yaw + Math.PI / 4)
}

export function buildVista(vista: Vista, grade: OuterGrade, haze: number, seed: number): VistaBuild {
  const batch = new Batch(skyColour(grade), Math.min(0.6, haze + 0.22))
  const rng = seeded(seed * 7 + vista.id.length * 31 + Math.round(vista.fromCamera))
  switch (vista.kind) {
    case 'crag-castle': {
      // On the crag's summit: a keep, two unequal round towers, a front curtain wall with a gate.
      // Read from 560 m, so everything is a quarter larger than a near castle would be.
      const s = 1.25
      box(batch, 9 * s, 11 * s, 8 * s, 0, 5.5 * s, -1 * s, P.limestone)
      cone(batch, 6.6 * s, 3.2 * s, 4, 0, 12.6 * s, -1 * s, P.roof, Math.PI / 4)
      cylinder(batch, 2.2 * s, 2.5 * s, 14 * s, 9, -6.6 * s, 7 * s, 2 * s, P.limestone)
      cone(batch, 2.9 * s, 3 * s, 9, -6.6 * s, 15.5 * s, 2 * s, P.roof)
      cylinder(batch, 1.9 * s, 2.2 * s, 10.5 * s, 9, 6.3 * s, 5.25 * s, -3.2 * s, P.limestone)
      cone(batch, 2.6 * s, 2.6 * s, 9, 6.3 * s, 11.8 * s, -3.2 * s, P.rose)
      box(batch, 17 * s, 4.6 * s, 1.3 * s, 0, 2.3 * s, 5.6 * s, P.limestone)
      box(batch, 2.6 * s, 3.6 * s, 0.5 * s, 0, 1.8 * s, 6.1 * s, P.timberDark)
      box(batch, 1.3 * s, 5.2 * s, 8 * s, -8.6 * s, 2.6 * s, 1.5 * s, P.limestoneShade)
      box(batch, 1.3 * s, 5.2 * s, 8 * s, 8.4 * s, 2.6 * s, 1.0 * s, P.limestoneShade)
      // Crenels along the curtain wall.
      for (let i = -3; i <= 3; i++) box(batch, 1.1 * s, 0.8 * s, 1.3 * s, i * 2.4 * s, 5.0 * s, 5.6 * s, P.limestoneShade)
      return { geometry: batch.build(), lamp: [1.2 * s, 7.6 * s, 3.05 * s], lampRadius: 0.6 }
    }
    case 'walled-city': {
      // A walled town on its rise: an eight-sided wall with towers, a crowd of unequal roofs, the cathedral and its spire.
      const R = 46
      const sides = 8
      for (let i = 0; i < sides; i++) {
        const a0 = (i / sides) * Math.PI * 2 + 0.2
        const a1 = ((i + 1) / sides) * Math.PI * 2 + 0.2
        const x0 = Math.cos(a0) * R
        const z0 = Math.sin(a0) * R
        const x1 = Math.cos(a1) * R
        const z1 = Math.sin(a1) * R
        const length = Math.hypot(x1 - x0, z1 - z0)
        box(batch, length, 7, 2, (x0 + x1) / 2, 3.5, (z0 + z1) / 2, P.limestone, Math.atan2(-(z1 - z0), x1 - x0))
        if (i % 2 === 0) {
          cylinder(batch, 3.2, 3.6, 10.5, 8, x0, 5.25, z0, P.limestone)
          cone(batch, 3.9, 3, 8, x0, 12, z0, SLATE)
        }
      }
      // Gate toward the camera.
      box(batch, 9, 10, 4, 0, 5, R - 1, P.limestone)
      box(batch, 3.4, 5.5, 0.6, 0, 2.75, R + 1.2, P.timberDark)
      cone(batch, 6.4, 3.4, 4, 0, 11.7, R - 1, SLATE, Math.PI / 4)
      // Houses: seeded, kept apart, inside the wall and off the cathedral close.
      const placed: Array<[number, number]> = []
      let guard = 0
      while (placed.length < 20 && guard++ < 400) {
        const a = rng() * Math.PI * 2
        const d = 10 + Math.sqrt(rng()) * 28
        const x = Math.cos(a) * d
        const z = Math.sin(a) * d
        if (Math.hypot(x - 2, z + 4) < 19) continue
        if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 9)) continue
        placed.push([x, z])
        const w = 6 + rng() * 4
        const dd = 5 + rng() * 3.5
        const h = 4.5 + rng() * 3.5
        const wall = [P.limestone, WALL_PALE, WALL_WARM][placed.length % 3]
        const roof = placed.length % 5 === 0 ? P.coral : placed.length % 2 ? SLATE : P.roof
        house(batch, x, z, w, dd, h, rng() * Math.PI, wall, roof)
      }
      // Cathedral: nave, transept, west tower and the spire.
      box(batch, 24, 13, 11, 2, 6.5, -4, P.limestone)
      batch.tris(gable(24, 11, 5), place(2, 13, -4), SLATE)
      box(batch, 9, 12, 20, 6, 6, -4, P.limestone)
      batch.tris(gable(9, 20, 4), place(6, 12, -4, Math.PI / 2), SLATE)
      box(batch, 7, 21, 7, -9, 10.5, -4, P.limestone)
      cone(batch, 4.6, 26, 8, -9, 21 + 13, -4, SLATE)
      // Belfry openings (dark) on the camera side.
      box(batch, 1.2, 2.6, 0.4, -9, 18.5, -0.4, P.timberDark)
      return { geometry: batch.build(), lamp: [-9, 18.6, -0.2], lampRadius: 0.55 }
    }
    case 'windmill-hill': {
      // The windmill on its hilltop, a miller's cottage beside it; the sails are a live mesh.
      cylinder(batch, 2.3, 3.5, 12, 8, 0, 6, 0, P.limestone)
      cone(batch, 3.3, 2.9, 8, 0, 13.4, 0, P.roof)
      box(batch, 1.6, 2.4, 0.4, 0, 2.2, 3.4, P.timberDark)
      house(batch, 8.5, 3.5, 6.5, 5, 3.6, 0.35, WALL_WARM, P.roof)
      // A low wall and a cart track stone.
      box(batch, 12, 1.1, 0.8, -2, 0.55, 7.5, P.limestoneShade, 0.15)
      return { geometry: batch.build(), lamp: [0.8, 6.4, 3.0], lampRadius: 0.5, sails: { position: [0, 10.2, 3.4], radius: 8 } }
    }
    default: {
      // Lake monastery: chapel with a steep gable, bell tower with a lantern, cloister wall, jetty, cypresses.
      box(batch, 18, 8, 9, 0, 4, 0, P.limestone)
      batch.tris(gable(18, 9, 5.2), place(0, 8, 0), SLATE)
      box(batch, 5.5, 24, 5.5, -9.5, 12, 1, P.limestone)
      cone(batch, 4.1, 5, 4, -9.5, 26.5, 1, SLATE, Math.PI / 4)
      box(batch, 1.4, 2.8, 0.4, -9.5, 21.6, 3.9, P.timberDark)
      // Cloister: low wall around a court, one range of cells.
      box(batch, 22, 2.4, 1, 13, 1.2, 10, P.limestoneShade)
      box(batch, 1, 2.4, 18, 24, 1.2, 1, P.limestoneShade)
      box(batch, 16, 5, 6, 15, 2.5, -6, WALL_PALE)
      batch.tris(gable(16, 6, 2.6), place(15, 5, -6), P.roof)
      // Jetty into the lake toward the camera.
      box(batch, 2.2, 0.4, 14, 3, 0.1, 15, P.timber)
      for (const z of [10, 14, 18, 21.5]) for (const x of [2, 4]) box(batch, 0.4, 1.6, 0.4, x, 0.5, z, P.timberDark)
      // Cypresses along the shore.
      for (const [x, z, h] of [
        [-16, 8, 9],
        [-19, 4, 7],
        [26, -2, 8],
      ] as const) {
        cone(batch, 1.4, h, 6, x, h / 2 + 0.4, z, P.forest)
        cylinder(batch, 0.25, 0.3, 0.8, 5, x, 0.4, z, P.timber)
      }
      return { geometry: batch.build(), lamp: [-9.5, 21.7, 4.2], lampRadius: 0.5 }
    }
  }
}

/** The far mill on the river's north reach: a timber mill house, pyramid roof and a water wheel on the river side. */
export function buildFarMill(grade: OuterGrade, haze: number): THREE.BufferGeometry {
  const batch = new Batch(skyColour(grade), Math.min(0.5, haze + 0.1))
  box(batch, 6.4, 4.2, 4.6, 0, 2.1, 0, P.timber)
  cone(batch, 4.6, 2.6, 4, 0, 5.5, 0, P.roof, Math.PI / 4)
  box(batch, 1.2, 2.1, 0.3, 1.2, 1.05, 2.4, P.timberDark)
  // Wheel: a torus standing on the river side (local −x), its rim dipping to the ground.
  const wheel = new THREE.TorusGeometry(2.1, 0.22, 5, 12)
  batch.geo(wheel, place(-3.6, 2.2, 0, Math.PI / 2), P.timberDark)
  wheel.dispose()
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.BoxGeometry(0.14, 4.2, 0.2)
    batch.geo(spoke, place(-3.6, 2.2, 0, 0, (i * Math.PI) / 4), P.timber)
    spoke.dispose()
  }
  box(batch, 1.2, 0.5, 0.5, -3.0, 2.2, 0, P.timberDark)
  return batch.build()
}

export function windmillSailsGeometry(radius: number): THREE.BufferGeometry {
  const batch = new Batch()
  for (const yaw of [0, Math.PI / 2]) {
    const arm = new THREE.BoxGeometry(radius * 2, 0.3, 0.2)
    batch.geo(arm, place(0, 0, 0, 0, 0, yaw), P.timberDark)
    arm.dispose()
    for (const side of [-1, 1]) {
      const cloth = new THREE.BoxGeometry(radius * 0.46, 1.3, 0.1)
      batch.geo(cloth, place(Math.cos(yaw) * side * radius * 0.6, Math.sin(yaw) * side * radius * 0.6 + 0.7, 0, 0, 0, yaw), '#eee2bf')
      cloth.dispose()
    }
  }
  return batch.build()
}
