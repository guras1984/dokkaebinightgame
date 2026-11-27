// 무기 표. 근접은 세게, 원거리는 약하게 (아이 요청).
// dmg: 한 번 피해, time: 휘두르는 시간(초, 짧을수록 빠름), reach: 닿는 거리(m)
// chop: 나무·바위에 주는 힘 (나무는 3, 바위는 4를 채우면 쓰러짐)
export const WEAPONS = {
  axe:   { name: '도끼', dmg: [10, 18, 28], time: 0.38, reach: 1.75, chop: [1, 2, 3], arc: 0.2 },
  spear: { name: '창', dmg: 12, time: 0.42, reach: 2.8, chop: 1, arc: 0.75, pierce: true },
  sword: { name: '환도', dmg: 8, time: 0.2, reach: 1.8, chop: 1, arc: 0.05 },
  mace:  { name: '철퇴', dmg: 40, time: 0.62, reach: 1.9, chop: 1, mine: 4, arc: 0.0, knock: 2.2, bigBonus: 1.5 },
  bow:   { name: '활', dmg: 7, time: 0.45, reach: 13, chop: 0, ranged: true, ammo: 'arrow' },
  club:  { name: '금방망이', dmg: 25, time: 0.4, reach: 2.0, chop: 2, arc: 0.1, beadChance: 0.15 },
};
export const WEAPON_ORDER = ['axe', 'spear', 'sword', 'mace', 'bow', 'club'];
export const CRIT_CHANCE = 0.12;
export const CRIT_MUL = 1.6;

/** damage of weapon id for the current axe level */
export function weaponDmg(id, axeLevel) {
  const w = WEAPONS[id];
  return Array.isArray(w.dmg) ? w.dmg[axeLevel] : w.dmg;
}
export function weaponChop(id, axeLevel, rock = false) {
  const w = WEAPONS[id];
  if (rock && w.mine) return w.mine;
  return Array.isArray(w.chop) ? w.chop[axeLevel] : w.chop;
}
