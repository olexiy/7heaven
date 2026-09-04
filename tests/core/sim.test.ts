import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/core/sim/sim';
import { mapFromAscii } from '../world/fixtures';
import { TICKS_PER_SEC } from '../../src/core/time';

function openRoom(): { map: ReturnType<typeof mapFromAscii>; playerStart: { x: number; y: number }; exit: { x: number; y: number } } {
  const map = mapFromAscii([
    '##########',
    '#........#',
    '#........#',
    '#........#',
    '#........#',
    '#........#',
    '##########',
  ]);
  return { map, playerStart: { x: 1, y: 1 }, exit: { x: 8, y: 5 } };
}

function run(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

describe('Sim: movement', () => {
  it('walks one orthogonal tile in exactly 1 second', () => {
    const sim = new Sim({ seed: 1, fixedMap: openRoom() });
    sim.command({ type: 'move', entity: sim.playerId, to: { x: 3, y: 1 } });
    expect(sim.player.path.length).toBe(2);
    run(sim, TICKS_PER_SEC); // 20 ticks: first step completes at tick 20
    expect(sim.player.pos).toEqual({ x: 2, y: 1 });
    run(sim, TICKS_PER_SEC);
    expect(sim.player.pos).toEqual({ x: 3, y: 1 });
    expect(sim.player.path.length).toBe(0);
    expect(sim.player.isChannelFree('legs')).toBe(true);
  });

  it('diagonal step takes longer than orthogonal', () => {
    const sim = new Sim({ seed: 1, fixedMap: openRoom() });
    sim.command({ type: 'move', entity: sim.playerId, to: { x: 2, y: 2 } });
    run(sim, TICKS_PER_SEC);
    expect(sim.player.pos).toEqual({ x: 1, y: 1 });
    run(sim, Math.ceil(0.4 * TICKS_PER_SEC));
    expect(sim.player.pos).toEqual({ x: 2, y: 2 });
  });

  it('cancelling legs drops the path and stops', () => {
    const sim = new Sim({ seed: 1, fixedMap: openRoom() });
    sim.command({ type: 'move', entity: sim.playerId, to: { x: 6, y: 1 } });
    run(sim, 5);
    sim.command({ type: 'cancel', entity: sim.playerId, channel: 'legs' });
    expect(sim.player.path.length).toBe(0);
    expect(sim.player.isChannelFree('legs')).toBe(true);
    run(sim, 40);
    expect(sim.player.pos).toEqual({ x: 1, y: 1 });
  });

  it('reaching the exit emits reachedExit once and leave() wins', () => {
    const sim = new Sim({ seed: 1, fixedMap: openRoom() });
    sim.command({ type: 'move', entity: sim.playerId, to: sim.exit });
    let reached = 0;
    for (let i = 0; i < 400; i++) {
      for (const e of sim.step()) if (e.type === 'reachedExit') reached++;
    }
    expect(reached).toBe(1);
    expect(sim.player.pos).toEqual(sim.exit);
    sim.leave();
    expect(sim.status).toBe('won');
  });
});

describe('Sim: perception', () => {
  it('player sees the whole open room and explored tiles persist', () => {
    const sim = new Sim({ seed: 1, fixedMap: openRoom() });
    const idx = sim.map.idx(6, 4);
    expect(sim.player.visible.has(idx)).toBe(true);
    expect(sim.explored[idx]).toBe(1);
  });
});

describe('Sim: determinism', () => {
  it('same seed and commands reproduce the same world tick by tick', () => {
    const a = new Sim({ seed: 42, enemies: ['ghoul', 'ghoulKeen'] });
    const b = new Sim({ seed: 42, enemies: ['ghoul', 'ghoulKeen'] });
    expect([...a.map.tiles]).toEqual([...b.map.tiles]);
    const target = a.exit;
    a.command({ type: 'move', entity: a.playerId, to: target });
    b.command({ type: 'move', entity: b.playerId, to: target });
    for (let i = 0; i < 600; i++) {
      a.step();
      b.step();
      expect(a.player.pos).toEqual(b.player.pos);
      expect(a.rng.getState()).toBe(b.rng.getState());
    }
  });

  it('replay from the command log reproduces the state', () => {
    const opts = { seed: 7, enemies: ['ghoul', 'ghoul'] };
    const live = new Sim(opts);
    live.command({ type: 'autopilot', on: true });
    live.command({ type: 'move', entity: live.playerId, to: live.exit });
    for (let i = 0; i < 300; i++) live.step();
    live.command({ type: 'act', entity: live.playerId, action: 'shield' });
    for (let i = 0; i < 300; i++) live.step();

    const rep = Sim.replay(opts, live.commandLog, live.tick);
    expect(rep.tick).toBe(live.tick);
    expect(rep.player.pos).toEqual(live.player.pos);
    expect(rep.player.hp).toBe(live.player.hp);
    expect(rep.rng.getState()).toBe(live.rng.getState());
    expect(rep.alive().map((e) => [e.id, e.pos, e.hp])).toEqual(live.alive().map((e) => [e.id, e.pos, e.hp]));
  });
});
