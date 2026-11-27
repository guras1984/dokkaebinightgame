// 레벨업 때 셋 중 하나를 고르는 능력. 판이 끝나면 사라짐 (판 안에서 강해지는 재미).
export const PERKS = [
  { id: 'maxHp', icon: '❤️', name: '튼튼한 몸', desc: '최대 체력 +20', apply: (m) => { m.maxHp += 20; } },
  { id: 'dmg', icon: '💪', name: '센 팔', desc: '모든 무기 피해 +15%', apply: (m) => { m.dmg += 0.15; } },
  { id: 'speed', icon: '👟', name: '날랜 발', desc: '이동 속도 +8%', apply: (m) => { m.speed += 0.08; } },
  { id: 'atk', icon: '⚡', name: '빠른 손', desc: '휘두르기 +12% 빠르게', apply: (m) => { m.atk += 0.12; } },
  { id: 'roll', icon: '🌀', name: '구르기 달인', desc: '연속 구르기 +1번', apply: (m) => { m.roll += 1; } },
  { id: 'regen', icon: '🔥', name: '불의 축복', desc: '불빛 안 회복 +50%', apply: (m) => { m.regen += 0.5; } },
  { id: 'needs', icon: '🍙', name: '든든한 배', desc: '배고픔·목마름 15% 천천히', apply: (m) => { m.needs += 0.15; } },
  { id: 'crit', icon: '🎯', name: '날카로운 눈', desc: '치명타 확률 +8%', apply: (m) => { m.crit += 0.08; } },
  { id: 'gather', icon: '🪵', name: '손재주', desc: '장작·돌을 두 배로 얻을 확률 +25%', apply: (m) => { m.gather += 0.25; } },
  { id: 'fuel', icon: '🏮', name: '불씨 지킴이', desc: '장작 하나로 불이 25% 더 오래', apply: (m) => { m.fuel += 0.25; } },
];
export const emptyMods = () => ({ maxHp: 0, dmg: 0, speed: 0, atk: 0, roll: 0, regen: 0, needs: 0, crit: 0, gather: 0, fuel: 0 });
/** xp needed to go from level L to L+1 */
export const xpNeed = (L) => Math.round(30 * Math.pow(L, 1.35));
/** xp for beating a monster */
export const XP = { dokkaebi: 10, wisp: 8, elite: 30, boss: 120, fox: 25, centipede: 22, bulgasari: 40, shadow: 18, imugi: 250, dragon: 600 };
/** three different perks to choose from */
export function rollPerks() {
  const pool = [...PERKS];
  const out = [];
  while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}
