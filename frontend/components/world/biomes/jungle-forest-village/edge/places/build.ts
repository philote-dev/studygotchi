/**
 * Geometry for the inhabited beyond. Every static primitive of every place merges into one
 * vertex-coloured batch (one draw call), the dirt paths into one ribbon, the still water into one
 * unlit sheet; repeated things (stilt huts, posts and totems, logs, parrots, the lights, the
 * smoke puffs, the two canoes) are instanced. Toybox-chunky: boxes, prisms, cones and
 * dodecahedra in the land's palette, with the aerial haze of each place baked in.
 */
import * as THREE from 'three'
import { JUNGLE_PALETTE as P, seeded } from '../../layout/jungle-layout'
import { DELTA_CHANNELS, OUTER_RIVER } from '../barriers/geography'
import { Batch, ROOT_DEPTH, crown, place as placeMatrix, prism } from '../barriers/build'
import { mistColour, type OuterWorld } from '../outer/heightfield'
import { type Place, type PlaceLight, placeLight } from './plan'

/* ---------- palette ---------- */

const TONE = {
  bark: P.bark,
  wood: P.deck,
  woodDark: '#a27647',
  thatch: '#8c6843',
  thatchDark: '#6c4c37',
  wall: '#9a6c45',
  stone: P.ruin,
  stoneDark: '#948673',
  stoneCut: '#cdbfa6',
  rock: '#617c55',
  moss: P.cliff,
  canopy: P.canopy,
  canopyLight: '#3f7f4d',
  canopyDark: P.canopyDark,
  bank: '#609b58',
  mud: '#8c6843',
  path: P.path,
  gold: P.gold,
  coral: P.coral,
  terracotta: '#d97a58',
  sailGold: '#e6b45a',
  fire: '#f2b84f',
  ember: '#ff7a3a',
  smoke: '#c9d6d0',
  fall: '#f2fff1',
  water: '#9fd3d0',
  paddy: '#cfe3dc',
  waterNight: '#1f6268',
  paddyNight: '#223f3b',
} as const

const BARK_LIGHT = '#65442f'

/** Creature-accent colours for the parrots (fleet charter). */
const PARROTS = ['#e88a8a', '#f2a86f', '#8fc9d8', '#c9a2e6', '#f2b84f'] as const

/* ---------- instances ---------- */

export interface Instance {
  x: number
  y: number
  z: number
  yaw: number
  sx: number
  sy: number
  sz: number
  color: string
  /** Extra lean (rotation.z) for posts. */
  tilt?: number
}

export interface Light {
  x: number
  y: number
  z: number
  radius: number
  intensity: number
  placeId: string
}

export interface Fire {
  x: number
  y: number
  z: number
  scale: number
}

export interface CanoeTrack {
  /** Points along the water (x, y, z) and their cumulative arclength. */
  points: Float32Array
  arclength: Float32Array
  total: number
}

export interface PlacesBuild {
  statics: THREE.BufferGeometry
  paths: THREE.BufferGeometry
  water: THREE.BufferGeometry
  huts: Instance[]
  posts: Instance[]
  logs: Instance[]
  parrots: Instance[]
  lights: Light[]
  fires: Fire[]
  canoes: CanoeTrack[]
  /** Static triangles (batch + paths + water). */
  staticTriangles: number
}

const _c = new THREE.Color()
const _m = new THREE.Color()

/** The place frame: local (lx, lz) → world, with three's rotation.y convention. */
function toWorld(p: Place, lx: number, lz: number): [number, number] {
  const cs = Math.cos(p.yaw)
  const sn = Math.sin(p.yaw)
  return [p.x + (lx * cs + lz * sn) * p.scale, p.z + (-lx * sn + lz * cs) * p.scale]
}

/* ---------- small vocabulary ---------- */

interface Ctx {
  batch: Batch
  water: Batch
  world: OuterWorld
  night: boolean
  haze: number
  rng: () => number
  huts: Instance[]
  posts: Instance[]
  logs: Instance[]
  parrots: Instance[]
  lights: Light[]
  fires: Fire[]
}

function box(ctx: Ctx, x: number, y: number, z: number, w: number, h: number, d: number, yaw: number, color: string, facet = true, tiltX = 0, tiltZ = 0): void {
  const geo = new THREE.BoxGeometry(w, h, d)
  ctx.batch.geo(geo, placeMatrix(x, y, z, yaw, tiltX, tiltZ), color, facet, ctx.haze)
  geo.dispose()
}

function cone(ctx: Ctx, x: number, y: number, z: number, radius: number, height: number, sides: number, yaw: number, color: string): void {
  const geo = new THREE.ConeGeometry(radius, height, sides)
  ctx.batch.geo(geo, placeMatrix(x, y, z, yaw), color, true, ctx.haze)
  geo.dispose()
}

function blob(ctx: Ctx, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, color: string, facet = true): void {
  const geo = new THREE.DodecahedronGeometry(1, 0)
  ctx.batch.geo(geo, placeMatrix(x, y, z, yaw, 0, 0, sx, sy, sz), color, facet, ctx.haze)
  geo.dispose()
}

/** A flat polygon of still water (unlit sheet). */
function sheet(ctx: Ctx, x: number, y: number, z: number, rx: number, rz: number, sides: number, yaw: number, color: string): void {
  const geo = new THREE.CylinderGeometry(1, 1, 0.12, sides)
  ctx.water.geo(geo, placeMatrix(x, y, z, yaw, 0, 0, rx, 1, rz), color, false, ctx.haze * 0.6)
  geo.dispose()
}

/** A stilt hut instance of `size` metres across (the unit geometry carries its own stilts). */
function hut(ctx: Ctx, x: number, y: number, z: number, yaw: number, size: number, _stilt: number, color: string = TONE.wall): void {
  ctx.huts.push({ x, y, z, yaw, sx: size, sy: size, sz: size, color })
}

function post(ctx: Ctx, x: number, y: number, z: number, radius: number, height: number, color: string, tilt = 0, yaw = 0): void {
  ctx.posts.push({ x, y, z, yaw, sx: radius, sy: height, sz: radius, color, tilt })
}

function log(ctx: Ctx, x: number, y: number, z: number, yaw: number, radius: number, length: number, color: string = TONE.bark): void {
  ctx.logs.push({ x, y, z, yaw, sx: radius, sy: radius, sz: length, color })
}

