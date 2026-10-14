"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";

/**
 * Frame-time instrumentation for the stage (ported from the space lab's
 * PerfOverlay). `StagePerfProbe` lives inside the Canvas: it brackets each
 * frame with two `useFrame` subscribers (first and last priority), measures
 * the presented frame interval, the JS time of the frame, draw calls and
 * points (renderer.info with autoReset off so every pass counts), and, when
 * `EXT_disjoint_timer_query_webgl2` is available, the GPU time of the frame.
 * `StagePerfOverlay` (DOM, outside the Canvas) polls the shared sink and
 * `window.__stagePerf` exposes stats / reset for the capture harness.
 */
export interface StagePerfSample {
  t: number;
  dt: number;
  js: number;
  gpu: number | null;
  calls: number;
  points: number;
  programs: number;
}

export interface StagePerfStats {
  frames: number;
  mean: number;
  p95: number;
  max: number;
  js: number;
  gpuMean: number | null;
  gpuP95: number | null;
  calls: number;
  points: number;
  programs: number;
  refreshMs: number;
  dropped: number;
}

export interface StagePerfSink {
  live: StagePerfSample[];
  refreshMs: number;
}

export function createStagePerfSink(): StagePerfSink {
  return { live: [], refreshMs: 16.67 };
}

const LIVE_WINDOW_MS = 2000;

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function estimateRefreshMs(samples: readonly StagePerfSample[]): number {
  const dts = samples.map((s) => s.dt).filter((d) => d > 2 && d < 100);
  if (dts.length < 8) return 16.67;
  const med = percentile(dts, 50);
  if (Math.abs(med - 8.33) < 1.2) return 8.33;
  if (Math.abs(med - 16.67) < 2.5) return 16.67;
  return med;
}

export function computeStats(samples: readonly StagePerfSample[], refreshMs: number): StagePerfStats {
  const dts = samples.map((s) => s.dt);
  const gpus = samples.map((s) => s.gpu).filter((g): g is number => g !== null);
  const last = samples[samples.length - 1];
  const mean = dts.length ? dts.reduce((a, b) => a + b, 0) / dts.length : 0;
  let dropped = 0;
  for (const d of dts) if (d > refreshMs * 1.5) dropped += Math.max(1, Math.round(d / refreshMs) - 1);
  return {
    frames: samples.length,
    mean,
    p95: percentile(dts, 95),
    max: dts.length ? Math.max(...dts) : 0,
    js: samples.length ? samples.reduce((a, s) => a + s.js, 0) / samples.length : 0,
    gpuMean: gpus.length ? gpus.reduce((a, b) => a + b, 0) / gpus.length : null,
    gpuP95: gpus.length ? percentile(gpus, 95) : null,
    calls: last?.calls ?? 0,
    points: last?.points ?? 0,
    programs: last?.programs ?? 0,
    refreshMs,
    dropped,
  };
}

export interface StagePerfApi {
  stats: () => StagePerfStats;
  reset: () => void;
}

