import type { Sim } from '../core/sim/sim';
import { CHANNELS, SKILLS, type ChannelId, type SkillId } from '../core/entity/entity';
import { ticksToSec } from '../core/time';
import { PHASE_NAMES } from '../data/actions';
import { xpToNext } from '../data/rules';
import type { Speed } from '../app/loop';
import { assessAction, assessRunning, CAUSE_TEXT, RISK_TEXT, type Risk } from '../core/rules/risk';
import type { Vec } from '../core/world/map';
import { chebyshev } from '../core/world/map';

export interface HudCallbacks {
  onSpeed: (s: Speed) => void;
  onAction: (id: string) => void;
  onCancel: (c: ChannelId) => void;
  onAutopilot: () => void;
  onAutoFast: () => void;
  onAutoAttack: () => void;
  onPauseOnAbility: () => void;
  onLeave: () => void;
  onStay: () => void;
  onRestart: () => void;
}

const SKILL_NAMES: Record<SkillId, string> = { sword: 'Меч', unarmed: 'Ближний бой', shield: 'Щит', fire: 'Огонь' };
const CHANNEL_NAMES: Record<ChannelId, string> = { legs: 'Ноги', rightHand: 'Правая', leftHand: 'Левая' };
const KEYS: Record<string, string> = { sword: 'Q', kick: 'W', shield: 'E', shieldBash: 'F', fireball: 'R' };

export class Hud {
  private root: HTMLElement;
  private timeEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private speedBtns = new Map<Speed, HTMLButtonElement>();
  private actionBtns = new Map<string, HTMLButtonElement>();
  private autoBtn!: HTMLButtonElement;
  private fastBtn!: HTMLButtonElement;
  private attackBtn!: HTMLButtonElement;
  private pauseAbilityBtn!: HTMLButtonElement;
  private riskEl!: HTMLElement;
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
    this.fastBtn = this.el('button', '', 'Перемотка');
    this.fastBtn.title = 'Ускорять время, пока врагов не видно';
    this.fastBtn.onclick = () => this.cb.onAutoFast();
    top.append(this.fastBtn);
    this.attackBtn = this.el('button', '', 'Автоатака');
    this.attackBtn.title = 'Свободные руки и ноги сами бьют врага рядом базовыми действиями (T)';
    this.attackBtn.onclick = () => this.cb.onAutoAttack();
    top.append(this.attackBtn);
    this.pauseAbilityBtn = this.el('button', '', 'Пауза: приём');
    this.pauseAbilityBtn.title = 'Ставить паузу, когда враг в поле зрения начинает приём';
    this.pauseAbilityBtn.onclick = () => this.cb.onPauseOnAbility();
    top.append(this.pauseAbilityBtn);
    this.root.append(top);

    this.statusEl = this.el('div', 'panel');
    this.statusEl.id = 'status';
    this.root.append(this.statusEl);

    // Hint.
    this.hintEl = this.el('div', 'panel');
    this.hintEl.id = 'hint';
    this.hintEl.innerHTML =
      '<b>Пробел</b> — пауза · <b>1/2/3</b> — скорость · <b>клик</b> — идти · <b>Q W</b> — действия · <b>E F R</b> — приёмы · клик по кольцу — отмена · <b>Esc</b> — снять выбор';
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

    // Risk line above the actions.
    this.riskEl = this.el('div', 'panel');
    this.riskEl.id = 'risk';
    this.root.append(this.riskEl);

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
    const groups: [string, string][] = [
      ['action', 'Действия'],
      ['ability', 'Приёмы'],
    ];
    for (const [cat, label] of groups) {
      const wrap = this.el('div', 'group');
      wrap.append(this.el('div', 'group-label', label));
      for (const id of sim.player.spec.actions) {
        const def = sim.actionDef(id);
        if (def.category !== cat) continue;
        const b = this.el('button');
        const dur = def.phases.reduce((s, p) => s + p.baseDuration, 0);
        const cd = def.cooldown ? ` · откат ${def.cooldown.toFixed(0)} с` : '';
        b.innerHTML = `<span class="label">${def.name}</span><kbd>${KEYS[id] ?? ''}</kbd><small>${dur.toFixed(1)} с${cd}${def.cost?.mana ? ` · ${def.cost.mana} маны` : ''}</small><span class="cd"></span>`;
        b.style.borderLeft = `3px solid ${def.color}`;
        b.onclick = () => this.cb.onAction(id);
        this.actionBtns.set(id, b);
        wrap.append(b);
      }
      this.actionsRoot.append(wrap);
    }
  }

  private riskText(r: Risk): string {
    const causes = r.causes.map((c) => CAUSE_TEXT[c] ?? c).filter(Boolean);
    return RISK_TEXT[r.level] + (causes.length ? ` — ${causes.join(', ')}` : '');
  }

  update(sim: Sim, paused: boolean, speed: Speed, targeting: string | null, hover: Vec | null, autoFast: boolean, fastNow: boolean, pauseOnAbility: boolean): void {
    const p = sim.player;
    this.timeEl.textContent = `${ticksToSec(sim.tick).toFixed(1)} с`;
    for (const [s, b] of this.speedBtns) b.classList.toggle('active', s === 0 ? paused : !paused && speed === s);
    this.autoBtn.classList.toggle('active', sim.autopilot);
    this.fastBtn.classList.toggle('active', autoFast);
    this.attackBtn.classList.toggle('active', sim.autoAttack);
    this.pauseAbilityBtn.classList.toggle('active', pauseOnAbility);
    this.statusEl.textContent = paused ? 'ПАУЗА' : fastNow ? 'ПЕРЕМОТКА ×5' : sim.autopilot ? 'АВТОПИЛОТ' : '';

    // Verbal risk for the action being aimed.
    let risk = '';
    if (targeting) {
      const def = sim.actionDef(targeting);
      if (hover && sim.map.inBounds(hover.x, hover.y)) {
        const ent = sim.entityAt(hover);
        const tgt = ent && ent.id !== p.id ? ent : undefined;
        const dist = chebyshev(p.pos, hover);
        const inRange = def.range === undefined || dist <= def.range;
        const seen = p.visible.has(sim.map.idx(hover.x, hover.y));
        if (!inRange) risk = `${def.name}: слишком далеко`;
        else if (def.needsLos && !seen) risk = `${def.name}: цель не видна`;
        else if (def.kind === 'melee' && !tgt) risk = `${def.name}: выберите врага рядом`;
        else risk = `${def.name}: ${this.riskText(assessAction(sim, p, def, tgt, dist))}`;
      } else {
        risk = `${def.name}: выберите цель`;
      }
    }
    this.riskEl.textContent = risk;
    this.riskEl.style.display = risk ? '' : 'none';

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
      const cdLeft = p.cooldownLeft(id, sim.tick);
      b.classList.toggle('active', targeting === id);
      b.disabled = cdLeft > 0 || !p.channelsFree(def.channels) || (def.cost?.mana !== undefined && p.mana < def.cost.mana);
      const cdEl = b.querySelector('.cd') as HTMLElement;
      cdEl.textContent = cdLeft > 0 ? `${ticksToSec(cdLeft).toFixed(1)}` : '';
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
        const r = assessRunning(sim, p, a);
        if (r && r.level !== 'sure') what += ` · ${this.riskText(r)}`;
        const cdIds = p.spec.actions.filter((id) => sim.actionDef(id).channels.includes(c) && p.cooldownLeft(id, sim.tick) > 0);
        void cdIds;
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