function light(ctx: Ctx, p: Place, x: number, y: number, z: number, spec: PlaceLight): void {
  ctx.lights.push({ x, y, z, radius: spec.radius, intensity: spec.intensity, placeId: p.id })
}

function fire(ctx: Ctx, x: number, y: number, z: number, scale: number): void {
  // Stone ring, three logs, the flame.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2
    box(ctx, x + Math.cos(a) * 1.1 * scale, y + 0.25 * scale, z + Math.sin(a) * 1.1 * scale, 0.6 * scale, 0.5 * scale, 0.5 * scale, a, TONE.rock)
  }
  for (let k = 0; k < 3; k++) box(ctx, x, y + 0.3 * scale, z, 0.3 * scale, 0.3 * scale, 1.6 * scale, (k * Math.PI) / 3, BARK_LIGHT, false)
  ctx.fires.push({ x, y: y + 0.6 * scale, z, scale })
}

/** Nearest point on any channel to (x, z), its distance, and the channel's direction there. */
function channelPoint(x: number, z: number): { d: number; x: number; z: number; dir: [number, number] } {
  let best = { d: Number.POSITIVE_INFINITY, x, z, dir: [1, 0] as [number, number] }
  for (const channel of [OUTER_RIVER, ...DELTA_CHANNELS]) {
    for (let i = 1; i < channel.length; i++) {
      const [ax, az] = channel[i - 1]
      const [bx, bz] = channel[i]
      const dx = bx - ax
      const dz = bz - az
      const len2 = dx * dx + dz * dz || 1
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2))
      const px = ax + dx * t
      const pz = az + dz * t
      const d = Math.hypot(px - x, pz - z)
      if (d < best.d) {
        const len = Math.sqrt(len2)
        best = { d, x: px, z: pz, dir: [dx / len, dz / len] }
      }
    }
  }
  return best
}

/* ---------- places ---------- */

function buildHamlet(ctx: Ctx, p: Place): void {
  const s = p.scale
  const gy = ctx.world.height(p.x, p.z)
  const spots: Array<[number, number, number]> = [
    [-9, 2, 0.4],
    [-3, 7, -0.3],
    [5, 6, 0.6],
    [10, 0, -0.5],
    [-6, -7, 0.2],
  ]
  spots.forEach(([lx, lz, dy], i) => {
    const [x, z] = toWorld(p, lx, lz)
    hut(ctx, x, gy, z, p.yaw + dy, (3.2 + (i % 3) * 0.45) * s, 2.2 * s, i % 2 ? TONE.wall : '#81573d')
  })
  // Drying racks: two posts, a bar, three fish.
  for (const [lx, lz, dy] of [
    [3, -6, 0.3],
    [-11, -2, -0.6],
  ]) {
    const [x, z] = toWorld(p, lx, lz)
    const yaw = p.yaw + dy
    const ex = Math.cos(yaw) * 1.4 * s
    const ez = -Math.sin(yaw) * 1.4 * s
    post(ctx, x - ex, gy, z - ez, 0.09 * s, 2.2 * s, TONE.bark)
    post(ctx, x + ex, gy, z + ez, 0.09 * s, 2.2 * s, TONE.bark)
    box(ctx, x, gy + 2.1 * s, z, 3 * s, 0.1 * s, 0.1 * s, yaw, TONE.bark, false)
    for (let k = -1; k <= 1; k++) box(ctx, x + ex * k * 0.6, gy + 1.6 * s, z + ez * k * 0.6, 0.35 * s, 0.7 * s, 0.1 * s, yaw, TONE.sailGold, false)
  }
  // Dugout canoes drawn up on the bank, a dock out over the water.
  const river = channelPoint(p.x, p.z)
  const toRiver = Math.atan2(river.x - p.x, river.z - p.z)
  const bankD = Math.max(6, river.d - 9 * s)
  for (const side of [-1, 1]) {
    const bx = p.x + Math.sin(toRiver) * bankD + Math.cos(toRiver) * side * 5 * s
    const bz = p.z + Math.cos(toRiver) * bankD - Math.sin(toRiver) * side * 5 * s
    blob(ctx, bx, ctx.world.height(bx, bz) + 0.3 * s, bz, 2.4 * s, 0.35 * s, 0.65 * s, toRiver + side * 0.3, side > 0 ? TONE.coral : TONE.sailGold)
  }
  const dockLen = 9 * s
  const dx = p.x + Math.sin(toRiver) * (river.d - dockLen * 0.35)
  const dz = p.z + Math.cos(toRiver) * (river.d - dockLen * 0.35)
  const dockY = ctx.world.riverSurface(river.x, river.z) + 0.7 * s
  box(ctx, dx, dockY, dz, 1.6 * s, 0.18 * s, dockLen, toRiver, TONE.wood)
  for (const k of [-0.35, 0.3]) {
    post(ctx, dx + Math.sin(toRiver) * dockLen * k + Math.cos(toRiver) * 0.7 * s, dockY - 1.6 * s, dz + Math.cos(toRiver) * dockLen * k - Math.sin(toRiver) * 0.7 * s, 0.1 * s, 1.6 * s, TONE.bark)
    post(ctx, dx + Math.sin(toRiver) * dockLen * k - Math.cos(toRiver) * 0.7 * s, dockY - 1.6 * s, dz + Math.cos(toRiver) * dockLen * k + Math.sin(toRiver) * 0.7 * s, 0.1 * s, 1.6 * s, TONE.bark)
  }
  // Baskets and the cook fire with its light.
  for (const [lx, lz] of [
    [1, 1],
    [-2, 3],
    [7, -2],
  ]) {
    const [x, z] = toWorld(p, lx, lz)
    post(ctx, x, gy, z, 0.42 * s, 0.6 * s, TONE.woodDark)
  }
  const spec = placeLight(p)
  const [fx, fz] = toWorld(p, spec.dx, spec.dz)
  fire(ctx, fx, gy, fz, s)
  light(ctx, p, fx, gy + spec.height * s, fz, spec)
}

