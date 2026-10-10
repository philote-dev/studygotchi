import type { ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import type { MarkerDefinition } from '../markers'
import { MARKER_CAMERA, MarkerScene } from '../scene/MarkerScene'

export function MarkerViewport({
  marker,
  night,
  size,
  label,
  children,
  onReady,
}: {
  marker: MarkerDefinition
  night: boolean
  size: 48 | 96 | 512
  label: string
  children?: ReactNode
  onReady?: () => void
}) {
  return (
    <figure className="marker-viewport" data-size={size}>
      <div className="marker-viewport-frame" style={{ width: size, height: size }} data-marker-cell={size}>
        <Canvas
          shadows
          dpr={1}
          camera={{ position: MARKER_CAMERA.position, fov: MARKER_CAMERA.fov, near: MARKER_CAMERA.near, far: MARKER_CAMERA.far }}
          gl={{ antialias: false, preserveDrawingBuffer: true }}
        >
          <MarkerScene
            marker={marker}
            night={night}
            onReady={onReady}
          >
            {children}
          </MarkerScene>
        </Canvas>
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  )
}
