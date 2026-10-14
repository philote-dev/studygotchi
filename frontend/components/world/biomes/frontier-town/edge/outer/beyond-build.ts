/**
 * Geometry for the inhabited beyond: every mid-field place merges into ONE vertex-coloured
 * batch (per-place haze baked by distance), the repeated dressing (fence rails, cattle, trees,
 * graves, milestones, lane ribbons, lights, smoke, carts, windmill wheels) is instanced, and the
 * things that move are built once and driven by the single outer motion loop. Toybox-chunky:
 * 20–60 primitives per mid place, 2–3 flat colours plus one accent each.
 */
import * as THREE from 'three'
import { FRONTIER_PALETTE as P } from '../../layout/biome-layout'
import type { OuterDesert } from './desert'
import { smoothstep } from './noise'
import { type Lane, type LanePoint, type Place, laneAt, laneAtInto, laneLength, laneSegments } from './places'
import { Batch, place as placeM } from './structures'

/* ---------- palette ---------- */

const ADOBE = '#d8b48a'
const ADOBE_SHADE = '#c49a68'
const WEATHERED = '#9a8a78'
const CREAM = P.canvas
const STEEL = '#55483f'

/** Aerial perspective baked per place: crisp at the apron, paler toward the fog. */
export function placeHaze(distance: number, night: boolean): number {
  const far = smoothstep(260, 650, distance)
  return night ? 0.06 + 0.2 * far : 0.1 + 0.32 * far
}

/* ---------- the static batch ---------- */

interface Frame {
  batch: Batch
  p: Place
  base: number
  haze: number
  root: THREE.Matrix4
}

function frameOf(batch: Batch, p: Place, base: number, night: boolean): Frame {
  const root = new THREE.Matrix4().compose(new THREE.Vector3(p.x, base, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.yaw, 0)), new THREE.Vector3(p.scale, p.scale, p.scale))
  return { batch, p, base, haze: placeHaze(p.distance, night), root }
}

/** Local → world matrix inside a place frame. */
function at(f: Frame, x: number, y: number, z: number, yaw = 0, tiltX = 0, tiltZ = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  return f.root.clone().multiply(placeM(x, y, z, yaw, tiltX, tiltZ, sx, sy, sz))
}

function box(f: Frame, w: number, h: number, d: number, x: number, y: number, z: number, color: string, yaw = 0, tiltX = 0, tiltZ = 0, facet = true): void {
  f.batch.box(w, h, d, at(f, x, y, z, yaw, tiltX, tiltZ), color, facet, f.haze)
}

function cyl(f: Frame, rTop: number, rBottom: number, h: number, sides: number, x: number, y: number, z: number, color: string, yaw = 0, tiltX = 0, tiltZ = 0): void {
  f.batch.geo(new THREE.CylinderGeometry(rTop, rBottom, h, sides), at(f, x, y, z, yaw, tiltX, tiltZ), color, true, f.haze)
}

function cone(f: Frame, r: number, h: number, sides: number, x: number, y: number, z: number, color: string, yaw = 0): void {
  f.batch.geo(new THREE.ConeGeometry(r, h, sides), at(f, x, y, z, yaw), color, true, f.haze)
}

function post(f: Frame, x: number, z: number, h: number, r = 0.16, color = P.timberDark): void {
  cyl(f, r, r * 1.15, h, 5, x, h / 2, z, color)
}

/** A false-front building: body, taller facade, awning on posts; `tall` for the saloon. */
function falseFront(f: Frame, x: number, z: number, yaw: number, w: number, h: number, wall: string, tall = false, roof: string = P.timberDark): void {
  const m = (lx: number, ly: number, lz: number) => {
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    return [x + lx * c + lz * s, ly, z - lx * s + lz * c] as const
  }
  const b = m(0, h / 2, 0)
  box(f, w, h, 5, b[0], b[1], b[2], wall, yaw)
  const fc = m(0, h + 0.8, 2.3)
  box(f, w + 0.7, 1.6 + (tall ? 0.8 : 0), 0.4, fc[0], fc[1], fc[2], wall, yaw)
  const rf = m(0, h + 0.3, -0.6)
  box(f, w + 0.2, 0.4, 5.6, rf[0], rf[1], rf[2], roof, yaw, 0.04, 0, false)
  const aw = m(0, 3.1, 3.4)
  box(f, w + 0.6, 0.25, 2.4, aw[0], aw[1], aw[2], roof, yaw, 0.12, 0, false)
  for (const px of [-w * 0.4, w * 0.4]) {
    const pp = m(px, 0, 3.3)
    post(f, pp[0], pp[2], 3)
  }
  const door = m(0, 1.2, 2.56)
  box(f, 1.2, 2.4, 0.12, door[0], door[1], door[2], P.ink, yaw, 0, 0, false)
}

