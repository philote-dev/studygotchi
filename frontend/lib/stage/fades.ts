import * as THREE from "three";

/**
 * Per-layer opacity for subtrees we do not own (the galaxy components).
 * Ported verbatim from the space lab's Stage v2 `fades.ts`.
 *
 * Every lab material carries its alpha either in a `uFade` uniform or, for
 * the instanced glow / far quads, in the `iParams.x` instance attribute. The
 * fader records each base value on first sight and writes base x opacity
 * each frame, so a whole subtree fades as one without touching its files
 * and without ever flipping `visible`.
 */
export class LayerFader {
  private readonly baseFade = new WeakMap<THREE.ShaderMaterial, number>();
  private readonly baseParams = new WeakMap<THREE.BufferAttribute | THREE.InterleavedBufferAttribute, Float32Array>();
  private last = -1;

  apply(root: THREE.Object3D, opacity: number): void {
    const o = Math.max(0, Math.min(1, opacity));
    if (o === this.last) return;
    this.last = o;
    root.traverse((obj) => {
      const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (mat && !Array.isArray(mat) && (mat as THREE.ShaderMaterial).isShaderMaterial) {
        const sm = mat as THREE.ShaderMaterial;
        const u = sm.uniforms?.uFade;
        if (u && typeof u.value === "number") {
          let base = this.baseFade.get(sm);
          if (base === undefined) {
            base = u.value;
            this.baseFade.set(sm, base);
          }
          // The disc-plane field quads (arm / dust: the ones with spur uniforms) are plates across the
          // lens while the camera is still inside the disc: they join in the second half of the fade.
          const field = sm.uniforms.uSpur !== undefined;
          const k = field ? Math.max(0, (o - 0.5) * 2) : o;
          u.value = base * (field ? k * k * (3 - 2 * k) : k);
        }
      }
      const geo = (obj as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      const params = geo?.attributes?.iParams;
      if (params && params.itemSize === 4) {
        let base = this.baseParams.get(params);
        const arr = params.array as Float32Array;
        if (!base) {
          base = new Float32Array(params.count);
          for (let i = 0; i < params.count; i++) base[i] = arr[i * 4];
          this.baseParams.set(params, base);
        }
        for (let i = 0; i < params.count; i++) arr[i * 4] = base[i] * o;
        params.needsUpdate = true;
      }
    });
  }

  /** Forget the cached value so the next apply rewrites (after the subtree changed). */
  invalidate(): void {
    this.last = -1;
  }
}
