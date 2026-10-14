import { HeightField, drapedQuadPositions, ribbonPositions } from './heightfield'
import { archBridge, carts, cathedral, ellipseArc, hall, lanterns, patchwork, roundTower, scatterTrees, stalls, streetHouses, wallRing, yawFromDir } from './kit'
import { budgetFor, LAND_CELLS, LAND_SIZE, moverTriangles, type Classifier, type Mover, type Plan } from './plan'
import { houseLayers, treeLayers, type House, type InstancedLayer, type Item, type Tree } from './plan-types'
import { clamp, fbm, lerp, mulberry32, nightTone, polylineDistance, range, resample, smoothPolyline, smoothstep, type Vec2 } from './rng'

/**
 * Direction A — Citadel on the Crag. Seven terraces of pale wall climb a limestone spur that
 * grows out of the northern hills; the cathedral and keep crown it, the lower town spills down
 * the south foot to a three-arch bridge, and the patchwork fields feed it from across the river.
 */

const CRAG = { cx: -10, cz: -46, rx: 96, rz: 74, H: 72, p: 1.3, step: 8, tiers: 7, sector: 1.75, foot: 1.22 }
const WATER_Y = -1.2
const R_AVG = (CRAG.rx + CRAG.rz) / 2

const RIVER: Vec2[] = smoothPolyline([
  [-172, 80],
  [-120, 70],
  [-70, 76],
  [-30, 72],
  [0, 75],
  [40, 70],
  [90, 78],
  [130, 92],
  [172, 100],
])

/** Ring k (1..7) sits where the dome reaches the tier floor 8k. */
function ringD(k: number): number {
  return Math.pow(1 - (CRAG.step * k) / CRAG.H, 1 / CRAG.p)
}

/** Gate angle per ring: the Great Gate on axis, the rest alternate like Minas Tirith. */
function gateAngle(k: number): number {
  if (k === 1) return 0
  return k % 2 === 0 ? 0.55 : -0.55
}

/** Angle subtended by `metres` of arc on ring k. */
function angleAt(k: number, metres: number): number {
  return metres / (ringD(k) * R_AVG)
}

function polar(x: number, z: number) {
  const dx = (x - CRAG.cx) / CRAG.rx
  const dz = (z - CRAG.cz) / CRAG.rz
  return { d: Math.hypot(dx, dz), theta: Math.atan2(dx, dz) }
}

/** Point on ring k; `u` moves radially in units of the terrace width outside ring k. */
function ringPoint(k: number, theta: number, u = 0): Vec2 {
  const dk = ringD(k)
  const dPrev = k >= 2 ? ringD(k - 1) : CRAG.foot
  const d = dk + u * (dPrev - dk)
  return [CRAG.cx + Math.sin(theta) * d * CRAG.rx, CRAG.cz + Math.cos(theta) * d * CRAG.rz]
}

function tangentYaw(theta: number): number {
  return yawFromDir(Math.cos(theta) * CRAG.rx, -Math.sin(theta) * CRAG.rz)
}

/** Ramp geometry for the climb from tier k to gate k+1: start angle, direction, length in radians. */
function ramp(k: number) {
  const target = gateAngle(k + 1)
  const from = k === 1 ? 0 : gateAngle(k)
  const sign = Math.sign(target - from) || 1
  const length = Math.min(angleAt(k + 1, 34), Math.abs(target - from) * 0.9)
  return { target, sign, start: target - sign * length, length }
}

