import { GameMap, TILE_FLOOR, TILE_WALL } from '../../src/core/world/map';

/**
 * Build a GameMap from ASCII rows: '#' is wall, anything else is floor.
 * All rows must have the same length.
 */
export function mapFromAscii(rows: readonly string[]): GameMap {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = rows[y] as string;
    if (row.length !== w) throw new Error(`mapFromAscii: row ${y} has length ${row.length}, expected ${w}`);
    for (let x = 0; x < w; x++) {
      tiles[y * w + x] = row[x] === '#' ? TILE_WALL : TILE_FLOOR;
    }
  }
  return new GameMap(w, h, [], tiles);
}
