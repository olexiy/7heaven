import { Sim } from '../core/sim/sim';
import type { GameEvent } from '../core/events';
import type { Vec } from '../core/world/map';
import type { ChannelId } from '../core/entity/entity';
import { CanvasRenderer } from '../render/canvas';
import { Hud } from '../ui/hud';
import { TimeController, type Speed } from './loop';
import { PHASE_NAMES } from '../data/actions';
import { TICKS_PER_SEC } from '../core/time';

const ENEMIES = ['ghoul', 'ghoulKeen', 'ghoul'];

function seedFromUrl(): number {
  const s = new URLSearchParams(location.search).get('seed');
  if (s && /^\d+$/.test(s)) return Number(s) >>> 0;
  return (Date.now() % 1_000_000_007) >>> 0;
}

class Game {
  sim: Sim;
  readonly renderer: CanvasRenderer;
  readonly hud: Hud;
  readonly time = new TimeController();
  hover: Vec | null = null;
  targeting: string | null = null;
  private lastFrame = 0;
  private ended = false;
  private nowMs = 0;

  constructor(private canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    this.renderer = new CanvasRenderer(canvas);
    this.hud = new Hud(hudRoot, {
      onSpeed: (s) => this.setSpeed(s),
      onAction: (id) => this.selectAction(id),
      onCancel: (c) => this.cancel(c),
      onAutopilot: () => this.sim.command({ type: 'autopilot', on: !this.sim.autopilot }),
      onLeave: () => {
        this.sim.leave();
        this.hud.hideOverlay();
      },
      onStay: () => {
        this.hud.hideOverlay();
      },
      onRestart: () => this.restart(),
    });
    this.sim = this.newSim(seedFromUrl());
    this.bindInput();
    // Debug hook: lets tests and the console drive the game (window.game.advance(5)).
    (window as unknown as { game: Game }).game = this;
    window.addEventListener('resize', () => this.renderer.resize());
    requestAnimationFrame((t) => this.rafFrame(t));
    // Fallback: hidden or throttled tabs stop requestAnimationFrame; keep the world alive on a timer.
    setInterval(() => {
      const now = performance.now();
      if (now - this.lastRaf > 100) this.frame(now);
    }, 50);
  }

  private lastRaf = 0;

  private rafFrame(t: number): void {
    this.lastRaf = t;
    this.frame(t);
    requestAnimationFrame((tt) => this.rafFrame(tt));
  }

  private newSim(seed: number): Sim {
    const sim = new Sim({ seed, enemies: ENEMIES });
    history.replaceState(null, '', `?seed=${seed}`);
    this.hud.setActions(sim);
    this.hud.log(`Рифт открыт. Семя ${seed}. Найдите выход.`, 'good');
    this.time.paused = true;
    this.ended = false;
    this.targeting = null;
    return sim;
  }

  restart(): void {
    this.hud.hideOverlay();
    this.sim = this.newSim((Date.now() % 1_000_000_007) >>> 0);
  }

  setSpeed(s: Speed): void {
    this.time.setSpeed(s);
  }

  selectAction(id: string): void {
    const def = this.sim.actionDef(id);
    const p = this.sim.player;
    if (!p.channelsFree(def.channels)) {
      this.hud.log(`${def.name}: канал занят`, 'warn');
      return;
    }
    if (def.range === undefined) {
      this.sim.command({ type: 'act', entity: p.id, action: id });
      this.targeting = null;
      return;
    }
    this.targeting = this.targeting === id ? null : id;
  }

  cancel(c: ChannelId): void {
    this.sim.command({ type: 'cancel', entity: this.sim.playerId, channel: c });
  }

