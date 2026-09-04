import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/sim/rng';
import { TILE_FLOOR, TILE_WALL } from '../../src/core/world/map';
import type { GameMap } from '../../src/core/world/map';
import { generateMap } from '../../src/core/world/mapgen';
import type { MapGenOptions } from '../../src/core/world/mapgen';

const OPTS: MapGenOptions = { w: 30, h: 30, minRooms: 5, maxRooms: 6, minRoomSize: 4, maxRoomSize: 8 };
const SEEDS = Array.from({ length: 20 }, (_, i) => 1000 + i * 7919);

/** Count floor tiles reachable from (sx, sy) with 4-directional BFS. */
function reachableFloor(map: GameMap, sx: number, sy: number): number {
  const seen = new Uint8Array(map.w * map.h);
  const queue = [map.idx(sx, sy)];
  seen[queue[0] as number] = 1;
  let head = 0;
  let count = 0;
  while (head < queue.length) {
    const cur = queue[head++] as number;
    count++;
    const x = cur % map.w;
    const y = Math.floor(cur / map.w);
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as const) {
      if (!map.isFloor(nx, ny)) continue;
      const ni = map.idx(nx, ny);
      if (seen[ni] === 1) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return count;
}

function countFloor(map: GameMap): number {
  let n = 0;
  for (const t of map.tiles) if (t === TILE_FLOOR) n++;
  return n;
}

describe('generateMap', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: valid dungeon`, () => {
      const { map, playerStart, exit } = generateMap(new Rng(seed), OPTS);

      expect(map.w).toBe(OPTS.w);
      expect(map.h).toBe(OPTS.h);
      expect(map.rooms.length).toBeGreaterThanOrEqual(OPTS.minRooms);
      expect(map.rooms.length).toBeLessThanOrEqual(OPTS.maxRooms);

      // Border is all wall.
      for (let x = 0; x < map.w; x++) {
        expect(map.get(x, 0)).toBe(TILE_WALL);
        expect(map.get(x, map.h - 1)).toBe(TILE_WALL);
      }
      for (let y = 0; y < map.h; y++) {
        expect(map.get(0, y)).toBe(TILE_WALL);
        expect(map.get(map.w - 1, y)).toBe(TILE_WALL);
      }

      // Start and exit are distinct floor tiles.
      expect(map.isFloor(playerStart.x, playerStart.y)).toBe(true);
      expect(map.isFloor(exit.x, exit.y)).toBe(true);
      expect(playerStart).not.toEqual(exit);

      // Every floor tile is reachable from the start.
      expect(reachableFloor(map, playerStart.x, playerStart.y)).toBe(countFloor(map));

      // Rooms are floor and separated from each other by at least 1 wall tile.
      for (const r of map.rooms) {
        for (let y = r.y; y < r.y + r.h; y++) {
          for (let x = r.x; x < r.x + r.w; x++) expect(map.isFloor(x, y)).toBe(true);
        }
      }
      for (let i = 0; i < map.rooms.length; i++) {
        for (let j = i + 1; j < map.rooms.length; j++) {
          const a = map.rooms[i]!;
          const b = map.rooms[j]!;
          const separated =
            a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y;
          expect(separated).toBe(true);
        }
      }
    });
  }

  it('is deterministic for the same seed', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const a = generateMap(new Rng(seed), OPTS);
      const b = generateMap(new Rng(seed), OPTS);
      expect(Array.from(a.map.tiles)).toEqual(Array.from(b.map.tiles));
      expect(a.map.rooms).toEqual(b.map.rooms);
      expect(a.playerStart).toEqual(b.playerStart);
      expect(a.exit).toEqual(b.exit);
    }
  });

  it('differs across seeds', () => {
    const a = generateMap(new Rng(1), OPTS);
    const b = generateMap(new Rng(2), OPTS);
    expect(Array.from(a.map.tiles)).not.toEqual(Array.from(b.map.tiles));
  });
});
