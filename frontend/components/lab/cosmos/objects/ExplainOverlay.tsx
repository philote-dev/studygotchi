"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { binaryBodies, binaryLayout, generateBinary, l1FromDonor, lobeRadius, streamPoint } from "./BinaryStar";
import { cometOverrides, cometState, dustSample, generateComet, tailLength } from "./Comet";
import type { Tile } from "./layout";
import type { Params } from "./lib/types";
import { cosmosClock } from "./lib/uniforms";

/**
 * Explain mode: DOM labels over the focus view for the comet and the binary.
 * Static labels are placed once; moving ones follow the CPU mirrors of the
 * shaders (`cometState`, `binaryBodies`) on requestAnimationFrame, reading the
 * same cosmos clock the canvas uses, so they stay glued to the pixels. The
 * in-canvas guides (orbits, arrows, ghosts, lobe) are drawn by the objects
 * themselves when `explain` is on.
 */
export interface ExplainOverlayProps {
  id: "comet" | "binary";
  tile: Tile;
  width: number;
  height: number;
  seed: number;
  params: Params;
  cute: number;
}

interface LabelSpec {
  key: string;
  text: string;
  /** Object-box coordinates (-1..1) at time t; null = static (computed once). */
  at: (t: number) => [number, number];
  /** Label offset in px from the anchor. */
  dx?: number;
  dy?: number;
  tone?: "ink" | "accent" | "muted";
  /** Centre the text on the anchor (default) or hang it from its top-left corner. */
  align?: "center" | "corner";
  /** Hide the label at this time (e.g. a static marker the moving object is sitting on). */
  hide?: (t: number) => boolean;
}

