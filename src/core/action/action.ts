import type { Vec } from '../world/map';
import type { ChannelId, EntityId, SkillId } from '../entity/entity';

export type ActionKind = 'step' | 'melee' | 'shield' | 'spell';

/**
 * Basic actions may be used by auto-attack; abilities are always started by hand
 * (player) or by the AI, and usually carry a longer cooldown.
 */
export type ActionCategory = 'action' | 'ability';

export type CancelPolicy = 'keep' | 'loseAccumulated' | 'loseAll';

export interface PhaseDef {
  id: string;
  /** Base duration in seconds (before modifiers). */
  baseDuration: number;
  /** Can an external hit interrupt this phase? */
  interruptible: boolean;
  /** Base chance (0..1) that the phase fails at its end (before modifiers). */
  failBase: number;
  onCancel: CancelPolicy;
}

export interface ActionDef {
  id: string;
  name: string;
  kind: ActionKind;
  category: ActionCategory;
  channels: readonly ChannelId[];
  /** Recovery time in seconds after the action ends before it can be used again. */
  cooldown?: number;
  phases: readonly PhaseDef[];
  /** Governing skill (for duration modifiers and XP). */
  skill?: SkillId;
  cost?: { mana?: number };
  /** Max Chebyshev range to target; undefined = self. */
  range?: number;
  needsLos?: boolean;
  /** Ring/particle color. */
  color: string;
  /** Damage range [min, max]. */
  damage?: readonly [number, number];
  /** Chance to interrupt an interruptible phase on hit. */
  interruptChance?: number;
  /** Fraction of incoming damage removed while active (shield). */
  damageReduction?: number;
  /** Noise radius in tiles. */
  noise?: number;
}

export type Target = { kind: 'tile'; pos: Vec } | { kind: 'entity'; id: EntityId };

export interface ActionInstance {
  readonly def: ActionDef;
  readonly actor: EntityId;
  readonly target: Target | null;
  phaseIndex: number;
  /** Ticks left in current phase. */
  remaining: number;
  /** Total ticks of current phase (after modifiers). */
  phaseTotal: number;
  /** Resource accumulated so far (mana). */
  accumulated: number;
  readonly startedTick: number;
  /** Set on 'step': destination cell. */
  readonly stepTo: Vec | null;
}

export function currentPhase(a: ActionInstance): PhaseDef {
  const p = a.def.phases[a.phaseIndex];
  if (!p) throw new Error(`Action ${a.def.id}: no phase ${a.phaseIndex}`);
  return p;
}

/** 0..1 progress of the whole action (phases weighted equally by their base duration). */
export function actionProgress(a: ActionInstance): number {
  const total = a.def.phases.reduce((s, p) => s + p.baseDuration, 0);
  let done = 0;
  for (let i = 0; i < a.phaseIndex; i++) done += a.def.phases[i]!.baseDuration;
  const cur = a.def.phases[a.phaseIndex]!;
  const curFrac = a.phaseTotal > 0 ? 1 - a.remaining / a.phaseTotal : 1;
  done += cur.baseDuration * curFrac;
  return total > 0 ? done / total : 1;
}
