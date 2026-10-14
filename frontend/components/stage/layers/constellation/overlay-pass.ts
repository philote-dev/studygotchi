/**
 * Full-resolution overlay pass for the persistent stage (plan T-2 / S1-4).
 *
 * The constellation must never go through the pixel pass: it is drawn after the
 * composer has composited the low-res sky (and the planet pass) onto the
 * screen, at device resolution, over whatever is already there. This file owns
 * that pass; `StageComposer` only has to call it. The one-line hook, after the
 * planet quad and before `gl.autoClear = true` in `StageComposer`'s frame:
 *
 *     (f as StageFrame & { overlay?: ConstellationOverlayPass }).overlay?.render(gl);
 *
 * and `StageFrame` gains `overlay: ConstellationOverlayPass | null` (null in
 * `createStageFrame`). `TwinOverlayLayer` (ConstellationTwin.tsx, overlay mode)
 * registers itself on `frame.current.overlay` while mounted.
 */

import * as THREE from "three";

export interface ConstellationOverlayPass {
  /** The twin's own scene: dust, edges, nodes (labels are DOM). */
  scene: THREE.Scene;
  /** World-space orthographic camera the twin drives from the 2D `{x, y, k}`. */
  camera: THREE.OrthographicCamera;
  /** Nothing to draw yet (no frame uploaded): the composer may skip the pass. */
  readonly empty: boolean;
  /** Draw the scene to the current render target (the screen) without clearing it. */
  render(gl: THREE.WebGLRenderer): void;
  dispose(): void;
}

export function createConstellationOverlayPass(): ConstellationOverlayPass {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 0, 10);
  return {
    scene,
    camera,
    get empty() {
      return scene.children.length === 0 || scene.children.every((child) => !child.visible);
    },
    render(gl) {
      if (this.empty) return;
      const autoClear = gl.autoClear;
      const target = gl.getRenderTarget();
      gl.autoClear = false;
      gl.setRenderTarget(null);
      gl.render(scene, camera);
      gl.setRenderTarget(target);
      gl.autoClear = autoClear;
    },
    dispose() {
      scene.clear();
    },
  };
}
