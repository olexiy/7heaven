/** Diagnostic: find rifts where the autopilot neither wins nor dies and print the stuck state. */
import { Sim } from '../src/core/sim/sim';
import { TICKS_PER_SEC } from '../src/core/time';

const enemies = ['ghoul', 'ghoulKeen', 'ghoul'];
for (let seed = 1000; seed < 1300; seed++) {
  const sim = new Sim({ seed, enemies });
  sim.command({ type: 'autopilot', on: true });
  let lastMove = -1000;
  while (sim.tick < 300 * TICKS_PER_SEC && sim.status === 'running') {
    const p = sim.player;
    const foes = sim.enemiesAlive().some((e) => p.visible.has(sim.map.idx(e.pos.x, e.pos.y)));
    if (!foes && p.path.length === 0 && p.isChannelFree('legs') && sim.tick - lastMove > 5) {
      sim.command({ type: 'move', entity: p.id, to: sim.exit });
      lastMove = sim.tick;
    }
    for (const e of sim.step()) if (e.type === 'reachedExit') sim.leave();
  }
  if (sim.status === 'running') {
    const p = sim.player;
    console.log(
      `seed ${seed}: player ${JSON.stringify(p.pos)} hp ${p.hp} path ${p.path.length} legs ${p.action('legs')?.def.id} hands ${p.action('hands')?.def.id} exit ${JSON.stringify(sim.exit)}`,
    );
    for (const e of sim.enemiesAlive()) {
      console.log(
        `   ${e.spec.kind} ${JSON.stringify(e.pos)} hp ${e.hp} aw ${e.awareness} seesPlayer ${e.visible.has(sim.map.idx(p.pos.x, p.pos.y))} playerSees ${p.visible.has(sim.map.idx(e.pos.x, e.pos.y))} path ${e.path.length} legs ${e.action('legs')?.def.id}`,
      );
    }
  }
}
