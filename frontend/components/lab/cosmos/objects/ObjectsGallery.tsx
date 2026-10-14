"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { EXHIBITS, EXHIBIT_IDS, exhibitById } from "./exhibits";
import { ExplainLegend, ExplainOverlay } from "./ExplainOverlay";
import { focusLayout, gridLayout, scaleLayout, tileBox, tinyRowsLayout, TINY_SIZES, type ScaleRow, type Tile } from "./layout";
import { seedFor, seedFromText } from "./lib/rng";
import type { AnyExhibit, KnobValue, ObjectTheme, Params } from "./lib/types";
import { cosmosClock } from "./lib/uniforms";
import { CosmosComposer } from "./render/CosmosComposer";
import { BACKDROP, StarBackdrop } from "./render/StarBackdrop";
import "./cosmos-objects.css";

export type GalleryView = "grid" | "tiny" | "scale";

export interface GalleryInitial {
  seed: string;
  theme: ObjectTheme;
  focus: string | null;
  view: GalleryView;
  chrome: boolean;
  frozenMs: number | null;
  cute: number;
  intensity: number;
  speed: number;
  cell: number;
  /** Teaching overlay for the focused comet / binary (`?explain=1`). */
  explain: boolean;
  /** Per-exhibit param overrides from the URL (captures), merged over the defaults. */
  params: Record<string, Params>;
}

const EXPLAINABLE = new Set(["comet", "binary"]);

const SPEEDS = [0, 0.25, 1, 2] as const;

function defaultParams(overrides: Record<string, Params>): Record<string, Params> {
  const out: Record<string, Params> = {};
  for (const e of EXHIBITS) out[e.id] = { ...e.defaults, ...(overrides[e.id] ?? {}) };
  return out;
}

