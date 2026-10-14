/**
 * Hand-built landmarks of the highlands (toybox low-poly: chunky facets, 2–3 flat colours plus
 * one accent, one exaggerated feature each). Every builder returns one merged geometry, the
 * place's single light, and the parts that move (smoke, steam, wheel, banner) for the scene's
 * one frame loop. Local frame: +z faces the landmark's yaw, y = 0 is the slab top.
 */
import * as THREE from 'three'
import { NORDIC_PALETTE as P } from '../../layout/biome-layout'
import { type Band, type LandmarkSpec } from '../../layout/landmarks'
import { PropBatch } from '../props-batch'

export const LAND_COLOURS = {
  timber: '#4a3c36',
  timberLight: '#6b5a4a',
  tarred: '#2b2522',
  plank: '#8b6a4a',
  plankPale: '#a98b63',
  stone: '#6c6f6a',
  stoneDark: '#4f5350',
  basalt: P.basalt,
  cliff: P.cliff,
  turf: P.turf,
  turfLight: '#6c8458',
  moss: '#74835f',
  cream: P.cream,
  red: P.red,
  ochre: P.ochre,
  iron: '#3a3d42',
  water: P.water,
  ice: '#dbe6e8',
  iceBlue: '#9fbcc8',
  sinter: '#cfc8ab',
  aqua: P.geothermal,
  fire: '#ffad42',
  ember: '#d95336',
  window: P.window,
  wool: '#d8d5c8',
  fish: '#d9c9a8',
  sail: '#e3d7bd',
} as const

export interface Light {
  at: [number, number, number]
  colour: string
  /** Day emissive strength (fires glow a little by day; windows not at all). */
  day: number
  night: number
  radius: number
  /** Flat disc (pool glow, cave mouth) instead of a sphere. */
  disc?: number
}

export interface Smoke {
  at: [number, number, number]
  /** Puff scale multiplier. */
  size: number
  /** Steam (white, slow) or smoke (grey). */
  steam: boolean
}

export interface Banner {
  at: [number, number, number]
  /** Banner height (pole top at `at`). */
  height: number
  colour: string
  yaw: number
}

export interface LandmarkBuild {
  geometry: THREE.BufferGeometry
  light: Light | null
  smoke: Smoke[]
  banners: Banner[]
  /** Mill wheel: world position, yaw and radius for the spinning torus. */
  wheel?: { at: [number, number, number]; yaw: number; radius: number }
}

const C = LAND_COLOURS

function toWorld(spec: LandmarkSpec, lx: number, ly: number, lz: number): [number, number, number] {
  const cs = Math.cos(spec.yaw)
  const sn = Math.sin(spec.yaw)
  return [spec.x + lx * cs + lz * sn, ly, spec.z - lx * sn + lz * cs]
}

/** A turf-roofed house in the batch (walls, footing, roof, door, chimney). */
function house(b: PropBatch, x: number, z: number, yaw: number, w: number, d: number, h: number, wall: string, roof: string, chimney = true): void {
  b.box(w + 0.5, 0.5, d + 0.5, C.stoneDark, { at: [x, 0.25, z], rot: [0, yaw, 0] })
  b.box(w, h, d, wall, { at: [x, 0.5 + h / 2, z], rot: [0, yaw, 0] })
  b.roof(w, d, 1.6, 0.4, roof, { at: [x, 0.5 + h, z], rot: [0, yaw, 0] })
  b.box(1.1, 1.8, 0.2, C.tarred, { at: [x + Math.sin(yaw) * (d / 2 + 0.05), 1.4, z + Math.cos(yaw) * (d / 2 + 0.05)], rot: [0, yaw, 0] })
  if (chimney) b.box(0.7, 1.8, 0.7, C.stone, { at: [x - Math.cos(yaw) * w * 0.3, 0.5 + h + 1.4, z + Math.sin(yaw) * w * 0.3] })
}

function sheep(b: PropBatch, x: number, z: number, yaw: number): void {
  b.rock(C.wool, { at: [x, 0.55, z], rot: [0, yaw, 0], scale: [0.95, 0.65, 0.65] })
  b.rock('#3e4040', { at: [x + Math.cos(yaw) * 0.8, 0.75, z - Math.sin(yaw) * 0.8], scale: 0.3 })
}

/* ---------- builders ---------- */

