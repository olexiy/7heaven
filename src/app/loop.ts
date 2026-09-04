import { TICK_MS } from '../core/time';

export type Speed = 0 | 1 | 2 | 5 | 10;

/** Converts wall-clock time into a whole number of simulation ticks. */
export class TimeController {
  paused = true;
  speed: Speed = 1;
  private acc = 0;
  /** Fraction of the next tick elapsed, for render interpolation. */
  alpha = 0;

  togglePause(): void {
    this.paused = !this.paused;
  }

  setSpeed(s: Speed): void {
    if (s === 0) {
      this.paused = true;
      return;
    }
    this.speed = s;
    this.paused = false;
  }

  /** Auto fast-forward: when nothing threatens the player, run at this speed. */
  autoFast = true;
  /** Set by the app each frame: true if the world is calm and a long action is running. */
  calm = false;

  effectiveSpeed(): number {
    return this.autoFast && this.calm ? Math.max(this.speed, 5) : this.speed;
  }

  /** Returns how many ticks to run for this frame. */
  update(dtMs: number): number {
    if (this.paused) return 0;
    this.acc += Math.min(dtMs, 250) * this.effectiveSpeed();
    const n = Math.floor(this.acc / TICK_MS);
    this.acc -= n * TICK_MS;
    this.alpha = this.acc / TICK_MS;
    return Math.min(n, 200);
  }
}
