// The player at a stand: health, dodge (a short window on Space = a sideways flick of the phone, with a
// cooldown) and duck (keyboard only: no attack needs it any more, the phone has no duck)
// Attacks are resolved here so every species follows the same rules. Pure.
(function (root) {
  'use strict';
  const DODGE_WINDOW = 0.7, DODGE_COOLDOWN = 1.0; // a phone flick lands a little late: be generous
  function create() { return { hp: 100, maxHp: 100, ducking: false, dodgeT: 0, dodgeReadyAt: 0, dodgeDir: 1 }; }
  /** Start a dodge at time now (s). False if still cooling down. */
  function dodge(p, now) {
    if (now < p.dodgeReadyAt) return false;
    p.dodgeT = DODGE_WINDOW; p.dodgeReadyAt = now + DODGE_COOLDOWN; p.dodgeDir = -p.dodgeDir;
    return true;
  }
  function tick(p, dt) { p.dodgeT = Math.max(0, p.dodgeT - dt); }
  /** strike: { damage, dodgeable, duckable } -> { result: 'hit'|'dodged'|'ducked', dead } */
  function strike(p, s) {
    if (s.dodgeable && p.dodgeT > 0) return { result: 'dodged', dead: false };
    if (s.duckable && p.ducking) return { result: 'ducked', dead: false };
    p.hp = Math.max(0, p.hp - (s.damage || 0));
    return { result: 'hit', dead: p.hp <= 0 };
  }
  function heal(p, n) { p.hp = Math.min(p.maxHp, p.hp + n); }
  const api = { create, dodge, tick, strike, heal, DODGE_WINDOW, DODGE_COOLDOWN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.DH = root.DH || {}; root.DH.Player = api; }
})(typeof window !== 'undefined' ? window : this);
