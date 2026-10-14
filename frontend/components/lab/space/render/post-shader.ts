import * as THREE from "three";

/**
 * Runs after the pixel pass, before OutputPass: a screen-space thin lens for
 * the black hole (point-mass: src = c + d * (1 - thetaE^2 / |d|^2), i.e. the
 * sky is pushed outward and stretched tangentially into arcs), displacement
 * capped and snapped to the cell grid so stars hop cells instead of smearing,
 * plus the director's whiteout flash. The disc sprite sits AT the lens, so
 * nothing inside the disc radius is warped: the EHT proportions stay exact
 * and only the sky behind the hole bends.
 */
export const LabPostShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uThetaE: { value: 0.1 },
    uDisc: { value: 0.05 },
    uRes: { value: new THREE.Vector2(1280, 720) },
    uPx: { value: 2 },
    uLens: { value: 0 },
    uMaxCells: { value: 8 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color("#fff0c2") },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uCenter;
    uniform float uThetaE;
    uniform float uDisc;
    uniform vec2 uRes;
    uniform float uPx;
    uniform float uLens;
    uniform float uMaxCells;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    varying vec2 vUv;

    vec2 snap(vec2 uv) { return (floor(uv * uRes / uPx) + 0.5) * uPx / uRes; }

    void main() {
      vec2 uv = vUv;
      if (uLens > 0.5) {
        vec2 d = uv - uCenter;
        d.x *= uRes.x / uRes.y;
        float r = length(d);
        if (r > uDisc) {
          float e2 = uThetaE * uThetaE;
          // Point-mass deflection e2 / r, capped in cells, zero at the disc edge, gone by 3.3 thetaE.
          float fade = 1.0 - smoothstep(2.0 * uThetaE, 3.3 * uThetaE, r);
          float maxD = uMaxCells * uPx / uRes.y;
          float disp = min(min(e2 / r, maxD), r - uDisc) * fade;
          vec2 src = d * (1.0 - disp / r);
          src.x *= uRes.y / uRes.x;
          uv = snap(uCenter + src);
        }
      }
      vec4 c = texture2D(tDiffuse, uv);
      // The wash is specified perceptually (12 % / 20 % / 30 %); this pass runs in linear light before the
      // OutputPass encodes to sRGB, so a linear mix of 0.2 would read as ~46 %. Gamma the amount instead.
      float wash = pow(clamp(uFlash, 0.0, 1.0), 2.2);
      gl_FragColor = vec4(mix(c.rgb, uFlashColor, wash), c.a);
    }
  `,
};
