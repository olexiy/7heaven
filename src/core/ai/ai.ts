import type { Sim } from '../sim/sim';
import type { Entity } from '../entity/entity';
import type { ActionDef } from '../action/action';
import { chebyshev, vecEq } from '../world/map';
import { startAction } from '../action/engine';
import { secToTicks } from '../time';

/** Expected damage of a melee action, for ranking. */
function expectedDamage(def: ActionDef): number {
  const [a, b] = def.damage ?? [0, 0];
  return (a + b) / 2;
}

/** Ready = required channels free and not in recovery. */
function ready(sim: Sim, e: Entity, def: ActionDef): boolean {
  return e.channelsFree(def.channels) && e.cooldownLeft(def.id, sim.tick) === 0 && e.mana >= (def.cost?.mana ?? 0);
}

/**
 * Auto-attack: fill free channels with the strongest ready basic action against an adjacent foe.
 * Used by the player's auto-attack toggle and by enemy AI. Abilities are never chosen here.
 * A kick is held back for interrupting a caster unless nothing else is ready.
 */
export function autoAttack(sim: Sim, e: Entity, target: Entity): boolean {
  const dist = chebyshev(e.pos, target.pos);
  const basics = e.spec.actions
    .map((id) => sim.actionDef(id))
    .filter((d) => d.kind === 'melee' && d.category === 'action' && (d.range ?? 1) >= dist && ready(sim, e, d));
  if (basics.length === 0) return false;
  const targetCasting = target.runningActions().some((a) => a.def.phases[a.phaseIndex]?.interruptible);
  basics.sort((a, b) => {
    // Interrupting moves first when the target is vulnerable to them.
    const ia = a.interruptChance && targetCasting ? 100 : 0;
    const ib = b.interruptChance && targetCasting ? 100 : 0;
    return ib + expectedDamage(b) - (ia + expectedDamage(a));
  });
  let started = false;
  for (const d of basics) {
    // Save the kick for casters if a stronger option exists and the target is not casting.
    if (d.interruptChance && !targetCasting && basics.some((o) => o !== d && !o.interruptChance && e.channelsFree(o.channels))) {
      continue;
    }
    if (!e.channelsFree(d.channels)) continue;
    const res = startAction(sim, e, d, { kind: 'entity', id: target.id });
    if (res.ok) started = true;
  }
  return started;
}

/**
 * Priority-based autopilot shared by enemies and the player's autopilot.
 * Uses the same actions and the same pipeline as a human player.
 */
export function aiStep(sim: Sim, e: Entity): void {
  if (sim.tick < e.reactUntil) return;
  const foes = sim.alive().filter((o) => o.faction !== e.faction && e.visible.has(sim.map.idx(o.pos.x, o.pos.y)));

  if (foes.length === 0) {
    if ((e.awareness === 'alert' || e.awareness === 'combat') && e.lastSeenTarget && e.path.length === 0 && e.isChannelFree('legs')) {
      if (!vecEq(e.pos, e.lastSeenTarget)) sim.setDestination(e, e.lastSeenTarget);
      else e.awareness = 'alert';
    }
    return;
  }

  const target = pickTarget(e, foes);
  const dist = chebyshev(e.pos, target.pos);
  const actions = e.spec.actions.map((id) => sim.actionDef(id));
  const shield = actions.find((a) => a.kind === 'shield');
  const spell = actions.find((a) => a.kind === 'spell');
  const abilities = actions.filter((a) => a.kind === 'melee' && a.category === 'ability');

  // A caster stands still: walking multiplies the failure chance.
  const casting = e.runningActions().some((a) => a.def.kind === 'spell');
  if (casting) {
    e.path = [];
    return;
  }

  // Raise the shield when the foe is winding up a hit and we are hurt.
  if (shield && ready(sim, e, shield) && !e.statuses.has('shielded') && e.hp < e.maxHp * 0.5) {
    const foeAttacking = target.runningActions().some((a) => a.def.kind === 'melee');
    if (foeAttacking && dist <= 2) {
      startAction(sim, e, shield, null);
    }
  }

  if (dist <= 1) {
    e.path = [];
    // Interrupt a caster with an ability if one is ready.
    const targetCasting = target.runningActions().some((a) => a.def.phases[a.phaseIndex]?.interruptible);
    if (targetCasting) {
      const bash = abilities.find((a) => a.interruptChance && ready(sim, e, a));
      if (bash) startAction(sim, e, bash, { kind: 'entity', id: target.id });
    }
    if (autoAttack(sim, e, target)) e.reactUntil = sim.tick + secToTicks(0.2);
    return;
  }

  // Ranged option when far enough: drop the path and cast.
  if (spell && dist >= 2 && ready(sim, e, spell) && e.isChannelFree('legs')) {
    e.path = [];
    const res = startAction(sim, e, spell, { kind: 'entity', id: target.id });
    if (res.ok) return;
  }

  // Casters keep their distance while the spell recovers.
  if (spell && dist <= 2 && e.isChannelFree('legs') && e.path.length === 0) {
    const away = { x: e.pos.x + Math.sign(e.pos.x - target.pos.x), y: e.pos.y + Math.sign(e.pos.y - target.pos.y) };
    if (sim.map.isFloor(away.x, away.y) && !sim.entityAt(away)) {
      sim.setDestination(e, away);
      return;
    }
  }

  // Approach.
  if (e.isChannelFree('legs') && e.path.length === 0) {
    sim.setDestination(e, target.pos);
  } else if (e.path.length > 0) {
    const dest = e.path[e.path.length - 1]!;
    if (chebyshev(dest, target.pos) > 1) sim.setDestination(e, target.pos);
  }
}

function pickTarget(e: Entity, foes: Entity[]): Entity {
  let best = foes[0]!;
  let bestScore = -Infinity;
  for (const f of foes) {
    const dist = chebyshev(e.pos, f.pos);
    const weak = f.hp / f.maxHp < 0.3 ? 5 : 0;
    const score = weak - dist;
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}