function ranch(f: Frame): void {
  // House with porch and chimney; the one light sits in the porch window.
  box(f, 7, 4, 5.5, -6, 2, 4, P.sage)
  box(f, 7.6, 0.5, 6.1, -6, 4.25, 4, P.timberDark, 0, 0, 0, false)
  box(f, 7.4, 0.3, 2.4, -6, 2.9, 7.8, P.timber, 0, 0.1, 0, false)
  for (const x of [-9, -6, -3]) post(f, x, 8.6, 2.8)
  box(f, 0.8, 2.2, 0.8, -8.2, 5, 2.4, P.timberDark, 0, 0, 0, false)
  // Barn with a four-sided gable, a dark door.
  box(f, 10, 6, 8, 6, 3, -6, P.timber)
  cone(f, 7.6, 3.2, 4, 6, 7.6, -6, P.oxblood, Math.PI / 4)
  box(f, 3.4, 4.4, 0.2, 6, 2.2, -1.9, P.ink, 0, 0, 0, false)
  // Windmill tower (the wheel is instanced and spins).
  for (const [dx, dz] of [
    [-1.3, -1.3],
    [1.3, -1.3],
    [1.3, 1.3],
    [-1.3, 1.3],
  ]) cyl(f, 0.12, 0.16, 8.5, 5, 18 + dx, 4.25, -14 + dz, P.timberDark)
  for (const y of [3, 6]) box(f, 2.8 - y * 0.12, 0.16, 2.8 - y * 0.12, 18, y, -14, P.timber, 0, 0, 0, false)
  // Trough, well, hay.
  box(f, 3.6, 0.9, 1.4, 14, 0.45, -8, P.timber)
  box(f, 3.2, 0.1, 1.0, 14, 0.92, -8, P.water, 0, 0, 0, false)
  cyl(f, 1.1, 1.2, 1.0, 8, -14, 0.5, -6, P.strata)
  for (const x of [-15, -13]) post(f, x, -6, 2.6, 0.1)
  box(f, 2.6, 0.16, 0.16, -14, 2.5, -6, P.timberDark, 0, 0, 0, false)
  for (const [x, z] of [
    [2, 10],
    [4.4, 10.4],
  ]) cyl(f, 1.1, 1.1, 2.0, 8, x, 1.1, z, '#e8c96a', 0, Math.PI / 2)
}

function ghostTown(f: Frame): void {
  const fronts: Array<[number, number, number, number, number, string]> = [
    [-20, -7, 0, 6, 5, WEATHERED],
    [-11, -7, 0, 6.5, 6.2, '#8b6a4a'],
    [-2, -7, 0, 6, 5, WEATHERED],
    [8, -7, 0, 7, 5.4, '#7f6a5e'],
    [-16, 8, Math.PI, 6, 5.2, '#8b6a4a'],
    [-6, 8, Math.PI, 6.5, 5, WEATHERED],
  ]
  for (const [x, z, yaw, w, h, wall] of fronts) falseFront(f, x, z, yaw, w, h, wall, false, '#5a4a40')
  // One front fallen in: a tilted roof slab and a leaning wall.
  box(f, 6, 4.2, 0.4, 5, 1.8, 8, WEATHERED, 0, 0.5, 0)
  box(f, 6.4, 0.4, 4, 4, 3.2, 10.4, '#5a4a40', 0.2, 0.9, 0, false)
  // Leaning water tower.
  for (const [dx, dz] of [
    [-1.6, -1.6],
    [1.6, -1.6],
    [1.6, 1.6],
    [-1.6, 1.6],
  ]) cyl(f, 0.2, 0.26, 8, 5, 20 + dx, 4, 2 + dz, P.timberDark, 0, 0.11, 0.06)
  cyl(f, 2.4, 2.4, 3.2, 10, 20.9, 9.4, 2.4, '#7d8a86', 0, 0.11, 0.06)
  // Broken wagon, hitch rail, dry trough.
  box(f, 4, 1.1, 2.2, -4, 0.9, 1, '#8b6a4a', 0.4, 0, 0.12)
  f.batch.geo(new THREE.TorusGeometry(0.85, 0.13, 5, 10), at(f, -5.6, 0.85, 2.2, 0.4 + Math.PI / 2), P.timberDark, false, f.haze)
  f.batch.geo(new THREE.TorusGeometry(0.85, 0.13, 5, 10), at(f, -1.2, 0.3, 3.4, 1.2, Math.PI / 2), P.timberDark, false, f.haze)
  for (const x of [8, 11]) post(f, x, 1, 1.2, 0.1)
  box(f, 3.2, 0.14, 0.14, 9.5, 1.1, 1, P.timberDark, 0, 0, 0, false)
  for (const [x, z] of [
    [14, -2],
    [-9, 4],
  ]) f.batch.geo(new THREE.TorusGeometry(1.0, 0.1, 4, 9), at(f, x, 1, z, x), '#8f6848', false, f.haze)
}

