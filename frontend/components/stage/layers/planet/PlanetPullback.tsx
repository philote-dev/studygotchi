"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLOBE_RADIUS } from "@/components/world/globe/globe-materials";
import { GLOBE_FOCUS_DIRECTION, seatedCameraPosition } from "@/components/world/globe/globe-seat";
import { smoothstep } from "@/lib/stage/altitude";
import type { HopRuntime } from "../../hop/hop-runtime";

/** The globe group's origin in the planet scene (`OrbitingGlobe`: `position={[0, -0.7, 0]}`). */
const GLOBE_CENTRE = new THREE.Vector3(0, -0.7, 0);
/** Where a settle turns the active course's landmark to, in the globe's parent space (= the planet scene). */
const FOCUS_DIR = new THREE.Vector3(...GLOBE_FOCUS_DIRECTION).normalize();
/** The landmark pin the globe reports its anchor from (`landmarkPinWorld`, R + 0.85). */
const PIN_LIFT = 0.85;
/**
 * S4-2: the camera's height over the landmark (globe radii) at the top of the
 * rise, where the clouds clear: the lab ladder's dive altitude (0.55 R over the
 * marker) opened up so the town, its creatures and the globe's curve read
 * around the landmark at the globe's 26 deg lens.
 */
export const OVER_LANDMARK_ALTITUDE = 2.0;
/** `SceneTheme`'s fog band at the seat; it scales with the camera distance so the look holds. */
const FOG = { near: 36, far: 72 };
/** `AutoFitCamera`'s depth range at the seat. */
const SEAT_NEAR = 0.1;
const SEAT_FAR_PAD = 80;
const EPS = 1e-4;

/**
 * S2-3: the pull-back on the real globe. Every frame above the seat (L > 1)
 * the planet camera is placed from the hop pose: the same orientation as the
 * seat camera, `k` times farther from the globe along the view axis, shifted
 * so the globe centre lands at the pose's screen point (seat -> viewport
 * centre). The planet therefore recedes to a `POINT_CELLS` point at the centre
 * at its own grain, with true perspective on the moons and the station. Fog
 * and the depth range scale with the distance; the globe scene's own star
 * points fade with the chrome (the stage sky is the sky from here on). At the
 * seat the camera is left to `AutoFitCamera` / `DiveCamera`: nothing changes
 * until a hop. The seat as seen on screen is reported to the hop state so the
 * pose and the twin's bloom anchor come from the real globe, not a constant.
 *
 * S4-2, below the seat (the merged rise, L 0.5 .. 1): the camera starts over
 * the landmark, looking straight down at the pin the settle has turned toward
 * the seat camera (the match cut: the land's look target was the screen
 * centre, so the landmark takes its place under the camera when the clouds
 * clear), then travels to the seat pose by L 1 (`worldRiseAt().approach`),
 * where the landmark is on its seat. Below L 0.5 the pass is not drawn.
 */
