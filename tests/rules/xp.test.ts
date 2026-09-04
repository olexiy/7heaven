import { describe, expect, it } from 'vitest';
import { challengeXp, xpToNext } from '../../src/data/rules';
import { GHOUL, newSim, run, spawnDummy } from './helpers';

describe('challengeXp: the challenge rule', () => {
  it('returns 0 when the skill level meets or exceeds the difficulty', () => {
    expect(challengeXp(0, 0)).toBe(0);
    expect(challengeXp(3, 3)).toBe(0);
    expect(challengeXp(10, 2)).toBe(0);
    expect(challengeXp(10, 10)).toBe(0);
    expect(challengeXp(25, 1)).toBe(0);
  });

  it('grows linearly with the gap between difficulty and level', () => {
    const base = challengeXp(0, 1);
    expect(base).toBeGreaterThan(0);
    for (let d = 1; d <= 12; d++) {
      for (let l = 0; l < d; l++) {
        expect(challengeXp(l, d)).toBe(base * (d - l));
      }
    }
    // Same gap, same XP regardless of absolute level.
    expect(challengeXp(2, 5)).toBe(challengeXp(7, 10));
    // Custom base scales everything.
    expect(challengeXp(1, 4, 7)).toBe(21);
  });

  it('xpToNext grows with level', () => {
    for (let l = 0; l < 20; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
  });
});

describe('sword XP in a real fight', () => {
  /** Player swings at an adjacent AI-disabled ghoul; returns the xp events and whether the swing connected. */
  function fight(seed: number, level: number) {
    const sim = newSim(seed, 8, 8, { x: 3, y: 3 });
    const ghoul = spawnDummy(sim, GHOUL, { x: 4, y: 3 });
    const st = sim.player.skills.get('sword')!;
    st.level = level;
    sim.command({ type: 'act', entity: sim.playerId, action: 'sword', target: { kind: 'entity', id: ghoul.id } });
    const events = run(sim, 60);
    const hit = events.some((t) => t.ev.type === 'hit' && t.ev.attacker === sim.playerId && t.ev.action === 'sword');
    const xp = events.filter((t) => t.ev.type === 'xp' && t.ev.id === sim.playerId && t.ev.skill === 'sword');
    return { hit, xp, state: st };
  }

  it('a hit at level 0 grants sword XP', () => {
    let hitsSeen = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = fight(seed, 0);
      if (!r.hit) {
        expect(r.xp).toHaveLength(0);
        expect(r.state.xp).toBe(0);
        continue;
      }
      hitsSeen++;
      expect(r.xp).toHaveLength(1);
      const ev = r.xp[0]!.ev;
      if (ev.type !== 'xp') throw new Error('unreachable');
      expect(ev.amount).toBeGreaterThan(0);
      if (ev.levelUp) {
        // A crit raises difficulty by 2; the gain then reaches xpToNext(0) and levels the skill.
        expect(ev.amount).toBeGreaterThanOrEqual(xpToNext(0));
        expect(r.state.level).toBe(1);
        expect(r.state.xp).toBe(ev.amount - xpToNext(0));
      } else {
        expect(r.state.level).toBe(0);
        expect(r.state.xp).toBe(ev.amount);
      }
    }
    expect(hitsSeen).toBeGreaterThan(20);
  });

  it('a hit at level 10 grants no sword XP (no challenge left in a ghoul)', () => {
    // Note: level 10 also adds +0.2 to hit chance, so which seeds connect differs from level 0.
    let hitsSeen = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = fight(seed, 10);
      if (r.hit) hitsSeen++;
      expect(r.xp).toHaveLength(0);
      expect(r.state.xp).toBe(0);
      expect(r.state.level).toBe(10);
    }
    expect(hitsSeen).toBeGreaterThan(20);
  });

  it('a miss grants no XP at all', () => {
    let missesSeen = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = fight(seed, 0);
      if (r.hit) continue;
      missesSeen++;
      expect(r.xp).toHaveLength(0);
      expect(r.state.xp).toBe(0);
    }
    expect(missesSeen).toBeGreaterThan(0);
  });
});