  private bindInput(): void {
    window.addEventListener('keydown', (ev) => {
      if (ev.repeat) return;
      switch (ev.code) {
        case 'Space':
          ev.preventDefault();
          this.time.togglePause();
          break;
        case 'Digit1':
          this.setSpeed(1);
          break;
        case 'Digit2':
          this.setSpeed(2);
          break;
        case 'Digit3':
          this.setSpeed(5);
          break;
        case 'KeyQ':
          this.selectAction('sword');
          break;
        case 'KeyW':
          this.selectAction('kick');
          break;
        case 'KeyE':
          this.selectAction('shield');
          break;
        case 'KeyR':
          this.selectAction('fireball');
          break;
        case 'KeyA':
          this.sim.command({ type: 'autopilot', on: !this.sim.autopilot });
          break;
        case 'Escape':
          this.targeting = null;
          break;
      }
    });
    this.canvas.addEventListener('mousemove', (ev) => {
      this.hover = this.renderer.clientToTile(ev.offsetX, ev.offsetY);
    });
    this.canvas.addEventListener('mouseleave', () => (this.hover = null));
    this.canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
    this.canvas.addEventListener('mousedown', (ev) => {
      if (this.ended) return;
      if (ev.button === 2) {
        this.targeting = null;
        return;
      }
      const ring = this.renderer.ringHit(ev.offsetX, ev.offsetY, this.sim, this.time.alpha);
      if (ring) {
        this.cancel(ring);
        return;
      }
      const tile = this.renderer.clientToTile(ev.offsetX, ev.offsetY);
      const sim = this.sim;
      if (!sim.map.inBounds(tile.x, tile.y) || !sim.explored[sim.map.idx(tile.x, tile.y)]) return;
      const p = sim.player;
      if (this.targeting) {
        const ent = sim.entityAt(tile);
        const target = ent && ent.id !== p.id ? ({ kind: 'entity', id: ent.id } as const) : ({ kind: 'tile', pos: tile } as const);
        sim.command({ type: 'act', entity: p.id, action: this.targeting, target });
        this.targeting = null;
        return;
      }
      sim.command({ type: 'move', entity: p.id, to: tile });
      if (p.path.length === 0) this.hud.log('Туда не пройти', 'warn');
    });
  }

  /**
   * Debug: save a screenshot to docs/screenshots/<name>.png through the dev server.
   * Tries html2canvas (full page incl. HUD) and falls back to the bare canvas.
   */
  async shot(name: string): Promise<string> {
    this.frame(performance.now());
    // Compose: game canvas first, HUD (DOM) rendered on top via html2canvas.
    const out = document.createElement('canvas');
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(this.canvas, 0, 0);
    try {
      const h2c = await loadHtml2Canvas();
      const hud = document.getElementById('hud')!;
      const layer = await h2c(hud, {
        backgroundColor: null,
        scale: out.width / hud.clientWidth,
        width: hud.clientWidth,
        height: hud.clientHeight,
        logging: false,
      });
      ctx.drawImage(layer, 0, 0, out.width, out.height);
    } catch (err) {
      console.warn('HUD capture failed, canvas only', err);
    }
    const dataUrl = out.toDataURL('image/png');
    const res = await fetch(`/__screenshot?name=${encodeURIComponent(name)}`, { method: 'POST', body: dataUrl });
    return res.text();
  }

  /** Debug: run the simulation forward by N seconds synchronously and render. */
  advance(seconds: number): void {
    const ticks = Math.round(seconds * TICKS_PER_SEC);
    for (let i = 0; i < ticks; i++) {
      for (const e of this.sim.step()) this.onEvent(e);
      if (this.sim.status !== 'running') break;
    }
    this.frame(performance.now());
  }

  private frame(t: number): void {
    const dt = this.lastFrame ? t - this.lastFrame : 16;
    this.lastFrame = t;
    this.nowMs = t;
    const sim = this.sim;
    const ticks = this.time.update(dt);
    for (let i = 0; i < ticks; i++) {
      const events = sim.step();
      for (const e of events) this.onEvent(e);
      if (sim.status !== 'running') break;
    }
    if (!this.ended && sim.status !== 'running') {
      this.ended = true;
      this.time.paused = true;
      this.hud.showEnd(sim.status === 'won', sim);
    }
    this.renderer.render({
      sim,
      alpha: this.time.paused ? 0 : this.time.alpha,
      hover: this.hover,
      targeting: this.targeting,
      paused: this.time.paused,
      nowMs: t,
    });
    this.hud.update(sim, this.time.paused, this.time.speed, this.targeting);
  }

  private name(id: number): string {
    return this.sim.entities.get(id)?.name ?? '?';
  }

