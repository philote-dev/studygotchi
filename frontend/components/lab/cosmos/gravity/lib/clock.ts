/**
 * One time source for the gravity lab. `seconds` drives spin, beads, fountains
 * and swirl and is what hit-stop slows; `real` is wall time and drives the
 * beat envelopes (so an 80 ms hit-stop still ends after 80 ms). `frozenAt`
 * pins both for frame captures (`?t=`): a beat started while frozen records
 * startedAt = 0, so `?beat=mastered&t=120` is frame 120 ms of that beat.
 */
export class GravityClock {
  seconds = 0;
  real = 0;
  /** Real-time seconds remaining in a hit-stop (time scale 0.1 while > 0). */
  hitStop = 0;
  frozenAt: number | null = null;

  advance(dtReal: number): number {
    if (this.frozenAt !== null) {
      this.seconds = this.frozenAt;
      this.real = this.frozenAt;
      return 0;
    }
    const dt = Math.min(dtReal, 0.1);
    this.real += dt;
    let factor = 1;
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - dt);
      factor = 0.1;
    }
    this.seconds += dt * factor;
    return dt * factor;
  }

  stop(realSeconds: number): void {
    this.hitStop = Math.max(this.hitStop, realSeconds);
  }

  /** Wall time a beat should record as its start (0 while frozen for `?t=` captures). */
  beatStart(): number {
    return this.frozenAt !== null ? 0 : this.real;
  }
}

export const gravityClock = new GravityClock();
