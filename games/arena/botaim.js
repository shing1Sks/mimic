/*
 * Duskwater - how bots see, react and aim, per difficulty. Pure math (no three.js): actors.js runs
 * the bot brain with it, test/botaim.test.js measures it (reaction times, turn speeds, and a
 * simulated time-to-kill against a standing and a strafing target).
 *
 * The model, in human terms:
 *  - Seeing you is not reacting to you: a reaction delay that grows when you are at the edge of
 *    their view or far away, and shrinks a little when they already heard you.
 *  - Aim starts off by an error that settles toward a floor, never to zero. The floor rises with
 *    how fast you cross their view (tracking lag) and while they move themselves.
 *  - Every shot kicks their aim off again (recoil they have to fight), so a long spray drifts.
 *  - Turning has a top speed and has to wind up: no instant 180s.
 *  - They fire when roughly on target, so they do miss, and pause between bursts.
 *  - Recruit is tuned to lose to a first-time phone Pad player who plays sensibly; Veteran is hard.
 *
 * Classic script: window.ArenaBotAim. Node: module.exports.
 */
(function (root) {
  'use strict';
  const DEG = Math.PI / 180;

  /*
   * reaction: base seconds from seeing to shooting (x rand 0.85..1.3); edge: extra at the edge of
   * view; initErr / errFloor: aim error in degrees at first sight and at best; errDecay: how fast
   * it settles (1/s); lag: seconds of tracking lag (error floor grows by the target's angular speed
   * times this); moveErr: extra floor while the bot itself moves; kick: share of the weapon's recoil
   * kick per shot it fails to hold down; turn: top turn speed (rad/s); turnAccel: how fast that speed winds up (1/s);
   * fireTol: how far off target (x the target's angular size + floor) it still pulls the trigger;
   * spreadMult: weapon spread vs a player's; dmgMult: damage dealt to players (bots vs bots: 1);
   * spot: sight range (m); fov: half-angle of the view cone (rad); near: all-round awareness (m);
   * hear: hearing range for gunfire (m); headAim: chance to go for the head; hunt: seconds left
   * in the round when it starts hunting; longHold: share of the aim floor left at 40 m and beyond
   * (a marksman holds steadier on a far target; 1 = no better at range).
   */
  const DIFF = {
    recruit: {
      label: 'Recruit', blurb: 'easy', reaction: 0.85, edge: 0.35, initErr: 10, errFloor: 1.15, errDecay: 1.5, lag: 0.12, moveErr: 1.5, kick: 0.45,
      turn: 2.6, turnAccel: 5, fireTol: 2.4, spreadMult: 1.15, dmgMult: 0.8, burst: [2, 4], pause: [0.6, 1.1], strafe: 0.15, crouch: 0.1,
      spot: 42, fov: 0.95, near: 2.5, hear: 18, headAim: 0.04, hunt: 30, rifleBuy: 0.5, longline: 0, longHold: 1,
    },
    regular: {
      label: 'Regular', blurb: 'fair', reaction: 0.6, edge: 0.25, initErr: 7.5, errFloor: 0.75, errDecay: 2.0, lag: 0.09, moveErr: 0.9, kick: 0.3,
      turn: 4.0, turnAccel: 8, fireTol: 2.0, spreadMult: 1.1, dmgMult: 0.85, burst: [2, 5], pause: [0.4, 0.75], strafe: 0.4, crouch: 0.2,
      spot: 56, fov: 1.1, near: 3, hear: 26, headAim: 0.12, hunt: 40, rifleBuy: 0.85, longline: 0.1, longHold: 1,
    },
    veteran: {
      label: 'Veteran', blurb: 'hard', reaction: 0.4, edge: 0.18, initErr: 6, errFloor: 0.4, errDecay: 2.7, lag: 0.055, moveErr: 0.5, kick: 0.2,
      turn: 6.0, turnAccel: 12, fireTol: 1.8, spreadMult: 1.0, dmgMult: 1, burst: [2, 4], pause: [0.22, 0.45], strafe: 0.75, crouch: 0.3,
      spot: 72, fov: 1.25, near: 3.5, hear: 34, headAim: 0.3, hunt: 50, rifleBuy: 1, longline: 0.25, longHold: 0.6,
    },
  };
  const ORDER = ['recruit', 'regular', 'veteran'];
  const get = name => DIFF[name] || DIFF.recruit;

  /** Seconds from first sight to the first shot. o: { dist, angle (rad off their facing), warned }. rnd() in [0, 1). */
  function reactionTime(d, o, rnd) {
    let t = d.reaction * (0.85 + 0.45 * rnd());
    t += d.edge * Math.min(1, Math.max(0, (o.angle || 0) - 0.35) / 0.6);  // seen out of the corner of the eye
    if (o.dist > 30) t += 0.15 * Math.min(1, (o.dist - 30) / 25);       // far away: a small figure to make out
    if (o.warned) t *= 0.8;                                             // heard you there a moment ago
    return t;
  }

  /** Aim error (degrees) the moment a target is picked up. */
  function initialError(d, o, rnd) {
    return d.initErr * (0.75 + 0.5 * rnd()) * (o.dist > 30 ? 1.2 : 1);
  }

  /** The best the bot can do right now (degrees). o: { angVel (target across their view, deg/s), moving (bot), dist }. */
  function errorFloor(d, o) {
    const far = Math.min(1, Math.max(0, ((o.dist || 0) - 20) / 20)), hold = 1 - (1 - (d.longHold || 1)) * far;
    return d.errFloor * hold + Math.abs(o.angVel || 0) * d.lag + (o.moving ? d.moveErr : 0);
  }

  /** Error settles toward the floor from above, creeps back up to it from below. */
  function errorStep(mag, d, dt, o) {
    const f = errorFloor(d, o);
    if (mag > f) return f + (mag - f) * Math.exp(-d.errDecay * dt);
    return mag + (f - mag) * (1 - Math.exp(-3 * dt));
  }

  /** Angle off the target still worth a shot (radians), at distance dist. */
  function fireTolerance(d, dist) {
    return (Math.atan2(0.45, Math.max(1, dist)) + d.errFloor * DEG) * d.fireTol;
  }

  const wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  /**
   * Turn toward a heading with a top speed that has to wind up. st: { yaw, rate } (rate in rad/s,
   * kept between calls). engaged: full speed in a fight, 60% when just looking around.
   */
  function turnStep(st, want, dt, d, engaged) {
    const top = d.turn * (engaged ? 1 : 0.6);
    const diff = wrap(want - st.yaw);
    // the speed it would like: proportional near the target (no overshoot), capped at the top
    const desired = Math.max(-top, Math.min(top, diff * 8));
    st.rate += (desired - st.rate) * Math.min(1, d.turnAccel * dt);
    let step = st.rate * dt;
    if (Math.abs(step) > Math.abs(diff)) { step = diff; st.rate *= 0.5; }
    st.yaw = wrap(st.yaw + step);
    return st.yaw;
  }

  /** Is a target inside what the bot can notice? o: { dist, angle, tracking (already fighting it) }. */
  function canNotice(d, o) {
    if (o.dist > d.spot) return false;
    if (o.dist <= d.near) return true;
    return o.angle <= (o.tracking ? d.fov + 0.6 : d.fov);
  }

  /** A position it only heard: off by more the further away it was (m). */
  function heardJitter(dist, rnd) { const r = Math.min(4, 0.6 + dist * 0.1) * rnd(), a = rnd() * Math.PI * 2; return { x: Math.cos(a) * r, z: Math.sin(a) * r }; }

  const api = { DIFF, ORDER, DEG, get, reactionTime, initialError, errorFloor, errorStep, fireTolerance, turnStep, canNotice, heardJitter, wrap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArenaBotAim = api;
})(typeof window !== 'undefined' ? window : this);
