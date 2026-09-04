import type { GameMap, Vec } from './map';

/** Octant transforms for recursive shadowcasting: [xx, xy, yx, yy] per octant. */
const OCTANTS: readonly (readonly [number, number, number, number])[] = [
  [1, 0, 0, 1],
  [0, 1, 1, 0],
  [0, -1, 1, 0],
  [-1, 0, 0, 1],
  [-1, 0, 0, -1],
  [0, -1, -1, 0],
  [0, 1, -1, 0],
  [1, 0, 0, -1],
];

function castLight(
  map: GameMap,
  visible: Set<number>,
  cx: number,
  cy: number,
  row: number,
  startSlope: number,
  endSlope: number,
  radius: number,
  xx: number,
  xy: number,
  yx: number,
  yy: number,
): void {
  if (startSlope < endSlope) return;
  const radiusSq = radius * radius;
  let start = startSlope;
  let newStart = 0;
  for (let j = row; j <= radius; j++) {
    let dx = -j - 1;
    const dy = -j;
    let blocked = false;
    while (dx <= 0) {
      dx++;
      const x = cx + dx * xx + dy * xy;
      const y = cy + dx * yx + dy * yy;
      const lSlope = (dx - 0.5) / (dy + 0.5);
      const rSlope = (dx + 0.5) / (dy - 0.5);
      if (start < rSlope) continue;
      if (endSlope > lSlope) break;

      if (dx * dx + dy * dy <= radiusSq && map.inBounds(x, y)) {
        visible.add(map.idx(x, y));
      }
      const wall = map.isWall(x, y);
      if (blocked) {
        if (wall) {
          newStart = rSlope;
        } else {
          blocked = false;
          start = newStart;
        }
      } else if (wall && j < radius) {
        blocked = true;
        castLight(map, visible, cx, cy, j + 1, start, lSlope, radius, xx, xy, yx, yy);
        newStart = rSlope;
      }
    }
    if (blocked) break;
  }
}

/**
 * Recursive shadowcasting over 8 octants. Returns the set of tile indexes
 * visible from origin (origin included). Lit walls are included so they can
 * be drawn, but sight does not pass through them.
 */
export function computeFov(map: GameMap, origin: Vec, radius: number): Set<number> {
  const visible = new Set<number>();
  if (!map.inBounds(origin.x, origin.y)) return visible;
  visible.add(map.idx(origin.x, origin.y));
  for (const [xx, xy, yx, yy] of OCTANTS) {
    castLight(map, visible, origin.x, origin.y, 1, 1, 0, radius, xx, xy, yx, yy);
  }
  return visible;
}

/**
 * Bresenham line of sight. Blocked if any intermediate tile (endpoints
 * excluded) is a wall.
 */
export function hasLineOfSight(map: GameMap, from: Vec, to: Vec): boolean {
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const dy = -Math.abs(to.y - from.y);
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x === to.x && y === to.y) return true;
    if (!(x === from.x && y === from.y) && map.isWall(x, y)) return false;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}