function mine(f: Frame): void {
  // Headframe: four legs leaning in, bands, a cap and the sheave wheel.
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) box(f, 0.5, 14, 0.5, sx * 2.2, 7, sz * 2.2, P.timberDark, 0, sz * -0.06, sx * -0.14)
  for (const y of [4, 8, 12]) box(f, 5.4 - y * 0.14, 0.3, 4.8 - y * 0.1, 0, y, 0, P.timber, 0, 0, 0, false)
  box(f, 5.2, 0.9, 4.6, 0, 13.6, 0, P.timberDark)
  f.batch.geo(new THREE.TorusGeometry(1.5, 0.22, 6, 12), at(f, 0, 13.6, 2.6), P.copper, true, f.haze)
  // Adit mouth in the knob behind, with its timber frame.
  box(f, 3.2, 3.6, 2.4, -14, 1.8, -10, P.ink, 0.5, 0, 0, false)
  for (const x of [-15.6, -12.4]) box(f, 0.5, 3.8, 0.5, x, 1.9, -8.6, P.timber, 0.5)
  box(f, 3.8, 0.5, 0.5, -14, 3.9, -8.6, P.timber, 0.5)
  // Ore-cart track from the adit past the headframe, carts, tailings.
  box(f, 1.4, 0.2, 26, 4, 0.1, 2, P.timberDark, 0, 0, 0, false)
  for (const z of [-9, -5, -1, 3, 7, 11]) box(f, 2.0, 0.12, 0.3, 4, 0.2, z, P.timber, 0, 0, 0, false)
  for (const z of [-4, 1, 9]) box(f, 1.6, 1.1, 1.3, 4, 0.9, z, P.copper)
  cone(f, 4.2, 2.6, 8, 12, 1.3, 10, P.strata)
  cone(f, 3.2, 2.2, 8, 17, 1.1, 5, '#9e724b')
  // Boiler house with a stack (the smoke source), an office shed (the light), a water tank.
  box(f, 7, 4, 6, -4, 2, 6, P.timber)
  box(f, 7.6, 0.4, 6.6, -4, 4.2, 6, P.timberDark, 0, 0, 0, false)
  cyl(f, 1.3, 1.5, 4, 8, -1, 2, 10, P.copper)
  cyl(f, 0.5, 0.55, 5, 6, -4, 6.5, 4, P.ink)
  box(f, 5, 3.4, 4, 10, 1.7, 6, P.sage)
  box(f, 5.6, 0.4, 4.6, 10, 3.6, 6, P.timberDark, 0, 0, 0, false)
  cyl(f, 1.6, 1.6, 2.4, 8, 12, 5.2, -4, P.teal)
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) cyl(f, 0.14, 0.18, 4, 5, 12 + dx, 2, -4 + dz, P.timberDark)
}

