"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { seedFromText } from "../../space/lib/rng";
import { courseSet, type CourseSetSize } from "./fake-courses";
import { generateGalaxyLayout } from "./galaxy-layout";
import { MapComposer } from "./MapComposer";
import { MapScene, SLOT_LABEL, sceneBudget } from "./MapScene";
import { MAP_PALETTES } from "./palettes";
import type { MapTheme } from "./uniforms";
import "./layout-lab.css";

export interface LayoutLabInitial {
  seed: string;
  theme: MapTheme;
  size: CourseSetSize;
  guides: boolean;
  /** Auto-orbit speed in drei units (2 = one turn per 30 s at 60 fps); 0 = off. */
  orbit: number;
  chrome: boolean;
  cell: number;
  /** Pre-selected course id (captures). */
  select: string | null;
}

/** Flags `<html data-cosmos-ready>` after a dozen rendered frames; capture scripts wait for it. */
function ReadyFlag({ readyKey }: { readyKey: string }) {
  const frames = useRef(0);
  useEffect(() => {
    frames.current = 0;
    document.documentElement.dataset.cosmosReady = "false";
  }, [readyKey]);
  useFrame(() => {
    if (frames.current >= 12) return;
    frames.current++;
    if (frames.current === 12) document.documentElement.dataset.cosmosReady = "true";
  }, 2);
  return null;
}

const SIZES: CourseSetSize[] = [3, 6, 12];

