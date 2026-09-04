import type { Vec } from '../world/map';
import type { ActionInstance } from '../action/action';

export type EntityId = number;
export type Faction = 'player' | 'enemy';

/** Body channels. Mind is merged into the hands for now (spells take both hands). */
export type ChannelId = 'legs' | 'rightHand' | 'leftHand';
export const CHANNELS: readonly ChannelId[] = ['legs', 'rightHand', 'leftHand'];

/** Facing as a unit-ish direction on the 8-neighbourhood grid. */
export interface Dir {
  dx: number;
  dy: number;
}

export type SkillId = 'sword' | 'unarmed' | 'shield' | 'fire';
export const SKILLS: readonly SkillId[] = ['sword', 'unarmed', 'shield', 'fire'];

export type StatusId = 'moving' | 'shielded' | 'wounded';

export type Awareness = 'unaware' | 'alert' | 'combat';

export interface Attributes {
  str: number;
  agi: number;
  end: number;
  int: number;
  wis: number;
  per: number;
}

export interface SkillState {
  level: number;
  xp: number;
}

export interface EntitySpec {
  kind: string;
  name: string;
  faction: Faction;
  maxHp: number;
  maxMana: number;
  attributes: Attributes;
  skills?: Partial<Record<SkillId, number>>;
  /** Sight radius in tiles. */
  sight: number;
  /** Base reaction delay in seconds (divided by perception factor). */
  reaction: number;
  actions: string[];
}

export class Entity {
  hp: number;
  mana: number;
  readonly maxHp: number;
  readonly maxMana: number;
  readonly attributes: Attributes;
  readonly skills = new Map<SkillId, SkillState>();
  readonly channels = new Map<ChannelId, ActionInstance | null>();
  readonly statuses = new Set<StatusId>();
  /** Pending movement path (next cells to step into). */
  path: Vec[] = [];
  alive = true;
  awareness: Awareness = 'unaware';
  /** Tiles currently visible (map indexes). */
  visible = new Set<number>();
  /** Tick when perception was last recomputed. */
  perceptionTick = -1;
  /** Position where perception was computed. */
  perceptionPos: Vec = { x: -1, y: -1 };
  /** Last known player position for AI (enemies). */
  lastSeenTarget: Vec | null = null;
  /** Tick until which AI is "thinking" (reaction delay). */
  reactUntil = 0;
  /** Timestamp of last damage received (for status/animation). */
  lastHitTick = -1;
  /** Where the body faces. Attacks from behind cannot be dodged or blocked. */
  facing: Dir = { dx: 0, dy: 1 };
  /** Per-action recovery: action id → tick when it can be used again. */
  readonly cooldowns = new Map<string, number>();

  constructor(
    readonly id: EntityId,
    readonly spec: EntitySpec,
    public pos: Vec,
  ) {
    this.maxHp = spec.maxHp;
    this.maxMana = spec.maxMana;
    this.hp = spec.maxHp;
    this.mana = spec.maxMana;
    this.attributes = { ...spec.attributes };
    for (const s of SKILLS) {
      this.skills.set(s, { level: spec.skills?.[s] ?? 0, xp: 0 });
    }
    for (const c of CHANNELS) this.channels.set(c, null);
  }

  get name(): string {
    return this.spec.name;
  }

  get faction(): Faction {
    return this.spec.faction;
  }

  skillLevel(id: SkillId): number {
    return this.skills.get(id)?.level ?? 0;
  }

  isChannelFree(c: ChannelId): boolean {
    return this.channels.get(c) === null;
  }

  channelsFree(cs: readonly ChannelId[]): boolean {
    return cs.every((c) => this.isChannelFree(c));
  }

  /** Current action on a channel, if any. */
  action(c: ChannelId): ActionInstance | null {
    return this.channels.get(c) ?? null;
  }

  /** All running actions (unique instances). */
  runningActions(): ActionInstance[] {
    const seen = new Set<ActionInstance>();
    for (const a of this.channels.values()) if (a) seen.add(a);
    return [...seen];
  }

  /** Moving = a step is running, or one is about to start (pending path with free legs). */
  isMoving(): boolean {
    const a = this.channels.get('legs');
    if (a) return a.def.kind === 'step';
    return this.path.length > 0;
  }

  /** Ticks until the action is ready again (0 = ready). */
  cooldownLeft(actionId: string, tick: number): number {
    const ready = this.cooldowns.get(actionId) ?? 0;
    return Math.max(0, ready - tick);
  }

  /** Turn toward a point (no cost here; the cost is applied by the action engine). */
  faceToward(x: number, y: number): void {
    const dx = Math.sign(x - this.pos.x);
    const dy = Math.sign(y - this.pos.y);
    if (dx !== 0 || dy !== 0) this.facing = { dx, dy };
  }

  /** True if `x,y` lies in the rear half-plane relative to the facing direction. */
  isBehind(x: number, y: number): boolean {
    const vx = x - this.pos.x;
    const vy = y - this.pos.y;
    if (vx === 0 && vy === 0) return false;
    return vx * this.facing.dx + vy * this.facing.dy < 0;
  }

  isBusy(): boolean {
    return this.runningActions().length > 0;
  }
}
