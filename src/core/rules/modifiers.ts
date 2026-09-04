import type { Entity } from '../entity/entity';
import type { ActionDef, PhaseDef } from '../action/action';

/** Where in the resolution pipeline a modifier applies. */
export type Stage = 'ready' | 'prepare' | 'phase' | 'resolve' | 'after';

/** Parameters that can be modified. Kept as a union so typos fail at compile time. */
export type Param =
  | 'duration' // action / phase duration multiplier basis (seconds)
  | 'failChance' // chance the current phase fails at its end
  | 'hitChance' // attacker's chance to connect
  | 'dodgeChance' // defender's chance to evade
  | 'damage' // outgoing damage
  | 'damageTaken' // incoming damage after mitigation
  | 'interruptChance' // chance an interrupting hit breaks a phase
  | 'critChance';

export interface RuleContext {
  actor: Entity;
  target?: Entity;
  action: ActionDef;
  phase?: PhaseDef;
  /** True if the target cannot see the actor (attack from blind spot / fog). */
  targetBlind?: boolean;
}

export interface Modifier {
  stage: Stage;
  param: Param;
  op: 'add' | 'mul';
  value: number;
  /** Human-readable origin: skill id, status id, item id. */
  source: string;
  /** Optional condition; modifier applies only when it returns true. */
  when?: (ctx: RuleContext) => boolean;
}

export interface TraceEntry {
  source: string;
  op: 'add' | 'mul';
  value: number;
}

export interface Resolved {
  value: number;
  trace: TraceEntry[];
}

/**
 * Apply all matching modifiers to a base value.
 * Order: all `add` first, then all `mul`. The trace records what applied — used for
 * debugging and for the verbal risk hint on the action ring.
 */
export function resolveParam(
  param: Param,
  base: number,
  ctx: RuleContext,
  mods: readonly Modifier[],
): Resolved {
  const trace: TraceEntry[] = [];
  let value = base;
  const applicable = mods.filter((m) => m.param === param && (!m.when || m.when(ctx)));
  for (const m of applicable) {
    if (m.op === 'add') {
      value += m.value;
      trace.push({ source: m.source, op: 'add', value: m.value });
    }
  }
  for (const m of applicable) {
    if (m.op === 'mul') {
      value *= m.value;
      trace.push({ source: m.source, op: 'mul', value: m.value });
    }
  }
  return { value, trace };
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
