import type { Vec } from './world/map';
import type { ChannelId, EntityId } from './entity/entity';

export type GameEvent =
  | { type: 'moved'; id: EntityId; from: Vec; to: Vec }
  | { type: 'actionStarted'; id: EntityId; action: string; channels: readonly ChannelId[] }
  | { type: 'phaseChanged'; id: EntityId; action: string; phase: string }
  | { type: 'actionFailed'; id: EntityId; action: string; phase: string; reason: string }
  | { type: 'actionCancelled'; id: EntityId; action: string; phase: string }
  | { type: 'actionDone'; id: EntityId; action: string }
  | { type: 'hit'; attacker: EntityId; target: EntityId; damage: number; crit: boolean; action: string }
  | { type: 'missed'; attacker: EntityId; target: EntityId; action: string; reason: 'miss' | 'dodge' }
  | { type: 'blocked'; target: EntityId; absorbed: number; full: boolean }
  | { type: 'interrupted'; attacker: EntityId; target: EntityId; action: string }
  | { type: 'projectile'; from: Vec; to: Vec; action: string; ticks: number }
  | { type: 'died'; id: EntityId }
  | { type: 'spotted'; id: EntityId; target: EntityId }
  | { type: 'lostSight'; id: EntityId; target: EntityId }
  | { type: 'noise'; at: Vec; radius: number; source: EntityId }
  | { type: 'xp'; id: EntityId; skill: string; amount: number; levelUp: boolean }
  | { type: 'reachedExit'; id: EntityId }
  | { type: 'log'; text: string };
