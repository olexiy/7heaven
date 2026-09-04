import type { Sim } from '../sim/sim';
import type { Entity } from '../entity/entity';
import type { ActionDef, ActionInstance } from '../action/action';
import { clamp01, resolveParam, type RuleContext, type TraceEntry } from './modifiers';
import { collectModifiers } from './collect';
import { BASE } from '../../data/rules';
import { chebyshev } from '../world/map';
import { isBlindTo } from '../action/resolve';

export type RiskLevel = 'sure' | 'risky' | 'hopeless';

export interface Risk {
  level: RiskLevel;
  /** Probability of success (0..1). */
  chance: number;
  /** Sources that made it worse, e.g. 'status:moving'. */
  causes: string[];
}

function level(chance: number): RiskLevel {
  if (chance >= 0.6) return 'sure';
  if (chance >= 0.3) return 'risky';
  return 'hopeless';
}

function badCauses(trace: TraceEntry[], worseIsHigher: boolean): string[] {
  return trace
    .filter((t) => (t.op === 'mul' ? (worseIsHigher ? t.value > 1 : t.value < 1) : worseIsHigher ? t.value > 0 : t.value < 0))
    .map((t) => t.source);
}

/**
 * Estimate how an action would go for the actor right now, without rolling dice.
 * Used by the UI for the verbal hint on the action ring. Never shows numbers to the player.
 */
export function assessAction(sim: Sim, actor: Entity, def: ActionDef, target?: Entity, targetPosDist?: number): Risk {
  if (def.kind === 'spell') {
    // Chance to get through every phase without failing, times chance to hit.
    let success = 1;
    const causes: string[] = [];
    for (const phase of def.phases) {
      if (phase.failBase <= 0) continue;
      const ctx: RuleContext = { actor, action: def, phase, target };
      const fail = resolveParam('failChance', phase.failBase, ctx, collectModifiers(ctx));
      success *= 1 - clamp01(fail.value);
      causes.push(...badCauses(fail.trace, true));
    }
    const dist = targetPosDist ?? (target ? chebyshev(actor.pos, target.pos) : 0);
    const ctx: RuleContext = { actor, action: def, target };
    const hit = resolveParam('hitChance', BASE.hitChance - dist * BASE.spellMissPerTile, ctx, collectModifiers(ctx));
    success *= clamp01(hit.value);
    if (dist > 6) causes.push('distance');
    return { level: level(success), chance: success, causes: [...new Set(causes)] };
  }
  if (def.kind === 'melee') {
    if (!target) return { level: 'hopeless', chance: 0, causes: ['noTarget'] };
    const targetBlind = isBlindTo(sim, target, actor.pos);
    const ctx: RuleContext = { actor, target, action: def, targetBlind };
    const mods = collectModifiers(ctx);
    const hit = resolveParam('hitChance', BASE.hitChance, ctx, mods);
    const dodge = resolveParam('dodgeChance', BASE.dodgeChance, ctx, mods);
    const success = clamp01(hit.value) * (1 - clamp01(dodge.value));
    const causes = [...badCauses(hit.trace, false), ...badCauses(dodge.trace, true)];
    return { level: level(success), chance: success, causes: [...new Set(causes)] };
  }
  return { level: 'sure', chance: 1, causes: [] };
}

/** Risk of the phase currently running (for spells: chance the current or next failing phase breaks). */
export function assessRunning(sim: Sim, actor: Entity, a: ActionInstance): Risk | null {
  if (a.def.kind !== 'spell') return null;
  let success = 1;
  const causes: string[] = [];
  for (let i = a.phaseIndex; i < a.def.phases.length; i++) {
    const phase = a.def.phases[i]!;
    if (phase.failBase <= 0) continue;
    const ctx: RuleContext = { actor, action: a.def, phase };
    const fail = resolveParam('failChance', phase.failBase, ctx, collectModifiers(ctx));
    success *= 1 - clamp01(fail.value);
    causes.push(...badCauses(fail.trace, true));
  }
  void sim;
  return { level: level(success), chance: success, causes: [...new Set(causes)] };
}

export const RISK_TEXT: Record<RiskLevel, string> = { sure: 'уверенно', risky: 'рискованно', hopeless: 'безнадёжно' };

export const CAUSE_TEXT: Record<string, string> = {
  'status:moving': 'вы движетесь',
  'status:wounded': 'вы ранены',
  'target:agi': 'цель ловкая',
  'attr:agi': 'вы неуклюжи',
  distance: 'далеко',
  noTarget: 'нет цели',
};
