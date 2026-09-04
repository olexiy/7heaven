import type { Sim } from '../sim/sim';
import type { Entity } from '../entity/entity';
import { chebyshev, vecEq } from '../world/map';
import { startAction } from '../action/engine';
import { secToTicks } from '../time';

/**
 * Priority-based autopilot, shared by enemies and the player's autopilot.
 * Uses the same actions and the same pipeline as a human player.
 * Priorities: finish a weak target → shield when low → attack nearest → approach.
 */
export function aiStep(sim: Sim, e: Entity): void {
  if (sim.tick < e.reactUntil) return;
  const foes = sim.alive().filter((o) => o.faction !== e.faction && e.visible.has(sim.map.idx(o.pos.x, o.pos.y)));

  if (foes.length === 0) {
    // Nothing in sight: head to last known position if alert/combat.
    if ((e.awareness === 'alert' || e.awareness === 'combat') && e.lastSeenTarget && e.path.length === 0 && e.isChannelFree('legs')) {
      if (!vecEq(e.pos, e.lastSeenTarget)) sim.setDestination(e, e.lastSeenTarget);
      else e.awareness = 'alert';
    }
    return;
  }

  const target = pickTarget(e, foes);
  const dist = chebyshev(e.pos, target.pos);
  const actions = e.spec.actions.map((id) => sim.actionDef(id));
  const melee = actions.filter((a) => a.kind === 'melee' && (a.range ?? 1) >= dist);
  const shield = actions.find((a) => a.kind === 'shield');
  const spell = actions.find((a) => a.kind === 'spell');

  // Defend when hurt and the enemy is about to strike.
  if (shield && e.hp < e.maxHp * 0.3 && !e.statuses.has('shielded') && e.channelsFree(shield.channels)) {
    const foeAttacking = target.runningActions().some((a) => a.def.kind === 'melee');
    if (foeAttacking) {
      startAction(sim, e, shield, null);
      return;
    }
  }

  if (dist <= 1) {
    e.path = [];
    for (const m of melee) {
      if (e.channelsFree(m.channels)) {
        startAction(sim, e, m, { kind: 'entity', id: target.id });
        e.reactUntil = sim.tick + secToTicks(0.2);
        return;
      }
    }
    return;
  }

  // A caster stands still: walking multiplies the failure chance.
  const casting = e.runningActions().some((a) => a.def.kind === 'spell');
  if (casting) {
    e.path = [];
    return;
  }

  // Ranged option when far enough: stop walking (a pending path is dropped; a running step finishes) and cast.
  if (spell && dist >= 3 && e.mana >= (spell.cost?.mana ?? 0) && e.channelsFree(spell.channels) && e.isChannelFree('legs')) {
    e.path = [];
    const res = startAction(sim, e, spell, { kind: 'entity', id: target.id });
    if (res.ok) return;
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
  // Finish the weakest if it is close; otherwise the nearest.
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
