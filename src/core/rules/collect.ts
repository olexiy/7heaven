import type { Modifier, RuleContext } from './modifiers';
import { skillModifiers, statusModifiers, targetModifiers } from '../../data/rules';

/** Gather every modifier relevant to a context: actor skill, actor state, target state. */
export function collectModifiers(ctx: RuleContext): Modifier[] {
  const mods: Modifier[] = [];
  if (ctx.action.skill) {
    mods.push(...skillModifiers(ctx.action.skill, ctx.actor.skillLevel(ctx.action.skill)));
  }
  mods.push(...statusModifiers(ctx.actor));
  if (ctx.target) mods.push(...targetModifiers(ctx.target));
  return mods;
}
