/**
 * Galaxy shaders (moved from `components/lab/cosmos/galaxy/galaxy-shaders.ts`,
 * the polished fork). Snap, tone and noise come from the stage's shared
 * uniforms module; the light chunk from `lib/light` (the stage's own reduced
 * `GLSL_LIGHT` is never included alongside it: the names would clash). The
 * only change from the lab: the glow and far layers read `uFade` instead of
 * baking the fade into their instance alphas, so an altitude fade is one
 * uniform write, never a geometry rebuild.
 */
import { GLSL_NOISE, GLSL_SNAP, GLSL_THEME_TONE } from "../../lib/uniforms";
import { GLSL_LIGHT } from "@/lib/light";

/**
 * Shared arm geometry: mirrors `thetaAt` / `eccentricityAt` in lib/galaxy/spec.ts
 * (including the barred twist offset) and the crowding ridge phase. Every
 * galaxy material includes it so points, arm field and dust field agree.
 * `uDither` is the light model: 0 = the lab's hard bands, 1..3 = the shared
 * light module (Bayer 4, Bayer 8, interleaved gradient noise).
 */
export const GLSL_ARMS = /* glsl */ `
uniform float uDither;
uniform float uB;
uniform float uArms;
uniform float uBarLen;
uniform float uThetaBar;
uniform float uEcc;
uniform float uBarEcc;
uniform float uBarTwist;
const float PI = 3.14159265;
const float TAU = 6.2831853;
float sstep(float lo, float hi, float x) { float t = clamp((x - lo) / (hi - lo), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float wrapPi(float x) { return x - TAU * floor((x + PI) / TAU); }
float barTwist(float a) { return uBarLen > 0.0 ? uBarTwist * sstep(uBarLen * 0.9, uBarLen * 1.3, a) : 0.0; }
float thetaAt(float a) {
  if (uBarLen > 0.0) return (a < uBarLen ? uThetaBar : uThetaBar + uB * log(a / uBarLen)) + barTwist(a);
  return uThetaBar + uB * log(max(a, 0.18) / 0.18);
}
float eccAt(float a) {
  if (uBarLen <= 0.0) return uEcc;
  return mix(uBarEcc, uEcc, sstep(uBarLen * 0.8, uBarLen * 1.2, a));
}
float mAt(float a) { return (uBarLen > 0.0 && a < uBarLen) ? 2.0 : uArms; }
/** Phase of the crowding ridge: density 1/(1 + e cos X + e m b sin X) peaks at X = pi + atan(m b). */
float ridgePhase() { return PI + atan(uArms * uB); }
/** Stellar surface density the disc points were drawn from (galaxy-points.ts): (a - 0.06)/0.96 = u^0.7. */
float discDensity(float a) {
  if (a < 0.07 || a > 1.02) return 0.0;
  return pow((a - 0.06) / 0.96, 1.0 / 0.7 - 1.0) / a;
}
/** cos(pitch): converts an azimuthal arc at radius r into a distance normal to the arm. */
float cosPitch() { return abs(uB) / sqrt(1.0 + uB * uB); }
`;

/**
 * Galaxy points. Polar orbit attributes in, pixel-snapped clip position out.
 * Mirrors `starPosition()` in galaxy-spec.ts exactly; tests cover the CPU side.
 * Kinds: 0 disc, 1 dust, 2 bead, 3 bulge, 4 companion, 5 young, 6 halo,
 * 7 globular, 8 bridge, 9 cluster, 10 spur. Feature uniforms (uF*) gate the
 * polish so the lab look is the all-off case.
 */
export const GALAXY_VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uRes;
uniform float uLight;
uniform float uPattern;
uniform float uV0;
uniform float uACore;
uniform float uCells;
uniform float uCellPx;
uniform float uFade;
uniform float uSpin;
uniform float uCoreSize;
uniform vec3 uArmTint;
uniform vec3 uBulgeTint;
uniform float uFCore;
uniform float uFArms;
uniform float uFHii;
uniform float uFColour;
uniform float uFHalo;
uniform float uFDepth;
uniform float uFLife;
uniform float uFlashPeriod;
uniform float uFlashRate;
uniform vec3 uClassDark[8];
uniform vec3 uClassLight[8];
attribute vec4 orbit;
attribute float kind;
attribute float phase;
attribute float cls;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
varying float vHalo;
varying float vSize;
${GLSL_SNAP}
${GLSL_THEME_TONE}
${GLSL_ARMS}
${GLSL_LIGHT}