function railYard(f: Frame, night: boolean): void {
  // Local +z runs toward the trestle; the main line is x = 0. Depot, platform and canopy.
  box(f, 14, 5, 7, -9, 2.5, 6, P.teal)
  box(f, 15, 0.6, 8, -9, 5.3, 6, P.oxblood, 0, 0, 0, false)
  box(f, 5, 0.6, 22, -4.5, 0.3, 4, P.timber, 0, 0, 0, false)
  for (const z of [-5, 1, 7, 13]) post(f, -3, z, 4, 0.18)
  box(f, 4.4, 0.3, 22, -4.2, 4.1, 4, P.sage, 0, 0, -0.05, false)
  // Water tank on posts, a signal mast (the light), a coal pile.
  cyl(f, 2.2, 2.2, 3, 10, 6, 7.5, 8, P.teal)
  cone(f, 2.5, 1, 10, 6, 9.5, 8, P.oxblood)
  for (const [dx, dz] of [
    [-1.3, -1.3],
    [1.3, -1.3],
    [1.3, 1.3],
    [-1.3, 1.3],
  ]) cyl(f, 0.2, 0.24, 6, 5, 6 + dx, 3, 8 + dz, P.timberDark)
  post(f, 4, 14, 7, 0.16)
  box(f, 2.4, 0.26, 0.26, 5, 6.4, 14, P.timberDark, 0, 0, 0, false)
  cone(f, 3, 2.4, 7, 9, 1.2, -4, P.ink)
  // Sidings either side of the main line, and the engine shed the line runs through.
  for (const x of [-5.3, -4.7, 5.3, 5.9]) box(f, 0.26, 0.26, 56, x, 0.32, -10, STEEL, 0, 0, 0, false)
  for (let z = -36; z <= 16; z += 2.6) for (const x of [-5, 5.6]) box(f, 2.4, 0.16, 0.5, x, 0.14, z, P.timberDark, 0, 0, 0, false)
  box(f, 11, 7, 46, 0, 3.5, -30, P.timber)
  box(f, 12, 0.6, 47, 0, 7.2, -30, P.timberDark, 0, 0, 0, false)
  box(f, 11.6, 1.4, 0.4, 0, 6.3, -7, P.oxblood, 0, 0, 0, false)
  // The stationary train on the west siding.
  cyl(f, 1.3, 1.3, 6.5, 10, -5, 2.1, 8, P.ink, 0, Math.PI / 2)
  box(f, 3, 3.6, 3.2, -5, 2.4, 3.6, P.oxblood)
  box(f, 3.3, 0.4, 3.5, -5, 4.4, 3.6, P.ink, 0, 0, 0, false)
  cyl(f, 0.42, 0.55, 2.2, 8, -5, 4.3, 10.4, P.ink)
  box(f, 2.8, 2.2, 4.6, -5, 1.7, -1.4, P.ink)
  for (const [z, color] of [
    [-7, P.teal],
    [-13.6, P.mustard],
    [-20.2, P.timber],
  ] as Array<[number, string]>) {
    box(f, 3, 3.2, 6, -5, 2.2, z, color)
    box(f, 3.2, 0.36, 6.2, -5, 3.98, z, P.ink, 0, 0, 0, false)
  }
  for (let z = -22; z <= 10; z += 2.4) box(f, 3.1, 1.0, 0.5, -5, 0.6, z, P.ink, 0, 0, 0, false)
  // Freight on the platform.
  for (const [x, z] of [
    [-8, -2],
    [-7, 10],
    [-10, 12],
  ]) box(f, 1.8, 1.5, 1.8, x, 1.35, z, night ? P.timber : P.mustard)
}

function pueblo(f: Frame): void {
  // Two tiers of adobe rooms round a small plaza, ladders, vigas, a kiva and two hornos.
  const rooms: Array<[number, number, number, number, number, number, string]> = [
    // x, z, w, d, h, tier (0/1), colour
    [-8, 6, 7, 6, 3.6, 0, ADOBE],
    [-1, 7, 6, 5, 3.4, 0, ADOBE_SHADE],
    [5, 6, 6, 6, 3.8, 0, ADOBE],
    [-9, -2, 6, 6, 3.4, 0, ADOBE_SHADE],
    [6, -3, 7, 7, 3.6, 0, ADOBE],
    [-7, 6, 4.4, 4, 3, 1, ADOBE_SHADE],
    [5, 6, 4, 4.4, 2.8, 1, ADOBE],
    [6, -3, 4.6, 4.4, 3, 1, ADOBE_SHADE],
    [-2, -8, 5, 5, 3.2, 0, ADOBE],
  ]
  for (const [x, z, w, d, h, tier, color] of rooms) {
    const y0 = tier === 0 ? 0 : 3.6
    box(f, w, h, d, x, y0 + h / 2, z, color)
    box(f, w + 0.3, 0.3, d + 0.3, x, y0 + h + 0.15, z, ADOBE_SHADE, 0, 0, 0, false)
    for (const vx of [-w * 0.3, 0, w * 0.3]) box(f, 0.3, 0.3, 0.9, x + vx, y0 + h - 0.5, z + d / 2 + 0.3, P.timberDark, 0, 0, 0, false)
  }
  for (const [x, z] of [
    [-4.5, 4],
    [2, 4.5],
    [3.4, -0.4],
  ]) {
    for (const dx of [-0.4, 0.4]) box(f, 0.14, 4.6, 0.14, x + dx, 2.3, z, P.timber, 0, -0.35, 0, false)
    for (const y of [1, 2, 3]) box(f, 1.0, 0.1, 0.1, x, y, z + (2.3 - y) * 0.36, P.timber, 0, 0, 0, false)
  }
  f.batch.geo(new THREE.TorusGeometry(2.6, 0.5, 5, 12), at(f, 0, 0.3, 0, 0, Math.PI / 2), ADOBE_SHADE, true, f.haze)
  for (const [x, z] of [
    [-12, 2],
    [10, 1],
  ]) f.batch.geo(new THREE.SphereGeometry(1.1, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2), at(f, x, 0, z), ADOBE, true, f.haze)
  for (const [x, z] of [
    [-11, -7],
    [11, -8],
  ]) post(f, x, z, 3.2, 0.12)
}