function buildShaman(ctx: Ctx, p: Place): void {
  const s = p.scale
  const pool = ctx.world.pools.find((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1)!
  const surface = pool.surface
  // The island: dark sides from the bed, a green top a little over the water.
  ctx.batch.tris(prism({ sides: 7, rx: 10 * s, rz: 9 * s, taper: 0.9, y0: surface - 2.4, y1: surface + 1.1, jitter: 0.12, rng: ctx.rng, open: true }), placeMatrix(p.x, 0, p.z, p.yaw), TONE.mud, true, ctx.haze)
  ctx.batch.tris(prism({ sides: 7, rx: 9.6 * s, rz: 8.6 * s, taper: 1, y0: surface + 1.0, y1: surface + 1.3, jitter: 0.1, rng: ctx.rng }), placeMatrix(p.x, 0, p.z, p.yaw), TONE.bank, true, ctx.haze)
  const top = surface + 1.3
  // Totems round the rim, carved heads on them.
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.4
    const x = p.x + Math.cos(a) * 7.4 * s
    const z = p.z + Math.sin(a) * 6.6 * s
    const h = (3.2 + (k % 3) * 0.8) * s
    post(ctx, x, top, z, 0.42 * s, h, k % 2 ? TONE.stoneDark : TONE.thatchDark)
    box(ctx, x, top + h + 0.45 * s, z, 1.0 * s, 0.9 * s, 0.9 * s, a, k % 3 === 0 ? TONE.terracotta : TONE.stone)
    if (k % 2 === 0) box(ctx, x, top + h + 1.1 * s, z, 1.4 * s, 0.2 * s, 0.3 * s, a, TONE.gold, false)
  }
  const [hx, hz] = toWorld(p, -4, -3)
  hut(ctx, hx, top, hz, p.yaw + 0.5, 3.6 * s, 1.0 * s, '#6d4a35')
  const [cx, cz] = toWorld(p, 5, 6)
  blob(ctx, cx, top + 0.3 * s, cz, 2.2 * s, 0.32 * s, 0.6 * s, p.yaw + 1.2, TONE.coral)
  // The pool's still water, the fire and its light at the centre.
  sheet(ctx, p.x, surface, p.z, pool.radius * 0.98, pool.radius * 0.98, 12, 0, ctx.night ? TONE.waterNight : TONE.water)
  const spec = placeLight(p)
  fire(ctx, p.x, top, p.z, s)
  light(ctx, p, p.x, top + spec.height * s, p.z, spec)
}

function buildLogging(ctx: Ctx, p: Place): void {
  const s = p.scale
  const gy = ctx.world.height(p.x, p.z)
  for (const [lx, lz, dy, size] of [
    [-10, -4, 0.4, 3.6],
    [8, -7, -0.4, 3.0],
  ]) {
    const [x, z] = toWorld(p, lx, lz)
    hut(ctx, x, gy, z, p.yaw + dy, size * s, 0.5 * s, TONE.wall)
  }
  // Log piles: six side by side and three on top, twice.
  for (const [lx, lz, dy] of [
    [-2, 4, 0.2],
    [9, 2, -0.9],
  ]) {
    const [x, z] = toWorld(p, lx, lz)
    const yaw = p.yaw + dy
    for (let k = -2.5; k <= 2.5; k++) log(ctx, x + Math.cos(yaw) * k * 0.9 * s, gy + 0.42 * s, z - Math.sin(yaw) * k * 0.9 * s, yaw, 0.42 * s, 5 * s, k % 2 ? TONE.bark : '#65442f')
    for (let k = -1; k <= 1; k++) log(ctx, x + Math.cos(yaw) * k * 0.9 * s, gy + 1.15 * s, z - Math.sin(yaw) * k * 0.9 * s, yaw, 0.42 * s, 4.6 * s, TONE.bark)
  }
  // Stumps, a sawing frame with a log across it.
  for (const [lx, lz] of [
    [-14, 6],
    [-12, 11],
    [-6, 12],
    [12, 9],
    [15, 4],
    [2, 13],
  ]) {
    const [x, z] = toWorld(p, lx, lz)
    post(ctx, x, gy, z, 0.55 * s, 0.7 * s, TONE.bark)
  }
  const [sx, sz] = toWorld(p, 3, -3)
  for (const side of [-1, 1]) {
    post(ctx, sx + Math.cos(p.yaw) * side * 1.6 * s, gy, sz - Math.sin(p.yaw) * side * 1.6 * s, 0.12 * s, 1.7 * s, TONE.wood, 0.35 * side, p.yaw)
    post(ctx, sx + Math.cos(p.yaw) * side * 1.6 * s, gy, sz - Math.sin(p.yaw) * side * 1.6 * s, 0.12 * s, 1.7 * s, TONE.wood, -0.35 * side, p.yaw)
  }
  log(ctx, sx, gy + 1.75 * s, sz, p.yaw + Math.PI / 2, 0.4 * s, 4.8 * s, '#65442f')
  // The raft of logs on the river, with a pole hut.
  const river = channelPoint(p.x, p.z)
  const ry = ctx.world.riverSurface(river.x, river.z) + 0.3 * s
  const yaw = Math.atan2(river.dir[0], river.dir[1])
  for (let k = -3.5; k <= 3.5; k++) {
    const x = river.x + Math.cos(yaw) * k * 0.86 * s
    const z = river.z - Math.sin(yaw) * k * 0.86 * s
    log(ctx, x, ry, z, yaw, 0.42 * s, 7 * s, k % 2 ? TONE.bark : '#65442f')
  }
  box(ctx, river.x, ry + 1.3 * s, river.z, 2.2 * s, 1.6 * s, 2.2 * s, yaw, TONE.wall)
  cone(ctx, river.x, ry + 2.6 * s, river.z, 1.9 * s, 1.0 * s, 4, yaw + Math.PI / 4, TONE.thatch)
  const spec = placeLight(p)
  const [fx, fz] = toWorld(p, spec.dx, spec.dz)
  fire(ctx, fx, gy, fz, s)
  light(ctx, p, fx, gy + spec.height * s, fz, spec)
}

