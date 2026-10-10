/**
 * Lightweight 2.5-D collision for the biome lands: every structure is a shape in the ground
 * plane (world XZ, metres) and every character is a circle. Height comes from the terrain
 * sampler, not from here. Pure, deterministic, no three.js — shared by every biome and by the
 * vitest simulations.
 *
 * Conventions (match three.js `rotation.y = yaw`):
 *   world = centre + R(yaw) · local,   R(yaw) · (lx, lz) = (lx cos yaw + lz sin yaw, −lx sin yaw + lz cos yaw)
 *   local = R(−yaw) · (world − centre):  lx = dx cos yaw − dz sin yaw,  lz = dx sin yaw + dz cos yaw
 * Headings are atan2(dz, dx): the direction (cos h, sin h) in XZ.
 */

export interface CircleCollider {
  kind: 'circle'
  x: number
  z: number
  r: number
  tag?: string
  id?: string
}

/** Oriented box: half-extents `hx` along local x and `hz` along local z, turned by `yaw`. */
export interface BoxCollider {
  kind: 'box'
  x: number
  z: number
  hx: number
  hz: number
  yaw: number
  tag?: string
  id?: string
}

export type Collider = CircleCollider | BoxCollider

export interface ColliderSet {
  readonly items: readonly Collider[]
  readonly cellSize: number
  /** Cell key → indices into `items` whose bounding box overlaps the cell. */
  readonly cells: ReadonlyMap<number, readonly number[]>
  /** Per-item cos / sin of the yaw (1 / 0 for circles) so queries never call trig. */
  readonly cos: Float64Array
  readonly sin: Float64Array
}

export interface Contact {
  x: number
  z: number
  /** Whether any collider pushed the circle. */
  hit: boolean
  /** Unit normal of the last push (points away from the collider); (0, 0) when `hit` is false. */
  nx: number
  nz: number
  /** Deepest penetration seen before resolving, metres. */
  depth: number
}

export interface Penetration {
  depth: number
  nx: number
  nz: number
}

export interface Steer {
  heading: number
  /** +1 turned toward +angle (left-hand side of the heading in XZ), −1 the other way, 0 clear. */
  side: -1 | 0 | 1
  blocked: boolean
  /** Free distance along the centre, +35° and −35° whiskers, clamped to the lookahead. */
  free: [number, number, number]
}

/* ---------- spatial hash ---------- */

const CELL_OFFSET = 1 << 20
const CELL_STRIDE = 1 << 21

function cellKey(ix: number, iz: number): number {
  return (ix + CELL_OFFSET) * CELL_STRIDE + (iz + CELL_OFFSET)
}

/** Axis-aligned bounds of a collider (boxes: |hx cos| + |hz sin| by |hx sin| + |hz cos|). */
function bounds(c: Collider): [number, number, number, number] {
  if (c.kind === 'circle') return [c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r]
  const cs = Math.abs(Math.cos(c.yaw))
  const sn = Math.abs(Math.sin(c.yaw))
  const ex = c.hx * cs + c.hz * sn
  const ez = c.hx * sn + c.hz * cs
  return [c.x - ex, c.z - ez, c.x + ex, c.z + ez]
}

/** Build the query structure. `cellSize` should be about the typical collider diameter. */
export function buildColliderSet(items: readonly Collider[], cellSize = 4): ColliderSet {
  const size = Math.max(1e-3, cellSize)
  const cells = new Map<number, number[]>()
  const cos = new Float64Array(items.length)
  const sin = new Float64Array(items.length)
  items.forEach((c, i) => {
    if (c.kind === 'box') {
      cos[i] = Math.cos(c.yaw)
      sin[i] = Math.sin(c.yaw)
    } else {
      cos[i] = 1
      sin[i] = 0
    }
    const [minX, minZ, maxX, maxZ] = bounds(c)
    const x0 = Math.floor(minX / size)
    const x1 = Math.floor(maxX / size)
    const z0 = Math.floor(minZ / size)
    const z1 = Math.floor(maxZ / size)
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const key = cellKey(ix, iz)
        const list = cells.get(key)
        if (list) list.push(i)
        else cells.set(key, [i])
      }
    }
  })
  return { items, cellSize: size, cells, cos, sin }
}

/**
 * Indices of every collider whose bounds may touch the circle (x, z, r), ascending so results
 * never depend on hash iteration order (the same answer as brute force, in the same order).
 */
