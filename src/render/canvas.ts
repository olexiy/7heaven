import type { Sim } from '../core/sim/sim';
import type { Entity, ChannelId } from '../core/entity/entity';
import { CHANNELS } from '../core/entity/entity';
import type { ActionInstance } from '../core/action/action';
import type { Vec } from '../core/world/map';
import { TILE_FLOOR } from '../core/world/map';
import { TICK_MS } from '../core/time';
import { depth, ENTITY_H, TILE_H, TILE_W, toScreen, toTile, WALL_H } from './iso';

export interface Projectile {
  from: Vec;
  to: Vec;
  color: string;
  startMs: number;
  durationMs: number;
}

export interface FloatText {
  pos: Vec;
  text: string;
  color: string;
  startMs: number;
}

export interface Particle {
  x: number; // world screen coords
  y: number;
  vx: number;
  vy: number;
  life: number; // ms left
  maxLife: number;
  color: string;
  size: number;
}

export interface ViewState {
  sim: Sim;
  /** Fraction of the next tick elapsed (0..1) for interpolation. */
  alpha: number;
  hover: Vec | null;
  /** Action id selected for targeting, if any. */
  targeting: string | null;
  paused: boolean;
  nowMs: number;
}

const RING_R: Record<ChannelId, number> = { rightHand: 10, leftHand: 14.5, legs: 19 };
const RING_W = 3;

