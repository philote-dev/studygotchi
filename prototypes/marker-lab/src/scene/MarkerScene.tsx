import { useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { MarkerDefinition } from '../markers'
import { PixelComposer } from '../render/PixelComposer'
import { BouquetBase } from './BouquetBase'

/**
 * Review pose for every fixed-size viewport: the whole bouquet (plinth to tallest crown) fills
 * ~80 % of the frame height per globe-markers.md §4, so a 48 px cell shows a ~38 px marker.
 */
export const MARKER_CAMERA = {
  position: [0, 57, 93] as [number, number, number],
  lookAt: [0, 14, 0] as [number, number, number],
  fov: 30,
  near: 0.1,
  far: 260,
} as const

function CameraAim() {
  const camera = useThree((state) => state.camera)
  camera.lookAt(...MARKER_CAMERA.lookAt)
  camera.updateProjectionMatrix()
  return null
}

function ReadyFrames({ onReady }: { onReady?: () => void }) {
  const frames = useRef(0)
  useFrame(() => {
    if (!onReady || frames.current >= 2) return
    frames.current += 1
    if (frames.current === 2) onReady()
  })
  return null
}

export function MarkerScene({
  marker,
  night,
  children,
  onReady,
}: {
  marker: MarkerDefinition
  night: boolean
  children?: ReactNode
  onReady?: () => void
}) {
  return (
    <>
      <color attach="background" args={[night ? '#2b2640' : '#e8e2f2']} />
      <hemisphereLight args={[night ? '#3a2f45' : '#f3e4ee', night ? '#221d30' : '#d9c3d6', night ? 1.2 : 2.1]} />
      <directionalLight
        position={night ? [-24, 22, 30] : [-30, 38, 36]}
        color={night ? '#8fa3d8' : '#fff1dc'}
        intensity={night ? 2.4 : 3.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
      />
      <CameraAim />
      <BouquetBase marker={marker} />
      {children}
      <PixelComposer />
      <ReadyFrames onReady={onReady} />
    </>
  )
}