export function LayoutLab({ initial }: { initial: LayoutLabInitial }) {
  const [seedText, setSeedText] = useState(initial.seed);
  const [theme, setTheme] = useState<MapTheme>(initial.theme);
  const [size, setSize] = useState<CourseSetSize>(initial.size);
  const [guides, setGuides] = useState(initial.guides);
  const [orbit, setOrbit] = useState(initial.orbit);
  const [cell, setCell] = useState(initial.cell);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initial.select);

  const seed = useMemo(() => seedFromText(seedText), [seedText]);
  const set = useMemo(() => courseSet(size), [size]);
  const layout = useMemo(() => generateGalaxyLayout({ courses: set.courses, friends: set.friends, seed }), [set, seed]);
  const budget = useMemo(() => sceneBudget(layout), [layout]);
  const p = MAP_PALETTES[theme];

  const reroll = useCallback(() => setSeedText(String(Math.floor(Math.random() * 0xffffff))), []);
  const onHover = useCallback((id: string | null) => setHovered(id), []);
  const onSelect = useCallback((id: string | null) => setSelected(id), []);

  const selectedBead = selected ? layout.beads.find((b) => b.courseId === selected) ?? null : null;
  const current = layout.beads.find((b) => b.kind === "current") ?? null;
  const ladderCourse = selectedBead ?? current;
  const ladderArm = ladderCourse ? layout.arms[ladderCourse.arm] : null;
  const hoverText = useMemo(() => {
    if (!hovered) return "nothing under the pointer";
    const bead = layout.beads.find((b) => b.courseId === hovered);
    if (bead) return `${bead.name}: ${bead.kind}, arm ${bead.arm + 1}, r ${bead.a.toFixed(2)}, glow ${bead.radius.toFixed(3)}`;
    const glob = layout.globulars.find((g) => g.courseId === hovered);
    if (glob) return `${glob.name}: halo globular at ${Math.hypot(...glob.position).toFixed(2)} R`;
    const sat = layout.satellites.find((s) => s.friendId === hovered);
    if (sat) return `${sat.name}: satellite at ${Math.hypot(...sat.position).toFixed(2)} R`;
    const slot = layout.slots.find((s) => `${s.type}@${s.sector}` === hovered);
    if (slot) return `${SLOT_LABEL[slot.type]} slot, sector ${slot.sector + 1}: ${slot.note}`;
    return "nothing under the pointer";
  }, [hovered, layout]);
  const readyKey = `${seed}|${theme}|${size}|${guides}|${cell}|${selected ?? ""}`;

  return (
    <div className="cosmos-lab" data-theme={theme} data-chrome={initial.chrome ? "1" : "0"}>
      <header className="cosmos-lab__bar cosmos-lab__chrome">
        <span className="cosmos-lab__title">Cosmos lab · outer zone layout</span>
        <label className="cosmos-lab__field">
          seed
          <input type="text" value={seedText} onChange={(e) => setSeedText(e.target.value)} spellCheck={false} aria-label="Layout seed" />
        </label>
        <button className="cosmos-lab__btn" onClick={reroll}>
          Reroll
        </button>
        <div className="cosmos-lab__seg" role="group" aria-label="Course count">
          {SIZES.map((n) => (
            <button key={n} aria-pressed={size === n} onClick={() => setSize(n)}>
              {n} courses
            </button>
          ))}
        </div>
        <button className="cosmos-lab__btn" aria-pressed={theme === "light"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "Dark sky" : "Light sky"}
        </button>
        <button className="cosmos-lab__btn" aria-pressed={guides} onClick={() => setGuides(!guides)}>
          Guides
        </button>
        <button className="cosmos-lab__btn" aria-pressed={orbit > 0} onClick={() => setOrbit(orbit > 0 ? 0 : 0.5)}>
          Slow orbit
        </button>
        <label className="cosmos-lab__field">
          cell {cell}px
          <input type="range" min={1} max={4} step={1} value={cell} onChange={(e) => setCell(Number(e.target.value))} />
        </label>
      </header>

      <div className="cosmos-lab__stage">
        <Canvas flat dpr={[1, 2]} gl={{ antialias: false, alpha: false, powerPreference: "high-performance" }} camera={{ fov: 38, near: 0.1, far: 60, position: [0.5, 2.55, 2.75] }} frameloop="always" style={{ background: p.sky }}>
          <color attach="background" args={[p.sky]} />
          <MapScene layout={layout} theme={theme} guides={guides} orbit={orbit} hovered={hovered} selected={selected} onHover={onHover} onSelect={onSelect} />
          <MapComposer theme={theme} pixel={cell} />
          <ReadyFlag readyKey={readyKey} />
        </Canvas>

        <nav className="cosmos-lab__ladder cosmos-lab__chrome" aria-label="Scale ladder">
          <span data-active={!selectedBead}>Galaxy</span>
          <i>›</i>
          <span>{ladderArm ? `${ladderArm.kind} arm ${ladderArm.index + 1}${ladderArm.subjects.length ? ` (${ladderArm.subjects.join(", ")})` : ""}` : "arm"}</span>
          <i>›</i>
          <span data-active={!!selectedBead}>{ladderCourse ? ladderCourse.name : "course"}</span>
          <i>›</i>
          <span>Planet</span>
          <i>›</i>
          <span>World</span>
        </nav>

        <aside className="cosmos-lab__side cosmos-lab__chrome">
          <h2>Outer zone</h2>
          <p>Subjects are arms, courses are beads on them, the current course wears the ring. Archived courses drift in the halo as globulars, friends are satellite dwarfs, the deep field is wallpaper. Drag to orbit, wheel to zoom, hover a bead, click to select.</p>
          <dl className="cosmos-lab__kv">
            <dt>seed</dt>
            <dd>{layout.seed}</dd>
            <dt>pitch</dt>
            <dd>
              {layout.shape.pitchDeg.toFixed(1)}° · bar {layout.shape.barHalfLength.toFixed(2)} R · {layout.shape.spinDir > 0 ? "ccw" : "cw"}
            </dd>
            <dt>arms</dt>
            <dd>2 major + 2 minor + 1 spur</dd>
            <dt>beads</dt>
            <dd>
              {layout.budget.beads} on arms · {layout.beads.filter((b) => b.hasWorld).length} with worlds
            </dd>
            <dt>halo</dt>
            <dd>
              {layout.budget.globulars} globulars · {layout.budget.satellites} satellites
            </dd>
            <dt>slots</dt>
            <dd>
              {layout.budget.slots} / {layout.budget.slotCap}: {layout.slots.map((s) => SLOT_LABEL[s.type]).join(", ")}
            </dd>
            <dt>deep field</dt>
            <dd>{layout.budget.deepField} smudges</dd>
            <dt>draws</dt>
            <dd>
              {budget.drawCalls + (guides ? 1 : 0)} · {budget.points.toLocaleString()} pts · {budget.quads} quads
            </dd>
            <dt>palette</dt>
            <dd>
              <span className="cosmos-lab__swatches">
                {[p.core, p.arm, p.disc, p.hii, p.youAreHere, p.globularGlow, p.satelliteBar].map((c, i) => (
                  <i key={`${i}-${c}`} style={{ background: c }} />
                ))}
              </span>
            </dd>
          </dl>
          <h2>Hover</h2>
          <p>{hoverText}</p>
          <h2>Legend</h2>
          <div className="cosmos-lab__legend">
            <div>
              <b style={{ background: p.youAreHere }} /> you are here: gold ring, label always on
            </div>
            <div>
              <b style={{ background: p.beadWarm }} /> course bead: glow by concept count, warmth by mastery
            </div>
            <div>
              <b style={{ background: p.beadWorldCore }} /> planet core: the course has a world
            </div>
            <div>
              <b style={{ background: p.globularGlow }} /> globular: archived course in the halo
            </div>
            <div>
              <b style={{ background: p.satelliteBar }} /> satellite dwarf: a friend's galaxy
            </div>
            <div>
              <b style={{ background: p.blackHole }} /> markers: sibling objects (black hole beside the weakest course)
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
