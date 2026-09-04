import { Rng } from './rng';
import { GameMap, chebyshev, vecEq, type Vec } from '../world/map';
import { generateMap, type MapGenOptions } from '../world/mapgen';
import { computeFov } from '../world/fov';
import { findPath } from '../world/path';
import { Entity, type ChannelId, type EntityId, type EntitySpec } from '../entity/entity';
import type { ActionDef, Target } from '../action/action';
import { advanceAction, cancelAction, startAction } from '../action/engine';
import type { GameEvent } from '../events';
import { ACTIONS } from '../../data/actions';
import { ENTITIES } from '../../data/entities';
import { aiStep } from '../ai/ai';
import { secToTicks } from '../time';

export type Command =
  | { type: 'move'; entity: EntityId; to: Vec }
  | { type: 'stop'; entity: EntityId }
  | { type: 'act'; entity: EntityId; action: string; target?: Target }
  | { type: 'cancel'; entity: EntityId; channel: ChannelId }
  | { type: 'autopilot'; on: boolean };

export interface LoggedCommand {
  tick: number;
  cmd: Command;
}

export interface SimOptions {
  seed: number;
  map?: Partial<MapGenOptions>;
  /** Enemy kinds to spawn (in rooms other than the start room). */
  enemies?: string[];
  /** Skip map generation and use this map (tests). */
  fixedMap?: { map: GameMap; playerStart: Vec; exit: Vec };
}

export type SimStatus = 'running' | 'won' | 'lost';

const DEFAULT_MAP: MapGenOptions = { w: 30, h: 30, minRooms: 5, maxRooms: 6, minRoomSize: 4, maxRoomSize: 8 };

export class Sim {
  readonly seed: number;
  readonly rng: Rng;
  readonly map: GameMap;
  readonly playerStart: Vec;
  readonly exit: Vec;
  readonly entities = new Map<EntityId, Entity>();
  readonly playerId: EntityId;
  /** 1 = tile has been seen at least once. */
  readonly explored: Uint8Array;
  readonly commandLog: LoggedCommand[] = [];
  tick = 0;
  status: SimStatus = 'running';
  autopilot = false;
  private nextId = 1;
  private eventBuf: GameEvent[] = [];
  private atExitNotified = false;

  constructor(readonly opts: SimOptions) {
    this.seed = opts.seed;
    this.rng = new Rng(opts.seed);
    const gen = opts.fixedMap ?? generateMap(this.rng, { ...DEFAULT_MAP, ...opts.map });
    this.map = gen.map;
    this.playerStart = gen.playerStart;
    this.exit = gen.exit;
    this.explored = new Uint8Array(this.map.w * this.map.h);
    this.playerId = this.spawn(ENTITIES['player']!, gen.playerStart).id;
    this.spawnEnemies(opts.enemies ?? []);
    this.updatePerception();
  }

  get player(): Entity {
    return this.entities.get(this.playerId)!;
  }

  actionDef(id: string): ActionDef {
    const d = ACTIONS[id];
    if (!d) throw new Error(`Unknown action ${id}`);
    return d;
  }

  spawn(spec: EntitySpec, pos: Vec): Entity {
    const e = new Entity(this.nextId++, spec, pos);
    this.entities.set(e.id, e);
    return e;
  }

  private spawnEnemies(kinds: string[]): void {
    const rooms = this.map.rooms.filter((r) => !(this.playerStart.x >= r.x && this.playerStart.x < r.x + r.w && this.playerStart.y >= r.y && this.playerStart.y < r.y + r.h));
    if (rooms.length === 0) return;
    for (const kind of kinds) {
      const spec = ENTITIES[kind];
      if (!spec) throw new Error(`Unknown entity ${kind}`);
      for (let tries = 0; tries < 50; tries++) {
        const r = this.rng.pick(rooms);
        const pos = { x: this.rng.int(r.x, r.x + r.w - 1), y: this.rng.int(r.y, r.y + r.h - 1) };
        if (this.map.isFloor(pos.x, pos.y) && !this.entityAt(pos) && !vecEq(pos, this.exit)) {
          this.spawn(spec, pos);
          break;
        }
      }
    }
  }

  entityAt(pos: Vec): Entity | undefined {
    for (const e of this.entities.values()) if (e.alive && vecEq(e.pos, pos)) return e;
    return undefined;
  }

  alive(): Entity[] {
    return [...this.entities.values()].filter((e) => e.alive);
  }

  enemiesAlive(): Entity[] {
    return this.alive().filter((e) => e.faction === 'enemy');
  }

  emit(e: GameEvent): void {
    this.eventBuf.push(e);
    if (e.type === 'noise') this.hear(e.at, e.radius, e.source);
  }

  /** Apply a command at the current tick. Logged for replay. */
  command(cmd: Command): void {
    this.commandLog.push({ tick: this.tick, cmd });
    this.apply(cmd);
  }

