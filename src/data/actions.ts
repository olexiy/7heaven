import type { ActionDef } from '../core/action/action';

/** Rule numbers live here, not in core. Durations in seconds (level 0). */
export const ACTIONS: Record<string, ActionDef> = {
  step: {
    id: 'step',
    name: 'Шаг',
    kind: 'step',
    channels: ['legs'],
    phases: [{ id: 'step', baseDuration: 1.0, interruptible: false, failBase: 0, onCancel: 'keep' }],
    color: '#8ecae6',
  },
  sword: {
    id: 'sword',
    name: 'Удар мечом',
    kind: 'melee',
    channels: ['hands'],
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
    channels: ['legs'],
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
    channels: ['hands'],
    skill: 'shield',
    damageReduction: 0.7,
    phases: [
      { id: 'raise', baseDuration: 0.5, interruptible: false, failBase: 0, onCancel: 'keep' },
      { id: 'hold', baseDuration: 5.0, interruptible: false, failBase: 0, onCancel: 'keep' },
    ],
    color: '#4cc9f0',
  },
  fireball: {
    id: 'fireball',
    name: 'Огненный шар',
    kind: 'spell',
    channels: ['hands'],
    skill: 'fire',
    cost: { mana: 30 },
    range: 12,
    needsLos: true,
    damage: [30, 50],
    noise: 8,
    phases: [
      { id: 'gather', baseDuration: 5.0, interruptible: true, failBase: 0, onCancel: 'loseAccumulated' },
      { id: 'form', baseDuration: 5.0, interruptible: false, failBase: 0.05, onCancel: 'loseAll' },
      { id: 'release', baseDuration: 5.0, interruptible: false, failBase: 0, onCancel: 'loseAll' },
    ],
    color: '#ff6b35',
  },
  claw: {
    id: 'claw',
    name: 'Когти',
    kind: 'melee',
    channels: ['hands'],
    skill: 'unarmed',
    range: 1,
    damage: [11, 19],
    noise: 2,
    phases: [{ id: 'swing', baseDuration: 1.6, interruptible: false, failBase: 0, onCancel: 'keep' }],
    color: '#c77dff',
  },
};

/** Diagonal steps take longer: a real body covers more ground. */
export const DIAGONAL_STEP_FACTOR = 1.4;

/** Projectile travel speed in tiles per second (fireball release phase visual). */
export const PROJECTILE_TILES_PER_SEC = 6;

export const PHASE_NAMES: Record<string, string> = {
  step: 'шаг',
  swing: 'замах',
  kick: 'удар',
  raise: 'подъём',
  hold: 'щит',
  gather: 'накопление',
  form: 'формирование',
  release: 'запуск',
};
