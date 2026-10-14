"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { landMeasure } from "@/lib/world/land-marks";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { RenderPixelatedPass } from "three/addons/postprocessing/RenderPixelatedPass.js";
import { planetPassFadeAt } from "../layers/galaxy/galaxy-rung-model";
import { planetFromWorldFadeAt, worldPassFadeAt } from "../layers/world/world-layer-model";
import { STAGE_UNIFORMS, stageClock, type StageTheme } from "../lib/uniforms";
import { useStage, useStageDirector } from "../StageContext";
import { cellDevicePx, hostDeviceSize, NATIVE_OBJECT_LAYER, nativePathWanted, PIXEL_OBJECT_LAYER, pixelTargetSize, REST_GRAIN_CSS_PX } from "./composer-model";

/**
 * Where a slotted layer's host element sits on the stage canvas, as fractions
 * of the canvas (x right, y down, CSS order), with the opacity its CSS
 * ancestors compose. The composer maps that layer's pass onto this box, so
 * every CSS motion the host still runs (the page's slide-in, the globe's
 * arrive / dive / rise keyframes, the leave phases) moves the layer exactly
 * as it moved the layer's own canvas.
 */
export interface HostViewport {
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
}

/**
 * A layer the composer renders with its own scene and camera through the
 * PIXEL path: a low-res target at the stage grain (`StageFrame.pixel` CSS px
 * per cell, the `RenderPixelatedPass` size), depth-tested, tone-mapped and
 * encoded like the globe canvas was, then nearest-upscaled over the sky
 * inside its host box.
 */
export interface PlanetPass {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  viewport: HostViewport | null;
}

/**
 * S4-1: the open land as a layer of the PIXEL path. Unlike the planet pass,
 * the land draws through its own `RenderPixelatedPass` (the stage grain plus
 * the land's `PixelComposer` normal / depth edge strengths) at the size of
 * its host box, then tone-maps, encodes and composites like the planet pass.
 * `frames` counts composited frames so the layer can report readiness after
 * the first.
 */
export interface WorldPass {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  normalEdgeStrength: number;
  depthEdgeStrength: number;
  viewport: HostViewport | null;
  frames: number;
  /**
   * The land's programs, compiled off the main thread (`renderer.compileAsync`,
   * `KHR_parallel_shader_compile`) before its first draw, so the cloud dive's
   * hold inside the deck waits on a parallel compile instead of a 2-3 s
   * synchronous one on the first composite. `null` until the composer has
   * started it; the pass is drawn (and reports ready) once it has resolved.
   */
  compiled: "pending" | "done" | null;
}

/** Mutable per-frame state the composer reads; layers and later slices write it. */
export interface StageFrame {
  theme: StageTheme;
  /**
   * The stage grain: CSS px per cell (integer) for every PIXEL-path pass (sky,
   * planet, world, clouds). 2 at rest (the globe's and the ice land's
   * `RenderPixelatedPass` size), 3 while a hop is fast (`HopDriver`). In CSS
   * px so the look is resolution-independent: `cellDevicePx` turns it into
   * device px per cell (2 at dpr 1, 4 at dpr 2).
   */
  pixel: number;
  /**
   * The sky colour (`--space-bg`, linear light) the low-res target is cleared
   * to at alpha 1, so soft light composites in linear light inside the target
   * like the lab's opaque canvas did, instead of as partial alpha over the page
   * (which the browser blends in sRGB and reads dimmer). The stage writes it
   * from the theme tokens the sky layer reads.
   */
  bg: THREE.Color;
  /** The planet layer's pass while the planet layer is mounted; null otherwise. */
  planet: PlanetPass | null;
  /** The world layer's pass while a land is open through the stage (S4-1); null otherwise. */
  world: WorldPass | null;
  /**
   * A layer asks for a warm pass (set true after it mounts or rebuilds its
   * materials): the composer's next frame compiles every registered layer with
   * its root forced visible and draws it once offscreen, so a hop never meets a
   * program compile (`renderer.info.programs` stays flat during a hop).
   */
  warm: boolean;
  /**
   * The hop: while the planet pass is faded out (the galaxy), still draw it
   * offscreen every `KEEP_WARM_EVERY` frames so materials the globe loads late
   * (terrain, towns, creatures) compile before the way down needs them.
   */
  keepWarm: boolean;
  /**
   * S4-2: cloud deck coverage on the lens, 0 clear .. 1 whole (`cloudDeckAt`),
   * written by the hop driver; the composer draws the deck last, over every
   * pass, so it masks the world -> planet swap. 0 with the hop off.
   */
  clouds: number;
  /** The spring velocity (L/s) the deck streams past the lens with. */
  cloudFlow: number;
  /**
   * The planet and world passes' opacities this frame, written by the hop
   * driver (their altitude bands, or the reduced-motion crossfade). Null when
   * no driver runs (a lab preview): the composer then reads the bands itself.
   */
  planetFade: number | null;
  worldFade: number | null;
}