  private apply(cmd: Command): void {
    switch (cmd.type) {
      case 'autopilot':
        this.autopilot = cmd.on;
        return;
      case 'move': {
        const e = this.entities.get(cmd.entity);
        if (!e || !e.alive) return;
        this.setDestination(e, cmd.to);
        return;
      }
      case 'stop': {
        const e = this.entities.get(cmd.entity);
        if (e) e.path = [];
        return;
      }
      case 'act': {
        const e = this.entities.get(cmd.entity);
        if (!e || !e.alive) return;
        const def = this.actionDef(cmd.action);
        const res = startAction(this, e, def, cmd.target ?? null);
        if (!res.ok) this.emit({ type: 'log', text: `${def.name}: ${reasonText(res.reason)}` });
        return;
      }
      case 'cancel': {
        const e = this.entities.get(cmd.entity);
        if (!e) return;
        const a = e.action(cmd.channel);
        if (a) cancelAction(this, e, a);
        // Cancelling legs also drops the pending path.
        if (cmd.channel === 'legs') e.path = [];
        return;
      }
    }
  }

  /** Plan a path for an entity; entities block except the destination. */
  setDestination(e: Entity, to: Vec): boolean {
    if (!this.map.isFloor(to.x, to.y)) return false;
    const blocked = (x: number, y: number): boolean => {
      const o = this.entityAt({ x, y });
      return !!o && o.id !== e.id;
    };
    const path = findPath(this.map, e.pos, to, blocked);
    e.path = path;
    return path.length > 0;
  }

  /** Advance the world by one tick. Returns events emitted during this tick. */
  step(): GameEvent[] {
    this.eventBuf = [];
    if (this.status !== 'running') return this.eventBuf;
    this.tick++;

    // Start pending path steps first so a step started this tick also advances this tick:
    // an action that becomes possible at tick T completes at tick T + duration.
    for (const e of this.alive()) this.continuePath(e);
    for (const e of this.alive()) {
      for (const a of e.runningActions()) advanceAction(this, e, a);
    }
    this.updatePerception();
    for (const e of this.alive()) {
      if (e.faction === 'enemy') aiStep(this, e);
    }
    if (this.autopilot && this.player.alive) aiStep(this, this.player);

    const p = this.player;
    if (!p.alive) {
      this.status = 'lost';
    } else if (vecEq(p.pos, this.exit)) {
      if (!this.atExitNotified) {
        this.atExitNotified = true;
        this.emit({ type: 'reachedExit', id: p.id });
      }
    } else {
      this.atExitNotified = false;
    }
    return this.eventBuf;
  }

  /** Player confirmed leaving through the exit. */
  leave(): void {
    if (vecEq(this.player.pos, this.exit)) this.status = 'won';
  }

  private continuePath(e: Entity): void {
    if (e.path.length === 0 || !e.isChannelFree('legs')) return;
    const next = e.path[0]!;
    const occupant = this.entityAt(next);
    if (occupant) {
      // Re-plan around the obstacle; if impossible, wait a moment.
      const dest = e.path[e.path.length - 1]!;
      if (vecEq(dest, next)) {
        e.path = [];
        return;
      }
      if (!this.setDestination(e, dest)) e.path = [];
      return;
    }
    const res = startAction(this, e, this.actionDef('step'), { kind: 'tile', pos: next });
    if (res.ok) e.path.shift();
    else e.path = [];
  }

  private updatePerception(): void {
    const alive = this.alive();
    for (const e of alive) {
      e.visible = computeFov(this.map, e.pos, e.spec.sight);
      e.perceptionTick = this.tick;
      e.perceptionPos = e.pos;
    }
    const p = this.player;
    if (p.alive) for (const i of p.visible) this.explored[i] = 1;

    for (const e of alive) {
      if (e.faction !== 'enemy' || !p.alive) continue;
      const sees = e.visible.has(this.map.idx(p.pos.x, p.pos.y));
      if (sees) {
        e.lastSeenTarget = p.pos;
        if (e.awareness !== 'combat') {
          e.awareness = 'combat';
          e.reactUntil = this.tick + secToTicks(e.spec.reaction * (10 / Math.max(1, e.attributes.per)));
          this.emit({ type: 'spotted', id: e.id, target: p.id });
        }
      } else if (e.awareness === 'combat' && e.lastSeenTarget && chebyshev(e.pos, e.lastSeenTarget) <= 1) {
        // Reached last known position without seeing anyone: calm down to alert.
        e.awareness = 'alert';
        this.emit({ type: 'lostSight', id: e.id, target: p.id });
      }
    }
  }

  /** Hearing: enemies within radius become alert and head to the source. */
  hear(at: Vec, radius: number, source: EntityId): void {
    for (const e of this.alive()) {
      if (e.id === source || e.faction !== 'enemy' || e.awareness === 'combat') continue;
      if (chebyshev(e.pos, at) <= radius) {
        e.awareness = 'alert';
        e.lastSeenTarget = at;
        e.reactUntil = this.tick + secToTicks(e.spec.reaction);
      }
    }
  }

  /** Reconstruct a run from seed and command log. */
  static replay(opts: SimOptions, log: readonly LoggedCommand[], untilTick: number): Sim {
    const sim = new Sim(opts);
    let i = 0;
    while (sim.tick < untilTick && sim.status === 'running') {
      while (i < log.length && log[i]!.tick === sim.tick) {
        sim.command(log[i]!.cmd);
        i++;
      }
      sim.step();
    }
    return sim;
  }
}

function reasonText(reason: string): string {
  switch (reason) {
    case 'channelBusy':
      return 'занято';
    case 'noMana':
      return 'нет маны';
    case 'outOfRange':
      return 'слишком далеко';
    case 'noLos':
      return 'цель не видна';
    case 'noTarget':
      return 'нет цели';
    default:
      return reason;
  }
}
