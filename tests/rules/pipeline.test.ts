import { describe, expect, it } from 'vitest';
import type { Command } from '../../src/core/sim/sim';
import type { Vec } from '../../src/core/world/map';
import { ACTIONS } from '../../src/data/actions';
import { BASE, skillSpeedFactor } from '../../src/data/rules';
import { secToTicks } from '../../src/core/time';
import { actionTicks, BLIND_GHOUL, GHOUL, ghoulSkill, newSim, phaseTicks, ratio, run, spawnDummy, type Timed } from './helpers';

/*
 * The five mandatory MVP pipeline rules (docs/MVP.md, "Конвейер"), verified end to end through
 * the public Sim API: commands in, events out. Where the outcome is random, we run many seeds and
 * assert ratios with tolerant bounds. Every expected number is derived from src/data so the tests
 * follow balance changes.
 */

const FIREBALL_GATHER = phaseTicks('fireball', 'gather', 0); // 100 ticks
const FIREBALL_FORM = phaseTicks('fireball', 'form', 0); // 100 ticks
const FORM_END = FIREBALL_GATHER + FIREBALL_FORM; // form fails or succeeds at this tick after the cast

describe('Rule 1: moving multiplies spell formation failure', () => {
  // A long, narrow room: the walk lasts much longer than the 10 s the formation needs.
  const W = 40;
  const H = 5;
  const START: Vec = { x: 1, y: 2 };
  const WALK_TO: Vec = { x: 38, y: 2 };
  const SPELL_TARGET: Vec = { x: START.x + (ACTIONS['fireball']!.range ?? 0), y: 2 };

  type Outcome = { failed: boolean; reason: string; walkedPastFormEnd: boolean };

  /** Cast a fireball at a far tile; optionally while walking a 37-tile path. `castDelay` ticks separate the move and the cast commands. */
  function castTrial(seed: number, walk: boolean, castDelay: number): Outcome {
    const sim = newSim(seed, W, H, START);
    if (walk) sim.command({ type: 'move', entity: sim.playerId, to: WALK_TO });
    run(sim, castDelay);
    expect(sim.player.pos).toEqual(START); // the cast is issued from the starting tile in all cases
    sim.command({ type: 'act', entity: sim.playerId, action: 'fireball', target: { kind: 'tile', pos: SPELL_TARGET } });
    expect(sim.player.action('hands')?.def.id).toBe('fireball');
    const formEndTick = castDelay + FORM_END;
    const events = run(sim, FORM_END + 25);

    const failed = events.find((t) => t.ev.type === 'actionFailed' && t.ev.id === sim.playerId && t.ev.action === 'fireball');
    const release = events.find((t) => t.ev.type === 'phaseChanged' && t.ev.id === sim.playerId && t.ev.phase === 'release');
    // Exactly one of the two happens, and it happens exactly when the form phase ends.
    expect(!!failed !== !!release).toBe(true);
    expect((failed ?? release)!.tick).toBe(formEndTick);
    if (failed) expect(failed.ev.type === 'actionFailed' && failed.ev.phase).toBe('form');
    const walkedPastFormEnd = events.some((t) => t.ev.type === 'moved' && t.ev.id === sim.playerId && t.tick > formEndTick);
    return { failed: !!failed, reason: failed && failed.ev.type === 'actionFailed' ? failed.ev.reason : '', walkedPastFormEnd };
  }

  function failRate(walk: boolean, castDelay: number, seeds: number): { rate: number; reasons: Set<string>; stillWalking: number } {
    let failed = 0;
    let stillWalking = 0;
    const reasons = new Set<string>();
    for (let seed = 1; seed <= seeds; seed++) {
      const r = castTrial(seed, walk, castDelay);
      if (r.failed) failed++;
      if (r.walkedPastFormEnd) stillWalking++;
      if (r.failed) reasons.add(r.reason);
    }
    return { rate: failed / seeds, reasons, stillWalking };
  }

  it('fireball form phase has the declared base failure chance', () => {
    expect(ACTIONS['fireball']!.phases.find((p) => p.id === 'form')!.failBase).toBeCloseTo(0.05);
    expect(BASE.movingFailMul).toBe(20);
  });

  it('standing still: formation fails about 5 % of the time (2–9 % over 400 seeds)', () => {
    const { rate, reasons } = failRate(false, 0, 400);
    expect(rate).toBeGreaterThanOrEqual(0.02);
    expect(rate).toBeLessThanOrEqual(0.09);
    // No modifier contributed: the trace (event reason) is empty.
    for (const r of reasons) expect(r).toBe('');
  });

  it('walking (move and cast issued on the same tick): formation fails almost always (≥ 90 % over 400 seeds)', () => {
    const { rate, reasons, stillWalking } = failRate(true, 0, 400);
    expect(stillWalking).toBe(400); // the walk really outlasts the formation
    expect(rate).toBeGreaterThanOrEqual(0.9);
    for (const r of reasons) expect(r.split(',')).toContain('status:moving');
  });

  it('walking (cast issued 7 ticks into the walk): formation fails almost always (≥ 90 % over 300 seeds)', () => {
    const { rate, reasons, stillWalking } = failRate(true, 7, 300);
    expect(stillWalking).toBe(300);
    expect(rate).toBeGreaterThanOrEqual(0.9);
    for (const r of reasons) expect(r.split(',')).toContain('status:moving');
  });
});

