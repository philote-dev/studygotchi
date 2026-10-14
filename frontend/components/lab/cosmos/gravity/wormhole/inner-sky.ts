import * as THREE from "three";
import { buildStarShell } from "../field/star-geometry";
import { STAR_FRAG, STAR_VERT } from "../field/star-shaders";
import { GRAVITY_UNIFORMS } from "../lib/uniforms";

export const INNER_SKY_BG = { dark: "#171233", light: "#2a2640" } as const;

/**
 * The far side of the wormhole: its own scene, camera and square render
 * target, sized to the mouth in cells so one target texel is about one cell on
 * screen (NearestFilter, no mips). 420 stars on a shell around the camera,
 * which rolls and nods slowly so the inner sky drifts.
 */
export class InnerSky {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
  readonly target: THREE.WebGLRenderTarget;
  readonly uniforms = { uTime: GRAVITY_UNIFORMS.uTime, uRes: { value: new THREE.Vector2(64, 64) }, uLight: { value: 0 }, uFade: { value: 1 } };
  private points: THREE.Points | null = null;
  private material: THREE.ShaderMaterial;

  constructor(cells: number, background: string) {
    this.target = new THREE.WebGLRenderTarget(cells, cells, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, type: THREE.HalfFloatType });
    this.uniforms.uRes.value.set(cells, cells);
    this.scene.background = new THREE.Color(background);
    this.material = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      vertexColors: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: this.uniforms,
    });
  }

  setSeed(seed: number, count = 1400): void {
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
    }
    this.points = new THREE.Points(buildStarShell(seed, count, 20), this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  render(gl: THREE.WebGLRenderer, seconds: number): void {
    this.camera.rotation.set(0.12 * Math.sin(seconds / 23), seconds / 95, seconds / 60);
    const previous = gl.getRenderTarget();
    gl.setRenderTarget(this.target);
    gl.render(this.scene, this.camera);
    gl.setRenderTarget(previous);
  }

  dispose(): void {
    this.points?.geometry.dispose();
    this.material.dispose();
    this.target.dispose();
  }
}
