import type { GameMap, Vec } from './map';

const COST_ORTHO = 10;
const COST_DIAG = 14;

/** 8 neighbor offsets in a fixed order for deterministic expansion. */
const DIRS: readonly (readonly [number, number, number])[] = [
  [1, 0, COST_ORTHO],
  [-1, 0, COST_ORTHO],
  [0, 1, COST_ORTHO],
  [0, -1, COST_ORTHO],
  [1, 1, COST_DIAG],
  [1, -1, COST_DIAG],
  [-1, 1, COST_DIAG],
  [-1, -1, COST_DIAG],
];

interface HeapNode {
  f: number;
  seq: number;
  idx: number;
}

/** Binary min-heap ordered by f, then by insertion sequence (deterministic). */
class MinHeap {
  private readonly items: HeapNode[] = [];

  get size(): number {
    return this.items.length;
  }

  push(node: HeapNode): void {
    const items = this.items;
    items.push(node);
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const parent = items[p] as HeapNode;
      if (!MinHeap.less(node, parent)) break;
      items[i] = parent;
      i = p;
    }
    items[i] = node;
  }

  pop(): HeapNode {
    const items = this.items;
    const top = items[0] as HeapNode;
    const last = items.pop() as HeapNode;
    if (items.length > 0) {
      let i = 0;
      const n = items.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mNode = last;
        if (l < n && MinHeap.less(items[l] as HeapNode, mNode)) {
          m = l;
          mNode = items[l] as HeapNode;
        }
        if (r < n && MinHeap.less(items[r] as HeapNode, mNode)) {
          m = r;
          mNode = items[r] as HeapNode;
        }
        if (m === i) break;
        items[i] = mNode;
        i = m;
      }
      items[i] = last;
    }
    return top;
  }

  private static less(a: HeapNode, b: HeapNode): boolean {
    return a.f < b.f || (a.f === b.f && a.seq < b.seq);
  }
}

/** Octile heuristic with the same integer costs as the moves. */
function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return COST_ORTHO * Math.max(dx, dy) + (COST_DIAG - COST_ORTHO) * Math.min(dx, dy);
}

/**
 * A* on an 8-directional grid. No corner cutting: a diagonal step requires
 * both adjacent orthogonal tiles to be walkable. `isBlocked` marks dynamic
 * obstacles; the destination is never treated as blocked by it.
 * Returns the path excluding `from` and including `to`, or [] if unreachable
 * or from == to.
 */
export function findPath(
  map: GameMap,
  from: Vec,
  to: Vec,
  isBlocked?: (x: number, y: number) => boolean,
): Vec[] {
  if (from.x === to.x && from.y === to.y) return [];
  if (!map.isFloor(to.x, to.y) || !map.inBounds(from.x, from.y)) return [];

  const walkable = (x: number, y: number): boolean => {
    if (!map.isFloor(x, y)) return false;
    if (x === to.x && y === to.y) return true;
    return isBlocked === undefined || !isBlocked(x, y);
  };

  const size = map.w * map.h;
  const g = new Int32Array(size).fill(0x7fffffff);
  const parent = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const heap = new MinHeap();
  let seq = 0;

  const startIdx = map.idx(from.x, from.y);
  const goalIdx = map.idx(to.x, to.y);
  g[startIdx] = 0;
  heap.push({ f: heuristic(from.x, from.y, to.x, to.y), seq: seq++, idx: startIdx });

  while (heap.size > 0) {
    const cur = heap.pop();
    const ci = cur.idx;
    if (closed[ci] === 1) continue;
    closed[ci] = 1;
    if (ci === goalIdx) break;

    const cx = ci % map.w;
    const cy = Math.floor(ci / map.w);
    const cg = g[ci] as number;

    for (const [ox, oy, cost] of DIRS) {
      const nx = cx + ox;
      const ny = cy + oy;
      if (!walkable(nx, ny)) continue;
      if (ox !== 0 && oy !== 0 && (!walkable(cx + ox, cy) || !walkable(cx, cy + oy))) continue;
      const ni = map.idx(nx, ny);
      if (closed[ni] === 1) continue;
      const ng = cg + cost;
      if (ng >= (g[ni] as number)) continue;
      g[ni] = ng;
      parent[ni] = ci;
      heap.push({ f: ng + heuristic(nx, ny, to.x, to.y), seq: seq++, idx: ni });
    }
  }

  if (closed[goalIdx] !== 1) return [];

  const path: Vec[] = [];
  for (let i = goalIdx; i !== startIdx; i = parent[i] as number) {
    path.push({ x: i % map.w, y: Math.floor(i / map.w) });
  }
  path.reverse();
  return path;
}