describe('Rule 2: skill level shortens action duration', () => {
  const SWORD_BASE = ACTIONS['sword']!.phases[0]!.baseDuration;

  function swordDoneTick(level: number): { doneTick: number; phaseTotal: number } {
    const sim = newSim(1, 8, 8, { x: 3, y: 3 });
    const ghoul = spawnDummy(sim, GHOUL, { x: 4, y: 3 });
    sim.player.skills.get('sword')!.level = level;
    sim.command({ type: 'act', entity: sim.playerId, action: 'sword', target: { kind: 'entity', id: ghoul.id } });
    const inst = sim.player.action('hands');
    expect(inst?.def.id).toBe('sword');
    const events = run(sim, 60);
    const done = events.find((t) => t.ev.type === 'actionDone' && t.ev.id === sim.playerId && t.ev.action === 'sword');
    expect(done).toBeDefined();
    return { doneTick: done!.tick, phaseTotal: inst!.phaseTotal };
  }

  it('sword at level 0 takes exactly 2.0 s = 40 ticks', () => {
    expect(SWORD_BASE).toBe(2.0);
    const { doneTick, phaseTotal } = swordDoneTick(0);
    expect(phaseTotal).toBe(40);
    expect(doneTick).toBe(40);
  });

  it('sword at level 10 takes secToTicks(2.0 * skillSpeedFactor(10)) = 24 ticks', () => {
    const expected = secToTicks(SWORD_BASE * skillSpeedFactor(10));
    expect(expected).toBe(24);
    const { doneTick, phaseTotal } = swordDoneTick(10);
    expect(phaseTotal).toBe(expected);
    expect(doneTick).toBe(expected);
  });

  it.each([1, 5, 15, 20])('sword at level %i matches skillSpeedFactor', (level) => {
    const expected = secToTicks(SWORD_BASE * skillSpeedFactor(level));
    expect(swordDoneTick(level).doneTick).toBe(expected);
  });

  it('skillSpeedFactor is monotone and floored at 0.4', () => {
    let prev = skillSpeedFactor(0);
    expect(prev).toBe(1);
    for (let l = 1; l <= 30; l++) {
      const f = skillSpeedFactor(l);
      expect(f).toBeLessThanOrEqual(prev);
      expect(f).toBeGreaterThanOrEqual(0.4);
      prev = f;
    }
    expect(skillSpeedFactor(30)).toBe(0.4);
  });
});