function cragHeight(x: number, z: number, seed: number): number {
  const { d, theta } = polar(x, z)
  const dome = CRAG.H * Math.max(0, 1 - Math.pow(d, CRAG.p))
  const plain = 2.8 * fbm(x, z, seed, 64, 3) + 0.4
  const backRidge = 30 * smoothstep(-112, -170, z) * (0.55 + 0.45 * fbm(x + 300, z, seed + 3, 48, 3))
  const sideRise = 7 * smoothstep(128, 170, Math.abs(x)) * (0.6 + 0.4 * fbm(x, z + 500, seed + 5, 40, 2))
  const riverD = polylineDistance(RIVER, x, z)
  const channel = -3.6 * (1 - smoothstep(0, 8, riverD)) - 1.2 * (1 - smoothstep(6, 18, riverD))

  const sectorWeight = smoothstep(CRAG.sector + 0.3, CRAG.sector, Math.abs(theta))
  let city: number
  if (dome >= CRAG.step * CRAG.tiers) {
    city = CRAG.step * CRAG.tiers
  } else if (d >= ringD(1)) {
    city = CRAG.step * smoothstep(CRAG.foot, ringD(1), d)
  } else {
    let k = 1
    while (k < CRAG.tiers && d <= ringD(k + 1)) k++
    city = CRAG.step * k
    if (k < CRAG.tiers) {
      const r = ramp(k)
      const u = (d - ringD(k + 1)) / (ringD(k) - ringD(k + 1))
      const along = (theta - r.start) * r.sign
      if (u < 0.5 && along > 0 && along <= r.length + angleAt(k + 1, 4)) {
        city = CRAG.step * k + CRAG.step * clamp(along / r.length, 0, 1)
      }
    }
  }
  const spur = lerp(d < 1 ? dome : 0, city, sectorWeight)
  const ground = Math.max(plain, backRidge, sideRise) + channel
  // the spur only ever adds; the plain (and its river channel) is the floor everywhere else
  return spur > 0.05 ? Math.max(ground, spur) : ground
}

/** True on the natural back of the spur, where limestone shoulders break through the turf. */
function backOutcrop(x: number, z: number, seed: number): boolean {
  const { d, theta } = polar(x, z)
  if (d > 1 || Math.abs(theta) < CRAG.sector) return false
  return fbm(x * 1.7, z, seed + 31, 22, 2) > 0.64
}

const DAY = {
  meadow: '#9fcf75',
  meadowLight: '#b9dc83',
  slope: '#7fae5f',
  cliff: '#8b8f78',
  wall: '#d8cfb6',
  cobble: '#b7ad99',
  wet: '#6f9c66',
  bed: '#3f7f86',
}
const NIGHT = {
  meadow: '#3f5a46',
  meadowLight: '#4a6950',
  slope: '#35503c',
  cliff: '#4a4e48',
  wall: '#75706a',
  cobble: '#55504c',
  wet: '#3a5a46',
  bed: '#1e3a44',
}

const STONE = '#e9e2d1'
const SLATE = '#475463'
const TIMBER = '#6b4a3a'
const ROAD = '#d8c49a'
const ROAD_NIGHT = '#6a5f50'
const PLAZA = '#d9d2c4'

const TIER_WALLS = [
  ['#e2d6bd', '#d9c9a8', '#cdb48f', '#c8b79a'],
  ['#e6dfcf', '#ded3bd', '#d2c6ad'],
  ['#ebe5d8', '#e2dbcb', '#e8e1d2'],
]
const TIER_ROOFS = [
  ['#d9765c', '#c96f45', '#b85c6b', '#8c5a4a'],
  ['#c96f45', '#a86a58', '#b85c6b', '#5a6675'],
  ['#475463', '#5a6675', '#b85c6b'],
]

