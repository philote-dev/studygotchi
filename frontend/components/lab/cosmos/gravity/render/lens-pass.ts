import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import { RenderPixelatedPass } from "three/addons/postprocessing/RenderPixelatedPass.js";
import { MAX_LENSES, type GravityFrame } from "../lib/frame";

/** Scene layer for the shared sky (warped by the lens). */
export const SKY_LAYER = 0;
/** Scene layer for gravity objects (drawn over the warped sky, never warped themselves). */
export const OBJECT_LAYER = 1;

/**
 * `RenderPixelatedPass` restricted to the sky layer, so the lens only ever
 * bends stars, never the discs, cores and rims drawn on top.
 */
export class SkyPixelPass extends RenderPixelatedPass {
  constructor(pixelSize: number, scene: THREE.Scene, camera: THREE.Camera) {
    super(pixelSize, scene, camera, { normalEdgeStrength: 0, depthEdgeStrength: 0 });
    // Numeric zero reads as "omitted" in the constructor; the sky wants no edge lines.
    this.normalEdgeStrength = 0;
    this.depthEdgeStrength = 0;
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    this.camera.layers.set(SKY_LAYER);
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    this.camera.layers.enableAll();
  }
}

/**
 * The shared thin-lens pass. Runs after the sky pixel pass, before OutputPass.
 *
 * For each of up to `MAX_LENSES` centres the point-mass deflection
 * `thetaE^2 / r` (capped in cells, zero inside `inner`, faded out by 3.6 thetaE)
 * displaces the sample position radially: sign +1 samples inward, so the sky
 * is pushed outward and stretched tangentially into arcs (black hole,
 * wormhole); sign -1 samples outward, so the sky bunches tangentially into a
 * dense ring and streaks radially (white hole). Displacements from several
 * lenses superpose (weak-field), the final UV is snapped to the cell grid so
 * stars hop whole cells instead of smearing, and a 1 to 2 cell band at thetaE
 * is brightened in two steps (the Einstein ring).
 *
 * The same pass renders the object layer into a low-res target with a
 * transparent clear and composites it, unwarped, over the lensed sky, then
 * applies the whiteout flash. Cost: one low-res scene render + one quad.
 */
