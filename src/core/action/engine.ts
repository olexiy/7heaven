import type { Sim } from '../sim/sim';
import type { Entity } from '../entity/entity';
import type { ActionDef, ActionInstance, Target } from './action';
import { currentPhase } from './action';
import type { Vec } from '../world/map';
import { chebyshev } from '../world/map';
import { hasLineOfSight } from '../world/fov';
import { secToTicks } from '../time';
import { clamp01, resolveParam, type RuleContext } from '../rules/modifiers';
import { collectModifiers } from '../rules/collect';
import { DIAGONAL_STEP_FACTOR } from '../../data/actions';
import { resolveAction } from './resolve';

export type StartResult = { ok: true; instance: ActionInstance } | { ok: false; reason: string };

/** Resolve the target entity of an instance (if it targets an entity and it is alive). */
export function targetEntity(sim: Sim, a: ActionInstance): Entity | undefined {
  if (a.target?.kind === 'entity') {
    const e = sim.entities.get(a.target.id);
    return e && e.alive ? e : undefined;
  }
  return undefined;
}

export function targetPos(sim: Sim, a: ActionInstance): Vec | undefined {
  if (!a.target) return undefined;
  if (a.target.kind === 'tile') return a.target.pos;
  return targetEntity(sim, a)?.pos;
}

function phaseTicks(sim: Sim, actor: Entity, def: ActionDef, phaseIndex: number, stepTo: Vec | null): number {
  const phase = def.phases[phaseIndex]!;
  let base = phase.baseDuration;
  if (def.kind === 'step' && stepTo) {
    const diag = stepTo.x !== actor.pos.x && stepTo.y !== actor.pos.y;
    if (diag) base *= DIAGONAL_STEP_FACTOR;
  }
  const ctx: RuleContext = { actor, action: def, phase };
  const r = resolveParam('duration', base, ctx, collectModifiers(ctx));
  void sim;
  return secToTicks(r.value);
}

/** Validate and start an action. Only hard rule: required channels must be free. */
export function startAction(sim: Sim, actor: Entity, def: ActionDef, target: Target | null): StartResult {
  if (!actor.alive) return { ok: false, reason: 'dead' };
  if (!actor.channelsFree(def.channels)) return { ok: false, reason: 'channelBusy' };
  if (def.cost?.mana && actor.mana < def.cost.mana) return { ok: false, reason: 'noMana' };

  let stepTo: Vec | null = null;
  if (def.kind === 'step') {
    if (!target || target.kind !== 'tile') return { ok: false, reason: 'noTarget' };
    if (chebyshev(actor.pos, target.pos) !== 1) return { ok: false, reason: 'notAdjacent' };
    if (!sim.map.isFloor(target.pos.x, target.pos.y)) return { ok: false, reason: 'wall' };
    if (sim.entityAt(target.pos)) return { ok: false, reason: 'occupied' };
    stepTo = target.pos;
  } else if (def.range !== undefined) {
    if (!target) return { ok: false, reason: 'noTarget' };
    const tp = target.kind === 'tile' ? target.pos : sim.entities.get(target.id)?.pos;
    if (!tp) return { ok: false, reason: 'noTarget' };
    if (chebyshev(actor.pos, tp) > def.range) return { ok: false, reason: 'outOfRange' };
    if (def.needsLos && !hasLineOfSight(sim.map, actor.pos, tp)) return { ok: false, reason: 'noLos' };
  }

  const instance: ActionInstance = {
    def,
    actor: actor.id,
    target,
    phaseIndex: 0,
    remaining: 0,
    phaseTotal: 0,
    accumulated: 0,
    startedTick: sim.tick,
    stepTo,
  };
  instance.phaseTotal = phaseTicks(sim, actor, def, 0, stepTo);
  instance.remaining = instance.phaseTotal;
  for (const c of def.channels) actor.channels.set(c, instance);
  sim.emit({ type: 'actionStarted', id: actor.id, action: def.id, channels: def.channels });
  if (def.kind === 'shield') {
    // Shield raises: 'shielded' status appears when hold phase begins.
  }
  return { ok: true, instance };
}

function releaseChannels(actor: Entity, a: ActionInstance): void {
  for (const c of a.def.channels) {
    if (actor.channels.get(c) === a) actor.channels.set(c, null);
  }
  if (a.def.kind === 'shield') actor.statuses.delete('shielded');
}

/** Apply the cancel policy of the current phase (mana loss etc.). */
function applyCancelPolicy(a: ActionInstance): void {
  const phase = currentPhase(a);
  if (phase.onCancel === 'keep') return;
  // Mana accumulated during gather is already deducted from the pool; losing it means no refund.
  // For 'loseAll' the full cost is also gone. Nothing to refund in either case.
  a.accumulated = 0;
}

export function cancelAction(sim: Sim, actor: Entity, a: ActionInstance): void {
  const phase = currentPhase(a);
  applyCancelPolicy(a);
  releaseChannels(actor, a);
  sim.emit({ type: 'actionCancelled', id: actor.id, action: a.def.id, phase: phase.id });
}

/** External interruption (e.g. kick during gather). Returns true if the action was broken. */
export function tryInterrupt(sim: Sim, attacker: Entity, target: Entity, chance: number): boolean {
  for (const a of target.runningActions()) {
    const phase = currentPhase(a);
    if (!phase.interruptible) continue;
    if (sim.rng.chance(clamp01(chance))) {
      applyCancelPolicy(a);
      releaseChannels(target, a);
      sim.emit({ type: 'interrupted', attacker: attacker.id, target: target.id, action: a.def.id });
      return true;
    }
  }
  return false;
}

/** One tick of an action. Called once per instance per tick. */
export function advanceAction(sim: Sim, actor: Entity, a: ActionInstance): void {
  const def = a.def;
  const phase = currentPhase(a);

  // Spell gather: mana flows in over the phase.
  if (def.kind === 'spell' && phase.id === 'gather' && def.cost?.mana) {
    const perTick = def.cost.mana / a.phaseTotal;
    const take = Math.min(perTick, actor.mana);
    actor.mana -= take;
    a.accumulated += take;
  }

  a.remaining--;
  if (a.remaining > 0) return;

  // Phase end: failure check.
  const ctx: RuleContext = { actor, action: def, phase, target: targetEntity(sim, a) };
  if (phase.failBase > 0) {
    const fail = resolveParam('failChance', phase.failBase, ctx, collectModifiers(ctx));
    if (sim.rng.chance(clamp01(fail.value))) {
      releaseChannels(actor, a);
      sim.emit({ type: 'actionFailed', id: actor.id, action: def.id, phase: phase.id, reason: fail.trace.map((t) => t.source).join(',') });
      resolveAction(sim, actor, a, 'failed');
      return;
    }
  }

  if (a.phaseIndex < def.phases.length - 1) {
    a.phaseIndex++;
    a.phaseTotal = phaseTicks(sim, actor, def, a.phaseIndex, a.stepTo);
    a.remaining = a.phaseTotal;
    const next = currentPhase(a);
    if (def.kind === 'shield' && next.id === 'hold') actor.statuses.add('shielded');
    sim.emit({ type: 'phaseChanged', id: actor.id, action: def.id, phase: next.id });
    return;
  }

  releaseChannels(actor, a);
  resolveAction(sim, actor, a, 'done');
  sim.emit({ type: 'actionDone', id: actor.id, action: def.id });
}