function beacon(spec: LandmarkSpec): LandmarkBuild {
  const b = new PropBatch(spec.x, 0, spec.z, spec.yaw)
  b.rock(C.basalt, { at: [0, 0.6, 0], scale: [3.4, 1.1, 3] })
  b.rock(C.cliff, { at: [2.2, 0.4, -1.6], rot: [0, 0.8, 0], scale: [1.4, 0.8, 1.2] })
  // Four tapering legs and three brace rings: a 9 m timber tower.
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    b.beam([sx * 1.9, 1.2, sz * 1.9], [sx * 0.9, 9.6, sz * 0.9], 0.22, C.timber)
  }
  for (const y of [3.4, 6.2]) {
    const r = 1.9 - ((y - 1.2) / 8.4) * 1.0
    b.beam([-r, y, -r], [r, y, -r], 0.12, C.timberLight)
    b.beam([r, y, -r], [r, y, r], 0.12, C.timberLight)
    b.beam([r, y, r], [-r, y, r], 0.12, C.timberLight)
    b.beam([-r, y, r], [-r, y, -r], 0.12, C.timberLight)
  }
  b.box(2.6, 0.3, 2.6, C.plank, { at: [0, 9.7, 0] })
  for (const [sx, sz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) b.beam([sx * 1.2, 9.8, sz * 1.2], [sx * 1.2, 10.9, sz * 1.2], 0.08, C.timberLight)
  // THE brazier: an iron bowl as wide as the platform, fire piled above it.
  b.cyl(1.7, 1.1, 1.3, 8, C.iron, { at: [0, 10.6, 0] })
  b.torus(1.7, 0.18, 6, 10, C.iron, { at: [0, 11.25, 0], rot: [Math.PI / 2, 0, 0] })
  b.beam([0, 0.9, 2.9], [0, 2.8, 1.6], 0.14, C.plank)
  b.box(0.7, 0.12, 1.4, C.plank, { at: [0, 1.0, 2.6] })
  return { geometry: b.build(), light: { at: toWorld(spec, 0, 11.9, 0), colour: C.fire, day: 0.9, night: 2.4, radius: 1.1 }, smoke: [{ at: toWorld(spec, 0, 12.6, 0), size: 0.6, steam: false }], banners: [] }
}

function stoneCircle(spec: LandmarkSpec): LandmarkBuild {
  const b = new PropBatch(spec.x, 0, spec.z, spec.yaw)
  b.cyl(9.5, 9.5, 0.12, 14, '#5f6d52', { at: [0, 0.06, 0] })
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2
    const giant = i === 2
    const h = giant ? 7.2 : 2.6 + ((i * 7) % 4) * 0.35
    b.cyl(giant ? 0.75 : 0.5, giant ? 1.2 : 0.9, h, 5, i % 2 ? C.stone : C.stoneDark, { at: [Math.cos(a) * 7.5, h / 2, Math.sin(a) * 7.5], rot: [((i % 3) - 1) * 0.06, a, ((i % 2) - 0.5) * 0.08] })
  }
  b.box(3.4, 0.7, 2.2, C.basalt, { at: [0, 0.45, 0], rot: [0, 0.4, 0] })
  b.box(2.6, 0.25, 1.6, C.stone, { at: [0, 0.92, 0], rot: [0, 0.4, 0] })
  return { geometry: b.build(), light: null, smoke: [], banners: [] }
}

function trollRock(spec: LandmarkSpec): LandmarkBuild {
  const b = new PropBatch(spec.x, 0, spec.z, spec.yaw)
  b.rock(C.cliff, { at: [0, 3.6, 0], rot: [0.1, 0.3, 0], scale: [5.2, 4.4, 4.6] })
  b.rock(C.basalt, { at: [0.6, 8.2, 1.2], rot: [0.25, -0.2, 0.1], scale: [3.2, 2.9, 3] })
  // THE nose: a cone as long as the head, pointing the way the troll was caught by the sun.
  b.cone(1.1, 4.6, 6, C.basalt, { at: [0.8, 7.6, 4.6], rot: [Math.PI / 2, 0, 0] })
  b.rock(C.stoneDark, { at: [-2.4, 9.6, 0.6], scale: [1.3, 0.5, 1.1] })
  b.rock(C.stoneDark, { at: [3.2, 9.4, 0.4], scale: [1.1, 0.5, 1.0] })
  b.rock(C.cliff, { at: [-4.6, 2.2, 2.6], rot: [0.3, 0.5, 0.4], scale: [2.2, 1.6, 1.8] })
  b.rock(C.cliff, { at: [4.5, 1.9, 3], rot: [0.2, -0.6, -0.3], scale: [2.4, 1.5, 1.7] })
  b.rock(C.moss, { at: [-1.2, 7.1, -2.2], scale: [2.4, 0.5, 1.8] })
  b.rock(C.moss, { at: [1.8, 5.2, -3.4], scale: [1.6, 0.4, 1.3] })
  b.rock(C.stone, { at: [2.6, 0.5, -3.6], scale: [1.1, 0.6, 0.9] })
  return { geometry: b.build(), light: null, smoke: [], banners: [] }
}

function runeStone(spec: LandmarkSpec): LandmarkBuild {
  const b = new PropBatch(spec.x, 0, spec.z, spec.yaw)
  b.rock(C.turfLight, { at: [0, 0.2, 0], scale: [5.2, 1.5, 4.6] })
  b.cyl(0.9, 1.5, 4.6, 5, C.stoneDark, { at: [0, 3.4, 0], rot: [0.06, 0.3, 0.04] })
  // THE serpent band: a red ring and tail coiled round the face of the stone.
  b.torus(0.95, 0.12, 5, 12, C.red, { at: [0, 3.9, 0.95], rot: [0, 0, 0] })
  b.box(0.16, 1.6, 0.14, C.red, { at: [0.5, 2.3, 1.05], rot: [0, 0, 0.3] })
  b.box(0.16, 1.2, 0.14, C.red, { at: [-0.45, 2.1, 1.05], rot: [0, 0, -0.35] })
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26 + 0.4
    b.rock(C.stone, { at: [Math.cos(a) * 3.2, 1.1, Math.sin(a) * 3.0], rot: [0, a, 0], scale: [0.5, 0.4, 0.45] })
  }
  return { geometry: b.build(), light: null, smoke: [], banners: [] }
}