void main() {
  float a = orbit.x;
  float k = kind;
  bool disc = k < 0.5;
  bool dust = k > 0.5 && k < 1.5;
  bool bead = k > 1.5 && k < 2.5;
  bool bulge = k > 2.5 && k < 3.5;
  bool comp = k > 3.5 && k < 4.5;
  bool young = k > 4.5 && k < 5.5;
  bool halo = k > 5.5 && k < 6.5;
  bool glob = k > 6.5 && k < 7.5;
  bool bridge = k > 7.5 && k < 8.5;
  bool cluster = k > 8.5 && k < 9.5;
  bool spur = k > 9.5;
  // Companion and bridge co-rotate with the pattern; halo and globulars drift; everything else: flat rotation curve.
  float flatCurve = sign(uPattern) * uV0 / max(a, uACore);
  float omega = (comp || bridge) ? uPattern : halo ? flatCurve * 0.5 : glob ? flatCurve * 0.35 : flatCurve;
  float psi = orbit.z + omega * uTime;
  // Young stars crowd on the outer (leading) edge of the old ridge once the arms polish is on.
  float dth = orbit.w + (young ? uFArms * uSpin * 0.10 : 0.0);
  float theta = thetaAt(a) + dth + uPattern * uTime;
  float m = mAt(a);
  float e = orbit.y * eccAt(a);
  float X = m * (psi - theta);
  float r = a * (1.0 + e * cos(X));
  // Local orbit crowding, 1 / (dr/da): where neighbouring orbits bunch, the density wave
  // compresses gas and young bright stars form. Brightness follows it, so arms read as arms
  // while every star keeps drifting through them. A function of orbit phase only: no winding.
  float dens = 1.0 / max(0.06, 1.0 + e * cos(X) + e * m * uB * sin(X));
  float armness = clamp((dens - 0.75) / 2.6, 0.0, 1.0);
  // Depth: the bulge is a ball, taller than the disc.
  float yScale = bulge ? mix(1.0, 1.9, uFDepth) : 1.0;
  vec3 p = vec3(r * cos(psi) + position.x, position.y * yScale, r * sin(psi) + position.z);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec4 clip = projectionMatrix * mv;
  gl_Position = snapClip(clip, uRes);

  // Colour: lab lerps, or the quantised OBAFGKM class of this point for the current theme.
  vec3 c = color;
  if (uFColour > 0.5) {
    int ci = int(cls + 0.5);
    c = mix(uClassDark[ci], uClassLight[ci], uLight);
  }
  // Two-step twinkle (1.0 / 0.55) with a 3 to 7 s period per bead; never continuous.
  float tw = step(0.5, fract(uTime / (3.0 + 4.0 * phase) + phase));
  float twinkle = 1.0;
  float alpha = uFade;
  float size = 1.0;
  float shape = 0.0;
  float haloA = 0.0;
  // Halo size follows the disc's size on screen: 5 cells at hero scale, 3 cells in the 112 px corner.
  vec4 c0 = projectionMatrix * modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 c1 = projectionMatrix * modelViewMatrix * vec4(1.0, 0.0, 0.0, 1.0);
  float rCells = length((c1.xy / c1.w - c0.xy / c0.w) * 0.5 * uRes);
  float haloCells = (uDither > 0.5 && rCells > 100.0) ? 5.0 : 3.0;
  if (disc) {
    if (uFArms > 0.5) c = mix(c * 0.5, c, armness);
    else c = mix(c * 0.45, mix(c, uArmTint, 0.35), armness);
  } else if (young || spur) {
    if (uFArms > 0.5) {
      // Born in the compression, fading as they leave it.
      alpha *= sstep(0.18, 0.62, armness);
      c = mix(c * 0.85, c, armness);
    } else {
      c = mix(c * 0.45, mix(c, uArmTint, 0.35), armness);
      if (spur) alpha = 0.0;
    }
  } else if (bead) {
    // HII beads light up only while inside the arm compression.
    alpha *= step(0.35, armness);
    twinkle = mix(0.55, 1.0, tw);
    if (uFHii > 0.5) {
      size = haloCells;
      shape = 1.0;
      // Breathing halo: two alpha steps on a 4 to 7 s period per bead.
      float breath = step(0.5, fract(uTime / (4.0 + 3.0 * phase) + phase * 2.0));
      haloA = uFLife > 0.5 ? mix(0.3, 0.5, breath) : 0.4;
    }
  } else if (cluster) {
    alpha *= uFHii * sstep(0.25, 0.7, armness);
    // Light model: clusters share the soft halo; lab bands: a crisp plus.
    size = uDither > 0.5 ? haloCells : 3.0;
    shape = uDither > 0.5 ? 1.0 : 2.0;
    haloA = 0.55;
    twinkle = mix(0.7, 1.0, tw);
  } else if (dust) {
    alpha *= armness;
  } else if (bulge) {
    if (uFCore > 0.5) {
      // No white blowout: the billboard carries the gradient, points stay warm and thin in the centre.
      alpha *= 0.25 + 0.5 * sstep(0.0, uCoreSize * 1.2, a);
      if (uFColour < 0.5) c = mix(c, uBulgeTint, 0.6);
    }
  } else if (halo) {
    alpha *= uFHalo * 0.22;
  } else if (glob) {
    alpha *= uFHalo * 0.75;
  } else if (bridge) {
    alpha *= uFHalo * 0.6;
  }
  // Depth: disc things on the far side of the bulge hide behind the ball (Sombrero).
  if (uFDepth > 0.5 && !bulge && !halo && !glob) {
    vec4 bv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float R = length(mat3(modelViewMatrix) * vec3(uCoreSize * 1.5, 0.0, 0.0));
    float behind = step(mv.z, bv.z - 0.02 * R);
    float d = length(mv.xy - bv.xy);
    // Light model: the ball's edge is the bulge's own exponential falloff, not a step.
    float occl = uDither > 0.5 ? expDisc(d, R * 0.45) : 1.0 - sstep(R * 0.7, R, d);
    alpha *= 1.0 - behind * occl;
  }
  // Life: a rare one-cell flash somewhere in an arm, every uFlashPeriod seconds.
  if (uFLife > 0.5 && (disc || young || spur)) {
    float ev = floor(uTime / uFlashPeriod);
    float ph = fract(uTime / uFlashPeriod);
    float h = fract(sin(phase * 127.1 + ev * 311.7) * 43758.5453);
    if (h < uFlashRate && ph < 0.05 && armness > 0.3) {
      shape = 2.0;
      size = ph < 0.03 ? 3.0 : 1.0;
      c = min(c * 2.2 + 0.25, vec3(1.0));
      alpha = uFade;
      twinkle = 1.0;
    }
  }
  // Cells, times the device px per cell of the target (1 in a cell-sized target, the grain at native resolution).
  gl_PointSize = uCells * size * uCellPx;
  vColor = (uFColour > 0.5 ? c : themeTone(c, uLight)) * twinkle;
  vAlpha = alpha;
  vShape = shape;
  vHalo = haloA;
  vSize = size;
}
`;

/**
 * Shapes: 0 one cell; 1 halo (lab bands: 3 cells, centre + ring + dim corners;
 * light model: 3 or 5 cells with a dithered Gaussian skirt); 2 three-cell plus.
 */
export const POINT_FRAG = /* glsl */ `
uniform float uDither;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
varying float vHalo;
varying float vSize;
${GLSL_LIGHT}
void main() {
  if (vAlpha <= 0.002) discard;
  float a = vAlpha;
  if (vShape > 1.5) {
    vec2 q = floor(gl_PointCoord * 3.0);
    bool centre = q.x == 1.0 && q.y == 1.0;
    if (q.x != 1.0 && q.y != 1.0) discard;
    if (!centre) a *= 0.45;
  } else if (vShape > 0.5) {
    if (uDither > 0.5) {
      // Soft halo: Gaussian in cells from the centre cell, dithered into three alpha steps.
      vec2 q = floor(gl_PointCoord * vSize) - (vSize - 1.0) * 0.5;
      float dist = length(q);
      if (dist > 0.5) {
        float p = gaussianBand(dist, vSize * 0.34);
        a *= vHalo * 1.6 * ditherQuantize(p, 3.0, gl_FragCoord.xy, uDither);
        if (a <= 0.002) discard;
      }
    } else {
      vec2 q = floor(gl_PointCoord * 3.0);
      bool centre = q.x == 1.0 && q.y == 1.0;
      bool corner = q.x != 1.0 && q.y != 1.0;
      if (!centre) a *= corner ? vHalo * 0.45 : vHalo;
    }
  }
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}
`;

/** Disc-plane quads (arm field, dust field): disc coords and view position out. */
export const FIELD_VERT = /* glsl */ `
varying vec2 vDisc;
varying vec3 vView;
varying vec3 vBulgeView;
varying float vBulgeR;
uniform float uCoreSize;
void main() {
  vDisc = position.xz;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  vBulgeView = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vBulgeR = length(mat3(modelViewMatrix) * vec3(uCoreSize * 1.5, 0.0, 0.0));
  gl_Position = projectionMatrix * mv;
}
`;

/**
 * Arm field: the luminous surface under the points. Old exponential disc,
 * the crowding ridge of each arm (tapering outward), the young ridge on the
 * outer edge, spurs, the bar and the zodiacal glow. Alpha in 5 bands.
 */
export const ARM_FIELD_FRAG = /* glsl */ `
uniform float uLight;
uniform float uFade;
uniform float uSpin;
uniform float uCoreSize;
uniform float uAsym;
uniform float uSeed;
uniform float uFArms;
uniform float uFCore;
uniform float uFDepth;
uniform vec3 uOld;
uniform vec3 uEnv;
uniform vec3 uYoung;
uniform vec3 uBar;
uniform vec3 uAmbient;
uniform vec4 uSpur[6];
uniform float uSpurS[6];
uniform float uSpurN;
uniform float uSigmaIn;
uniform float uSigmaOut;
uniform float uArmStart;
varying vec2 vDisc;
${GLSL_NOISE}
${GLSL_ARMS}
${GLSL_LIGHT}
void main() {
  float r = length(vDisc);
  if (r < 0.005 || r > 1.2) discard;
  float psi = atan(vDisc.y, vDisc.x);
  float m = uArms;
  float phase = ridgePhase();
  float th = thetaAt(r);
  float barEnd = uBarLen > 0.0 ? uBarLen * 0.95 : 0.0;
  float Xr = m * (psi - th) - phase;
  // Arms are clumpy (M101): a slow noise along the ridge, in pattern-frame coordinates so it rides with it.
  float clumpy = 0.7 + 0.6 * fbm3(vec2(log(r) * 6.0, Xr * 0.5) + uSeed);
  // One arm a little stronger than the rest (M51, NGC 1300 are not symmetric).
  float armIdx = floor(mod((psi - th - phase / m) / (TAU / m) + 0.5, m));
  float asym = 1.0 - uAsym * step(0.5, armIdx);
  bool lightModel = uDither > 0.5;
  float cp = cosPitch();
  // Bar: lab bands = a smoothstep ellipse; light model = an exponential (Sérsic n = 1) in the elliptical radius.
  float bar = 0.0;
  if (uBarLen > 0.0) {
    float cb = cos(uThetaBar);
    float sb = sin(uThetaBar);
    float u = vDisc.x * cb + vDisc.y * sb;
    float v = -vDisc.x * sb + vDisc.y * cb;
    float eb = length(vec2(u / uBarLen, v / (uBarLen * 0.3)));
    bar = lightModel ? expDisc(eb, 0.9) * (1.0 - sstep(0.9, 1.3, eb)) : 1.0 - sstep(0.55, 1.05, eb);
  }
  // Zodiacal / ambient glow: an exponential skirt two to three bulge radii wide.
  float amb = lightModel
    ? expDisc(r, uCoreSize * 1.1) * expDisc(max(0.0, r - uCoreSize * 1.8), uCoreSize * 0.7)
    : exp(-r / (uCoreSize * 1.1)) * (1.0 - sstep(uCoreSize * 1.8, uCoreSize * 3.2, r));

  float ridge;
  float envelope;
  float ridgeY;
  float amp;
  float spur = 0.0;
  float spurSigma;
  if (lightModel) {
    // Gaussian cross-section in the arm-normal coordinate: arc at radius r times cos(pitch).
    float d = r * (wrapPi(Xr) / m) * cp;
    float sigma = mix(uSigmaIn, uSigmaOut, sstep(0.2, 1.0, r));
    ridge = gaussianBand(d, sigma) * clumpy;
    envelope = gaussianBand(d, sigma * 1.5);
    float dY = r * (wrapPi(Xr - m * uSpin * 0.10) / m) * cp;
    ridgeY = gaussianBand(dY, sigma * 0.55) * clumpy;
    // Amplitude follows the stellar surface density the points were drawn from, then feathers
    // over the last ~15 % of the arm's length. The dither turns the feather into a stipple.
    float start = max(uArmStart, barEnd);
    amp = discDensity(r) / discDensity(0.3) * sstep(start, start + 0.1, r) * (1.0 - sstep(0.9, 1.02, r));
    spurSigma = 0.02;
  } else {
    float taper = mix(16.0, 42.0, sstep(0.2, 1.0, r));
    float cosR = 0.5 + 0.5 * cos(Xr);
    ridge = pow(cosR, taper) * clumpy;
    envelope = pow(cosR, 7.0);
    ridgeY = pow(0.5 + 0.5 * cos(m * (psi - th - uSpin * 0.10) - phase), taper * 1.3) * clumpy;
    amp = sstep(max(0.16, barEnd), max(0.3, barEnd + 0.12), r) * (1.0 - sstep(0.78, 1.08, r));
    spurSigma = 0.028 * 0.7071;
  }
  for (int i = 0; i < 6; i++) {
    if (float(i) >= uSpurN) break;
    vec4 s = uSpur[i];
    float l = log(r / s.x);
    if (l < 0.0 || l > s.w) continue;
    float ridgePsi = th + phase / m + s.y + s.z * l;
    float d = wrapPi(psi - ridgePsi) * r * (lightModel ? cp : 1.0);
    spur = max(spur, gaussianBand(d, spurSigma) * (1.0 - l / s.w) * uSpurS[i]);
  }
  float wEnv = uFArms * (lightModel ? 0.1 : 0.14) * envelope * amp * asym;
  float wOld = uFArms * (lightModel ? 0.8 : 0.5) * ridge * amp * asym;
  float wYoung = uFArms * ((lightModel ? 0.6 : 0.45) * ridgeY * amp * asym + 0.45 * spur * (lightModel ? amp : 1.0));
  float wBar = uFCore * (lightModel ? 0.6 : 0.5) * bar;
  float wAmb = uFDepth * 0.3 * amb;
  float wsum = wEnv + wOld + wYoung + wBar + wAmb;
  if (wsum <= 0.001) discard;
  vec3 c = (uEnv * wEnv + uOld * wOld + uYoung * wYoung + uBar * wBar + uAmbient * wAmb) / wsum;
  float ceilA = mix(0.74, 0.92, uLight);
  // Lab bands: ten hard alpha steps. Light model: eight steps dithered in cell space, so the
  // envelope and the feathered ends fade as a stipple instead of a contour.
  float alpha = lightModel
    ? ditherQuantize(clamp(wsum, 0.0, 1.0), 8.0, gl_FragCoord.xy, uDither) * ceilA
    : floor(clamp(wsum, 0.0, 0.95) * 10.0) / 10.0 * ceilA;
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(c, alpha * uFade);
  #include <colorspace_fragment>
}
`;

/**
 * Dust field: dark lanes on the inner / trailing edge of each arm, broken
 * into filaments by arm-aligned noise, feathers crossing the arms, two thin
 * lanes tracing the bar. Normal blending with a dark colour: a shadow over
 * the old light, not a hole. The far half hides behind the bulge ball.
 */
export const DUST_FIELD_FRAG = /* glsl */ `
uniform float uLight;
uniform float uFade;
uniform float uSpin;
uniform float uCoreSize;
uniform float uDustFade;
uniform float uFDepth;
uniform float uSeed;
uniform vec3 uDust;
uniform vec4 uSpur[6];
uniform float uSpurS[6];
uniform float uSpurN;
uniform float uSigmaIn;
uniform float uSigmaOut;
uniform float uArmStart;
varying vec2 vDisc;
varying vec3 vView;
varying vec3 vBulgeView;
varying float vBulgeR;
${GLSL_NOISE}
${GLSL_ARMS}
${GLSL_LIGHT}
void main() {
  float r = length(vDisc);
  if (r < 0.005 || r > 1.1) discard;
  float psi = atan(vDisc.y, vDisc.x);
  float m = uArms;
  float phase = ridgePhase();
  float th = thetaAt(r);
  float barEnd = uBarLen > 0.0 ? uBarLen * 0.95 : 0.0;
  bool lightModel = uDither > 0.5;
  float cp = cosPitch();
  // Lane on the inner flank of the ridge core (0.12 rad inside it), narrow, broken by arm-aligned noise.
  float Xd = m * (psi - th + uSpin * 0.12) - phase;
  float lane;
  float amp;
  float feather = 0.0;
  if (lightModel) {
    float sigma = mix(uSigmaIn, uSigmaOut, sstep(0.2, 1.0, r)) * 0.45;
    float d = r * (wrapPi(Xd) / m) * cp;
    lane = gaussianBand(d, sigma);
    float start = max(uArmStart, barEnd) - 0.04;
    amp = discDensity(r) / discDensity(0.3) * sstep(start, start + 0.1, r) * (1.0 - sstep(0.84, 0.98, r));
  } else {
    lane = pow(0.5 + 0.5 * cos(Xd), mix(20.0, 50.0, sstep(0.2, 1.0, r)));
    amp = sstep(max(0.14, barEnd), max(0.26, barEnd + 0.1), r) * (1.0 - sstep(0.78, 0.98, r));
  }
  float n = fbm3(vec2(log(r) * 7.0, Xd * 0.9) + uSeed);
  lane *= sstep(0.28, 0.6, n);
  for (int i = 0; i < 6; i++) {
    if (float(i) >= uSpurN) break;
    vec4 s = uSpur[i];
    float l = log(r / s.x);
    if (l < 0.0 || l > s.w) continue;
    float ridgePsi = th + phase / m - uSpin * 0.12 + s.y + s.z * l;
    float d = wrapPi(psi - ridgePsi) * r * (lightModel ? cp : 1.0);
    feather = max(feather, gaussianBand(d, 0.0127) * (1.0 - l / s.w) * uSpurS[i]);
  }
  float barDust = 0.0;
  if (uBarLen > 0.0) {
    float cb = cos(uThetaBar);
    float sb = sin(uThetaBar);
    float u = vDisc.x * cb + vDisc.y * sb;
    float v = -vDisc.x * sb + vDisc.y * cb;
    float along = lightModel ? expDisc(max(0.0, abs(u) / uBarLen - 0.6), 0.2) : 1.0 - sstep(0.75, 1.0, abs(u) / uBarLen);
    float across = gaussianBand(abs(v) - 0.11 * uBarLen, 0.021 * uBarLen);
    barDust = along * across * (lightModel ? sstep(0.15 * uBarLen, 0.3 * uBarLen, abs(u)) : step(0.25 * uBarLen, abs(u)));
  }
  float a = clamp(0.9 * lane * amp + 0.7 * feather * (lightModel ? amp : 1.0) + 0.5 * barDust, 0.0, 1.0);
  // Sombrero: the far half of the lane hides behind the bulge ball (soft exponential edge in the light model).
  float behind = step(vView.z, vBulgeView.z - 0.02 * vBulgeR);
  float d = length(vView.xy - vBulgeView.xy);
  float occl = lightModel ? expDisc(d, vBulgeR * 0.45) : 1.0 - sstep(vBulgeR * 0.7, vBulgeR, d);
  a *= 1.0 - uFDepth * behind * occl;
  a = (lightModel ? ditherQuantize(a, 4.0, gl_FragCoord.xy, uDither) : floor(a * 3.0) / 3.0) * uDustFade;
  if (a <= 0.0) discard;
  gl_FragColor = vec4(uDust, a * uFade);
  #include <colorspace_fragment>
}
`;

/**
 * Bulge billboard. Lab bands: three rings + nucleus. Light model: a Sérsic
 * profile (index and effective radius seeded), normalised at the nucleus
 * radius so the cusp saturates into the nucleus, gamma-lifted so the eight
 * palette steps spread over the visible radius, then dithered (glowSprite).
 */
export const BULGE_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export const BULGE_FRAG = /* glsl */ `
uniform vec3 uNucleusColor;
uniform vec3 uCream;
uniform vec3 uGold;
uniform vec3 uOrange;
uniform float uFade;
uniform float uNucleus;
uniform float uDither;
uniform float uRe;
uniform float uN;
uniform float uGamma;
uniform vec3 uPal[8];
uniform float uSteps;
uniform float uAlphaMax;
varying vec2 vUv;
${GLSL_LIGHT}
void main() {
  float r = length(vUv);
  if (uDither > 0.5) {
    float p = sersic(r, uRe, uN) / sersic(uNucleus, uRe, uN);
    p = pow(clamp(p, 0.0, 1.0), uGamma);
    // Nucleus: a soft-edged saturated core. The billboard edge fades with the profile, never a step.
    p = max(p, 1.0 - smoothstep(uNucleus * 0.8, uNucleus * 1.4, r));
    p *= 1.0 - smoothstep(0.82, 1.0, r);
    vec4 g = glowSprite(p, uSteps, uPal, uAlphaMax, gl_FragCoord.xy, uDither);
    if (g.a <= 0.0) discard;
    gl_FragColor = vec4(g.rgb, g.a * uFade);
  } else {
    float f = exp(-pow(r / 0.5, 1.3));
    vec3 c;
    float a;
    if (r < uNucleus) { c = uNucleusColor; a = 1.0; }
    else if (f > 0.62) { c = uCream; a = 0.6; }
    else if (f > 0.33) { c = uGold; a = 0.42; }
    else if (f > 0.12) { c = uOrange; a = 0.2; }
    else discard;
    gl_FragColor = vec4(c, a * uFade);
  }
  #include <colorspace_fragment>
}
`;

/**
 * Instanced glow quads lying in the disc plane. iParams: alpha, mottle (0/1),
 * seed, kind (0 core, 1 haze, 2 companion, 3 HII complex, 4 globular).
 */
export const GLOW_VERT = /* glsl */ `
attribute vec3 iColor;
attribute vec4 iParams;
attribute vec4 iOrbit; // a, psi0, omega, y
uniform float uTime;
uniform float uPattern;
uniform float uMotion;
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vParams;
void main() {
  vUv = uv * 2.0 - 1.0;
  vColor = iColor;
  vParams = iParams;
  // The mesh lives in the pattern group (rotated by -pattern angle), so an instance that
  // orbits at omega sits at psi0 + (omega - pattern) t in this frame; pattern riders stay put.
  // uMotion is 0 under reduced motion (everything rests where it is).
  float psi = iOrbit.y + (iOrbit.z - uPattern) * uTime * uMotion;
  vec3 centre = vec3(iOrbit.x * cos(psi), iOrbit.w, iOrbit.x * sin(psi));
  vec4 local = instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(local.xyz + centre, 1.0);
}
`;

export const GLOW_FRAG = /* glsl */ `
uniform float uLight;
uniform float uTime;
uniform float uFade;
uniform float uFCore;
uniform float uFHii;
uniform float uFHalo;
uniform float uFLife;
uniform float uDither;
uniform vec3 uPaper;
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vParams;
${GLSL_NOISE}
${GLSL_THEME_TONE}
${GLSL_LIGHT}
void main() {
  float kind = vParams.w;
  if (kind < 0.5 && uFCore > 0.5) discard;
  if (kind > 2.5 && kind < 3.5 && uFHii < 0.5) discard;
  if (kind > 3.5 && uFHalo < 0.5) discard;
  float r = length(vUv);
  if (uDither > 0.5) {
    // Light model: one profile per kind, mapped through a two-colour ramp with dithering.
    float p;
    float steps = 4.0;
    if (kind > 2.5 && kind < 3.5) {
      // Giant HII complex: Gaussian heart over mottled gas, breathing a few percent when life is on.
      float breath = uFLife > 0.5 ? 0.08 * step(0.5, fract(uTime / 5.3 + vParams.z)) : 0.0;
      float n = fbm3(vUv * 2.2 + vParams.z * 13.7);
      p = gaussianBand(r * (0.85 + 0.3 * n), 0.36 + breath);
    } else if (kind > 3.5) {
      p = sersic(r, 0.35, 2.0);
      steps = 3.0;
    } else if (kind > 1.5) {
      p = sersic(r, 0.4, 1.5);
    } else if (kind > 0.5) {
      float n = fbm3(vUv * 2.6 + vParams.z * 13.7 + uTime * 0.004);
      p = expDisc(r, 0.5) * (0.35 + 1.1 * n);
      steps = 5.0;
    } else {
      p = sersic(r, 0.45, 1.0);
    }
    p *= 1.0 - smoothstep(0.8, 1.0, r);
    vec3 c = themeTone(vColor, uLight);
    vec3 dim = mix(c * 0.35, mix(c, uPaper, 0.6), uLight);
    vec3 bright = mix(mix(c, vec3(1.0), 0.45), c, uLight);
    vec4 g = glowRamp(clamp(p, 0.0, 1.0), steps, dim, bright, vParams.x * 1.3, gl_FragCoord.xy, uDither);
    if (g.a <= 0.0) discard;
    gl_FragColor = vec4(g.rgb, g.a * uFade);
    #include <colorspace_fragment>
    return;
  }
  float band;
  if (kind > 2.5 && kind < 3.5) {
    // Giant HII complex: bright heart, one halo band, breathing one cell every few seconds.
    float breath = uFLife > 0.5 ? 0.08 * step(0.5, fract(uTime / 5.3 + vParams.z)) : 0.0;
    float n = fbm3(vUv * 2.2 + vParams.z * 13.7);
    float rr = r * (0.85 + 0.3 * n);
    band = rr < 0.32 + breath ? 1.0 : rr < 0.78 + breath ? 0.45 : 0.0;
  } else if (kind > 3.5) {
    band = r < 0.4 ? 0.6 : r < 0.9 ? 0.3 : 0.0;
  } else {
    float fall = 1.0 - smoothstep(0.0, 1.0, r);
    if (vParams.y > 0.5) {
      float n = fbm3(vUv * 2.6 + vParams.z * 13.7 + uTime * 0.004);
      fall *= 0.35 + 1.1 * n;
    }
    band = floor(clamp(fall, 0.0, 0.999) * 4.0) / 4.0;
  }
  if (band <= 0.0) discard;
  gl_FragColor = vec4(themeTone(vColor, uLight), band * vParams.x * uFade);
  #include <colorspace_fragment>
}
`;

/**
 * Far layer behind the galaxy: background galaxy smudges (parallax, slow
 * counter-rotation) and the comet streak. iParams: alpha, kind (0 galaxy,
 * 1 comet), seed, unused. iPath: comet start / end in layer units.
 */
export const FAR_VERT = /* glsl */ `
attribute vec3 iColor;
attribute vec4 iParams;
attribute vec4 iPath;
uniform float uTime;
uniform float uCometPeriod;
uniform float uCometLen;
uniform float uCometWidth;
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vParams;
varying float vVis;
void main() {
  vUv = uv * 2.0 - 1.0;
  vColor = iColor;
  vParams = iParams;
  vVis = 1.0;
  if (iParams.y > 0.5) {
    // First pass 14 s after load, then every period; visible for 16 % of it (5 to 10 s).
    float t = fract((uTime - 14.0) / uCometPeriod);
    const float dur = 0.16;
    vVis = 1.0 - step(dur, t);
    float p = clamp(t / dur, 0.0, 1.0);
    vec2 a = iPath.xy;
    vec2 b = iPath.zw;
    vec2 dir = normalize(b - a);
    vec2 head = mix(a, b, p);
    vec2 off = vec2((position.x - 1.0) * 0.5 * uCometLen, position.y * uCometWidth);
    vec2 pos2 = head + vec2(dir.x * off.x - dir.y * off.y, dir.y * off.x + dir.x * off.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos2, 0.0, 1.0);
    return;
  }
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

export const FAR_FRAG = /* glsl */ `
uniform float uLight;
uniform float uFade;
uniform float uFHalo;
uniform float uFLife;
uniform float uDither;
uniform vec3 uPaper;
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vParams;
varying float vVis;
${GLSL_THEME_TONE}
${GLSL_LIGHT}
void main() {
  if (vVis < 0.5) discard;
  if (vParams.y > 0.5 ? uFLife < 0.5 : uFHalo < 0.5) discard;
  float a;
  if (vParams.y > 0.5) {
    // Comet: one-cell head, three banded tail steps that narrow toward the end.
    float x = vUv.x;
    float width = mix(0.15, 1.0, (x + 1.0) * 0.5);
    if (abs(vUv.y) > width) discard;
    a = x > 0.86 ? 1.0 : x > 0.4 ? 0.5 : x > -0.3 ? 0.25 : 0.12;
  } else if (uDither > 0.5) {
    // Background galaxy: a small Sérsic smudge with a one-cell nucleus, dithered.
    float r = length(vUv);
    float p = max(sersic(r, 0.45, 1.2), 1.0 - smoothstep(0.1, 0.2, r)) * (1.0 - smoothstep(0.8, 1.0, r));
    vec3 c = themeTone(vColor, uLight);
    vec3 dim = mix(c * 0.35, mix(c, uPaper, 0.6), uLight);
    vec3 bright = mix(mix(c, vec3(1.0), 0.4), c, uLight);
    vec4 g = glowRamp(p, 4.0, dim, bright, vParams.x * 1.2, gl_FragCoord.xy, uDither);
    if (g.a <= 0.0) discard;
    gl_FragColor = vec4(g.rgb, g.a * uFade);
    #include <colorspace_fragment>
    return;
  } else {
    float r = length(vUv);
    a = r < 0.16 ? 1.0 : r < 0.55 ? 0.5 : r < 1.0 ? 0.22 : 0.0;
  }
  if (a <= 0.0) discard;
  gl_FragColor = vec4(themeTone(vColor, uLight), a * vParams.x * uFade);
  #include <colorspace_fragment>
}
`;

/** Star shells: three depths in one draw, 1-cell or 2-cell points, optional plus shape. */
export const STAR_VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uRes;
uniform float uLight;
uniform float uFade;
attribute float size;
attribute float phase;
attribute float shape;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
${GLSL_SNAP}
${GLSL_THEME_TONE}
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = snapClip(clip, uRes);
  gl_PointSize = size;
  float tw = step(0.5, fract(uTime / (3.0 + 4.0 * phase) + phase * 3.0));
  float twinkle = size > 1.5 ? mix(0.6, 1.0, tw) : 1.0;
  vColor = themeTone(color, uLight) * twinkle;
  vAlpha = uFade;
  vShape = shape;
}
`;

export const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
void main() {
  vec3 c = vColor;
  float a = vAlpha;
  if (vShape > 0.5) {
    // 3x3 plus: centre bright, arms soft, corners empty.
    vec2 q = floor(gl_PointCoord * 3.0);
    bool centre = q.x == 1.0 && q.y == 1.0;
    if (q.x != 1.0 && q.y != 1.0) discard;
    if (!centre) a *= 0.45;
  }
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}
`;

/** Far Milky Way band: low-contrast cream strip with brown dust bites, drifting 260 s. */
export const BAND_FRAG = /* glsl */ `
uniform float uLight;
uniform float uTime;
uniform float uFade;
uniform vec3 uCream;
uniform vec3 uDust;
varying vec2 vUv;
${GLSL_NOISE}
${GLSL_THEME_TONE}
void main() {
  vec2 p = vUv * vec2(6.0, 1.0) + vec2(uTime / 260.0, 0.0);
  float band = exp(-pow((vUv.y - 0.5) / 0.16, 2.0));
  float n = fbm3(p * 2.0);
  float dust = smoothstep(0.55, 0.75, fbm3(p * 3.0 + 31.0));
  float alpha = band * (0.5 + 0.5 * n) * uFade;
  alpha = floor(alpha * 5.0) / 5.0;
  if (alpha <= 0.0) discard;
  vec3 c = mix(uCream, uDust, dust * 0.8);
  gl_FragColor = vec4(themeTone(c, uLight), alpha);
  #include <colorspace_fragment>
}
`;

export const BAND_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
