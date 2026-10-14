import * as THREE from "three";

/**
 * Per-frame opacity for the galaxy subtree, by uniform only. Every galaxy,
 * bead and scenery material carries `uFade` (the layer's prop sets the base:
 * 1 for most, 0.72 for the dust grain), so the rung multiplies base x opacity
 * into each one when the altitude band moves, and never touches instance
 * attributes (the beads' `iParams.x` is already applied through `uFade` in
 * the shader; `lib/stage/fades.ts`'s attribute path would fade them twice).
 *
 * Same rule as `LayerFader` for the disc-plane field quads (the materials
 * with spur uniforms): they are plates across the lens while the camera is
 * still inside the disc, so they join in the second half of the fade.
 */
export class GalaxyFader {
  private readonly base = new WeakMap<THREE.ShaderMaterial, number>();
  private last = -1;

  apply(root: THREE.Object3D, opacity: number): void {
    const o = Math.max(0, Math.min(1, opacity));
    if (o === this.last) return;
    this.last = o;
    root.traverse((obj) => {
      const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!mat || Array.isArray(mat) || !(mat as THREE.ShaderMaterial).isShaderMaterial) return;
      const sm = mat as THREE.ShaderMaterial;
      const u = sm.uniforms?.uFade;
      if (!u || typeof u.value !== "number") return;
      let base = this.base.get(sm);
      if (base === undefined) {
        base = u.value;
        this.base.set(sm, base);
      }
      const field = sm.uniforms.uSpur !== undefined;
      const k = field ? Math.max(0, (o - 0.5) * 2) : o;
      u.value = base * (field ? k * k * (3 - 2 * k) : k);
    });
  }

  /** Forget the last opacity so the next `apply` rewrites every material (after the subtree changed). */
  invalidate(): void {
    this.last = -1;
  }
}
