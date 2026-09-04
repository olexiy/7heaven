export interface Vec {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const TILE_FLOOR = 0;
export const TILE_WALL = 1;

export function vecEq(a: Vec, b: Vec): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Chebyshev distance (8-directional grid). */
export function chebyshev(a: Vec, b: Vec): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function rectCenter(r: Rect): Vec {
  return { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
}

/** Grid of tiles. Walls block movement and sight. */
export class GameMap {
  readonly tiles: Uint8Array;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly rooms: readonly Rect[] = [],
    tiles?: Uint8Array,
  ) {
    this.tiles = tiles ?? new Uint8Array(w * h).fill(TILE_WALL);
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): number {
    if (!this.inBounds(x, y)) return TILE_WALL;
    return this.tiles[this.idx(x, y)] as number;
  }

  set(x: number, y: number, tile: number): void {
    if (this.inBounds(x, y)) this.tiles[this.idx(x, y)] = tile;
  }

  isWall(x: number, y: number): boolean {
    return this.get(x, y) === TILE_WALL;
  }

  isFloor(x: number, y: number): boolean {
    return this.get(x, y) === TILE_FLOOR;
  }
}