/** The ferry's banks: landings, rope posts and the rope, a hut; the raft itself moves (see `buildRaft`). */
function ferry(f: Frame, channelYaw: number): void {
  const c = Math.cos(channelYaw - f.p.yaw)
  const s = Math.sin(channelYaw - f.p.yaw)
  // Across-channel axis in the place frame.
  const across = (t: number, along = 0) => [t * c + along * s, -t * s + along * c] as const
  for (const side of [-1, 1]) {
    const [px, pz] = across(side * 9.5)
    post(f, px, pz, 3.2, 0.2)
    const [lx, lz] = across(side * 10.5, 0)
    box(f, 5, 0.4, 3.4, lx, 0.1, lz, P.timber, -(channelYaw - f.p.yaw), 0, 0, false)
  }
  const [rx, rz] = across(0)
  box(f, 19, 0.1, 0.1, rx, 2.9, rz, P.ink, -(channelYaw - f.p.yaw), 0, 0, false)
  const [hx, hz] = across(13, 4)
  box(f, 4, 2.8, 3.4, hx, 1.4, hz, P.timber)
  box(f, 4.6, 0.4, 4, hx, 3.0, hz, P.timberDark, 0, 0, 0, false)
  for (const [bx, bz] of [across(12, 7.5), across(14.2, 7.2)]) cyl(f, 0.45, 0.4, 1.0, 7, bx, 0.5, bz, P.oxblood)
}

function chapel(f: Frame): void {
  box(f, 8, 5, 12, 0, 2.5, 0, CREAM)
  for (const side of [-1, 1]) box(f, 5.2, 0.4, 12.6, side * 2.2, 6.0, 0, P.oxblood, 0, 0, side * 0.62, false)
  box(f, 3, 3.6, 0.6, 0, 7.2, 5.8, CREAM)
  box(f, 1.2, 1.6, 0.7, 0, 7.6, 5.8, P.ink, 0, 0, 0, false)
  box(f, 0.3, 1.8, 0.3, 0, 9.8, 5.8, P.timberDark, 0, 0, 0, false)
  box(f, 1.2, 0.3, 0.3, 0, 10.1, 5.8, P.timberDark, 0, 0, 0, false)
  box(f, 1.6, 2.8, 0.2, 0, 1.4, 6.1, P.oxblood, 0, 0, 0, false)
  for (const [x, z, w, d] of [
    [-6, 0, 0.6, 14],
    [6, 0, 0.6, 14],
    [0, -7.4, 12.6, 0.6],
  ]) box(f, w, 1.2, d, x, 0.6, z, ADOBE_SHADE)
  for (const z of [-5, -1.5, 2]) for (const x of [-4.5, 4.5]) box(f, 0.5, 0.9, 0.12, x, 1.4, z, P.ink, 0, 0, 0, false)
}

function cemetery(f: Frame): void {
  // Gate arch, a dead tree, a small shrine with its lantern post (the light).
  for (const x of [-1.4, 1.4]) post(f, x, 7.5, 3.4, 0.16)
  box(f, 3.6, 0.3, 0.3, 0, 3.5, 7.5, P.timberDark, 0, 0, 0, false)
  cyl(f, 0.25, 0.4, 4.2, 5, -8, 2.1, -5, '#4a3c36')
  for (const [yaw, tilt] of [
    [0.4, 0.9],
    [2.4, 1.1],
    [4.2, 0.8],
  ]) box(f, 0.18, 2.6, 0.18, -8 + Math.sin(yaw) * 0.9, 4.4, -5 + Math.cos(yaw) * 0.9, '#4a3c36', yaw, tilt, 0, false)
  box(f, 1.6, 1.8, 1.2, 8, 0.9, -5, ADOBE)
  cone(f, 1.2, 0.9, 4, 8, 2.25, -5, P.oxblood, Math.PI / 4)
  post(f, 0, 9, 2.4, 0.1)
}