describe('Rule 3: hit vs dodge — no dodge when blind or legs busy', () => {
  const PLAYER_AT: Vec = { x: 5, y: 5 };
  const GHOUL_AT: Vec = { x: 6, y: 6 };
  /** Agility high enough that base dodge 0.1 + (agi-10)*0.03 reaches 1.0 (clamped). */
  const AGI_ALWAYS_DODGE = 10 + Math.ceil((1 - BASE.dodgeChance) / BASE.attrStep);
  type Result = 'hit' | 'dodge' | 'miss';
  interface Tally {
    hit: number;
    dodge: number;
    miss: number;
    trials: number;
  }

  /**
   * The player kicks an adjacent ghoul (kick = 1.0 s = 20 ticks at level 0). The kick is used
   * rather than the sword because in case (c) the target's first (diagonal) step lasts 28 ticks:
   * the strike must land while that step is still running and the target still adjacent.
   */
  function kickTrial(seed: number, opts: { blind: boolean; walk: boolean }): Result {
    const sim = newSim(seed, 12, 12, PLAYER_AT);
    const ghoul = spawnDummy(sim, opts.blind ? BLIND_GHOUL : GHOUL, GHOUL_AT);
    ghoul.attributes.agi = AGI_ALWAYS_DODGE;
    if (opts.walk) {
      sim.command({ type: 'move', entity: ghoul.id, to: { x: 9, y: 9 } }); // diagonal path, first step 1.4 s
      expect(ghoul.path.length).toBe(3);
    }
    sim.command({ type: 'act', entity: sim.playerId, action: 'kick', target: { kind: 'entity', id: ghoul.id } });
    const kickTicks = actionTicks('kick', 0);
    const events = run(sim, kickTicks);
    // Sanity: the strike landed at the expected tick, the target is still adjacent, its legs are busy iff walking.
    const done = events.find((t) => t.ev.type === 'actionDone' && t.ev.action === 'kick');
    expect(done?.tick).toBe(kickTicks);
    expect(ghoul.pos).toEqual(GHOUL_AT);
    expect(ghoul.isChannelFree('legs')).toBe(!opts.walk);
    // Sanity: the target sees the attacker iff it is not blind.
    expect(ghoul.visible.has(sim.map.idx(PLAYER_AT.x, PLAYER_AT.y))).toBe(!opts.blind);

    const hit = events.find((t) => t.ev.type === 'hit' && t.ev.attacker === sim.playerId && t.ev.action === 'kick');
    const missed = events.find((t) => t.ev.type === 'missed' && t.ev.attacker === sim.playerId && t.ev.action === 'kick');
    expect(!!hit !== !!missed).toBe(true);
    if (hit) return 'hit';
    return missed!.ev.type === 'missed' && missed!.ev.reason === 'dodge' ? 'dodge' : 'miss';
  }

  function tally(opts: { blind: boolean; walk: boolean }, seeds: number): Tally {
    const t: Tally = { hit: 0, dodge: 0, miss: 0, trials: seeds };
    for (let seed = 1; seed <= seeds; seed++) t[kickTrial(seed, opts)]++;
    return t;
  }

  it('(a) a very agile target that sees the attacker dodges every attack that would connect', () => {
    const t = tally({ blind: false, walk: false }, 400);
    expect(t.hit).toBe(0);
    // Everything that passed the hit roll (~85 %) was dodged; the rest were plain misses.
    expect(ratio(t.dodge, t.trials)).toBeGreaterThanOrEqual(0.75);
    expect(ratio(t.dodge, t.trials)).toBeLessThanOrEqual(0.95);
    expect(t.dodge + t.miss).toBe(t.trials);
  });

  it('(b) the same target never dodges when it cannot see the attacker (sight 0)', () => {
    const t = tally({ blind: true, walk: false }, 400);
    expect(t.dodge).toBe(0);
    expect(ratio(t.hit, t.trials)).toBeGreaterThanOrEqual(0.75);
    expect(ratio(t.hit, t.trials)).toBeLessThanOrEqual(0.95);
  });

  it('(c) the same target never dodges while its legs are busy walking', () => {
    const t = tally({ blind: false, walk: true }, 400);
    expect(t.dodge).toBe(0);
    expect(ratio(t.hit, t.trials)).toBeGreaterThanOrEqual(0.75);
    expect(ratio(t.hit, t.trials)).toBeLessThanOrEqual(0.95);
  });
});

