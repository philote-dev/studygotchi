import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import { RenderPixelatedPass } from "three/addons/postprocessing/RenderPixelatedPass.js";

/**
 * Two `RenderPixelatedPass` targets mixed by an ordered-dither threshold.
 *
 * `prepareA` / `prepareB` set layer visibility and the camera pose for the
 * outgoing and incoming layer before each sub-render. At mix 0 or 1 only one
 * pass runs (the resting cost is one pixel pass, as in the product). In
 * between, both render at the pixel resolution and a 4x4 Bayer matrix picks
 * per cell which target shows: a pixel dissolve, not a soft cross-fade.
 */
export class LayerPixelPass extends Pass {
  readonly a: RenderPixelatedPass;
  readonly b: RenderPixelatedPass;
  /** Low-resolution target size in cells (what point shaders snap to). */
  readonly resolution = new THREE.Vector2(1, 1);
  mix = 0;
  pixelSize = 2;
  prepareA: () => void = () => {};
  prepareB: () => void = () => {};
  /** Readiness warm-up: each entry prepares a layer that is rendered once into the offscreen B target this frame. */
  warmQueue: (() => void)[] = [];
  private readonly rtA: THREE.WebGLRenderTarget;
  private readonly rtB: THREE.WebGLRenderTarget;
  private readonly quad: FullScreenQuad;
  private readonly material: THREE.ShaderMaterial;
  private width = 1;
  private height = 1;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    super();
    const make = () => {
      const pass = new RenderPixelatedPass(this.pixelSize, scene, camera, { normalEdgeStrength: 0, depthEdgeStrength: 0 });
      // Numeric zero reads as "omitted" in the constructor; the sky wants no edge lines.
      pass.normalEdgeStrength = 0;
      pass.depthEdgeStrength = 0;
      pass.clear = true;
      return pass;
    };
    this.a = make();
    this.b = make();
    const rt = () =>
      new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    this.rtA = rt();
    this.rtB = rt();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tA: { value: null },
        tB: { value: null },
        uMix: { value: 0 },
        uPx: { value: 2 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tA;
        uniform sampler2D tB;
        uniform float uMix;
        uniform float uPx;
        varying vec2 vUv;
        float bayer2(vec2 q) { return q.x == 0.0 ? (q.y == 0.0 ? 0.0 : 3.0) : (q.y == 0.0 ? 2.0 : 1.0); }
        float bayer4(vec2 cell) {
          vec2 q = floor(mod(cell, 4.0));
          return (4.0 * bayer2(mod(q, 2.0)) + bayer2(floor(q / 2.0)) + 0.5) / 16.0;
        }
        void main() {
          float th = bayer4(floor(gl_FragCoord.xy / uPx));
          vec4 a = texture2D(tA, vUv);
          vec4 b = texture2D(tB, vUv);
          gl_FragColor = uMix > th ? b : a;
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  override setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.a.setSize(width, height);
    this.b.setSize(width, height);
    this.rtA.setSize(width, height);
    this.rtB.setSize(width, height);
    this.resolution.set(Math.max(1, Math.floor(width / this.pixelSize)), Math.max(1, Math.floor(height / this.pixelSize)));
  }

  setPixelSize(pixelSize: number): void {
    if (pixelSize === this.pixelSize) return;
    this.pixelSize = pixelSize;
    this.a.setPixelSize(pixelSize);
    this.b.setPixelSize(pixelSize);
    this.resolution.set(Math.max(1, Math.floor(this.width / pixelSize)), Math.max(1, Math.floor(this.height / pixelSize)));
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    if (this.warmQueue.length) {
      for (const prepare of this.warmQueue) {
        prepare();
        this.b.renderToScreen = false;
        this.b.render(renderer, this.rtB, readBuffer, 0, false);
      }
      this.warmQueue.length = 0;
    }
    if (this.mix <= 0 || this.mix >= 1) {
      const pass = this.mix <= 0 ? this.a : this.b;
      (this.mix <= 0 ? this.prepareA : this.prepareB)();
      pass.renderToScreen = this.renderToScreen;
      pass.render(renderer, writeBuffer, readBuffer, 0, false);
      return;
    }
    this.prepareA();
    this.a.renderToScreen = false;
    this.a.render(renderer, this.rtA, readBuffer, 0, false);
    this.prepareB();
    this.b.renderToScreen = false;
    this.b.render(renderer, this.rtB, readBuffer, 0, false);
    this.material.uniforms.tA.value = this.rtA.texture;
    this.material.uniforms.tB.value = this.rtB.texture;
    this.material.uniforms.uMix.value = this.mix;
    this.material.uniforms.uPx.value = this.pixelSize;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.a.dispose();
    this.b.dispose();
    this.rtA.dispose();
    this.rtB.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