function crossroads(f: Frame): void {
  falseFront(f, 0, 0, 0, 8, 6, P.oxblood, true, P.timberDark)
  box(f, 8.2, 0.3, 2, 0, 4.4, 3.3, P.timber, 0, 0, 0, false)
  for (const x of [-3.4, 3.4]) post(f, x, 4.1, 2.2, 0.1)
  box(f, 6.2, 0.14, 0.14, 0, 5.1, 2.9, P.mustard, 0, 0, 0, false)
  box(f, 0.8, 2.6, 0.8, 2.2, 7.3, -1.5, P.timberDark, 0, 0, 0, false)
  // Hitch rail, trough, barrels, the signpost and a lamp.
  for (const x of [-9, -6]) post(f, x, 6, 1.2, 0.1)
  box(f, 3.2, 0.14, 0.14, -7.5, 1.1, 6, P.timberDark, 0, 0, 0, false)
  box(f, 3.6, 0.9, 1.3, 8, 0.45, 5, P.timber)
  box(f, 3.2, 0.1, 0.9, 8, 0.92, 5, P.water, 0, 0, 0, false)
  for (const [x, z] of [
    [6, -6],
    [7.2, -6.6],
    [6.4, -7.9],
  ]) cyl(f, 0.5, 0.45, 1.1, 7, x, 0.55, z, P.timber)
  post(f, -3, 12, 3.8, 0.12)
  for (const [y, yaw, len] of [
    [3.4, 0.3, 1.8],
    [2.9, 1.9, 1.6],
    [2.4, -1.1, 1.7],
  ]) box(f, len, 0.3, 0.1, -3 + Math.cos(yaw) * len * 0.45, y, 12 - Math.sin(yaw) * len * 0.45, CREAM, yaw, 0, 0, false)
  post(f, 5, 11, 3.6, 0.1)
  // Stable by the pen.
  box(f, 7, 3.4, 5, 16, 1.7, -7, P.timber)
  box(f, 7.6, 0.4, 5.6, 16, 3.6, -7, P.timberDark, 0, 0, 0, false)
}

function cattleDrive(f: Frame): void {
  // Chuck wagon with a canvas top, the fire (the light sits in it), two riders.
  box(f, 4.2, 1.2, 2.2, 14, 1.1, -4, P.timber)
  cyl(f, 1.3, 1.3, 4.0, 8, 14, 2.3, -4, CREAM, 0, 0, Math.PI / 2)
  for (const [x, z] of [
    [12.4, -5.2],
    [15.6, -5.2],
    [12.4, -2.8],
    [15.6, -2.8],
  ]) f.batch.geo(new THREE.TorusGeometry(0.7, 0.12, 5, 10), at(f, x, 0.7, z, 0, Math.PI / 2), P.timberDark, false, f.haze)
  for (const yaw of [0, 1.1, 2.2]) box(f, 1.6, 0.3, 0.3, 14 + Math.cos(yaw) * 0.3, 0.3, -1 - Math.sin(yaw) * 0.3, '#4a3c36', yaw, 0, 0, false)
  for (const [x, z] of [
    [-4, 10],
    [6, -12],
  ]) {
    box(f, 1.8, 1.0, 0.8, x, 1.3, z, '#6a4632', 0.6)
    box(f, 0.6, 0.9, 0.5, x, 2.25, z, P.teal, 0.6)
    f.batch.geo(new THREE.SphereGeometry(0.3, 6, 5), at(f, x, 2.9, z), CREAM, true, f.haze)
    cyl(f, 0.5, 0.5, 0.2, 8, x, 3.1, z, P.timber)
  }
}

export interface BeyondBuilt {
  geometry: THREE.BufferGeometry
  triangles: number
}

/** Ground height each place stands on (its pad). */
export function placeBase(desert: OuterDesert, p: Place): number {
  return desert.heightAt(p.x, p.z)
}