function lavaCave(spec: LandmarkSpec): LandmarkBuild {
  const b = new PropBatch(spec.x, 0, spec.z, spec.yaw)
  // A tumble of basalt forming an arch over the mouth; scree apron in front.
  b.rock(C.cliff, { at: [-4.2, 2.4, -2.5], rot: [0.2, 0.4, 0.1], scale: [3.6, 2.8, 3.4] })
  b.rock(C.cliff, { at: [4.0, 2.2, -2.8], rot: [-0.1, -0.5, 0.2], scale: [3.4, 2.6, 3.2] })
  b.rock(C.basalt, { at: [0, 4.6, -3.6], rot: [0.1, 0.2, 0], scale: [5.2, 1.8, 3] })
  b.rock(C.basalt, { at: [-1.5, 1.4, -6.2], rot: [0, 0.8, 0], scale: [3.5, 2, 3] })
  b.rock(C.cliff, { at: [2.4, 1.0, -6.8], rot: [0, 1.3, 0], scale: [2.6, 1.6, 2.4] })
  b.rock(C.cliff, { at: [-6.4, 1.1, 2.6], rot: [0.3, 0.9, 0], scale: [2.4, 1.4, 2] })
  b.cyl(3.2, 3.2, 0.3, 8, '#15161a', { at: [0, 1.6, -3.2], rot: [Math.PI / 2, 0, 0] })
  b.cyl(5.8, 6.4, 0.3, 9, C.stoneDark, { at: [0, 0.15, 1.5] })
  for (let i = 0; i < 6; i++) b.rock(C.basalt, { at: [-4 + i * 1.6, 0.4, 3.6 + (i % 2) * 1.2], rot: [0, i, 0], scale: [0.7, 0.45, 0.6] })
  // THE glow: ember cracks on the floor leading in.
  b.box(0.35, 0.12, 3.6, C.ember, { at: [0.6, 0.12, -1.2], rot: [0, 0.2, 0] })
  b.box(0.3, 0.12, 2.2, C.ember, { at: [-0.9, 0.12, -0.4], rot: [0, -0.3, 0] })
  return { geometry: b.build(), light: { at: toWorld(spec, 0, 1.4, -3.0), colour: C.ember, day: 0.8, night: 1.8, radius: 1.4, disc: 2.2 }, smoke: [{ at: toWorld(spec, 0, 3.2, -2.4), size: 0.5, steam: true }], banners: [] }
}

function glacierLagoon(spec: LandmarkSpec, band: Band): LandmarkBuild {
  const b = new PropBatch(spec.x, 0, spec.z, spec.yaw)
  b.cyl(15, 15, 0.16, 16, '#3c6a7a', { at: [0, 0.1, 0] })
  b.torus(15.2, 0.6, 5, 16, C.sinter, { at: [0, 0.18, 0], rot: [Math.PI / 2, 0, 0] })
  // Moraine bank on the cliff side.
  for (let i = 0; i < 7; i++) b.rock(C.stoneDark, { at: [-12 + i * 4, 0.6, -16 + (i % 2) * 1.5], rot: [0, i * 0.7, 0], scale: [2.4, 1.1, 1.8] })
  // Calved bergs: slabs and one tilted tower.
  const bergs: Array<[number, number, number, number, number, number]> = [
    [-6, 2, 3.4, 1.4, 2.6, 0.3],
    [4, -5, 2.6, 1.0, 2.2, 1.1],
    [8, 5, 2.2, 0.9, 1.9, 2.0],
    [-2, -9, 1.8, 0.8, 1.6, 0.6],
    [1, 7, 1.6, 0.7, 1.4, 1.7],
    [-10, -4, 1.4, 0.6, 1.2, 2.4],
  ]
  for (const [x, z, sx, sy, sz, yaw] of bergs) {
    b.rock(C.ice, { at: [x, 0.5, z], rot: [0, yaw, 0], scale: [sx, sy, sz] })
    b.rock(C.iceBlue, { at: [x, 0.05, z], rot: [0, yaw, 0], scale: [sx * 1.1, 0.25, sz * 1.1] })
  }
  b.rock(C.ice, { at: [5, 2.4, -1], rot: [0.5, 0.4, 0.2], scale: [1.4, 3.4, 1.2] })
  let light: Light | null = null
  if (band >= 2) {
    // The viewing deck: planks on posts over the water, a rail and a lantern on a post.
    b.box(4, 0.3, 8, C.plank, { at: [-17.5, 1.0, 0] })
    for (const [x, z] of [[-19, -3.5], [-19, 3.5], [-16, -3.5], [-16, 3.5]] as const) b.beam([x, -0.2, z], [x, 1.0, z], 0.16, C.timber)
    b.beam([-15.6, 1.1, -4], [-15.6, 2.1, -4], 0.08, C.timberLight)
    b.beam([-15.6, 1.1, 4], [-15.6, 2.1, 4], 0.08, C.timberLight)
    b.beam([-15.6, 2.1, -4], [-15.6, 2.1, 4], 0.08, C.timberLight)
    b.box(1.8, 0.14, 0.5, C.plankPale, { at: [-18.6, 1.6, 1.5] })
    b.beam([-19.2, 1.0, -3.4], [-19.2, 3.4, -3.4], 0.1, C.timber)
    light = { at: toWorld(spec, -19.2, 3.5, -3.4), colour: C.window, day: 0, night: 2.0, radius: 0.35 }
  }
  return { geometry: b.build(), light, smoke: [], banners: [] }
}