export const KEEP_WARM_EVERY = 24;

const scratch = new THREE.Vector2();
const toNativeLayer = (o: THREE.Object3D): void => {
  o.layers.set(NATIVE_OBJECT_LAYER);
};

/** `--space-bg` per theme (globals.css), the fallback until the stage resolves the live token. */
const BG_FALLBACK: Record<StageTheme, string> = { dark: "rgb(8, 7, 22)", light: "rgb(207, 214, 228)" };

export function createStageFrame(theme: StageTheme): StageFrame {
  return { theme, pixel: REST_GRAIN_CSS_PX, bg: new THREE.Color(BG_FALLBACK[theme]), planet: null, world: null, warm: false, keepWarm: false, clouds: 0, cloudFlow: 0, planetFade: null, worldFade: null };
}


const UPSCALE = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  // The target holds premultiplied linear light over a transparent clear. Un-premultiply, encode
  // to sRGB, re-premultiply: the browser composites a premultiplied canvas over the CSS sky.
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float a = clamp(c.a, 0.0, 1.0);
      vec3 straight = a > 1e-4 ? clamp(c.rgb / a, 0.0, 1.0) : vec3(0.0);
      gl_FragColor = vec4(straight, a);
      #include <colorspace_fragment>
      gl_FragColor.rgb *= gl_FragColor.a;
    }
  `,
};

/**
 * The NATIVE path's first draw: the low-res sky target nearest-upscaled into
 * the device-resolution target, linear light to linear light, so the galaxy
 * then renders over the very same sky it used to render into, at device
 * resolution instead of cell resolution. The screen quad above encodes the
 * result exactly as it encodes the low-res target, so with nothing on the
 * native path the two routes are the same bytes.
 */
const COPY = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
  },
  vertexShader: UPSCALE.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() { gl_FragColor = texture2D(tDiffuse, vUv); }
  `,
};

/**
 * The planet pass's screen quad: the globe canvas's `RenderPixelatedPass` +
 * `OutputPass` in one draw. Nearest-sample the cell target inside the host
 * box, ACES-filmic tone-map and sRGB-encode like OutputPass did for the
 * globe's own (non-flat) canvas, then composite premultiplied over the sky,
 * which is what the browser did with the globe canvas over the sky canvas.
 */
