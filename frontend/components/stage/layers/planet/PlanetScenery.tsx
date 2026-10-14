"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLOBE_RADIUS } from "@/components/world/globe/globe-materials";
import { GLOBE_FOCUS_DIRECTION, seatedCameraPosition } from "@/components/world/globe/globe-seat";
import { toonGradient } from "@/components/world/globe/toon";
import { bucketAspect, galaxyBox, objectBox, placeBackdrop } from "@/lib/stage/placement";
import { moonPosition, placePlanetScenery, sceneryFade, type PlanetScenery as Placement } from "@/lib/stage/planet-scenery";
import { stageClock } from "../../lib/uniforms";

/** The globe group's position in `CourseGlobeScene` (`OrbitingGlobe`), the centre every orbit runs around. */
const GLOBE_CENTER: readonly [number, number, number] = [0, -0.7, 0];
/** The globe camera's vertical fov (`PlanetLayer`'s `GLOBE_CAMERA`). */
const GLOBE_FOV = 26;

export interface PlanetSceneryProps {
  seed: number;
  /** prefers-reduced-motion: the moons and the station hold their pose. */
  reducedMotion?: boolean;
}

function toon(color: string, ramp: THREE.DataTexture): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: ramp, transparent: true, opacity: 1 });
}

/**
 * Planet-rung scenery (the lab's `Planet2` moons and station, ported): two
 * toon moons on seeded tilted orbits around the globe and a small station in
 * a synchronous slot beside it. `placePlanetScenery` picks the orbits for the
 * longest clean visible arc; `sceneryFade` hides a moon wherever its path
 * would still cross the chrome, the globe's face or the active landmark seat.
 */
export const PlanetScenery = memo(function PlanetScenery({ seed, reducedMotion = false }: PlanetSceneryProps) {
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const aspectBucket = bucketAspect(size.width, size.height);
  const placement = useMemo<Placement>(() => {
    const seat = seatedCameraPosition({ width: aspectBucket * 1000, height: 1000 }, GLOBE_FOV, GLOBE_RADIUS);
    // The far sky's seeded dressing (same seed, same aspect bucket as SkyLayer): stay off it.
    const far = placeBackdrop(seed, { aspect: aspectBucket });
    const keepOut = [galaxyBox(far.galaxy, aspectBucket), ...far.objects.map((o) => objectBox(o, aspectBucket))];
    return placePlanetScenery({
      seed,
      eye: seat.position,
      lookAt: seat.lookAt,
      fovDeg: GLOBE_FOV,
      aspect: aspectBucket,
      globeCenter: GLOBE_CENTER,
      globeRadius: GLOBE_RADIUS,
      landmarkDir: GLOBE_FOCUS_DIRECTION,
      keepOut,
    });
  }, [seed, aspectBucket]);

  const ramp = useMemo(toonGradient, []);
  const mats = useMemo(
    () => ({
      moons: placement.moons.map((m) => toon(m.color, ramp)),
      hull: toon("#e8dcc8", ramp),
      panel: toon("#4f6ea8", ramp),
      ring: toon("#f6ac3d", ramp),
    }),
    [placement, ramp],
  );
  useEffect(
    () => () => {
      for (const m of mats.moons) m.dispose();
      mats.hull.dispose();
      mats.panel.dispose();
      mats.ring.dispose();
    },
    [mats],
  );
  useEffect(() => () => ramp.dispose(), [ramp]);

  const moonRefs = useRef<(THREE.Mesh | null)[]>([]);
  const station = useRef<THREE.Group>(null);
  const scratch = useMemo(() => ({ p: new THREE.Vector3(), ndc: new THREE.Vector3(), centre: new THREE.Vector3(...GLOBE_CENTER) }), []);
  const t0 = useMemo(() => stageClock.seconds, []);

  useFrame(() => {
    const t = reducedMotion ? t0 : stageClock.seconds;
    const globeDepth = scratch.centre.distanceTo(camera.position);
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    placement.moons.forEach((moon, i) => {
      const mesh = moonRefs.current[i];
      if (!mesh) return;
      const [x, y, z] = moonPosition(moon, GLOBE_CENTER, t);
      mesh.position.set(x, y, z);
      mesh.rotation.y = t * 0.1 * moon.direction;
      // Fade on the keep-outs, in the live camera's view (the seat frame at rest).
      const depth = scratch.p.copy(mesh.position).distanceTo(camera.position);
      scratch.ndc.copy(mesh.position).project(camera);
      const u = (scratch.ndc.x + 1) / 2;
      const v = (1 - scratch.ndc.y) / 2;
      const r = moon.radius / (depth * tanHalf) / 2;
      const fade = scratch.ndc.z < 1 ? sceneryFade(placement.view, u, v, r, depth < globeDepth) : 0;
      mats.moons[i].opacity = fade;
      mesh.visible = fade > 0.002;
    });
    const st = station.current;
    if (st) {
      const s = placement.station;
      st.position.set(s.position[0], s.position[1] + Math.sin((t * Math.PI * 2) / s.bobPeriodS) * s.bobAmplitude, s.position[2]);
      st.rotation.set(0.2, t * s.spinRadS, 0.1);
    }
  });

  const s = placement.station;
  return (
    <group name="planet-scenery">
      {placement.moons.map((moon, i) => (
        <mesh
          key={moon.id}
          ref={(el) => {
            moonRefs.current[i] = el;
          }}
          material={mats.moons[i]}
          visible={false}
        >
          <icosahedronGeometry args={[moon.radius, 1]} />
        </mesh>
      ))}
      <group ref={station} scale={s.scale} position={s.position as unknown as [number, number, number]}>
        <mesh material={mats.hull}>
          <boxGeometry args={[0.16, 0.1, 0.1]} />
        </mesh>
        <mesh position={[0.22, 0, 0]} material={mats.panel}>
          <boxGeometry args={[0.26, 0.01, 0.12]} />
        </mesh>
        <mesh position={[-0.22, 0, 0]} material={mats.panel}>
          <boxGeometry args={[0.26, 0.01, 0.12]} />
        </mesh>
        <mesh rotation-x={Math.PI / 2} material={mats.ring}>
          <torusGeometry args={[0.11, 0.012, 6, 16]} />
        </mesh>
      </group>
    </group>
  );
});
