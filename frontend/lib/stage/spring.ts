/**
 * Stage camera motion (ported verbatim from the space lab's Stage v2
 * `spring.ts`): one damped spring on the log-distance axis `L` (world 0 ..
 * galaxy 3). Pure, no three.js.
 *
 * The state is (x, v, target). Buttons and the wheel only ever move the
 * `target`; the acceleration follows, so x and v stay continuous through
 * every retarget, every chained hop and every wheel impulse. Rest stops are
 * attractors: a hop never snaps, it settles. Returns (toward lower L) run
 * on a stiffer spring, which is the asymmetry the old director hand-timed.
 */

export interface SpringParams {
  /** Natural frequency omega (rad/s). From rest, 95 % of the way takes ~4.7 / omega at zeta 1. */
  omega: number;
  /** Damping ratio: 1 critical (no overshoot), below 1 overshoots, above 1 drags. */
  zeta: number;
  /** Multiplier on omega while the target is below x (dives land faster than climbs). */
  returnFactor: number;
  /** Velocity kick (L/s) toward a new target when a button is pressed from rest; 0 disables. */
  kick: number;
  /** Speed cap (L/s): long chained hops cruise instead of doubling their peak zoom rate. */
  vMax: number;
}

export interface SpringState {
  x: number;
  v: number;
  target: number;
}

export const L_MIN = 0;
export const L_MAX = 3;
export const STOPS: readonly number[] = [0, 1, 2, 3];

export const DEFAULT_SPRING: SpringParams = { omega: 4.2, zeta: 1, returnFactor: 1.3, kick: 0.4, vMax: 1.5 };

/** Integration substep (s). Semi-implicit Euler is stable for omega << 2 / h. */
const SUBSTEP = 1 / 480;
/** Below this speed and distance the spring is considered at rest. */
export const REST_V = 0.004;
export const REST_X = 0.0015;

export function clampL(L: number): number {
  return L < L_MIN ? L_MIN : L > L_MAX ? L_MAX : L;
}

export function nearestStop(L: number): number {
  return Math.round(clampL(L));
}

export function createSpring(x = 1): SpringState {
  return { x, v: 0, target: x };
}

/** Effective omega for the current direction of travel. */
export function omegaFor(s: SpringState, p: SpringParams): number {
  return s.target < s.x ? p.omega * p.returnFactor : p.omega;
}

/**
 * Advance the spring by `dt` seconds (any size; substepped internally). Mutates and returns `s`.
 *
 * Written as a velocity tracker: the desired speed is (omega / 2 zeta) x the remaining
 * distance, clamped to the cap, and the actual speed relaxes toward it at 2 zeta omega.
 * Uncapped this is exactly x'' = omega^2 (target - x) - 2 zeta omega x' (the damped
 * spring); capped, long hops ease up to the cruise speed instead of jumping to it,
 * cruise, then hand over to the same critically damped approach for the last stretch.
 */
export function stepSpring(s: SpringState, dt: number, p: SpringParams): SpringState {
  if (!(dt > 0)) return s;
  let remaining = Math.min(dt, 0.25);
  while (remaining > 0) {
    const h = Math.min(SUBSTEP, remaining);
    remaining -= h;
    const w = omegaFor(s, p);
    const z = Math.max(0.05, p.zeta);
    let vDes = ((w / (2 * z)) * (s.target - s.x));
    if (p.vMax > 0) vDes = Math.max(-p.vMax, Math.min(p.vMax, vDes));
    s.v += 2 * z * w * (vDes - s.v) * h;
    s.x += s.v * h;
  }
  if (Math.abs(s.v) < REST_V && Math.abs(s.target - s.x) < REST_X) {
    s.v = 0;
    s.x = s.target;
  }
  return s;
}

export function atRest(s: SpringState): boolean {
  return s.v === 0 && s.x === s.target;
}

/**
 * Point the spring at a new target (a button press). Mid-flight this changes
 * only the acceleration: v is untouched. From rest, an optional kick starts
 * the move with a little velocity so the first frames are not a dead zone.
 */
export function retarget(s: SpringState, target: number, p: SpringParams): SpringState {
  const t = clampL(target);
  const wasRest = atRest(s);
  s.target = t;
  if (wasRest && p.kick > 0 && t !== s.x) s.v = Math.sign(t - s.x) * p.kick;
  return s;
}

/** L per CSS pixel of wheel travel. */
export const WHEEL_L_PER_PX = 0.0022;

/** Wheel input moves the target (never x or v): a running hop simply bends toward the new target. */
export function wheelNudge(s: SpringState, deltaY: number): SpringState {
  s.target = clampL(s.target + deltaY * WHEEL_L_PER_PX);
  return s;
}

/**
 * After the wheel goes idle, let the nearest stop attract the camera. The
 * stop is chosen from where the spring is heading (x plus a short look-ahead
 * of its velocity), so a fling carries over a threshold instead of bouncing back.
 */
export function settleToStop(s: SpringState, lookAheadS = 0.35): SpringState {
  const heading = clampL(s.x + s.v * lookAheadS);
  // Momentum wins: whichever of "where the wheel asked for" and "where we are heading" is further along the travel direction.
  const pick = s.v > 0 ? Math.max(heading, s.target) : s.v < 0 ? Math.min(heading, s.target) : s.target;
  s.target = nearestStop(pick);
  return s;
}

/** Time (s) for a hop of `distance` L from rest to come within `eps` of the target (simulated, so the cap counts). */
export function hopDurationEstimate(distance: number, p: SpringParams, eps = 0.02): number {
  const d = Math.abs(distance);
  if (d <= eps) return 0;
  const s = retarget(createSpring(0), d, { ...p, kick: 0 });
  const h = 1 / 240;
  for (let t = 0; t < 30; t += h) {
    stepSpring(s, h, p);
    if (Math.abs(s.x - d) <= eps) return t + h;
  }
  return 30;
}

/** Closed-form time for an uncapped critically damped hop (reference). */
export function hopDurationCritical(distance: number, p: SpringParams, eps = 0.02): number {
  const w = p.omega;
  const d = Math.abs(distance);
  if (d <= eps) return 0;
  // (1 + w t) e^{-w t} = eps / d, solved by bisection on w t.
  let lo = 0;
  let hi = 60;
  const target = eps / d;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if ((1 + mid) * Math.exp(-mid) > target) lo = mid;
    else hi = mid;
  }
  return hi / w;
}