function buildWeirs(ctx: Ctx, p: Place): void {
  const s = p.scale
  const gy = ctx.world.height(p.x, p.z)
  const river = channelPoint(p.x, p.z)
  const dir = river.dir
  const nrm: [number, number] = [-dir[1], dir[0]]
  const ry = ctx.world.riverSurface(river.x, river.z)
  // Two V-shaped weirs of stakes across the channel, their mouths upstream.
  for (const along of [-16, 10]) {
    for (let k = -5; k <= 5; k++) {
      const spread = Math.abs(k) * 1.5
      const x = river.x + dir[0] * (along + spread) + nrm[0] * k * 1.45
      const z = river.z + dir[1] * (along + spread) + nrm[1] * k * 1.45
      post(ctx, x, ry - 0.6, z, 0.16, 2.1 + (k % 2) * 0.3, TONE.wood, (k % 3) * 0.04)
    }
  }
  // The market: four stalls in accent cloth, baskets, a dock and the lantern post.
  const stalls: Array<[number, number, number, string]> = [
    [-9, -4, 0.3, TONE.coral],
    [-2, -8, -0.2, TONE.gold],
    [6, -6, 0.5, TONE.terracotta],
    [11, 0, -0.6, TONE.sailGold],
  ]
  for (const [lx, lz, dy, cloth] of stalls) {
    const [x, z] = toWorld(p, lx, lz)
    const yaw = p.yaw + dy
    box(ctx, x, gy + 1.05 * s, z, 3.4 * s, 2.1 * s, 2.4 * s, yaw, TONE.wall)
    cone(ctx, x, gy + 2.6 * s, z, 2.8 * s, 1.0 * s, 4, yaw + Math.PI / 4, cloth)
    box(ctx, x, gy + 0.95 * s, z + 0, 3.0 * s, 0.5 * s, 0.6 * s, yaw, TONE.woodDark, false)
  }
  for (const [lx, lz] of [
    [-5, 1],
    [2, 2],
    [4, -1],
    [-1, 5],
  ]) {
    const [x, z] = toWorld(p, lx, lz)
    post(ctx, x, gy, z, 0.45 * s, 0.6 * s, TONE.woodDark)
  }
  const toRiver = Math.atan2(river.x - p.x, river.z - p.z)
  const dockLen = 10 * s
  const dx = p.x + Math.sin(toRiver) * (river.d - dockLen * 0.3)
  const dz = p.z + Math.cos(toRiver) * (river.d - dockLen * 0.3)
  box(ctx, dx, ry + 0.8 * s, dz, 2.0 * s, 0.2 * s, dockLen, toRiver, TONE.wood)
  blob(ctx, dx + Math.cos(toRiver) * 2.4 * s, ry + 0.3, dz - Math.sin(toRiver) * 2.4 * s, 2.4 * s, 0.35 * s, 0.65 * s, toRiver, TONE.coral)
  const spec = placeLight(p)
  const [lx, lz] = toWorld(p, spec.dx, spec.dz)
  post(ctx, lx, gy, lz, 0.12 * s, spec.height * s - 0.4, TONE.bark)
  box(ctx, lx, gy + spec.height * s - 0.1, lz, 0.7 * s, 0.6 * s, 0.7 * s, p.yaw, TONE.woodDark, false)
  light(ctx, p, lx, gy + spec.height * s, lz, spec)
}

function buildZiggurat(ctx: Ctx, p: Place): void {
  const s = p.scale
  const gy = ctx.world.height(p.x, p.z)
  // Paving, then the main ziggurat in five tiers with a stair toward the land.
  box(ctx, p.x, gy + 0.15, p.z, 46 * s, 0.3, 38 * s, p.yaw, TONE.stoneDark, false)
  const tierH = 3.7 * s
  let width = 26 * s
  let y = gy - ROOT_DEPTH
  for (let t = 0; t < 5; t++) {
    const h = t === 0 ? tierH + ROOT_DEPTH : tierH
    box(ctx, p.x, y + h / 2, p.z, width, h, width * 0.86, p.yaw, t % 2 ? TONE.stoneDark : TONE.stone)
    y += h
    width *= 0.72
  }
  const [sx, sz] = toWorld(p, 0, 11)
  box(ctx, sx, gy + 2 * tierH, sz, 3.6 * s, 4 * tierH, 9 * s, p.yaw, TONE.stoneDark, true, -0.6)
  // The brazier platform and its light on top.
  box(ctx, p.x, y + 0.5 * s, p.z, 3 * s, 1 * s, 3 * s, p.yaw, TONE.rock)
  const spec = placeLight(p)
  light(ctx, p, p.x, gy + spec.height * s, p.z, spec)
  // Two small shrines, courtyard walls with gaps, rubble.
  for (const [lx, lz, dy] of [
    [-20, -8, 0.3],
    [19, -4, -0.4],
  ]) {
    const [x, z] = toWorld(p, lx, lz)
    box(ctx, x, gy + 1.6 * s, z, 9 * s, 3.2 * s, 8 * s, p.yaw + dy, TONE.stone)
    box(ctx, x, gy + 4.2 * s, z, 5 * s, 2.0 * s, 4.5 * s, p.yaw + dy, TONE.stoneDark)
  }
  const walls: Array<[number, number, number, number]> = [
    [-20, 15, 0, 12],
    [-4, 17, 0.1, 10],
    [14, 16, -0.1, 11],
    [23, 4, Math.PI / 2, 9],
    [-23, -1, Math.PI / 2, 10],
    [8, -17, 0, 9],
  ]
  for (const [lx, lz, dy, len] of walls) {
    const [x, z] = toWorld(p, lx, lz)
    box(ctx, x, gy + 1.1 * s, z, len * s, 2.2 * s, 1.0 * s, p.yaw + dy, TONE.stoneDark)
  }
  for (let k = 0; k < 7; k++) {
    const [x, z] = toWorld(p, -16 + k * 5.2, -14 + (k % 3) * 2)
    box(ctx, x, gy + 0.5 * s, z, 1.6 * s, 1.0 * s, 1.3 * s, k * 0.7, TONE.stone)
  }
  // Overgrowth: crowns on the tiers and the walls, two trees in the courtyard, vines down the risers.
  for (const [lx, lz, dy, r, color] of [
    [8, 3, tierH * 2 + 1, 4.2, TONE.canopyLight],
    [-7, -5, tierH * 3 + 1, 3.6, TONE.canopy],
    [-21, 15, 2.6 * s, 4.5, TONE.canopyDark],
  ] as Array<[number, number, number, number, string]>) {
    const [x, z] = toWorld(p, lx, lz)
    crown(ctx.batch, x, gy + dy, z, r * s, color, p.yaw + lx, ctx.haze)
  }
  for (const [lx, lz] of [
    [18, 11],
    [-12, 10],
  ]) {
    const [x, z] = toWorld(p, lx, lz)
    post(ctx, x, gy, z, 0.6 * s, 7 * s, TONE.bark)
    crown(ctx.batch, x, gy + 7.6 * s, z, 5.2 * s, TONE.canopy, p.yaw + lx, ctx.haze)
  }
  for (let k = 0; k < 5; k++) {
    const [x, z] = toWorld(p, -10 + k * 5, 10.6)
    box(ctx, x, gy + tierH * 1.5, z, 0.35 * s, tierH * 2.6, 0.35 * s, p.yaw, '#2f6a3a', false)
  }
}