/** Channel heading at the ferry (its nearest arroyo segment). */
export function ferryChannelYaw(desert: OuterDesert, ferry: Place): number {
  const a = desert.arroyo
  let best = 1
  let bestD = Infinity
  for (let i = 1; i < a.length; i++) {
    const d = Math.hypot((a[i - 1][0] + a[i][0]) / 2 - ferry.x, (a[i - 1][1] + a[i][1]) / 2 - ferry.z)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return Math.atan2(a[best][0] - a[best - 1][0], a[best][1] - a[best - 1][1])
}

/** Every static place in one batch. */
export function buildPlaces(desert: OuterDesert, night: boolean): BeyondBuilt {
  const batch = new Batch(night)
  for (const p of desert.places) {
    const f = frameOf(batch, p, placeBase(desert, p), night)
    switch (p.kind) {
      case 'ranch':
        ranch(f)
        break
      case 'ghost-town':
        ghostTown(f)
        break
      case 'mine':
        mine(f)
        break
      case 'rail-yard':
        railYard(f, night)
        break
      case 'pueblo':
        pueblo(f)
        break
      case 'ferry':
        ferry(f, ferryChannelYaw(desert, p))
        break
      case 'chapel':
        chapel(f)
        break
      case 'cemetery':
        cemetery(f)
        break
      case 'crossroads':
        crossroads(f)
        break
      case 'cattle-drive':
        cattleDrive(f)
        break
    }
  }
  const triangles = batch.triangles
  return { geometry: batch.build(), triangles }
}

/* ---------- instanced dressing: unit geometries ---------- */

export type DressingKind = 'fence' | 'cattle' | 'tree' | 'grave' | 'milestone' | 'lane' | 'light' | 'smoke' | 'cart' | 'wheel' | 'raft'

interface Part {
  geometry: THREE.BufferGeometry
  matrix: THREE.Matrix4
  color: string
}

function merge(parts: Part[], night: boolean, haze = 0.12): THREE.BufferGeometry {
  const batch = new Batch(night, haze)
  for (const part of parts) batch.geo(part.geometry, part.matrix, part.color, true)
  return batch.build()
}

const M = placeM

/** Unit geometry per dressing kind (metres at scale 1; instances scale and place them). */
export function dressingGeometry(kind: DressingKind, night: boolean): THREE.BufferGeometry {
  switch (kind) {
    case 'fence':
      // One rail segment of unit length along local x, two rails and a post at its start.
      return merge(
        [
          { geometry: new THREE.BoxGeometry(1, 0.12, 0.12), matrix: M(0, 0.85, 0), color: P.timber },
          { geometry: new THREE.BoxGeometry(1, 0.12, 0.12), matrix: M(0, 1.45, 0), color: P.timber },
          { geometry: new THREE.BoxGeometry(0.2, 1.8, 0.2), matrix: M(-0.5, 0.9, 0), color: P.timberDark },
        ],
        night,
      )
    case 'cattle':
      return merge(
        [
          { geometry: new THREE.BoxGeometry(1.5, 0.8, 0.7), matrix: M(0, 0.9, 0), color: '#8a6045' },
          { geometry: new THREE.BoxGeometry(0.5, 0.5, 0.45), matrix: M(0.95, 1.1, 0), color: '#6a4632' },
        ],
        night,
      )
    case 'tree':
      return merge(
        [
          { geometry: new THREE.CylinderGeometry(0.3, 0.42, 3.6, 5), matrix: M(0, 1.8, 0), color: P.timberDark },
          { geometry: new THREE.DodecahedronGeometry(2.6, 0), matrix: M(0, 5.0, 0, 0.4), color: '#5f7d4a' },
          { geometry: new THREE.DodecahedronGeometry(1.8, 0), matrix: M(1.4, 4.0, 0.8, 1.2), color: '#6b8a52' },
        ],
        night,
      )
    case 'grave':
      return merge(
        [
          { geometry: new THREE.BoxGeometry(0.7, 1.0, 0.16), matrix: M(0, 0.5, 0), color: '#b8ad9a' },
          { geometry: new THREE.BoxGeometry(0.14, 1.0, 0.14), matrix: M(0, 1.1, -0.6), color: P.timberDark },
          { geometry: new THREE.BoxGeometry(0.6, 0.14, 0.14), matrix: M(0, 1.3, -0.6), color: P.timberDark },
        ],
        night,
      )
    case 'milestone':
      return merge(
        [
          { geometry: new THREE.BoxGeometry(0.44, 1.1, 0.32), matrix: M(0, 0.55, 0), color: CREAM },
          { geometry: new THREE.BoxGeometry(0.46, 0.16, 0.34), matrix: M(0, 0.86, 0), color: P.ink },
        ],
        night,
      )
    case 'lane': {
      // A flat unit quad, length along local z; instances scale its width and length.
      const geo = new THREE.PlaneGeometry(1, 1, 1, 1)
      geo.rotateX(-Math.PI / 2)
      geo.translate(0, 0, 0.5)
      // Wagon-rut core by day; at night a shade lighter than the ground rather than a pale line.
      return merge([{ geometry: geo, matrix: M(0, 0, 0), color: night ? '#a98a6a' : '#cfae78' }], night, 0)
    }
    case 'light':
      return new THREE.SphereGeometry(1, 7, 5)
    case 'smoke':
      return new THREE.DodecahedronGeometry(1, 0)
    case 'cart':
      return merge(
        [
          { geometry: new THREE.BoxGeometry(2.2, 1.0, 4.0), matrix: M(0, 1.0, 0), color: P.timber },
          { geometry: new THREE.CylinderGeometry(1.2, 1.2, 3.6, 8), matrix: M(0, 2.0, -0.2, 0, Math.PI / 2), color: CREAM },
          { geometry: new THREE.TorusGeometry(0.7, 0.12, 5, 10), matrix: M(-1.2, 0.7, -1.2, Math.PI / 2), color: P.timberDark },
          { geometry: new THREE.TorusGeometry(0.7, 0.12, 5, 10), matrix: M(1.2, 0.7, -1.2, Math.PI / 2), color: P.timberDark },
          { geometry: new THREE.TorusGeometry(0.7, 0.12, 5, 10), matrix: M(-1.2, 0.7, 1.2, Math.PI / 2), color: P.timberDark },
          { geometry: new THREE.TorusGeometry(0.7, 0.12, 5, 10), matrix: M(1.2, 0.7, 1.2, Math.PI / 2), color: P.timberDark },
          { geometry: new THREE.BoxGeometry(1.6, 1.0, 1.0), matrix: M(0, 1.2, 3.6), color: '#6a4632' },
          { geometry: new THREE.BoxGeometry(0.5, 0.6, 0.6), matrix: M(0, 1.9, 4.2), color: '#6a4632' },
        ],
        night,
      )
    case 'wheel':
      return merge(
        [
          { geometry: new THREE.TorusGeometry(1.9, 0.12, 5, 12), matrix: M(0, 0, 0), color: CREAM },
          ...Array.from({ length: 8 }, (_, i) => ({ geometry: new THREE.BoxGeometry(0.12, 3.7, 0.1), matrix: M(0, 0, 0, 0, 0, (i * Math.PI) / 8), color: P.timberDark })),
        ],
        night,
      )
    case 'raft':
      return merge(
        [
          { geometry: new THREE.BoxGeometry(6, 0.5, 4), matrix: M(0, 0.25, 0), color: P.timber },
          { geometry: new THREE.BoxGeometry(6, 0.8, 0.14), matrix: M(0, 0.9, 1.9), color: P.timberDark },
          { geometry: new THREE.BoxGeometry(6, 0.8, 0.14), matrix: M(0, 0.9, -1.9), color: P.timberDark },
          { geometry: new THREE.BoxGeometry(2.2, 1.8, 1.8), matrix: M(1.6, 1.4, 0), color: CREAM },
          { geometry: new THREE.BoxGeometry(0.14, 3.2, 0.14), matrix: M(-2.4, 2.1, 0), color: P.timberDark },
        ],
        night,
      )
  }
}

/* ---------- lane ribbons ---------- */

export interface Ribbon {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  length: number
  width: number
}

/** Lane segments as ribbons laid on the ground (each tilted by the height difference across it). */
export function laneRibbons(desert: OuterDesert, lanes: Lane[], width = 3.2): Ribbon[] {
  const out: Ribbon[] = []
  for (const lane of lanes) {
    for (const seg of laneSegments(lane, 10)) {
      const ex = seg.x + Math.sin(seg.yaw) * seg.length
      const ez = seg.z + Math.cos(seg.yaw) * seg.length
      const y0 = desert.heightAt(seg.x, seg.z) + 0.12
      const y1 = desert.heightAt(ex, ez) + 0.12
      const length = Math.hypot(seg.length, y1 - y0)
      out.push({ x: seg.x, y: y0, z: seg.z, yaw: seg.yaw, pitch: -Math.atan2(y1 - y0, seg.length), length: length + 0.6, width: width * (lane.stage ? 1.2 : 1) })
    }
  }
  return out
}

/* ---------- motion tables ---------- */

export interface Route {
  lane: Lane
  length: number
  /** Ground height every `step` metres along the lane. */
  heights: Float32Array
  step: number
}

export function buildRoute(desert: OuterDesert, lane: Lane, step = 2): Route {
  const length = laneLength(lane)
  const n = Math.floor(length / step) + 2
  const heights = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = laneAt(lane, Math.min(length, i * step))
    heights[i] = desert.heightAt(p.x, p.z)
  }
  return { lane, length, heights, step }
}

export function routeHeight(route: Route, s: number): number {
  const k = Math.max(0, Math.min(route.heights.length - 1.001, s / route.step))
  const i = Math.floor(k)
  const t = k - i
  return route.heights[i] + (route.heights[i + 1] - route.heights[i]) * t
}

export interface Pose4 {
  x: number
  y: number
  z: number
  yaw: number
}

const lanePoint: LanePoint = { x: 0, z: 0, yaw: 0 }

/** Ping-pong position along a route for a cart that walks at `speed` m/s, written into `out` (no allocation). */
export function cartInto(route: Route, time: number, speed: number, phase: number, out: Pose4): Pose4 {
  const cycle = (route.length * 2) / speed
  const k = (((time + phase) % cycle) + cycle) % cycle
  const forward = k * speed <= route.length
  const s = forward ? k * speed : route.length * 2 - k * speed
  const p = laneAtInto(route.lane, s, lanePoint)
  out.x = p.x
  out.y = routeHeight(route, s) + 0.1
  out.z = p.z
  out.yaw = forward ? p.yaw : p.yaw + Math.PI
  return out
}
