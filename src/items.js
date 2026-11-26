// Items, loot tables and crafting recipes. Pure data + small helpers, no rendering.
import { rules } from './config.js';

/** everything the player can carry. `use` items show in the item bar. */
export const ITEMS = {
  wood:    { name: '장작', res: true },
  stone:   { name: '돌', res: true },
  bead:    { name: '도깨비 구슬', res: true },
  berry:   { name: '산딸기', use: true, hint: '배고픔 조금' },
  meat:    { name: '구운 고기', use: true, hint: '배고픔 많이' },
  rawmeat: { name: '날고기', use: true, hint: '모닥불 옆에서 굽기' },
  herb:    { name: '약초', use: true, hint: '체력 회복' },
  charm:   { name: '부적', use: true, hint: '도깨비 쫓기' },
  lantern: { name: '석등', use: true, hint: '앞에 설치' },
  well:    { name: '우물', use: true, hint: '앞에 설치' },
  fence:   { name: '울타리', use: true, hint: '앞에 설치' },
  torch:   { name: '횃불', use: true, hint: '들고 다니는 빛' },
};
export const USE_ORDER = ['berry', 'meat', 'rawmeat', 'herb', 'charm', 'torch', 'lantern', 'fence', 'well'];

export function emptyInventory() {
  return { wood: 0, stone: 0, bead: 0, berry: 0, meat: 0, rawmeat: 0, herb: 0, charm: 0, lantern: 0, fence: 0, well: 0, torch: 0 };
}

export const RECIPES = [
  { id: 'fire2', name: '모닥불 키우기 Ⅱ', desc: '불이 더 크고 오래 간다', cost: { wood: 8, stone: 6 }, show: (s) => s.fireLevel === 0 },
  { id: 'fire3', name: '모닥불 키우기 Ⅲ', desc: '가장 큰 불. 밤이 든든하다', cost: { wood: 14, stone: 12, bead: 4 }, show: (s) => s.fireLevel === 1 },
  { id: 'lantern', name: '석등', desc: '밤새 빛나는 작은 안전지대 (최대 4)', cost: { stone: 5, wood: 2 }, gives: 'lantern', show: () => true },
  { id: 'well', name: '우물', desc: '야영지에서 물을 마신다 (최대 2)', cost: { stone: 8, wood: 4 }, gives: 'well', show: () => true },
  { id: 'fence', name: '나무 울타리 ×2', desc: '도깨비 길을 막는 벽', cost: { wood: 3 }, gives: 'fence', amount: 2, show: () => true },
  { id: 'torch', name: '횃불', desc: '들면 30초 동안 작은 빛. 도깨비가 다가오지 못한다', cost: { wood: 3, stone: 1 }, gives: 'torch', show: () => true },
  { id: 'axe', name: '쇠도끼', desc: '두 배로 세게 벤다', cost: { stone: 8, bead: 3 }, show: (s) => !s.ironAxe },
  { id: 'steelaxe', name: '강철 도끼 (무쇠)', desc: '세 배로 세게, 조금 더 멀리', cost: { stone: 12, bead: 6 }, show: (s) => s.musoe && s.axeLevel === 1 },
  { id: 'armor', name: '가죽 갑옷 (무쇠)', desc: '받는 피해 35% 줄임', cost: { rawmeat: 3, stone: 6, bead: 4 }, show: (s) => s.musoe && !s.armor },
  { id: 'charm', name: '부적', desc: '주변 도깨비를 한 번에 쫓아낸다', cost: { bead: 2, wood: 1 }, gives: 'charm', show: () => true },
  { id: 'herb', name: '약초 달이기', desc: '체력 +' + rules.herbHeal, cost: { wood: 2, bead: 1 }, gives: 'herb', show: () => true },
];

export const canAfford = (inv, cost) => Object.entries(cost).every(([k, v]) => (inv[k] || 0) >= v);
export const pay = (inv, cost) => { for (const [k, v] of Object.entries(cost)) inv[k] -= v; };

const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

/** roll a chest's contents → [{kind, n}] */
export function rollLoot(kind, night) {
  const out = [];
  const add = (k, n) => { if (n > 0) out.push({ kind: k, n }); };
  if (kind === 'night') {
    add('bead', ri(3, 5) + Math.floor(night / 3));
    add('charm', 1);
    add('herb', Math.random() < 0.6 ? 1 : 0);
    add('stone', ri(1, 3));
  } else {
    add('wood', ri(2, 4));
    add('stone', ri(1, 3));
    add('herb', Math.random() < 0.45 ? 1 : 0);
    add('charm', Math.random() < 0.2 ? 1 : 0);
    add('bead', Math.random() < 0.35 ? 1 : 0);
    add('berry', Math.random() < 0.5 ? ri(2, 3) : 0);
    add('meat', Math.random() < 0.2 ? 1 : 0);
  }
  return out;
}