export function queryCandidates(set: ColliderSet, x: number, z: number, r: number): number[] {
  const size = set.cellSize
  const x0 = Math.floor((x - r) / size)
  const x1 = Math.floor((x + r) / size)
  const z0 = Math.floor((z - r) / size)
  const z1 = Math.floor((z + r) / size)
  const out: number[] = []
  if (x1 - x0 === 0 && z1 - z0 === 0) {
    const list = set.cells.get(cellKey(x0, z0))
    return list ? list.slice() : out
  }
  const seen = new Set<number>()
  for (let ix = x0; ix <= x1; ix++) {
    for (let iz = z0; iz <= z1; iz++) {
      const list = set.cells.get(cellKey(ix, iz))
      if (!list) continue
      for (const i of list) {
        if (!seen.has(i)) {
          seen.add(i)
          out.push(i)
        }
      }
    }
  }
  out.sort((a, b) => a - b)
  return out
}

/* ---------- shape tests ---------- */

/**
 * Penetration of circle (x, z, r) into one collider, or null when clear.
 *
 * Circle: depth = (r + R) − |p − c|, normal = (p − c) / |p − c|.
 * Box: p goes to the box frame; q = clamp(p, ±h) is the closest point of the box. Outside
 * (q ≠ p): depth = r − |p − q|, normal = (p − q) / |p − q| (this is also right at corners).
 * Inside (q = p): depth = r + distance to the nearest face, normal = that face's outward axis.
 * The normal is rotated back to world with R(yaw).
 */
export function shapePenetration(c: Collider, x: number, z: number, r: number, cos?: number, sin?: number): Penetration | null {
  const dx = x - c.x
  const dz = z - c.z
  if (c.kind === 'circle') {
    const reach = r + c.r
    const d2 = dx * dx + dz * dz
    if (d2 >= reach * reach) return null
    const d = Math.sqrt(d2)
    if (d < 1e-9) return { depth: reach, nx: 1, nz: 0 }
    return { depth: reach - d, nx: dx / d, nz: dz / d }
  }
  const cs = cos ?? Math.cos(c.yaw)
  const sn = sin ?? Math.sin(c.yaw)
  const lx = dx * cs - dz * sn
  const lz = dx * sn + dz * cs
  const qx = Math.max(-c.hx, Math.min(c.hx, lx))
  const qz = Math.max(-c.hz, Math.min(c.hz, lz))
  const ex = lx - qx
  const ez = lz - qz
  let depth: number
  let nlx: number
  let nlz: number
  if (ex !== 0 || ez !== 0) {
    const d2 = ex * ex + ez * ez
    if (d2 >= r * r) return null
    const d = Math.sqrt(d2)
    depth = r - d
    nlx = ex / d
    nlz = ez / d
  } else {
    // Centre inside the box: leave through the nearest face.
    const toX = c.hx - Math.abs(lx)
    const toZ = c.hz - Math.abs(lz)
    if (toX < toZ) {
      depth = r + toX
      nlx = lx >= 0 ? 1 : -1
      nlz = 0
    } else {
      depth = r + toZ
      nlx = 0
      nlz = lz >= 0 ? 1 : -1
    }
  }
  return { depth, nx: nlx * cs + nlz * sn, nz: -nlx * sn + nlz * cs }
}

/** Deepest penetration of the circle into the set, 0 when clear. */
export function penetrationDepth(set: ColliderSet, x: number, z: number, r: number): number {
  let depth = 0
  for (const i of queryCandidates(set, x, z, r)) {
    const hit = shapePenetration(set.items[i], x, z, r, set.cos[i], set.sin[i])
    if (hit && hit.depth > depth) depth = hit.depth
  }
  return depth
}

/* ---------- resolve / sweep ---------- */

/**
 * Push the circle out of everything it overlaps. Each pass walks the colliders in index order
 * and translates the circle by depth · normal per overlap (sequential impulses, Gauss–Seidel),
 * so a circle wedged between two shapes converges in a few passes when a free spot exists.
 * Candidates are re-queried after every push, so the sequence of pushes is exactly the one
 * brute force would make whatever the cell size: hashing never changes the answer.
 */
