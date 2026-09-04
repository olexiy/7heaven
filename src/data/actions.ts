import type { ActionDef } from '../core/action/action';

/**
 * Rule numbers live here, not in core. Durations in seconds (level 0).
 * Terminology: "action" = basic move usable by auto-attack; "ability" = started by hand, longer recovery.
 */
export const ACTIONS: Record<string, ActionDef> = {
  step: {
    id: 'step',
    name: 'Шаг',
    kind: 'step',
    category: 'action',
    channels: ['legs'],
    phases: [{ id: 'step', baseDuration: 1.0, interruptible: false, failBase: 0, onCancel: 'keep' }],
    color: '#8ecae6',
  },
  sword: {
    id: 'sword',
    name: 'Удар мечом',
    kind: 'melee',
    category: 'action',
    channels: ['rightHand'],
    cooldown: 1.0,
    skill: 'sword',
    range: 1,
    damage: [15, 25],
    noise: 3,
    phases: [{ id: 'swing', baseDuration: 2.0, interruptible: false, failBase: 0, onCancel: 'keep' }],
    color: '#e0e0e0',
  },
  kick: {
    id: 'kick',
    name: 'Удар ногой',
    kind: 'melee',
    category: 'action',
    channels: ['legs'],
    cooldown: 5.0,
    skill: 'unarmed',
    range: 1,
    damage: [5, 10],
    interruptChance: 0.3,
    noise: 2,
    phases: [{ id: 'kick', baseDuration: 1.0, interruptible: false, failBase: 0, onCancel: 'keep' }],
    color: '#f4a261',
  },
  shield: {
    id: 'shield',
    name: 'Щит',
    kind: 'shield',
    category: 'ability',
    channels: ['leftHand'],
    cooldown: 4.0,
    skill: 'shield',
    damageReduction: 0.7,
    phases: [
      { id: 'raise', baseDuration: 0.5, interruptible: false, failBase: 0, onCancel: 'keep' },
      { id: 'hold', baseDuration: 5.0, interruptible: false, failBase: 0, onCancel: 'keep' },
    ],
    color: '#4cc9f0',
  },
  shieldBash: {
    id: 'shieldBash',
    name: 'Удар щитом',
    kind: 'melee',
    category: 'ability',
    channels: ['leftHand'],
    cooldown: 8.0,
    skill: 'shield',
    range: 1,
    damage: [8, 14],
    interruptChance: 0.6,
    noise: 3,
    phases: [{ id: 'bash', baseDuration: 1.2, interruptible: false, failBase: 0, onCancel: 'keep' }],
    color: '#90e0ef',
  },
  fireball: {
    id: 'fireball',
    name: 'Огненный шар',
    kind: 'spell',
    category: 'ability',
    channels: ['rightHand', 'leftHand'],
    cooldown: 3.0,
    skill: 'fire',
    cost: { mana: 30 },
    range: 12,
    needsLos: true,
    damage: [35, 55],
    noise: 8,
    phases: [
      { id: 'gather', baseDuration: 3.0, interruptible: true, failBase: 0, onCancel: 'loseAccumulated' },
      { id: 'form', baseDuration: 3.0, interruptible: false, failBase: 0.05, onCancel: 'loseAll' },
      { id: 'release', baseDuration: 3.0, interruptible: false, failBase: 0, onCancel: 'loseAll' },
    ],
    color: '#ff6b35',
  },
  claw: {
    id: 'claw',
    name: 'Когти',
    kind: 'melee',
    category: 'action',
    channels: ['rightHand'],
    cooldown: 1.0,
    skill: 'unarmed',
    range: 1,
    damage: [11, 19],
    noise: 2,
    phases: [{ id: 'swing', baseDuration: 1.6, interruptible: false, failBase: 0, onCancel: 'keep' }],
    color: '#c77dff',
  },
  hex: {
    id: 'hex',
    name: 'Порча',
    kind: 'spell',
    category: 'ability',
    channels: ['rightHand', 'leftHand'],
    cooldown: 4.0,
    skill: 'fire',
    cost: { mana: 20 },
    range: 7,
    needsLos: true,
    damage: [18, 30],
    noise: 5,
    phases: [
      { id: 'gather', baseDuration: 2.0, interruptible: true, failBase: 0, onCancel: 'loseAccumulated' },
      { id: 'form', baseDuration: 2.0, interruptible: false, failBase: 0.05, onCancel: 'loseAll' },
      { id: 'release', baseDuration: 2.0, interruptible: false, failBase: 0, onCancel: 'loseAll' },
    ],
    color: '#9b5de5',
  },
};

/** Diagonal steps take longer: a real body covers more ground. */
export const DIAGONAL_STEP_FACTOR = 1.4;

/** Turning to face a target that is behind you costs this much time at the start of the action. */
export const TURN_SECONDS = 0.3;

/** Projectile travel speed in tiles per second (fireball release phase visual). */
export const PROJECTILE_TILES_PER_SEC = 6;

export const PHASE_NAMES: Record<string, string> = {
  step: 'шаг',
  swing: 'замах',
  kick: 'удар',
  bash: 'удар',
  raise: 'подъём',
  hold: 'щит',
  gather: 'накопление',
  form: 'формирование',
  release: 'запуск',
};
