"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { GlbCreature, type CreatureRequests } from "@/components/world/GlbCreature";
import type { BlobMotion } from "@/components/world/Blob";
import { creatureUrl } from "@/lib/world/roster";
import { CREATURE_DISPLAY_HEIGHT } from "@/lib/world/creature-scale";
import type { BiomeLayout, DistrictProgress, IceDistrictKind } from "../layout/biome-layout";
import { sampleTerrain } from "../layout/terrain";
import type { CatastrophePhase } from "../state";
import { collidersDebugEnabled, useColliderRegistry, useColliderSet, type WalkerDevHook } from "../../collision/ColliderRegistry";
import { ICE_LAND_SCALE, WALKER_DISTRICTS, createWalker, settleWalkers, stepWalkers, type WalkerBody } from "./parade";
import { residentsFallApart } from "./catastrophe-sequence";

/** Creature scale for this land (defined with the walker body radius in parade.ts). */
export { ICE_LAND_SCALE } from "./parade";

/** Hatch pets, Pokémon-ish Tripo, Mario-ish gobkit — never the biome-lab stock hats. */
export const ICE_CAST = [
  { id: "blob-ice-2", district: "harbour" as IceDistrictKind, color: "#ffe14a", accent: "#342d45" },
  { id: "tripo-creature-18", district: "harbour" as IceDistrictKind, color: "#f4b39a", accent: "#342d45" },
  { id: "gobkit-minion-c02", district: "town" as IceDistrictKind, color: "#8fc9d8", accent: "#c8524a" },
  { id: "biped-ice-1", district: "town" as IceDistrictKind, color: "#dceef2", accent: "#5f8f78" },
  { id: "sprite-ice-1", district: "lake" as IceDistrictKind, color: "#fff6df", accent: "#c8524a" },
  { id: "kenney-penguin", district: "forest" as IceDistrictKind, color: "#342d45", accent: "#ffe14a" },
  { id: "bean-ice-1", district: "forest" as IceDistrictKind, color: "#7fa79a", accent: "#ffe7a3" },
  { id: "tripo-creature-20", district: "glacier" as IceDistrictKind, color: "#c9a2e6", accent: "#342d45" },
  { id: "kenney-polar", district: "station" as IceDistrictKind, color: "#eef4f7", accent: "#342d45" },
] as const;

export const residentPositions: THREE.Vector3[] = [];

const WALKER_AGENTS_ID = "ice-walkers";
/** Frames the collider registry must hold still before the first bodies are placed. */
const SETTLE_FRAMES = 2;

/** GLB bodies face +z: a heading (cos h, sin h) in XZ is rotation.y = atan2(dirX, dirZ). */
function yawFromHeading(heading: number): number {
  return Math.atan2(Math.cos(heading), Math.sin(heading));
}

function Walker({
  index,
  member,
  layout,
  dismantle,
  bodies,
}: {
  index: number;
  member: (typeof ICE_CAST)[number];
  layout: BiomeLayout;
  dismantle: boolean;
  bodies: React.RefObject<WalkerBody[]>;
}) {
  const group = useRef<THREE.Group>(null);
  const motion = useRef<BlobMotion>({ moving: false, t: 0 });
  const requests = useRef<CreatureRequests>({ happy: false });

  useEffect(() => {
    if (!residentPositions[index]) residentPositions[index] = new THREE.Vector3();
  }, [index]);

  useFrame((_, dt) => {
    const root = group.current;
    const body = bodies.current?.[index];
    if (!root) return;
    motion.current.t += dt;
    if (!body) {
      root.visible = false;
      return;
    }
    root.visible = true;
    motion.current.moving = body.moving && !dismantle;
    const ground = Math.max(layout.seaLevel + 0.12, sampleTerrain(layout, body.x, body.z).height);
    const yaw = yawFromHeading(body.heading);
    if (dismantle) {
      const t = motion.current.t;
      const pop = index === 1 && t < 1.4;
      const slip = Math.sin(t * 3.6 + index) * (pop ? 1.8 : 0.95);
      const hop = Math.abs(Math.sin(t * 6.1 + index * 0.8)) * (pop ? 2.4 : 0.42);
      root.position.set(body.x + slip, ground + hop + (pop ? t * 3.2 : 0), body.z + Math.cos(t * 2.4 + index) * 0.28);
      root.rotation.set(
        0.62 + Math.sin(t * 4.4 + index) * 0.38,
        yaw + t * (pop ? 8 : 0.55) + Math.sin(t * 2.2 + index) * 0.4,
        0.9 * Math.sin(t * 3.1 + index),
      );
      root.scale.setScalar(pop ? Math.max(0.05, 1.35 - t * 1.1) : 1);
    } else {
      root.position.set(body.x, ground, body.z);
      root.rotation.set(0, yaw, 0);
      root.scale.setScalar(1);
    }
    residentPositions[index]?.copy(root.position);
  });

  return (
    <group ref={group} userData={{ displayHeight: CREATURE_DISPLAY_HEIGHT, walker: member.id }}>
      <GlbCreature
        id={member.id}
        variant={index}
        motion={motion}
        requests={requests}
        sad={dismantle}
        scale={ICE_LAND_SCALE}
        color={member.color}
        accent={member.accent}
      />
      <SillyFailBits dismantle={dismantle} index={index} accent={member.accent} />
    </group>
  );
}