function mill(spec: LandmarkSpec, band: Band): LandmarkBuild {
  const b = new PropBatch(spec.x, 0, spec.z, spec.yaw)
  // THE fall: a pale-blue slab down the authored cliff face (18 m up) into a pond, foam at the lip and the foot.
  b.box(3.2, 19, 1.0, '#8fb6c6', { at: [0, 9.5, -10], rot: [-0.08, 0, 0] })
  b.box(3.6, 0.9, 1.6, C.ice, { at: [0, 18.9, -10.6] })
  b.box(4.4, 1.0, 2.4, C.ice, { at: [0, 0.5, -9] })
  b.cyl(5, 5, 0.16, 12, '#3c6a7a', { at: [0, 0.1, -6] })
  b.torus(5.1, 0.4, 5, 12, C.stone, { at: [0, 0.14, -6], rot: [Math.PI / 2, 0, 0] })
  // The mill race is drawn by the paths layer (`STREAMS`); here only the pond's stone lip at the outflow.
  b.box(2.6, 0.5, 0.6, C.stone, { at: [-4.6, 0.25, -6], rot: [0, 0.2, 0] })
  for (let i = 0; i < 4; i++) b.rock(C.stone, { at: [-6 + i * 3, 0.3, -2 - (i % 2) * 2], scale: [0.7, 0.4, 0.6] })
  let light: Light | null = null
  let wheel: LandmarkBuild['wheel']
  if (band >= 1) {
    house(b, 4, 2, 0, 6, 4.4, 3.2, C.timberLight, C.turf)
    b.box(1.0, 1.0, 0.1, C.window, { at: [4, 2.0, 4.3] })
    // The wheel, taller than its house: axle through the wall, spokes drawn by the scene (it turns).
    b.beam([-1.5, 3.9, 1], [4, 3.9, 1], 0.18, C.timber)
    b.beam([-1.5, 0, 1], [-1.5, 3.9, 1], 0.2, C.timber)
    wheel = { at: toWorld(spec, -1.5, 3.9, 1), yaw: spec.yaw, radius: 3.6 }
    b.box(1.6, 0.4, 7, C.plank, { at: [-1.5, 3.2, -3.4], rot: [0.12, 0, 0] })
    light = { at: toWorld(spec, 4, 2.0, 4.4), colour: C.window, day: 0, night: 1.6, radius: 0.5 }
  }
  return { geometry: b.build(), light, smoke: band >= 1 ? [{ at: toWorld(spec, 2.2, 5.9, 2), size: 0.5, steam: false }] : [{ at: toWorld(spec, 0, 1.6, -10.4), size: 0.7, steam: true }], banners: [], wheel }
}

function longhouse(spec: LandmarkSpec): LandmarkBuild {
  const b = new PropBatch(spec.x, 0, spec.z, spec.yaw)
  b.box(22.8, 0.6, 9.6, C.stoneDark, { at: [0, 0.3, 0] })
  b.box(22, 3.6, 9, C.timber, { at: [0, 2.4, 0] })
  for (let i = -4; i <= 4; i++) b.box(0.3, 3.4, 0.2, C.timberLight, { at: [i * 2.4, 2.4, 4.6] })
  b.roof(22, 9.4, 4.2, 0.5, C.turf, { at: [0, 4.2, 0] }, 0.8)
  b.box(23.4, 0.5, 0.9, C.timberLight, { at: [0, 8.5, 0] })
  // THE carved gable: crossed beams rising past the ridge, dragon heads on their ends, both gables.
  for (const side of [-1, 1]) {
    const x = side * 11.4
    b.beam([x, 4.4, -4.6], [x, 10.6, 1.6], 0.24, C.cream)
    b.beam([x, 4.4, 4.6], [x, 10.6, -1.6], 0.24, C.cream)
    b.cone(0.5, 1.4, 5, C.red, { at: [x, 10.9, 2.1], rot: [Math.PI / 2 + 0.6, 0, 0] })
    b.cone(0.5, 1.4, 5, C.red, { at: [x, 10.9, -2.1], rot: [-Math.PI / 2 - 0.6, 0, 0] })
    b.box(0.5, 4.2, 9.0, C.cream, { at: [x * 0.98, 6.1, 0], rot: [0, 0, 0], scale: [1, 1, 1] })
  }
  // Door with a porch, the mead-hall fire glow inside it; shields along the wall.
  b.box(2.2, 2.8, 0.3, C.tarred, { at: [0, 1.9, 4.6] })
  b.box(3.2, 0.4, 2.4, C.turf, { at: [0, 3.6, 5.6] })
  b.beam([-1.4, 0.6, 6.6], [-1.4, 3.4, 6.6], 0.14, C.cream)
  b.beam([1.4, 0.6, 6.6], [1.4, 3.4, 6.6], 0.14, C.cream)
  for (let i = 0; i < 6; i++) b.cyl(0.65, 0.65, 0.16, 8, i % 2 ? C.red : C.cream, { at: [-7 + i * 2.8, 2.9, 4.72], rot: [Math.PI / 2, 0, 0] })
  b.box(0.9, 0.9, 1.2, C.tarred, { at: [2.0, 8.6, 0] })
  // The shed and a woodpile.
  house(b, -8, -8, 0.3, 5, 3.8, 2.4, C.timberLight, C.turf, false)
  b.box(3, 1.1, 1.2, C.plank, { at: [-12.6, 0.55, -4.4], rot: [0, 0.3, 0] })
  return { geometry: b.build(), light: { at: toWorld(spec, 0, 1.6, 4.9), colour: C.fire, day: 0.6, night: 2.2, radius: 0.7 }, smoke: [{ at: toWorld(spec, 2.0, 9.4, 0), size: 0.9, steam: false }], banners: [{ at: toWorld(spec, 13.6, 0, 6.5), height: 7, colour: C.red, yaw: spec.yaw }] }
}

