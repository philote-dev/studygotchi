/**
 * Accumulates flat-shaded triangles with per-face colours into one non-indexed buffer, so a whole
 * landmark or a whole ring of props costs one draw call. Colours are baked once (optionally hazed
 * toward the sky); the runtime toon ramp still shades by the flat normals.
 */
import * as THREE from 'three'

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()
const _n = new THREE.Vector3()
const _t = new THREE.Vector3()
const _e = new THREE.Euler()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const _col = new THREE.Color()
const _haze = new THREE.Color()
const UP = new THREE.Vector3(0, 1, 0)

export class Batch {
  private pos: number[] = []
  private nor: number[] = []
  private col: number[] = []

  /** `hazeTo` / `hazeAmount` bake aerial perspective into every colour pushed. */
  constructor(private readonly hazeTo: string = '#ffffff', private readonly hazeAmount = 0, private readonly flatten = 0) {
    _haze.set(hazeTo)
  }

  get triangles(): number {
    return this.pos.length / 9
  }

  /** Push raw local-space triangles (9 floats each) through `m`, coloured flat. */
  tris(positions: ArrayLike<number>, m: THREE.Matrix4 | null, color: string, hazeOverride?: number): void {
    _haze.set(this.hazeTo)
    const base = _col.set(color)
    const h = hazeOverride ?? this.hazeAmount
    const r = base.r * (1 - h) + _haze.r * h
    const g = base.g * (1 - h) + _haze.g * h
    const b = base.b * (1 - h) + _haze.b * h
    for (let i = 0; i + 8 < positions.length; i += 9) {
      _a.set(positions[i], positions[i + 1], positions[i + 2])
      _b.set(positions[i + 3], positions[i + 4], positions[i + 5])
      _c.set(positions[i + 6], positions[i + 7], positions[i + 8])
      if (m) {
        _a.applyMatrix4(m)
        _b.applyMatrix4(m)
        _c.applyMatrix4(m)
      }
      _t.subVectors(_c, _a)
      _n.subVectors(_b, _a).cross(_t)
      if (_n.lengthSq() < 1e-12) continue
      _n.normalize()
      if (this.flatten > 0) _n.lerp(UP, this.flatten).normalize()
      this.pos.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _c.x, _c.y, _c.z)
      for (let k = 0; k < 3; k++) {
        this.nor.push(_n.x, _n.y, _n.z)
        this.col.push(r, g, b)
      }
    }
  }

  /** Push a three.js geometry (indexed or not) through `m`. */
  geo(geometry: THREE.BufferGeometry, m: THREE.Matrix4 | null, color: string, hazeOverride?: number): void {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry
    this.tris(flat.attributes.position.array, m, color, hazeOverride)
    if (flat !== geometry) flat.dispose()
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3))
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3))
    geo.computeBoundingSphere()
    return geo
  }
}

/** Compose a placement matrix (yaw about y, optional tilts, non-uniform scale). */
export function place(x: number, y: number, z: number, yaw = 0, tiltX = 0, tiltZ = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  _e.set(tiltX, yaw, tiltZ, 'YXZ')
  _q.setFromEuler(_e)
  _s.set(sx, sy, sz)
  _p.set(x, y, z)
  return new THREE.Matrix4().compose(_p, _q, _s)
}

/** Paint an existing geometry with a flat colour per vertex (top faces one colour, sides another). */
export function paintByNormal(geo: THREE.BufferGeometry, top: string, side: string, hazeTo = '#ffffff', haze = 0): void {
  const normal = geo.getAttribute('normal') as THREE.BufferAttribute
  const colors = new Float32Array(normal.count * 3)
  _haze.set(hazeTo)
  for (let i = 0; i < normal.count; i++) {
    _col.set(normal.getY(i) > 0.5 ? top : side)
    _col.lerp(_haze, haze)
    colors[i * 3] = _col.r
    colors[i * 3 + 1] = _col.g
    colors[i * 3 + 2] = _col.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}
