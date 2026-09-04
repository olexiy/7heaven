import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/core/sim/sim';
import { ENTITIES } from '../../src/data/entities';
import { ACTIONS, TURN_SECONDS } from '../../src/data/actions';
import { BASE } from '../../src/data/rules';
import { secToTicks } from '../../src/core/time';
import { GHOUL, newSim, run, spawnDummy } from './helpers';

const PLAYER_AT = { x: 5, y: 5 };
const GHOUL_AT = { x: 6, y: 5 };

describe('v0.2: cooldowns', () => {
  it('a sword swing cannot be restarted until its recovery has passed', () => {
    const sim = newSim(1, 12, 12, PLAYER_AT);
    const ghoul = spawnDummy(sim, GHOUL, GHOUL_AT);
    const target = { kind: 'entity', id: ghoul.id } as const;
    sim.command({ type: 'act', entity: sim.playerId, action: 'sword', target });
    run(sim, secToTicks(2.0));
    expect(sim.player.isChannelFree('rightHand')).toBe(true);
    expect(sim.player.cooldownLeft('sword', sim.tick)).toBe(secToTicks(ACTIONS['sword']!.cooldown!));
    sim.command({ type: 'act', entity: sim.playerId, action: 'sword', target });
    expect(sim.player.isChannelFree('rightHand')).toBe(true); // refused: still recovering
    run(sim, secToTicks(1.0));
    sim.command({ type: 'act', entity: sim.playerId, action: 'sword', target });
    expect(sim.player.action('rightHand')?.def.id).toBe('sword');
  });

  it('cancelling early does not start the recovery', () => {
    const sim = newSim(1, 12, 12, PLAYER_AT);
    const ghoul = spawnDummy(sim, GHOUL, GHOUL_AT);
    sim.command({ type: 'act', entity: sim.playerId, action: 'kick', target: { kind: 'entity', id: ghoul.id } });
    run(sim, 5);
    sim.command({ type: 'cancel', entity: sim.playerId, channel: 'legs' });
    expect(sim.player.cooldownLeft('kick', sim.tick)).toBe(0);
  });
});

describe('v0.2: three channels', () => {
  it('sword (right hand), shield (left hand) and kick (legs) run at the same time; fireball needs both hands', () => {
    const sim = newSim(1, 12, 12, PLAYER_AT);
    const ghoul = spawnDummy(sim, GHOUL, GHOUL_AT);
    const target = { kind: 'entity', id: ghoul.id } as const;
    sim.command({ type: 'act', entity: sim.playerId, action: 'shield' });
    sim.command({ type: 'act', entity: sim.playerId, action: 'sword', target });
    sim.command({ type: 'act', entity: sim.playerId, action: 'kick', target });
    const p = sim.player;
    expect(p.action('leftHand')?.def.id).toBe('shield');
    expect(p.action('rightHand')?.def.id).toBe('sword');
    expect(p.action('legs')?.def.id).toBe('kick');
    sim.command({ type: 'act', entity: sim.playerId, action: 'fireball', target: { kind: 'tile', pos: { x: 9, y: 5 } } });
    expect(p.action('rightHand')?.def.id).toBe('sword'); // refused: hands busy
  });
});

describe('v0.2: facing', () => {
  it('a target cannot dodge a blow from behind, even if agile and standing still', () => {
    let dodges = 0;
    let hits = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const sim = newSim(seed, 12, 12, PLAYER_AT);
      const ghoul = spawnDummy(sim, { ...GHOUL, attributes: { ...GHOUL.attributes, agi: 40 } }, GHOUL_AT);
      ghoul.facing = { dx: 1, dy: 0 }; // looking away from the player
      sim.command({ type: 'act', entity: sim.playerId, action: 'sword', target: { kind: 'entity', id: ghoul.id } });
      for (const t of run(sim, secToTicks(2.5))) {
        if (t.ev.type === 'missed' && t.ev.reason === 'dodge') dodges++;
        if (t.ev.type === 'hit') hits++;
      }
    }
    expect(dodges).toBe(0);
    expect(hits).toBeGreaterThan(100);
  });

  it('a target facing the attacker with agility 40 dodges every swing that connects', () => {
    let dodges = 0;
    let hits = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const sim = newSim(seed, 12, 12, PLAYER_AT);
      const ghoul = spawnDummy(sim, { ...GHOUL, attributes: { ...GHOUL.attributes, agi: 40 } }, GHOUL_AT);
      sim.command({ type: 'act', entity: sim.playerId, action: 'sword', target: { kind: 'entity', id: ghoul.id } });
      for (const t of run(sim, secToTicks(2.5))) {
        if (t.ev.type === 'missed' && t.ev.reason === 'dodge') dodges++;
        if (t.ev.type === 'hit') hits++;
      }
    }
    expect(hits).toBe(0);
    expect(dodges).toBeGreaterThan(100);
  });

  it('attacking something behind you costs a turn', () => {
    const sim = newSim(1, 12, 12, PLAYER_AT);
    const ghoul = spawnDummy(sim, GHOUL, { x: 4, y: 5 });
    sim.player.facing = { dx: 1, dy: 0 }; // ghoul is on the left, behind
    sim.command({ type: 'act', entity: sim.playerId, action: 'sword', target: { kind: 'entity', id: ghoul.id } });
    expect(sim.player.action('rightHand')?.phaseTotal).toBe(secToTicks(2.0 + TURN_SECONDS));
    expect(sim.player.facing).toEqual({ dx: -1, dy: 0 });
  });
});

