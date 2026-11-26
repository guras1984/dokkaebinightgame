// All "feel" numbers live here so they can be tuned in one place (and live via ?tune=1).
export const tune = {
  // movement
  moveSpeed: 5.2,      // m/s at full stick
  accel: 32,           // how fast we reach full speed
  decel: 26,           // how fast we stop
  turnSpeed: 16,       // how fast the body turns toward the move direction
  // roll
  rollSpeed: 11,
  rollTime: 0.4,
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
  rollSpeed: [4, 20, 0.5], rollTime: [0.2, 0.8, 0.02], rollCooldown: [0, 1.5, 0.05],
  attackTime: [0.2, 0.8, 0.02], attackRange: [1, 3, 0.05],
  stride: [1, 5, 0.1], swing: [0.2, 1.4, 0.05], bob: [0, 0.2, 0.01], lean: [0, 0.4, 0.01],
  camDistance: [10, 32, 0.5], camPitch: [30, 75, 1], camFollow: [1, 20, 0.5],
};

export const rules = {
  dayLength: 140,
  duskLength: 16,
  nightLength: 170,
  islandRadius: 28.5,
  playerHp: 100,
  playerRadius: 0.42,
  regenInLight: 3,      // hp/s near the fire, when not hurt recently
  hurtGrace: 0.7,
  woodPerTree: 2,
  treeHp: 3,
  fireStart: 45,        // fuel 0..100
  fireMax: 100,
  fuelPerWood: 12,
  burnDay: 0.12,        // fuel per second
  burnNight: 0.6,
  fireMinRadius: 2.6,
  fireRadiusPerFuel: 0.058,
  monsterHp: 3,
  monsterSpeed: 3.3,
  monsterDamage: 15,
  monsterWindup: 0.55,
  spawnStart: 7,
  spawnEnd: 3.2,
  capStart: 3,
  capEnd: 8,
};