declare global {
  interface Window {
    __stagePerf?: StagePerfApi;
  }
}

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export function StagePerfProbe({ sink }: { sink: RefObject<StagePerfSink> }) {
  const { gl } = useThree();
  const frameStart = useRef(0);
  const prevStart = useRef(0);
  const timer = useRef<{ ext: TimerExt; ctx: WebGL2RenderingContext; active: WebGLQuery | null; pending: WebGLQuery[]; last: number | null } | null>(null);

  useEffect(() => {
    gl.info.autoReset = false;
    const ctx = gl.getContext();
    if (ctx instanceof WebGL2RenderingContext) {
      const ext = ctx.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExt | null;
      if (ext) timer.current = { ext, ctx, active: null, pending: [], last: null };
    }
    return () => {
      gl.info.autoReset = true;
      const t = timer.current;
      if (t) {
        for (const q of t.pending) t.ctx.deleteQuery(q);
        timer.current = null;
      }
    };
  }, [gl]);

  useEffect(() => {
    const api: StagePerfApi = {
      stats: () => {
        const s = sink.current;
        return s ? computeStats(s.live, s.refreshMs) : computeStats([], 16.67);
      },
      reset: () => {
        const s = sink.current;
        if (s) s.live = [];
      },
    };
    window.__stagePerf = api;
    return () => {
      if (window.__stagePerf === api) delete window.__stagePerf;
    };
  }, [sink]);

  // First subscriber of the frame.
  useFrame(() => {
    frameStart.current = performance.now();
    gl.info.reset();
    const t = timer.current;
    if (t && !t.active && t.pending.length < 4) {
      const q = t.ctx.createQuery();
      if (q) {
        t.ctx.beginQuery(t.ext.TIME_ELAPSED_EXT, q);
        t.active = q;
      }
    }
  }, -1000);

  // Last subscriber of the frame: everything (composer included) has run.
  useFrame(() => {
    const s = sink.current;
    const now = performance.now();
    const t = timer.current;
    if (t && t.active) {
      t.ctx.endQuery(t.ext.TIME_ELAPSED_EXT);
      t.pending.push(t.active);
      t.active = null;
    }
    if (t && t.pending.length) {
      const q = t.pending[0];
      const available = t.ctx.getQueryParameter(q, t.ctx.QUERY_RESULT_AVAILABLE) as boolean;
      const disjoint = t.ctx.getParameter(t.ext.GPU_DISJOINT_EXT) as boolean;
      if (available) {
        if (!disjoint) t.last = (t.ctx.getQueryParameter(q, t.ctx.QUERY_RESULT) as number) / 1e6;
        t.ctx.deleteQuery(q);
        t.pending.shift();
      }
    }
    if (!s) return;
    const start = frameStart.current;
    const dt = prevStart.current > 0 ? start - prevStart.current : 16.67;
    prevStart.current = start;
    s.live.push({
      t: start,
      dt,
      js: now - start,
      gpu: t?.last ?? null,
      calls: gl.info.render.calls,
      points: gl.info.render.points,
      programs: gl.info.programs?.length ?? 0,
    });
    while (s.live.length && start - s.live[0].t > LIVE_WINDOW_MS) s.live.shift();
    if (s.live.length >= 16 && s.live.length % 16 === 0) s.refreshMs = estimateRefreshMs(s.live);
  }, 1000);

  return null;
}

/** DOM overlay (bottom-left): ms/frame, p95, dropped, JS, GPU, draw calls, points. */
export function StagePerfOverlay({ sink }: { sink: RefObject<StagePerfSink> }) {
  const [stats, setStats] = useState<StagePerfStats | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      const s = sink.current;
      if (s) setStats(computeStats(s.live, s.refreshMs));
    }, 250);
    return () => clearInterval(id);
  }, [sink]);
  if (!stats) return null;
  const over = stats.mean > stats.refreshMs * 1.1;
  return (
    <div className="sg-stage-perf" data-over={over ? "1" : "0"} aria-label="Stage frame-time overlay">
      <span>
        <strong>{stats.mean.toFixed(1)}</strong> ms/frame
      </span>
      <span>
        p95 <strong>{stats.p95.toFixed(1)}</strong> · dropped <strong>{stats.dropped}</strong>
        <small>/{(1000 / stats.refreshMs).toFixed(0)} Hz</small>
      </span>
      <span>
        js <strong>{stats.js.toFixed(2)}</strong>
      </span>
      <span>
        gpu <strong>{stats.gpuMean === null ? "n/a" : stats.gpuMean.toFixed(2)}</strong>
      </span>
      <span>
        calls <strong>{stats.calls}</strong>
      </span>
      <span>
        pts <strong>{(stats.points / 1000).toFixed(1)}k</strong>
      </span>
      <span>
        programs <strong>{stats.programs}</strong>
      </span>
    </div>
  );
}
