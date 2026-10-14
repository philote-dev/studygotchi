/**
 * Merges flat-coloured primitives into one vertex-coloured, non-indexed geometry so a hand-built
 * landmark of 15–60 parts costs one draw call. Colours are plain albedo: the shared toon
 * material lights the merged mesh live, exactly like the authored houses.
 */
import * as THREE from 'three'

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _c = new THREE.Color()

export interface PartPose {
  /** Position of the part's origin. */
  at?: [number, number, number]
  /** Euler rotation (x, y, z) in radians, 'YXZ' order (yaw first). */
  rot?: [number, number, number]
  scale?: number | [number, number, number]
}

export class PropBatch {
  private positions: number[] = []
  private normals: number[] = []
  private colours: number[] = []
  /** Local frame applied to every part: `world = origin + R(yaw) · local`. */
  private readonly frame: THREE.Matrix4

  constructor(x = 0, y = 0, z = 0, yaw = 0) {
    this.frame = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1))
  }

  get triangles(): number {
    return this.positions.length / 9
  }

  /** Push any geometry (disposed afterwards) with a flat colour and a local pose. */
  add(geometry: THREE.BufferGeometry, colour: string, pose: PartPose = {}): this {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry
    if (!flat.getAttribute('normal')) flat.computeVertexNormals()
    const at = pose.at ?? [0, 0, 0]
    const rot = pose.rot ?? [0, 0, 0]
    const scale = pose.scale ?? 1
    _e.set(rot[0], rot[1], rot[2], 'YXZ')
    _q.setFromEuler(_e)
    _p.set(at[0], at[1], at[2])
    if (typeof scale === 'number') _s.setScalar(scale)
    else _s.set(scale[0], scale[1], scale[2])
    _m.compose(_p, _q, _s).premultiply(this.frame)
    flat.applyMatrix4(_m)
    const pos = flat.getAttribute('position')
    const nor = flat.getAttribute('normal')
    _c.set(colour)
    for (let i = 0; i < pos.count; i++) {
      this.positions.push(pos.getX(i), pos.getY(i), pos.getZ(i))
      this.normals.push(nor.getX(i), nor.getY(i), nor.getZ(i))
      this.colours.push(_c.r, _c.g, _c.b)
    }
    if (flat !== geometry) flat.dispose()
    geometry.dispose()
    return this
  }

  box(w: number, h: number, d: number, colour: string, pose: PartPose = {}): this {
    return this.add(new THREE.BoxGeometry(w, h, d), colour, pose)
  }

  cyl(rTop: number, rBottom: number, h: number, segments: number, colour: string, pose: PartPose = {}): this {
    return this.add(new THREE.CylinderGeometry(rTop, rBottom, h, segments), colour, pose)
  }

  cone(r: number, h: number, segments: number, colour: string, pose: PartPose = {}): this {
    return this.add(new THREE.ConeGeometry(r, h, segments), colour, pose)
  }

  rock(colour: string, pose: PartPose = {}): this {
    return this.add(new THREE.DodecahedronGeometry(1, 0), colour, pose)
  }

  torus(r: number, tube: number, radial: number, tubular: number, colour: string, pose: PartPose = {}, arc = Math.PI * 2): this {
    return this.add(new THREE.TorusGeometry(r, tube, radial, tubular, arc), colour, pose)
  }

  /** A pitched roof: two slabs meeting at the ridge along local x. */
  roof(length: number, span: number, pitch: number, thickness: number, colour: string, pose: PartPose = {}, overhang = 0.5): this {
    const slope = Math.hypot(span / 2, pitch)
    const angle = Math.atan2(pitch, span / 2)
    const at = pose.at ?? [0, 0, 0]
    const yaw = pose.rot?.[1] ?? 0
    const cs = Math.cos(yaw)
    const sn = Math.sin(yaw)
    for (const side of [-1, 1]) {
      // Offset across the ridge (local z) by a quarter span, rotated by the yaw.
      const dz = (side * span) / 4
      this.box(length + overhang * 2, thickness, slope + overhang, colour, {
        at: [at[0] + dz * sn, at[1] + pitch / 2, at[2] + dz * cs],
        rot: [side * angle, yaw, 0],
      })
    }
    return this
  }

  /** A beam from a to b (local), radius r. */
  beam(a: [number, number, number], b: [number, number, number], r: number, colour: string, sides = 6): this {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const dz = b[2] - a[2]
    const length = Math.hypot(dx, dy, dz)
    const geometry = new THREE.CylinderGeometry(r, r, length, sides)
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize())
    const euler = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ')
    return this.add(geometry, colour, { at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], rot: [euler.x, euler.y, euler.z] })
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.positions), 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.normals), 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.colours), 3))
    geometry.computeBoundingSphere()
    return geometry
  }
}
