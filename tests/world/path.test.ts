import { describe, expect, it } from 'vitest';
import { chebyshev } from '../../src/core/world/map';
import type { GameMap, Vec } from '../../src/core/world/map';
import { findPath } from '../../src/core/world/path';
import { mapFromAscii } from './fixtures';

/** Every step is one tile, on floor, without cutting corners. */
function assertValidPath(map: GameMap, from: Vec, path: Vec[]): void {
  let prev = from;
  for (const p of path) {
    expect(chebyshev(prev, p)).toBe(1);
    expect(map.isFloor(p.x, p.y)).toBe(true);
    if (p.x !== prev.x && p.y !== prev.y) {
      expect(map.isFloor(p.x, prev.y)).toBe(true);
      expect(map.isFloor(prev.x, p.y)).toBe(true);
    }
    prev = p;
  }
}

describe('findPath', () => {
  it('walks a straight corridor', () => {
    const map = mapFromAscii(['#######', '#.....#', '#######']);
    const path = findPath(map, { x: 1, y: 1 }, { x: 5, y: 1 });
    expect(path).toEqual([
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 1 },
      { x: 5, y: 1 },
    ]);
  });

  it('goes around a wall', () => {
    const map = mapFromAscii(['#######', '#.....#', '#.###.#', '#.....#', '#######']);
    const from = { x: 1, y: 1 };
    const to = { x: 3, y: 3 };
    const path = findPath(map, from, to);
    expect(path.length).toBe(4);
    expect(path[path.length - 1]).toEqual(to);
    assertValidPath(map, from, path);
  });

  it('returns [] when unreachable', () => {
    const map = mapFromAscii(['#######', '#..#..#', '#..#..#', '#######']);
    expect(findPath(map, { x: 1, y: 1 }, { x: 5, y: 2 })).toEqual([]);
  });

  it('returns [] when the destination is a wall', () => {
    const map = mapFromAscii(['#######', '#.....#', '#######']);
    expect(findPath(map, { x: 1, y: 1 }, { x: 3, y: 0 })).toEqual([]);
  });

  it('returns [] when from == to', () => {
    const map = mapFromAscii(['#######', '#.....#', '#######']);
    expect(findPath(map, { x: 2, y: 1 }, { x: 2, y: 1 })).toEqual([]);
  });

  it('does not cut corners through a diagonal wall gap', () => {
    const map = mapFromAscii(['#####', '#.#.#', '##.##', '#.#.#', '#####']);
    expect(findPath(map, { x: 1, y: 1 }, { x: 3, y: 3 })).toEqual([]);
    expect(findPath(map, { x: 1, y: 1 }, { x: 2, y: 2 })).toEqual([]);
  });

  it('prefers a safe orthogonal step over a corner cut', () => {
    const map = mapFromAscii(['#####', '#..##', '##..#', '#####']);
    const from = { x: 1, y: 1 };
    const to = { x: 3, y: 2 };
    const path = findPath(map, from, to);
    expect(path).toEqual([
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ]);
    assertValidPath(map, from, path);
  });

  it('uses diagonals in open space', () => {
    const map = mapFromAscii(['######', '#....#', '#....#', '#....#', '#....#', '######']);
    const path = findPath(map, { x: 1, y: 1 }, { x: 4, y: 4 });
    expect(path).toEqual([
      { x: 2, y: 2 },
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ]);
  });

  it('detours around a dynamic obstacle', () => {
    const map = mapFromAscii(['#######', '#.....#', '#.....#', '#######']);
    const from = { x: 1, y: 1 };
    const to = { x: 5, y: 1 };
    const blocked = (x: number, y: number) => x === 3 && y === 1;
    const path = findPath(map, from, to, blocked);
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual(to);
    expect(path.some((p) => p.x === 3 && p.y === 1)).toBe(false);
    assertValidPath(map, from, path);
  });

  it('can target a destination that isBlocked marks as occupied', () => {
    const map = mapFromAscii(['#######', '#.....#', '#######']);
    const to = { x: 5, y: 1 };
    const blocked = (x: number, y: number) => x === to.x && y === to.y;
    const path = findPath(map, { x: 1, y: 1 }, to, blocked);
    expect(path.length).toBe(4);
    expect(path[path.length - 1]).toEqual(to);
  });

  it('returns [] when dynamic obstacles fully block the way', () => {
    const map = mapFromAscii(['#######', '#.....#', '#.....#', '#######']);
    const blocked = (x: number) => x === 3;
    expect(findPath(map, { x: 1, y: 1 }, { x: 5, y: 1 }, blocked)).toEqual([]);
  });

  it('is deterministic across calls', () => {
    const map = mapFromAscii([
      '##########',
      '#........#',
      '#..##....#',
      '#..#.....#',
      '#....##..#',
      '#........#',
      '##########',
    ]);
    const a = findPath(map, { x: 1, y: 1 }, { x: 8, y: 5 });
    const b = findPath(map, { x: 1, y: 1 }, { x: 8, y: 5 });
    expect(a).toEqual(b);
    // Walls block the 7-step diagonal; the shortest legal route is 8 steps.
    expect(a.length).toBe(8);
    assertValidPath(map, { x: 1, y: 1 }, a);
  });
});
