import type { Direction, DirectionId, Pose } from './types'

// VISION_STUB: the shared placeholder every land starts from. Each artist replaces their land's
// three directions with real blockouts; the harness fails while a land still uses this.
function StubScene() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[320, 320]} />
        <meshToonMaterial color="#c9c3d6" />
      </mesh>
      <mesh position={[0, 12, 0]} castShadow>
        <boxGeometry args={[24, 24, 24]} />
        <meshToonMaterial color="#8a90a8" />
      </mesh>
    </group>
  )
}

export const STUB_POSES: readonly Pose[] = [
  { id: 'hero', position: [120, 70, 180], target: [0, 10, 0], fov: 34 },
  { id: 'walk', position: [40, 6, 70], target: [0, 8, 0], fov: 40 },
  { id: 'overview', position: [0, 240, 260], target: [0, 0, 0], fov: 36 },
  { id: 'reverse', position: [-140, 60, -170], target: [0, 10, 0], fov: 34 },
]

export function stubDirection(id: DirectionId): Direction {
  return {
    id,
    name: '',
    lineage: '',
    pitch: '',
    strengths: [],
    risks: [],
    Scene: StubScene,
    poses: STUB_POSES,
  }
}
