import type { Vec } from '../world/map';
import type { ActionInstance } from '../action/action';

export type EntityId = number;
export type Faction = 'player' | 'enemy';

/** Body channels. MVP: legs and hands (hands+mind merged). */
export type ChannelId = 'legs' | 'hands';
export const CHANNELS: readonly ChannelId[] = ['legs', 'hands'];

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

  isBusy(): boolean {
    return this.runningActions().length > 0;
  }
}
