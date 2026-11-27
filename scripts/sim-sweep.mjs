const { Sim } = await import(process.argv[2] + '/server/src/sim.js');
const real = Date.now;
for (const day of (process.argv[3] || "3,7,12,15,25,30,40,50,75,99,100").split(",").map(Number)) {
  let fake = real(); Date.now = () => fake;
  // start at dusk of `day` (room clock runs 1.5x: 85 game-s = 56.7 real-s)
  const s = new Sim({ seed: 777 + day, start: fake - (85 / 1.5) * 1000, startDay: day }, null);
  const players = [{ id: 'a', pos: { x: 1, z: 2 }, x: 1, z: 2, facing: 0, dead: false }, { id: 'b', pos: { x: -1, z: 2 }, x: -1, z: 2, facing: 0, dead: false }];
  let max = 0, worst = 0, total = 0, steps = 0, errs = 0, bytes = 0, maxMsg = 0, boss = '';
  for (let i = 0; i < 700; i++) {   // 70 real s ≈ the whole night
    fake += 100;
    const t0 = performance.now();
    try { s.step(0.1, players); } catch (e) { errs++; if (errs < 3) console.log('ERR', e.stack.split('\n').slice(0, 3).join(' | ')); }
    const ms = performance.now() - t0; worst = Math.max(worst, ms); total += ms; steps++;
    const { all } = s.drain(); const len = JSON.stringify({ t: 'b', l: all }).length; bytes += len; maxMsg = Math.max(maxMsg, len);
    max = Math.max(max, s.monsters.alive.length);
    if (s.monsters.boss && s.monsters.boss.alive) boss = s.monsters.boss.type;
  }
  console.log(`day ${day}: 동시 최대 ${max}마리, 대장 ${boss || '-'}, 한 번 계산 평균 ${(total / steps).toFixed(2)}ms 최악 ${worst.toFixed(1)}ms, 오류 ${errs}, 메시지 최대 ${(maxMsg / 1024).toFixed(1)}KB 초당 ${(bytes / 70 / 1024).toFixed(1)}KB`);
  Date.now = real;
}