  private onEvent(e: GameEvent): void {
    const sim = this.sim;
    const isPlayer = (id: number): boolean => id === sim.playerId;
    switch (e.type) {
      case 'log':
        this.hud.log(e.text, 'warn');
        break;
      case 'spotted': {
        this.hud.log(`${this.name(e.id)} заметил вас!`, 'bad');
        // Enemy spotted: drop to ×1 and pause so the player can react.
        this.time.speed = 1;
        this.time.paused = true;
        break;
      }
      case 'hit': {
        const ent = sim.entities.get(e.target);
        if (ent) {
          this.renderer.addFloat(ent.pos, `-${e.damage}${e.crit ? '!' : ''}`, isPlayer(e.target) ? '#ff6b6b' : '#ffd166', this.nowMs);
          this.renderer.burst(ent.pos, isPlayer(e.target) ? '#ff6b6b' : '#ffd166', e.crit ? 18 : 8, 60);
        }
        this.hud.log(`${this.name(e.attacker)} → ${this.name(e.target)}: ${e.damage}${e.crit ? ' крит' : ''}`, 'hit');
        break;
      }
      case 'missed': {
        const ent = sim.entities.get(e.target);
        if (ent) this.renderer.addFloat(ent.pos, e.reason === 'dodge' ? 'уклонился' : 'мимо', '#9aa3b8', this.nowMs);
        break;
      }
      case 'blocked':
        this.hud.log(`Щит поглотил ${e.absorbed}`, 'good');
        break;
      case 'interrupted':
        this.hud.log(`${this.name(e.attacker)} сбил ${sim.actionDef(e.action).name.toLowerCase()} у ${this.name(e.target)}`, 'warn');
        break;
      case 'actionFailed': {
        const ent = sim.entities.get(e.id);
        if (ent) {
          this.renderer.burst(ent.pos, sim.actionDef(e.action).color, 30, 140);
          this.renderer.addFloat(ent.pos, 'срыв!', '#ff6b35', this.nowMs);
        }
        this.hud.log(`${this.name(e.id)}: ${sim.actionDef(e.action).name} сорвался (${PHASE_NAMES[e.phase] ?? e.phase}; ${e.reason})`, 'bad');
        break;
      }
      case 'actionCancelled':
        if (isPlayer(e.id)) this.hud.log(`Отменено: ${sim.actionDef(e.action).name} (${PHASE_NAMES[e.phase] ?? e.phase})`);
        break;
      case 'phaseChanged':
        if (isPlayer(e.id)) this.hud.log(`${sim.actionDef(e.action).name}: ${PHASE_NAMES[e.phase] ?? e.phase}`);
        break;
      case 'projectile':
        this.renderer.addProjectile(e.from, e.to, sim.actionDef(e.action).color, e.ticks, this.nowMs);
        break;
      case 'died':
        this.hud.log(`${this.name(e.id)} погиб`, isPlayer(e.id) ? 'bad' : 'good');
        {
          const ent = sim.entities.get(e.id);
          if (ent) this.renderer.burst(ent.pos, '#ffffff', 24, 90);
        }
        break;
      case 'xp':
        if (isPlayer(e.id) && e.levelUp) this.hud.log(`Навык вырос: ${e.skill}`, 'good');
        break;
      case 'reachedExit':
        this.time.paused = true;
        this.hud.showExitDialog();
        break;
      case 'lostSight':
        this.hud.log(`${this.name(e.id)} потерял вас из виду`);
        break;
      default:
        break;
    }
  }
}

type Html2Canvas = (el: HTMLElement, opts: Record<string, unknown>) => Promise<HTMLCanvasElement>;

function loadHtml2Canvas(): Promise<Html2Canvas> {
  const w = window as unknown as { html2canvas?: Html2Canvas };
  if (w.html2canvas) return Promise.resolve(w.html2canvas);
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    sc.onload = () => (w.html2canvas ? resolve(w.html2canvas) : reject(new Error('no html2canvas')));
    sc.onerror = () => reject(new Error('html2canvas load failed'));
    document.head.append(sc);
  });
}

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
new Game(canvas, hudRoot);