export function resolveCircle(set: ColliderSet, x: number, z: number, r: number, iterations = 3): Contact {
  let px = x
  let pz = z
  let hit = false
  let nx = 0
  let nz = 0
  let worst = 0
  for (let it = 0; it < iterations; it++) {
    let moved = false
    let after = -1
    for (;;) {
      let pushed = false
      for (const i of queryCandidates(set, px, pz, r)) {
        if (i <= after) continue
        const pen = shapePenetration(set.items[i], px, pz, r, set.cos[i], set.sin[i])
        if (!pen) continue
        px += pen.nx * pen.depth
        pz += pen.nz * pen.depth
        nx = pen.nx
        nz = pen.nz
        hit = true
        moved = true
        pushed = true
        after = i
        if (it === 0 && pen.depth > worst) worst = pen.depth
        break
      }
      if (!pushed) break
    }
    if (!moved) break
  }
  return { x: px, z: pz, hit, nx, nz, depth: worst }
}

const SWEEP_STEP_FRACTION = 0.75
const SWEEP_EPSILON = 1e-7

/**
 * Move the circle from → to, sliding along whatever it hits. The move is cut into substeps no
 * longer than 0.75 r, so a centre that starts ≥ r from a surface can never cross it in one
 * step (no tunnelling through thin walls). Each substep is pushed out with `resolveCircle`;
 * the push is along the surface normal, which leaves the tangential component of the step
 * intact — that is the slide. A substep that still overlaps after resolving (a gap narrower
 * than 2 r) is rejected, so the result is never inside a collider if the start was not.
 */
export function sweepCircle(set: ColliderSet, fromX: number, fromZ: number, toX: number, toZ: number, r: number): Contact {
  const dx = toX - fromX
  const dz = toZ - fromZ
  const dist = Math.hypot(dx, dz)
  if (dist < 1e-12) return resolveCircle(set, fromX, fromZ, r)
  const maxStep = Math.max(1e-4, r * SWEEP_STEP_FRACTION)
  const steps = Math.max(1, Math.ceil(dist / maxStep))
  const sx = dx / steps
  const sz = dz / steps
  let px = fromX
  let pz = fromZ
  let hit = false
  let nx = 0
  let nz = 0
  let depth = 0
  for (let s = 0; s < steps; s++) {
    const c = resolveCircle(set, px + sx, pz + sz, r)
    if (c.hit) {
      hit = true
      nx = c.nx
      nz = c.nz
      if (c.depth > depth) depth = c.depth
      if (penetrationDepth(set, c.x, c.z, r) > SWEEP_EPSILON) break
    }
    px = c.x
    pz = c.z
  }
  return { x: px, z: pz, hit, nx, nz, depth }
}

/* ---------- steering ---------- */

const WHISKER_ANGLE = (35 * Math.PI) / 180
/** Sample pitch r / 4 (≈ 0.22 m for a 0.9 m body): finer than the land cache's 0.5 m cells. */
const WHISKER_SAMPLES_PER_RADIUS = 4
/** Wider sweeps tried, nearest first, when all three whiskers are shut (a concave pocket). */
const FAN_ANGLES = [70, 105, 140, 180].map((deg) => (deg * Math.PI) / 180)

/** Anything else that counts as a wall for steering (the shoreline, say). */
export type BlockedAt = (x: number, z: number) => boolean

/** Free distance along a ray before a circle of radius r would overlap something (≤ lookahead). */
function whisker(set: ColliderSet, x: number, z: number, heading: number, r: number, lookahead: number, blocked?: BlockedAt): number {
  const cs = Math.cos(heading)
  const sn = Math.sin(heading)
  const n = Math.max(2, Math.ceil((lookahead / r) * WHISKER_SAMPLES_PER_RADIUS))
  for (let i = 1; i <= n; i++) {
    const d = (lookahead * i) / n
    const sx = x + cs * d
    const sz = z + sn * d
    if (penetrationDepth(set, sx, sz, r) > 0 || (blocked !== undefined && blocked(sx, sz))) return (lookahead * (i - 1)) / n
  }
  return lookahead
}

/**
 * Obstacle avoidance with three whiskers (centre, ±35°). When the centre whisker is clear the
 * heading is returned unchanged and the side resets. When blocked, the open side is the one
 * with more free distance; a side already held is kept while still blocked (hysteresis) so a
 * walker commits to going round instead of flipping every frame. The correction grows with how
 * close the block is: Δ = side · (35° + 55° · (1 − free_centre / lookahead)).
 *
 * When every whisker is shut within one radius (a pocket between walls), wider angles are
 * tried on the held side first — 70°, 105°, 140°, 180° — and the first with more than half the
 * lookahead free wins, so the walker backs out instead of pressing into the corner.
 * `blocked` lets the caller add walls that are not colliders (the shoreline).
 */
