/** Isometric projection. The core lives on a square grid; only the renderer knows about diamonds. */
export const TILE_W = 64;
export const TILE_H = 32;
export const WALL_H = 26;
export const ENTITY_H = 30;

export interface ScreenPt {
  sx: number;
  sy: number;
}

/** Tile (x, y) → screen center of its diamond (world-space, before camera). */
export function toScreen(x: number, y: number): ScreenPt {
  return { sx: ((x - y) * TILE_W) / 2, sy: ((x + y) * TILE_H) / 2 };
}

/** Screen (world-space) → fractional tile coords. */
export function toTileF(sx: number, sy: number): { x: number; y: number } {
  const a = sx / (TILE_W / 2);
  const b = sy / (TILE_H / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** Screen (world-space) → nearest tile. */
export function toTile(sx: number, sy: number): { x: number; y: number } {
  const f = toTileF(sx, sy);
  return { x: Math.round(f.x), y: Math.round(f.y) };
}

/** Painter's depth for sorting: larger draws later. */
export function depth(x: number, y: number): number {
  return x + y;
}
