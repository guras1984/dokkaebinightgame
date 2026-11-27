// 판이 끝나도 남는 것: 도감, 업적, 시작 선물, 옷. 이 기기(브라우저)에 저장됩니다.
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

export const MONSTER_INFO = [
  { id: 'dokkaebi', name: '도깨비', desc: '방망이를 든 섬의 주인. 밤이면 눈이 붉게 빛난다. 불빛을 싫어한다.' },
  { id: 'wisp', name: '도깨비불', desc: '떠다니는 푸른 불. 하얗게 번쩍인 뒤 곧장 날아든다.' },
  { id: 'elite', name: '큰 도깨비', desc: '보라색 거인. 느리지만 한 방이 크다. 철퇴가 잘 듣는다.' },
  { id: 'centipede', name: '왕지네', desc: '몸을 세웠다가 일직선으로 돌진한다. 구르기로 넘자.' },
  { id: 'fox', name: '구미호', desc: '아홉 꼬리 여우. 분신을 만든다. 맞으면 사라지는 쪽은 가짜.' },
  { id: 'shadow', name: '어둑시니', desc: '깊은 밤의 그림자. 가까울수록 커지고, 빛에 녹는다.' },
  { id: 'bulgasari', name: '불가사리', desc: '쇠와 돌을 먹는 짐승. 지은 것을 먹어 치우며 힘을 얻는다.' },
  { id: 'boss', name: '도깨비 대장', desc: '5일마다 오는 대장. 땅을 쳐서 모닥불을 흔든다. 금방망이를 지녔다.' },
  { id: 'imugi', name: '이무기', desc: '용이 되지 못한 큰 뱀. 10일마다 땅속에서 솟아오른다. 여의주를 품었다.' },
  { id: 'dragon', name: '용', desc: '백 번째 밤, 여의주를 얻은 이무기가 하늘로 오른다.' },
];

export const GIFTS = {
  wood10: { name: '장작 10개', desc: '장작 10개로 시작' },
  ironAxe: { name: '쇠도끼', desc: '쇠도끼를 들고 시작' },
  charm2: { name: '부적 2장', desc: '부적 2장으로 시작' },
  traps: { name: '가시 덫 3개', desc: '가시 덫 3개로 시작' },
  armor: { name: '가죽 갑옷', desc: '가죽 갑옷을 입고 시작' },
  torch3: { name: '횃불 3개', desc: '횃불 3개로 시작' },
};

export const OUTFITS = {
  basic: { name: '흰 저고리', desc: '처음 옷' },
  mask: { name: '도깨비 탈', desc: '뿔 달린 탈' },
  gat: { name: '갓', desc: '검은 갓을 쓴 선비' },
  redcoat: { name: '붉은 두루마기', desc: '요괴 사냥꾼의 옷' },
  dragon: { name: '용비늘 갑옷', desc: '이무기를 물리친 자의 갑옷' },
};

/** check(life) → true when achieved */
export const ACHIEVEMENTS = [
  { id: 'night1', name: '첫 밤', desc: '첫 밤을 버텼다', check: (l) => l.bestNight >= 1, reward: { gift: 'wood10' } },
  { id: 'night5', name: '닷새', desc: '5일 밤 버티기', check: (l) => l.bestNight >= 5, reward: { gift: 'ironAxe' } },
  { id: 'boss', name: '대장 사냥', desc: '도깨비 대장 물리치기', check: (l) => l.bosses >= 1, reward: { gift: 'charm2' } },
  { id: 'horde', name: '백귀야행', desc: '백귀야행을 끝까지 막기', check: (l) => l.hordes >= 1, reward: { gift: 'traps' } },
  { id: 'village', name: '다시 모인 마을', desc: '마을 사람 4명 모두 구하기', check: (l) => l.rescuedAll >= 1, reward: { gift: 'armor' } },
  { id: 'dex6', name: '요괴 박사', desc: '도감 6칸 채우기', check: (l, dex) => Object.keys(dex).length >= 6, reward: { outfit: 'mask' } },
  { id: 'night10', name: '열흘', desc: '10일 밤 버티기', check: (l) => l.bestNight >= 10, reward: { outfit: 'gat' } },
  { id: 'kills100', name: '요괴 사냥꾼', desc: '요괴 100마리 물리치기 (모든 판 합계)', check: (l) => l.kills >= 100, reward: { outfit: 'redcoat' } },
  { id: 'imugi', name: '이무기 사냥', desc: '이무기 물리치기', check: (l) => l.imugi >= 1, reward: { outfit: 'dragon', gift: 'torch3' } },
];

export class Meta {
  constructor() {
    this.life = load('dokkaebi.life', { bestNight: 0, kills: 0, bosses: 0, hordes: 0, rescuedAll: 0, imugi: 0 });
    this.done = load('dokkaebi.ach', {});
    this.gift = load('dokkaebi.gift', null);
    this.outfit = load('dokkaebi.outfit', 'basic');
  }
  bump(key, n = 1) { this.life[key] = (this.life[key] || 0) + n; save('dokkaebi.life', this.life); }
  best(key, v) { if (v > (this.life[key] || 0)) { this.life[key] = v; save('dokkaebi.life', this.life); } }
  /** returns newly finished achievements */
  check(dex) {
    const fresh = [];
    for (const a of ACHIEVEMENTS) if (!this.done[a.id] && a.check(this.life, dex)) { this.done[a.id] = Date.now(); fresh.push(a); }
    if (fresh.length) save('dokkaebi.ach', this.done);
    return fresh;
  }
  gifts() { return ACHIEVEMENTS.filter((a) => this.done[a.id] && a.reward.gift).map((a) => a.reward.gift); }
  outfits() { return ['basic', ...ACHIEVEMENTS.filter((a) => this.done[a.id] && a.reward.outfit).map((a) => a.reward.outfit)]; }
  setGift(id) { this.gift = id; save('dokkaebi.gift', id); }
  setOutfit(id) { this.outfit = id; save('dokkaebi.outfit', id); }
}