export class GravityLensPass extends Pass {
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly objects: THREE.WebGLRenderTarget;
  /** Low-res size in cells (what point shaders snap to). */
  readonly resolution = new THREE.Vector2(1, 1);
  pixelSize = 2;
  private readonly quad: FullScreenQuad;
  private readonly material: THREE.ShaderMaterial;
  private width = 1;
  private height = 1;
  private readonly clearColor = new THREE.Color();

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.objects = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      type: THREE.HalfFloatType,
    });
    this.material = new THREE.ShaderMaterial({
      defines: { MAX_LENSES },
      uniforms: {
        tDiffuse: { value: null },
        tObjects: { value: null },
        uRes: { value: new THREE.Vector2(1280, 720) },
        uPx: { value: 2 },
        uCount: { value: 0 },
        uLensA: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector4()) },
        uLensB: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector4()) },
        uRingColor: { value: new THREE.Color("#fff0c2") },
        uRingGain: { value: 1.4 },
        uFlash: { value: 0 },
        uFlashColor: { value: new THREE.Color("#fff0c2") },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tObjects;
        uniform vec2 uRes;
        uniform float uPx;
        uniform int uCount;
        uniform vec4 uLensA[MAX_LENSES]; // cx, cy, thetaE (strength folded in), inner
        uniform vec4 uLensB[MAX_LENSES]; // sign, ring, swirl, cap in cells
        uniform vec3 uRingColor;
        uniform float uRingGain;
        uniform float uFlash;
        uniform vec3 uFlashColor;
        varying vec2 vUv;

        vec2 snap(vec2 uv) { return (floor(uv * uRes / uPx) + 0.5) * uPx / uRes; }

        void main() {
          float aspect = uRes.x / uRes.y;
          float cell = uPx / uRes.y;
          // Work from the centre of this output cell, so all device pixels of one cell share one
          // displacement and land in the same source cell: no half-cell slivers, no shimmer.
          vec2 uvC = snap(vUv);
          vec2 shift = vec2(0.0);
          float ring = 0.0;
          for (int i = 0; i < MAX_LENSES; i++) {
            if (i >= uCount) break;
            vec4 A = uLensA[i];
            vec4 B = uLensB[i];
            vec2 d = uvC - A.xy;
            d.x *= aspect;
            float r = length(d);
            float inner = A.w;
            if (r <= inner || r < 1e-5) continue;
            float thetaE = A.z;
            float e2 = thetaE * thetaE;
            float maxD = B.w * cell;
            // Point-mass deflection, capped; where the cap exceeds r the sample crosses the centre,
            // which is the real secondary (mirrored) image. Faded a few radii out so the whole
            // screen does not shimmer when the object moves.
            float fade = 1.0 - smoothstep(2.2 * thetaE, 3.6 * thetaE, r);
            float disp = min(e2 / r, maxD) * fade;
            vec2 radial = d / r;
            vec2 tang = vec2(-radial.y, radial.x);
            float k = max(0.0, 1.0 - (r - inner) / max(1e-4, 2.0 * thetaE));
            float swirl = B.z * k * k * inner * fade;
            shift += -B.x * radial * disp + tang * swirl;
            // Einstein ring: two-step band, 1 to 2 cells wide, only where the sky is visible.
            float bandW = 1.0 - smoothstep(0.0, 1.6 * cell, abs(r - thetaE));
            ring = max(ring, floor(bandW * 2.999) / 2.0 * B.y * step(inner, thetaE) * fade);
          }
          shift.x /= aspect;
          vec2 uv = snap(uvC + shift);
          // A source outside the frame would clamp to the border row and smear it into streaks
          // (the white hole samples outward); show the unwarped sky there instead.
          if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) uv = uvC;
          vec4 sky = texture2D(tDiffuse, uv);
          // Einstein ring: lift whatever star lands on the critical radius; no additive outline
          // (a drawn circle reads as a wire, a brightened star reads as lensing).
          sky.rgb = sky.rgb * (1.0 + ring * uRingGain);
          vec4 obj = texture2D(tObjects, vUv);
          vec3 c = sky.rgb * (1.0 - obj.a) + obj.rgb;
          gl_FragColor = vec4(mix(c, uFlashColor, uFlash), 1.0);
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
    this.resolution.set(Math.max(1, Math.floor(width / this.pixelSize)), Math.max(1, Math.floor(height / this.pixelSize)));
    this.objects.setSize(this.resolution.x, this.resolution.y);
  }

  setPixelSize(pixelSize: number): void {
    if (pixelSize === this.pixelSize) return;
    this.pixelSize = pixelSize;
    this.setSize(this.width, this.height);
  }

  /** Copy this frame's lens list and flash into the uniforms. */
  apply(frame: GravityFrame, dpr: number, widthCss: number, heightCss: number): void {
    const u = this.material.uniforms;
    (u.uRes.value as THREE.Vector2).set(widthCss * dpr, heightCss * dpr);
    u.uPx.value = this.pixelSize;
    let count = 0;
    const A = u.uLensA.value as THREE.Vector4[];
    const B = u.uLensB.value as THREE.Vector4[];
    for (let i = 0; i < MAX_LENSES; i++) {
      const l = frame.lenses[i];
      if (!l || l.strength <= 0 || l.thetaE <= 0) continue;
      A[count].set(l.center.x, l.center.y, l.thetaE * Math.sqrt(l.strength), l.inner);
      B[count].set(l.sign, l.ring, l.swirl, Math.max(1, l.maxCells));
      count++;
    }
    u.uCount.value = count;
    u.uFlash.value = frame.flash;
    (u.uFlashColor.value as THREE.Color).copy(frame.flashColor);
    (u.uRingColor.value as THREE.Color).copy(frame.ringColor);
    // Lifting the paper on the light theme bleaches a ring; the ink stars there carry the arcs on their own.
    u.uRingGain.value = frame.theme === "light" ? 0 : 1.4;
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    // 1. Objects layer into the low-res target, transparent clear (sprites blend over nothing).
    const background = this.scene.background;
    const autoClear = renderer.autoClear;
    renderer.getClearColor(this.clearColor);
    const clearAlpha = renderer.getClearAlpha();
    this.scene.background = null;
    renderer.setRenderTarget(this.objects);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    renderer.clear(true, false, false);
    this.camera.layers.set(OBJECT_LAYER);
    renderer.render(this.scene, this.camera);
    this.camera.layers.enableAll();
    this.scene.background = background;
    renderer.setClearColor(this.clearColor, clearAlpha);
    renderer.autoClear = autoClear;

    // 2. Lens the sky, composite the objects, flash.
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tObjects.value = this.objects.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.objects.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