export function buildCitadelPlan(seed: number): Plan {
  const rng = mulberry32(seed * 7919 + 11)
  const hf = new HeightField(LAND_SIZE, LAND_CELLS, (x, z) => cragHeight(x, z, seed))
  const inCity = (x: number, z: number) => {
    const { d, theta } = polar(x, z)
    return Math.abs(theta) < CRAG.sector && d < ringD(1) * 1.02
  }
  const classify: Classifier = (x, z, y, ny) => {
    const riverD = polylineDistance(RIVER, x, z)
    if (y < WATER_Y + 0.3) return 'bed'
    if (y < 1.1 && riverD < 17) return 'wet'
    const city = inCity(x, z) && y > 7.2
    if (ny < 0.6) return city ? 'wall' : 'cliff'
    if (city) return 'cobble'
    if (backOutcrop(x, z, seed)) return 'cliff'
    if (ny < 0.86) return 'slope'
    return fbm(x + 40, z - 70, seed + 9, 26, 2) > 0.53 ? 'meadowLight' : 'meadow'
  }

  const layers: InstancedLayer[] = []
  const draped: Plan['draped'] = []
  const houses: House[] = []
  const marks: Plan['marks'] = {}

  /* ---------------------------------------------------------------- walls, towers, gates */
  const wallBoxes: Item[] = []
  const towerBodies: Item[] = []
  const towerCaps: Item[] = []
  const gateLintels: Item[] = []
  const banners: Item[] = []
  for (let k = 1; k <= CRAG.tiers; k++) {
    const floor = CRAG.step * k
    const dk = ringD(k) * 0.995
    const count = Math.max(10, Math.round((dk * R_AVG * 2 * CRAG.sector) / 9))
    const points = ellipseArc([CRAG.cx, CRAG.cz], dk * CRAG.rx, dk * CRAG.rz, -CRAG.sector, CRAG.sector, count)
    const gate = gateAngle(k)
    const halfOpening = angleAt(k, 4.5)
    const openings = new Set<number>()
    points.forEach((point, index) => {
      if (index === points.length - 1) return
      const next = points[index + 1]
      const mid = polar((point[0] + next[0]) / 2, (point[1] + next[1]) / 2)
      if (Math.abs(mid.theta - gate) < halfOpening) openings.add(index)
    })
    const ring = wallRing(points, {
      floorY: () => floor,
      height: k === CRAG.tiers ? 4.5 : 3,
      thickness: 1.9,
      towerEvery: k === CRAG.tiers ? 3 : 5,
      towerRadius: k === CRAG.tiers ? 3.4 : 2.4,
      towerHeight: k === CRAG.tiers ? 10 : 5.5,
      capHeight: k === CRAG.tiers ? 5 : 2.8,
      openings,
      wallColor: DAY.wall,
      capColor: SLATE,
      sink: CRAG.step + 1.5,
    })
    wallBoxes.push(...ring.walls)
    towerBodies.push(...ring.towers)
    towerCaps.push(...ring.caps)
    for (const side of [-1, 1]) {
      const p = ringPoint(k, gate + side * angleAt(k, 6.2))
      const tower = roundTower([p[0], floor - CRAG.step - 1, p[1]], 3.2, CRAG.step + 1 + 11, DAY.wall, SLATE)
      towerBodies.push(tower.body)
      towerCaps.push(tower.cap)
      banners.push({ p: [p[0], floor + 11.5, p[1]], ry: tangentYaw(gate), s: [1.4, 3.4, 0.2], color: k % 2 ? '#b85c6b' : '#c96f45' })
    }
    const g = ringPoint(k, gate)
    gateLintels.push({ p: [g[0], floor + 5.4, g[1]], ry: tangentYaw(gate), s: [11, 4.2, 4], color: DAY.wall })
    if (k === 1) marks.greatGate = [g[0], floor, g[1]]
  }

  /* ---------------------------------------------------------------- the prow */
  const prow: Item[] = []
  for (let k = 2; k <= CRAG.tiers - 1; k++) {
    const inner = ringPoint(k + 1, 0)
    const outer = ringPoint(k, 0)
    const length = Math.hypot(outer[0] - inner[0], outer[1] - inner[1]) + 1.5
    prow.push({ p: [(inner[0] + outer[0]) / 2, CRAG.step * k - 1, (inner[1] + outer[1]) / 2], ry: yawFromDir(0, 1), s: [length, CRAG.step + 7, 7.5], color: DAY.wall })
  }
  const prowTop = ringPoint(CRAG.tiers, 0, 0.3)
  prow.push({ p: [prowTop[0], CRAG.step * CRAG.tiers - 1, prowTop[1]], ry: yawFromDir(0, 1), s: [15, 13, 9], color: DAY.wall })

  /* ---------------------------------------------------------------- citadel: cathedral, keep, halls */
  const top = CRAG.step * CRAG.tiers
  const cath = cathedral([CRAG.cx + 3, top, CRAG.cz - 5], 0.12, 1.05, '#f1ece1', '#4e5a6b')
  const keepPos: Vec2 = [CRAG.cx - 18, CRAG.cz + 9]
  const donjon = roundTower([keepPos[0], top - 0.5, keepPos[1]], 7, 24, STONE, SLATE, 9)
  const donjonTurrets: Item[] = []
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4
    const turret = roundTower([keepPos[0] + Math.sin(a) * 6.6, top + 15, keepPos[1] + Math.cos(a) * 6.6], 1.5, 12, STONE, SLATE, 3)
    donjonTurrets.push(turret.body, turret.cap)
  }
  houses.push(hall([CRAG.cx + 15, top - 0.3, CRAG.cz + 10], 0.2, 16, 8, 7, STONE, SLATE))
  houses.push(hall([CRAG.cx - 5, top - 0.3, CRAG.cz + 10], -1.3, 10, 6, 5.5, STONE, '#b85c6b'))
  marks.cathedralSpire = [cath.cones6[0].p[0], top + 13 * 0.95 * 1.5 + 18 * 0.95, cath.cones6[0].p[2]]
  marks.keep = [keepPos[0], top + 24, keepPos[1]]

  /* ---------------------------------------------------------------- tier houses */
  for (let k = 1; k <= CRAG.tiers - 1; k++) {
    const floor = CRAG.step * k
    const bucket = k <= 2 ? 0 : k <= 4 ? 1 : 2
    const dk = ringD(k)
    const dNext = ringD(k + 1)
    const widthM = (dk - dNext) * R_AVG
    const u = 0.7
    const circumference = (dNext + (dk - dNext) * u) * R_AVG * 2 * (CRAG.sector - 0.08)
    const slots = Math.floor(circumference / 7)
    const gateHere = gateAngle(k)
    const gateNext = gateAngle(k + 1)
    for (let i = 0; i < slots; i++) {
      const theta = -(CRAG.sector - 0.08) + ((i + 0.5) / slots) * 2 * (CRAG.sector - 0.08)
      if (Math.abs(theta - gateHere) < angleAt(k, 9)) continue
      if (Math.abs(theta - gateNext) < angleAt(k + 1, 7)) continue
      if (k >= 2 && Math.abs(theta) < angleAt(k, 5.5)) continue
      if (rng() < 0.12) continue
      const d = dNext + (dk - dNext) * (u + range(rng, -0.03, 0.04))
      const x = CRAG.cx + Math.sin(theta) * d * CRAG.rx
      const z = CRAG.cz + Math.cos(theta) * d * CRAG.rz
      const h = range(rng, 3.2, 5)
      houses.push({
        p: [x, floor - 0.35, z],
        ry: tangentYaw(theta) + range(rng, -0.06, 0.06),
        w: range(rng, 4.6, 6.4),
        d: Math.min(4, widthM * 0.4),
        h,
        roofH: h * range(rng, 0.6, 0.85),
        wall: TIER_WALLS[bucket][Math.floor(rng() * TIER_WALLS[bucket].length)],
        roof: TIER_ROOFS[bucket][Math.floor(rng() * TIER_ROOFS[bucket].length)],
      })
    }
  }

  /* ---------------------------------------------------------------- streets: tier roads, ramps, main street */
  const roads: Float32Array[] = []
  const lanternItems: Item[] = []
  const postItems: Item[] = []
  const addLanterns = (set: { heads: Item[]; posts: Item[] }) => {
    lanternItems.push(...set.heads)
    postItems.push(...set.posts)
  }
  for (let k = 1; k <= CRAG.tiers - 1; k++) {
    const from = gateAngle(k)
    const to = gateAngle(k + 1)
    const points: Vec2[] = [ringPoint(k, from, 0.12), ringPoint(k, from, -0.18)]
    const steps = 16
    for (let i = 0; i <= steps; i++) points.push(ringPoint(k + 1, lerp(from, to, i / steps), 0.25))
    points.push(ringPoint(k + 1, to, -0.15))
    const path = resample(points, 2.2)
    roads.push(ribbonPositions(hf, path, 3.2, 0.28))
    addLanterns(lanterns(hf, path, 13, 2.4, 1.4))
  }
  const greatGate = marks.greatGate
  const bridgeNorth: Vec2 = [-6, 64]
  const bridgeSouth: Vec2 = [-6, 83.5]
  const mainStreet = smoothPolyline([bridgeNorth, [-7, 54], [-9, 42], [greatGate[0], greatGate[2] + 12], [greatGate[0], greatGate[2] - 4]])
  const mainPath = resample(mainStreet, 2.2)
  roads.push(ribbonPositions(hf, mainPath, 5.2, 0.3))
  addLanterns(lanterns(hf, mainPath, 9, 2.6, 2.4))
  const quayLane = resample(smoothPolyline([[-62, 60], [-30, 59], [-6, 58], [30, 56], [66, 58]]), 2.5)
  const crossLane = resample(smoothPolyline([[-78, 48], [-40, 46], [-9, 44], [30, 40], [70, 34]]), 2.5)
  const southRoad = resample(smoothPolyline([bridgeSouth, [-4, 104], [10, 136], [18, 171]]), 3)
  const southWest = resample(smoothPolyline([[-6, 92], [-56, 100], [-118, 96], [-171, 104]]), 3)
  const eastRoad = resample(smoothPolyline([[66, 58], [104, 54], [150, 44], [171, 40]]), 3)
  const westRoad = resample(smoothPolyline([[-78, 48], [-108, 40], [-140, 26], [-171, 16]]), 3)
  for (const lane of [quayLane, crossLane]) roads.push(ribbonPositions(hf, lane, 3.6, 0.28))
  for (const lane of [southRoad, southWest, eastRoad, westRoad]) roads.push(ribbonPositions(hf, lane, 4, 0.28))
  const lanes = [mainPath, quayLane, crossLane, southRoad, southWest, eastRoad, westRoad]
  const roadDistance = (x: number, z: number) => {
    let best = Number.POSITIVE_INFINITY
    for (const lane of lanes) best = Math.min(best, polylineDistance(lane, x, z))
    return best
  }

  /* ---------------------------------------------------------------- lower town, market, mill */
  const riverDistance = (x: number, z: number) => polylineDistance(RIVER, x, z)
  const lowerMask = (x: number, z: number) => riverDistance(x, z) > 12 && hf.heightAt(x, z) > 0.4 && hf.heightAt(x, z) < 9 && Math.abs(x + 7) > 14 && roadDistance(x, z) > 4.2
  const lowerSize = { w: [5, 7.5] as const, d: [4, 5.4] as const, h: [3, 4.6] as const }
  houses.push(...streetHouses({ rng, hf, path: quayLane, spacing: 7.5, setback: 5, mask: lowerMask, size: lowerSize, walls: TIER_WALLS[0], roofs: TIER_ROOFS[0] }))
  houses.push(...streetHouses({ rng, hf, path: crossLane, spacing: 7.5, setback: 5, mask: lowerMask, size: lowerSize, walls: TIER_WALLS[0], roofs: TIER_ROOFS[0] }))
  houses.push(
    ...streetHouses({
      rng,
      hf,
      path: mainPath.slice(0, Math.floor(mainPath.length * 0.72)),
      spacing: 7.5,
      setback: 6.2,
      mask: (x, z) => hf.heightAt(x, z) < 9 && riverDistance(x, z) > 11 && Math.abs(z - 44) > 10 && roadDistance(x, z) > 4.2,
      size: lowerSize,
      walls: TIER_WALLS[0],
      roofs: TIER_ROOFS[0],
    }),
  )
  const plazaCentre: Vec2 = [-8, 44]
  draped.push({ id: 'plaza', positions: drapedQuadPositions(hf, [{ centre: plazaCentre, half: [14, 9], yaw: 0.05 }], 0.26, 4), day: PLAZA, night: '#5e5a56' })
  const market = stalls(rng, hf, [plazaCentre[0] + 5, plazaCentre[1]], 0.05, 4, 2, 4.2, ['#c96f45', '#e6c45a', '#b85c6b', '#e8a13a'])
  houses.push(hall([plazaCentre[0] - 20, hf.heightAt(plazaCentre[0] - 20, plazaCentre[1]) - 0.4, plazaCentre[1]], Math.PI / 2, 13, 8, 7.5, '#d9c9a8', '#c96f45'))
  marks.market = [plazaCentre[0], hf.heightAt(...plazaCentre), plazaCentre[1]]
  const millPos: Vec2 = [-34, 60]
  houses.push(hall([millPos[0], hf.heightAt(...millPos) - 0.4, millPos[1]], 0, 9, 6.5, 5.5, TIMBER, '#8c5a4a'))
  const movers: Mover[] = [{ kind: 'wheel', p: [millPos[0], WATER_Y + 1.2, millPos[1] + 6.2], radius: 3.4, yaw: 0, color: '#5a4030' }]
  marks.mill = [millPos[0], 0, millPos[1]]

  /* ---------------------------------------------------------------- bridge + carts */
  const bridge = archBridge({ a: bridgeNorth, b: bridgeSouth, deckY: 1.6, waterY: WATER_Y, width: 6.4, span: 7, stone: '#c8bda4', deckColor: ROAD })
  const cartSet = carts(rng, hf, [[-3, 92], [2, 110], [-9, 58], [40, 57]], (p) => (p[1] > 85 ? yawFromDir(0, 1) : 0))

  /* ---------------------------------------------------------------- fields, hedges, orchards */
  const farmMask = (x: number, z: number) => {
    const y = hf.heightAt(x, z)
    if (y < 0.6 || y > 11) return false
    if (hf.slopeAt(x, z) > 0.24) return false
    if (riverDistance(x, z) < 15) return false
    if (Math.abs(x) > 166 || Math.abs(z) > 166) return false
    const south = z > 88
    const east = x > 98 && z > -40 && z < 92
    const west = x < -118 && z > 20
    return south || east || west
  }
  const farm = patchwork({
    rng,
    yaw: 0.22,
    cell: [19, 25],
    extent: 175,
    mask: farmMask,
    palette: [
      ['#e6c45a', 3],
      ['#b9dc83', 3],
      ['#9fcf75', 2],
      ['#cfa86a', 1.5],
      ['#86b865', 1.5],
      ['#ead98a', 1],
    ],
    skipChance: 0.16,
    orchardChance: 0.1,
    hedgeChance: 0.7,
    avoid: (x, z) => roadDistance(x, z) < 3.6 || riverDistance(x, z) < 12,
    hf,
  })
  for (const [color, quads] of farm.fields) draped.push({ id: `field-${color}`, positions: drapedQuadPositions(hf, quads, 0.22, 5), day: color, night: nightTone(color) })

  /* ---------------------------------------------------------------- farm district: windmill, barn, cottages */
  const millHill: Vec2 = [38, 118]
  const windmillBase = hf.heightAt(...millHill)
  const windmill = roundTower([millHill[0], windmillBase - 0.3, millHill[1]], 3.2, 10, '#d9c9a8', '#8c5a4a', 4)
  houses.push(hall([millHill[0] - 16, hf.heightAt(millHill[0] - 16, millHill[1] + 8) - 0.4, millHill[1] + 8], 0.3, 14, 7, 5, TIMBER, '#8c5a4a'))
  houses.push(...streetHouses({ rng, hf, path: southRoad.slice(4, Math.floor(southRoad.length * 0.75)), spacing: 16, setback: 7, gap: 0.45, mask: farmMask, size: lowerSize, walls: TIER_WALLS[0], roofs: ['#8c5a4a', '#c96f45', '#d9765c'] }))
  marks.windmill = [millHill[0], windmillBase + 10, millHill[1]]

  /* ---------------------------------------------------------------- forest hamlet on the west flank */
  const hamletPath = resample(smoothPolyline([[-96, 30], [-112, 18], [-126, 2], [-134, -16]]), 2.5)
  roads.push(ribbonPositions(hf, hamletPath, 3.2, 0.28))
  houses.push(
    ...streetHouses({
      rng,
      hf,
      path: hamletPath,
      spacing: 11,
      setback: 5.5,
      gap: 0.3,
      size: { w: [5, 7], d: [4, 5], h: [2.8, 4] },
      walls: [TIMBER, '#8a6a4a', '#b99a7a'],
      roofs: ['#8c5a4a', '#6b4a3a', '#a86a58'],
      sink: 0.9,
    }),
  )
  marks.hamlet = [-118, hf.heightAt(-118, 8), 8]

  /* ---------------------------------------------------------------- trees */
  const inCityOrTown = (x: number, z: number) => inCity(x, z) || (Math.abs(x + 7) < 70 && z > 20 && z < 68)
  const forest: Tree[] = scatterTrees({
    rng,
    count: 300,
    box: [-168, -168, 168, 30],
    spacing: 5,
    hf,
    kind: (x, z) => (z < -118 || hf.heightAt(x, z) > 24 ? 'cone' : 'round'),
    colors: ['#4f7d4a', '#5f9a55', '#3f6b40', '#6d9c58'],
    mask: (x, z) => {
      const { d, theta } = polar(x, z)
      const y = hf.heightAt(x, z)
      if (y < 0.8 || inCityOrTown(x, z)) return false
      if (roadDistance(x, z) < 4) return false
      if (d < 1.05 && Math.abs(theta) < CRAG.sector + 0.1) return false
      const back = d < 1.3 && Math.abs(theta) > CRAG.sector
      const ridge = z < -112
      const west = x < -100
      return back || ridge || west
    },
  })
  const copses: Tree[] = scatterTrees({
    rng,
    count: 120,
    box: [-168, 20, 168, 168],
    spacing: 6,
    hf,
    kind: 'round',
    colors: ['#4f7d4a', '#5f9a55', '#6d9c58'],
    radius: [1.8, 3],
    mask: (x, z) => {
      const y = hf.heightAt(x, z)
      if (y < 0.5) return false
      if (roadDistance(x, z) < 4.5) return false
      if (inCityOrTown(x, z)) return false
      const rd = riverDistance(x, z)
      const willow = rd > 9 && rd < 16 && fbm(x, z, seed + 21, 20, 2) > 0.5
      const meadowCopse = !farmMask(x, z) && fbm(x, z, seed + 23, 34, 2) > 0.6
      return willow || meadowCopse
    },
  })

  /* ---------------------------------------------------------------- layers */
  layers.push(
    { id: 'walls', geometry: 'box', items: wallBoxes, color: DAY.wall },
    { id: 'prow', geometry: 'box', items: prow, color: DAY.wall },
    { id: 'towers', geometry: 'cyl8', items: [...towerBodies, donjon.body, ...donjonTurrets.filter((_, i) => i % 2 === 0), windmill.body, ...cath.cyls], color: DAY.wall },
    { id: 'caps', geometry: 'cone6', items: [...towerCaps, donjon.cap, ...donjonTurrets.filter((_, i) => i % 2 === 1), windmill.cap, ...cath.cones6], color: SLATE },
    { id: 'lintels', geometry: 'box', items: [...gateLintels, ...cath.boxes, ...bridge.decks, ...bridge.piers, ...bridge.parapets, ...cartSet.beds, ...cartSet.wheels, ...market.posts], color: DAY.wall },
    { id: 'cathedral-roofs', geometry: 'prism', items: [...cath.prisms, ...market.canopies], color: SLATE },
    { id: 'spires', geometry: 'cone4', items: cath.cones4, color: SLATE },
    { id: 'arches', geometry: 'arch', items: bridge.arches, color: '#c8bda4' },
    { id: 'banners', geometry: 'box', items: banners, color: '#b85c6b', castShadow: false },
    { id: 'hedges', geometry: 'box', items: farm.hedges, color: '#4f7d4a' },
    ...houseLayers('houses', houses),
    ...treeLayers('forest', [...forest, ...copses, ...farm.orchards], '#5a4030'),
    { id: 'lantern-posts', geometry: 'box', items: postItems, color: '#4a3a30', castShadow: false },
    { id: 'lanterns', geometry: 'box', items: lanternItems, color: '#ffd27a', glow: true, castShadow: false },
    { id: 'cathedral-windows', geometry: 'plane', items: [...cath.windows], color: '#ffe9a8', glow: true, castShadow: false },
  )
  draped.unshift({ id: 'roads', positions: concat(roads), day: ROAD, night: ROAD_NIGHT })

  return {
    label: 'medieval-a-citadel',
    ground: { hf, classify, day: DAY, night: NIGHT },
    water: { y: WATER_Y, day: '#5faeb6', night: '#274e60' },
    draped,
    layers,
    movers,
    budget: budgetFor(hf, draped, layers, moverTriangles(movers) + 2),
    marks,
  }
}

export function concat(parts: readonly Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Ground height sampler, exposed so poses can be checked against the real terrain. */
export function citadelGroundAt(seed: number, x: number, z: number): number {
  return cragHeight(x, z, seed)
}
