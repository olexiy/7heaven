/** Fixed simulation step. All durations inside core are integer ticks. */
export const TICK_MS = 50;
export const TICKS_PER_SEC = 1000 / TICK_MS;

export function secToTicks(seconds: number): number {
  return Math.max(1, Math.round(seconds * TICKS_PER_SEC));
}

export function ticksToSec(ticks: number): number {
  return ticks / TICKS_PER_SEC;
}