describe('v0.2: block', () => {
  it('a raised shield stops some hits completely; from behind it stops none', () => {
    function trial(fromBehind: boolean): { full: number; partial: number } {
      let full = 0;
      let partial = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const sim = newSim(seed, 12, 12, PLAYER_AT);
        const ghoul = spawnDummy(sim, GHOUL, GHOUL_AT);
        sim.player.skills.get('shield')!.level = 5;
        sim.player.facing = fromBehind ? { dx: -1, dy: 0 } : { dx: 1, dy: 0 };
        sim.command({ type: 'act', entity: sim.playerId, action: 'shield' });
        run(sim, secToTicks(0.6));
        expect(sim.player.statuses.has('shielded')).toBe(true);
        sim.command({ type: 'act', entity: ghoul.id, action: 'claw', target: { kind: 'entity', id: sim.playerId } });
        for (const t of run(sim, secToTicks(2.0))) {
          if (t.ev.type === 'blocked' && t.ev.target === sim.playerId) {
            if (t.ev.full) full++;
            else partial++;
          }
        }
      }
      return { full, partial };
    }
    const front = trial(false);
    const expected = BASE.blockBase + 5 * BASE.blockPerLevel; // 0.35 of connecting hits
    const connecting = front.full + front.partial;
    expect(connecting).toBeGreaterThan(150);
    expect(front.full / connecting).toBeGreaterThan(expected - 0.1);
    expect(front.full / connecting).toBeLessThan(expected + 0.1);
    const back = trial(true);
    expect(back.full).toBe(0);
  });
});

describe('v0.2: auto-attack and shaman', () => {
  it('auto-attack fills free channels with basic actions only, and prefers the kick against a caster', () => {
    const sim = newSim(1, 14, 14, PLAYER_AT);
    const shaman = spawnDummy(sim, ENTITIES['shaman']!, GHOUL_AT);
    shaman.faceToward(sim.player.pos.x, sim.player.pos.y);
    sim.autoAttack = true;
    // Shaman starts a hex: gather phase is interruptible.
    sim.command({ type: 'act', entity: shaman.id, action: 'hex', target: { kind: 'entity', id: sim.playerId } });
    sim.step();
    const p = sim.player;
    expect(p.action('legs')?.def.id).toBe('kick');
    expect(p.action('rightHand')?.def.id).toBe('sword');
    expect(p.action('leftHand')).toBeNull(); // shield bash is an ability: never automatic
  });

  it('a kick during the hex gather phase interrupts it about a third of the time', () => {
    let interrupted = 0;
    let kicksLanded = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const sim = newSim(seed, 14, 14, PLAYER_AT);
      const shaman = spawnDummy(sim, ENTITIES['shaman']!, GHOUL_AT);
      shaman.faceToward(sim.player.pos.x, sim.player.pos.y);
      sim.command({ type: 'act', entity: shaman.id, action: 'hex', target: { kind: 'entity', id: sim.playerId } });
      sim.command({ type: 'act', entity: sim.playerId, action: 'kick', target: { kind: 'entity', id: shaman.id } });
      for (const t of run(sim, secToTicks(1.5))) {
        if (t.ev.type === 'hit' && t.ev.action === 'kick') kicksLanded++;
        if (t.ev.type === 'interrupted') interrupted++;
      }
    }
    expect(kicksLanded).toBeGreaterThan(150);
    expect(interrupted / kicksLanded).toBeGreaterThan(0.2);
    expect(interrupted / kicksLanded).toBeLessThan(0.45);
  });

  it('a full autopilot rift with a shaman is deterministic', () => {
    const a = new Sim({ seed: 11, enemies: ['ghoul', 'shaman'] });
    const b = new Sim({ seed: 11, enemies: ['ghoul', 'shaman'] });
    for (const s of [a, b]) {
      s.command({ type: 'autopilot', on: true });
      s.command({ type: 'move', entity: s.playerId, to: s.exit });
    }
    for (let i = 0; i < 1500; i++) {
      a.step();
      b.step();
    }
    expect(a.player.hp).toBe(b.player.hp);
    expect(a.rng.getState()).toBe(b.rng.getState());
  });
});