describe('Rule 4: shield cuts damage only while it is held', () => {
  const PLAYER_AT: Vec = { x: 5, y: 5 };
  const GHOUL_AT: Vec = { x: 6, y: 5 };
  const RAISE = phaseTicks('shield', 'raise', 0); // 10 ticks
  const HOLD = phaseTicks('shield', 'hold', 0); // 100 ticks
  const CLAW = actionTicks('claw', ghoulSkill('unarmed')); // 1.6 s at the ghoul's unarmed level
  const [CLAW_MIN, CLAW_MAX] = ACTIONS['claw']!.damage!;
  const STR_MUL = 1 + (GHOUL.attributes.str - 10) * BASE.attrStep;
  const SHIELD_MUL = 1 - ACTIONS['shield']!.damageReduction!;

  interface Landed {
    tick: number;
    damage: number;
    crit: boolean;
    blocked: number | undefined;
    shieldedAtImpact: boolean;
  }

  /** Player raises the shield at `shieldAt`; the ghoul claws at `clawAt`. Returns the claw that connected, if any. */
  function clawTrial(seed: number, shieldAt: number, clawAt: number): Landed | undefined {
    const sim = newSim(seed, 12, 12, PLAYER_AT);
    const ghoul = spawnDummy(sim, GHOUL, GHOUL_AT);
    const schedule: (readonly [number, Command])[] = [
      [shieldAt, { type: 'act', entity: sim.playerId, action: 'shield' }],
      [clawAt, { type: 'act', entity: ghoul.id, action: 'claw', target: { kind: 'entity', id: sim.playerId } }],
    ];
    const impact = clawAt + CLAW;
    let shieldedAtImpact = false;
    const events: Timed[] = [];
    // Step manually so we can observe the shield status right before the claw resolves.
    const pending = [...schedule].sort((a, b) => a[0] - b[0]);
    while (sim.tick < impact + 5) {
      while (pending.length > 0 && pending[0]![0] <= sim.tick) sim.command(pending.shift()![1]);
      if (sim.tick === impact - 1) shieldedAtImpact = sim.player.statuses.has('shielded');
      for (const ev of sim.step()) events.push({ tick: sim.tick, ev });
    }
    expect(events.some((t) => t.ev.type === 'actionDone' && t.ev.id === ghoul.id && t.ev.action === 'claw' && t.tick === impact)).toBe(true);
    const hit = events.find((t) => t.ev.type === 'hit' && t.ev.attacker === ghoul.id && t.ev.action === 'claw');
    if (!hit || hit.ev.type !== 'hit') return undefined;
    const blocked = events.find((t) => t.ev.type === 'blocked' && t.ev.target === sim.playerId && t.tick === hit.tick);
    return {
      tick: hit.tick,
      damage: hit.ev.damage,
      crit: hit.ev.crit,
      blocked: blocked && blocked.ev.type === 'blocked' ? blocked.ev.absorbed : undefined,
      shieldedAtImpact,
    };
  }

  function landed(shieldAt: number, clawAt: number, seeds: number): Landed[] {
    const out: Landed[] = [];
    for (let seed = 1; seed <= seeds; seed++) {
      const l = clawTrial(seed, shieldAt, clawAt);
      if (l) out.push(l);
    }
    // The ghoul connects roughly 70 % of the time; make sure the sample is meaningful.
    expect(out.length).toBeGreaterThan(seeds * 0.5);
    return out;
  }

  it('shield timeline: shielded status appears at the end of raise and disappears at the end of hold', () => {
    const sim = newSim(1, 12, 12, PLAYER_AT);
    sim.command({ type: 'act', entity: sim.playerId, action: 'shield' });
    const events = run(sim, RAISE + HOLD + 5);
    const hold = events.find((t) => t.ev.type === 'phaseChanged' && t.ev.action === 'shield' && t.ev.phase === 'hold');
    const done = events.find((t) => t.ev.type === 'actionDone' && t.ev.action === 'shield');
    expect(hold?.tick).toBe(RAISE);
    expect(done?.tick).toBe(RAISE + HOLD);
    expect(sim.player.statuses.has('shielded')).toBe(false);
  });

  it('a claw landing during hold is blocked and deals ~30 % of raw damage', () => {
    const hits = landed(0, 0, 200);
    for (const h of hits) {
      expect(h.tick).toBe(CLAW);
      expect(h.tick).toBeGreaterThan(RAISE);
      expect(h.tick).toBeLessThan(RAISE + HOLD);
      expect(h.shieldedAtImpact).toBe(true);
      expect(h.blocked).toBeDefined();
      expect(h.blocked!).toBeGreaterThan(0);
      const mult = h.crit ? 2 : 1;
      expect(h.damage).toBeGreaterThanOrEqual(Math.round(CLAW_MIN * mult * STR_MUL * SHIELD_MUL));
      expect(h.damage).toBeLessThanOrEqual(Math.round(CLAW_MAX * mult * STR_MUL * SHIELD_MUL));
      if (!h.crit) expect(h.damage).toBeLessThanOrEqual(Math.ceil(CLAW_MAX * SHIELD_MUL));
    }
  });

  it('a claw landing after the shield expires is not blocked and deals full damage', () => {
    const clawAt = RAISE + HOLD - CLAW + 5; // impact 5 ticks after hold ends
    const hits = landed(0, clawAt, 200);
    for (const h of hits) {
      expect(h.tick).toBeGreaterThan(RAISE + HOLD);
      expect(h.shieldedAtImpact).toBe(false);
      expect(h.blocked).toBeUndefined();
      const mult = h.crit ? 2 : 1;
      expect(h.damage).toBeGreaterThanOrEqual(Math.round(CLAW_MIN * mult * STR_MUL));
      expect(h.damage).toBeLessThanOrEqual(Math.round(CLAW_MAX * mult * STR_MUL));
    }
  });

  it('a claw landing during raise (shield not yet up) is not blocked', () => {
    const shieldAt = CLAW - Math.floor(RAISE / 2); // impact lands in the middle of raise
    const hits = landed(shieldAt, 0, 200);
    for (const h of hits) {
      expect(h.tick).toBeGreaterThan(shieldAt);
      expect(h.tick).toBeLessThan(shieldAt + RAISE);
      expect(h.shieldedAtImpact).toBe(false);
      expect(h.blocked).toBeUndefined();
      const mult = h.crit ? 2 : 1;
      expect(h.damage).toBeGreaterThanOrEqual(Math.round(CLAW_MIN * mult * STR_MUL));
    }
  });
});

