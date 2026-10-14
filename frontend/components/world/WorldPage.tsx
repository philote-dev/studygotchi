"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { api, ApiError, mockWorldForCourse } from "@/lib/api";
import { DEV_STUDENT_ID, USE_MOCK } from "@/lib/config";
import { emit, type AudioEvent } from "@/lib/audio/events";
import { dominantBiome } from "@/lib/audio/director";
import { useIdentity } from "@/lib/identity";
import { WORLD_CHANGE_PRIORITY, asWorldResponse, changedRegions, describeChanges, toCanvasWorld, type WorldChange } from "@/lib/world/adapter";
import { landOutcome } from "@/lib/world/land-outcome";
import { takePrefetchedWorld } from "@/lib/world/land-prefetch";
import { landProgressOf } from "@/lib/world/land-progress";
import type { BiomeId, WorldResponse } from "@/lib/world/types";
import { LandConfetti } from "./LandConfetti";
import type { CatastropheEvent } from "./biomes/ice-town/scene/catastrophe-sequence";
import type { LocalBiomeId } from "./biomes/types";

/** at most this many one-shots per payload, 120 ms apart, loudest news first, three of a kind */
const SOUND_BUDGET = 6;
const SOUND_GAP_MS = 120;

function soundFor(change: WorldChange): AudioEvent {
  switch (change.kind) {
    case "hatch":
      return { type: "creature-arrive" };
    case "sprout":
      return { type: "spot-sprout" };
    case "landmark":
      return { type: "spot-landmark", stage: change.stage ?? 1 };
    case "upgrade":
      return { type: "landmark-upgrade" };
    case "grow":
      return { type: "progress", kind: "tick" };
    case "master":
      return { type: "progress", kind: "level-up" };
    case "explode":
      return { type: "explode" };
    case "recover":
      return { type: "recover" };
    case "fade":
      return { type: "creature-sleep" };
  }
}

function playChanges(changes: WorldChange[]) {
  const perKind = new Map<string, number>();
  const picked: WorldChange[] = [];
  for (const kind of WORLD_CHANGE_PRIORITY) {
    for (const c of changes) {
      if (c.kind !== kind || picked.length >= SOUND_BUDGET) continue;
      const n = perKind.get(kind) ?? 0;
      if (n >= 3) continue;
      perKind.set(kind, n + 1);
      picked.push(c);
    }
  }
  picked.forEach((c, i) => setTimeout(() => emit(soundFor(c)), i * SOUND_GAP_MS));
  const grows = changes.filter((c) => c.kind === "grow").length;
  if (grows >= 3) {
    setTimeout(() => emit({ type: "progress", kind: "streak" }), picked.length * SOUND_GAP_MS);
  }
}

const WorldCanvas = dynamic(() => import("./WorldCanvas"), { ssr: false });
const DevelopedBiomeCanvas = dynamic(
  () => import("./biomes/DevelopedBiomeCanvas").then((mod) => mod.DevelopedBiomeCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="biome-canvas-loading" role="status">
        Raising the land…
      </div>
    ),
  },
);

export type WorldSource = { kind: "own" } | { kind: "visit"; token: string };

/** The default source, one object: a fresh literal per render re-ran the load effect (and re-fetched the world) on every parent render. */
const OWN_SOURCE: WorldSource = { kind: "own" };

