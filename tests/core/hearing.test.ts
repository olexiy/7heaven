import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/core/sim/sim';
import { ENTITIES } from '../../src/data/entities';
import { mapFromAscii } from '../world/fixtures';

/** Two rooms joined by a corridor; the ghoul cannot see the player but can hear a fireball. */
function twoRooms() {
  const map = mapFromAscii([
    '####################',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '#......#############',
    '####################',
  ]);
  return { map, playerStart: { x: 3, y: 2 }, exit: { x: 3, y: 28 } };
}

describe('hearing', () => {
  it('an unaware ghoul out of sight becomes alert from a fireball impact nearby and walks to it', () => {
    const sim = new Sim({ seed: 3, fixedMap: twoRooms() });
    // Far down the room, beyond player sight (7) but within fireball noise (8) of the impact tile.
    const ghoul = sim.spawn(ENTITIES['ghoul']!, { x: 3, y: 20 });
    sim.step();
    expect(ghoul.awareness).toBe('unaware');
    // Impact at (3, 12): 8 tiles from the ghoul, 10 from the player.
    sim.command({ type: 'act', entity: sim.playerId, action: 'fireball', target: { kind: 'tile', pos: { x: 3, y: 12 } } });
    for (let i = 0; i < 20 * 22; i++) sim.step();
    expect(ghoul.awareness).not.toBe('unaware');
    expect(ghoul.pos.y).toBeLessThan(20);
  });
});
