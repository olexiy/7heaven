/**
 * Headless balance harness: runs N rifts with the player on autopilot and reports outcomes.
 *   npm run sim -- [runs=300] [enemies=ghoul,ghoulKeen,ghoul,shaman] [maxSeconds=300]
 */
import { Sim } from '../src/core/sim/sim';
import { TICKS_PER_SEC, ticksToSec } from '../src/core/time';
import type { GameEvent } from '../src/core/events';

const args = process.argv.slice(2);
const runs = Number(args[0] ?? 300);
const enemies = (args[1] ?? 'ghoul,ghoulKeen,ghoul,shaman').split(',').filter(Boolean);
const maxTicks = Number(args[2] ?? 300) * TICKS_PER_SEC;

interface RunStats {
  seed: number;
  status: string;
  ticks: number;
  kills: number;
  hpLeft: number;
  hitsDealt: number;
  hitsTaken: number;
  misses: number;
  dodges: number;
  spellFails: number;
  spellsCast: number;
  interrupts: number;
  xp: Record<string, number>;
}

function runOne(seed: number): RunStats {
  const sim = new Sim({ seed, enemies });
  sim.command({ type: 'autopilot', on: true });
  const st: RunStats = {
    seed,
    status: 'timeout',
    ticks: 0,
    kills: 0,
    hpLeft: 0,
    hitsDealt: 0,
    hitsTaken: 0,
    misses: 0,
    dodges: 0,
    spellFails: 0,
    spellsCast: 0,
    interrupts: 0,
    xp: {},
  };
  // Autopilot only fights; exploration: walk toward the exit and fight whatever shows up.
  let lastMoveTick = -1000;
  while (sim.tick < maxTicks && sim.status === 'running') {
    const p = sim.player;
    const foesVisible = sim.enemiesAlive().some((e) => p.visible.has(sim.map.idx(e.pos.x, e.pos.y)));
    if (!foesVisible && p.path.length === 0 && p.isChannelFree('legs') && sim.tick - lastMoveTick > 5) {
      sim.command({ type: 'move', entity: p.id, to: sim.exit });
      lastMoveTick = sim.tick;
    }
    const events: GameEvent[] = sim.step();
    for (const e of events) {
      switch (e.type) {
        case 'hit':
          if (e.attacker === sim.playerId) st.hitsDealt++;
          if (e.target === sim.playerId) st.hitsTaken++;
          break;
        case 'missed':
          if (e.attacker === sim.playerId) {
            if (e.reason === 'dodge') st.dodges++;
            else st.misses++;
          }
          break;
        case 'died':
          if (e.id !== sim.playerId) st.kills++;
          break;
        case 'actionFailed':
          if (e.id === sim.playerId && e.action === 'fireball') st.spellFails++;
          break;
        case 'actionStarted':
          if (e.id === sim.playerId && e.action === 'fireball') st.spellsCast++;
          break;
        case 'interrupted':
          st.interrupts++;
          break;
        case 'xp':
          if (e.id === sim.playerId) st.xp[e.skill] = (st.xp[e.skill] ?? 0) + e.amount;
          break;
        case 'reachedExit':
          sim.leave();
          break;
        default:
          break;
      }
    }
  }
  st.status = sim.status === 'running' ? 'timeout' : sim.status;
  st.ticks = sim.tick;
  st.hpLeft = sim.player.hp;
  return st;
}

const t0 = performance.now();
const all: RunStats[] = [];
for (let i = 0; i < runs; i++) all.push(runOne(1000 + i));
const dt = performance.now() - t0;

const won = all.filter((r) => r.status === 'won');
const lost = all.filter((r) => r.status === 'lost');
const timeout = all.filter((r) => r.status === 'timeout');
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n: number): string => `${((100 * n) / runs).toFixed(1)} %`;

console.log(`7Heaven balance run — ${runs} rifts, enemies: ${enemies.join(', ')} — ${dt.toFixed(0)} ms (${(dt / runs).toFixed(1)} ms/rift)`);
console.log('');
console.log(`  won      ${pct(won.length)}   avg ${avg(won.map((r) => ticksToSec(r.ticks))).toFixed(1)} s, hp left ${avg(won.map((r) => r.hpLeft)).toFixed(0)}`);
console.log(`  lost     ${pct(lost.length)}   avg ${avg(lost.map((r) => ticksToSec(r.ticks))).toFixed(1)} s, kills before death ${avg(lost.map((r) => r.kills)).toFixed(2)}`);
console.log(`  timeout  ${pct(timeout.length)}`);
console.log('');
console.log(`  kills/rift        ${avg(all.map((r) => r.kills)).toFixed(2)} of ${enemies.length}`);
console.log(`  player hits       ${avg(all.map((r) => r.hitsDealt)).toFixed(1)}  misses ${avg(all.map((r) => r.misses)).toFixed(1)}  dodged ${avg(all.map((r) => r.dodges)).toFixed(1)}`);
console.log(`  hits taken        ${avg(all.map((r) => r.hitsTaken)).toFixed(1)}`);
const casts = all.reduce((s, r) => s + r.spellsCast, 0);
const fails = all.reduce((s, r) => s + r.spellFails, 0);
console.log(`  fireballs         ${(casts / runs).toFixed(2)}/rift, failed ${casts ? ((100 * fails) / casts).toFixed(1) : '0'} %`);
console.log(`  interrupts        ${avg(all.map((r) => r.interrupts)).toFixed(2)}/rift`);
const xpKeys = [...new Set(all.flatMap((r) => Object.keys(r.xp)))];
console.log(`  xp/rift           ${xpKeys.map((k) => `${k} ${avg(all.map((r) => r.xp[k] ?? 0)).toFixed(0)}`).join(', ') || 'none'}`);
console.log('');
const wr = won.length / runs;
if (wr < 0.4 || wr > 0.7) console.log(`  ⚠ win rate ${pct(won.length)} is outside the MVP target band 40–70 %`);
else console.log(`  ✓ win rate inside the MVP target band 40–70 %`);