export function steerAround(
  set: ColliderSet,
  x: number,
  z: number,
  heading: number,
  r: number,
  lookahead: number,
  prevSide: -1 | 0 | 1 = 0,
  blocked?: BlockedAt,
): Steer {
  const centre = whisker(set, x, z, heading, r, lookahead, blocked)
  const left = whisker(set, x, z, heading + WHISKER_ANGLE, r, lookahead, blocked)
  const right = whisker(set, x, z, heading - WHISKER_ANGLE, r, lookahead, blocked)
  const free: [number, number, number] = [centre, left, right]
  if (centre >= lookahead) return { heading, side: 0, blocked: false, free }
  let side: -1 | 1
  if (prevSide !== 0) {
    const held = prevSide === 1 ? left : right
    const other = prevSide === 1 ? right : left
    // Only abandon the held side when it is shut and the other is open.
    side = held < r && other >= lookahead ? (prevSide === 1 ? -1 : 1) : prevSide
  } else {
    side = left >= right ? 1 : -1
  }
  if (left < r && right < r) {
    const order: Array<-1 | 1> = [side, side === 1 ? -1 : 1]
    for (const angle of FAN_ANGLES) {
      for (const s of order) {
        if (whisker(set, x, z, heading + s * angle, r, lookahead, blocked) > lookahead * 0.5) {
          return { heading: heading + s * angle, side: s, blocked: true, free }
        }
      }
    }
  }
  const closeness = 1 - centre / lookahead
  const turn = WHISKER_ANGLE + (55 * Math.PI) / 180 * closeness
  return { heading: heading + side * turn, side, blocked: true, free }
}

const OPEN_DIRECTIONS = 12

/**
 * The most open of 12 headings (every 30°, starting at `prefer`): the one with the greatest free
 * distance, ties (within 5 %) going to the heading nearest `prefer`. For a body that has stopped
 * making progress: it backs out of a pocket along whichever way is open, then steering resumes.
 */
export function openDirection(set: ColliderSet, x: number, z: number, r: number, lookahead: number, prefer: number, blocked?: BlockedAt): { heading: number; free: number } {
  let bestHeading = prefer
  let bestFree = -1
  let bestTurn = Number.POSITIVE_INFINITY
  for (let i = 0; i < OPEN_DIRECTIONS; i++) {
    const turn = (i * 2 * Math.PI) / OPEN_DIRECTIONS
    const heading = prefer + turn
    const free = whisker(set, x, z, heading, r, lookahead, blocked)
    const turnAbs = Math.min(turn, 2 * Math.PI - turn)
    if (free > bestFree * 1.05 || (free >= bestFree * 0.95 && turnAbs < bestTurn)) {
      bestFree = free
      bestHeading = heading
      bestTurn = turnAbs
    }
  }
  return { heading: bestHeading, free: bestFree }
}

/* ---------- agents ---------- */

export interface Agent {
  x: number
  z: number
  r?: number
}

/**
 * Push overlapping agents apart (in place), each pair by half its overlap along the pair's
 * normal, repeated until no pair overlaps or `maxIterations` is reached. Coincident agents
 * separate along a direction fixed by their indices so the result is deterministic.
 */
export function separateCircles<T extends Agent>(agents: T[], r: number, maxIterations = 128): T[] {
  const n = agents.length
  for (let it = 0; it < maxIterations; it++) {
    let any = false
    for (let i = 0; i < n; i++) {
      const a = agents[i]
      const ra = a.r ?? r
      for (let j = i + 1; j < n; j++) {
        const b = agents[j]
        const reach = ra + (b.r ?? r)
        const dx = b.x - a.x
        const dz = b.z - a.z
        const d2 = dx * dx + dz * dz
        if (d2 >= reach * reach) continue
        const d = Math.sqrt(d2)
        let ux: number
        let uz: number
        if (d < 1e-6) {
          const angle = (i * 7 + j * 13) * 0.618
          ux = Math.cos(angle)
          uz = Math.sin(angle)
        } else {
          ux = dx / d
          uz = dz / d
        }
        // A hair past touching so the pair does not re-register as overlapping next pass.
        const push = (reach - d) * 0.5 + 1e-6
        a.x -= ux * push
        a.z -= uz * push
        b.x += ux * push
        b.z += uz * push
        any = true
      }
    }
    if (!any) break
  }
  return agents
}