export function ObjectsGallery({ initial }: { initial: GalleryInitial }) {
  const [seedText, setSeedText] = useState(initial.seed);
  const [theme, setTheme] = useState<ObjectTheme>(initial.theme);
  const [cute, setCute] = useState(initial.cute);
  const [intensity, setIntensity] = useState(initial.intensity);
  const [speed, setSpeed] = useState(initial.speed);
  const [cell, setCell] = useState(initial.cell);
  const [view, setView] = useState<GalleryView>(initial.view);
  const [explain, setExplain] = useState(initial.explain);
  const [focus, setFocus] = useState<string | null>(initial.focus && exhibitById(initial.focus) ? initial.focus : null);
  const [params, setParams] = useState<Record<string, Params>>(() => defaultParams(initial.params));
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setStage({ width: Math.floor(width), height: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const seed = useMemo(() => seedFromText(seedText), [seedText]);
  const reroll = useCallback(() => setSeedText(String(Math.floor(Math.random() * 0xffffff))), []);
  const setParam = useCallback((id: string, key: string, value: KnobValue) => setParams((p) => ({ ...p, [id]: { ...p[id], [key]: value } })), []);
  const patchParams = useCallback((id: string, patch: Params) => setParams((p) => ({ ...p, [id]: { ...p[id], ...patch } })), []);

  const { width, height } = stage;
  const focused = focus ? exhibitById(focus) : undefined;
  const { placements, scaleRows } = useMemo<{ placements: { tile: Tile; exhibit: AnyExhibit; key: string }[]; scaleRows: ScaleRow[] }>(() => {
    if (width === 0 || height === 0) return { placements: [], scaleRows: [] };
    const wrap = (tiles: Tile[]) => tiles.map((tile) => ({ tile, exhibit: exhibitById(tile.id)!, key: `${tile.id}-${tile.size}-${tile.x}-${tile.y}` }));
    if (focused) {
      const f = focusLayout(focused.id, width, height, initial.chrome ? 320 : 24);
      return { placements: [f.large, f.mid, f.tiny].map((tile) => ({ tile, exhibit: focused, key: `${tile.id}-${tile.size}` })), scaleRows: [] };
    }
    if (view === "scale") {
      const s = scaleLayout(
        EXHIBITS.map((e) => ({ id: e.id, su: e.su })),
        width,
        height,
      );
      return { placements: wrap(s.tiles), scaleRows: s.rows };
    }
    return { placements: wrap(view === "tiny" ? tinyRowsLayout(EXHIBIT_IDS, width, height) : gridLayout(EXHIBIT_IDS, width, height)), scaleRows: [] };
  }, [width, height, focused, view, initial.chrome]);

  const sky = BACKDROP[theme].sky;
  // Ink on paper needs more coverage than light on black: boost the glow alpha on the light sky.
  const objectIntensity = intensity * (theme === "light" ? 1.5 : 1);
  const readyKey = `${view}|${focus}|${seed}|${theme}|${cell}|${width}x${height}|${initial.frozenMs}|${explain}|${JSON.stringify(params)}`;
  const explaining = explain && !!focused && EXPLAINABLE.has(focused.id);
  const largeTile = focused ? placements[0]?.tile : undefined;

  return (
    <div className="cosmos-lab" data-theme={theme} data-chrome={initial.chrome ? "1" : "0"} data-view={focused ? "focus" : view}>
      <header className="cosmos-lab__bar cosmos-lab__chrome">
        <span className="cosmos-lab__title">Space objects</span>
        {focused ? (
          <>
            <button className="cosmos-lab__btn" onClick={() => setFocus(null)}>
              ← All objects
            </button>
            {EXPLAINABLE.has(focused.id) ? (
              <button className="cosmos-lab__btn" aria-pressed={explain} onClick={() => setExplain((e) => !e)} title="Labelled guides: orbits, arrows, ghosts, lobe">
                Explain
              </button>
            ) : null}
          </>
        ) : (
          <>
            <button className="cosmos-lab__btn" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
              Grid
            </button>
            <button className="cosmos-lab__btn" aria-pressed={view === "tiny"} onClick={() => setView("tiny")}>
              Tiny row
            </button>
            <button className="cosmos-lab__btn" aria-pressed={view === "scale"} onClick={() => setView("scale")} title="Every object at one px per scene unit (1 su = one star glow)">
              Relative scale
            </button>
          </>
        )}
        <label className="cosmos-lab__field">
          seed
          <input type="text" value={seedText} onChange={(e) => setSeedText(e.target.value)} spellCheck={false} aria-label="Gallery seed" />
        </label>
        <button className="cosmos-lab__btn" onClick={reroll}>
          Reroll all
        </button>
        <button className="cosmos-lab__btn" aria-pressed={theme === "light"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "Dark sky" : "Light sky"}
        </button>
        <label className="cosmos-lab__field">
          cute {cute.toFixed(2)}
          <input type="range" min={0} max={1} step={0.05} value={cute} onChange={(e) => setCute(Number(e.target.value))} />
        </label>
        <label className="cosmos-lab__field">
          intensity {intensity.toFixed(2)}
          <input type="range" min={0.4} max={1.6} step={0.05} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} />
        </label>
        <label className="cosmos-lab__field">
          speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s === 0 ? "paused" : `${s}×`}
              </option>
            ))}
          </select>
        </label>
        <label className="cosmos-lab__field">
          cell {cell}px
          <input type="range" min={1} max={4} step={1} value={cell} onChange={(e) => setCell(Number(e.target.value))} />
        </label>
      </header>

      <div className="cosmos-lab__stage" ref={stageRef}>
        {width > 0 && height > 0 ? (
          <Canvas
            orthographic
            flat
            dpr={[1, 2]}
            gl={{ antialias: false, alpha: false, powerPreference: "high-performance" }}
            camera={{ position: [0, 0, 1000], near: 0.1, far: 3000, zoom: 1 }}
            frameloop="always"
            style={{ background: sky }}
          >
            <color attach="background" args={[sky]} />
            <StarBackdrop seed={seed} width={width} height={height} theme={theme} fade={focused ? 0.4 : 0.55} />
            {placements.map(({ tile, exhibit, key }, i) => (
              <group key={key} position={[tile.x, tile.y, 0]} scale={tile.size / 2}>
                <exhibit.Component
                  seed={seedFor(seed, exhibit.id)}
                  size={tile.size}
                  theme={theme}
                  intensity={objectIntensity}
                  cute={cute}
                  params={params[exhibit.id]}
                  explain={explaining && i === 0}
                />
              </group>
            ))}
            <CosmosComposer pixel={cell} speed={speed} frozenMs={initial.frozenMs} readyKey={readyKey} />
          </Canvas>
        ) : null}

        <div className="cosmos-lab__overlay">
          {!focused && view === "grid"
            ? placements.map(({ tile, exhibit }) => {
                const box = tileBox(tile, width, height);
                return (
                  <button key={tile.id} className="cosmos-lab__tile" style={box} onClick={() => setFocus(exhibit.id)} title={`${exhibit.title}: ${exhibit.budget}`}>
                    <span className="cosmos-lab__tile-label cosmos-lab__chrome">
                      <strong>{exhibit.title}</strong>
                      <span>{exhibit.budget}</span>
                    </span>
                  </button>
                );
              })
            : null}
          {!focused && view === "tiny"
            ? TINY_SIZES.map((size, r) => {
                const tile = placements.find((p) => p.tile.size === size);
                if (!tile) return null;
                const box = tileBox(tile.tile, width, height);
                return (
                  <span key={size} className="cosmos-lab__caption cosmos-lab__chrome" style={{ left: 8, top: box.top + box.height / 2 - 7 }}>
                    {size} px
                  </span>
                );
              })
            : null}
          {!focused && view === "scale" ? (
            <>
              <span className="cosmos-lab__caption cosmos-lab__chrome" style={{ left: 12, top: 10, textTransform: "none", letterSpacing: 0 }}>
                1 su (scene unit) = one star glow. Rows share one px-per-su each; bodies above, structures below (binary, comet and giant repeated as bridges).
              </span>
              {scaleRows.map((row) => {
                const top = height / 2 - row.y;
                const bar = Math.max(4, Math.round(row.pxPerSu));
                return (
                  <span key={row.label} className="cosmos-lab__caption cosmos-lab__chrome" style={{ left: 12, top: top - 7, display: "grid", gap: 4 }}>
                    <span>{row.label}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span className="cosmos-lab__scalebar" style={{ width: bar }} />1 su = {row.pxPerSu.toFixed(1)} px
                    </span>
                  </span>
                );
              })}
              {placements.map(({ tile, exhibit, key }, i) => {
                const box = tileBox(tile, width, height);
                // Stagger captions under narrow tiles so neighbours do not collide.
                const drop = tile.size < 90 && i % 2 === 1 ? 30 : 0;
                return (
                  <span key={key}>
                    <span className="cosmos-lab__frame" style={{ left: box.left - 2, top: box.top - 2, width: box.width + 4, height: box.height + 4 }} />
                    <span className="cosmos-lab__caption cosmos-lab__chrome" style={{ left: box.left + box.width / 2, top: box.top + box.height + 8 + drop, transform: "translateX(-50%)", textAlign: "center", lineHeight: 1.3 }}>
                      {exhibit.title.split(" ")[0]}
                      <br />
                      {exhibit.su} su
                    </span>
                  </span>
                );
              })}
            </>
          ) : null}
          {focused
            ? placements.map(({ tile }) => {
                const box = tileBox(tile, width, height);
                return (
                  <span key={tile.size}>
                    {tile.size <= 96 ? <span className="cosmos-lab__frame" style={{ left: box.left - 3, top: box.top - 3, width: box.width + 6, height: box.height + 6 }} /> : null}
                    <span className="cosmos-lab__caption cosmos-lab__chrome" style={{ left: box.left, top: box.top + box.height + 6 }}>
                      {tile.size} px{tile.size > 96 ? ` = ${focused.su} su (${(tile.size / focused.su).toFixed(0)} px per su)` : ""}
                    </span>
                  </span>
                );
              })
            : null}
        </div>

        {explaining && focused && largeTile ? (
          <ExplainOverlay id={focused.id as "comet" | "binary"} tile={largeTile} width={width} height={height} seed={seedFor(seed, focused.id)} params={params[focused.id]} cute={cute} />
        ) : null}

        {focused ? (
          <aside className="cosmos-lab__side cosmos-lab__chrome">
            <h2>{focused.title}</h2>
            <p>{focused.ref}</p>
            <dl className="cosmos-lab__kv">
              <dt>budget</dt>
              <dd>{focused.budget}</dd>
              <dt>seed</dt>
              <dd>{seedFor(seed, focused.id)}</dd>
              <dt>meaning</dt>
              <dd>{focused.meaning}</dd>
              <dt>scale</dt>
              <dd>box = {focused.su} su (1 su = one star glow)</dd>
              {focused.readout?.(seedFor(seed, focused.id), params[focused.id]).map(([k, v]) => (
                <Fragment key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </Fragment>
              ))}
            </dl>
            {explaining ? <ExplainLegend id={focused.id as "comet" | "binary"} /> : null}
            <KnobPanel exhibit={focused} params={params[focused.id]} onChange={(k, v) => setParam(focused.id, k, v)} onPatch={(patch) => patchParams(focused.id, patch)} />
            <div className="cosmos-lab__row">
              {EXHIBITS.map((e) => (
                <button key={e.id} className="cosmos-lab__btn" aria-pressed={e.id === focused.id} onClick={() => setFocus(e.id)} style={{ padding: "3px 8px", fontSize: 11 }}>
                  {e.title}
                </button>
              ))}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function KnobPanel({ exhibit, params, onChange, onPatch }: { exhibit: AnyExhibit; params: Params; onChange: (key: string, value: KnobValue) => void; onPatch: (patch: Params) => void }) {
  return (
    <>
      {exhibit.knobs.map((knob) =>
        "options" in knob ? (
          <label key={knob.key} className="cosmos-lab__field">
            {knob.label}
            <select value={String(params[knob.key])} onChange={(e) => onChange(knob.key, e.target.value)}>
              {knob.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label key={knob.key} className="cosmos-lab__field">
            {knob.label}
            <span>{Number(params[knob.key]).toFixed(knob.step < 1 ? 2 : 0)}</span>
            <input type="range" min={knob.min} max={knob.max} step={knob.step} value={Number(params[knob.key])} onChange={(e) => onChange(knob.key, Number(e.target.value))} />
          </label>
        ),
      )}
      {exhibit.actions?.length ? (
        <div className="cosmos-lab__row">
          {exhibit.actions.map((a) => (
            <button key={a.label} className="cosmos-lab__btn cosmos-lab__btn--primary" onClick={() => onPatch(a.run(params, cosmosClock.seconds))}>
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