/** Canvas 2D isometric renderer with placeholder shapes. */
export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private camX = 0;
  private camY = 0;
  private camInit = false;
  private dpr = 1;
  projectiles: Projectile[] = [];
  floats: FloatText[] = [];
  particles: Particle[] = [];
  private lastMs = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = this.canvas.clientWidth || window.innerWidth;
    const ch = this.canvas.clientHeight || window.innerHeight;
    const w = Math.max(1, Math.floor(cw * this.dpr));
    const h = Math.max(1, Math.floor(ch * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** Interpolated screen position of an entity (world coords). */
  entityScreen(e: Entity, alpha: number): { sx: number; sy: number; d: number } {
    const legs = e.action('legs');
    if (legs && legs.def.kind === 'step' && legs.stepTo) {
      const t = Math.min(1, (legs.phaseTotal - legs.remaining + alpha) / legs.phaseTotal);
      const x = e.pos.x + (legs.stepTo.x - e.pos.x) * t;
      const y = e.pos.y + (legs.stepTo.y - e.pos.y) * t;
      const p = toScreen(x, y);
      return { sx: p.sx, sy: p.sy, d: depth(x, y) + 0.5 };
    }
    const p = toScreen(e.pos.x, e.pos.y);
    return { sx: p.sx, sy: p.sy, d: depth(e.pos.x, e.pos.y) + 0.5 };
  }

  /** Convert a canvas client point to a tile. */
  /** Logical viewport size (CSS pixels), valid even when the tab is hidden. */
  private viewSize(): { w: number; h: number } {
    return { w: this.canvas.width / this.dpr, h: this.canvas.height / this.dpr };
  }

  clientToTile(cx: number, cy: number): Vec {
    const { w, h } = this.viewSize();
    const sx = cx - w / 2 + this.camX;
    const sy = cy - h / 2 + this.camY;
    return toTile(sx, sy);
  }

  /** If the client point is on one of the player's rings, return that channel. */
  ringHit(cx: number, cy: number, sim: Sim, alpha: number): ChannelId | null {
    const p = sim.player;
    const es = this.entityScreen(p, alpha);
    const { w, h } = this.viewSize();
    const rx = es.sx - this.camX + w / 2;
    const ry = es.sy - ENTITY_H - 22 - this.camY + h / 2;
    const dist = Math.hypot(cx - rx, cy - ry);
    for (const c of CHANNELS) {
      if (!p.action(c)) continue;
      if (Math.abs(dist - RING_R[c]) <= RING_W / 2 + 1) return c;
    }
    return null;
  }

  addProjectile(from: Vec, to: Vec, color: string, ticks: number, nowMs: number): void {
    this.projectiles.push({ from, to, color, startMs: nowMs, durationMs: Math.max(120, ticks * TICK_MS) });
  }

  addFloat(pos: Vec, text: string, color: string, nowMs: number): void {
    this.floats.push({ pos, text, color, startMs: nowMs });
  }

  burst(pos: Vec, color: string, count: number, speed: number): void {
    const p = toScreen(pos.x, pos.y);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({
        x: p.sx,
        y: p.sy - ENTITY_H / 2,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v * 0.6 - 20,
        life: 500 + Math.random() * 400,
        maxLife: 900,
        color,
        size: 2 + Math.random() * 2,
      });
    }
  }

  render(view: ViewState): void {
    const { sim, alpha } = view;
    const ctx = this.ctx;
    this.resize(); // cheap no-op unless the layout changed (or the tab was hidden at start)
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const dtMs = this.lastMs ? Math.min(100, view.nowMs - this.lastMs) : 16;
    this.lastMs = view.nowMs;
    const timeFactor = view.paused ? 0 : 1;

    // Camera follows the player.
    const ps = this.entityScreen(sim.player, alpha);
    if (!this.camInit) {
      this.camX = ps.sx;
      this.camY = ps.sy;
      this.camInit = true;
    } else {
      this.camX += (ps.sx - this.camX) * 0.12;
      this.camY += (ps.sy - this.camY) * 0.12;
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(Math.round(w / 2 - this.camX), Math.round(h / 2 - this.camY));

    const map = sim.map;
    const player = sim.player;
    const visible = player.visible;

    // Collect drawables sorted by depth.
    type Drawable = { d: number; draw: () => void };
    const items: Drawable[] = [];

    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const i = map.idx(x, y);
        if (!sim.explored[i]) continue;
        const vis = visible.has(i);
        const tile = map.get(x, y);
        if (tile === TILE_FLOOR) {
          items.push({ d: depth(x, y) - 0.9, draw: () => this.drawFloor(x, y, vis, sim, view) });
        } else {
          items.push({ d: depth(x, y), draw: () => this.drawWall(x, y, vis) });
        }
      }
    }

    // Exit portal.
    if (sim.explored[map.idx(sim.exit.x, sim.exit.y)]) {
      items.push({ d: depth(sim.exit.x, sim.exit.y) - 0.5, draw: () => this.drawExit(sim.exit, view.nowMs) });
    }

    // Path preview.
    for (const c of player.path) {
      items.push({ d: depth(c.x, c.y) - 0.4, draw: () => this.drawPathDot(c) });
    }

    // Entities.
    for (const e of sim.alive()) {
      const isPlayer = e.id === player.id;
      if (!isPlayer && !visible.has(map.idx(e.pos.x, e.pos.y))) continue;
      const es = this.entityScreen(e, alpha);
      items.push({ d: es.d, draw: () => this.drawEntity(e, es.sx, es.sy, alpha, view) });
    }

    // Projectiles.
    for (const pr of this.projectiles) {
      const t = Math.min(1, (view.nowMs - pr.startMs) / pr.durationMs);
      const x = pr.from.x + (pr.to.x - pr.from.x) * t;
      const y = pr.from.y + (pr.to.y - pr.from.y) * t;
      const p = toScreen(x, y);
      items.push({
        d: depth(x, y) + 0.6,
        draw: () => {
          ctx.fillStyle = pr.color;
          ctx.shadowColor = pr.color;
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy - ENTITY_H / 2 - 6, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        },
      });
    }

    items.sort((a, b) => a.d - b.d);
    for (const it of items) it.draw();

    // Particles (world space, above everything).
    this.stepParticles(dtMs * timeFactor);
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // Floating texts.
    this.floats = this.floats.filter((f) => view.nowMs - f.startMs < 1100);
    for (const f of this.floats) {
      const t = (view.nowMs - f.startMs) / 1100;
      const p = toScreen(f.pos.x, f.pos.y);
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = f.color;
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, p.sx, p.sy - ENTITY_H - 30 - t * 30);
    }
    ctx.globalAlpha = 1;

    // Hover tile.
    if (view.hover && map.inBounds(view.hover.x, view.hover.y) && sim.explored[map.idx(view.hover.x, view.hover.y)]) {
      const hv = view.hover;
      const col = view.targeting ? '#ff6b35' : '#8ecae6';
      this.diamond(hv.x, hv.y, 0);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();
    this.projectiles = this.projectiles.filter((pr) => view.nowMs - pr.startMs < pr.durationMs + 60);
  }

  private stepParticles(dtMs: number): void {
    const dt = dtMs / 1000;
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 30 * dt;
      p.life -= dtMs;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
  }

  private diamond(x: number, y: number, lift: number): void {
    const ctx = this.ctx;
    const p = toScreen(x, y);
    const sy = p.sy - lift;
    ctx.beginPath();
    ctx.moveTo(p.sx, sy - TILE_H / 2);
    ctx.lineTo(p.sx + TILE_W / 2, sy);
    ctx.lineTo(p.sx, sy + TILE_H / 2);
    ctx.lineTo(p.sx - TILE_W / 2, sy);
    ctx.closePath();
  }

  private drawFloor(x: number, y: number, vis: boolean, sim: Sim, view: ViewState): void {
    const ctx = this.ctx;
    this.diamond(x, y, 0);
    const inRoom = sim.map.rooms.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    let fill = inRoom ? '#3a3f4b' : '#2f333d';
    if (!vis) fill = inRoom ? '#1c1f27' : '#181a21';
    if (view.targeting && vis) {
      const range = sim.actionDef(view.targeting).range ?? 0;
      const dx = Math.abs(x - sim.player.pos.x);
      const dy = Math.abs(y - sim.player.pos.y);
      if (Math.max(dx, dy) <= range) fill = inRoom ? '#4a3a3a' : '#403030';
    }
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = vis ? '#4a5060' : '#22252d';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawWall(x: number, y: number, vis: boolean): void {
    const ctx = this.ctx;
    const p = toScreen(x, y);
    const top = vis ? '#5c6272' : '#2a2d36';
    const left = vis ? '#40454f' : '#1e2027';
    const right = vis ? '#4c515d' : '#23262e';
    // Left face.
    ctx.beginPath();
    ctx.moveTo(p.sx - TILE_W / 2, p.sy);
    ctx.lineTo(p.sx, p.sy + TILE_H / 2);
    ctx.lineTo(p.sx, p.sy + TILE_H / 2 - WALL_H);
    ctx.lineTo(p.sx - TILE_W / 2, p.sy - WALL_H);
    ctx.closePath();
    ctx.fillStyle = left;
    ctx.fill();
    // Right face.
    ctx.beginPath();
    ctx.moveTo(p.sx + TILE_W / 2, p.sy);
    ctx.lineTo(p.sx, p.sy + TILE_H / 2);
    ctx.lineTo(p.sx, p.sy + TILE_H / 2 - WALL_H);
    ctx.lineTo(p.sx + TILE_W / 2, p.sy - WALL_H);
    ctx.closePath();
    ctx.fillStyle = right;
    ctx.fill();
    // Top.
    this.diamond(x, y, WALL_H);
    ctx.fillStyle = top;
    ctx.fill();
    ctx.strokeStyle = vis ? '#6b7183' : '#30333c';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawExit(pos: Vec, nowMs: number): void {
    const ctx = this.ctx;
    const pulse = 0.6 + 0.4 * Math.sin(nowMs / 300);
    this.diamond(pos.x, pos.y, 0);
    ctx.fillStyle = `rgba(80, 220, 120, ${0.25 + 0.25 * pulse})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(120, 255, 160, ${0.5 + 0.5 * pulse})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    const p = toScreen(pos.x, pos.y);
    ctx.fillStyle = `rgba(160, 255, 190, ${0.7 + 0.3 * pulse})`;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ВЫХОД', p.sx, p.sy - 4);
  }

  private drawPathDot(c: Vec): void {
    const ctx = this.ctx;
    const p = toScreen(c.x, c.y);
    ctx.fillStyle = 'rgba(142, 202, 230, 0.6)';
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawEntity(e: Entity, sx: number, sy: number, alpha: number, view: ViewState): void {
    const ctx = this.ctx;
    const isPlayer = e.faction === 'player';
    const color = isPlayer ? '#4d8bff' : e.awareness === 'combat' ? '#ff4d4d' : e.awareness === 'alert' ? '#ff9f4d' : '#b34d4d';
    const hitFlash = e.lastHitTick >= 0 && view.sim.tick - e.lastHitTick < 4;

    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 2, 14, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body: rounded block.
    const bw = 20;
    ctx.fillStyle = hitFlash ? '#ffffff' : color;
    ctx.beginPath();
    ctx.roundRect(sx - bw / 2, sy - ENTITY_H, bw, ENTITY_H, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Facing: a small wedge on the ground in front of the feet.
    const f = e.facing;
    const fx = ((f.dx - f.dy) * TILE_W) / 2;
    const fy = ((f.dx + f.dy) * TILE_H) / 2;
    const len = Math.hypot(fx, fy) || 1;
    const nx = (fx / len) * 16;
    const ny = (fy / len) * 16;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(sx + nx, sy + ny);
    ctx.lineTo(sx + nx * 0.55 - ny * 0.3, sy + ny * 0.55 + nx * 0.3);
    ctx.lineTo(sx + nx * 0.55 + ny * 0.3, sy + ny * 0.55 - nx * 0.3);
    ctx.closePath();
    ctx.fill();

    // Shield glow.
    if (e.statuses.has('shielded')) {
      ctx.strokeStyle = 'rgba(76, 201, 240, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sx, sy - ENTITY_H / 2, 18, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Spell visuals.
    const hands = e.action('rightHand');
    if (hands && hands.def.kind === 'spell') this.drawSpell(e, hands, sx, sy, alpha, view);

    // HP bar.
    const hpW = 26;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(sx - hpW / 2, sy - ENTITY_H - 8, hpW, 4);
    ctx.fillStyle = isPlayer ? '#5ee07a' : '#ff6b6b';
    ctx.fillRect(sx - hpW / 2, sy - ENTITY_H - 8, hpW * Math.max(0, e.hp / e.maxHp), 4);

    // Rings.
    const cy = sy - ENTITY_H - 24;
    const drawn = new Set<ActionInstance>();
    for (const c of CHANNELS) {
      const a = e.action(c);
      if (!a || drawn.has(a)) continue;
      drawn.add(a);
      this.drawRing(a, sx, cy, RING_R[c], alpha);
    }
    // Name for enemies.
    if (!isPlayer) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(e.name, sx, sy + 14);
    }
  }

  private drawRing(a: ActionInstance, cx: number, cy: number, r: number, alpha: number): void {
    const ctx = this.ctx;
    const total = a.def.phases.reduce((s, p) => s + p.baseDuration, 0);
    let done = 0;
    for (let i = 0; i < a.phaseIndex; i++) done += a.def.phases[i]!.baseDuration;
    const cur = a.def.phases[a.phaseIndex]!;
    const frac = Math.min(1, (a.phaseTotal - a.remaining + alpha) / a.phaseTotal);
    const progress = (done + cur.baseDuration * frac) / total;
    const start = -Math.PI / 2;

    ctx.lineWidth = RING_W;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = a.def.color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + progress * Math.PI * 2);
    ctx.stroke();

    // Phase separators.
    if (a.def.phases.length > 1) {
      let acc = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < a.def.phases.length - 1; i++) {
        acc += a.def.phases[i]!.baseDuration / total;
        const ang = start + acc * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * (r - RING_W), cy + Math.sin(ang) * (r - RING_W));
        ctx.lineTo(cx + Math.cos(ang) * (r + RING_W), cy + Math.sin(ang) * (r + RING_W));
        ctx.stroke();
      }
    }
  }

  private drawSpell(e: Entity, a: ActionInstance, sx: number, sy: number, alpha: number, view: ViewState): void {
    const ctx = this.ctx;
    const phase = a.def.phases[a.phaseIndex]!;
    const frac = Math.min(1, (a.phaseTotal - a.remaining + alpha) / a.phaseTotal);
    const hx = sx;
    const hy = sy - ENTITY_H / 2 - 4;
    if (phase.id === 'gather') {
      // Particles converge on the hands.
      if (!view.paused && Math.random() < 0.6) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 30 + Math.random() * 20;
        this.particles.push({
          x: hx + Math.cos(ang) * dist,
          y: hy + Math.sin(ang) * dist * 0.6,
          vx: -Math.cos(ang) * dist * 1.8,
          vy: -Math.sin(ang) * dist * 0.6 * 1.8,
          life: 550,
          maxLife: 550,
          color: a.def.color,
          size: 2,
        });
      }
      ctx.fillStyle = 'rgba(255, 107, 53, 0.35)';
      ctx.beginPath();
      ctx.arc(hx, hy, 4 + frac * 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (phase.id === 'form') {
      const r = 4 + frac * 8;
      ctx.fillStyle = a.def.color;
      ctx.shadowColor = a.def.color;
      ctx.shadowBlur = 10 + frac * 10;
      ctx.beginPath();
      ctx.arc(hx, hy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      // Release: sphere held ready, pulsing.
      const r = 12 + Math.sin(view.nowMs / 80) * 1.5;
      ctx.fillStyle = a.def.color;
      ctx.shadowColor = a.def.color;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(hx, hy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    void e;
  }
}
