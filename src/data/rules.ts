import type { Modifier, RuleContext } from '../core/rules/modifiers';
import type { Entity, SkillId } from '../core/entity/entity';

/**
 * Modifier sources. Everything that changes a number in the pipeline is declared here.
 * Core collects these per context; it never hardcodes rule numbers.
 */

/** Skill level → duration multiplier: level 10 ≈ 0.6× (2.0 s sword → 1.2 s). */
export function skillSpeedFactor(level: number): number {
  return Math.max(0.4, 1 - level * 0.04);
}

/** Skill level → accuracy bonus (additive to hit chance). */
export function skillAccuracyBonus(level: number): number {
  return level * 0.02;
}

/** Base numbers for resolution. */
export const BASE = {
  hitChance: 0.85,
  dodgeChance: 0.1,
  critChance: 0.05,
  /** Attribute 10 is "average": each point above/below shifts by this fraction. */
  attrStep: 0.03,
  /** How much a moving caster raises spell failure. */
  movingFailMul: 20,
  woundedFailMul: 3,
  /** HP fraction below which an entity counts as wounded. */
  woundedBelow: 0.3,
  /** Fireball miss chance grows with distance. */
  spellMissPerTile: 0.03,
  /** Backlash damage on a failed formation, fraction of maxHp. */
  backlashFrac: 0.05,
};

/** Modifiers granted by a skill at a given level. */
export function skillModifiers(skill: SkillId, level: number): Modifier[] {
  const mods: Modifier[] = [];
  if (level <= 0) return mods;
  mods.push({
    stage: 'prepare',
    param: 'duration',
    op: 'mul',
    value: skillSpeedFactor(level),
    source: `skill:${skill}`,
  });
  mods.push({
    stage: 'resolve',
    param: 'hitChance',
    op: 'add',
    value: skillAccuracyBonus(level),
    source: `skill:${skill}`,
  });
  if (skill === 'fire') {
    // Mana control: each level cuts failure chance.
    mods.push({
      stage: 'phase',
      param: 'failChance',
      op: 'mul',
      value: Math.max(0.2, 1 - level * 0.08),
      source: 'skill:fire',
    });
  }
  if (skill === 'unarmed') {
    mods.push({
      stage: 'resolve',
      param: 'interruptChance',
      op: 'add',
      value: level * 0.03,
      source: 'skill:unarmed',
    });
  }
  return mods;
}

/** Modifiers from the actor's own body state. */
export function statusModifiers(actor: Entity): Modifier[] {
  const mods: Modifier[] = [];
  mods.push({
    stage: 'phase',
    param: 'failChance',
    op: 'mul',
    value: BASE.movingFailMul,
    source: 'status:moving',
    when: (ctx: RuleContext) => ctx.actor.isMoving(),
  });
  mods.push({
    stage: 'phase',
    param: 'failChance',
    op: 'mul',
    value: BASE.woundedFailMul,
    source: 'status:wounded',
    when: (ctx: RuleContext) => ctx.actor.hp < ctx.actor.maxHp * BASE.woundedBelow,
  });
  // Attributes: agility → dodge and accuracy; strength → damage.
  const agi = (actor.attributes.agi - 10) * BASE.attrStep;
  const str = (actor.attributes.str - 10) * BASE.attrStep;
  if (agi !== 0) {
    mods.push({ stage: 'resolve', param: 'hitChance', op: 'add', value: agi, source: 'attr:agi' });
  }
  if (str !== 0) {
    mods.push({ stage: 'resolve', param: 'damage', op: 'mul', value: 1 + str, source: 'attr:str' });
  }
  return mods;
}

/** Modifiers that the TARGET contributes to an attack against it. */
export function targetModifiers(target: Entity): Modifier[] {
  const mods: Modifier[] = [];
  const agi = (target.attributes.agi - 10) * BASE.attrStep;
  if (agi !== 0) {
    mods.push({ stage: 'resolve', param: 'dodgeChance', op: 'add', value: agi, source: 'target:agi' });
  }
  // Can't dodge what you don't see.
  mods.push({
    stage: 'resolve',
    param: 'dodgeChance',
    op: 'mul',
    value: 0,
    source: 'target:blind',
    when: (ctx) => ctx.targetBlind === true,
  });
  // Can't dodge with busy legs.
  mods.push({
    stage: 'resolve',
    param: 'dodgeChance',
    op: 'mul',
    value: 0,
    source: 'target:legsBusy',
    when: (ctx) => !!ctx.target && !ctx.target.isChannelFree('legs'),
  });
  // Shield: only while the hold phase is active.
  mods.push({
    stage: 'resolve',
    param: 'damageTaken',
    op: 'mul',
    value: 1 - 0.7,
    source: 'target:shield',
    when: (ctx) => !!ctx.target && ctx.target.statuses.has('shielded'),
  });
  return mods;
}

/** Skill XP: challenge rule. Returns XP gained (0 if no challenge). */
export function challengeXp(skillLevel: number, difficulty: number, base = 10): number {
  const challenge = difficulty - skillLevel;
  return challenge > 0 ? base * challenge : 0;
}

/** XP needed to reach the next level from `level`. */
export function xpToNext(level: number): number {
  return 50 + level * 30;
}
