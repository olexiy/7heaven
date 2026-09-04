import { describe, expect, it } from 'vitest';
import { computeFov, hasLineOfSight } from '../../src/core/world/fov';
import { mapFromAscii } from './fixtures';

const PILLAR = mapFromAscii([
  '#########',
  '#.......#',
  '#...#...#',
  '#.......#',
  '#########',
]);

describe('computeFov', () => {
  it('includes the origin', () => {
    const fov = computeFov(PILLAR, { x: 1, y: 2 }, 8);
    expect(fov.has(PILLAR.idx(1, 2))).toBe(true);
  });

  it('does not see through a wall, but sees the wall itself', () => {
    const fov = computeFov(PILLAR, { x: 1, y: 2 }, 8);
    expect(fov.has(PILLAR.idx(4, 2))).toBe(true); // the lit wall
    expect(fov.has(PILLAR.idx(6, 2))).toBe(false); // directly behind it
    expect(fov.has(PILLAR.idx(7, 2))).toBe(false);
    expect(fov.has(PILLAR.idx(3, 2))).toBe(true); // in front of it
  });

  it('does not see beyond the radius', () => {
    const fov = computeFov(PILLAR, { x: 1, y: 1 }, 3);
    expect(fov.has(PILLAR.idx(4, 1))).toBe(true); // distance 3
    expect(fov.has(PILLAR.idx(5, 1))).toBe(false); // distance 4
    expect(fov.has(PILLAR.idx(3, 3))).toBe(true); // 2,2 -> 8 <= 9
    expect(fov.has(PILLAR.idx(4, 3))).toBe(false); // 3,2 -> 13 > 9
  });

  it('sees an open room fully within the radius', () => {
    const size = 15;
    const rows: string[] = [];
    for (let y = 0; y < size; y++) {
      rows.push(y === 0 || y === size - 1 ? '#'.repeat(size) : '#' + '.'.repeat(size - 2) + '#');
    }
    const map = mapFromAscii(rows);
    const origin = { x: 7, y: 7 };
    const r = 5;
    const fov = computeFov(map, origin, r);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - origin.x;
        const dy = y - origin.y;
        const inRadius = dx * dx + dy * dy <= r * r;
        expect(fov.has(map.idx(x, y)), `tile ${x},${y}`).toBe(inRadius);
      }
    }
  });
});

describe('hasLineOfSight', () => {
  it('is blocked by a wall between the endpoints', () => {
    expect(hasLineOfSight(PILLAR, { x: 1, y: 2 }, { x: 7, y: 2 })).toBe(false);
    expect(hasLineOfSight(PILLAR, { x: 7, y: 2 }, { x: 1, y: 2 })).toBe(false);
  });

  it('is clear in open space', () => {
    expect(hasLineOfSight(PILLAR, { x: 1, y: 1 }, { x: 7, y: 1 })).toBe(true);
    expect(hasLineOfSight(PILLAR, { x: 1, y: 1 }, { x: 3, y: 3 })).toBe(true);
    // A diagonal line that crosses the pillar tile is blocked.
    expect(hasLineOfSight(PILLAR, { x: 1, y: 1 }, { x: 7, y: 3 })).toBe(false);
    expect(hasLineOfSight(PILLAR, { x: 3, y: 2 }, { x: 3, y: 2 })).toBe(true);
  });

  it('ignores the endpoints themselves', () => {
    // Looking at a wall tile from an adjacent floor tile is a clear line.
    expect(hasLineOfSight(PILLAR, { x: 3, y: 2 }, { x: 4, y: 2 })).toBe(true);
  });
});