function fishRacks(spec: LandmarkSpec): LandmarkBuild {
  const b = new PropBatch(spec.x, 0, spec.z, spec.yaw)
  const racks: Array<[number, number, number]> = [
    [0, -4, 18],
    [0, 0, 18],
    [0, 4, 12],
  ]
  for (const [cx, cz, length] of racks) {
    const n = Math.round(length / 3)
    for (let i = 0; i <= n; i++) {
      const x = cx - length / 2 + (i * length) / n
      b.beam([x, 0, cz - 0.9], [x, 3.4, cz], 0.1, C.timber)
      b.beam([x, 0, cz + 0.9], [x, 3.4, cz], 0.1, C.timber)
    }
    b.beam([cx - length / 2, 3.4, cz], [cx + length / 2, 3.4, cz], 0.1, C.timberLight)
    b.beam([cx - length / 2, 2.2, cz - 0.45], [cx + length / 2, 2.2, cz - 0.45], 0.06, C.timberLight)
    b.beam([cx - length / 2, 2.2, cz + 0.45], [cx + length / 2, 2.2, cz + 0.45], 0.06, C.timberLight)
    // The cod: pale wedges hung in pairs along both poles.
    for (let i = 0; i < length * 0.7; i++) {
      const x = cx - length / 2 + 0.7 + i * 1.4
      b.cone(0.22, 0.9, 4, C.fish, { at: [x, 1.8, cz - 0.5], rot: [Math.PI, 0, 0] })
      b.cone(0.22, 0.9, 4, C.fish, { at: [x + 0.3, 1.8, cz + 0.5], rot: [Math.PI, 0, 0] })
    }
  }
  b.box(2.4, 0.8, 1.0, C.plank, { at: [-11, 0.6, 2], rot: [0, 0.4, 0] })
  for (let i = 0; i < 3; i++) b.cyl(0.5, 0.5, 0.9, 7, C.plankPale, { at: [11 + i * 1.3, 0.45, 3 + (i % 2) * 0.8] })
  return { geometry: b.build(), light: null, smoke: [], banners: [] }
}

function sauna(spec: LandmarkSpec): LandmarkBuild {
  const b = new PropBatch(spec.x, 0, spec.z, spec.yaw)
  house(b, 0, 0, 0, 6, 4.8, 2.6, C.tarred, C.turf)
  b.box(0.8, 0.8, 0.1, C.window, { at: [1.6, 1.8, 2.5] })
  // THE jetty: planks out over the inlet on posts, the plunge ladder off its end, a bucket and a bench.
  b.box(1.8, 0.2, 7, C.plank, { at: [0, 0.5, -6.2] })
  for (const z of [-4, -6.5, -9]) {
    b.beam([-0.7, -1, z], [-0.7, 0.5, z], 0.12, C.timber)
    b.beam([0.7, -1, z], [0.7, 0.5, z], 0.12, C.timber)
  }
  b.beam([-0.4, -1.4, -9.8], [-0.4, 1.6, -9.8], 0.06, C.timberLight)
  b.beam([0.4, -1.4, -9.8], [0.4, 1.6, -9.8], 0.06, C.timberLight)
  for (const y of [-0.8, -0.2, 0.4, 1.0]) b.beam([-0.4, y, -9.8], [0.4, y, -9.8], 0.05, C.timberLight)
  b.cyl(0.3, 0.26, 0.4, 6, C.iron, { at: [0.5, 0.8, -3.6] })
  b.box(1.6, 0.12, 0.5, C.plankPale, { at: [-2.6, 0.6, 3.2] })
  b.box(2.2, 1.0, 1.0, C.plank, { at: [3.9, 0.5, -1.6], rot: [0, 0.2, 0] })
  return { geometry: b.build(), light: { at: toWorld(spec, 1.6, 1.8, 2.56), colour: C.window, day: 0, night: 1.6, radius: 0.45 }, smoke: [{ at: toWorld(spec, -1.8, 5.1, 0), size: 0.6, steam: true }], banners: [] }
}