function buildQuarry(ctx: Ctx, p: Place): void {
  const s = p.scale
  const gy = ctx.world.height(p.x, p.z)
  // Three stepped benches of cut stone rising at the back (local −z), dark rock below the cuts.
  for (let t = 0; t < 3; t++) {
    const [x, z] = toWorld(p, 0, -10 - t * 7)
    const h = (t + 1) * 4.2 * s
    ctx.batch.tris(prism({ sides: 7, rx: (26 - t * 3) * s, rz: 7 * s, taper: 0.92, y0: -ROOT_DEPTH, y1: h, jitter: 0.1, rng: ctx.rng, open: true }), placeMatrix(x, gy, z, p.yaw), TONE.rock, true, ctx.haze)
    ctx.batch.tris(prism({ sides: 7, rx: (26 - t * 3) * s * 0.92, rz: 7 * s * 0.92, taper: 1, y0: h - 0.3, y1: h + 0.5, jitter: 0.08, rng: ctx.rng }), placeMatrix(x, gy, z, p.yaw), TONE.stoneCut, true, ctx.haze)
  }
  // Cut blocks stacked in rows on the floor, a sled, a ramp.
  for (let k = 0; k < 12; k++) {
    const [x, z] = toWorld(p, -14 + (k % 6) * 5, 6 + Math.floor(k / 6) * 5)
    box(ctx, x, gy + 0.8 * s, z, 2.4 * s, 1.6 * s, 1.7 * s, p.yaw + (k % 3) * 0.12, k % 4 === 0 ? TONE.stoneDark : TONE.stoneCut)
    if (k % 3 === 0) box(ctx, x, gy + 2.3 * s, z, 2.0 * s, 1.3 * s, 1.5 * s, p.yaw + 0.3, TONE.stoneCut)
  }
  const [rx, rz] = toWorld(p, 20, -2)
  box(ctx, rx, gy + 2.2 * s, rz, 4 * s, 0.5 * s, 14 * s, p.yaw, TONE.woodDark, true, 0.3)
  // The A-frame crane: two leaning posts, a beam, a rope and a hanging block, with the lamp on top.
  const spec = placeLight(p)
  const [cx, cz] = toWorld(p, spec.dx, spec.dz)
  const top = spec.height * s - 1
  for (const side of [-1, 1]) post(ctx, cx + Math.cos(p.yaw) * side * 2.6 * s, gy, cz - Math.sin(p.yaw) * side * 2.6 * s, 0.22 * s, top, TONE.wood, side * 0.24, p.yaw)
  box(ctx, cx, gy + top, cz, 1.2 * s, 0.4 * s, 9 * s, p.yaw, TONE.wood)
  const [bx, bz] = toWorld(p, spec.dx, spec.dz + 3.5)
  box(ctx, bx, gy + top * 0.62, bz, 0.12 * s, top * 0.7, 0.12 * s, p.yaw, TONE.thatchDark, false)
  box(ctx, bx, gy + top * 0.25, bz, 2.0 * s, 1.4 * s, 1.5 * s, p.yaw + 0.2, TONE.stoneCut)
  light(ctx, p, cx, gy + spec.height * s, cz, spec)
  // Two sheds.
  for (const [lx, lz, dy] of [
    [-20, 12, 0.4],
    [-24, 2, -0.3],
  ]) {
    const [x, z] = toWorld(p, lx, lz)
    hut(ctx, x, gy, z, p.yaw + dy, 3.2 * s, 0.3 * s, TONE.wall)
  }
}

function buildTerraces(ctx: Ctx, p: Place): void {
  const s = p.scale
  // Seven steps down the slope (local +z is downhill), each a mud slab carrying a sky-coloured paddy.
  let previous = Number.POSITIVE_INFINITY
  for (let k = 0; k < 7; k++) {
    const [x, z] = toWorld(p, 0, -24 + k * 8)
    let top = ctx.world.height(x, z) + 0.4
    if (top > previous - 0.8) top = previous - 0.8
    previous = top
    const yaw = p.yaw + Math.sin(k * 1.7) * 0.12
    ctx.batch.tris(prism({ sides: 6, rx: (20 - Math.abs(k - 3) * 1.2) * s, rz: 4.6 * s, taper: 1, y0: -4, y1: 0, jitter: 0.05, rng: ctx.rng }), placeMatrix(x, top, z, yaw), TONE.mud, true, ctx.haze)
    sheet(ctx, x, top + 0.1, z, (18 - Math.abs(k - 3) * 1.2) * s, 3.6 * s, 6, yaw, ctx.night ? TONE.paddyNight : TONE.paddy)
    // Seedling rows: a few low green bars on every other paddy.
    if (k % 2 === 0) for (let r = -1; r <= 1; r++) box(ctx, x + Math.cos(yaw) * r * 5 * s, top + 0.25, z - Math.sin(yaw) * r * 5 * s, 0.6 * s, 0.3, 5.6 * s, yaw, TONE.canopyLight, false)
  }
  // The farmer's hut at the top with the light, a tree on either side.
  const spec = placeLight(p)
  const [hx, hz] = toWorld(p, spec.dx, spec.dz)
  const hy = ctx.world.height(hx, hz)
  hut(ctx, hx, hy, hz, p.yaw + 0.2, 3.8 * s, 1.0 * s, TONE.wall)
  light(ctx, p, hx + Math.sin(p.yaw) * 2.4 * s, hy + spec.height * s, hz + Math.cos(p.yaw) * 2.4 * s, spec)
  for (const lx of [-24, 24]) {
    const [x, z] = toWorld(p, lx, -26)
    const y = ctx.world.height(x, z)
    post(ctx, x, y, z, 0.5 * s, 8 * s, TONE.bark)
    crown(ctx.batch, x, y + 8.6 * s, z, 5 * s, TONE.canopy, p.yaw + lx, ctx.haze)
  }
}

