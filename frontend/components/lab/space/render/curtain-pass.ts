import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import { CopyShader } from "three/addons/shaders/CopyShader.js";

/**
 * Snapshot curtain + camera-space FX overlay, right after the layer pass.
 *
 * - `capture`: copy this frame's composed layers into the snapshot target
 *   (the stage refreshes it every frame while only trusted layers are on
 *   screen, so the curtain always holds the last good frame).
 * - `mix` < 1: show the snapshot instead of live geometry, zoomed about the
 *   centre by `zoom` and quantised to `pixel` device px, Bayer-dissolving to
 *   live as `mix` rises. Outside the zoomed snapshot the sky colour fills.
 * - `renderFx`: the streaks / cloud puffs are rendered into their own
 *   low-res target and composited OVER whatever is showing, so the loading
 *   tunnel keeps flowing while the curtain hides an unready layer.
 */
export class CurtainPass extends Pass {
  capture = false;
  mix = 1;
  zoom = 1;
  pixel = 2;
  readonly bg = new THREE.Color(0x000000);
  renderFx: ((renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) => void) | null = null;
  private readonly rtSnap: THREE.WebGLRenderTarget;
  private readonly rtFx: THREE.WebGLRenderTarget;
  private readonly quad: FullScreenQuad;
  private readonly material: THREE.ShaderMaterial;
  private readonly copy: FullScreenQuad;
  private readonly copyMaterial: THREE.ShaderMaterial;
  private width = 1;
  private height = 1;

  constructor() {
    super();
    const rt = (w: number, h: number) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    this.rtSnap = rt(1, 1);
    this.rtFx = rt(1, 1);
    this.copyMaterial = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms), vertexShader: CopyShader.vertexShader, fragmentShader: CopyShader.fragmentShader, depthTest: false, depthWrite: false });
    this.copy = new FullScreenQuad(this.copyMaterial);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tLive: { value: null },
        tSnap: { value: null },
        tFx: { value: null },
        uHasFx: { value: 0 },
        uMix: { value: 1 },
        uZoom: { value: 1 },
        uPix: { value: 2 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uBg: { value: new THREE.Color() },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tLive;
        uniform sampler2D tSnap;
        uniform sampler2D tFx;
        uniform float uHasFx;
        uniform float uMix;
        uniform float uZoom;
        uniform float uPix;
        uniform vec2 uRes;
        uniform vec3 uBg;
        varying vec2 vUv;
        float bayer2(vec2 q) { return q.x == 0.0 ? (q.y == 0.0 ? 0.0 : 3.0) : (q.y == 0.0 ? 2.0 : 1.0); }
        float bayer4(vec2 cell) {
          vec2 q = floor(mod(cell, 4.0));
          return (4.0 * bayer2(mod(q, 2.0)) + bayer2(floor(q / 2.0)) + 0.5) / 16.0;
        }
        void main() {
          vec4 col = texture2D(tLive, vUv);
          if (uMix < 1.0) {
            vec2 uv = (vUv - 0.5) / uZoom + 0.5;
            uv = (floor(uv * uRes / uPix) + 0.5) * uPix / uRes;
            bool outside = uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0;
            vec4 snap = outside ? vec4(uBg, 1.0) : texture2D(tSnap, uv);
            float th = bayer4(floor(gl_FragCoord.xy / uPix));
            col = uMix > th ? col : snap;
          }
          if (uHasFx > 0.5) {
            vec4 fx = texture2D(tFx, vUv);
            float a = clamp(fx.a, 0.0, 1.0);
            col.rgb = col.rgb * (1.0 - a) + fx.rgb;
          }
          gl_FragColor = col;
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.needsSwap = true;
  }

  override setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.rtSnap.setSize(width, height);
    (this.material.uniforms.uRes.value as THREE.Vector2).set(width, height);
  }

  /** Low-resolution size (cells) for the FX overlay, matching the pixel pass. */
  setFxSize(width: number, height: number): void {
    if (this.rtFx.width !== width || this.rtFx.height !== height) this.rtFx.setSize(Math.max(1, width), Math.max(1, height));
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    if (this.capture) {
      this.copyMaterial.uniforms.tDiffuse.value = readBuffer.texture;
      renderer.setRenderTarget(this.rtSnap);
      renderer.clear();
      this.copy.render(renderer);
      this.capture = false;
    }
    if (this.renderFx) this.renderFx(renderer, this.rtFx);
    const u = this.material.uniforms;
    u.tLive.value = readBuffer.texture;
    u.tSnap.value = this.rtSnap.texture;
    u.tFx.value = this.rtFx.texture;
    u.uHasFx.value = this.renderFx ? 1 : 0;
    u.uMix.value = this.mix;
    u.uZoom.value = Math.max(0.01, this.zoom);
    u.uPix.value = Math.max(1, this.pixel);
    (u.uBg.value as THREE.Color).copy(this.bg);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.rtSnap.dispose();
    this.rtFx.dispose();
    this.material.dispose();
    this.copyMaterial.dispose();
    this.quad.dispose();
    this.copy.dispose();
  }
}