function sheepFold(spec: LandmarkSpec): LandmarkBuild {
  const b = new PropBatch(spec.x, 0, spec.z, spec.yaw)
  house(b, -9, -4, 0.2, 7.2, 4.8, 3.2, C.red, C.turf)
  house(b, 7, -7, -0.3, 6.4, 4.6, 3.0, C.cream, C.turf)
  house(b, 9, 7, 0.4, 5.6, 4.4, 2.8, C.ochre, C.turf, false)
  b.box(0.9, 0.9, 0.1, C.window, { at: [-9 + Math.sin(0.2) * 2.45, 1.9, -4 + Math.cos(0.2) * 2.45], rot: [0, 0.2, 0] })
  // THE fold: a dry-stone ring six metres across, a gate gap, and a flock inside it.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2
    if (i === 4) continue
    b.box(2.9, 1.1, 0.7, i % 2 ? C.stone : C.stoneDark, { at: [-4 + Math.cos(a) * 6.2, 0.55, 7 + Math.sin(a) * 6.2], rot: [0, -a + Math.PI / 2, 0] })
  }
  b.beam([-4 + Math.cos(0.9) * 6.6, 0, 7 + Math.sin(0.9) * 6.6], [-4 + Math.cos(0.9) * 6.6, 1.6, 7 + Math.sin(0.9) * 6.6], 0.1, C.timber)
  b.beam([-4 + Math.cos(1.35) * 6.6, 0, 7 + Math.sin(1.35) * 6.6], [-4 + Math.cos(1.35) * 6.6, 1.6, 7 + Math.sin(1.35) * 6.6], 0.1, C.timber)
  const flock: Array<[number, number, number]> = [
    [-6, 5, 0.3],
    [-3, 8, 1.8],
    [-1.5, 5.5, 2.6],
    [-6.5, 9, 0.9],
    [-4, 11, 4.0],
    [-1, 9.5, 3.2],
    [-7.5, 7, 1.4],
    [-3, 3.5, 5.6],
    [1, 7.5, 0.6],
  ]
  for (const [x, z, yaw] of flock) sheep(b, x, z, yaw)
  b.cone(2.2, 3.4, 7, '#c9b26a', { at: [1.5, 1.7, -1.5] })
  b.beam([1.5, 0, -1.5], [1.5, 4.2, -1.5], 0.08, C.timber)
  return { geometry: b.build(), light: { at: toWorld(spec, -9 + Math.sin(0.2) * 2.5, 1.9, -4 + Math.cos(0.2) * 2.5), colour: C.window, day: 0, night: 1.6, radius: 0.5 }, smoke: [{ at: toWorld(spec, -9 - Math.cos(0.2) * 2.1, 5.6, -4 + Math.sin(0.2) * 2.1), size: 0.6, steam: false }], banners: [] }
}

function staveChurch(spec: LandmarkSpec): LandmarkBuild {
  const b = new PropBatch(spec.x, 0, spec.z, spec.yaw)
  b.box(12.6, 0.5, 8.8, C.stoneDark, { at: [0, 0.25, 0] })
  // Tiers: aisle, nave, clerestory, each with a steep tarred roof; cream trim bands.
  b.box(12, 3.4, 8.2, C.tarred, { at: [0, 2.2, 0] })
  b.roof(12, 8.6, 2.2, 0.4, C.timber, { at: [0, 3.9, 0] }, 0.7)
  b.box(8.4, 3.2, 5.4, C.tarred, { at: [0, 6.0, 0] })
  b.roof(8.4, 5.8, 2.4, 0.4, C.timber, { at: [0, 7.6, 0] }, 0.6)
  b.box(4.6, 2.8, 3.2, C.tarred, { at: [0, 10.4, 0] })
  b.roof(4.6, 3.6, 2.2, 0.35, C.timber, { at: [0, 11.8, 0] }, 0.5)
  for (const y of [3.9, 7.6, 11.8]) b.box(y === 3.9 ? 12.2 : y === 7.6 ? 8.6 : 4.8, 0.3, 0.3, C.cream, { at: [0, y, 0] })
  // The bell cote and spire.
  b.box(1.6, 1.8, 1.6, C.tarred, { at: [0, 14.6, 0] })
  b.cyl(0.35, 0.35, 0.9, 6, C.iron, { at: [0, 14.6, 0] })
  b.cone(1.3, 2.2, 4, C.timber, { at: [0, 16.6, 0], rot: [0, Math.PI / 4, 0] })
  b.cyl(0.08, 0.25, 2.4, 5, C.cream, { at: [0, 18.6, 0] })
  // THE dragon heads: one at every gable end of every tier, red-tongued.
  const gables: Array<[number, number, number]> = [
    [6.6, 5.6, 0],
    [-6.6, 5.6, 0],
    [4.8, 9.6, 0],
    [-4.8, 9.6, 0],
    [2.9, 13.6, 0],
    [-2.9, 13.6, 0],
  ]
  for (const [x, y, z] of gables) {
    const out = Math.sign(x)
    b.beam([x - out * 0.8, y - 1.2, z], [x + out * 0.6, y + 0.9, z], 0.22, C.timber)
    b.cone(0.5, 1.5, 5, C.timber, { at: [x + out * 1.3, y + 1.2, z], rot: [0, 0, -out * (Math.PI / 2 + 0.5)] })
    b.cone(0.14, 0.6, 4, C.red, { at: [x + out * 2.0, y + 1.0, z], rot: [0, 0, -out * (Math.PI / 2 + 0.2)] })
  }
  // Porch with a lantern.
  b.box(4, 2.6, 3.2, C.tarred, { at: [0, 1.3, 5.6] })
  b.roof(4, 3.6, 1.6, 0.3, C.timber, { at: [0, 2.6, 5.6] }, 0.4)
  b.box(1.4, 2.2, 0.2, C.timber, { at: [0, 1.1, 7.25] })
  b.beam([2.4, 0, 7.4], [2.4, 3.0, 7.4], 0.08, C.timber)
  for (let i = 0; i < 4; i++) b.rock(C.stone, { at: [-7 + i * 1.4, 0.35, 7 + (i % 2) * 1.2], scale: [0.5, 0.5, 0.4] })
  return { geometry: b.build(), light: { at: toWorld(spec, 2.4, 3.1, 7.4), colour: C.window, day: 0, night: 2.0, radius: 0.35 }, smoke: [], banners: [] }
}

