/*
 * Duskwater - game rules: weapons, recoil patterns, spread, damage, economy, round outcomes.
 * Pure data and math, no three.js. Classic script: window.ArenaRules. Node: module.exports.
 */
(function (root) {
  'use strict';

  /*
   * Recoil patterns: per-shot kick in degrees (pitch up, yaw + = left). Shot 0 is clean; the
   * camera receives each kick, so the player pulls against it. After the table runs out the
   * last `loop` entries repeat.
   */
  const PATTERNS = {
    tern:     { kicks: [[1.6, 0.1], [1.4, -0.3], [1.5, 0.35], [1.3, -0.2]], loop: 4 },
    skiff:    { kicks: [[0.32, 0], [0.36, 0.04], [0.4, -0.05], [0.42, 0.06], [0.42, 0.1], [0.38, 0.12], [0.3, 0.14], [0.25, -0.1],
                        [0.22, -0.2], [0.2, -0.22], [0.2, -0.18], [0.18, 0.1], [0.18, 0.22], [0.16, 0.24], [0.16, 0.2], [0.15, -0.15]], loop: 8 },
    breaker:  { kicks: [[0.45, 0], [0.6, 0.02], [0.75, -0.03], [0.85, 0.02], [0.85, -0.05], [0.8, 0.08], [0.7, 0.12], [0.55, 0.2],
                        [0.4, 0.38], [0.28, 0.42], [0.2, 0.4], [0.15, 0.3], [0.12, -0.2], [0.12, -0.45], [0.1, -0.5], [0.1, -0.5],
                        [0.1, -0.42], [0.12, -0.2], [0.1, 0.3], [0.1, 0.45], [0.1, 0.42], [0.1, 0.2], [0.1, -0.3], [0.1, -0.4]], loop: 8 },
    longline: { kicks: [[3.2, 0.3]], loop: 1 },
  };

  const WEAPONS = {
    tern: {
      id: 'tern', name: 'Tern', kind: 'Sidearm', slot: 'sidearm', price: 0, killReward: 300,
      damage: 31, headMult: 3.6, legMult: 0.75, pen: 0.52, rangeMod: 0.88,
      rpm: 380, auto: false, mag: 12, reserve: 48, reload: 1.75, draw: 0.35,
      spread: 0.35, moveSpread: 1.8, airSpread: 5, burstSpread: 0.6, burstMax: 3, recovery: 7,
      speedMult: 1.0, zoom: 1, sound: 'tern', tracer: 0xffd9a0,
    },
    skiff: {
      id: 'skiff', name: 'Skiff', kind: 'Compact SMG', slot: 'primary', price: 1300, killReward: 550,
      damage: 25, headMult: 2.9, legMult: 0.75, pen: 0.6, rangeMod: 0.82,
      rpm: 840, auto: true, mag: 30, reserve: 120, reload: 2.1, draw: 0.45,
      spread: 0.55, moveSpread: 1.0, airSpread: 4, burstSpread: 0.12, burstMax: 1.6, recovery: 9,
      speedMult: 0.97, zoom: 1, sound: 'skiff', tracer: 0xffe2b0,
    },
    breaker: {
      id: 'breaker', name: 'Breaker', kind: 'Rifle', slot: 'primary', price: 2700, killReward: 300,
      damage: 34, headMult: 4, legMult: 0.75, pen: 0.78, rangeMod: 0.98,
      rpm: 620, auto: true, mag: 30, reserve: 90, reload: 2.45, draw: 0.6,
      spread: 0.22, moveSpread: 3.2, airSpread: 7, burstSpread: 0.16, burstMax: 2.2, recovery: 6,
      speedMult: 0.9, zoom: 1.25, sound: 'breaker', tracer: 0xffd090,
    },
    longline: {
      id: 'longline', name: 'Longline', kind: 'Precision rifle', slot: 'primary', price: 4400, killReward: 150,
      damage: 112, headMult: 2.6, legMult: 0.8, pen: 0.96, rangeMod: 0.99,
      rpm: 44, auto: false, mag: 5, reserve: 20, reload: 3.3, draw: 0.8,
      spread: 4.5, scopedSpread: 0.03, moveSpread: 6, airSpread: 10, burstSpread: 0, burstMax: 0, recovery: 4,
      speedMult: 0.82, zoom: 4, sound: 'longline', tracer: 0xfff0d0,
    },
  };

  const ARMOUR = { price: 650, amount: 100 };
  // the losing side can afford an SMG and armour, or a rifle, the very next round: no snowballing bots
  const ECONOMY = { start: 800, max: 9000, win: 3000, lossBase: 1900, lossStep: 500, lossMax: 3400, survivorBonus: 0 };
  const ROUND = { buyTime: 9, liveTime: 105, postTime: 4.5 };

  function recoilKick(id, i) {
    const p = PATTERNS[id];
    if (!p) return { pitch: 0, yaw: 0 };
    const k = p.kicks;
    const idx = i < k.length ? i : k.length - p.loop + ((i - k.length) % p.loop);
    return { pitch: k[idx][0], yaw: k[idx][1] };
  }

  /** Total recoil (degrees) accumulated before shot i of an uninterrupted spray. */
  function recoilOffset(id, i) {
    let pitch = 0, yaw = 0;
    for (let s = 0; s < i; s++) { const k = recoilKick(id, s); pitch += k.pitch; yaw += k.yaw; }
    return { pitch, yaw };
  }

  /** Cone half-angle in degrees for the next shot. st: { speed, airborne, crouched, shotsInBurst, scoped } */
  function spreadFor(w, st) {
    let s = (st.scoped && w.scopedSpread != null) ? w.scopedSpread : w.spread;
    const run = Math.min(1.2, (st.speed || 0) / 5);
    s += w.moveSpread * (run > 0.3 ? run : run * 0.3);
    if (st.airborne) s += w.airSpread;
    s += Math.min(w.burstMax, (st.shotsInBurst || 0) * w.burstSpread);
    if (st.crouched) s *= 0.72;
    return s;
  }

  /** Damage to a target. zone: 'head' | 'body' | 'legs'. Returns { health, armor } to subtract. */
  function computeDamage(w, zone, dist, armor) {
    const mult = zone === 'head' ? w.headMult : zone === 'legs' ? w.legMult : 1;
    const dmg = w.damage * mult * Math.pow(w.rangeMod, Math.max(0, dist - 10) / 10) // full damage inside 10 m;
    if (!armor || armor <= 0 || zone === 'legs') return { health: dmg, armor: 0 };
    let health = dmg * w.pen;
    const wanted = (dmg - health) * 0.5;
    const taken = Math.min(armor, wanted);
    health += (wanted - taken) * 2;
    return { health, armor: taken };
  }

  const fireInterval = w => 60 / w.rpm;
  const clampMoney = m => Math.max(0, Math.min(ECONOMY.max, Math.round(m)));
  const killReward = id => WEAPONS[id] ? WEAPONS[id].killReward : 300;
  function roundReward(won, lossStreak) {
    if (won) return ECONOMY.win;
    return Math.min(ECONOMY.lossMax, ECONOMY.lossBase + ECONOMY.lossStep * Math.max(0, lossStreak));
  }

  /** Round timer ran out: more players standing wins, then more total health, then team 0 holds. */
  function timeoutWinner(a, b) {
    if (a.alive !== b.alive) return a.alive > b.alive ? 0 : 1;
    if (a.hp !== b.hp) return a.hp > b.hp ? 0 : 1;
    return 0;
  }

  const api = { WEAPONS, PATTERNS, ARMOUR, ECONOMY, ROUND, recoilKick, recoilOffset, spreadFor, computeDamage, fireInterval, clampMoney, killReward, roundReward, timeoutWinner };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArenaRules = api;
})(typeof window !== 'undefined' ? window : this);
