import type { Sim } from '../core/sim/sim';
import { CHANNELS, SKILLS, type ChannelId, type SkillId } from '../core/entity/entity';
import { ticksToSec } from '../core/time';
import { PHASE_NAMES } from '../data/actions';
import { xpToNext } from '../data/rules';
import type { Speed } from '../app/loop';

export interface HudCallbacks {
  onSpeed: (s: Speed) => void;
  onAction: (id: string) => void;
  onCancel: (c: ChannelId) => void;
  onAutopilot: () => void;
  onLeave: () => void;
  onStay: () => void;
  onRestart: () => void;
}

const SKILL_NAMES: Record<SkillId, string> = { sword: 'Меч', unarmed: 'Ближний бой', shield: 'Щит', fire: 'Огонь' };
const CHANNEL_NAMES: Record<ChannelId, string> = { legs: 'Ноги', hands: 'Руки' };
const KEYS: Record<string, string> = { sword: 'Q', kick: 'W', shield: 'E', fireball: 'R' };

export class Hud {
  private root: HTMLElement;
  private timeEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private speedBtns = new Map<Speed, HTMLButtonElement>();
  private actionBtns = new Map<string, HTMLButtonElement>();
  private autoBtn!: HTMLButtonElement;
  private hpBar!: HTMLElement;
  private manaBar!: HTMLElement;
  private hpText!: HTMLElement;
  private manaText!: HTMLElement;
  private skillsEl!: HTMLElement;
  private logEl!: HTMLElement;
  private channelsEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private overlay!: HTMLElement;
  private overlayTitle!: HTMLElement;
  private overlayText!: HTMLElement;
  private overlayButtons!: HTMLElement;
  private logLines = 0;