function bathhouse(spec: LandmarkSpec): LandmarkBuild {
  const b = new PropBatch(spec.x, 0, spec.z, spec.yaw)
  house(b, 0, -6, 0, 10, 6, 3.4, C.cream, C.turf)
  b.box(1.0, 1.0, 0.1, C.window, { at: [-2.6, 2.0, -2.9] })
  b.box(1.0, 1.0, 0.1, C.window, { at: [2.6, 2.0, -2.9] })
  // THE pools: three steaming terraces stepping down a wooden deck toward the fjord.
  b.box(16, 0.3, 14, C.plank, { at: [0, 0.45, 4] })
  const pools: Array<[number, number, number, number]> = [
    [-4, 3, 3.6, 0.9],
    [4, 4, 3.0, 0.65],
    [0, 10, 2.6, 0.4],
  ]
  for (const [x, z, r, lip] of pools) {
    b.cyl(r + 0.8, r + 0.8, 0.3, 10, C.sinter, { at: [x, 0.6 + lip, z] })
    b.cyl(r, r, 0.2, 10, C.aqua, { at: [x, 0.8 + lip, z] })
    b.torus(r + 0.3, 0.2, 5, 12, C.plankPale, { at: [x, 0.8 + lip, z], rot: [Math.PI / 2, 0, 0] })
  }
  for (let i = 0; i < 3; i++) b.box(0.9, 0.08, 1.8, C.plankPale, { at: [-7.2 + i * 0.1, 0.7, 7 + i * 2.2], rot: [0.5, 0, 0] })
  b.box(2.4, 0.14, 0.5, C.plankPale, { at: [6.8, 1.0, 9] })
  b.beam([6.0, 0.6, 9.3], [6.0, 1.0, 9.3], 0.06, C.timber)
  b.beam([7.6, 0.6, 9.3], [7.6, 1.0, 9.3], 0.06, C.timber)
  house(b, 7.6, -7.4, 0.2, 3.4, 3, 2.2, C.timberLight, C.turf, false)
  for (let i = 0; i < 7; i++) b.beam([-8.2 + i * 2.7, 0.6, 11.2], [-8.2 + i * 2.7, 1.6, 11.2], 0.07, C.timber)
  b.beam([-8.2, 1.6, 11.2], [8.0, 1.6, 11.2], 0.07, C.timber)
  return { geometry: b.build(), light: { at: toWorld(spec, -4, 0.9, 3), colour: C.aqua, day: 0.1, night: 0.9, radius: 3.4, disc: 3.4 }, smoke: pools.map(([x, z, , lip]) => ({ at: toWorld(spec, x, 1.4 + lip, z), size: 0.55, steam: true })), banners: [] }
}

function powerHut(spec: LandmarkSpec): LandmarkBuild {
  const b = new PropBatch(spec.x, 0, spec.z, spec.yaw)
  b.box(8.6, 0.5, 6.6, C.stoneDark, { at: [0, 0.25, 0] })
  b.box(8, 3.6, 6, '#5c6168', { at: [0, 2.3, 0] })
  b.roof(8, 6.4, 1.2, 0.3, C.iron, { at: [0, 4.1, 0] }, 0.5)
  b.box(1.4, 1.8, 0.2, C.tarred, { at: [0, 1.4, 3.05] })
  b.box(0.8, 0.8, 0.1, C.fire, { at: [2.6, 2.4, 3.05] })
  // THE stack: a cooling tower taller than the shed, banded, venting.
  b.cyl(1.2, 1.7, 11, 9, '#8a8f93', { at: [5.5, 5.5, -1] })
  b.cyl(1.35, 1.35, 0.5, 9, C.red, { at: [5.5, 9.4, -1] })
  b.cyl(1.6, 1.3, 0.8, 9, C.iron, { at: [5.5, 11.2, -1] })
  // The manifold: pipes from the ground into the shed, valve wheels, the turbine casing on a plinth.
  for (let i = 0; i < 4; i++) {
    const x = -5.5 + i * 2.1
    b.beam([x, 0.3, -7], [x, 0.3, -3.2], 0.28, '#a7a78e')
    b.beam([x, 0.3, -3.2], [x, 2.0, -3.2], 0.28, '#a7a78e')
    b.beam([x, 2.0, -3.2], [x, 2.0, -3.0], 0.3, '#a7a78e')
    b.torus(0.5, 0.08, 5, 10, C.red, { at: [x, 1.2, -3.2], rot: [0, Math.PI / 2, 0] })
  }
  b.box(9, 0.6, 0.8, C.iron, { at: [-2, 0.3, -7.3] })
  b.cyl(1.3, 1.3, 4, 10, '#8a8f93', { at: [-5.6, 1.9, 2.2], rot: [0, 0, Math.PI / 2] })
  b.box(3, 0.4, 2.4, C.stoneDark, { at: [-5.6, 0.2, 2.2] })
  b.cyl(0.9, 0.9, 1.2, 8, C.red, { at: [-5.6, 1.9, 2.2], rot: [0, 0, Math.PI / 2] })
  b.beam([-5.6, 2.4, 2.2], [-5.6, 4.4, 2.2], 0.14, '#a7a78e')
  b.beam([-5.6, 4.4, 2.2], [-1, 4.4, 2.2], 0.14, '#a7a78e')
  b.box(2, 1.4, 1.2, C.timberLight, { at: [5, 0.7, 3.6], rot: [0, 0.3, 0] })
  return { geometry: b.build(), light: { at: toWorld(spec, 2.6, 2.4, 3.1), colour: C.fire, day: 0.2, night: 1.8, radius: 0.4 }, smoke: [{ at: toWorld(spec, 5.5, 11.8, -1), size: 0.9, steam: true }], banners: [] }
}

