import * as THREE from 'three';
import { tune } from './config.js';

// Blocky (Roblox-like) character built from boxes, animated procedurally.
// Faces +Z. Root origin is at the feet.

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const mat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

// soft round glow texture (shared)
let _glow = null;
export function glowTex() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}

/** monsters: eyes go from pale yellow by day to glowing red at night; brighter just before a hit */
const DAY_EYE = new THREE.Color(0xfff3a0), NIGHT_EYE = new THREE.Color(0xff2a1a), HOT_EYE = new THREE.Color(0xffb0a0);
export function setMonsterEyes(rig, night, rage = 0) {
  if (!rig.eyeMat) return;
  rig.eyeMat.color.copy(DAY_EYE).lerp(NIGHT_EYE, night).lerp(HOT_EYE, rage * 0.6);
  rig.eyeGlow.material.opacity = night * 0.75 + rage * 0.5;
  rig.eyeGlow.scale.setScalar(1 + rage * 0.6 + Math.sin(performance.now() / 120) * 0.05 * night);
}

function part(geo, material, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent?.add(m);
  return m;
}

/**
 * @param {object} o colors and options
 *  skin, top, pants, hair, kind: 'hero' | 'dokkaebi'
 */
export function buildCharacter(o) {
  const mats = [];
  const M = (c) => { const m = mat(c); mats.push(m); return m; };
  const skin = M(o.skin), top = M(o.top), pants = M(o.pants), dark = M(o.hair ?? 0x222222);
  const black = M(0x161616), white = M(0xffffff);

  const isMonster = o.kind === 'dokkaebi';
  const legH = 0.62, torsoH = isMonster ? 0.78 : 0.7, headS = isMonster ? 0.72 : 0.6;
  const torsoW = isMonster ? 0.92 : 0.8;

  const root = new THREE.Group();
  const spin = new THREE.Group();          // rotates for rolls / lean
  spin.position.y = 0.95;
  root.add(spin);
  const body = new THREE.Group();          // bobs while walking
  body.position.y = -0.95;
  spin.add(body);

  // legs (pivot at hip)
  const hipY = legH;
  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group();
    hip.position.set(s * 0.2, hipY, 0);
    body.add(hip);
    part(box(0.36, legH, 0.38), pants, 0, -legH / 2, 0, hip);
    part(box(0.38, 0.12, 0.44), black, 0, -legH + 0.06, 0.03, hip); // shoe
    if (isMonster) {
      // tiger-skin stripes
      for (let i = 0; i < 2; i++) part(box(0.37, 0.06, 0.39), black, 0, -0.14 - i * 0.2, 0, hip);
    }
    return hip;
  });

  // torso
  const torso = part(box(torsoW, torsoH, 0.44), top, 0, hipY + torsoH / 2, 0, body);
  if (!isMonster) {
    // jeogori collar + tie (goreum)
    part(box(0.5, 0.08, 0.46), white, 0.0, torsoH / 2 - 0.08, 0.005, torso).rotation.z = -0.5;
    part(box(0.1, 0.32, 0.05), M(0xd9434b), 0.12, 0.02, 0.24, torso);
    part(box(torsoW + 0.02, 0.1, 0.46), M(0x3b4a7a), 0, -torsoH / 2 + 0.05, 0, torso); // belt
  } else {
    part(box(torsoW + 0.02, 0.14, 0.46), M(0xf2b632), 0, -torsoH / 2 + 0.07, 0, torso);
    part(box(torsoW + 0.03, 0.05, 0.47), black, 0, -torsoH / 2 + 0.07, 0, torso);
  }

  // arms (pivot at shoulder)
  const shoulderY = hipY + torsoH - 0.1;
  const armW = isMonster ? 0.38 : 0.34;
  const arms = [-1, 1].map((s) => {
    const sh = new THREE.Group();
    sh.position.set(s * (torsoW / 2 + armW / 2 + 0.01), shoulderY, 0);
    body.add(sh);
    const armL = isMonster ? 0.82 : 0.66;
    part(box(armW, armL, armW), isMonster ? skin : top, 0, -armL * 0.42, 0, sh);
    part(box(armW * 0.95, 0.16, armW * 0.95), skin, 0, isMonster ? -0.76 : -0.62, 0, sh); // hand
    if (isMonster) for (const cx of [-0.1, 0.1]) part(box(0.06, 0.12, 0.06), M(0xe8dcc0), cx, -0.88, 0.12, sh); // claws
    return sh;
  });

  // head
  const headY = hipY + torsoH + headS / 2 + 0.02;
  const head = new THREE.Group();
  head.position.y = headY;
  body.add(head);
  part(box(headS, headS, headS), skin, 0, 0, 0, head);
  const eyeY = isMonster ? 0.04 : 0.02;
  // monster eyes use an unlit material so they can glow red at night
  const eyeMat = isMonster ? new THREE.MeshBasicMaterial({ color: 0xfff3a0 }) : null;
  const pupilMat = isMonster ? new THREE.MeshBasicMaterial({ color: 0x161616 }) : null;
  const eyes = [-1, 1].map((s) => {
    const e = part(box(isMonster ? 0.15 : 0.09, isMonster ? 0.1 : 0.13, 0.04), isMonster ? eyeMat : black, s * 0.15, eyeY, headS / 2 + 0.01, head);
    e.castShadow = false;
    if (isMonster) {
      e.rotation.z = s * 0.28; // slanted: angry
      part(box(0.05, 0.06, 0.02), pupilMat, s * 0.02, 0, 0.025, e).castShadow = false;
      // heavy brow
      const brow = part(box(0.2, 0.06, 0.06), dark, s * 0.15, eyeY + 0.1, headS / 2 + 0.02, head);
      brow.rotation.z = s * 0.45; brow.castShadow = false;
    }
    return e;
  });
  let eyeGlow = null;
  if (isMonster) {
    eyeGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.42), new THREE.MeshBasicMaterial({ color: 0xff2a1a, map: glowTex(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    eyeGlow.position.set(0, eyeY, headS / 2 + 0.05);
    head.add(eyeGlow);
  }

  if (!isMonster) {
    // hair cap + topknot (sangtu)
    part(box(headS + 0.04, 0.2, headS + 0.04), dark, 0, headS / 2 - 0.06, -0.01, head);
    part(box(headS + 0.04, 0.34, 0.14), dark, 0, 0.05, -headS / 2 - 0.02, head);
    part(box(0.18, 0.2, 0.18), dark, 0, headS / 2 + 0.12, -0.04, head);
    part(box(0.14, 0.05, 0.04), M(0xff9a9a), s(-0.2), -0.12, headS / 2 + 0.01, head).castShadow = false; // blush
    part(box(0.14, 0.05, 0.04), M(0xff9a9a), s(0.2), -0.12, headS / 2 + 0.01, head).castShadow = false;
  } else {
    // two thick curved horns (bone with dark tips), wild hair, a wide fanged mouth
    const bone = M(0xe8dcc0), tip = M(0x3a2a22);
    [-1, 1].forEach((sx) => {
      const h1 = part(box(0.15, 0.22, 0.15), bone, sx * 0.24, headS / 2 + 0.08, 0.02, head);
      h1.rotation.z = -sx * 0.35;
      const h2 = part(box(0.11, 0.2, 0.11), bone, sx * 0.33, headS / 2 + 0.25, 0.0, head);
      h2.rotation.z = -sx * 0.75;
      const h3 = part(box(0.07, 0.13, 0.07), tip, sx * 0.43, headS / 2 + 0.36, -0.02, head);
      h3.rotation.z = -sx * 1.1;
    });
    part(box(headS + 0.08, 0.18, headS * 0.75), dark, 0, headS / 2 - 0.02, -0.12, head);
    part(box(0.18, 0.12, 0.2), dark, 0, headS / 2 + 0.08, -0.22, head); // tuft
    part(box(0.46, 0.17, 0.04), M(0x2a0a0a), 0, -0.18, headS / 2 + 0.01, head).castShadow = false; // open mouth
    [-1, 1].forEach((sx) => {
      part(box(0.07, 0.15, 0.04), white, sx * 0.16, -0.13, headS / 2 + 0.03, head).castShadow = false;  // big upper fangs
      part(box(0.05, 0.08, 0.04), white, sx * 0.06, -0.11, headS / 2 + 0.03, head).castShadow = false;
      part(box(0.05, 0.09, 0.04), white, sx * 0.11, -0.25, headS / 2 + 0.03, head).castShadow = false;  // lower fangs
    });
  }

  // weapon in right hand (arms[1] is +x = character's left when facing +z... pick visually: use arms[0])
  const hand = arms[0];
  const weapon = new THREE.Group();
  weapon.position.set(0, -0.62, 0.02);
  hand.add(weapon);
  if (!isMonster) {
    part(box(0.08, 0.08, 0.95), M(0x8a5a2b), 0, 0, 0.35, weapon);           // handle points forward
    part(box(0.06, 0.34, 0.24), M(0xc7cdd6), 0, 0.12, 0.72, weapon);         // blade up
    part(box(0.07, 0.36, 0.05), M(0xe9eef5), 0, 0.12, 0.84, weapon);
  } else {
    // big spiked club (bangmangi)
    part(box(0.13, 0.13, 0.65), M(0x5a3a1c), 0, 0, 0.32, weapon);
    part(box(0.32, 0.32, 0.6), M(0x7a4a24), 0, 0, 0.86, weapon);
    for (let i = 0; i < 4; i++) {
      part(box(0.42, 0.07, 0.07), M(0xd9d2c0), 0, 0, 0.66 + i * 0.13, weapon);
      part(box(0.07, 0.42, 0.07), M(0xd9d2c0), 0, 0, 0.72 + i * 0.13, weapon);
    }
  }

  function s(v) { return v; }

  return {
    root, spin, body, legs, arms, head, torso, eyes, weapon, mats, eyeMat, eyeGlow,
    phase: 0, amp: 0, flash: 0, baseEmissive: 0x000000,
    isMonster,
  };
}

const ease = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Procedural animation.
 * st: { dist (metres moved this frame), speedRatio 0..1, attack (-1 or 0..1), roll (-1 or 0..1), windup (0..1 monster), time }
 */
export function animateCharacter(rig, st, dt) {
  // walk amplitude follows actual speed so legs settle when stopping
  rig.amp += (st.speedRatio - rig.amp) * Math.min(1, dt * 12);
  rig.phase += st.dist * tune.stride;
  const a = rig.amp;
  const sw = Math.sin(rig.phase) * tune.swing * a;

  const [legL, legR] = rig.legs;
  const [armR, armL] = rig.arms; // arms[0] holds the weapon
  legL.rotation.x = sw;
  legR.rotation.x = -sw;
  armL.rotation.x = -sw * 0.9;
  armR.rotation.x = sw * 0.9 * (st.attack >= 0 ? 0 : 1);
  armL.rotation.z = 0; armR.rotation.z = 0;

  const breathe = Math.sin(st.time * 2.4) * 0.012 * (1 - a);
  rig.body.position.y = -0.95 + Math.abs(Math.sin(rig.phase)) * tune.bob * a + breathe;
  rig.body.rotation.y = 0;
  rig.spin.rotation.x = tune.lean * a + (rig.isMonster ? 0.16 + 0.1 * a : 0); // monsters stoop forward
  rig.spin.rotation.z = 0;
  rig.head.rotation.x = rig.isMonster ? -0.18 : 0; // ...but keep glaring ahead
  rig.head.rotation.y = 0;
  armL.rotation.z = -0.06 - (1 - a) * Math.sin(st.time * 2.4) * 0.03;
  armR.rotation.z = 0.06;

  // attack: windup over head → chop down → recover
  if (st.attack >= 0) {
    const t = st.attack;
    let ang;
    if (t < 0.38) ang = lerp(0, -2.7, ease(t / 0.38));
    else if (t < 0.55) ang = lerp(-2.7, -0.7, ease((t - 0.38) / 0.17));
    else ang = lerp(-0.7, 0, ease((t - 0.55) / 0.45));
    armR.rotation.x = ang;
    const twist = t < 0.38 ? lerp(0, 0.35, ease(t / 0.38)) : lerp(0.35, -0.15, ease(Math.min(1, (t - 0.38) / 0.3)));
    rig.body.rotation.y = twist;
    rig.spin.rotation.x += t > 0.38 && t < 0.7 ? 0.18 : 0;
    armL.rotation.x = -0.4 * Math.sin(Math.PI * t);
  }

  // monster windup: raise club high, shake
  if (st.windup > 0) {
    const t = Math.min(1, st.windup);
    armR.rotation.x = lerp(0, -2.9, ease(t));
    rig.body.rotation.y = 0.3 * t;
    rig.spin.rotation.x = -0.12 * t;
    rig.spin.rotation.z = Math.sin(st.time * 40) * 0.04 * t;
  }

  // roll: forward somersault with tucked limbs
  if (st.roll >= 0) {
    const t = st.roll;
    rig.spin.rotation.x = ease(t) * Math.PI * 2;
    const tuck = Math.sin(Math.PI * t);
    legL.rotation.x = legR.rotation.x = -1.3 * tuck;
    armL.rotation.x = armR.rotation.x = -1.6 * tuck;
    rig.body.position.y = -0.95 + 0.25 * tuck;
  }

  // squash on hit
  const sq = rig.flash > 0 ? rig.flash * 0.25 : 0;
  rig.body.scale.set(1 + sq * 0.4, 1 - sq * 0.5, 1 + sq * 0.4);

  // hurt flash
  if (rig.flash > 0) {
    rig.flash = Math.max(0, rig.flash - dt * 3.5);
  }
  const f = rig.flash;
  for (const m of rig.mats) m.emissive.setRGB(f * 0.9, f * 0.15, f * 0.1);
}

export function flash(rig, amount = 1) {
  rig.flash = amount;
}
