"use client";

import { useEffect, useRef } from "react";
import type { TwinLabel } from "@/lib/graph/twin/buffers";
import type { TwinController } from "./twin-controller";
import { domBaselineOffset, labelTop } from "./twin-text";

/**
 * Labels as positioned DOM text, mirroring the 2D canvas's `paintLabel`:
 * `textAlign` left / center becomes `left = x` or `x − width/2` with the width
 * the controller measured through Canvas2D; the 3 px halo stroke under the
 * fill is `-webkit-text-stroke` painted before the fill; and the vertical
 * anchor reproduces `textBaseline: "middle"` exactly: the span's top is chosen
 * so its baseline is the same float the canvas handed to Skia (canvas middle
 * offset measured per font, DOM baseline offset measured per font and size),
 * so both renderers snap the text to the same pixel row. The pool of spans is
 * reconciled imperatively per rebuilt frame (no React render per camera move).
 */
export function TwinLabels({ controller }: { controller: TwinController }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const pool: HTMLSpanElement[] = [];
    const domBaselines = new Map<string, number>();
    const baselineFor = (label: TwinLabel) => {
      const key = `${label.font}\u0000${label.size}`;
      let dom = domBaselines.get(key);
      if (dom === undefined) {
        dom = domBaselineOffset(root, label.font, label.size);
        domBaselines.set(key, dom);
      }
      return labelTop(label.y, controller.measurer.middleBaseline(label.font), dom);
    };
    const onFontsLoaded = () => domBaselines.clear();
    document.fonts?.addEventListener("loadingdone", onFontsLoaded);
    const unsubscribe = controller.subscribe((output) => {
      const labels = output?.labels.labels ?? [];
      const halo = output?.palette.halo ?? "transparent";
      while (pool.length < labels.length) {
        const span = document.createElement("span");
        span.className = "sg-twin-label";
        root.appendChild(span);
        pool.push(span);
      }
      for (let i = 0; i < pool.length; i += 1) {
        const span = pool[i];
        const label = labels[i];
        if (!label) {
          if (span.style.display !== "none") span.style.display = "none";
          continue;
        }
        paint(span, label, halo, baselineFor(label));
      }
    });
    return () => {
      unsubscribe();
      document.fonts?.removeEventListener("loadingdone", onFontsLoaded);
      for (const span of pool) span.remove();
    };
  }, [controller]);

  return <div ref={host} className="sg-twin-labels" aria-hidden />;
}

function paint(span: HTMLSpanElement, label: TwinLabel, halo: string, top: number): void {
  const left = label.align === "center" ? label.x - label.width / 2 : label.x;
  const s = span.style;
  if (span.textContent !== label.text) span.textContent = label.text;
  s.display = "";
  s.left = `${left}px`;
  s.top = `${top}px`;
  s.font = label.font;
  s.lineHeight = `${label.size}px`;
  s.height = `${label.size}px`;
  s.color = label.color;
  s.opacity = label.alpha === 1 ? "" : String(label.alpha);
  s.setProperty("-webkit-text-stroke", `3px ${halo}`);
  span.dataset.kind = label.kind;
  span.dataset.id = label.id;
}
