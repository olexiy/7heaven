import { Sim, type Command } from '../../src/core/sim/sim';
import { Entity, type EntitySpec } from '../../src/core/entity/entity';
import type { Vec } from '../../src/core/world/map';
import type { GameEvent } from '../../src/core/events';
import { ENTITIES } from '../../src/data/entities';
import { ACTIONS } from '../../src/data/actions';
import { skillSpeedFactor } from '../../src/data/rules';
import { secToTicks } from '../../src/core/time';
import { mapFromAscii } from '../world/fixtures';

/** An open rectangular room of w×h floor tiles surrounded by walls. Interior coordinates are 1..w, 1..h. */
export function openRoom(w: number, h: number, playerStart: Vec, exit: Vec = { x: w, y: h }) {
  const rows: string[] = ['#'.repeat(w + 2)];
  for (let y = 0; y < h; y++) rows.push(`#${'.'.repeat(w)}#`);
  rows.push('#'.repeat(w + 2));
  return { map: mapFromAscii(rows), playerStart, exit };
}

export function newSim(seed: number, w: number, h: number, playerStart: Vec): Sim {
  return new Sim({ seed, fixedMap: openRoom(w, h, playerStart) });
}

export interface Timed {
  tick: number;
  ev: GameEvent;
}

/** Step the sim `ticks` times and return every event stamped with the tick it happened on. */
export function run(sim: Sim, ticks: number): Timed[] {
  const out: Timed[] = [];
  for (let i = 0; i < ticks; i++) {
    for (const ev of sim.step()) out.push({ tick: sim.tick, ev });
  }
  return out;
}

/**
 * Run until `untilTick`, issuing each scheduled command when `sim.tick` equals its tick
 * (before that tick's step, i.e. the same way a UI would issue it).
 */
export function runScheduled(sim: Sim, schedule: readonly (readonly [number, Command])[], untilTick: number): Timed[] {
  const out: Timed[] = [];
  const pending = [...schedule].sort((a, b) => a[0] - b[0]);
  while (sim.tick < untilTick) {
    while (pending.length > 0 && pending[0]![0] <= sim.tick) sim.command(pending.shift()![1]);
    for (const ev of sim.step()) out.push({ tick: sim.tick, ev });
  }
  return out;
}

/**
 * Spawn an entity whose AI never acts. `aiStep` returns while `tick < reactUntil`; perception only
 * rewrites `reactUntil` on the transition into 'combat', so pinning awareness to 'combat' first
 * keeps the huge value in place. Hearing also ignores entities already in combat.
 */
export function spawnDummy(sim: Sim, spec: EntitySpec, pos: Vec): Entity {
  const e = sim.spawn(spec, pos);
  e.awareness = 'combat';
  e.reactUntil = Number.MAX_SAFE_INTEGER;
  return e;
}

export const GHOUL: EntitySpec = ENTITIES['ghoul']!;

/** Same ghoul, but it sees nothing beyond its own tile (computeFov with radius 0). */
export const BLIND_GHOUL: EntitySpec = { ...GHOUL, kind: 'ghoulBlind', name: 'Слепой гуль', sight: 0 };

/** Ticks a single-phase action takes for an actor with the given governing skill level. */
export function actionTicks(actionId: string, skillLevel: number): number {
  const def = ACTIONS[actionId]!;
  const base = def.phases.reduce((s, p) => s + p.baseDuration, 0);
  return secToTicks(base * skillSpeedFactor(skillLevel));
}

/** Ticks of one phase of an action for the given skill level. */
export function phaseTicks(actionId: string, phaseId: string, skillLevel: number): number {
  const phase = ACTIONS[actionId]!.phases.find((p) => p.id === phaseId);
  if (!phase) throw new Error(`No phase ${phaseId} in ${actionId}`);
  return secToTicks(phase.baseDuration * skillSpeedFactor(skillLevel));
}

export function ghoulSkill(skill: 'unarmed' | 'sword' | 'shield' | 'fire'): number {
  return GHOUL.skills?.[skill] ?? 0;
}

export function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}