  constructor(root: HTMLElement, private cb: HudCallbacks) {
    this.root = root;
    this.build();
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  private build(): void {
    // Top: time + speeds.
    const top = this.el('div', 'panel');
    top.id = 'top';
    this.timeEl = this.el('span', 'time', '0.0 с');
    top.append(this.timeEl);
    const speeds: [Speed, string][] = [
      [0, '⏸'],
      [1, '×1'],
      [2, '×2'],
      [5, '×5'],
    ];
    for (const [s, label] of speeds) {
      const b = this.el('button', '', label);
      b.title = s === 0 ? 'Пауза (Пробел)' : `Скорость ${label} (${s === 1 ? '1' : s === 2 ? '2' : '3'})`;
      b.onclick = () => this.cb.onSpeed(s);
      this.speedBtns.set(s, b);
      top.append(b);
    }
    this.autoBtn = this.el('button', 'danger', 'Автопилот');
    this.autoBtn.title = 'Персонаж действует сам (A)';
    this.autoBtn.onclick = () => this.cb.onAutopilot();
    top.append(this.autoBtn);
    this.root.append(top);

    this.statusEl = this.el('div', 'panel');
    this.statusEl.id = 'status';
    this.root.append(this.statusEl);

    // Hint.
    this.hintEl = this.el('div', 'panel');
    this.hintEl.id = 'hint';
    this.hintEl.innerHTML =
      '<b>Пробел</b> — пауза · <b>1/2/3</b> — скорость · <b>клик</b> — идти · <b>Q W E R</b> — действия · клик по кольцу — отмена · <b>Esc</b> — снять выбор';
    this.root.append(this.hintEl);

    // Left: bars + skills.
    const left = this.el('div', 'panel');
    left.id = 'left';
    const hpRow = this.el('div', 'row');
    hpRow.append(this.el('span', '', 'Здоровье'), (this.hpText = this.el('span')));
    const hpBar = this.el('div', 'bar hp');
    this.hpBar = this.el('div');
    hpBar.append(this.hpBar);
    const manaRow = this.el('div', 'row');
    manaRow.append(this.el('span', '', 'Мана'), (this.manaText = this.el('span')));
    const manaBar = this.el('div', 'bar mana');
    this.manaBar = this.el('div');
    manaBar.append(this.manaBar);
    this.skillsEl = this.el('div', 'skills');
    left.append(hpRow, hpBar, manaRow, manaBar, this.skillsEl);
    this.root.append(left);

    // Actions.
    const actions = this.el('div', 'panel');
    actions.id = 'actions';
    this.root.append(actions);
    this.actionsRoot = actions;

    // Right: log.
    const right = this.el('div', 'panel');
    right.id = 'right';
    right.append(this.el('div', 'row', 'Журнал'));
    this.logEl = this.el('div');
    this.logEl.id = 'log';
    right.append(this.logEl);
    this.root.append(right);

    // Channels.
    const ch = this.el('div', 'panel');
    ch.id = 'channels';
    this.channelsEl = ch;
    this.root.append(ch);

    // Overlay.
    this.overlay = this.el('div');
    this.overlay.id = 'overlay';
    const box = this.el('div', 'box');
    this.overlayTitle = this.el('h2');
    this.overlayText = this.el('p');
    this.overlayButtons = this.el('div', 'buttons');
    box.append(this.overlayTitle, this.overlayText, this.overlayButtons);
    this.overlay.append(box);
    this.root.append(this.overlay);
  }

  private actionsRoot!: HTMLElement;

  /** Build action buttons for the player's action list. */
  setActions(sim: Sim): void {
    this.actionsRoot.innerHTML = '';
    this.actionBtns.clear();
    for (const id of sim.player.spec.actions) {
      const def = sim.actionDef(id);
      const b = this.el('button');
      const dur = def.phases.reduce((s, p) => s + p.baseDuration, 0);
      b.innerHTML = `${def.name}<kbd>${KEYS[id] ?? ''}</kbd><small>${dur.toFixed(1)} с${def.cost?.mana ? ` · ${def.cost.mana} маны` : ''}</small>`;
      b.style.borderLeft = `3px solid ${def.color}`;
      b.onclick = () => this.cb.onAction(id);
      this.actionBtns.set(id, b);
      this.actionsRoot.append(b);
    }
  }

  update(sim: Sim, paused: boolean, speed: Speed, targeting: string | null): void {
    const p = sim.player;
    this.timeEl.textContent = `${ticksToSec(sim.tick).toFixed(1)} с`;
    for (const [s, b] of this.speedBtns) b.classList.toggle('active', s === 0 ? paused : !paused && speed === s);
    this.autoBtn.classList.toggle('active', sim.autopilot);
    this.statusEl.textContent = paused ? 'ПАУЗА' : sim.autopilot ? 'АВТОПИЛОТ' : '';

    this.hpBar.style.width = `${(100 * p.hp) / p.maxHp}%`;
    this.hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    this.manaBar.style.width = `${(100 * p.mana) / p.maxMana}%`;
    this.manaText.textContent = `${Math.floor(p.mana)} / ${p.maxMana}`;

    this.skillsEl.innerHTML = '';
    for (const s of SKILLS) {
      const st = p.skills.get(s)!;
      this.skillsEl.append(this.el('span', '', SKILL_NAMES[s]));
      const v = this.el('span');
      v.innerHTML = `<span class="lvl">${st.level}</span> <span class="xp">${st.xp}/${xpToNext(st.level)}</span>`;
      this.skillsEl.append(v);
    }

    for (const [id, b] of this.actionBtns) {
      const def = sim.actionDef(id);
      b.classList.toggle('active', targeting === id);
      b.disabled = !p.channelsFree(def.channels) || (def.cost?.mana !== undefined && p.mana < def.cost.mana);
    }

    this.channelsEl.innerHTML = '';
    for (const c of CHANNELS) {
      const row = this.el('div', 'ch');
      row.append(this.el('span', 'name', CHANNEL_NAMES[c]));
      const a = p.action(c);
      let what = 'свободны';
      if (a) {
        const phase = a.def.phases[a.phaseIndex]!;
        const left = ticksToSec(a.remaining).toFixed(1);
        what = `${a.def.name} · ${PHASE_NAMES[phase.id] ?? phase.id} · ${left} с`;
      } else if (c === 'legs' && p.path.length > 0) {
        what = `путь: ${p.path.length} кл.`;
      }
      row.append(this.el('span', 'what', what));
      if (a || (c === 'legs' && p.path.length > 0)) {
        const b = this.el('button', '', 'Отменить');
        b.onclick = () => this.cb.onCancel(c);
        row.append(b);
      }
      this.channelsEl.append(row);
    }
  }

  log(text: string, cls = ''): void {
    const d = this.el('div', cls, text);
    this.logEl.append(d);
    this.logLines++;
    if (this.logLines > 60) {
      this.logEl.firstElementChild?.remove();
      this.logLines--;
    }
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  showExitDialog(): void {
    this.showOverlay('Выход из рифта', 'Вы у портала. Уйти сейчас? Вернуться в этот рифт будет нельзя.', [
      ['Уйти', () => this.cb.onLeave()],
      ['Остаться', () => this.cb.onStay()],
    ]);
  }

  showEnd(won: boolean, sim: Sim): void {
    const p = sim.player;
    const skills = SKILLS.map((s) => `${SKILL_NAMES[s]} ${p.skills.get(s)!.level}`).join(' · ');
    const killed = [...sim.entities.values()].filter((e) => e.faction === 'enemy' && !e.alive).length;
    this.showOverlay(
      won ? 'Рифт пройден' : 'Рифт провален',
      `Время: ${ticksToSec(sim.tick).toFixed(1)} с · Убито: ${killed} · Семя: ${sim.seed}\n${skills}`,
      [['Новый рифт', () => this.cb.onRestart()]],
    );
  }

  hideOverlay(): void {
    this.overlay.classList.remove('show');
  }

  private showOverlay(title: string, text: string, buttons: [string, () => void][]): void {
    this.overlayTitle.textContent = title;
    this.overlayText.textContent = text;
    this.overlayText.style.whiteSpace = 'pre-line';
    this.overlayButtons.innerHTML = '';
    for (const [label, fn] of buttons) {
      const b = this.el('button', '', label);
      b.onclick = fn;
      this.overlayButtons.append(b);
    }
    this.overlay.classList.add('show');
  }
}
