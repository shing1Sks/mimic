/*
 * Iron Ludus - combat rules. Pure logic, no three.js, no DOM: runs in Node tests too
 * (node games/gladiator/test/combat.test.js). Classic script: defines window.LudusCombat.
 *
 * Everything is 3D and physical. Your blade is a segment in the arena that follows the phone 1:1;
 * his blade, his body and yours are segments and capsules. Each frame both blades are swept from
 * their last pose to this one in small steps, so a 40 rad/s swing never passes through anything.
 *
 * Conventions
 *   World: metres, x right, y up, z toward the player's back (three.js). Vectors are {x, y, z}.
 *   Fighter-local frame (attack paths, guards): origin at the fighter's feet, z toward his
 *     opponent, x = the opponent's right (your screen right), y up. Distances for a 1.85 m fighter.
 *   A line is where a blow comes from on the defender's screen: 'left' | 'right' | 'high' |
 *     'highLeft' | 'highRight' | 'low' | 'thrust'.
 *   Times in milliseconds unless named otherwise.
 */
(function (root) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

  // your body and blade (game.js draws them the same): eye height, the hilt's offset into view
  // from the arm model, crossguard and blade length along the phone's forward axis
  const BODY = { eye: 1.62, rigOffset: [-0.03, 0.1, -0.06], guardZ: -0.09, blade: 0.82 };

  /*
   * Your sword arm (arm.js draws it): a fixed shoulder, upper arm and forearm, the wrist behind and
   * below the fist (a hammer grip bends the wrist down from the blade), the elbow bending down and out.
   */
  const ARM = { shoulder: { x: 0.18, y: -0.25, z: 0.1 }, upper: 0.31, fore: 0.29, armExt: 0.45, wrist: { x: 0.012, y: -0.036, z: 0.074 }, pole: { x: 0.55, y: -0.8, z: 0.25 } };
  /**
   * Where the arm is for a sword orientation q, the arm model's pose of q (MimicMath.armPose) and a
   * lunge extension: { shoulder, elbow, wrist, hand } in the rig's space. The hand comes from the arm
   * model; if the wrist would be out of reach, hand and wrist are drawn in together (the sword's angle
   * never changes). rotate(q, v): quaternion rotation.
   */
  function solveArm(q, pose, ext, rotate) {
    const A = ARM, S = A.shoulder, UPPER = A.upper, FORE = A.fore;
    const hand = { x: pose.hand.x, y: pose.hand.y, z: pose.hand.z - (ext || 0) * A.armExt };
    const w = rotate(q, A.wrist);
    const wrist = { x: hand.x + w.x, y: hand.y + w.y, z: hand.z + w.z };
    const L = UPPER + FORE - 0.004;
    let dx = wrist.x - S.x, dy = wrist.y - S.y, dz = wrist.z - S.z, d = Math.hypot(dx, dy, dz);
    if (d > L) {
      const k = 1 - L / d;
      for (const p of [hand, wrist]) { p.x -= dx * k; p.y -= dy * k; p.z -= dz * k; }
      dx *= 1 - k; dy *= 1 - k; dz *= 1 - k; d = L;
    }
    d = Math.max(d, Math.abs(UPPER - FORE) + 0.01);
    const ux = dx / d, uy = dy / d, uz = dz / d;
    const ca = Math.max(-1, Math.min(1, (UPPER * UPPER + d * d - FORE * FORE) / (2 * UPPER * d))), sa = Math.sqrt(1 - ca * ca);
    const pn = Math.hypot(A.pole.x, A.pole.y, A.pole.z);
    let px = A.pole.x / pn, py = A.pole.y / pn, pz = A.pole.z / pn;
    const pd = px * ux + py * uy + pz * uz; px -= ux * pd; py -= uy * pd; pz -= uz * pd;
    const pl = Math.hypot(px, py, pz) || 1; px /= pl; py /= pl; pz /= pl;
    const elbow = { x: S.x + (ux * ca + px * sa) * UPPER, y: S.y + (uy * ca + py * sa) * UPPER, z: S.z + (uz * ca + pz * sa) * UPPER };
    return { shoulder: { x: S.x, y: S.y, z: S.z }, elbow, wrist, hand };
  }

  /* --------------------------------------------------------------- vectors */
  const v3 = (x, y, z) => ({ x, y, z });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const len = a => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  const norm = a => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
  const madd = (a, b, s) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });

  /* ------------------------------------------------------------------- rng */
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
    const keys = Object.keys(weights).filter(k => weights[k] > 0);
    let sum = 0; for (const k of keys) sum += weights[k];
    let x = r() * sum;
    for (const k of keys) { x -= weights[k]; if (x <= 0) return k; }
    return keys[keys.length - 1];
  }

  /* -------------------------------------------------------------- geometry */
  /** Closest points of segments p1-q1 and p2-q2: { s, t (0..1 along each), c1, c2, dist }. */
  function closestSegSeg(p1, q1, p2, q2) {
    const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
    const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
    let s, t;
    if (a <= 1e-12 && e <= 1e-12) { s = t = 0; }
    else if (a <= 1e-12) { s = 0; t = clamp(f / e, 0, 1); }
    else {
      const c = dot(d1, r);
      if (e <= 1e-12) { t = 0; s = clamp(-c / a, 0, 1); }
      else {
        const b = dot(d1, d2), den = a * e - b * b;
        s = den > 1e-12 ? clamp((b * f - c * e) / den, 0, 1) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
      }
    }
    const c1 = madd(p1, d1, s), c2 = madd(p2, d2, t);
    return { s, t, c1, c2, dist: len(sub(c1, c2)) };
  }
  const segAt = (A0, A1, f) => ({ h: lerp(A0.h, A1.h, f), t: lerp(A0.t, A1.t, f) });
  const moved = (A0, A1) => Math.max(len(sub(A1.h, A0.h)), len(sub(A1.t, A0.t)));

  /**
   * Two moving segments: A from A0 to A1 and B from B0 to B1 over one step ({h, t} each, the
   * hilt and tip of a blade or the ends of a limb). Returns the first contact closer than `radius`
   * (both thicknesses together): { f (0..1 through the step), u (along A), w (along B), point,
   * normal (from B toward A), dist } or null. Steps are fine enough for the thinnest pair, and a
   * pass straight through between two steps (the separation flips) still counts.
   */
  function sweepSegSeg(A0, A1, B0, B1, radius) {
    const travel = moved(A0, A1) + moved(B0, B1);
    const K = clamp(Math.ceil(travel / Math.max(0.008, radius * 0.7)), 1, 96);
    let prev = null;
    for (let k = 0; k <= K; k++) {
      const f = k / K, A = segAt(A0, A1, f), B = segAt(B0, B1, f);
      const c = closestSegSeg(A.h, A.t, B.h, B.t);
      const sep = sub(c.c1, c.c2);
      if (c.dist < radius) return hitOf(f, c, sep);
      if (prev && prev.c.s > 0.001 && prev.c.s < 0.999 && prev.c.t > 0.001 && prev.c.t < 0.999 &&
        c.s > 0.001 && c.s < 0.999 && c.t > 0.001 && c.t < 0.999 && dot(prev.sep, sep) < 0) {
        // went through each other between two steps: contact halfway, where they crossed
        const fm = (k - 0.5) / K, Am = segAt(A0, A1, fm), Bm = segAt(B0, B1, fm);
        const cm = closestSegSeg(Am.h, Am.t, Bm.h, Bm.t);
        return hitOf(fm, cm, prev.sep);
      }
      prev = { c, sep };
    }
    return null;
  }
  function hitOf(f, c, sep) {
    const n = len(sep) > 1e-9 ? norm(sep) : v3(0, 1, 0);
    return { f, u: c.s, w: c.t, point: lerp(c.c1, c.c2, 0.5), normal: n, dist: c.dist };
  }
  /**
   * A moving blade against a body: parts0/parts1 = [{ zone, a, b, r }] capsules at the start and
   * end of the step (same order). Returns the earliest { part, zone, f, u, point, normal } or null.
   */
  function sweepBody(A0, A1, parts0, parts1, bladeR) {
    let best = null;
    for (let i = 0; i < parts1.length; i++) {
      const p0 = parts0[i] || parts1[i], p1 = parts1[i];
      const h = sweepSegSeg(A0, A1, { h: p0.a, t: p0.b }, { h: p1.a, t: p1.b }, p1.r + (bladeR || 0.012));
      if (h && (!best || h.f < best.f - 1e-6)) best = Object.assign(h, { part: i, zone: p1.zone });
    }
    return best;
  }
  /** A moving blade against a moving disc (a round shield): disc = { c, n, R, th }. */
  function sweepDisc(A0, A1, D0, D1, bladeR) {
    const travel = moved(A0, A1) + len(sub(D1.c, D0.c));
    const K = clamp(Math.ceil(travel / 0.02), 1, 64);
    for (let k = 0; k <= K; k++) {
      const f = k / K, A = segAt(A0, A1, f);
      const c = lerp(D0.c, D1.c, f), n = norm(lerp(D0.n, D1.n, f));
      for (let j = 0; j <= 10; j++) {
        const p = lerp(A.h, A.t, j / 10), rel = sub(p, c), h = dot(rel, n);
        const radial = len(sub(rel, scale(n, h)));
        const d = Math.sqrt(h * h + Math.pow(Math.max(0, radial - D1.R), 2));
        if (d < D1.th + (bladeR || 0.012)) return { f, u: j / 10, point: p, normal: h >= 0 ? n : scale(n, -1), dist: d };
      }
    }
    return null;
  }
  /** Velocity (m/s) of the point at fraction u along a segment that moved A0 -> A1 in dt seconds. */
  function pointVel(A0, A1, u, dt) {
    const p0 = lerp(A0.h, A0.t, u), p1 = lerp(A1.h, A1.t, u);
    return scale(sub(p1, p0), 1 / Math.max(1e-4, dt));
  }

  /* --------------------------------------------------------------- strikes */
  /*
   * What a contact was, from the blade's own motion:
   *   thrust  the point leads (contact near the tip, moving along the blade toward it)
   *   edge    moving across the blade with the edge leading (within 45 deg of the edge, falling to
   *           a flat by 75 deg); `edge` is the edge direction, set by how you hold the hilt at CENTRE
   *   flat    across the blade, flat side first: a slap
   *   draw    pulled back along the blade: a slicing touch
   */
  const STRIKE = { touch: 3, full: 20, thrustMin: 1.2, thrustFull: 6, edgeFull: 45, edgeNone: 75 };
  function classifyContact(o) {
    const axis = norm(sub(o.tip, o.hilt)), v = o.vel, speed = len(v);
    const axial = dot(v, axis), perpV = sub(v, scale(axis, axial)), perp = len(perpV);
    let edge01 = 1;
    if (o.edge && perp > 1e-6) {
      const ang = Math.acos(clamp(Math.abs(dot(scale(perpV, 1 / perp), norm(o.edge))), 0, 1)) * 180 / Math.PI;
      edge01 = 1 - clamp((ang - STRIKE.edgeFull) / (STRIKE.edgeNone - STRIKE.edgeFull), 0, 1);
    }
    let kind;
    if ((o.u === undefined || o.u > 0.78) && axial > STRIKE.thrustMin && axial >= 0.9 * perp) kind = 'thrust';
    else if (axial < -1.5 && -axial > 1.5 * perp) kind = 'draw';
    else kind = edge01 >= 0.5 ? 'edge' : 'flat';
    return { kind, speed, axial, perp, edge01 };
  }
  const ZONE_MUL = { head: 1.45, torso: 1, swordArm: 0.55, offArm: 0.5, legs: 0.65 };
  /** 0..1.25 from a contact's useful speed: 3 m/s is a touch, 20 m/s (a real full swing) is 1. */
  function cutPower(speed) { return clamp((speed - STRIKE.touch) / (STRIKE.full - STRIKE.touch), 0, 1.25); }
  function thrustPower(axial) { return clamp((axial - STRIKE.thrustMin) / (STRIKE.thrustFull - STRIKE.thrustMin), 0, 1.25); }
  /**
   * A blade lands on a body. o = { kind, speed, axial, edge01, zone, armor (0..1 on that zone),
   *   state ('idle'|'windup'|'strike'|'stagger'|'kneel'...), mul (your wounds, 1 = whole) }
   * Returns { result: 'hit'|'armor'|'touch', damage, power, stagger, counter }.
   */
  function strikeDamage(o) {
    const out = { result: 'hit', damage: 0, power: 0, stagger: false, counter: false };
    const p = o.kind === 'thrust' ? thrustPower(o.axial) : cutPower(o.speed);
    out.power = p;
    if (p <= 0.02) { out.result = 'touch'; return out; }
    let dmg;
    if (o.kind === 'thrust') dmg = 8 + 26 * p;
    else if (o.kind === 'flat') dmg = (4 + 25 * p) * 0.35;
    else if (o.kind === 'draw') dmg = (4 + 25 * p) * 0.5;
    else dmg = (4 + 25 * p) * (0.75 + 0.25 * (o.edge01 === undefined ? 1 : o.edge01));
    dmg *= ZONE_MUL[o.zone] || 1;
    const armor = o.armor || 0;
    if (armor > 0) {
      // plate turns a weak or flat blow completely; a point finds the gaps
      if (o.kind !== 'thrust' && (o.kind === 'flat' || p < 0.25 + 0.4 * armor)) {
        out.result = 'armor'; out.damage = Math.max(1, Math.round(dmg * 0.12)); out.stagger = p > 0.8; return out;
      }
      dmg *= 1 - armor * (o.kind === 'thrust' ? 0.35 : 0.7);
    }
    if (o.state === 'windup') { out.counter = true; dmg *= 1.2; }
    else if (o.state === 'stagger' || o.state === 'disarmed') dmg *= 1.25;
    else if (o.state === 'kneel') dmg *= 1.3;
    dmg *= o.mul === undefined ? 1 : o.mul;
    out.damage = Math.max(1, Math.round(dmg));
    out.stagger = o.kind === 'flat' ? p > 0.55 : out.counter ? p > 0.35 : p > 0.85 || (o.zone === 'head' && p > 0.5);
    return out;
  }

  /*
   * His blow meets your blade. o = {
   *   into: your contact point's speed against his blow (m/s, + = you met it),
   *   u: where on your blade (0 hilt .. 1 tip; near the hilt is strong), heavy,
   *   offBalance: you were still carried by a missed swing }
   * parry  you beat into it: his blade is thrown wide, he is open
   * block  your blade held: the blow stops on it
   * beaten a heavy blow on the weak of your blade (or a blade going the wrong way): it drives
   *        through, your blade is knocked aside and you take part of the blow
   */
  const PARRY = { into: 1.8, intoHeavy: 4, maxU: 0.88, strongU: 0.55, wrongWay: -2.5, beatenShare: 0.4 };
  function judgeBlock(o) {
    const into = o.into || 0, u = o.u === undefined ? 0.5 : o.u;
    if (!o.offBalance && u <= PARRY.maxU && into >= (o.heavy ? PARRY.intoHeavy : PARRY.into)) return 'parry';
    if (into <= PARRY.wrongWay) return 'beaten';
    if (o.heavy && u > PARRY.strongU && into < PARRY.into) return 'beaten';
    return 'block';
  }
  /*
   * Your cut meets his blade (or shield). o = { speed: your contact speed, his: 'guard' |
   *   'parrying' (he beats into you) | 'windup' | 'strike', strength: how hard a blow his guard
   *   takes (m/s), into: his blade's speed against yours }
   * beat     your blow knocks his guard (or his raised blade) aside: he is open
   * blocked  it stops on his guard
   * parried  he beat your blow away: you are thrown open
   */
  function judgeCut(o) {
    const s = o.speed, k = o.strength || 10;
    if (o.his === 'parrying') return s > k * 1.6 ? 'beat' : 'parried';
    if (o.his === 'windup') return s > k * 0.75 ? 'beat' : 'blocked';
    if (o.his === 'strike') {
      const theirs = o.into || 0;
      return s > theirs * 1.3 + 4 ? 'beat' : s < theirs * 0.5 ? 'parried' : 'blocked';
    }
    if (s >= k * 1.25) return 'beat';
    if (s < k * 0.3 && (o.into || 0) > 1) return 'parried';
    return 'blocked';
  }

  /* -------------------------------------------------------------- swings */
  /*
   * A swing = the blade tip moving fast. Only for reading and logging (and the opponent's eyes):
   * damage comes from the contact itself, never from a label. A forehand followed by a backhand
   * is two swings. Nothing is subtracted for swinging fast or often.
   */
  const SWING = { start: 5, end: 2.5, endHoldMs: 50, reverseMs: 70, maxMs: 1200, big: 14 };
  function swingTracker() {
    return { active: false, id: 0, startT: 0, endT: -1e9, peak: 0, peakAng: 0, dir: v3(0, 0, 0), sum: v3(0, 0, 0),
      slowSince: -1, contact: null, line: null, reversed: false };
  }
  /**
   * Feed one frame: { t (ms), vel (tip velocity, world m/s), ang (rad/s), view: {x, y} unit
   * vectors of the defender's screen right / up for naming the line }.
   * Returns 'start' | 'end' | null.
   */
  function swingStep(tr, f) {
    const speed = len(f.vel);
    if (!tr.active) {
      if (speed > SWING.start) {
        Object.assign(tr, { active: true, startT: f.t, peak: speed, peakAng: f.ang || 0, sum: scale(f.vel, 1), dir: norm(f.vel),
          slowSince: -1, contact: null, reversed: false });
        tr.id++; tr.line = lineOf(tr.dir, f.view);
        return 'start';
      }
      return null;
    }
    if (f.t - tr.startT >= SWING.reverseMs && speed > SWING.start && dot(norm(f.vel), tr.dir) < -0.35) {
      tr.active = false; tr.endT = f.t; tr.reversed = true;
      return 'end';
    }
    tr.peak = Math.max(tr.peak, speed); tr.peakAng = Math.max(tr.peakAng, f.ang || 0);
    tr.sum = add(tr.sum, f.vel); tr.dir = norm(tr.sum); tr.line = lineOf(tr.dir, f.view);
    if (speed < SWING.end) { if (tr.slowSince < 0) tr.slowSince = f.t; } else tr.slowSince = -1;
    if ((tr.slowSince >= 0 && f.t - tr.slowSince >= SWING.endHoldMs) || f.t - tr.startT > SWING.maxMs) {
      tr.active = false; tr.endT = f.t;
      return 'end';
    }
    return null;
  }
  /** Motion direction on the defender's screen -> the line the blow comes from. */
  function lineOf(dir, view) {
    const r = view ? view.x : v3(1, 0, 0), u = view ? view.y : v3(0, 1, 0), f = view && view.z ? view.z : v3(0, 0, 1);
    const x = dot(dir, r), y = dot(dir, u), z = view && view.z ? dot(dir, f) : 0;
    if (z > 0.8 && Math.hypot(x, y) < 0.6) return 'thrust';
    if (y < -0.75 * Math.abs(x) * 1.0 && Math.abs(x) < 0.45 * Math.abs(y)) return 'high';
    if (y > 0.5 && Math.abs(x) < y) return 'low';
    if (y < -0.4 * Math.abs(x)) return x > 0 ? 'highLeft' : 'highRight';
    return x > 0 ? 'left' : 'right';
  }

  /* ------------------------------------------------------- attack paths */
  // where the blow travels at impact, on the defender's screen (x right, y up)
  const TRAVEL = { left: v3(1, -0.2, 0), right: v3(-1, -0.2, 0), high: v3(0.05, -1, 0), highLeft: v3(0.72, -0.7, 0),
    highRight: v3(-0.72, -0.7, 0), low: v3(0.35, 1, 0) };
  const LINE_GUARD = { left: 'left', highLeft: 'left', right: 'right', highRight: 'right', high: 'high', low: 'low', thrust: 'mid' };
  // the side a line comes from, for the body's wind-up (fighters.js leans the same way as the old strikes)
  const LINE_DIR = { left: 'left', highLeft: 'left', right: 'right', highRight: 'right', high: 'high', low: 'low', thrust: 'thrust' };
  /** Points on the defender, in the attacker's frame with the defender standing at z = dist. */
  function aimPoint(aim, dist) {
    switch (aim) {
      case 'head': return v3(0, 1.6, dist);
      case 'arm': return v3(0.24, 1.32, dist - 0.38);
      case 'legs': return v3(0.08, 0.58, dist);
      default: return v3(0, 1.2, dist - 0.02);
    }
  }
  const WIND_DEG = 115, WIND_HEAVY = 135, FOLLOW_DEG = 65, STRIKE_EASE = 1.5;
  /** The fraction of a strike at which its blade sweeps through the target. */
  function impactAt(heavy) {
    const w = heavy ? WIND_HEAVY : WIND_DEG;
    return Math.pow(w / (w + FOLLOW_DEG), 1 / STRIKE_EASE);
  }
  /**
   * Where his weapon is during an attack, in his own frame. atk = { line, heavy, target (point) };
   * cfg = { shoulder, reach (straight arm, shoulder to grip), blade: [a, b] (blade along the weapon
   * from the grip) }. stage 'windup' -> the wound-back pose (f = how far drawn back, 0..1),
   * 'strike' f 0..1 through the blow. Returns { hilt, dir }.
   */
  function attackPose(atk, stage, f, cfg) {
    const S = cfg.shoulder, P = atk.target, toP = sub(P, S), dSP = norm(toP), dist = len(toP);
    const b = cfg.blade[1], reach = cfg.reach;
    if (atk.line === 'thrust') {
      const back = add(madd(S, dSP, 0.12), v3(0, -0.05, -0.2));
      const rEnd = clamp(dist - 0.9 * b, 0.2, reach + 0.12);
      const dir = norm(add(dSP, v3(0, 0.04, 0)));
      if (stage === 'windup') return { hilt: back, dir };
      const e = Math.pow(clamp(f, 0, 1), 1.6);
      return { hilt: lerp(back, madd(S, dSP, rEnd), e), dir: dSP };
    }
    const tr = TRAVEL[atk.line] || TRAVEL.left;
    const tp = norm(sub(tr, scale(dSP, dot(tr, dSP))));      // the blow's direction across the line to the target
    const W = (atk.heavy ? WIND_HEAVY : WIND_DEG) * Math.PI / 180, F = FOLLOW_DEG * Math.PI / 180;
    const raise = atk.line === 'high' ? v3(0, 0.2, -0.3) : atk.line === 'low' ? v3(0, -0.25, -0.2) : v3(0, 0.55, -0.25);
    const dirAt = th => add(scale(dSP, Math.cos(th)), scale(tp, Math.sin(th)));
    const rStrike = clamp(dist - 0.72 * b, 0.25, reach);
    if (stage === 'windup') {
      const d = norm(add(dirAt(-W), raise));
      return { hilt: madd(S, d, 0.3), dir: d };
    }
    const e = Math.pow(clamp(f, 0, 1), STRIKE_EASE);
    const th = -W + (W + F) * e;
    const d = norm(add(dirAt(th), scale(raise, 1 - smooth(f / 0.6))));
    return { hilt: madd(S, d, 0.3 + (rStrike - 0.3) * smooth(f / 0.8)), dir: d };
  }

  /* ---------------------------------------------------------------- wounds */
  /*
   * Where a blow lands changes the fight. The same rules hold for him and for you.
   *   sword arm  each level slows his wind-ups and weakens his blows (yours: weaker cuts); a hard
   *              cut on it can make him drop his weapon
   *   off arm    a shield arm cut hard enough drops the shield
   *   legs       each level slows his feet and shortens his lunge (yours: shorter lunge); a hard
   *              one, or the third, puts him on one knee
   *   head       big damage and a daze
   */
  function woundState() { return { swordArm: 0, offArm: 0, legs: 0, head: 0, torso: 0, armLevel: 0, legLevel: 0, kneels: 0 }; }
  function applyWound(w, zone, damage, o) {
    o = o || {};
    const fx = { disarm: false, shieldDrop: false, kneel: false, daze: false, limp: false };
    if (!(damage > 0)) return fx;
    w[zone] = (w[zone] || 0) + damage;
    if (zone === 'swordArm') {
      w.armLevel = Math.min(3, Math.floor(w.swordArm / 12));
      const r = o.rng ? o.rng() : Math.random();
      if (o.armed && damage >= 13 && r < 0.3 + 0.15 * w.armLevel) fx.disarm = true;
    } else if (zone === 'offArm') {
      if (o.shield && (damage >= 9 || w.offArm >= 16)) fx.shieldDrop = true;
    } else if (zone === 'legs') {
      const before = w.legLevel;
      w.legLevel = Math.min(3, Math.floor(w.legs / 12));
      fx.limp = w.legLevel > before;
      if (damage >= 17 || (w.legLevel >= 3 && before < 3)) { fx.kneel = true; w.kneels++; }
    } else if (zone === 'head') {
      fx.daze = damage >= 14;
    }
    return fx;
  }
  /** What a body's wounds do to it. */
  function woundMods(w) {
    return { windup: 1 + 0.15 * w.armLevel, damage: 1 - 0.15 * w.armLevel, feet: 1 - 0.22 * w.legLevel,
      lunge: 1 - 0.3 * w.legLevel, react: 40 * w.armLevel, cut: 1 - 0.12 * w.armLevel };
  }

  /* ----------------------------------------------------------- the brain */
  /*
   * The opponent fights like a person with a reaction time and a style:
   *  - his blade (and shield) follows the line your blade threatens, `react` ms late, so a quick
   *    change of line beats a slow reader; he sits on lines you repeat or alternate (`read`);
   *  - he chooses where to strike away from your blade (`aim`), in combos, heavy blows, feints;
   *  - he beats into cuts he sees coming (`parry`), answers a stopped cut (`riposte`), punishes a
   *    missed swing on the side your blade is not (`punish`), and feints to catch a swinger;
   *  - he stands just out of your reach, steps in to strike (that step is part of the tell) and
   *    stays in reach while he recovers.
   */
  function createBrain(profile, seed) {
    const r = rng(seed);
    const b = { p: profile, r, state: 'idle', timer: between(r, profile.gap) + 900, elapsed: 0, now: 0, attack: null, combo: 0,
      guard: 'mid', goal: 'mid', goalAt: 0, seen: null, history: [], read: null, parryUntil: -1, balance: profile.balance,
      nextId: 1, dist: profile.range.idle + 3, distGoal: profile.range.idle, footT: between(r, [900, 2000]),
      wounds: woundState(), armed: true, events: [], shield: !!profile.shield, trapped: false, lastSwingT: -1e9, lastHitT: -1e9 };
    return b;
  }
  const mods = b => woundMods(b.wounds);
  function guardFor(b, threat) {
    const g = b.p.guards;
    if (!g || !g.length) return null;
    if (threat && g.includes(threat)) return threat;
    if (b.read && g.includes(LINE_GUARD[b.read])) return LINE_GUARD[b.read];
    return g.includes('mid') ? 'mid' : g[0];
  }
  function setGoal(b, want, fast) {
    if (want === b.goal) return;
    const react = (between(b.r, b.p.react) + mods(b).react) * (fast ? 0.55 : 1);
    b.goal = want; b.goalAt = b.now + react;
  }
  /**
   * Each frame, what he sees of you: obs = { threat: guard name your blade threatens or null,
   *   swing: { line, speed } while your tip is moving fast, or null }.
   */
  function brainSee(b, obs) {
    const th = obs && obs.threat || null;
    if (th !== b.seen) {
      b.seen = th;
      if (b.state === 'idle' || b.state === 'recover') {
        const want = guardFor(b, th);
        if (want && want !== b.goal && b.r() <= (b.p.guardSkill === undefined ? 1 : b.p.guardSkill)) setGoal(b, want, b.read && want === LINE_GUARD[b.read]);
      }
    }
  }
  /** Your swing started. sw = { line, big }: he may beat into it, and remembers the line. */
  function brainSwing(b, sw) {
    b.lastSwingT = b.now;
    if (sw.big) {
      b.busyUntil = b.now + 450;
      // a patient fighter gives ground to a blade that keeps swinging: make it miss, then come in
      if (b.p.patience && b.state === 'idle') b.distGoal = b.p.range.idle + 0.35;
    }
    if (sw.big) noteLine(b, sw.line);
    // a swing thrown at his feint: the trap springs, the real blow comes from the other side at once
    if (b.state === 'windup' && b.attack && b.attack.feint && !b.attack.switched && sw.big) {
      switchFeint(b, true);
      return 'trap';
    }
    if (b.state !== 'idle' || !b.p.guards || !sw.big) return null;
    const g = LINE_GUARD[sw.line];
    let chance = b.p.parry || 0;
    if (b.read && sw.line === b.read) chance *= 1.8;
    if (g === b.guard && b.r() < Math.min(0.9, chance)) { b.parryUntil = b.now + 260; return 'parry'; }
    // a skilled reader snaps his guard onto a line he sees thrown
    if (g !== b.guard && b.p.guards.includes(g) && b.r() < (b.p.guardSkill || 0) * 0.6) setGoal(b, g, true);
    return null;
  }
  function noteLine(b, line) {
    if (!line) return;
    b.history.push(line); if (b.history.length > 5) b.history.shift();
    const h = b.history, n = h.length;
    let pred = null;
    if (n >= 3) {
      const a = h[n - 3], c = h[n - 2], d = h[n - 1];
      if (a === d && c !== d && a !== c) pred = c;          // L R L -> R next
      else if ((c === d) || (a === d)) pred = d;            // the same line again
    }
    b.read = pred && b.r() < (b.p.read || 0) ? pred : null;
    if (b.read && b.state === 'idle') { const g = guardFor(b, LINE_GUARD[b.read]); if (g) setGoal(b, g, true); }
  }
  function makeAttack(b, chain, o) {
    o = o || {};
    const p = b.p, m = mods(b);
    let lines = Object.assign({}, p.lines);
    if (o.not && Object.keys(lines).length > 1) delete lines[o.not];
    if (o.only && lines[o.only] !== undefined) lines = { [o.only]: 1 };
    // aim away from the line your blade covers
    if (b.seen && b.r() < (p.aim || 0)) for (const l in lines) if (LINE_GUARD[l] === b.seen && Object.keys(lines).length > 1) delete lines[l];
    const heavy = !o.fast && b.r() < (p.heavy || 0);
    const base = between(b.r, o.fast ? (p.punishWindup || p.windup) : p.windup);
    const windup = Math.round((chain > 0 ? base * (p.comboWindup || 0.7) : base * (heavy ? 1.2 : 1)) * m.windup);
    const line = pickWeighted(b.r, lines);
    let aim = pickWeighted(b.r, p.aims || { torso: 1 });
    if (line === 'low' && aim === 'head') aim = 'legs';
    if (line === 'high' && aim === 'legs') aim = 'torso';
    return { id: b.nextId++, line, aim, heavy, chain, kind: o.kind || null,
      damage: Math.round(p.dmg * (heavy ? (p.heavyMul || 1.7) : 1) * m.damage),
      windup, strikeMs: Math.round(between(b.r, p.strikeMs) * (heavy ? 1.25 : 1) * (1 + 0.1 * b.wounds.armLevel)),
      feint: chain === 0 && !heavy && !o.fast && b.r() < (p.feint || 0), switched: false };
  }
  function switchFeint(b, trap) {
    const a = b.attack;
    const n = makeAttack(b, 0, { not: a.line, fast: true });
    n.feint = false; n.switched = true; n.heavy = false; n.damage = Math.round(b.p.dmg * mods(b).damage);
    n.windup = trap ? Math.round(between(b.r, [260, 340]) * mods(b).windup) : Math.max(320, Math.round(a.windup * 0.6));
    n.target = a.target; n.kind = trap ? 'trap' : 'feint';
    b.attack = n; b.elapsed = 0; b.trapped = !!trap;
    b.events.push({ type: 'feint', from: a.line, attack: n, trap: !!trap });
  }
  function startWindup(b, attack) {
    b.state = 'windup'; b.elapsed = 0; b.attack = attack; b.goal = b.guard = null; b.parryUntil = -1;
    b.distGoal = strikeDist(b, attack);
    b.events.push({ type: 'telegraph', attack });
  }
  /** How close he stands to land a blow on that target. */
  function strikeDist(b, a) {
    const r = b.p.range, lunge = mods(b).lunge;
    const d = a.line === 'thrust' ? r.thrust : a.aim === 'legs' ? r.strike - 0.12 : r.strike;
    return d + (1 - lunge) * 0.25;
  }
  /** Advance him by dt ms. Returns events: telegraph, feint, strike, recovered, guard, step, rearm, rise. */
  function brainStep(b, dt) {
    const ev = stepInner(b, dt);
    b.events = [];
    return ev;
  }
  function stepInner(b, dt) {
    const ev = b.events || (b.events = []);
    if (b.state === 'dead') return ev;
    b.now += dt; b.elapsed += dt;
    const m = mods(b);
    const fs = (b.p.footSpeed || 2.4) * m.feet * dt / 1000;
    if (b.dist < b.distGoal) b.dist = Math.min(b.distGoal, b.dist + fs * 1.2); else if (b.dist > b.distGoal) b.dist = Math.max(b.distGoal, b.dist - fs * (b.state === 'windup' ? 1.5 : 1));
    b.balance = Math.min(b.p.balance, b.balance + (b.p.balance * 0.12) * dt / 1000);
    if (b.goal && b.goal !== b.guard && b.now >= b.goalAt && (b.state === 'idle' || b.state === 'recover')) { b.guard = b.goal; ev.push({ type: 'guard', guard: b.guard }); }
    switch (b.state) {
      case 'idle':
        b.timer -= dt; b.footT -= dt;
        if (b.footT <= 0) {
          b.footT = between(b.r, [900, 2100]);
          const r = b.p.range, w = r.wobble || 0.15;
          b.distGoal = r.idle + (b.r() - 0.5) * 2 * w;
          ev.push({ type: 'step' });
        }
        // a patient fighter does not walk into a blade that is swinging: he waits for the gap after it
        if (b.timer <= 0 && b.now < (b.busyUntil || 0) && (b.waited || 0) < (b.p.patience || 0)) { b.timer = 120; b.waited = (b.waited || 0) + 120; break; }
        if (b.timer <= 0) {
          // out of patience with a blade that never stops: a snap attack, quick and where it is not
          const snap = b.p.patience > 0 && b.now < (b.busyUntil || 0);
          b.waited = 0;
          const [c0, c1] = b.p.combo || [1, 1];
          b.combo = snap ? 1 : c0 + Math.floor(b.r() * (c1 - c0 + 1));
          startWindup(b, makeAttack(b, 0, snap ? { fast: true, kind: 'snap' } : undefined));
        }
        break;
      case 'windup': {
        const a = b.attack;
        if (a.feint && !a.switched && b.elapsed >= a.windup * 0.5) { switchFeint(b, false); break; }
        if (b.elapsed >= a.windup) { b.state = 'strike'; b.elapsed = 0; ev.push({ type: 'strike', attack: a }); }
        break;
      }
      case 'strike':
        if (b.elapsed >= b.attack.strikeMs) { ev.push({ type: 'whiff', attack: b.attack }); endStrike(b, 'whiff'); }
        break;
      case 'recover':
        b.timer -= dt;
        if (b.timer <= 0) {
          if (b.attack && b.attack.chain + 1 < b.combo) { startWindup(b, makeAttack(b, b.attack.chain + 1, { not: b.attack.line })); break; }
          toIdle(b);
        }
        break;
      case 'stagger': case 'kneel':
        b.timer -= dt;
        if (b.timer <= 0) { const k = b.state === 'kneel'; toIdle(b); if (k) ev.push({ type: 'rise' }); }
        break;
      case 'disarmed':
        b.timer -= dt;
        if (b.timer <= 0) { b.armed = true; toIdle(b); ev.push({ type: 'rearm' }); }
        break;
    }
    return ev;
  }
  function toIdle(b) {
    b.state = 'idle'; b.attack = null; b.elapsed = 0; b.trapped = false;
    b.timer = b.r() < (b.p.rush || 0) ? between(b.r, [200, 450]) : between(b.r, b.p.gap);
    b.distGoal = b.p.range.idle;
    b.guard = null; b.goal = null;
    setGoal(b, guardFor(b, b.seen), true);
    b.events && b.events.push({ type: 'recovered' });
  }
  /** His strike is over: 'whiff' (met nothing), 'hit' (landed on you), 'blocked', 'parried', 'beaten' (drove through your guard). */
  function endStrike(b, how) {
    if (b.state !== 'strike' && b.state !== 'windup') return;
    if (how === 'parried') { stagger(b, b.p.staggerMs); return; }
    b.state = 'recover';
    b.timer = b.p.recover * (how === 'whiff' ? 1.25 : how === 'blocked' ? 0.85 : 1);
    if (how === 'blocked' && b.attack && b.r() < (b.p.followUp || 0)) b.combo = Math.max(b.combo, b.attack.chain + 2);
  }
  function stagger(b, ms) {
    if (b.state === 'dead') return;
    b.state = 'stagger'; b.timer = ms; b.guard = b.goal = null; b.attack = null; b.elapsed = 0; b.parryUntil = -1;
  }
  /** You beat his guard or his raised blade aside. */
  function brainBeaten(b) { stagger(b, b.p.staggerMs * 0.75); b.balance = Math.max(0, b.balance - b.p.balance * 0.3); }
  /** Your cut stopped on his guard: wears his balance; a riposting fighter answers at once. Returns the riposte or null. */
  function brainBlocked(b, power) {
    b.balance -= 10 + 25 * power;
    if (b.balance <= 0) { b.balance = b.p.balance; stagger(b, b.p.staggerMs * 0.8); return 'broken'; }
    if (b.state === 'idle' && b.r() < (b.p.riposte || 0)) { b.combo = 1; startWindup(b, makeAttack(b, 0, { fast: true, kind: 'riposte' })); return b.attack; }
    return null;
  }
  /** He beat your cut away: you are open, he ripostes. */
  function brainParriedYou(b) {
    b.parryUntil = -1;
    if (b.state !== 'idle') return null;
    b.combo = 1; startWindup(b, makeAttack(b, 0, { fast: true, kind: 'riposte' }));
    return b.attack;
  }
  /** You are open (a missed full swing, a beaten guard): a killer comes in on the side your blade is not. */
  function brainOpening(b, notLine) {
    if (b.state !== 'idle') return null;
    if (b.r() >= (b.p.punish || 0)) return null;
    b.combo = 1; startWindup(b, makeAttack(b, 0, { fast: true, kind: 'punish', not: notLine }));
    return b.attack;
  }
  /**
   * Your blade landed on him. res = strikeDamage result, zone. Applies wounds, balance, stagger,
   * interrupts a wind-up on a counter. Returns the wound effects.
   */
  function brainHit(b, res, zone) {
    b.lastHitT = b.now;
    const fx = applyWound(b.wounds, zone, res.damage, { armed: b.armed && !b.p.beast && b.p.weapon !== 'fist', shield: b.shield, rng: b.r });
    b.balance -= res.damage * 1.2;
    if (fx.disarm && b.armed) { b.armed = false; b.state = 'disarmed'; b.timer = b.p.disarmMs || 2600; b.attack = null; b.distGoal = b.p.range.idle + 0.5; return fx; }
    if (fx.shieldDrop) b.shield = false;
    if (fx.kneel && b.state !== 'dead') { b.state = 'kneel'; b.timer = 2200; b.attack = null; b.guard = b.goal = null; b.distGoal = b.p.range.idle; return fx; }
    // a brute's heavy wind-up shrugs off a light cut
    const interrupt = res.counter && res.damage >= Math.max(10, b.attack && b.attack.heavy ? b.p.hyper || 0 : 0);
    const shrugged = b.state === 'windup' && b.attack && b.attack.heavy && res.damage < (b.p.hyper || 0);
    if (!shrugged && (res.stagger || interrupt || b.balance <= 0)) { if (b.balance <= 0) b.balance = b.p.balance * 0.6; stagger(b, b.p.staggerMs * (res.stagger ? 0.75 : 0.5)); }
    else if (b.r() < (b.p.retreat || 0) && b.state === 'idle') b.distGoal = b.p.range.idle + 0.3;
    return fx;
  }
  function brainKill(b) { b.state = 'dead'; b.attack = null; b.guard = b.goal = null; }
  /** Is he beating into a blow right now (an active parry)? */
  const brainParrying = b => b.state === 'idle' && b.now < b.parryUntil;

  /* --------------------------------------------------------------- ladder */
  const L = (o) => o;
  const HUMAN_GUARDS = ['left', 'right', 'high', 'low', 'mid'];
  const LADDER = [
    { title: 'Bout I', name: 'Cassia the Recruit', intro: 'A fresh recruit with a borrowed sword. Slow, honest cuts.',
      lesson: 'Watch her sword hand draw back: the side it goes is the side it comes from. Put your blade there and meet it. Then cut where her blade is not.',
      foes: [L({ id: 'recruit', name: 'Cassia', model: 'recruit', weapon: 'sword', hp: 100, dmg: 11, height: 1.8,
        windup: [950, 1200], strikeMs: [230, 270], recover: 900, gap: [1300, 2000], combo: [1, 1], heavy: 0, feint: 0,
        lines: { left: 1, right: 0.8, highLeft: 0.6, high: 0.4 }, aims: { torso: 1, head: 0.4, arm: 0.2 },
        guards: HUMAN_GUARDS, react: [430, 560], guardSkill: 0.55, read: 0.3, parry: 0.06, riposte: 0.15, punish: 0.3, punishWindup: [700, 820],
        aim: 0.3, followUp: 0, retreat: 0.1, guardStrength: 14, staggerMs: 1500, balance: 70, disarmMs: 2800,
        range: { idle: 1.5, strike: 1.3, thrust: 1.4, wobble: 0.08 }, footSpeed: 2.2, armor: {} })] },
    { title: 'Bout II', name: 'The Grey Pack', intro: 'Two starved wolves, hunting as a pair. They go for the legs.',
      lesson: 'No blade to beat: hold your point low in their path and they run onto it. Cut the one that leaps.',
      foes: [0, 1].map(i => L({ id: 'wolf' + i, name: i ? 'Grey Wolf' : 'Wolf', model: 'wolf', weapon: 'jaws', beast: true, pack: true, hp: 45, dmg: 9, height: 0.95,
        windup: [650, 820], strikeMs: [260, 300], recover: 700, gap: [800, 1400], combo: [1, 2], comboWindup: 0.8,
        lines: { thrust: 1 }, aims: { legs: 1.4, arm: 0.6 }, guards: null, react: [300, 400], punish: 0.75, punishWindup: [480, 600], aim: 0,
        staggerMs: 1100, balance: 30, range: { idle: 2.7, strike: 1.95, thrust: 1.95, wobble: 0.35 }, footSpeed: 3.4, rush: 0.25, armor: {} })) },
    { title: 'Bout III', name: 'Ossian the Bone Legionary', intro: 'A dead legionary behind a round shield. He never tires and reads a lazy arm.',
      lesson: 'Cuts into the shield do nothing. Go round it, under it, or cut the arm that holds it and it falls.',
      foes: [L({ id: 'skeleton', name: 'Ossian', model: 'skeleton', weapon: 'sword', shield: true, hp: 130, dmg: 13, height: 1.85,
        windup: [700, 880], strikeMs: [200, 240], recover: 760, gap: [900, 1500], combo: [1, 3], comboWindup: 0.75, heavy: 0.1, feint: 0.12,
        lines: { left: 1, highLeft: 0.8, thrust: 0.5, low: 0.4 }, aims: { torso: 1, head: 0.5, arm: 0.4, legs: 0.3 },
        guards: HUMAN_GUARDS, react: [300, 400], guardSkill: 0.8, read: 0.7, parry: 0.18, riposte: 0.35, punish: 0.7, punishWindup: [380, 460], patience: 1500,
        aim: 0.55, followUp: 0.35, retreat: 0.1, guardStrength: 17, shieldStrength: 28, staggerMs: 1250, balance: 90, disarmMs: 2600,
        range: { idle: 1.5, strike: 1.3, thrust: 1.4, wobble: 0.08 }, footSpeed: 2.2, armor: { head: 0.3 } })] },
    { title: 'Bout IV', name: 'Brakka the Axe', intro: 'A long axe and a short temper. Huge, slow, crushing blows.',
      lesson: 'A heavy chop drives straight through a blade held still or caught near the tip. Meet it hard near your hilt, or be somewhere else. His wind-up is long: cut into it.',
      foes: [L({ id: 'axeman', name: 'Brakka', model: 'axeman', weapon: 'axe', hp: 160, dmg: 15, height: 1.92,
        windup: [950, 1250], strikeMs: [290, 340], recover: 1100, gap: [800, 1300], combo: [1, 2], comboWindup: 0.85, heavy: 0.55, rush: 0.3, heavyMul: 1.7, feint: 0.05,
        lines: { highLeft: 1, high: 1.2, left: 0.8, right: 0.5 }, aims: { torso: 1, head: 0.8, arm: 0.3 },
        guards: ['left', 'right', 'high', 'mid'], react: [360, 480], guardSkill: 0.7, read: 0.55, parry: 0.08, riposte: 0.2, punish: 0.6, punishWindup: [520, 600],
        aim: 0.5, followUp: 0.3, retreat: 0.05, hyper: 26, guardStrength: 20, staggerMs: 1400, balance: 120, disarmMs: 3000,
        range: { idle: 1.55, strike: 1.36, thrust: 1.4, wobble: 0.1 }, footSpeed: 2.0, armor: { torso: 0.4 } })] },
    { title: 'Bout V', name: 'Grumhold the Hill Troll', intro: 'Thick hide and a studded club as long as you are. Only your hardest cuts bite.',
      lesson: 'Nothing stops a troll\'s fist: a blade held in its way is smashed through. Cut the arm as it comes, hard, and he howls. Go for the head when he stoops.',
      foes: [L({ id: 'troll', name: 'Grumhold', model: 'troll', weapon: 'fist', beast: true, hp: 210, dmg: 20, height: 2.6,
        windup: [900, 1150], strikeMs: [300, 360], recover: 1200, gap: [1100, 1800], combo: [1, 2], comboWindup: 0.85, heavy: 0.6, heavyMul: 1.4, feint: 0,
        lines: { left: 1.2, highLeft: 1, high: 0.8, low: 0.5 }, aims: { torso: 1, head: 0.6, legs: 0.4 },
        guards: null, react: [380, 480], punish: 0.7, punishWindup: [650, 780], aim: 0.55, hyper: 28, staggerMs: 1300, balance: 160,
        range: { idle: 2.5, strike: 2.05, thrust: 2.1, wobble: 0.12 }, footSpeed: 1.8,
        armor: { torso: 0.45, legs: 0.35, swordArm: 0.2, offArm: 0.2 } })] },
    { title: 'Final', name: 'Aurelian the Gilded', intro: 'The undefeated champion. A sword in one hand, a parrying dagger in the other.',
      lesson: 'He thrusts from far out, feints, and his dagger takes anything predictable. Change lines, meet his point, and strike only into an opening.',
      foes: [L({ id: 'champion', name: 'Aurelian', model: 'champion', weapon: 'sword', dagger: true, hp: 170, dmg: 14, height: 1.85,
        windup: [480, 650], strikeMs: [170, 210], recover: 650, gap: [700, 1300], combo: [1, 3], comboWindup: 0.8, heavy: 0.12, feint: 0.32,
        lines: { thrust: 1.3, left: 1, right: 0.9, highLeft: 0.7, highRight: 0.6, low: 0.4 }, aims: { torso: 1, head: 0.7, arm: 0.6, legs: 0.4 },
        guards: HUMAN_GUARDS, react: [190, 260], guardSkill: 0.92, read: 0.9, parry: 0.3, riposte: 0.55, punish: 0.85, punishWindup: [260, 340], patience: 2500,
        aim: 0.75, followUp: 0.5, retreat: 0.3, rush: 0.3, guardStrength: 18, daggerStrength: 13, staggerMs: 1100, balance: 110, disarmMs: 2200,
        range: { idle: 1.65, strike: 1.32, thrust: 1.55, wobble: 0.2 }, footSpeed: 2.8, armor: { head: 0.45 } })] },
  ];
  /** The training post: a wooden swordsman on a spring arm. Never falls, swings back on a slow beat. */
  const DUMMY = { id: 'dummy', name: 'The Palus', model: 'dummy', weapon: 'sword', hp: Infinity, dmg: 0, height: 1.8,
    windup: [1300, 1500], strikeMs: [300, 340], recover: 900, gap: [2200, 3200], combo: [1, 1], heavy: 0, feint: 0,
    lines: { left: 1, right: 1, high: 0.6, highLeft: 0.6, highRight: 0.6 }, aims: { torso: 1, head: 0.5 },
    guards: null, react: [500, 600], punish: 0, aim: 0.4, staggerMs: 900, balance: 1e9,
    range: { idle: 1.3, strike: 1.3, thrust: 1.3, wobble: 0 }, footSpeed: 0, armor: {} };

  /* ------------------------------------------------------------ tutorial */
  /*
   * Five short steps at the training post, each finished by doing it, each with a tip that answers
   * what you just did. Events: aligned, hit {kind, dmg, speed}, whiff, blocked, parry, beaten, hurt, lunge.
   */
  const TUTORIAL = [
    { id: 'align', title: 'HOLD THE SWORD', need: 1, text: 'Hold the phone like a sword hilt and point it at the post. Hold still.' },
    { id: 'cut', title: 'CUT', need: 3, text: 'Swing through the post, hard. Speed is damage. Lead with the edge.' },
    { id: 'block', title: 'BLOCK', need: 2, text: 'Its arm swings at you. Put your blade in the way and hold it there.' },
    { id: 'parry', title: 'PARRY', need: 1, text: 'Now swing into its blow just as it lands. That is a parry.' },
    { id: 'thrust', title: 'THRUST', need: 1, text: 'Point at its chest and push the phone straight forward.' },
  ];
  function tutorialStart() { return { step: 0, count: 0, done: false, tip: null, good: false }; }
  /** Feed one thing that happened. Returns { advanced, tip, good } and updates t. */
  function tutorialEvent(t, ev) {
    if (t.done) return { advanced: false, tip: null, good: false };
    const id = TUTORIAL[t.step].id;
    let ok = false, tip = null;
    switch (id) {
      case 'align': if (ev.type === 'aligned') { ok = true; tip = 'Lined up.'; } break;
      case 'cut':
        if (ev.type === 'hit') {
          if (ev.kind === 'flat') tip = 'That hit with the flat. Turn your wrist so the edge leads.';
          else if (ev.dmg < 8) tip = 'Too soft. Swing faster: speed is damage.';
          else { ok = true; tip = 'Clean cut, ' + Math.round(ev.speed) + ' m/s.'; }
        } else if (ev.type === 'whiff') tip = 'Missed. The post is in reach: swing through its body.';
        break;
      case 'block':
        if (ev.type === 'blocked' || ev.type === 'parry') { ok = true; tip = ev.type === 'parry' ? 'Parried, even better.' : 'Blocked.'; }
        else if (ev.type === 'hurt') tip = 'It got through. Hold your blade across the line it swings on.';
        else if (ev.type === 'beaten') tip = 'Beaten through. Catch it nearer your hilt.';
        break;
      case 'parry':
        if (ev.type === 'parry') { ok = true; tip = 'Parry! It is wide open.'; }
        else if (ev.type === 'blocked') tip = 'Blocked. Now swing into it as it lands.';
        else if (ev.type === 'hurt' || ev.type === 'beaten') tip = 'Too late. Start your swing as its arm comes round.';
        break;
      case 'thrust':
        if (ev.type === 'hit' && ev.kind === 'thrust') { ok = true; tip = 'Thrust, ' + Math.round(ev.speed) + ' m/s.'; }
        else if (ev.type === 'hit') tip = 'That was a cut. Point at it and push straight forward.';
        else if (ev.type === 'lunge') tip = 'Aim at the middle of the post.';
        break;
    }
    let advanced = false;
    if (ok && ++t.count >= TUTORIAL[t.step].need) { t.step++; t.count = 0; advanced = true; if (t.step >= TUTORIAL.length) t.done = true; }
    if (tip || ok) { t.tip = tip; t.good = ok; }   // an unrelated event leaves the last tip up
    return { advanced, tip, good: ok };
  }

  /* --------------------------------------------------------------- fame */
  const FAME = { hit: d => Math.round(20 + 6 * d), counter: 120, parry: 250, block: 30, beat: 200, kill: 500, flawless: 600, taken: -4, disarm: 300, kneel: 200 };
  function rankFor(fame, won) {
    if (won >= LADDER.length) return 'Champion of the Circus';
    if (won >= 4 || fame > 6000) return 'Crowd Favourite';
    if (won >= 2) return 'Veteran';
    if (won >= 1) return 'Tiro';
    return 'Fodder';
  }

  /* ------------------------------------------------------------- versus */
  // two people, the same blades, the same wounds; no telegraphs but their own bodies
  const PVP = { roundMs: 90000, rounds: 2, hp: 100 };
  function pvpRoundWinner(hp0, hp1, timeUp) {
    if (hp0 <= 0 && hp1 <= 0) return -1;
    if (hp1 <= 0) return 0;
    if (hp0 <= 0) return 1;
    if (!timeUp) return null;
    return Math.abs(hp0 - hp1) < 1 ? -1 : hp0 > hp1 ? 0 : 1;
  }
  /** Two moving blades met. Each side: { speed (its contact point), into (toward the other blade), u }. */
  function bladeMeet(a, b) {
    const pa = a.into, pb = b.into;
    if (pa > PARRY.into && pa > pb * 1.5 + 2 && a.u <= PARRY.maxU) return 'aBeats';
    if (pb > PARRY.into && pb > pa * 1.5 + 2 && b.u <= PARRY.maxU) return 'bBeats';
    return 'clash';
  }

  const api = { BODY, ARM, solveArm, v3, add, sub, scale, dot, cross, len, norm, lerp, rng, clamp, smooth,
    closestSegSeg, sweepSegSeg, sweepBody, sweepDisc, pointVel,
    STRIKE, classifyContact, cutPower, thrustPower, strikeDamage, ZONE_MUL, PARRY, judgeBlock, judgeCut,
    SWING, swingTracker, swingStep, lineOf,
    TRAVEL, LINE_GUARD, LINE_DIR, aimPoint, attackPose, impactAt,
    woundState, applyWound, woundMods,
    createBrain, brainStep, brainSee, brainSwing, brainBeaten, brainBlocked, brainParriedYou, brainOpening, brainHit, brainKill,
    brainParrying, endStrike, stagger, TUTORIAL, tutorialStart, tutorialEvent, LADDER, DUMMY, FAME, rankFor, PVP, pvpRoundWinner, bladeMeet };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LudusCombat = api;
})(typeof window !== 'undefined' ? window : this);