function buildWalkway(ctx: Ctx, p: Place): void {
  const s = p.scale
  const gy = ctx.world.height(p.x, p.z)
  const trees: Array<[number, number]> = [
    [-16, -12],
    [14, -16],
    [18, 12],
    [-12, 16],
  ]
  const platformH = 22 * s
  const platforms: Array<[number, number, number]> = []
  trees.forEach(([lx, lz], i) => {
    const [x, z] = toWorld(p, lx, lz)
    const h = (30 + (i % 2) * 4) * s
    ctx.batch.tris(prism({ sides: 7, rx: 2.4 * s, rz: 2.4 * s, taper: 0.6, y0: -ROOT_DEPTH, y1: h, jitter: 0.12, rng: ctx.rng }), placeMatrix(x, gy, z, i), i % 2 ? TONE.bark : '#65442f', true, ctx.haze)
    for (let f = 0; f < 4; f++) {
      const a = (f / 4) * Math.PI * 2 + i
      ctx.batch.tris(prism({ sides: 4, rx: 3.6 * s, rz: 0.7 * s, taper: 0.2, y0: -ROOT_DEPTH, y1: 5 * s, jitter: 0.1, rng: ctx.rng, lean: [-2.4 * s, 0] }), placeMatrix(x + Math.cos(a) * 3.4 * s, gy, z + Math.sin(a) * 3.4 * s, -a), '#65442f', true, ctx.haze)
    }
    crown(ctx.batch, x, gy + h + 1.2 * s, z, 9 * s, TONE.canopy, i, ctx.haze)
    crown(ctx.batch, x - 5 * s, gy + h - 1.5 * s, z + 2 * s, 6.5 * s, TONE.canopyLight, i + 0.7, ctx.haze)
    crown(ctx.batch, x + 5.5 * s, gy + h - 0.5 * s, z - 2 * s, 6.8 * s, TONE.canopyDark, i - 0.5, ctx.haze)
    // The platform ring round the trunk.
    ctx.batch.tris(prism({ sides: 7, rx: 5 * s, rz: 5 * s, taper: 1, y0: -0.4 * s, y1: 0, jitter: 0.05, rng: ctx.rng }), placeMatrix(x, gy + platformH, z, i), TONE.wood, true, ctx.haze)
    for (let r = 0; r < 7; r++) {
      const a = (r / 7) * Math.PI * 2
      box(ctx, x + Math.cos(a) * 4.7 * s, gy + platformH + 0.6 * s, z + Math.sin(a) * 4.7 * s, 0.14 * s, 1.2 * s, 0.14 * s, 0, TONE.bark, false)
    }
    platforms.push([x, gy + platformH, z])
  })
  // Rope bridges between consecutive platforms, planks sagging a metre.
  for (let i = 0; i < platforms.length; i++) {
    const a = platforms[i]
    const b = platforms[(i + 1) % platforms.length]
    const dx = b[0] - a[0]
    const dz = b[2] - a[2]
    const len = Math.hypot(dx, dz) - 9.4 * s
    const yaw = Math.atan2(dx, dz)
    const planks = 9
    for (let k = 0; k < planks; k++) {
      const t = (k + 0.5) / planks
      const x = a[0] + dx * (0.5 + (t - 0.5) * (len / Math.hypot(dx, dz)))
      const z = a[2] + dz * (0.5 + (t - 0.5) * (len / Math.hypot(dx, dz)))
      const y = a[1] + Math.sin(t * Math.PI) * -1.0 * s
      box(ctx, x, y, z, 1.6 * s, 0.14 * s, len / planks + 0.05, yaw, k % 2 ? TONE.wood : TONE.woodDark, false)
    }
    for (const side of [-1, 1]) {
      box(ctx, (a[0] + b[0]) / 2 + Math.cos(yaw) * side * 0.9 * s, a[1] + 0.9 * s, (a[2] + b[2]) / 2 - Math.sin(yaw) * side * 0.9 * s, 0.08 * s, 0.08 * s, len, yaw, TONE.thatchDark, false)
    }
  }
  // A hut on the first platform, ladders down its trunk, the lantern.
  const [hx, hy, hz] = platforms[0]
  hut(ctx, hx + 2.4 * s, hy, hz + 1.2 * s, 0.6, 3.0 * s, 0.3 * s, '#6d4a35')
  box(ctx, hx + 2.6 * s, gy + platformH / 2, hz + 1.5 * s, 0.9 * s, platformH, 0.1 * s, 0, TONE.bark, false)
  const spec = placeLight(p)
  light(ctx, p, hx - 3.2 * s, hy + 2.4 * s, hz - 2 * s, spec)
}

