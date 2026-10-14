import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { LANDS, direction, landVision, type Pose } from './lands'
import { PixelComposer } from './render/PixelComposer'
import { INITIAL_STATE, searchFromState, stateFromSearch, type LabState } from './state'
import './app.css'

const DAY = { sky: '#e8e2f2', hemiSky: '#f3e4ee', hemiGround: '#d9c3d6', hemi: 1.9, sun: '#fff1dc', sunI: 3, sunPos: [-160, 220, 180] as const }
const NIGHT = { sky: '#1b1a33', hemiSky: '#3a2f45', hemiGround: '#221d30', hemi: 1.1, sun: '#8fa3d8', sunI: 2.2, sunPos: [-120, 160, 200] as const }

/** Applies a cinematic pose, then flags readiness after a few frames so the harness can shoot. */
function PoseCamera({ pose, readyKey }: { pose: Pose | null; readyKey: string }) {
  const camera = useThree((state) => state.camera)
  const frames = useRef(0)
  useEffect(() => {
    frames.current = 0
    document.documentElement.dataset.visionReady = 'false'
    if (!pose) return
    camera.position.set(...pose.position)
    camera.lookAt(...pose.target)
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = pose.fov ?? 34
      camera.updateProjectionMatrix()
    }
    camera.updateMatrixWorld()
  }, [camera, pose, readyKey])
  useFrame(() => {
    if (frames.current >= 10) return
    frames.current += 1
    if (frames.current === 10) document.documentElement.dataset.visionReady = 'true'
  })
  return null
}

export default function App() {
  const [state, setState] = useState<LabState>(() => (typeof window === 'undefined' ? INITIAL_STATE : stateFromSearch(window.location.search)))
  const land = landVision(state.land) ?? LANDS[0]
  const dir = direction(land, state.direction)
  const pose = useMemo(() => (state.pose ? (dir.poses.find((entry) => entry.id === state.pose) ?? null) : null), [dir, state.pose])
  const grade = state.night ? NIGHT : DAY
  const renderKey = `${land.id}-${dir.id}-${state.pose ?? 'free'}-${state.night}-${state.seed}`

  const patch = useCallback((next: Partial<LabState>) => {
    setState((current) => {
      const merged = { ...current, ...next }
      window.history.replaceState(window.history.state, '', searchFromState(merged))
      return merged
    })
  }, [])

  useEffect(() => {
    const sync = () => setState(stateFromSearch(window.location.search))
    window.addEventListener('vision-lab', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('vision-lab', sync)
      window.removeEventListener('popstate', sync)
    }
  }, [])

  const built = dir.name.length > 0

  return (
    <main className="vision-lab">
      <header className="vision-header">
        <div>
          <span className="kicker">StudyGotchi · vision lab</span>
          <a className="kicker header-link" href={`?view=review${state.night ? '&night=1' : ''}`}>
            review all options →
          </a>
          <h1>{land.name}</h1>
          <p className="story">{land.story}</p>
        </div>
        <div className="controls">
          <label>
            <span>Land</span>
            <select value={land.id} onChange={(event) => patch({ land: event.target.value as LabState['land'] })}>
              {LANDS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <div className="segmented">
            {land.directions.map((entry) => (
              <button key={entry.id} type="button" aria-pressed={entry.id === dir.id} onClick={() => patch({ direction: entry.id })}>
                {entry.id.toUpperCase()} {entry.name ? `· ${entry.name}` : '· stub'}
              </button>
            ))}
          </div>
          <div className="segmented">
            {dir.poses.map((entry) => (
              <button key={entry.id} type="button" aria-pressed={state.pose === entry.id} onClick={() => patch({ pose: entry.id })}>
                {entry.id}
              </button>
            ))}
            <button type="button" aria-pressed={state.pose === null} onClick={() => patch({ pose: null })}>
              free
            </button>
            <button type="button" aria-pressed={state.night} onClick={() => patch({ night: !state.night })}>
              night
            </button>
          </div>
        </div>
      </header>

      <div className="vision-stage" data-vision-stage key={renderKey}>
        <Canvas shadows dpr={1} camera={{ position: [120, 70, 180], fov: 34, near: 0.5, far: 3000 }} gl={{ antialias: false, preserveDrawingBuffer: true }}>
          <color attach="background" args={[grade.sky]} />
          <fog attach="fog" args={[grade.sky, 420, 1400]} />
          <hemisphereLight args={[grade.hemiSky, grade.hemiGround, grade.hemi]} />
          <directionalLight
            position={[...grade.sunPos]}
            color={grade.sun}
            intensity={grade.sunI}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-camera-left={-220}
            shadow-camera-right={220}
            shadow-camera-top={220}
            shadow-camera-bottom={-220}
            shadow-camera-near={10}
            shadow-camera-far={800}
          />
          <dir.Scene night={state.night} seed={state.seed} />
          <PoseCamera pose={pose} readyKey={renderKey} />
          {state.pose === null ? <OrbitControls makeDefault enablePan target={[0, 10, 0]} maxPolarAngle={Math.PI / 2 - 0.08} minDistance={20} maxDistance={700} /> : null}
          <PixelComposer />
        </Canvas>
      </div>

      <aside className="vision-notes" data-built={built}>
        {built ? (
          <>
            <h2>
              {dir.id.toUpperCase()} · {dir.name}
            </h2>
            <p className="lineage">{dir.lineage}</p>
            <p>{dir.pitch}</p>
            <div className="columns">
              <div>
                <h3>Strengths</h3>
                <ul>
                  {dir.strengths.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Risks</h3>
                <ul>
                  {dir.risks.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        ) : (
          <p className="muted">Direction {dir.id.toUpperCase()} is not built yet.</p>
        )}
      </aside>
    </main>
  )
}
