import type { Sim } from '../sim/sim';
import type { Entity, SkillId } from '../entity/entity';
import type { ActionInstance } from './action';
import { chebyshev } from '../world/map';
import { clamp01, resolveParam, type RuleContext } from '../rules/modifiers';
import { collectModifiers } from '../rules/collect';
import { BASE, challengeXp, xpToNext } from '../../data/rules';
import { PROJECTILE_TILES_PER_SEC } from '../../data/actions';
import { secToTicks } from '../time';
import { targetEntity, targetPos, tryInterrupt } from './engine';

export type Outcome = 'done' | 'failed';

/** Difficulty of a situation for the challenge rule. */
function situationDifficulty(actor: Entity, target: Entity | undefined, crit: boolean): number {
  let d = 1;
  if (target) {
    // Enemy skill and toughness raise difficulty.
    const tSkill = Math.max(...[...target.skills.values()].map((s) => s.level), 0);
    d += tSkill;
    d += Math.round((target.maxHp - 40) / 20);
  }
  if (crit) d += 2;
  if (actor.isMoving()) d += 1;
  if (actor.hp < actor.maxHp * BASE.woundedBelow) d += 1;
  return Math.max(1, d);
}

export function grantXp(sim: Sim, actor: Entity, skill: SkillId, difficulty: number): void {
  const st = actor.skills.get(skill);
  if (!st) return;
  const gain = challengeXp(st.level, difficulty);
  if (gain <= 0) return;
  st.xp += gain;
  let levelUp = false;
  while (st.xp >= xpToNext(st.level)) {
    st.xp -= xpToNext(st.level);
    st.level++;
    levelUp = true;
  }
  sim.emit({ type: 'xp', id: actor.id, skill, amount: gain, levelUp });
}

function applyDamage(sim: Sim, attacker: Entity, target: Entity, raw: number, actionId: string, crit: boolean): void {
  const ctx: RuleContext = { actor: attacker, target, action: sim.actionDef(actionId) };
  const taken = resolveParam('damageTaken', raw, ctx, collectModifiers(ctx));
  const dmg = Math.max(0, Math.round(taken.value));
  const absorbed = Math.round(raw) - dmg;
  if (absorbed > 0) {
    sim.emit({ type: 'blocked', target: target.id, absorbed });
    if (target.statuses.has('shielded')) grantXp(sim, target, 'shield', situationDifficulty(target, attacker, false));
  }
  target.hp -= dmg;
  target.lastHitTick = sim.tick;
  sim.emit({ type: 'hit', attacker: attacker.id, target: target.id, damage: dmg, crit, action: actionId });
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    for (const a of target.runningActions()) {
      for (const c of a.def.channels) target.channels.set(c, null);
    }
    target.statuses.clear();
    sim.emit({ type: 'died', id: target.id });
  }
}

function resolveMelee(sim: Sim, actor: Entity, a: ActionInstance): void {
  const def = a.def;
  const target = targetEntity(sim, a);
  if (!target) return;
  if (chebyshev(actor.pos, target.pos) > (def.range ?? 1)) {
    sim.emit({ type: 'missed', attacker: actor.id, target: target.id, action: def.id, reason: 'miss' });
    return;
  }
  const targetBlind = !target.visible.has(sim.map.idx(actor.pos.x, actor.pos.y));
  const ctx: RuleContext = { actor, target, action: def, targetBlind };
  const mods = collectModifiers(ctx);

  const hit = resolveParam('hitChance', BASE.hitChance, ctx, mods);
  if (!sim.rng.chance(clamp01(hit.value))) {
    sim.emit({ type: 'missed', attacker: actor.id, target: target.id, action: def.id, reason: 'miss' });
    return;
  }
  const dodge = resolveParam('dodgeChance', BASE.dodgeChance, ctx, mods);
  if (sim.rng.chance(clamp01(dodge.value))) {
    sim.emit({ type: 'missed', attacker: actor.id, target: target.id, action: def.id, reason: 'dodge' });
    return;
  }
  const crit = sim.rng.chance(clamp01(resolveParam('critChance', BASE.critChance, ctx, mods).value));
  const [dmin, dmax] = def.damage ?? [0, 0];
  const base = sim.rng.int(dmin, dmax) * (crit ? 2 : 1);
  const dmg = resolveParam('damage', base, ctx, mods).value;
  applyDamage(sim, actor, target, dmg, def.id, crit);

  if (def.interruptChance && target.alive) {
    const ic = resolveParam('interruptChance', def.interruptChance, ctx, mods).value;
    tryInterrupt(sim, actor, target, ic);
  }
  if (def.noise) sim.emit({ type: 'noise', at: actor.pos, radius: def.noise, source: actor.id });
  if (def.skill) grantXp(sim, actor, def.skill, situationDifficulty(actor, target, crit));
}

function resolveSpell(sim: Sim, actor: Entity, a: ActionInstance): void {
  const def = a.def;
  const tp = targetPos(sim, a);
  if (!tp) return;
  const dist = chebyshev(actor.pos, tp);
  const ticks = secToTicks(dist / PROJECTILE_TILES_PER_SEC);
  sim.emit({ type: 'projectile', from: actor.pos, to: tp, action: def.id, ticks });
  if (def.noise) sim.emit({ type: 'noise', at: tp, radius: def.noise, source: actor.id });

  // Impact resolves immediately in sim terms; the renderer animates the flight.
  const target = sim.entityAt(tp);
  const ctx: RuleContext = { actor, target, action: def };
  const mods = collectModifiers(ctx);
  const hitBase = BASE.hitChance - dist * BASE.spellMissPerTile;
  const hit = resolveParam('hitChance', hitBase, ctx, mods);
  if (!target) {
    if (def.skill) grantXp(sim, actor, def.skill, 1);
    return;
  }
  if (!sim.rng.chance(clamp01(hit.value))) {
    sim.emit({ type: 'missed', attacker: actor.id, target: target.id, action: def.id, reason: 'miss' });
    return;
  }
  const crit = sim.rng.chance(clamp01(resolveParam('critChance', BASE.critChance, ctx, mods).value));
  const [dmin, dmax] = def.damage ?? [0, 0];
  const dmg = resolveParam('damage', sim.rng.int(dmin, dmax) * (crit ? 2 : 1), ctx, mods).value;
  applyDamage(sim, actor, target, dmg, def.id, crit);
  if (def.skill) grantXp(sim, actor, def.skill, situationDifficulty(actor, target, crit) + 1);
}

function resolveStep(sim: Sim, actor: Entity, a: ActionInstance): void {
  const to = a.stepTo;
  if (!to) return;
  if (sim.entityAt(to)) return; // someone stepped in first; stay put
  const from = actor.pos;
  actor.pos = to;
  sim.emit({ type: 'moved', id: actor.id, from, to });
}

/** Called when an action ends (last phase done) or fails mid-way. */
export function resolveAction(sim: Sim, actor: Entity, a: ActionInstance, outcome: Outcome): void {
  if (outcome === 'failed') {
    if (a.def.kind === 'spell') {
      const backlash = Math.round(actor.maxHp * BASE.backlashFrac);
      actor.hp = Math.max(1, actor.hp - backlash);
      actor.lastHitTick = sim.tick;
      // A failed formation still teaches control.
      if (a.def.skill) grantXp(sim, actor, a.def.skill, 2);
    }
    return;
  }
  switch (a.def.kind) {
    case 'step':
      resolveStep(sim, actor, a);
      break;
    case 'melee':
      resolveMelee(sim, actor, a);
      break;
    case 'spell':
      resolveSpell(sim, actor, a);
      break;
    case 'shield':
      break;
  }
}
