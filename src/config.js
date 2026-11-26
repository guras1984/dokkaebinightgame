// All "feel" numbers live here so they can be tuned in one place (and live via ?tune=1).
export const tune = {
  // movement
  moveSpeed: 5.2,      // m/s at full stick
  accel: 32,           // how fast we reach full speed
  decel: 26,           // how fast we stop
  turnSpeed: 16,       // how fast the body turns toward the move direction
  // roll
  rollSpeed: 11.5,
  rollTime: 0.5,
  rollChain: 3,       // rolls in a row before the cooldown kicks in
  rollCooldown: 0.45,
  // attack
  attackTime: 0.38,
  attackRange: 1.75,
  // animation
  stride: 2.6,         // leg swing radians per metre walked (ties feet to ground speed)
  swing: 0.85,         // leg/arm swing amount
  bob: 0.07,           // body bounce while walking
  lean: 0.14,          // forward lean at full speed
  // camera
  camDistance: 19,
  camPitch: 52,        // degrees
  camFollow: 7,        // higher = tighter follow
};

export const tuneRanges = {
  moveSpeed: [2, 10, 0.1], accel: [5, 80, 1], decel: [5, 80, 1], turnSpeed: [3, 40, 0.5],
  rollSpeed: [4, 20, 0.5], rollTime: [0.2, 0.8, 0.02], rollChain: [1, 6, 1], rollCooldown: [0, 1.5, 0.05],
  attackTime: [0.2, 0.8, 0.02], attackRange: [1, 3, 0.05],
  stride: [1, 5, 0.1], swing: [0.2, 1.4, 0.05], bob: [0, 0.2, 0.01], lean: [0, 0.4, 0.01],
  camDistance: [10, 32, 0.5], camPitch: [30, 75, 1], camFollow: [1, 20, 0.5],
};

export const rules = {
  // one full day ≈ 3 minutes (kid feedback 2026-11-27: the old 5½ minutes felt slow)
  dayLength: 80,
  duskLength: 10,
  nightLength: 95,
  islandRadius: 28.5,
  playerHp: 100,
  playerRadius: 0.42,
  regenInLight: 4,      // hp/s near the fire, when not hurt recently
  hurtGrace: 0.7,
  woodPerTree: 2,
  treeHp: 3,
  fireStart: 45,        // fuel 0..100
  fireMax: 100,
  fuelPerWood: 12,
  burnDay: 0.21,        // fuel per second (≈ same fuel per day as before, days are shorter)
  burnNight: 1.05,
  fireMinRadius: 2.6,
  fireRadiusPerFuel: 0.058,
  monsterHp: 3,
  monsterSpeed: 3.3,
  monsterDamage: 15,
  monsterWindup: 0.55,
  spawnStart: 4.2,
  spawnEnd: 2.0,
  capStart: 3,
  capEnd: 8,

  // --- v0.2: many nights ---
  totalNights: 100,
  dawnHeal: 30,         // hp restored each morning
  regrowShare: 0.6,     // share of felled trees / mined rocks that come back each morning
  rockHp: 4,
  stonePerRock: 2,
  fireLevels: [100, 140, 185],   // max fuel per campfire level
  herbHeal: 40,
  charmRadius: 7.5,
  lanternRadius: 3.4,
  lanternMax: 4,
  fenceMax: 24,
  dayChests: 2,
  nightChestAt: 0.25,   // night progress when the glowing chest appears
  raidAt: 0.55,         // night progress of the raid (from night 2)
  // --- survival needs ---
  waterDrain: 0.45,     // per second (full → empty in ~3.7 min ≈ a bit over a day)
  foodDrain: 0.34,      // per second (full → empty in ~5 min)
  needDamage: 1.2,      // hp/s while water or food is empty
  drinkAmount: 35,
  berryFood: 14,
  meatFood: 45,
  rawMeatFood: 12,
  bushes: 11,
  rabbits: 5,
  wellMax: 2,
  bossEvery: 5,         // boss night every N nights
  bossAt: 0.3,          // night progress when the chief arrives
  bossSlam: 5,          // seconds between fire-shaking slams while you hide
  bossSlamFuel: 7,
  hitStop: 0.05,
  killStop: 0.09,
};

/** how hard night n (1-based) is */
export function difficulty(n) {
  const k = n - 1;
  return {
    capStart: Math.min(10, rules.capStart + k * 0.8),
    capEnd: Math.min(18, rules.capEnd + k * 1.2),
    spawnMul: Math.max(0.55, 1 - k * 0.06),       // shorter gaps between spawns
    speedMul: 1 + Math.min(0.35, k * 0.04),
    hp: rules.monsterHp + Math.floor(k / 3),
    wisp: n >= 2 ? Math.min(0.4, 0.18 + k * 0.03) : 0,
    elite: n >= 3 ? Math.min(0.28, 0.07 + (n - 3) * 0.03) : 0,
    raid: n >= 2 ? Math.min(14, 3 + n) : 0,
    n,
  };
}

export const MONSTER_TYPES = {
  dokkaebi: { hp: 1, damage: 15, speed: 3.3, windup: 0.55, scale: 1, radius: 0.5, reach: 1.45, hitReach: 1.9, beads: 1 },
  elite:    { hp: 2.6, damage: 26, speed: 2.7, windup: 0.8, scale: 1.5, radius: 0.75, reach: 2.0, hitReach: 2.6, beads: 3 },
  boss:     { hp: 1, damage: 30, speed: 2.4, windup: 1.0, scale: 2.4, radius: 1.1, reach: 2.8, hitReach: 3.4, beads: 10 },
  wisp:     { hp: 1, damage: 12, speed: 5.4, scale: 1, radius: 0.35, beads: 1 },
};