function boatYard(spec: LandmarkSpec): LandmarkBuild {
  const b = new PropBatch(spec.x, 0, spec.z, spec.yaw)
  // Stocks and THE half-built longship: keel, bare ribs, rising stems, a carved dragon prow.
  for (let i = -3; i <= 3; i++) b.box(0.4, 1.0, 3.2, C.timber, { at: [i * 2.6, 0.5, 0] })
  b.box(18, 0.5, 0.6, C.plank, { at: [0, 1.25, 0] })
  for (let i = -4; i <= 4; i++) {
    const w = 1.6 + (1 - Math.abs(i) / 5.5) * 1.2
    b.torus(w, 0.1, 5, 10, C.plankPale, { at: [i * 1.9, 1.5 + w * 0.1, 0], rot: [0, Math.PI / 2, 0] }, Math.PI)
  }
  for (const s of [-1, 1]) {
    b.beam([s * 8.6, 1.3, 0], [s * 10.4, 4.6, 0], 0.26, C.plank)
    b.box(6, 0.35, 0.6, C.plank, { at: [s * 4, 2.6, 2.1], rot: [0, 0, s * 0.08] })
    b.box(6, 0.35, 0.6, C.plank, { at: [s * 4, 2.6, -2.1], rot: [0, 0, s * 0.08] })
  }
  b.cone(0.7, 2.0, 6, C.red, { at: [10.9, 5.4, 0], rot: [0, 0, -1.1] })
  b.rock(C.red, { at: [10.4, 4.9, 0], scale: [0.6, 0.5, 0.45] })
  // The shed, timber stacks, a bench with tools, the slipway of planks down to the water.
  house(b, -6, 7, 0.3, 7, 4.6, 2.8, C.timberLight, C.turf, false)
  b.box(3.2, 1.2, 1.4, C.plank, { at: [2, 0.6, 7], rot: [0, 0.2, 0] })
  b.box(3.0, 0.8, 1.2, C.plankPale, { at: [2.3, 1.6, 7], rot: [0, 0.1, 0] })
  b.box(3.2, 0.9, 1.4, C.plank, { at: [7, 0.45, -6] })
  b.box(0.3, 0.5, 0.3, C.iron, { at: [6.4, 1.15, -6] })
  b.box(2.4, 0.2, 7.5, C.plank, { at: [0, 0.3, -6.5], rot: [-0.06, 0, 0] })
  b.beam([5, 0, 6], [5, 3.2, 6], 0.1, C.timber)
  return { geometry: b.build(), light: { at: toWorld(spec, 5, 3.3, 6), colour: C.fire, day: 0.4, night: 2.0, radius: 0.45 }, smoke: [], banners: [{ at: toWorld(spec, -10.5, 0, 10), height: 6, colour: C.cream, yaw: spec.yaw }] }
}

export function buildLandmark(spec: LandmarkSpec, band: Band): LandmarkBuild {
  switch (spec.id) {
    case 'beacon':
      return beacon(spec)
    case 'stone-circle':
      return stoneCircle(spec)
    case 'troll-rock':
      return trollRock(spec)
    case 'rune-stone':
      return runeStone(spec)
    case 'lava-cave':
      return lavaCave(spec)
    case 'glacier-lagoon':
      return glacierLagoon(spec, band)
    case 'mill':
      return mill(spec, band)
    case 'longhouse':
      return longhouse(spec)
    case 'fish-racks':
      return fishRacks(spec)
    case 'sauna':
      return sauna(spec)
    case 'sheep-fold':
      return sheepFold(spec)
    case 'stave-church':
      return staveChurch(spec)
    case 'bathhouse':
      return bathhouse(spec)
    case 'power-hut':
      return powerHut(spec)
    default:
      return boatYard(spec)
  }
}