export function ExplainOverlay({ id, tile, width, height, seed, params, cute }: ExplainOverlayProps) {
  const labels = useMemo<LabelSpec[]>(() => (id === "comet" ? cometLabels(seed, tile.size, params, cute) : binaryLabels(seed, tile.size, params, cute)), [id, seed, tile.size, params, cute]);
  const refs = useRef<Record<string, HTMLSpanElement | null>>({});

  useEffect(() => {
    let raf = 0;
    const place = () => {
      const t = cosmosClock.seconds;
      for (const l of labels) {
        const el = refs.current[l.key];
        if (!el) continue;
        const hidden = l.hide?.(t) ?? false;
        el.style.visibility = hidden ? "hidden" : "visible";
        if (hidden) continue;
        const [x, y] = l.at(t);
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        let left = width / 2 + tile.x + (x * tile.size) / 2 + (l.dx ?? 0) - (l.align === "corner" ? 0 : w / 2);
        let top = height / 2 - tile.y - (y * tile.size) / 2 + (l.dy ?? 0) - (l.align === "corner" ? 0 : h / 2);
        // Keep every label inside the stage so nothing is cut at the edges.
        left = Math.min(Math.max(4, left), width - w - 4);
        top = Math.min(Math.max(4, top), height - h - 4);
        el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [labels, tile, width, height]);

  return (
    <div className="cosmos-lab__explain" aria-live="off">
      {labels.map((l) => (
        <span
          key={l.key}
          ref={(el) => {
            refs.current[l.key] = el;
          }}
          className="cosmos-lab__explain-label"
          data-tone={l.tone ?? "ink"}
        >
          {l.text}
        </span>
      ))}
    </div>
  );
}

/** Colour legend for the explain view; the gallery shows it in the side panel so it never covers the object. */
export function ExplainLegend({ id }: { id: "comet" | "binary" }) {
  const legend = id === "comet" ? COMET_LEGEND : BINARY_LEGEND;
  return (
    <div className="cosmos-lab__explain-legend">
      {legend.map(([swatch, text]) => (
        <span key={text}>
          <i style={{ background: swatch } as CSSProperties} />
          {text}
        </span>
      ))}
    </div>
  );
}

const COMET_LEGEND: [string, string][] = [
  ["#ffd36a", "sun (the focus of the orbit)"],
  ["#5b5884", "orbit, dotted"],
  ["#ffffff", "nucleus (1 cell) + coma"],
  ["#8ad7ea", "velocity arrow v"],
  ["#e9a6c9", "-v: backwards along the path"],
  ["#6fb8ff", "ion tail: straight, exactly anti-sun"],
  ["#ffffff", "dust: white = young grains ..."],
  ["#e04a3a", "... red = old grains, pushed out"],
  ["#c9d6e6", "ghosts: where the nucleus WAS"],
];

const BINARY_LEGEND: [string, string][] = [
  ["#ffffff", "x barycentre: the point both circle"],
  ["#9b94b8", "donor's orbit (big, slow star, light)"],
  ["#8ad7ea", "accretor's orbit (small, hot, heavy)"],
  ["#f0a060", "Roche lobe: the donor's gravity border"],
  ["#ffd36a", "L1: the spill point between them"],
  ["#ffd36a", "stream: gas, bending forward (Coriolis)"],
  ["#8ad7ea", "arrows: velocities, same period"],
];

function cometLabels(seed: number, size: number, params: Params, cute: number): LabelSpec[] {
  const spec = generateComet(seed, size, Number(params.ecc), cute, params.guides !== "off", cometOverrides(params));
  const period = Number(params.period);
  const tailLen = Number(params.tail) * (1 - 0.2 * cute);
  const major: [number, number] = [Math.cos(spec.rot), Math.sin(spec.rot)];
  const aphelion: [number, number] = [spec.sun[0] - major[0] * spec.a * (1 + spec.e) * 1.12, spec.sun[1] - major[1] * spec.a * (1 + spec.e) * 1.12];
  const perihelion: [number, number] = [spec.sun[0] + major[0] * (spec.a * (1 - spec.e) + 0.16), spec.sun[1] + major[1] * (spec.a * (1 - spec.e) + 0.16)];
  const along = (t: number, k: number): [number, number] => {
    const s = cometState(spec, period, t);
    return [s.pos[0] + s.vel[0] * k, s.pos[1] + s.vel[1] * k];
  };
  const periPoint: [number, number] = [spec.sun[0] + major[0] * spec.a * (1 - spec.e), spec.sun[1] + major[1] * spec.a * (1 - spec.e)];
  return [
    { key: "sun", text: "sun", at: () => spec.sun, dx: 0, dy: 30, tone: "accent" },
    { key: "aph", text: "aphelion (far end of the orbit)", at: () => aphelion, tone: "muted" },
    {
      key: "peri",
      text: "perihelion (closest to the sun)",
      at: () => perihelion,
      tone: "muted",
      hide: (t) => {
        const p = cometState(spec, period, t).pos;
        return Math.hypot(p[0] - periPoint[0], p[1] - periPoint[1]) < 0.4;
      },
    },
    { key: "nuc", text: "nucleus", at: (t) => cometState(spec, period, t).pos, dy: -26 },
    { key: "vel", text: "v  (where it is going)", at: (t) => along(t, 0.56), tone: "accent" },
    { key: "rev", text: "-v  (where it came from)", at: (t) => along(t, -0.5), dy: -24, tone: "muted" },
    {
      key: "ion",
      text: "ion tail = anti-sun line",
      at: (t) => {
        const s = cometState(spec, period, t);
        const L = tailLength(tailLen, s.r) * 1.12;
        return [s.pos[0] + s.away[0] * L, s.pos[1] + s.away[1] * L];
      },
      tone: "accent",
    },
    { key: "dust", text: "dust tail: young -> old grains", at: (t) => dustSample(spec, period, tailLen, t, 0.8, 0).pos, dy: 24 },
    {
      key: "ghost",
      text: "ghosts: where the nucleus WAS",
      at: (t) => dustSample(spec, period, tailLen, t, 1, 0).emitted.pos,
      dy: 26,
      tone: "muted",
      // Far from the sun the comet barely moves in a grain-life, so the ghosts sit on the nucleus: say nothing then.
      hide: (t) => {
        const g = dustSample(spec, period, tailLen, t, 1, 0).emitted.pos;
        const n = cometState(spec, period, t).pos;
        return Math.hypot(g[0] - n[0], g[1] - n[1]) < 0.1;
      },
    },
  ];
}

function binaryLabels(seed: number, size: number, params: Params, cute: number): LabelSpec[] {
  const spec = generateBinary(seed, size, cute);
  const sep = Number(params.sep);
  const period = Number(params.period);
  const lay = binaryLayout(spec, sep, Number(params.fill));
  const rA = lay.rA * (1 + 0.15 * cute);
  const rB = lay.rB * (1 + 0.3 * cute);
  const l1 = l1FromDonor(spec, sep);
  const bodies = (t: number) => binaryBodies(spec, sep, period, t);
  return [
    { key: "bary", text: "barycentre (centre of mass)", at: () => [0, 0], dy: -20 },
    { key: "donor", text: `donor: puffy giant, ${spec.mA.toFixed(2)} M☉, orbit ${(lay.orbitA * 10).toFixed(1)} su`, at: (t) => bodies(t).A, dy: 22 + rA * size * 0.5 },
    { key: "acc", text: `accretor: compact + hot, ${spec.mB.toFixed(2)} M☉, orbit ${(lay.orbitB * 10).toFixed(1)} su`, at: (t) => bodies(t).B, dy: -30 - rB * size * 2 },
    {
      key: "l1",
      text: "L1: gas spills over here",
      at: (t) => {
        const b = bodies(t);
        return [b.A[0] + b.ab[0] * l1, b.A[1] + b.ab[1] * l1];
      },
      dy: 22,
      tone: "accent",
    },
    {
      key: "lobe",
      text: "Roche lobe (teardrop toward L1)",
      at: (t) => {
        const b = bodies(t);
        return [b.A[0], b.A[1] + rA * 1.15];
      },
      dy: -16,
      tone: "muted",
    },
    { key: "stream", text: "stream bends forward, lands on the disc's leading edge", at: (t) => streamPoint(bodies(t), rA, rB, 0.7), dy: -28, tone: "accent" },
    {
      key: "vA",
      text: "v",
      at: (t) => {
        const b = bodies(t);
        return [b.A[0] + b.vA[0] * 0.3, b.A[1] + b.vA[1] * 0.3];
      },
      tone: "accent",
    },
    {
      key: "vB",
      text: "v (slower: smaller orbit, same period)",
      at: (t) => {
        const b = bodies(t);
        const k = 0.3 * (lay.orbitB / lay.orbitA) + 0.2;
        return [b.B[0] + b.vB[0] * k, b.B[1] + b.vB[1] * k];
      },
      tone: "accent",
    },
    { key: "period", text: `one period = ${period.toFixed(1)} s for BOTH stars`, at: () => [0, -0.94], tone: "muted" },
  ];
}
