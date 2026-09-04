import { GameMap, TILE_FLOOR, rectCenter } from './map';
import type { Rect, Vec } from './map';
import type { Rng } from '../sim/rng';

export interface MapGenOptions {
  w: number;
  h: number;
  minRooms: number;
  maxRooms: number;
  minRoomSize: number;
  maxRoomSize: number;
}

export interface GeneratedMap {
  map: GameMap;
  playerStart: Vec;
  exit: Vec;
}

/** Random placement attempts before giving up on more rooms. */
const PLACEMENT_ATTEMPTS = 500;

/** True if rects a and b overlap when a 1-tile margin is kept between them. */
function overlapsWithMargin(a: Rect, b: Rect): boolean {
  return (
    a.x - 1 < b.x + b.w &&
    a.x + a.w + 1 > b.x &&
    a.y - 1 < b.y + b.h &&
    a.y + a.h + 1 > b.y
  );
}

function carveRect(map: GameMap, r: Rect): void {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      map.set(x, y, TILE_FLOOR);
    }
  }
}

function carveHorizontal(map: GameMap, x0: number, x1: number, y: number): void {
  const from = Math.min(x0, x1);
  const to = Math.max(x0, x1);
  for (let x = from; x <= to; x++) map.set(x, y, TILE_FLOOR);
}

function carveVertical(map: GameMap, y0: number, y1: number, x: number): void {
  const from = Math.min(y0, y1);
  const to = Math.max(y0, y1);
  for (let y = from; y <= to; y++) map.set(x, y, TILE_FLOOR);
}

/** Carve an L-shaped, 1-tile-wide corridor between two points. */
function carveCorridor(map: GameMap, a: Vec, b: Vec, horizontalFirst: boolean): void {
  if (horizontalFirst) {
    carveHorizontal(map, a.x, b.x, a.y);
    carveVertical(map, a.y, b.y, b.x);
  } else {
    carveVertical(map, a.y, b.y, a.x);
    carveHorizontal(map, a.x, b.x, b.y);
  }
}

/**
 * BFS over floor tiles (4-directional, so 1-wide corridors count as connected).
 * Returns per-tile distance from the origin, or -1 for unreachable / wall tiles.
 */
export function floorDistances(map: GameMap, origin: Vec): Int32Array {
  const dist = new Int32Array(map.w * map.h).fill(-1);
  if (!map.isFloor(origin.x, origin.y)) return dist;
  const start = map.idx(origin.x, origin.y);
  const queue: number[] = [start];
  dist[start] = 0;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++] as number;
    const cx = cur % map.w;
    const cy = Math.floor(cur / map.w);
    const d = dist[cur] as number;
    const neighbors: readonly (readonly [number, number])[] = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (!map.isFloor(nx, ny)) continue;
      const ni = map.idx(nx, ny);
      if (dist[ni] !== -1) continue;
      dist[ni] = d + 1;
      queue.push(ni);
    }
  }
  return dist;
}

function placeRooms(rng: Rng, opts: MapGenOptions): Rect[] {
  const rooms: Rect[] = [];
  const target = rng.int(opts.minRooms, opts.maxRooms);

  const tryPlace = (minSize: number, maxSize: number): boolean => {
    const rw = rng.int(minSize, maxSize);
    const rh = rng.int(minSize, maxSize);
    // Keep a 1-tile wall margin from the map border.
    const maxX = opts.w - rw - 2;
    const maxY = opts.h - rh - 2;
    if (maxX < 1 || maxY < 1) return false;
    const r: Rect = { x: rng.int(1, maxX), y: rng.int(1, maxY), w: rw, h: rh };
    for (const other of rooms) {
      if (overlapsWithMargin(r, other)) return false;
    }
    rooms.push(r);
    return true;
  };

  for (let i = 0; i < PLACEMENT_ATTEMPTS && rooms.length < target; i++) {
    tryPlace(opts.minRoomSize, opts.maxRoomSize);
  }
  // Fallback: if random placement could not reach the minimum, squeeze in
  // smallest rooms so the room count stays within the requested range.
  for (let i = 0; i < PLACEMENT_ATTEMPTS && rooms.length < opts.minRooms; i++) {
    tryPlace(opts.minRoomSize, opts.minRoomSize);
  }
  if (rooms.length === 0) {
    throw new Error('generateMap: could not place any room; map too small for room size');
  }
  return rooms;
}

/**
 * Generate a rooms-and-corridors dungeon. Deterministic for a given rng state
 * and options.
 */
export function generateMap(rng: Rng, opts: MapGenOptions): GeneratedMap {
  const rooms = placeRooms(rng, opts);
  const map = new GameMap(opts.w, opts.h, rooms);
  for (const r of rooms) carveRect(map, r);

  const centers = rooms.map(rectCenter);

  // Chain: room i -> room i+1.
  for (let i = 0; i + 1 < centers.length; i++) {
    carveCorridor(map, centers[i] as Vec, centers[i + 1] as Vec, rng.chance(0.5));
  }

  // Extra 1-2 random connections to create loops.
  if (centers.length >= 3) {
    const extra = rng.int(1, 2);
    for (let k = 0; k < extra; k++) {
      const i = rng.int(0, centers.length - 1);
      let j = rng.int(0, centers.length - 2);
      if (j >= i) j++;
      carveCorridor(map, centers[i] as Vec, centers[j] as Vec, rng.chance(0.5));
    }
  }

  const playerStart = centers[0] as Vec;

  // Connectivity guarantee: any floor tile unreachable from the start gets a
  // corridor carved to it from the start. Corridors between interior tiles
  // never touch the border, so the outer wall stays intact.
  let dist = floorDistances(map, playerStart);
  for (let guard = 0; guard < map.w * map.h; guard++) {
    let unreachable = -1;
    for (let i = 0; i < dist.length; i++) {
      if (map.tiles[i] === TILE_FLOOR && dist[i] === -1) {
        unreachable = i;
        break;
      }
    }
    if (unreachable === -1) break;
    const target: Vec = { x: unreachable % map.w, y: Math.floor(unreachable / map.w) };
    carveCorridor(map, playerStart, target, rng.chance(0.5));
    dist = floorDistances(map, playerStart);
  }

  // Exit: center of the room farthest from the start by BFS distance.
  let exit = playerStart;
  let best = -1;
  for (let i = 1; i < centers.length; i++) {
    const c = centers[i] as Vec;
    const d = dist[map.idx(c.x, c.y)] as number;
    if (d > best) {
      best = d;
      exit = c;
    }
  }
  if (centers.length === 1) {
    // Single room: fall back to the farthest floor tile.
    for (let i = 0; i < dist.length; i++) {
      const d = dist[i] as number;
      if (d > best) {
        best = d;
        exit = { x: i % map.w, y: Math.floor(i / map.w) };
      }
    }
  }

  return { map, playerStart, exit };
}
