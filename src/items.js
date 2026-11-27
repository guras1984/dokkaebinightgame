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
  jangseung: { name: '장승', use: true, hint: '앞에 설치' },
  trap:    { name: '가시 덫', use: true, hint: '앞에 설치' },
  hut:     { name: '초가집', use: true, hint: '앞에 설치' },
  tower:   { name: '돌탑', use: true, hint: '앞에 설치' },
  wall:    { name: '돌담', use: true, hint: '앞에 설치' },
  gate:    { name: '성문', use: true, hint: '앞에 설치' },
  watch:   { name: '망루', use: true, hint: '앞에 설치' },
  fence:   { name: '울타리', use: true, hint: '앞에 설치' },
  torch:   { name: '횃불', use: true, hint: '들고 다니는 빛' },
  skewer:  { name: '고기 꼬치', use: true, hint: '배고픔 많이 + 체력' },
  fish:    { name: '물고기', use: true, hint: '배고픔 조금 (구우면 더)' },
  fishc:   { name: '생선 구이', use: true, hint: '배고픔 + 목마름' },
  arrow:   { name: '화살' },
};
export const USE_ORDER = ['berry', 'meat', 'skewer', 'fish', 'fishc', 'rawmeat', 'herb', 'charm', 'torch', 'lantern', 'fence', 'well', 'jangseung', 'trap', 'hut', 'tower', 'wall', 'gate', 'watch'];
/** items that get placed in front of you */
export const PLACEABLE = ['lantern', 'fence', 'well', 'jangseung', 'trap', 'hut', 'tower', 'wall', 'gate', 'watch'];

export function emptyInventory() {
  return { wood: 0, stone: 0, bead: 0, berry: 0, meat: 0, rawmeat: 0, herb: 0, charm: 0, lantern: 0, fence: 0, well: 0, torch: 0, arrow: 0, jangseung: 0, trap: 0, hut: 0, tower: 0, skewer: 0, fish: 0, fishc: 0, wall: 0, gate: 0, watch: 0 };
}

/**
 * 만들기 목록. cat: tool(무기·도구) build(짓기) food(먹을 것) fire(모닥불)
 * icon: 카드 그림, gives: 아이템으로 받음, weapon: 무기를 얻음, flag: 한 번만 만드는 장비
 * lock(s): 잠겨 있으면 이유 문장 (예: 무쇠를 구하면), show(s): false면 목록에서 숨김 (이미 가짐)
 */
