/*
 * Iron Ludus - combat rules. Pure logic, no three.js, no DOM: runs in Node tests too
 * (node games/gladiator/test/combat.test.js). Classic script: defines window.LudusCombat.
 *
 * Conventions
 *   Screen "view units": x = NDC x * aspect, y = NDC y (so angles on screen are true angles).
 *   A strike or cut "from" a side is where it starts on the player's screen:
 *     'left' | 'right' | 'high' | 'low' | 'thrust' (straight at you / straight at them).
 *   Times in milliseconds unless named otherwise.
 */
(function (root) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ------------------------------------------------------------------ rng */
  function rng(seed) { // mulberry32
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const between = (r, ab) => ab[0] + (ab[1] - ab[0]) * r();
  function pickWeighted(r, weights) {
    const keys = Object.keys(weights);
    let sum = 0; for (const k of keys) sum += weights[k];
    let x = r() * sum;
    for (const k of keys) { x -= weights[k]; if (x <= 0) return k; }
    return keys[keys.length - 1];
  }

  /* --------------------------------------------------------------- swings */
  // rushMs: a swing started this soon after the last one ended has no chamber and is weaker.
  // reverseMs: after this long, snapping the blade back the other way ends the cut (a waggle is
  // a string of short rushed cuts, not one long swing).
  const SWING = { start: 5, end: 2.5, endHoldMs: 40, maxMs: 900, rushMs: 320, reverseMs: 60, waggleMul: 0.22 };
  /**
   * Peak rotation speed (rad/s) -> power. 4.5 rad/s is nothing, 13 is a full swing, capped 1.25.
   * Tuned on a recorded phone session: deliberate cuts peaked at 8-14 rad/s (median 8, p90 14).
   */
  function swingPower(peak) { return clamp((peak - 4.5) / 8.5, 0, 1.25); }
  const TIRED = 30;
  /**
   * The power a cut really carries. o = { sinceLastMs (since your previous swing ended), stamina }.
   * Rushed swings (no time to chamber) and tired arms both bleed power.
   */
  function effectivePower(power, o) {
    let p = power;
    if (o && o.sinceLastMs !== undefined && o.sinceLastMs < SWING.rushMs) p *= 0.35 + 0.65 * Math.max(0, o.sinceLastMs) / SWING.rushMs;
    // a waggle: the third (and every further) swing in a row with no chamber between is flailing, not cutting.
    // Judged on the blade's own motion (swing ends/starts), so it holds whatever drives the blade:
    // a phone at full rotation speed made rushed waggles still bite (power capped 1.25 x 0.35 > glance).
    if (o && o.chain >= 2) p *= SWING.waggleMul;
    const s = o && o.stamina !== undefined ? o.stamina : 100;
    if (s < TIRED) p *= 0.35 + 0.65 * Math.max(0, s) / TIRED;
    return p;
  }
  function dirName(m) {
    return Math.abs(m.x) >= Math.abs(m.y) ? (m.x >= 0 ? 'right' : 'left') : (m.y >= 0 ? 'up' : 'down');
  }
  /** Motion direction -> the side the cut comes from. */
  function cutFrom(dir) { return { right: 'left', left: 'right', up: 'low', down: 'high' }[dir] || 'thrust'; }

  function swingTracker() {
    return { active: false, id: 0, startT: 0, peak: 0, power: 0, startTip: null, lastTip: null,
      motion: { x: 0, y: 0 }, dir: null, from: null, slowSince: -1, hit: false, endT: -1e9, prevEndT: -1e9, reversed: false, chain: 0 };
  }
  /**
   * Feed one frame: { t (ms), speed (rad/s), tip ({x,y} view units) }.
   * Returns 'start' | 'end' | null. While active, tr.dir/from/power describe the cut so far.
   */
  function swingStep(tr, f) {
    if (!tr.active) {
      tr.lastTip = f.tip;
      if (f.speed > SWING.start) {
        tr.active = true; tr.id++; tr.startT = f.t; tr.peak = f.speed; tr.hit = false; tr.reversed = false;
        tr.startTip = f.tip; tr.motion = { x: 0, y: 0 }; tr.dir = null; tr.from = null; tr.slowSince = -1;
        tr.prevEndT = tr.endT;
        tr.chain = f.t - tr.endT < SWING.rushMs ? (tr.chain || 0) + 1 : 0;   // swings in a row with no chamber
        tr.power = swingPower(tr.peak);
        return 'start';
      }
      return null;
    }
    tr.peak = Math.max(tr.peak, f.speed);
    tr.power = swingPower(tr.peak);
    const step = { x: f.tip.x - tr.lastTip.x, y: f.tip.y - tr.lastTip.y };
    const m = tr.motion, mLen = Math.hypot(m.x, m.y), sLen = Math.hypot(step.x, step.y);
    tr.lastTip = f.tip;
    // the blade snapped back against the cut: that cut is over
    if (f.t - tr.startT >= SWING.reverseMs && mLen > 0.1 && sLen > 0.05 && (m.x * step.x + m.y * step.y) / (mLen * sLen) < -0.5) {
      tr.active = false; tr.endT = f.t; tr.reversed = true;
      return 'end';
    }
    tr.motion = { x: f.tip.x - tr.startTip.x, y: f.tip.y - tr.startTip.y };
    if (Math.hypot(tr.motion.x, tr.motion.y) > 0.02) { tr.dir = dirName(tr.motion); tr.from = cutFrom(tr.dir); }
    if (f.speed < SWING.end) { if (tr.slowSince < 0) tr.slowSince = f.t; }
    else tr.slowSince = -1;
    if ((tr.slowSince >= 0 && f.t - tr.slowSince >= SWING.endHoldMs) || f.t - tr.startT > SWING.maxMs) {
      tr.active = false; tr.endT = f.t;
      return 'end';
    }
    return null;
  }

  /* ---------------------------------------------------------- cut result */
  const GLANCE_POWER = 0.2;   // below this a cut only scratches (rushed, tired or lazy)
  const ZONE_MUL = { head: 1.5, torso: 1, body: 1, arm: 0.7, legs: 0.8 };
  /**
   * The player's cut (or thrust, from = 'thrust') lands on the opponent.
   * o = { power, from, zone: 'head'|'torso'|'arm'|'legs' ('body' = torso), align (0..1: 1 = the edge
   *   travels square to the blade, 0 = the blade slides along its own length),
   *   enemy: { guard, state, armor? (hide: min power), zoneArmor? {zone: 0..1}, evade? }, exhausted?, rng? }
   * Returns { result: 'hit'|'blocked'|'glance'|'armor'|'evaded', damage, poise, stagger, counter }.
   */
  function resolveCut(o) {
    const e = o.enemy, p = o.power;
    const out = { result: 'hit', damage: 0, poise: 0, stagger: false, counter: false };
    if (p < GLANCE_POWER) { out.result = 'glance'; out.damage = 1; return out; }
    const align = o.align === undefined ? 1 : o.align;
    if (align < 0.25) { out.result = 'glance'; out.damage = 1; return out; }
    if (e.evade && e.state === 'idle' && (o.rng || Math.random)() < e.evade) { out.result = 'evaded'; return out; }
    const guarded = e.state === 'idle' && e.guard &&
      ((e.guard === 'all' && o.from !== 'thrust') || e.guard === o.from);
    if (guarded) { out.result = 'blocked'; out.poise = Math.round(10 + 25 * p); return out; }
    let dmg = (4 + 18 * p) * (ZONE_MUL[o.zone] || 1) * (0.5 + 0.5 * align);
    if (o.from === 'thrust') dmg *= 0.9;
    if (e.state === 'windup') { out.counter = true; dmg *= 1.15; }
    if (e.state === 'stagger') dmg *= 1.3;
    if (e.armor && p < e.armor) dmg *= 0.25;
    if (o.exhausted) dmg *= 0.4;
    const za = e.zoneArmor && e.zoneArmor[o.zone === 'body' ? 'torso' : o.zone];
    if (za) {
      if (p < 0.55) { out.result = 'armor'; out.damage = Math.max(1, Math.round(dmg * 0.15)); return out; }
      dmg *= 1 - za * 0.6;
    }
    out.damage = Math.round(dmg);
    out.stagger = out.counter ? p >= 0.45 : p >= 0.9;
    return out;
  }

  /* ---------------------------------------------------------- guard zones */
  // rectangles in view units, plus what the drawn blade must look like to stop that strike
  const GUARD_ZONES = {
    left:   { cx: -0.72, cy: 0.1, hw: 0.53, hh: 0.7, steep: 0.55, tipX: -0.3 },     // side strikes: blade at least ~29deg from flat
    right:  { cx: 0.72, cy: 0.1, hw: 0.53, hh: 0.7, steep: 0.55, tipX: 0.3 }, // tip must reach out to that side
    high:   { cx: 0, cy: 0.6, hw: 0.8, hh: 0.4, flat: 0.4, tipAbove: 0.3 }, // overheads: raised, at most ~68deg from flat
    low:    { cx: 0, cy: -0.625, hw: 0.8, hh: 0.375, tipBelow: 0.0 },    // low strikes: blade pointing down/low
    thrust: { cx: 0, cy: -0.025, hw: 0.45, hh: 0.475, tipInside: true }, // thrusts: point in line with them
  };
  function clip2D(px, py, dx, dy, r) { // segment p + d*t, t in [0,1] vs rect: true if it touches
    let t0 = 0, t1 = 1;
    const o = [px - r.cx, py - r.cy], d = [dx, dy], h = [r.hw, r.hh];
    for (let a = 0; a < 2; a++) {
      if (Math.abs(d[a]) < 1e-12) { if (Math.abs(o[a]) > h[a]) return false; continue; }
      let ta = (-h[a] - o[a]) / d[a], tb = (h[a] - o[a]) / d[a];
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
    return true;
  }
  /**
   * Did the drawn blade sweep over a screen rectangle this frame? a0-b0 is the cutting part last
   * frame, a1-b1 now (view units); rect = { cx, cy, hw, hh }. Returns { hit, f, point }.
   */
  function screenSweepHits(a0, b0, a1, b1, rect) {
    const move = Math.max(Math.hypot(a1.x - a0.x, a1.y - a0.y), Math.hypot(b1.x - b0.x, b1.y - b0.y));
    const step = Math.max(1e-4, Math.min(rect.hw, rect.hh) * 0.5);
    const K = Math.max(1, Math.min(256, Math.ceil(move / step)));
    for (let k = 0; k <= K; k++) {
      const f = k / K;
      const ax = a0.x + (a1.x - a0.x) * f, ay = a0.y + (a1.y - a0.y) * f;
      const bx = b0.x + (b1.x - b0.x) * f, by = b0.y + (b1.y - b0.y) * f;
      if (clip2D(ax, ay, bx - ax, by - ay, rect)) {
        // contact point: the blade point nearest the rectangle centre
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
        const u = clamp(((rect.cx - ax) * dx + (rect.cy - ay) * dy) / L2, 0, 1);
        return { hit: true, f, point: { x: ax + dx * u, y: ay + dy * u } };
      }
    }
    return { hit: false };
  }
  /** Where two segments p1-p2 and q1-q2 cross (with a little blade thickness), or null. */
  function segCross(p1, p2, q1, q2, thick) {
    const rx = p2.x - p1.x, ry = p2.y - p1.y, sx = q2.x - q1.x, sy = q2.y - q1.y;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) > 1e-9) {
      const qpx = q1.x - p1.x, qpy = q1.y - p1.y;
      const t = (qpx * sy - qpy * sx) / den, u = (qpx * ry - qpy * rx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { x: p1.x + rx * t, y: p1.y + ry * t };
    }
    if (!thick) return null;
    // near miss within the blades' thickness: closest endpoint distance
    const near = (a, b1, b2) => {
      const dx = b2.x - b1.x, dy = b2.y - b1.y, L2 = dx * dx + dy * dy || 1;
      const u = clamp(((a.x - b1.x) * dx + (a.y - b1.y) * dy) / L2, 0, 1);
      const x = b1.x + dx * u, y = b1.y + dy * u;
      return { d: Math.hypot(a.x - x, a.y - y), x, y };
    };
    let best = null;
    for (const c of [near(p1, q1, q2), near(p2, q1, q2), near(q1, p1, p2), near(q2, p1, p2)]) if (!best || c.d < best.d) best = c;
    return best.d <= thick ? { x: best.x, y: best.y } : null;
  }
  /**
   * Blade against blade on screen this frame: yours moved a0-b0 -> a1-b1, his c0-d0 -> c1-d1.
   * Returns { hit, f (0..1 through the frame), point }.
   */
  function bladesCross(a0, b0, a1, b1, c0, d0, c1, d1, thick) {
    const th = thick === undefined ? 0.02 : thick;
    const move = Math.max(Math.hypot(a1.x - a0.x, a1.y - a0.y), Math.hypot(b1.x - b0.x, b1.y - b0.y),
      Math.hypot(c1.x - c0.x, c1.y - c0.y), Math.hypot(d1.x - d0.x, d1.y - d0.y));
    const K = Math.max(1, Math.min(128, Math.ceil(move / 0.025)));
    const L = (p, q, f) => ({ x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f });
    for (let k = 0; k <= K; k++) {
      const f = k / K;
      const pt = segCross(L(a0, a1, f), L(b0, b1, f), L(c0, c1, f), L(d0, d1, f), th);
      if (pt) return { hit: true, f, point: pt };
    }
    return { hit: false };
  }
  /** Does the drawn blade { h: hilt, t: tip } (view units) stop a strike from `dir`? */
  function guardCovers(blade, dir) {
    const z = GUARD_ZONES[dir];
    if (!z) return false;
    const dx = blade.t.x - blade.h.x, dy = blade.t.y - blade.h.y;
    if (z.steep && Math.abs(dy) < z.steep * Math.abs(dx)) return false;
    if (z.flat && Math.abs(dx) < z.flat * Math.abs(dy)) return false;
    if (z.tipBelow !== undefined && blade.t.y > z.tipBelow) return false;
    if (z.tipAbove !== undefined && blade.t.y < z.tipAbove) return false;
    if (z.tipX !== undefined && (z.tipX < 0 ? blade.t.x > z.tipX : blade.t.x < z.tipX)) return false;
    if (z.tipInside) return Math.abs(blade.t.x - z.cx) <= z.hw && Math.abs(blade.t.y - z.cy) <= z.hh;
    // the cutting part of the blade: from a quarter of the way up to the tip
    const sx = blade.h.x + dx * 0.25, sy = blade.h.y + dy * 0.25;
    return clip2D(sx, sy, blade.t.x - sx, blade.t.y - sy, z);
  }
  /**
   * What the opponent sees coming: the side your drawn blade is chambered on, relative to their
   * body on screen (or the side of the swing already in flight).
   */
  function threatFrom(blade, body, swingFrom) {
    if (swingFrom) return swingFrom;
    const dx = blade.t.x - body.cx, dy = blade.t.y - body.cy;
    if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) return 'thrust';
    if (dy > 0.35 && dy > Math.abs(dx) * 0.8) return 'high';
    if (dy < -0.35 && -dy > Math.abs(dx)) return 'low';
    return dx < 0 ? 'left' : 'right';
  }

  /* ------------------------------------------------------------- defence */
  const STAMINA_MAX = 100;
  /** Every swing is paid for, a full one heavily: flailing empties you in five or six swings. */
  function swingCost(power) { return 7 + 12 * clamp(power, 0, 1.25); }
  const THRUST_COST = 12, DODGE_COST = 18, SHIELD_DRAIN = 9, REGEN = 30, REGEN_DELAY = 0.6, WHIFF_COST = 8;
  function blockCost(damage) { return 8 + damage * 1.0; }
  /**
   * An opponent's strike arrives. o = {
   *   attack: { dir, heavy, damage }, coverFor: ms the blade has covered the zone (-1 = not covering),
   *   swingInto: the player is swinging at impact, shieldFor: ms the shield has been up (-1/undefined = down),
   *   dodging, stamina, parryWindow, overextended (just whiffed: can block but not parry) }
   * Returns { result: 'parry'|'block'|'guardbreak'|'dodged'|'hit', damage, staminaCost }.
   */
  function resolveDefense(o) {
    const a = o.attack, win = o.parryWindow;
    const cover = o.coverFor !== undefined && o.coverFor >= 0;
    const shield = o.shieldFor !== undefined && o.shieldFor >= 0;
    if (o.dodging) return { result: 'dodged', damage: 0, staminaCost: 0 };
    const parry = !o.overextended && ((cover && (o.coverFor <= win || o.swingInto)) || (shield && o.shieldFor <= win));
    if (parry) return { result: 'parry', damage: 0, staminaCost: 0 };
    if (!cover && !shield) return { result: 'hit', damage: a.damage, staminaCost: 0 };
    const cost = blockCost(a.damage) * (shield ? 0.7 : 1);
    if (a.heavy || o.stamina < cost) return { result: 'guardbreak', damage: Math.round(a.damage * 0.5), staminaCost: Math.min(o.stamina, cost) };
    return { result: 'block', damage: 0, staminaCost: cost };
  }
  /** Stamina over dt seconds. ctx = { sinceSpend (s), shieldUp }. */
  function staminaStep(s, dt, ctx) {
    if (ctx.shieldUp) return Math.max(0, s - SHIELD_DRAIN * dt);
    if (ctx.sinceSpend < REGEN_DELAY) return s;
    return Math.min(STAMINA_MAX, s + REGEN * dt);
  }

  /* --------------------------------------------------------- enemy brain */
  /*
   * The opponent fights like a person with a reaction time:
   *  - its guard follows the side your blade threatens, `react` ms late (a quick feint with the
   *    blade beats a slow reader), and it settles on the side you keep cutting from (`read`);
   *  - it chooses where to strike: away from your blade (`aim`), in combos, with feints;
   *  - it parries predictable cuts, ripostes after blocking (`riposte`), punishes whiffs (`punish`),
   *    follows up after you block (`followUp`), and steps in and out of your reach (`footwork`).
   */
  function createBrain(profile, seed) {
    const r = rng(seed);
    const b = { p: profile, r, state: 'idle', timer: between(r, profile.gap) + 600, elapsed: 0, now: 0,
      attack: null, combo: 0, guard: null, goal: null, goalAt: 0, seen: null, history: [], read: null,
      poise: profile.poise, nextId: 1, dist: 0, distGoal: 0, footT: between(r, [1400, 2600]), stepT: 0 };
    b.guard = b.goal = defaultGuard(b);
    return b;
  }
  const guards = b => b.p.guards || [];
  function defaultGuard(b) {
    const g = guards(b);
    if (!g.length) return null;
    if (b.read && g.includes(b.read)) return b.read;
    if (g.includes('mid')) return 'mid';
    return g[0];
  }
  /** Which guard answers a threat (null threat / thrust: the default stance). */
  function guardFor(b, threat) {
    const g = guards(b);
    if (!g.length) return null;
    if (threat && threat !== 'thrust' && g.includes(threat)) return threat;
    return defaultGuard(b);
  }
  function setGoal(b, want, fast) {
    if (want === b.goal) return;
    const react = between(b.r, b.p.react || [350, 450]) * (fast ? 0.5 : 1);
    b.goal = want; b.goalAt = b.now + react;
  }
  /** Each frame: what the opponent sees of your blade. obs = { threat }. */
  function brainSee(b, obs) {
    const th = (obs && obs.threat) || null;
    if (th === b.seen) return;
    b.seen = th;
    if (b.state === 'dead' || !guards(b).length) return;
    const want = guardFor(b, th);
    if (want === b.goal) return;
    if (b.r() > (b.p.guardSkill === undefined ? 1 : b.p.guardSkill)) return; // he missed that one
    setGoal(b, want, want === b.read);
  }
  /** Remember the sides you cut from: two of the last three from one side and a reader sits on it. */
  function brainNoteCut(b, from) {
    if (!from) return;
    b.history.push(from); if (b.history.length > 4) b.history.shift();
    const last3 = b.history.slice(-3), count = {};
    let side = null;
    for (const s of last3) { count[s] = (count[s] || 0) + 1; if (count[s] >= 2) side = s; }
    b.read = side && b.r() < (b.p.read || 0) ? side : null;
    if (b.read && b.state === 'idle' && guards(b).includes(b.read) && (b.seen === null || b.seen === 'thrust')) setGoal(b, b.read, true);
  }

  function makeAttack(b, chain, notDir) {
    const p = b.p;
    let dirs = Object.assign({}, p.dirs);
    if (notDir && Object.keys(dirs).length > 1) delete dirs[notDir];
    // aim away from the side your blade guards
    if (b.seen && dirs[b.seen] && Object.keys(dirs).length > 1 && b.r() < (p.aim || 0)) delete dirs[b.seen];
    const heavy = b.r() < (p.heavy || 0);
    const base = between(b.r, p.windup);
    const windup = Math.round(chain > 0 ? base * (p.comboWindup || 0.7) : base * (heavy ? 1.15 : 1));
    return { id: b.nextId++, dir: pickWeighted(b.r, dirs), heavy, chain,
      damage: Math.round(p.dmg * (heavy ? (p.heavyMul || 1.8) : 1)), windup,
      feint: chain === 0 && !heavy && b.r() < (p.feint || 0) };
  }
  /** A quick, unfeinted strike: riposte, punish, follow-up. */
  function fastAttack(b, kind, notDir) {
    const a = makeAttack(b, 0, notDir);
    a.heavy = false; a.feint = false; a.damage = b.p.dmg; a.kind = kind;
    a.windup = Math.round(between(b.r, b.p.punishWindup || b.p.windup));
    return a;
  }
  function startWindup(b, attack, events) {
    b.state = 'windup'; b.elapsed = 0; b.attack = attack; b.guard = null; b.goal = null;
    if (b.dist > 0.3) { attack.lunge = true; b.distGoal = 0; }
    if (events) events.push({ type: 'telegraph', attack });
  }
  function recoverGuard(b) {
    // back on guard after a strike or stagger: half a reaction to get the blade home
    b.guard = null; b.goal = null;
    const want = guardFor(b, b.seen);
    if (want) setGoal(b, want, true);
  }
  /** Advance the opponent by dt ms. Returns events: telegraph, feint, impact, guard, recovered, step. */
  function brainStep(b, dt) {
    const ev = [];
    if (b.state === 'dead') return ev;
    b.now += dt; b.elapsed += dt;
    // feet: close or open the distance
    const fs = (b.p.footSpeed || 2.4) * dt / 1000;
    if (b.dist < b.distGoal) b.dist = Math.min(b.distGoal, b.dist + fs); else if (b.dist > b.distGoal) b.dist = Math.max(b.distGoal, b.dist - fs * 1.4);
    // guard
    if (b.goal !== b.guard && b.goal !== null && b.now >= b.goalAt && (b.state === 'idle')) { b.guard = b.goal; ev.push({ type: 'guard', guard: b.guard }); }
    switch (b.state) {
      case 'idle':
        b.timer -= dt;
        b.footT -= dt;
        if (b.footT <= 0) {
          b.footT = between(b.r, [1200, 2400]);
          if (b.dist < 0.3 && b.r() < (b.p.footwork || 0)) { b.distGoal = b.p.stepOut || 0.9; b.footT = between(b.r, [700, 1300]); ev.push({ type: 'step', out: true }); }
          else if (b.distGoal > 0) { b.distGoal = 0; ev.push({ type: 'step', out: false }); }
        }
        if (b.timer <= 0) {
          const [c0, c1] = b.p.combo || [1, 1];
          b.combo = c0 + Math.floor(b.r() * (c1 - c0 + 1));
          startWindup(b, makeAttack(b, 0), ev);
        }
        break;
      case 'windup': {
        const a = b.attack;
        if (a.feint && b.elapsed >= a.windup * 0.5) {
          const n = makeAttack(b, 0, a.dir);
          n.feint = false; n.heavy = false; n.damage = b.p.dmg; n.windup = Math.max(350, Math.round(a.windup * 0.65));
          b.attack = n; b.elapsed = 0;
          ev.push({ type: 'feint', from: a.dir, attack: n });
          break;
        }
        if (b.elapsed >= a.windup) {
          ev.push({ type: 'impact', attack: a });
          if (a.chain + 1 < b.combo) { b.state = 'chain'; b.timer = b.p.comboGap || 160; }
          else { b.state = 'recover'; b.timer = b.p.recover; }
        }
        break;
      }
      case 'chain':
        b.timer -= dt;
        if (b.timer <= 0) startWindup(b, makeAttack(b, b.attack.chain + 1, b.attack.dir), ev);
        break;
      case 'recover':
      case 'stagger':
        b.timer -= dt;
        if (b.timer <= 0) {
          b.state = 'idle'; b.attack = null; b.elapsed = 0;
          b.timer = b.r() < (b.p.rush || 0) ? between(b.r, [150, 400]) : between(b.r, b.p.gap);
          recoverGuard(b); ev.push({ type: 'recovered' });
        }
        break;
    }
    return ev;
  }
  function stagger(b, ms) { if (b.state === 'dead') return; b.state = 'stagger'; b.timer = ms; b.guard = null; b.goal = null; b.attack = null; b.elapsed = 0; }
  /** The player's cut landed. res from resolveCut. Some opponents step back out of reach. */
  function brainHit(b, res) {
    if (res.stagger) stagger(b, b.p.staggerMs * 0.7);   // a weak hit does not even move his guard
    if (b.r() < (b.p.retreat || 0)) { b.distGoal = b.p.stepOut || 0.9; b.footT = between(b.r, [900, 1500]); }
  }
  /** The player parried this opponent's strike: long stagger, wide open. */
  function brainParried(b) { stagger(b, b.p.staggerMs); }
  /** Blocked cuts wear poise down; at zero the guard breaks. */
  function brainPoise(b, amount) {
    b.poise -= amount;
    if (b.poise <= 0) { b.poise = b.p.poise; stagger(b, b.p.staggerMs * 0.8); return true; }
    return false;
  }
  /**
   * Your cut met his guarding blade. cut = { from, power }. Predictable (read) or weak cuts are
   * parried more often; a riposting opponent strikes straight back.
   * Returns { result: 'parry'|'block', riposte: attack|null }.
   */
  function brainBlocked(b, cut) {
    const pp = (b.p.parry || 0) * (b.read && cut.from === b.read ? 1.8 : 1) * (cut.power < 0.45 ? 1.5 : 1);
    const parried = b.r() < Math.min(0.9, pp);
    let riposte = null;
    if (b.state === 'idle' && (parried || b.r() < (b.p.riposte || 0))) {
      riposte = fastAttack(b, 'riposte', cut.from);
      b.combo = 1;
      startWindup(b, riposte, null);
    }
    return { result: parried ? 'parry' : 'block', riposte };
  }
  /** You are open (kind: 'whiff' | 'tired' | 'stunned' | 'flail'): a killer punishes it. Returns the attack or null. */
  function brainOpening(b, kind) {
    if (b.state !== 'idle') return null;
    const chance = (b.p.punish || 0) * (kind === 'stunned' || kind === 'flail' ? 1.3 : 1);
    if (b.r() >= chance) return null;
    const a = fastAttack(b, 'punish');
    b.combo = 1;
    startWindup(b, a, null);
    return a;
  }
  /** After his strike: your answer was 'block' | 'parry' | 'hit' | ... A pressing opponent follows up. */
  function brainStruck(b, result) {
    if (result !== 'block' || b.state !== 'recover' || !b.attack) return;
    if (b.r() < (b.p.followUp || 0)) { b.state = 'chain'; b.timer = b.p.comboGap || 160; b.combo = Math.max(b.combo, b.attack.chain + 2); }
  }
  /** Your blade hit his raised blade during the wind-up: hard enough and you beat it aside. */
  function brainBeat(b, power) {
    if (b.state !== 'windup') return false;
    if (power < (b.p.beatPower || 0.6)) return false;
    stagger(b, b.p.staggerMs * 0.6);
    return true;
  }
  /** Can your blade reach him? He may have stepped out; a thrust reaches further. */
  function brainInReach(b, how) { return b.dist < (how === 'thrust' ? 1.0 : 0.45); }
  function brainKill(b) { b.state = 'dead'; b.guard = null; b.goal = null; b.attack = null; }

  /* --------------------------------------------------------------- ladder */
  const D = (left, right, high, low, thrust) => {
    const o = {}; if (left) o.left = left; if (right) o.right = right; if (high) o.high = high;
    if (low) o.low = low; if (thrust) o.thrust = thrust; return o;
  };
  const HUMAN_GUARDS = ['left', 'right', 'high', 'mid'];
  const LADDER = [
    { title: 'Bout I', name: 'Cassia the Recruit', intro: 'A fresh recruit with a borrowed sword. Learn her rhythm.',
      lesson: 'Her blade follows yours, slowly. Show one side, cut the other. Block on the red zone; arrive late to parry.',
      foes: [{ id: 'recruit', name: 'Cassia', model: 'recruit', hp: 70, dmg: 10, windup: [1000, 1250], combo: [1, 1],
        gap: [1100, 1800], recover: 850, dirs: D(1, 1, 0.7), heavy: 0, feint: 0, guards: HUMAN_GUARDS,
        react: [430, 560], guardSkill: 0.6, read: 0.35, parry: 0.06, riposte: 0.15, punish: 0.3, punishWindup: [800, 920],
        aim: 0.3, followUp: 0, footwork: 0.08, stepOut: 0.8, retreat: 0.05, beatPower: 0.5,
        poise: 60, staggerMs: 1500, parryWindow: 260, height: 1.8, dist: 2.1 }] },
    { title: 'Bout II', name: 'The Grey Pack', intro: 'Two starved wolves, hunting as a pair. Low and fast.',
      lesson: 'They lunge at every wild swing. Keep your point low, wait for the leap, and cut the one that commits.',
      foes: [0, 1].map(i => ({ id: 'wolf' + i, name: i ? 'Grey Wolf' : 'Wolf', model: 'wolf', hp: 40, dmg: 9, pack: true,
        windup: [620, 780], combo: [1, 2], comboWindup: 0.8, comboGap: 220, gap: [650, 1200], recover: 650, dirs: D(0.5, 0.5, 0, 1.4, 0.8),
        heavy: 0, feint: 0, guards: [], evade: 0.35, react: [300, 400], punish: 0.75, punishWindup: [520, 620], aim: 0.5,
        footwork: 0.45, stepOut: 1.0, retreat: 0.5, footSpeed: 3.2, rush: 0.25,
        poise: 30, staggerMs: 1150, parryWindow: 230, height: 0.95, dist: 2.4, beast: true })) },
    { title: 'Bout III', name: 'Ossian the Bone Legionary', intro: 'Dead men do not tire. He strikes in strings and reads a lazy arm.',
      lesson: 'Never cut the same side twice: he reads it and parries. Block his strings, then answer in his recovery.',
      foes: [{ id: 'skeleton', name: 'Ossian', model: 'skeleton', hp: 110, dmg: 13, windup: [650, 820], combo: [2, 3],
        comboWindup: 0.75, comboGap: 150, gap: [700, 1250], recover: 700, dirs: D(1, 1, 0.8, 0.6), heavy: 0.1, feint: 0.15,
        guards: HUMAN_GUARDS, react: [280, 380], guardSkill: 0.82, read: 0.75, parry: 0.25, riposte: 0.4, punish: 0.65,
        punishWindup: [600, 700], aim: 0.6, followUp: 0.4, footwork: 0.15, stepOut: 0.8, retreat: 0.1, rush: 0.2, beatPower: 0.55,
        poise: 70, staggerMs: 1250, parryWindow: 220, height: 1.85, dist: 2.1 }] },
    { title: 'Bout IV', name: 'Brakka the Axe', intro: 'A long axe and a short temper. His overheads break any block.',
      lesson: 'He fights from outside your reach and steps in to chop. Parry or sidestep the HEAVY, beat his slow raise with a hard clash.',
      foes: [{ id: 'axeman', name: 'Brakka', model: 'axeman', hp: 115, dmg: 16, windup: [820, 1050], combo: [1, 2],
        comboWindup: 0.8, gap: [900, 1500], recover: 950, dirs: D(1, 1, 1.3), heavy: 0.4, heavyMul: 1.6, feint: 0.05,
        guards: ['left', 'right', 'high', 'all'], react: [320, 440], guardSkill: 0.75, read: 0.6, parry: 0.12, riposte: 0.3,
        punish: 0.6, punishWindup: [620, 740], aim: 0.55, followUp: 0.3, footwork: 0.5, stepOut: 1.0, retreat: 0.35, footSpeed: 2.2,
        beatPower: 0.45, zoneArmor: { torso: 0.35 },
        poise: 90, staggerMs: 1300, parryWindow: 200, height: 1.9, dist: 2.2 }] },
    { title: 'Bout V', name: 'Grumhold the Hill Troll', intro: 'Thick hide, huge sweeps. Only your hardest swings bite.',
      lesson: 'His sweeps break any guard: dodge or parry them. Flailing does nothing to his hide, and every miss gets you flattened.',
      foes: [{ id: 'troll', name: 'Grumhold', model: 'troll', hp: 170, dmg: 21, windup: [800, 1050], combo: [1, 2], comboWindup: 0.85, comboGap: 260,
        gap: [1000, 1700], recover: 1150, dirs: D(1.2, 1.2, 0.8, 0.6), heavy: 0.5, heavyMul: 1.5, feint: 0, guards: [],
        react: [380, 480], punish: 0.7, punishWindup: [620, 760], aim: 0.6, followUp: 0.3, footwork: 0.15, stepOut: 0.9,
        armor: 0.55, poise: 140, staggerMs: 1350, parryWindow: 210, height: 3.0, dist: 3.0 }] },
    { title: 'Final', name: 'Aurelian the Gilded', intro: 'The undefeated champion. Fast combos, feints, and he reads everything.',
      lesson: 'He reacts in a blink, parries anything predictable and punishes every miss. Defend first; strike only into an opening.',
      foes: [{ id: 'champion', name: 'Aurelian', model: 'champion', hp: 140, dmg: 15, windup: [450, 600], combo: [1, 3],
        comboWindup: 0.85, comboGap: 150, gap: [700, 1300], recover: 650, dirs: D(1, 1, 0.9, 0.4, 0.6), heavy: 0.15, feint: 0.3,
        guards: ['left', 'right', 'high', 'low', 'mid'], react: [180, 250], guardSkill: 0.93, read: 0.9, parry: 0.35, riposte: 0.6,
        punish: 0.85, punishWindup: [420, 500], aim: 0.75, followUp: 0.5, footwork: 0.35, stepOut: 0.9, retreat: 0.3, rush: 0.3,
        beatPower: 0.7, zoneArmor: { head: 0.4 },
        poise: 100, staggerMs: 1100, parryWindow: 160, height: 1.85, dist: 2.1 }] },
  ];

  /* ------------------------------------------------------------- versus */
  /*
   * Two people, the same rules. Nobody telegraphs: a cut is a real swing, and the defender's
   * guard is whatever their drawn blade (or shield) is doing when the cut arrives. The defence is
   * judged by resolveDefense exactly like a telegraphed strike in the ladder:
   *   - blade met by a blade that just ARRIVED (moving within the parry window) = parry,
   *     a blade already held there = block (stamina), a cut that cannot be paid for or a
   *     HEAVY cut (full power) = guard broken (half damage);
   *   - both blades cutting into each other: the much harder cut beats the other aside, else
   *     they clash and both bounce;
   *   - shield up: raised within the parry window = parry, else block (cheaper), heavy breaks it;
   *   - body: resolveCut (head x1.5, legs, arm, edge alignment); cutting someone mid-swing is a COUNTER,
   *     cutting someone stunned bites deeper.
   */
  const PVP = { parryWindow: 180, heavy: 1.0, beatMargin: 0.35, stunParried: 450, stunBroken: 600, stunBeaten: 500, roundMs: 90000, rounds: 2, hp: 100 };
  /**
   * o = { power (effective), from, zone, align, contact: 'blade'|'shield'|'body',
   *       def: { arrivedMs (ms since the defender's blade last moved; small = just arrived), swinging, swingPower,
   *              shieldMs (-1 = down), stamina, overextended, stunned } }
   * Returns { result: 'parry'|'block'|'guardbreak'|'beat'|'beaten'|'clash'|'hit'|'glance', damage, defCost, stunAtk, stunDef, counter }.
   */
  function pvpExchange(o) {
    const d = o.def, p = o.power;
    const out = { result: 'hit', damage: 0, defCost: 0, stunAtk: 0, stunDef: 0, counter: false };
    const raw = Math.round((4 + 18 * clamp(p, 0, 1.25)) * (0.5 + 0.5 * (o.align === undefined ? 1 : o.align)));
    if (o.contact === 'body') {
      const r = resolveCut({ power: p, from: o.from, zone: o.zone, align: o.align,
        enemy: { guard: null, state: d.stunned ? 'stagger' : d.swinging && d.swingPower > 0.3 ? 'windup' : 'idle' } });
      out.result = r.result === 'hit' ? 'hit' : 'glance'; out.damage = r.damage; out.counter = r.counter;
      return out;
    }
    if (o.contact === 'blade' && d.swinging && d.swingPower > 0.3 && !d.stunned) {
      const diff = p - d.swingPower;
      if (diff > PVP.beatMargin) { out.result = 'beat'; out.stunDef = PVP.stunBeaten; }
      else if (-diff > PVP.beatMargin) { out.result = 'beaten'; out.stunAtk = PVP.stunBeaten; }
      else out.result = 'clash';
      return out;
    }
    const attack = { damage: raw, heavy: p >= PVP.heavy };
    const r = o.contact === 'shield'
      ? resolveDefense({ attack, shieldFor: d.shieldMs, stamina: d.stamina, parryWindow: PVP.parryWindow, overextended: d.overextended || d.stunned })
      : resolveDefense({ attack, coverFor: Math.max(0, d.arrivedMs), stamina: d.stamina, parryWindow: PVP.parryWindow, overextended: d.overextended || d.stunned });
    out.result = r.result; out.damage = r.damage; out.defCost = r.staminaCost;
    if (r.result === 'parry') out.stunAtk = PVP.stunParried;
    if (r.result === 'guardbreak') out.stunDef = PVP.stunBroken;
    return out;
  }
  /** Round / match bookkeeping: who took the round (by knockout, else by health share at the bell). */
  function pvpRoundWinner(hp0, hp1, timeUp) {
    if (hp0 <= 0 && hp1 <= 0) return -1;
    if (hp1 <= 0) return 0;
    if (hp0 <= 0) return 1;
    if (!timeUp) return null;
    return Math.abs(hp0 - hp1) < 1 ? -1 : hp0 > hp1 ? 0 : 1;
  }

  /* --------------------------------------------------------------- fame */
  const FAME = { hit: p => Math.round(40 + 120 * p), counter: 120, parry: 250, block: 30, kill: 500, flawless: 600, taken: -4, beat: 200, whiff: -15 };
  function rankFor(fame, won) {
    if (won >= LADDER.length) return 'Champion of the Circus';
    if (won >= 4 || fame > 6000) return 'Crowd Favourite';
    if (won >= 2) return 'Veteran';
    if (won >= 1) return 'Tiro';
    return 'Fodder';
  }

  const api = { rng, SWING, TIRED, swingPower, effectivePower, dirName, cutFrom, swingTracker, swingStep, resolveCut, GLANCE_POWER,
    GUARD_ZONES, guardCovers, screenSweepHits, segCross, bladesCross, threatFrom, resolveDefense, STAMINA_MAX, swingCost, blockCost,
    THRUST_COST, DODGE_COST, WHIFF_COST, staminaStep, createBrain, brainStep, brainSee, brainNoteCut, brainHit, brainParried, brainPoise,
    brainBlocked, brainOpening, brainStruck, brainBeat, brainInReach, brainKill, LADDER, FAME, rankFor, PVP, pvpExchange, pvpRoundWinner };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LudusCombat = api;
})(typeof window !== 'undefined' ? window : this);
