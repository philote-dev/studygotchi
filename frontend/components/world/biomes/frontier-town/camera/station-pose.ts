import { dioramaCameraPose, type generateLayout } from '../layout/biome-layout'
import type { LabState } from '../state'

const rad = (degrees: number) => (degrees * Math.PI) / 180

export interface StationPose {
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

/**
 * The camera each station starts from: the plan-v4 diorama poses the scene has always used
 * (same numbers as the old in-scene rig), now applied through the free camera so the user can
 * orbit away from them. Pure, so the overview can be asserted pixel-identical.
 */
export function stationPose(state: LabState, generated: ReturnType<typeof generateLayout>): StationPose {
  const district = generated.districts.find((d) => d.id === state.focusDistrict)
  const yawDeg = Math.max(-35, Math.min(35, state.camera.azimuthDeg))
  const yaw = rad(yawDeg)
  const pitchDeg = Math.max(34, Math.min(40, state.camera.pitchDeg))
  const pitch = rad(pitchDeg)
  const kingdom = dioramaCameraPose(yawDeg, state.camera.dolly, pitchDeg)
  let target: [number, number, number] = kingdom.target
  let position: [number, number, number] = kingdom.position
  if (state.station === 'district' && district) {
    const focusOffsetX = district.id === 'railway-station' ? 12 : district.id === 'mine-works' ? -5 : 0
    target = [district.center[0] + focusOffsetX, 3, district.center[1]]
    const groundDistance = (district.id === 'outskirts-reserve' ? 140 : Math.max(100, Math.max(...district.footprint) * 1.65)) * state.camera.dolly
    const x = target[0] + Math.sin(yaw) * groundDistance * 0.55
    const z = target[2] + groundDistance
    position = [x, target[1] + Math.tan(pitch) * Math.hypot(x - target[0], z - target[2]), z]
  } else if (state.station === 'landmark') {
    target = [118, 9, 65]
    const d = 68 * state.camera.dolly
    position = [target[0] + Math.sin(yaw) * d * 0.5, target[1] + Math.tan(pitch) * d, target[2] + d]
  } else if (state.station === 'resident' && generated.districts[0]) {
    target = [generated.districts[0].center[0] + 7, 3, generated.districts[0].center[1]]
    const d = 18 * state.camera.dolly
    position = [target[0] + Math.sin(yaw) * 5, target[1] + Math.tan(pitch) * d, target[2] + d]
  } else if (state.station === 'arrival') {
    target = [-22, 4, -5]
    const d = 100 * state.camera.dolly
    position = [target[0] + Math.sin(yaw) * 34, target[1] + Math.tan(pitch) * d, target[2] + d]
  }
  return { position, target, fov: state.camera.fov }
}