export function WorldPage({
  source = OWN_SOURCE,
  courseId: courseIdOverride,
  visual = "island",
  readOnly = false,
  onWorld,
  hoveredId,
  onHover,
  focusDistrict,
  onFocusDistrict,
  landBiome = null,
}: {
  source?: WorldSource;
  /** Load this course's land even when identity still points at another course. */
  courseId?: string | null;
  visual?: LocalBiomeId;
  /** The land the student is standing on; when set, the music follows it instead of the payload's biome mix. */
  landBiome?: BiomeId | null;
  readOnly?: boolean;
  /** Called with every payload the canvas draws, so a panel can read the same world. */
  onWorld?: (world: WorldResponse | null) => void;
  hoveredId?: string | null;
  onHover?: (conceptId: string | null) => void;
  focusDistrict?: string | null;
  onFocusDistrict?: (id: string | null) => void;
}) {
  const { selectedId, select, ingestVersion } = useStore();
  const { ready, courseId: identityCourseId, studentId } = useIdentity();
  const courseId = courseIdOverride ?? identityCourseId;
  // Hover lives with whoever owns the page; standalone, the page owns it.
  const [ownHover, setOwnHover] = useState<string | null>(null);
  const hovered = onHover ? (hoveredId ?? null) : ownHover;
  const setHovered = onHover ?? setOwnHover;
  const [world, setWorld] = useState<WorldResponse | null>(null);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  // The latest result that landed on this course (a resident went weak, or came back): the land
  // storms or heals, and every pass gets one confetti burst.
  const [result, setResult] = useState<CatastropheEvent>("idle");
  const [passes, setPasses] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const previous = useRef<WorldResponse | null>(null);

  useEffect(() => {
    onWorld?.(world);
  }, [world, onWorld]);

  // A different course is a different island: drop the old one before loading.
  useEffect(() => {
    if (source.kind !== "own") return;
    previous.current = null;
    setWorld(null);
    setChanged(new Set());
    setResult("idle");
    setPasses(0);
  }, [source.kind, courseId, studentId]);

  useEffect(() => {
    if (source.kind === "own" && !ready && !courseIdOverride) return;

    let cancelled = false;
    const load = async () => {
      try {
        if (source.kind === "visit") return api.getSharedWorld(source.token);
        // A land warmed before the cloud dive (landmark hover / settle) is taken once; later loads fetch fresh.
        if (courseIdOverride) return takePrefetchedWorld(courseIdOverride) ?? api.getWorldForCourse(courseIdOverride);
        return api.getWorld();
      } catch (err) {
        if (source.kind === "own" && courseId && (USE_MOCK || DEV_STUDENT_ID)) {
          return mockWorldForCourse(courseId);
        }
        throw err;
      }
    };
    load()
      .then((raw) => {
        if (cancelled) return;
        const parsed = asWorldResponse(raw);
        if (!parsed) throw new Error("World payload was not readable.");
        const delta = changedRegions(previous.current, parsed);
        // The first paint is not a change; only later deltas should pulse (and sound).
        setChanged(previous.current ? delta : new Set());
        const changes = describeChanges(previous.current, parsed);
        playChanges(changes);
        const outcome = landOutcome(changes);
        if (outcome) {
          setResult(outcome);
          if (outcome === "pass") setPasses((n) => n + 1);
        }
        previous.current = parsed;
        setWorld(parsed);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (source.kind === "own" && courseId && (USE_MOCK || DEV_STUDENT_ID)) {
          const fallback = mockWorldForCourse(courseId);
          previous.current = fallback;
          setWorld(fallback);
          setError(null);
          return;
        }
        emit({ type: "error" });
        setError(err instanceof Error ? err.message : "Could not load this world.");
        if (err instanceof ApiError && err.status === 404 && source.kind === "own") setWorld(null);
      });

    return () => {
      cancelled = true;
    };
  }, [courseId, courseIdOverride, ingestVersion, ready, retry, source, studentId]);

  // Pulses fade on their own after a few seconds.
  useEffect(() => {
    if (changed.size === 0) return;
    const t = setTimeout(() => setChanged(new Set()), 4500);
    return () => clearTimeout(t);
  }, [changed]);

  const canvasWorld = useMemo(() => (world ? toCanvasWorld(world) : null), [world]);

  // The island's bed follows the land itself; a visit with no land falls back to the biome most
  // of its concepts live in.
  useEffect(() => {
    if (!canvasWorld) return;
    emit({ type: "island-biome", biome: landBiome ?? dominantBiome(canvasWorld.places) });
  }, [canvasWorld, landBiome]);

  const liveProgress = landProgressOf(world);
  // Growth follows the real course fraction (ship handoff §2); only the legacy golden scene stays
  // pinned at 100 %.
  const progress = visual === "ice-golden" ? 1 : liveProgress;

  if (visual === "ice-golden") {
    return (
      <div className="relative h-full min-h-0 w-full">
        <DevelopedBiomeCanvas
          visual="ice-town"
          progress={progress}
          focusDistrict={focusDistrict}
          result={result}
          onFocusDistrict={onFocusDistrict}
          world={canvasWorld}
          selectedId={selectedId}
          hoveredId={hovered}
          changedIds={changed}
          onSelect={select}
          onHover={setHovered}
        />
        <LandConfetti burst={passes} />
        {error ? (
          <p className="pointer-events-none absolute bottom-4 left-4 rounded-full bg-paper-card px-3 py-1 text-[12px] text-paper-soft">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (
    visual === "ice-town" ||
    visual === "frontier-town" ||
    visual === "coastal-ruins" ||
    visual === "jungle-forest-village" ||
    visual === "medieval-meadow-kingdom" ||
    visual === "nordic-volcanic-highlands"
  ) {
    return (
      <div className="relative h-full min-h-0 w-full">
        <DevelopedBiomeCanvas
          visual={visual}
          progress={progress}
          focusDistrict={focusDistrict}
          result={result}
          onFocusDistrict={onFocusDistrict}
          world={canvasWorld}
          selectedId={selectedId}
          hoveredId={hovered}
          changedIds={changed}
          onSelect={select}
          onHover={setHovered}
        />
        <LandConfetti burst={passes} />
        {error ? (
          <p className="pointer-events-none absolute bottom-4 left-4 rounded-full bg-paper-card px-3 py-1 text-[12px] text-paper-soft">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (error && !world) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-[15px] text-paper-ink">{error}</p>
        <button
          type="button"
          onClick={() => {
            emit({ type: "ui", kind: "confirm" });
            setRetry((n) => n + 1);
          }}
          className="start-btn"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!canvasWorld) {
    return <div className="flex h-full items-center justify-center text-[14px] text-paper-soft">Raising the island…</div>;
  }

  return (
    <div className="relative h-full min-h-0 w-full">
      <WorldCanvas
        world={canvasWorld}
        readOnly={readOnly}
        selectedId={selectedId}
        onSelect={select}
        hoveredId={hovered}
        onHover={setHovered}
        changedIds={changed}
      />
      {readOnly ? (
        <p className="state-chip pointer-events-none absolute left-4 top-4" style={{ ["--chip" as string]: "#7a7168" }}>
          Visiting
        </p>
      ) : null}
      {error ? (
        <p className="pointer-events-none absolute bottom-4 left-4 rounded-full bg-paper-card px-3 py-1 text-[12px] text-paper-soft">
          {error}
        </p>
      ) : null}
    </div>
  );
}