function buildPoolShrine(ctx: Ctx, p: Place): void {
  const s = p.scale
  const pool = ctx.world.pools.find((q) => Math.hypot(q.x - p.x, q.z - p.z) < 30)!
  const [bx, bz] = toWorld(p, 0, -6)
  const by = ctx.world.height(bx, bz)
  // The bluff, its fall sheet, the pool and a rim of boulders.
  ctx.batch.tris(prism({ sides: 8, rx: 14 * s, rz: 8 * s, taper: 0.78, y0: -ROOT_DEPTH, y1: 18 * s, jitter: 0.14, rng: ctx.rng, open: true }), placeMatrix(bx, by, bz, p.yaw), TONE.rock, true, ctx.haze)
  ctx.batch.tris(prism({ sides: 8, rx: 11 * s, rz: 6.2 * s, taper: 0.9, y0: 17.6 * s, y1: 19 * s, jitter: 0.08, rng: ctx.rng }), placeMatrix(bx, by, bz, p.yaw), TONE.moss, true, ctx.haze)
  crown(ctx.batch, bx - 3 * s, by + 20 * s, bz, 5 * s, TONE.canopy, p.yaw, ctx.haze)
  const [fx, fz] = toWorld(p, 1, 0.6)
  box(ctx, fx, pool.surface + 8.6 * s, fz, 3.2 * s, 17 * s, 0.5, p.yaw, TONE.fall, false)
  sheet(ctx, pool.x, pool.surface, pool.z, pool.radius * 0.96, pool.radius * 0.96, 12, 0, ctx.night ? TONE.waterNight : TONE.water)
  blob(ctx, fx, pool.surface + 0.9 * s, fz + 1, 3.4 * s, 1.0 * s, 1.6 * s, p.yaw, TONE.fall, false)
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + 0.3
    const r = pool.radius + 1.2
    const x = pool.x + Math.cos(a) * r
    const z = pool.z + Math.sin(a) * r
    blob(ctx, x, ctx.world.height(x, z) + 0.5 * s, z, 1.4 * s, 0.8 * s, 1.1 * s, a, k % 2 ? TONE.rock : '#71895c')
  }
  // The shrine: a stone lantern (the light) and a red gate at the pool's lip.
  const spec = placeLight(p)
  const [lx, lz] = toWorld(p, spec.dx, spec.dz)
  const ly = ctx.world.height(lx, lz)
  box(ctx, lx, ly + 0.9 * s, lz, 0.6 * s, 1.8 * s, 0.6 * s, p.yaw, TONE.stone, false)
  box(ctx, lx, ly + 2.4 * s, lz, 1.3 * s, 0.9 * s, 1.3 * s, p.yaw, TONE.stoneDark)
  cone(ctx, lx, ly + 3.2 * s, lz, 1.1 * s, 0.7 * s, 4, p.yaw + Math.PI / 4, TONE.stone)
  light(ctx, p, lx, ly + spec.height * s, lz, spec)
  const [gx, gz] = toWorld(p, 6, 26)
  const gyy = ctx.world.height(gx, gz)
  for (const side of [-1, 1]) post(ctx, gx + Math.cos(p.yaw) * side * 1.8 * s, gyy, gz - Math.sin(p.yaw) * side * 1.8 * s, 0.18 * s, 3.6 * s, TONE.terracotta)
  box(ctx, gx, gyy + 3.7 * s, gz, 4.6 * s, 0.4 * s, 0.4 * s, p.yaw, TONE.terracotta, false)
  box(ctx, gx, gyy + 3.0 * s, gz, 3.4 * s, 0.25 * s, 0.3 * s, p.yaw, TONE.terracotta, false)
  const [sx, sz] = toWorld(p, 9, 18)
  hut(ctx, sx, ctx.world.height(sx, sz), sz, p.yaw + 0.4, 2.8 * s, 0.4 * s, TONE.thatchDark)
}

function buildParrot(ctx: Ctx, p: Place): void {
  const s = p.scale
  const gy = ctx.world.height(p.x, p.z)
  const h = 20 * s
  ctx.batch.tris(prism({ sides: 7, rx: 2.2 * s, rz: 2.2 * s, taper: 0.55, y0: -ROOT_DEPTH, y1: h, jitter: 0.12, rng: ctx.rng }), placeMatrix(p.x, gy, p.z, p.yaw), TONE.bark, true, ctx.haze)
  for (let f = 0; f < 5; f++) {
    const a = (f / 5) * Math.PI * 2 + 0.3
    ctx.batch.tris(prism({ sides: 4, rx: 3.2 * s, rz: 0.6 * s, taper: 0.2, y0: -ROOT_DEPTH, y1: 4 * s, jitter: 0.1, rng: ctx.rng, lean: [-2 * s, 0] }), placeMatrix(p.x + Math.cos(a) * 3 * s, gy, p.z + Math.sin(a) * 3 * s, -a), '#65442f', true, ctx.haze)
  }
  const crowns: Array<[number, number, number, number, string]> = [
    [0, 1.5, 0, 9.5, TONE.canopy],
    [-6, -1.5, 2, 6.5, TONE.canopyLight],
    [6, -0.5, -3, 6.8, TONE.canopyDark],
  ]
  for (const [dx, dy, dz, r, color] of crowns) crown(ctx.batch, p.x + dx * s, gy + h + dy * s, p.z + dz * s, r * s, color, p.yaw + dx, ctx.haze)
  // Parrots perched over the crowns: colour dots.
  for (let k = 0; k < 44; k++) {
    const [dx, dy, dz, r] = crowns[k % 3]
    const a = ctx.rng() * Math.PI * 2
    const rr = Math.sqrt(ctx.rng()) * r * s * 0.9
    ctx.parrots.push({
      x: p.x + dx * s + Math.cos(a) * rr,
      y: gy + h + dy * s + r * s * 0.36 * Math.sqrt(Math.max(0, 1 - (rr / (r * s)) ** 2)) + 0.4 * s,
      z: p.z + dz * s + Math.sin(a) * rr * 0.86,
      yaw: a,
      sx: 0.42 * s,
      sy: 0.42 * s,
      sz: 0.42 * s,
      color: PARROTS[k % PARROTS.length],
    })
  }
  // The keeper's feeding platform on the trunk and the lantern post.
  box(ctx, p.x + Math.sin(p.yaw) * 2.6 * s, gy + 6 * s, p.z + Math.cos(p.yaw) * 2.6 * s, 2.6 * s, 0.2 * s, 1.6 * s, p.yaw, TONE.wood)
  const spec = placeLight(p)
  const [lx, lz] = toWorld(p, spec.dx, spec.dz)
  post(ctx, lx, gy, lz, 0.12 * s, spec.height * s - 0.3, TONE.bark)
  box(ctx, lx, gy + spec.height * s - 0.1, lz, 0.6 * s, 0.5 * s, 0.6 * s, p.yaw, TONE.woodDark, false)
  light(ctx, p, lx, gy + spec.height * s, lz, spec)
}

/* ---------- paths ---------- */

function buildPaths(world: OuterWorld, night: boolean): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const c = _c
  _m.set(mistColour(night))
  for (const path of world.places.paths) {
    const pts = path.points
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1]
      const [bx, bz] = pts[i]
      const dx = bx - ax
      const dz = bz - az
      const len = Math.hypot(dx, dz) || 1
      const r = Math.hypot((ax + bx) / 2, (az + bz) / 2)
      const half = 1.6 * (1 + r / 900)
      const nx = (-dz / len) * half
      const nz = (dx / len) * half
      const ay = world.height(ax, az) + 0.18
      const by = world.height(bx, bz) + 0.18
      // Two triangles per segment, slightly overlapping the next so joints never gap.
      const quad = [ax + nx, ay, az + nz, ax - nx, ay, az - nz, bx + nx, by, bz + nz, bx - nx, by, bz - nz]
      positions.push(quad[0], quad[1], quad[2], quad[6], quad[7], quad[8], quad[3], quad[4], quad[5])
      positions.push(quad[3], quad[4], quad[5], quad[6], quad[7], quad[8], quad[9], quad[10], quad[11])
      c.set(TONE.path)
      if (night) c.offsetHSL(0.02, -0.1, -0.22)
      c.lerp(_m, world.hazeAt((ax + bx) / 2, (az + bz) / 2) * 0.8)
      for (let k = 0; k < 6; k++) colors.push(c.r, c.g, c.b)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/* ---------- canoes ---------- */