export function PlanetPullback({ runtime, camera, scene }: { runtime: HopRuntime; camera: THREE.PerspectiveCamera; scene: THREE.Scene }) {
  const size = useThree((s) => s.size);
  const scratch = useMemo(
    () => ({
      seatCam: new THREE.PerspectiveCamera(),
      c0: new THREE.Vector3(),
      qInv: new THREE.Quaternion(),
      c: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      pin: new THREE.Vector3(),
      over: new THREE.Vector3(),
      seatPos: new THREE.Vector3(),
      seatLook: new THREE.Vector3(),
      look: new THREE.Vector3(),
    }),
    [],
  );
  const driving = useRef(false);
  const stars = useRef<THREE.PointsMaterial[]>([]);

  // The globe scene's own star points: made fadeable at mount (alpha 1 draws the same pixels;
  // `transparent` is a program key, so it is set here, never during a hop).
  useEffect(() => {
    const found: THREE.PointsMaterial[] = [];
    scene.traverse((o) => {
      const m = (o as THREE.Points).material as THREE.Material | undefined;
      if ((o as THREE.Points).isPoints && m && (m as THREE.PointsMaterial).isPointsMaterial) {
        const pm = m as THREE.PointsMaterial;
        if (!pm.transparent) {
          pm.transparent = true;
          pm.needsUpdate = true;
        }
        found.push(pm);
      }
    });
    stars.current = found;
  });

  useFrame(() => {
    const st = runtime.state;
    const L = st.L;
    const { seatCam, c0, qInv, c, pos } = scratch;
    const width = size.width;
    const height = Math.max(1, size.height);
    const aspect = width / height;

    // 1. The seat camera as AutoFitCamera places it, and the globe as it sees it.
    const seat = seatedCameraPosition({ width, height }, camera.fov, GLOBE_RADIUS);
    seatCam.position.set(...seat.position);
    seatCam.up.copy(camera.up);
    seatCam.lookAt(...seat.lookAt);
    seatCam.updateMatrixWorld();
    qInv.copy(seatCam.quaternion).invert();
    c0.copy(GLOBE_CENTRE).sub(seatCam.position).applyQuaternion(qInv);
    const depth0 = -c0.z;
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const tanH = tanV * aspect;
    if (depth0 > 0) {
      st.seat = {
        cx: 0.5 + c0.x / (depth0 * tanH) / 2,
        cy: 0.5 - c0.y / (depth0 * tanV) / 2,
        radiusPx: (GLOBE_RADIUS / (depth0 * tanV)) * (height / 2),
      };
    }

    const pose = st.pose;
    const above = L > 1 + EPS && pose.k > 1 + EPS;
    const below = L < 1 - EPS;
    if (below) {
      // 2b. The approach from over the landmark to the seat (S4-2).
      driving.current = true;
      const { pin, over, seatPos, seatLook, look } = scratch;
      const a = st.world.approach;
      pin.copy(FOCUS_DIR).multiplyScalar(GLOBE_RADIUS + PIN_LIFT).add(GLOBE_CENTRE);
      over.copy(FOCUS_DIR).multiplyScalar(GLOBE_RADIUS * (1 + OVER_LANDMARK_ALTITUDE)).add(GLOBE_CENTRE);
      seatPos.set(...seat.position);
      seatLook.set(...seat.lookAt);
      camera.position.lerpVectors(over, seatPos, a);
      look.lerpVectors(pin, seatLook, a);
      camera.up.set(0, 1, 0);
      camera.lookAt(look);
      camera.near = SEAT_NEAR;
      camera.far = Math.max(80, seat.position[2] + SEAT_FAR_PAD);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.near = FOG.near;
        scene.fog.far = FOG.far;
      }
      for (const m of stars.current) m.opacity = pose.chrome;
      return;
    }
    if (!above) {
      if (driving.current) {
        // Back at the seat: hand the camera back exactly as AutoFitCamera left it.
        driving.current = false;
        camera.position.set(...seat.position);
        camera.lookAt(...seat.lookAt);
        camera.near = SEAT_NEAR;
        camera.far = Math.max(80, seat.position[2] + SEAT_FAR_PAD);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        if (scene.fog instanceof THREE.Fog) {
          scene.fog.near = FOG.near;
          scene.fog.far = FOG.far;
        }
        for (const m of stars.current) m.opacity = 1;
      }
      return;
    }

    // 2. The pose camera: seat orientation, k times the depth, the globe centre at (cx, cy).
    driving.current = true;
    const depth = depth0 * pose.k;
    c.set((2 * pose.cx - 1) * depth * tanH, (1 - 2 * pose.cy) * depth * tanV, -depth);
    pos.copy(c).applyQuaternion(seatCam.quaternion);
    camera.position.copy(GLOBE_CENTRE).sub(pos);
    camera.quaternion.copy(seatCam.quaternion);
    camera.near = SEAT_NEAR * pose.k;
    camera.far = depth * 1.5 + SEAT_FAR_PAD * pose.k;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = FOG.near * pose.k;
      scene.fog.far = FOG.far * pose.k;
    }
    for (const m of stars.current) m.opacity = pose.chrome;
  }, 0.5);

  return null;
}