describe('Rule 5: kick interrupts only the gather phase of a spell', () => {
  const PLAYER_AT: Vec = { x: 5, y: 5 };
  const GHOUL_AT: Vec = { x: 6, y: 5 };
  const SPELL_TARGET: Vec = { x: 11, y: 5 };
  const KICK = actionTicks('kick', ghoulSkill('unarmed')); // 1.0 s at the ghoul's unarmed level
  const KICK_INTERRUPT = ACTIONS['kick']!.interruptChance!;

  interface KickResult {
    kickHit: boolean;
    interrupted: boolean;
    phaseAtImpact: string | undefined;
    reachedForm: boolean;
  }

  /** Player starts a fireball at tick 0; the ghoul kicks at `kickAt`. */
  function kickTrial(seed: number, kickAt: number): KickResult {
    const sim = newSim(seed, 12, 12, PLAYER_AT);
    const ghoul = spawnDummy(sim, GHOUL, GHOUL_AT);
    const impact = kickAt + KICK;
    let phaseAtImpact: string | undefined;
    const events: Timed[] = [];
    sim.command({ type: 'act', entity: sim.playerId, action: 'fireball', target: { kind: 'tile', pos: SPELL_TARGET } });
    expect(sim.player.action('hands')?.def.id).toBe('fireball');
    // Run past both the kick impact and the end of gather, so we can tell whether form was reached.
    while (sim.tick < Math.max(impact, FIREBALL_GATHER) + 5) {
      if (sim.tick === kickAt) sim.command({ type: 'act', entity: ghoul.id, action: 'kick', target: { kind: 'entity', id: sim.playerId } });
      if (sim.tick === impact - 1) {
        const a = sim.player.action('hands');
        phaseAtImpact = a ? a.def.phases[a.phaseIndex]!.id : undefined;
      }
      for (const ev of sim.step()) events.push({ tick: sim.tick, ev });
    }
    const kickHit = events.some((t) => t.ev.type === 'hit' && t.ev.attacker === ghoul.id && t.ev.action === 'kick' && t.tick === impact);
    const interrupted = events.some((t) => t.ev.type === 'interrupted' && t.ev.attacker === ghoul.id && t.ev.target === sim.playerId && t.ev.action === 'fireball');
    const reachedForm = events.some((t) => t.ev.type === 'phaseChanged' && t.ev.id === sim.playerId && t.ev.phase === 'form');
    if (interrupted) {
      // An interruption is always the consequence of a kick that connected, and frees the hands.
      expect(kickHit).toBe(true);
      expect(events.find((t) => t.ev.type === 'interrupted')!.tick).toBe(impact);
    }
    return { kickHit, interrupted, phaseAtImpact, reachedForm };
  }

  it('during gather: a connecting kick interrupts with roughly the kick interrupt chance (25–45 %)', () => {
    const SEEDS = 500;
    let hits = 0;
    let interrupted = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = kickTrial(seed, 0);
      expect(r.phaseAtImpact).toBe('gather');
      if (r.kickHit) hits++;
      if (r.interrupted) {
        interrupted++;
        expect(r.reachedForm).toBe(false);
      } else {
        expect(r.reachedForm).toBe(true);
      }
    }
    expect(hits).toBeGreaterThan(SEEDS * 0.5);
    // Base 0.3 plus the ghoul's unarmed skill bonus (level 1 → +0.03) ≈ 0.33.
    const expected = KICK_INTERRUPT + ghoulSkill('unarmed') * 0.03;
    expect(expected).toBeCloseTo(0.33);
    expect(ratio(interrupted, hits)).toBeGreaterThanOrEqual(0.25);
    expect(ratio(interrupted, hits)).toBeLessThanOrEqual(0.45);
  });

  it('during form: a connecting kick never interrupts', () => {
    const SEEDS = 300;
    let hits = 0;
    let interrupted = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = kickTrial(seed, FIREBALL_GATHER);
      expect(r.phaseAtImpact).toBe('form');
      if (r.kickHit) hits++;
      if (r.interrupted) interrupted++;
    }
    expect(hits).toBeGreaterThan(SEEDS * 0.5);
    expect(interrupted).toBe(0);
  });

  it('phase flags: only gather is interruptible', () => {
    const phases = ACTIONS['fireball']!.phases;
    expect(phases.map((p) => [p.id, p.interruptible])).toEqual([
      ['gather', true],
      ['form', false],
      ['release', false],
    ]);
  });
});