function canoeTrack(world: OuterWorld, points: ReadonlyArray<readonly [number, number]>): CanoeTrack {
  // Resample so the canoe follows the water between the authored points.
  const dense: number[] = []
  const arclength: number[] = []
  let total = 0
  let px = 0
  let pz = 0
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i]
    const steps = i === 0 ? 1 : 6
    for (let k = i === 0 ? 1 : 1; k <= steps; k++) {
      const t = k / steps
      const sx = i === 0 ? x : points[i - 1][0] + (x - points[i - 1][0]) * t
      const sz = i === 0 ? z : points[i - 1][1] + (z - points[i - 1][1]) * t
      if (dense.length) total += Math.hypot(sx - px, sz - pz)
      dense.push(sx, world.riverSurface(sx, sz) + 0.22, sz)
      arclength.push(total)
      px = sx
      pz = sz
    }
  }
  return { points: new Float32Array(dense), arclength: new Float32Array(arclength), total }
}

/* ---------- the build ---------- */

export function buildPlaces(world: OuterWorld, night: boolean): PlacesBuild {
  const batch = new Batch(night)
  const water = new Batch(night)
  const rng = seeded(world.seed * 59 + 13)
  const ctx: Ctx = { batch, water, world, night, haze: 0, rng, huts: [], posts: [], logs: [], parrots: [], lights: [], fires: [] }
  for (const p of world.places.places) {
    ctx.haze = world.hazeAt(p.x, p.z) * 0.85
    switch (p.kind) {
      case 'hamlet':
        buildHamlet(ctx, p)
        break
      case 'shaman':
        buildShaman(ctx, p)
        break
      case 'logging':
        buildLogging(ctx, p)
        break
      case 'weirs':
        buildWeirs(ctx, p)
        break
      case 'ziggurat':
        buildZiggurat(ctx, p)
        break
      case 'quarry':
        buildQuarry(ctx, p)
        break
      case 'terraces':
        buildTerraces(ctx, p)
        break
      case 'walkway':
        buildWalkway(ctx, p)
        break
      case 'poolshrine':
        buildPoolShrine(ctx, p)
        break
      default:
        buildParrot(ctx, p)
    }
  }
  const statics = batch.build()
  const waterGeo = water.build()
  const paths = buildPaths(world, night)
  const canoes = world.places.canoeTracks.map((track) => canoeTrack(world, track))
  const staticTriangles = batch.triangles + water.triangles + paths.getAttribute('position').count / 3
  return { statics, paths, water: waterGeo, huts: ctx.huts, posts: ctx.posts, logs: ctx.logs, parrots: ctx.parrots, lights: ctx.lights, fires: ctx.fires, canoes, staticTriangles }
}

/* ---------- instance geometry ---------- */

/** A stilt hut at unit size: four posts (0..stilt), deck, walls, pyramid roof; `tilt` carries the stilt height. */
export function hutGeometry(night: boolean): THREE.BufferGeometry {
  const b = new Batch(night)
  const stilt = 0.55
  for (const [x, z] of [
    [-0.4, -0.38],
    [0.4, -0.38],
    [-0.4, 0.38],
    [0.4, 0.38],
  ]) {
    const post = new THREE.BoxGeometry(0.08, stilt + 0.1, 0.08)
    b.geo(post, placeMatrix(x, stilt / 2, z), TONE.bark, false)
    post.dispose()
  }
  const deck = new THREE.BoxGeometry(1.25, 0.08, 1.1)
  b.geo(deck, placeMatrix(0, stilt + 0.04, 0), TONE.wood)
  deck.dispose()
  const walls = new THREE.BoxGeometry(0.95, 0.62, 0.85)
  b.geo(walls, placeMatrix(0, stilt + 0.08 + 0.31, 0), '#ffffff')
  walls.dispose()
  const roof = new THREE.ConeGeometry(0.92, 0.5, 4)
  b.geo(roof, placeMatrix(0, stilt + 0.08 + 0.62 + 0.25, 0, Math.PI / 4), TONE.thatch)
  roof.dispose()
  const door = new THREE.BoxGeometry(0.22, 0.34, 0.04)
  b.geo(door, placeMatrix(0, stilt + 0.08 + 0.2, 0.44), TONE.thatchDark, false)
  door.dispose()
  return b.build()
}

/** Unit post: a six-sided cylinder from y = 0 to 1. */
export function postGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.8, 1, 1, 6)
  geo.translate(0, 0.5, 0)
  return geo
}

/** Unit log lying along local z (radius 1, length 1). */
export function logGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 6)
  geo.rotateX(Math.PI / 2)
  return geo
}

export function parrotGeometry(): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(1, 0)
}

export function lampGeometry(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, 7, 5)
}

export function puffGeometry(): THREE.BufferGeometry {
  return new THREE.DodecahedronGeometry(1, 0)
}

/** Unit dugout canoe pointing along local z. */
export function canoeGeometry(night: boolean): THREE.BufferGeometry {
  const b = new Batch(night)
  const hull = new THREE.DodecahedronGeometry(1, 0)
  b.geo(hull, placeMatrix(0, 0, 0, 0, 0, 0, 0.75, 0.35, 2.6), TONE.coral)
  b.geo(hull, placeMatrix(0, 0.22, 0, 0, 0, 0, 0.48, 0.18, 2.05), TONE.bark)
  hull.dispose()
  const paddler = new THREE.DodecahedronGeometry(0.42, 0)
  b.geo(paddler, placeMatrix(0, 0.72, -0.3), '#f5ddb5')
  paddler.dispose()
  return b.build()
}

/** Triangle count of an instanced layer. */
export function instancedTriangles(geometry: THREE.BufferGeometry, count: number): number {
  const index = geometry.index
  return (index ? index.count / 3 : geometry.getAttribute('position').count / 3) * count
}