export const RECIPES = [
  // 무기·도구
  { id: 'train', cat: 'tool', icon: 'w-axe1', name: '무기 단련', desc: '', cost: { bead: 5 }, show: (s) => s.trainLv < 10 },
  { id: 'spear', cat: 'tool', icon: 'w-spear', name: '창', desc: '길게 찔러 한 줄을 꿰뚫는다 (피해 12)', cost: { wood: 4, stone: 2 }, weapon: 'spear', show: (s) => !s.has('spear') },
  { id: 'axe', cat: 'tool', icon: 'w-axe1', name: '쇠도끼', desc: '피해 18, 나무를 두 번에', cost: { stone: 8, bead: 3 }, show: (s) => s.axeLevel === 0 },
  { id: 'steelaxe', cat: 'tool', icon: 'w-axe2', name: '강철 도끼', desc: '피해 28, 나무를 한 번에', cost: { stone: 12, bead: 6 }, show: (s) => s.axeLevel === 1, lock: (s) => (!s.musoe ? '대장장이 무쇠를 구하면' : null) },
  { id: 'sword', cat: 'tool', icon: 'w-sword', name: '환도', desc: '아주 빠른 연속 베기 (피해 8)', cost: { stone: 6, bead: 3 }, weapon: 'sword', show: (s) => !s.has('sword'), lock: (s) => (!s.musoe ? '대장장이 무쇠를 구하면' : null) },
  { id: 'mace', cat: 'tool', icon: 'w-mace', name: '철퇴', desc: '느리지만 한 방 40, 주변을 날려 버림', cost: { stone: 10, bead: 4 }, weapon: 'mace', show: (s) => !s.has('mace'), lock: (s) => (!s.musoe ? '대장장이 무쇠를 구하면' : null) },
  { id: 'bow', cat: 'tool', icon: 'w-bow', name: '활', desc: '멀리서 쏜다 (피해 7, 화살 필요)', cost: { wood: 6, rawmeat: 1 }, weapon: 'bow', show: (s) => !s.has('bow'), lock: (s) => (!s.beomsu ? '사냥꾼 범수를 구하면' : null) },
  { id: 'arrow', cat: 'tool', icon: 'arrow', name: '화살 ×6', desc: '활에 쓰는 화살', cost: { wood: 2, stone: 1 }, gives: 'arrow', amount: 6, show: () => true, lock: (s) => (!s.has('bow') ? '활이 있어야' : null) },
  { id: 'armor', cat: 'tool', icon: 'armor', name: '가죽 갑옷', desc: '받는 피해 35% 줄임', cost: { rawmeat: 3, stone: 6, bead: 4 }, show: (s) => !s.armor, lock: (s) => (!s.musoe ? '대장장이 무쇠를 구하면' : null) },
  { id: 'sandals', cat: 'tool', icon: 'sandals', name: '짚신', desc: '더 빨리 걷는다 (+15%)', cost: { wood: 4, rawmeat: 1 }, show: (s) => !s.sandals },
  { id: 'rod', cat: 'tool', icon: 'rod', name: '낚싯대', desc: '물가에서 "낚시"로 물고기', cost: { wood: 3, berry: 1 }, show: (s) => !s.rod },
  { id: 'torch', cat: 'tool', icon: 'torch', name: '횃불', desc: '30초 동안 작은 빛, 도깨비가 못 들어옴', cost: { wood: 3, stone: 1 }, gives: 'torch', show: () => true },
  { id: 'charm', cat: 'tool', icon: 'charm', name: '부적', desc: '주변 도깨비를 한 번에 쫓아낸다', cost: { bead: 2, wood: 1 }, gives: 'charm', show: () => true },
  // 짓기
  { id: 'fence', cat: 'build', icon: 'fence', name: '울타리 ×2', desc: '길을 막는 벽 (튼튼함 60)', cost: { wood: 3 }, gives: 'fence', amount: 2, show: () => true },
  { id: 'wall', cat: 'build', icon: 'wall', name: '돌담 ×2', desc: '튼튼한 벽 (220). 나란히 놓으면 이어진다', cost: { stone: 6 }, gives: 'wall', amount: 2, show: () => true },
  { id: 'gate', cat: 'build', icon: 'gate', name: '성문', desc: '나는 지나가고 도깨비는 막는 문', cost: { wood: 4, stone: 4 }, gives: 'gate', show: () => true },
  { id: 'watch', cat: 'build', icon: 'watch', name: '망루', desc: '밤에 다가오는 요괴에게 화살을 쏜다', cost: { wood: 10, stone: 4, bead: 2 }, gives: 'watch', show: () => true },
  { id: 'trap', cat: 'build', icon: 'trap', name: '가시 덫', desc: '밟은 도깨비 피해 20, 세 번 쓰면 부서짐', cost: { wood: 3, stone: 2 }, gives: 'trap', show: () => true },
  { id: 'jangseung', cat: 'build', icon: 'jangseung', name: '장승', desc: '둘레의 도깨비가 느려진다', cost: { wood: 6, bead: 2 }, gives: 'jangseung', show: () => true },
  { id: 'lantern', cat: 'build', icon: 'lantern', name: '석등', desc: '밤에 켜지는 작은 안전지대', cost: { stone: 5, wood: 2 }, gives: 'lantern', show: () => true },
  { id: 'well', cat: 'build', icon: 'well', name: '우물', desc: '야영지에서 물을 마신다', cost: { stone: 8, wood: 4 }, gives: 'well', show: () => true },
  { id: 'hut', cat: 'build', icon: 'hut', name: '초가집', desc: '마을 꾸미기. 밤에 창문 불빛이 안전지대', cost: { wood: 12, stone: 4 }, gives: 'hut', show: () => true },
  { id: 'tower', cat: 'build', icon: 'tower', name: '돌탑', desc: '마을 꾸미기', cost: { stone: 4 }, gives: 'tower', show: () => true },
  // 먹을 것
  { id: 'cook', cat: 'food', icon: 'meat', name: '고기 굽기', desc: '날고기를 구워 배부르게 (+45)', cost: { rawmeat: 1 }, gives: 'meat', fire: true, show: () => true },
  { id: 'skewer', cat: 'food', icon: 'skewer', name: '고기 꼬치', desc: '배고픔 +60, 체력 +15', cost: { meat: 1, berry: 2 }, gives: 'skewer', show: () => true },
  { id: 'grill', cat: 'food', icon: 'fishc', name: '생선 구이', desc: '배고픔 +40, 목마름 +10', cost: { fish: 1 }, gives: 'fishc', fire: true, show: () => true },
  { id: 'herb', cat: 'food', icon: 'herb', name: '약초 달이기', desc: '체력 +' + rules.herbHeal, cost: { wood: 2, bead: 1 }, gives: 'herb', show: () => true },
  // 모닥불
  { id: 'fire2', cat: 'fire', icon: 'fireup', name: '모닥불 키우기 Ⅱ', desc: '불이 더 크고 오래 간다', cost: { wood: 8, stone: 6 }, fire: true, show: (s) => s.fireLevel === 0 },
  { id: 'fire3', cat: 'fire', icon: 'fireup', name: '모닥불 키우기 Ⅲ', desc: '가장 큰 불', cost: { wood: 14, stone: 12, bead: 4 }, fire: true, show: (s) => s.fireLevel === 1 },
];
export const CRAFT_TABS = [['all', '전체'], ['tool', '무기·도구'], ['build', '짓기'], ['food', '먹을 것'], ['fire', '모닥불']];

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