const PLANET_UPSCALE = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    /** Host box in GL uv: x, y of the bottom-left corner, then width and height. */
    uHost: { value: new THREE.Vector4(0, 0, 1, 1) },
    uOpacity: { value: 1 },
    toneMappingExposure: { value: 1 },
  },
  vertexShader: UPSCALE.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec4 uHost;
    uniform float uOpacity;
    varying vec2 vUv;
    #include <tonemapping_pars_fragment>
    void main() {
      vec2 uv = (vUv - uHost.xy) / uHost.zw;
      if (uv.x < 0.0 || uv.x >= 1.0 || uv.y < 0.0 || uv.y >= 1.0) discard;
      vec4 c = texture2D(tDiffuse, uv);
      c.rgb = ACESFilmicToneMapping(c.rgb);
      gl_FragColor = c;
      #include <colorspace_fragment>
      gl_FragColor *= uOpacity;
    }
  `,
};

/**
 * The cloud deck (S4-2): a screen quad of pixel-art cloud at the stage grain.
 * Per cell, a value-noise field is thresholded by the coverage: as the
 * coverage rises the puffs grow from their seeds and merge until, at 1, every
 * cell is cloud; a second, higher threshold lights the tops. The field drifts
 * down the screen while the camera climbs (and up on the way down), at the
 * spring's speed. Drawn in sRGB straight to the screen with binary alpha, so
 * it never blends with what it hides. Colours per theme: the ice land's fair /
 * night clouds.
 */
const CLOUD_DECK = {
  uniforms: {
    uCover: { value: 0 },
    /** Device px per cell, and the canvas size in device px. */
    uPixel: { value: 2 },
    uSize: { value: new THREE.Vector2(1, 1) },
    uScroll: { value: 0 },
    uLit: { value: new THREE.Color("#ffffff") },
    uBody: { value: new THREE.Color("#eef2f8") },
    uShade: { value: new THREE.Color("#cdd6e4") },
  },
  vertexShader: UPSCALE.vertexShader,
  fragmentShader: /* glsl */ `
    uniform float uCover;
    uniform float uPixel;
    uniform vec2 uSize;
    uniform float uScroll;
    uniform vec3 uLit;
    uniform vec3 uBody;
    uniform vec3 uShade;
    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float fbm(vec2 p) {
      float v = 0.0;
      float amp = 0.5;
      for (int i = 0; i < 4; i++) {
        v += amp * vnoise(p);
        p = p * 2.03 + vec2(17.1, 9.7);
        amp *= 0.5;
      }
      return v;
    }
    void main() {
      // The cell this fragment belongs to, in cells; the deck is drawn in cells so it shares the stage grain.
      vec2 cell = floor(gl_FragCoord.xy / uPixel);
      float cellsAcross = uSize.x / uPixel;
      vec2 p = cell / cellsAcross;
      // Two drifting octaves of puffs; the scroll runs along y (the climb). fbm of value noise
      // lives mostly in 0.3 .. 0.7: stretched to 0 .. 1 so the coverage reads as a cell fraction.
      float raw = fbm(p * 5.0 + vec2(0.0, uScroll)) * 0.76 + fbm(p * 12.0 - vec2(uScroll * 0.6, uScroll * 1.7)) * 0.24;
      float n = smoothstep(0.3, 0.7, raw);
      // Coverage 0 -> no cell passes; 1 -> every cell passes.
      float threshold = 1.001 - uCover * 1.002;
      if (n < threshold) discard;
      // Three tones from the same field (shadowed underside, body, lit top), so the deck keeps
      // its texture at full coverage instead of going flat.
      float body = step(max(threshold + 0.14, 0.34), n);
      float lit = step(max(threshold + 0.34, 0.66), n);
      vec3 c = mix(uShade, mix(uBody, uLit, lit), body);
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }
  `,
};

/** The deck's colours per theme: the ice land's fair-weather clouds by day, its night clouds after dark. */
export const CLOUD_DECK_COLOURS: Record<StageTheme, { lit: string; body: string; shade: string }> = {
  light: { lit: "#ffffff", body: "#eef2f8", shade: "#cdd6e4" },
  dark: { lit: "#6d78a8", body: "#4f5884", shade: "#363c63" },
};

/**
 * The stage compositor, two paths (`composer-model.ts`):
 *
 * PIXEL path. The root scene (sky, hop streaks, constellation scenery) renders
 * into a low-resolution half-float target at the stage grain (`frame.pixel`
 * CSS px per cell, 2 at rest), the planet pass into a depth-buffered target at
 * the same grain, the world pass through its own `RenderPixelatedPass` (with
 * the ice land's edge outlines) at the same grain inside its host box, and the
 * cloud deck in cells; each is nearest-upscaled to the screen. This is the
 * `RenderPixelatedPass` look the globe and the ice land shipped with, and the
 * canvas stays transparent so the CSS `--space-bg` behind it is the sky colour.
 *
 * NATIVE path. While the galaxy rung is shown, its subtree (object layer 1)
 * is skipped by the sky render and drawn instead at device resolution into a
 * native target that first receives the upscaled sky, so its points are crisp
 * glyphs and its glows smooth; the screen quad then encodes that target 1:1.
 * With the galaxy hidden the screen quad reads the low-res target directly:
 * the same bytes, no extra target. The constellation twin is its own
 * full-resolution canvas and never passes through here.
 *
 * S2 added the planet pass (the only globe path since gate 1, 2026-10-13):
 * when the planet layer has registered its scene and camera on the frame, the
 * composer renders and composites them over the sky inside the globe host's
 * box. Nothing runs when it is not (/knowledge without the hop). The grain is
 * in CSS px, so a dpr drop from the stage's `PerformanceMonitor` leaves the
 * cell count and the cell's CSS size alone (`planetPassGrain`).
 */
export function StageComposer({ frame, onReady }: { frame: React.RefObject<StageFrame>; onReady?: () => void }) {
  const { gl, scene, camera, size, viewport } = useThree();
  const { registry } = useStage();
  const director = useStageDirector();
  const frames = useRef(0);
  const bundle = useMemo(() => {
    const rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(UPSCALE.uniforms),
      vertexShader: UPSCALE.vertexShader,
      fragmentShader: UPSCALE.fragmentShader,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      transparent: false,
    });
    const quad = new FullScreenQuad(material);
    // Native path: the device-resolution target (sky copied in, galaxy drawn over) and the copy quad.
    const nativeRt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    const copyMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(COPY.uniforms),
      vertexShader: COPY.vertexShader,
      fragmentShader: COPY.fragmentShader,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      transparent: false,
      toneMapped: false,
    });
    const copyQuad = new FullScreenQuad(copyMaterial);
    // Planet pass: the globe's beauty target (HalfFloat, nearest, with depth) and its screen quad.
    const planetRt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    const planetMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(PLANET_UPSCALE.uniforms),
      vertexShader: PLANET_UPSCALE.vertexShader,
      fragmentShader: PLANET_UPSCALE.fragmentShader,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      // Premultiplied "over": One, OneMinusSrcAlpha for colour and alpha.
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
      toneMapped: false,
    });
    const planetQuad = new FullScreenQuad(planetMaterial);
    // World pass (S4-1): the land's own pixel pass (beauty + normal targets inside it) writes
    // into a host-sized target, then the same tone-map / encode / host-box quad as the planet.
    const worldPixel = new RenderPixelatedPass(2, new THREE.Scene(), new THREE.PerspectiveCamera());
    const worldRt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    const worldMaterial = planetMaterial.clone();
    const worldQuad = new FullScreenQuad(worldMaterial);
    // Cloud deck (S4-2): opaque cells or nothing (discard), so no blending state matters.
    const cloudMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(CLOUD_DECK.uniforms),
      vertexShader: CLOUD_DECK.vertexShader,
      fragmentShader: CLOUD_DECK.fragmentShader,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
    const cloudQuad = new FullScreenQuad(cloudMaterial);
    return {
      rt,
      material,
      quad,
      w: 0,
      h: 0,
      px: 0,
      nativeRt,
      copyMaterial,
      copyQuad,
      nw: 0,
      nh: 0,
      planetRt,
      planetMaterial,
      planetQuad,
      pw: 0,
      ph: 0,
      worldPixel,
      worldRt,
      worldMaterial,
      worldQuad,
      ww: 0,
      wh: 0,
      cloudMaterial,
      cloudQuad,
      cloudScroll: 0,
    };
  }, []);

  useEffect(
    () => () => {
      bundle.rt.dispose();
      bundle.material.dispose();
      bundle.quad.dispose();
      bundle.nativeRt.dispose();
      bundle.copyMaterial.dispose();
      bundle.copyQuad.dispose();
      bundle.planetRt.dispose();
      bundle.planetMaterial.dispose();
      bundle.planetQuad.dispose();
      bundle.worldPixel.dispose();
      bundle.worldRt.dispose();
      bundle.worldMaterial.dispose();
      bundle.worldQuad.dispose();
      bundle.cloudMaterial.dispose();
      bundle.cloudQuad.dispose();
    },
    [bundle],
  );

  /** The deck's screen quad: coverage, grain, canvas size, scroll and the theme's colours. */
  function drawClouds(f: StageFrame, cover: number): void {
    const u = bundle.cloudMaterial.uniforms;
    u.uCover.value = cover;
    u.uPixel.value = bundle.px || Math.max(1, Math.round(f.pixel * viewport.dpr));
    (u.uSize.value as THREE.Vector2).set(size.width * viewport.dpr, size.height * viewport.dpr);
    u.uScroll.value = bundle.cloudScroll;
    const colours = CLOUD_DECK_COLOURS[f.theme];
    (u.uLit.value as THREE.Color).set(colours.lit);
    (u.uBody.value as THREE.Color).set(colours.body);
    (u.uShade.value as THREE.Color).set(colours.shade);
    bundle.cloudQuad.render(gl);
  }

  /** The sky target at the stage grain; `uRes` is its size in cells (the grid every pixel-path shader snaps to). */
  function fit(pixelCss: number): number {
    const { cell, w, h } = pixelTargetSize(size.width, size.height, viewport.dpr, pixelCss);
    if (w !== bundle.w || h !== bundle.h) {
      bundle.rt.setSize(w, h);
      bundle.w = w;
      bundle.h = h;
    }
    bundle.px = cell;
    STAGE_UNIFORMS.uRes.value.set(w, h);
    return cell;
  }

  /** The planet target at the stage grain: `RenderPixelatedPass.setSize` on the canvas's device size, `(size / cell) | 0`. */
  function fitPlanet(pixelCss: number): void {
    const { w, h } = pixelTargetSize(size.width, size.height, viewport.dpr, pixelCss);
    if (w !== bundle.pw || h !== bundle.ph) {
      bundle.planetRt.setSize(w, h);
      bundle.pw = w;
      bundle.ph = h;
    }
  }

  /**
   * The land's `PixelComposer` sized to its host: `composer.setSize(hostCss) at dpr` ->
   * `RenderPixelatedPass.setSize(hostCss * dpr)`, whose cell grid is `(size / cell) | 0`
   * with the stage grain as the cell.
   */
  function fitWorld(world: WorldPass, box: HostViewport, pixelCss: number): void {
    const { w, h } = hostDeviceSize(box, size.width, size.height, viewport.dpr);
    const cell = cellDevicePx(pixelCss, viewport.dpr);
    const pass = bundle.worldPixel;
    if (w !== bundle.ww || h !== bundle.wh || pass.pixelSize !== cell) {
      pass.pixelSize = cell;
      pass.setSize(w, h);
      bundle.worldRt.setSize(w, h);
      bundle.ww = w;
      bundle.wh = h;
    }
    pass.scene = world.scene;
    pass.camera = world.camera;
    pass.normalEdgeStrength = world.normalEdgeStrength;
    pass.depthEdgeStrength = world.depthEdgeStrength;
  }

  /** The native target at the canvas's drawing-buffer size (device px), so the screen quad reads it 1:1. */
  function fitNative(): void {
    const v = gl.getDrawingBufferSize(scratch);
    const w = Math.max(1, v.x | 0);
    const h = Math.max(1, v.y | 0);
    if (w !== bundle.nw || h !== bundle.nh) {
      bundle.nativeRt.setSize(w, h);
      bundle.nw = w;
      bundle.nh = h;
    }
  }

  /** The galaxy's root while a galaxy layer is registered. Its subtree is kept on the native object layer. */
  function galaxyRoot(): THREE.Object3D | null {
    const root = registry.layers.get("galaxy") ?? null;
    if (root) root.traverse(toNativeLayer);
    return root;
  }

  /** Visible, and so are all its ancestors (the rung root gates the layer below its altitude band). */
  function shown(o: THREE.Object3D): boolean {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  /**
   * The native path: the low-res sky copied into the device-resolution target
   * (nearest, linear light), then the galaxy subtree drawn over it with its
   * own blending, one cell = `px` device px for its point sizes.
   */
  function drawNative(px: number): void {
    fitNative();
    gl.setRenderTarget(bundle.nativeRt);
    bundle.copyMaterial.uniforms.tDiffuse.value = bundle.rt.texture;
    bundle.copyQuad.render(gl);
    STAGE_UNIFORMS.uCellPx.value = px;
    camera.layers.set(NATIVE_OBJECT_LAYER);
    gl.autoClear = false;
    gl.render(scene, camera);
    gl.autoClear = true;
    camera.layers.set(PIXEL_OBJECT_LAYER);
    STAGE_UNIFORMS.uCellPx.value = 1;
  }

  // Pre-warm at mount: compile every program and draw once offscreen so the first visible frame
  // has no shader stall.
  useLayoutEffect(() => {
    const f = frame.current;
    fit(f?.pixel ?? REST_GRAIN_CSS_PX);
    STAGE_UNIFORMS.uLight.value = f?.theme === "light" ? 1 : 0;
    STAGE_UNIFORMS.uCellPx.value = 1;
    camera.layers.set(PIXEL_OBJECT_LAYER);
    gl.compile(scene, camera);
    if (f) gl.setClearColor(f.bg, 1);
    gl.setRenderTarget(bundle.rt);
    gl.render(scene, camera);
    gl.setClearColor(0x000000, 0);
    gl.setRenderTarget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The clock advances first so every layer reads the same time this frame.
  useFrame((_, delta) => {
    stageClock.advance(delta);
    STAGE_UNIFORMS.uTime.value = stageClock.seconds;
    // The deck streams past the lens at the spring's speed (plus a slow drift so it never freezes).
    const f = frame.current;
    if (f && f.clouds > 0) bundle.cloudScroll += Math.min(delta, 0.1) * (0.35 + Math.abs(f.cloudFlow) * 1.6) * (f.cloudFlow < 0 ? -1 : 1);
  }, -10);

  /**
   * Warm pass: every registered layer root forced visible, programs compiled, one
   * offscreen draw of the root scene (and the planet scene), visibility restored.
   * Nothing reaches the screen; the normal frame below overwrites both targets.
   */
  function warm(f: StageFrame): void {
    const hidden: THREE.Object3D[] = [];
    const show = (o: THREE.Object3D) => {
      if (!o.visible) {
        o.visible = true;
        hidden.push(o);
      }
    };
    for (const root of registry.layers.values()) {
      // The registered root, everything under it, and the ancestors that gate it (a rung group
      // hidden below its band): `compile` and `render` only see the visible tree.
      root.traverse(show);
      for (let p = root.parent; p; p = p.parent) show(p);
    }
    const px = fit(f.pixel);
    const galaxy = galaxyRoot();
    STAGE_UNIFORMS.uLight.value = f.theme === "light" ? 1 : 0;
    STAGE_UNIFORMS.uCellPx.value = 1;
    camera.layers.set(PIXEL_OBJECT_LAYER);
    gl.compile(scene, camera);
    gl.setClearColor(f.bg, 1);
    gl.setRenderTarget(bundle.rt);
    gl.render(scene, camera);
    gl.setClearColor(0x000000, 0);
    // The native path (the galaxy over the copied sky): its copy program and one draw of the galaxy
    // at device resolution, so the first frame of the galaxy band never meets a compile.
    if (galaxy) drawNative(px);
    const planet = f.planet;
    if (planet) {
      fitPlanet(f.pixel);
      gl.compile(planet.scene, planet.camera);
      gl.setRenderTarget(bundle.planetRt);
      gl.render(planet.scene, planet.camera);
      // The planet's own screen quad (tone-map + encode) compiles at its first composite: draw it
      // once to the screen at opacity 0 (the output colour space is part of the program key, so
      // it must be the screen) so a planet that starts hidden (the galaxy) does not compile it on
      // the way down. The frame below clears the screen before compositing.
      const u = bundle.planetMaterial.uniforms;
      u.tDiffuse.value = bundle.planetRt.texture;
      u.uOpacity.value = 0;
      gl.setRenderTarget(null);
      gl.autoClear = false;
      bundle.planetQuad.render(gl);
      gl.autoClear = true;
    }
    // The cloud deck's program: one draw at coverage 0 (every fragment discards) to the screen.
    gl.setRenderTarget(null);
    gl.autoClear = false;
    drawClouds(f, 0);
    gl.autoClear = true;
    for (const o of hidden) o.visible = false;
  }

  useFrame(() => {
    const f = frame.current;
    if (!f) return;
    if (f.warm) {
      f.warm = false;
      warm(f);
    }
    // Main pass: the root scene (sky, and any layer a preview mounts there) at the stage grain,
    // over an opaque clear in the sky colour so every layer's soft light composites in linear
    // light inside the target. Skipped when nothing lives in it (the planet-only stage keeps the
    // 2D sky underneath and the canvas stays transparent).
    const sky = scene.children.length > 0 || registry.layers.has("sky");
    // NATIVE path wanted: the galaxy subtree is shown this frame (its rung root is visible).
    const galaxy = galaxyRoot();
    const native = sky && nativePathWanted(galaxy !== null && shown(galaxy));
    if (sky) {
      const px = fit(f.pixel);
      STAGE_UNIFORMS.uLight.value = f.theme === "light" ? 1 : 0;
      STAGE_UNIFORMS.uCellPx.value = 1;
      camera.layers.set(PIXEL_OBJECT_LAYER);
      gl.setClearColor(f.bg, 1);
      gl.setRenderTarget(bundle.rt);
      gl.render(scene, camera);
      gl.setClearColor(0x000000, 0);
      if (native) drawNative(px);
    }
    // Planet pass: the globe's scene with its own camera at its own grain, depth on, over a
    // transparent clear (the globe's own canvas was transparent over the sky).
    const planet = f.planet;
    const planetBox = planet?.viewport ?? null;
    // The planet pass's opacity: the hop driver's (its altitude band above the planet, the world swap
    // under the cloud deck, the crossfade under reduced motion), or the bands read here when no
    // driver runs (a lab preview).
    const L = director.sample().L;
    const planetFade = f.planetFade ?? planetPassFadeAt(L) * planetFromWorldFadeAt(L);
    const drawPlanet = planet !== null && planetBox !== null && planetBox.opacity * planetFade > 0;
    if (planet && (drawPlanet || (f.keepWarm && planetBox !== null && frames.current % KEEP_WARM_EVERY === 0))) {
      fitPlanet(f.pixel);
      gl.setRenderTarget(bundle.planetRt);
      gl.render(planet.scene, planet.camera);
    }
    // World pass (S4-1): the open land through its own pixel pass, at its host's size, over the
    // land scene's own background (SkyBlend owns `scene.background`; the land canvas was opaque).
    const world = f.world;
    // A land that just registered: compile its programs in parallel first (the dive holds in the
    // clouds meanwhile); `compileAsync` falls back to a synchronous compile where the extension is
    // missing, which is no worse than the first draw was.
    if (world && world.compiled === null) {
      world.compiled = "pending";
      const t0 = performance.now();
      void gl.compileAsync(world.scene, world.camera).then(
        () => {
          landMeasure("compile", t0, performance.now());
          if (f.world === world) world.compiled = "done";
        },
        () => {
          landMeasure("compile", t0, performance.now());
          world.compiled = "done";
        },
      );
    }
    const worldBox = world?.viewport ?? null;
    const worldFade = f.worldFade ?? worldPassFadeAt(L);
    const drawWorld = world !== null && world.compiled === "done" && worldBox !== null && worldBox.opacity * worldFade > 0;
    if (world && worldBox && drawWorld) {
      fitWorld(world, worldBox, f.pixel);
      gl.autoClear = true;
      // (readBuffer, deltaTime and maskActive are unused by this pass; the types want them.)
      bundle.worldPixel.render(gl, bundle.worldRt, bundle.worldRt, 0, false);
      world.frames++;
    }
    // Screen: clear once, then composite the passes in order. `renderer.render` clears the target
    // whenever autoClear is on, so it is off for the quads (a second quad would wipe the first).
    gl.setRenderTarget(null);
    gl.clear(true, false, false);
    gl.autoClear = false;
    if (sky) {
      // The screen reads the native target (sky + galaxy at device resolution) or the low-res sky directly.
      bundle.material.uniforms.tDiffuse.value = native ? bundle.nativeRt.texture : bundle.rt.texture;
      bundle.quad.render(gl);
    }
    if (planetBox && drawPlanet) {
      const v = planetBox;
      const u = bundle.planetMaterial.uniforms;
      u.tDiffuse.value = bundle.planetRt.texture;
      (u.uHost.value as THREE.Vector4).set(v.x, 1 - (v.y + v.h), v.w, v.h);
      u.uOpacity.value = v.opacity * planetFade;
      bundle.planetQuad.render(gl);
    }
    if (worldBox && drawWorld) {
      const v = worldBox;
      const u = bundle.worldMaterial.uniforms;
      u.tDiffuse.value = bundle.worldRt.texture;
      (u.uHost.value as THREE.Vector4).set(v.x, 1 - (v.y + v.h), v.w, v.h);
      u.uOpacity.value = v.opacity * worldFade;
      bundle.worldQuad.render(gl);
    }
    // The cloud deck over everything (S4-2): the mask for the world -> planet swap.
    if (f.clouds > 0) drawClouds(f, f.clouds);
    gl.autoClear = true;
    frames.current++;
    if (frames.current === 12) onReady?.();
  }, 1);

  return null;
}