function SillyFailBits({
  dismantle,
  index,
  accent,
}: {
  dismantle: boolean;
  index: number;
  accent: string;
}) {
  const hat = useRef<THREE.Group>(null);
  const cubes = useRef<THREE.Group>(null);
  const hatY = CREATURE_DISPLAY_HEIGHT * ICE_LAND_SCALE * 0.94;

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (hat.current) {
      if (dismantle) {
        hat.current.position.set(Math.sin(t * 3.2 + index) * 0.7, hatY + 1.15 + Math.abs(Math.sin(t * 5 + index)) * 0.55, Math.cos(t * 2.6 + index) * 0.4);
        hat.current.rotation.set(t * 3.4 + index, t * 4.1, 0.8);
      } else {
        hat.current.position.set(0, hatY, 0);
        hat.current.rotation.set(-0.12, 0, 0);
      }
    }
    if (cubes.current) {
      cubes.current.visible = dismantle;
      cubes.current.children.forEach((child, i) => {
        const spin = t * (2.8 + i * 0.4) + index;
        child.position.set(Math.sin(spin) * (0.9 + i * 0.25), 0.45 + Math.abs(Math.sin(spin * 1.6)) * 0.7, Math.cos(spin * 1.1) * 0.7);
        child.rotation.set(spin, spin * 1.3, spin * 0.6);
      });
    }
  });

  return (
    <group>
      <group ref={hat} visible={dismantle}>
        <mesh>
          <coneGeometry args={[0.42, 0.62, 7]} />
          <meshStandardMaterial color={accent} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.34, 0]}>
          <sphereGeometry args={[0.12, 8, 8]} />
          <meshStandardMaterial color="#fff6df" />
        </mesh>
      </group>
      <group ref={cubes} visible={false}>
        {[0, 1, 2].map((i) => (
          <mesh key={i}>
            <boxGeometry args={[0.28, 0.28, 0.28]} />
            <meshStandardMaterial color="#d7eef8" roughness={0.15} transparent opacity={0.85} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/**
 * The parade: one deterministic simulation (`stepWalkers`) runs once per frame at priority −1,
 * before the creatures read their bodies. Each body steers round the registered colliders,
 * sweeps its circle (no tunnelling), stays off the sea, and is kept apart from the others.
 * During the catastrophe the bodies hold still and are only kept clear of colliders.
 */
export function OurWalkers({
  layout,
  progress,
  phase,
}: {
  layout: BiomeLayout;
  progress: DistrictProgress;
  phase: CatastrophePhase;
}) {
  const fraction = Object.values(progress)[0] ?? 0;
  useEffect(() => {
    for (const member of ICE_CAST) useGLTF.preload(creatureUrl(member.id));
  }, []);
  const shown = useMemo(() => {
    if (fraction <= 0.05) return [];
    if (fraction < 0.75) return ICE_CAST.slice(0, 4);
    return ICE_CAST;
  }, [fraction]);
  const dismantle = residentsFallApart(phase);

  const registry = useColliderRegistry();
  const colliders = useColliderSet();
  const bodies = useRef<WalkerBody[]>([]);
  const settle = useRef({ version: -1, frames: 0 });
  const stats = useRef({ ms: 0 });

  useEffect(() => {
    registry.setAgents(WALKER_AGENTS_ID, bodies.current);
    return () => registry.clearAgents(WALKER_AGENTS_ID);
  }, [registry]);

  useEffect(() => {
    if (!collidersDebugEnabled()) return;
    const hook: WalkerDevHook = Object.assign(() => bodies.current.map((body) => ({ x: body.x, z: body.z, r: body.r })), {
      ms: () => stats.current.ms,
    });
    window.__iceWalkers = hook;
    return () => {
      delete window.__iceWalkers;
    };
  }, []);

  useFrame((_, dt) => {
    const set = colliders.current;
    const list = bodies.current;
    // Wait for the registrations of the first frames to settle before placing anyone.
    if (registry.version !== settle.current.version) {
      settle.current.version = registry.version;
      settle.current.frames = 0;
    } else settle.current.frames += 1;
    if (list.length === 0 && settle.current.frames < SETTLE_FRAMES) return;
    if (list.length > shown.length) list.length = shown.length;
    while (list.length < shown.length) list.push(createWalker(layout, set, WALKER_DISTRICTS, list.length));
    if (list.length === 0) return;
    const t0 = performance.now();
    if (dismantle) settleWalkers(layout, list, set);
    else stepWalkers(layout, list, set, dt);
    stats.current.ms += (performance.now() - t0 - stats.current.ms) * 0.1;
  }, -1);

  return (
    <group name="our-ice-walkers">
      {shown.map((member, index) => (
        <Walker key={member.id} index={index} member={member} layout={layout} dismantle={dismantle} bodies={bodies} />
      ))}
    </group>
  );
}
