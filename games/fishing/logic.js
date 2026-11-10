/*
 * Tidecast - the pure rules: casting from the rod's real motion, the lure's flight, the reel
 * crank, the strike jerk, fish that notice / nibble / strike, and the fight on the line.
 * World frame = three.js (x right, y up, z toward the player; the sea lies along -Z).
 * Run the tests: node games/fishing/test/<name>.test.js
 */
(function (root) {
  'use strict';
  const G = 9.81;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const len = a => Math.hypot(a.x, a.y, a.z);
  const norm = a => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
  const wrap = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

  /** Seeded generator (tests and replays): returns () => [0, 1). */
  function rng32(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  // ------------------------------------------------------------------ casting
  /*
   * Casting reads the whole forward stroke, not the instant of release. A real overhead flick
   * (recorded on a phone, 2026-11-10) comes over the top in 80-120 ms at 15-30 rad/s, and players
   * let go of A at the END of it (40-120 ms after the peak) or during the backswing: judging the
   * cast by the tip velocity at the release sample threw almost every cast into the water at
   * their feet. Now: distance = how hard the stroke was (its peak turn rate), direction = where
   * the rod points at the follow-through (where you stop it), and release timing only nudges
   * the arc inside a wide window. All of it is still the phone's raw motion, 1:1.
   */
  const ROD_LEN = 2.2;           // m, butt (the phone) to tip
  const CAST = {
    W_MIN: 4,                    // rad/s: a stroke slower than this is not a cast
    W_FULL: 27,                  // rad/s: a full-power flick (recorded flicks: 16-29)
    V_MIN: 8, V_MAX: 31,         // m/s launch speed from the weakest to a full flick
    WIN_BEFORE: 0.45, WIN_AFTER: 0.35,   // s around the release in which the stroke may lie
    DRAG: 0.0105,                // 1/m, air + line drag (quadratic)
    LINE: 0.18,                  // m/s^2 per m/s, line peeling off the spool (linear)
  };
  const ang = (a, b) => Math.acos(clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1));

  /** Turn rate of the rod (rad/s) at each sample, measured over at least 50 ms (robust to repeats). */
  function strokeSpeeds(samples) {
    const out = new Array(samples.length).fill(0);
    for (let i = 1; i < samples.length; i++) {
      let j = i - 1;
      while (j > 0 && samples[i].t - samples[j].t < 0.05) j--;
      const dt = samples[i].t - samples[j].t;
      if (dt > 1e-3) out[i] = ang(samples[j].f, samples[i].f) / dt;
    }
    return out;
  }

  /**
   * The strongest stroke whose peak lies in [t0, t1]. samples: [{t, f}] (rod direction, newest
   * last). Returns { peakT, w, follow (rod direction at the follow-through), heading, forward,
   * done (the stroke has finished) } or null.
   */
  function findStroke(samples, t0, t1) {
    const w = strokeSpeeds(samples);
    let best = null;
    for (let i = 1; i < samples.length; i++) {
      const s = samples[i];
      if (s.t < t0 || s.t > t1 || w[i] < CAST.W_MIN) continue;
      if (w[i] >= (w[i - 1] || 0) && w[i] >= (w[i + 1] || 0)) {
        // follow-through: where the rod is once the stroke has died down (or 0.15 s on)
        let k = i, done = false;
        while (k + 1 < samples.length && samples[k + 1].t - s.t <= 0.15) { k++; if (w[k] < w[i] * 0.35) { done = true; break; } }
        if (!done && samples[samples.length - 1].t - s.t >= 0.15) done = true;
        const f = samples[k].f;
        const heading = Math.atan2(f.x, -f.z);
        const cand = { peakT: s.t, w: w[i], follow: f, heading, forward: Math.abs(heading) < 100 * Math.PI / 180 && f.y < 0.85, done };
        // prefer forward strokes: a fast backswing must not beat the cast that follows it
        if (!best || (cand.forward && !best.forward) || (cand.forward === best.forward && cand.w > best.w)) best = cand;
      }
    }
    return best;
  }

  /**
   * Launch from a stroke. releaseT: when A came up (null = released at the peak, Snap mode).
   * Release timing is a refinement: early (before the peak) lobs it high and short, around the
   * peak to well into the follow-through is clean, very late flattens it.
   */
  function castFromStroke(st, releaseT) {
    const s = clamp((st.w - CAST.W_MIN) / (CAST.W_FULL - CAST.W_MIN), 0, 1.12);
    let speed = lerp(CAST.V_MIN, CAST.V_MAX, Math.min(1, s)) + Math.max(0, s - 1) * 18;
    const dt = releaseT === null || releaseT === undefined ? 0.03 : releaseT - st.peakT;
    let elevDeg, timing;
    if (dt < -0.18) { elevDeg = 60; speed *= 0.8; timing = 'early'; }
    else if (dt < -0.08) { elevDeg = 47; timing = 'a touch early'; }
    else if (dt <= 0.22) { elevDeg = 37 - Math.max(0, dt) * 22; timing = 'clean'; }
    else if (dt <= 0.32) { elevDeg = 25; speed *= 0.92; timing = 'a touch late'; }
    else { elevDeg = 15; speed *= 0.8; timing = 'late'; }
    const elev = elevDeg * Math.PI / 180, heading = st.heading;
    const v = { x: speed * Math.cos(elev) * Math.sin(heading), y: speed * Math.sin(elev), z: -speed * Math.cos(elev) * Math.cos(heading) };
    return { speed, heading, elev, v, power: Math.min(1, s), timing, backward: !st.forward, dt };
  }

  /**
   * The live cast detector, one rod sample at a time ({t, f, a}). mode 'thumb': letting go of A
   * casts with the stroke around that moment (waiting up to WIN_AFTER for a stroke still to
   * come); 'snap': the line flies when a forward flick finishes, no button. Returns null, a
   * launch (castFromStroke), or { fail: 'weak' | 'backward' }.
   */
  function createCaster() { return { hist: [], held: false, pending: null, last: -9 }; }
  function stepCaster(c, smp, mode) {
    c.hist.push({ t: smp.t, f: smp.f });
    while (c.hist.length > 2 && smp.t - c.hist[0].t > 1.3) c.hist.shift();
    if (mode === 'snap') {
      if (smp.t - c.last < 1) return null;
      const st = findStroke(c.hist, smp.t - 0.4, smp.t);
      if (st && st.done && st.forward && st.w >= CAST.W_MIN + 4) { c.last = smp.t; c.hist.length = 0; return castFromStroke(st, null); }
      return null;
    }
    if (smp.a) { c.held = true; c.pending = null; return null; }
    if (c.held) { c.held = false; c.pending = smp.t; }
    if (c.pending === null) return null;
    const rel = c.pending, st = findStroke(c.hist, rel - CAST.WIN_BEFORE, rel + CAST.WIN_AFTER);
    const late = smp.t > rel + CAST.WIN_AFTER + 0.15;
    if (!(st && st.done) && !late) return null;
    c.pending = null; c.last = smp.t;
    if (!st) return { fail: 'weak' };
    if (!st.forward) return { fail: 'backward' };
    return castFromStroke(st, rel);
  }

  /** Why a cast went where it did, for the words over the float. */
  function castWord(l) {
    if (l.timing === 'early') return 'let go too early: lobbed';
    if (l.timing === 'late') return 'let go late: flat';
    if (l.power < 0.3) return 'gentle flick: snap it harder for distance';
    if (l.timing !== 'clean') return l.timing;
    return l.power > 0.85 ? 'full power, clean release' : 'clean release';
  }

  /** One integration step of the rig in the air (semi-implicit Euler). s = {x,y,z,vx,vy,vz}. */
  function stepFlight(s, dt) {
    const sp = Math.hypot(s.vx, s.vy, s.vz);
    const k = CAST.DRAG * sp + CAST.LINE;
    s.vx -= s.vx * k * dt;
    s.vz -= s.vz * k * dt;
    s.vy -= (G + s.vy * k) * dt;
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    return s;
  }

  /** Where a launch from height h lands on the water (y = 0): {x, z, dist, t}. */
  function landing(launch, h, from) {
    from = from || { x: 0, z: 0 };
    const s = { x: from.x, y: h, z: from.z, vx: launch.v.x, vy: launch.v.y, vz: launch.v.z };
    let t = 0;
    while (s.y > 0 && t < 20) { stepFlight(s, 1 / 240); t += 1 / 240; }
    return { x: s.x, z: s.z, dist: Math.hypot(s.x - from.x, s.z - from.z), t };
  }

  // ------------------------------------------------------------------ reel crank
  const LINE_PER_TURN = 1.0;    // m of line per crank turn (a fast spinning reel)
  const A_REEL = 2.4;          // m/s when the reel button is held instead
  const CRANK = { TAU_MEAN: 0.3, MIN_R: 0.035, MAX_R: 0.4, MAX_STEP: 1.4, TAU_RATE: 0.12, MAX_TPS: 4 };

  /**
   * Turning the reel = circling the rod tip. The rod's slow-moving mean direction is the axle;
   * the tip's offset from it, as an angle around the axle, advances one full turn per circle.
   * Either direction reels.
   */
  function createCrank() { return { m: null, a: null, rate: 0, tps: 0 }; }
  function stepCrank(cr, f, dt) {
    if (!cr.m) { cr.m = { x: f.x, y: f.y, z: f.z }; cr.a = null; return 0; }
    const k = 1 - Math.exp(-dt / CRANK.TAU_MEAN);
    cr.m = norm({ x: cr.m.x + (f.x - cr.m.x) * k, y: cr.m.y + (f.y - cr.m.y) * k, z: cr.m.z + (f.z - cr.m.z) * k });
    const m = cr.m;
    // basis around the axle: u horizontal, w = m x u (stays well defined unless pointing straight up)
    let u = cross(m, { x: 0, y: 1, z: 0 });
    if (len(u) < 0.2) u = cross(m, { x: 0, y: 0, z: 1 });
    u = norm(u);
    const w = cross(m, u);
    const e = { x: f.x - m.x, y: f.y - m.y, z: f.z - m.z };
    const eu = dot(e, u), ew = dot(e, w), r = Math.hypot(eu, ew);
    const kr = 1 - Math.exp(-dt / CRANK.TAU_RATE);
    // a circle has a small, steady radius; a big haul of the rod (pumping a fish) is not a crank,
    // and neither is a swing that crosses the axle (the angle jumps by half a turn)
    if (r < CRANK.MIN_R || r > CRANK.MAX_R) { cr.a = null; cr.rate += (0 - cr.rate) * kr; }
    else {
      const a = Math.atan2(ew, eu);
      if (cr.a !== null) {
        const da = wrap(a - cr.a);
        if (Math.abs(da) > CRANK.MAX_STEP) cr.rate += (0 - cr.rate) * kr;
        else cr.rate += (clamp(da / Math.max(dt, 1e-3), -CRANK.MAX_TPS * TAU, CRANK.MAX_TPS * TAU) - cr.rate) * kr;
      }
      cr.a = a;
    }
    cr.tps = Math.abs(cr.rate) / TAU;
    return cr.tps;
  }
  function reelSpeed(tps, holdA) { return Math.max(tps * LINE_PER_TURN, holdA ? A_REEL : 0); }

  // ------------------------------------------------------------------ the strike jerk
  /** Rate (rad/s) at which the rod tip pitches up, from the world angular velocity. */
  function pitchUpRate(rodDir, angVel) {
    const r = cross(rodDir, { x: 0, y: 1, z: 0 });
    const l = Math.hypot(r.x, r.z);
    if (l < 0.15) return 0;   // rod straight up or down: no pitch axis
    return (angVel.x * r.x + angVel.z * r.z) / l;
  }
  const JERK = { STRIKE_RISE: 0.32, STRIKE_RATE: 3.4, TWITCH_RISE: 0.12, TWITCH_RATE: 1.8, WINDOW: 0.2 };
  /**
   * hist: [{t, pitch, rate}] newest last (rod pitch in rad, pitch-up rate in rad/s).
   * 'strike' = a sharp lift (rises STRIKE_RISE within WINDOW s, peak rate >= STRIKE_RATE);
   * 'twitch' = a small quick lift; null otherwise. Returns the strength 0..1 too.
   */
  function detectJerk(hist) {
    if (hist.length < 2) return null;
    const now = hist[hist.length - 1];
    let low = now.pitch, peak = 0;
    for (let i = hist.length - 1; i >= 0 && now.t - hist[i].t <= JERK.WINDOW; i--) {
      low = Math.min(low, hist[i].pitch); peak = Math.max(peak, hist[i].rate);
    }
    const rise = now.pitch - low;
    if (rise >= JERK.STRIKE_RISE && peak >= JERK.STRIKE_RATE) return { kind: 'strike', strength: clamp((peak - JERK.STRIKE_RATE) / 6 + 0.4, 0, 1), rise };
    if (rise >= JERK.TWITCH_RISE && peak >= JERK.TWITCH_RATE) return { kind: 'twitch', strength: clamp(peak / JERK.STRIKE_RATE, 0, 1), rise };
    return null;
  }

  // ------------------------------------------------------------------ fish
  /*
   * Personalities. power: pull at full stamina (1 ~ the line's strength); speed: run speed m/s;
   * stamina: how long it fights; jumpy / thrash / charge: how often it leaps, head-shakes, or
   * rushes the dock; nibbles: taps before the strike; window: s to set the hook after the strike;
   * curiosity / wary: notices a lure / spooks at splashes; likesMotion: strikes a moving lure.
   */
  const SPECIES = [
    { id: 'perch', name: 'Copper Perch', blurb: 'Nosy, nibbly, never far from the dock.', kg: [0.2, 0.9], len: [18, 32], spawn: 30,
      power: 0.34, speed: 2.4, stamina: 0.42, jumpy: 0.12, thrash: 0.45, charge: 0.1, runLen: [0.8, 1.8], restLen: [1.2, 2.4],
      nibbles: [1, 3], window: 1.4, curiosity: 1.0, wary: 0.15, likesMotion: 0.2, senseR: 9, depth: 0.5, slackTol: 1.9,
      look: { back: '#5a3d1c', side: '#d9893a', belly: '#f7dfb4', fin: '#e8763a', mark: 'bars', h: 0.42, w: 0.2 } },
    { id: 'mackerel', name: 'Glass Mackerel', blurb: 'Hits anything that moves. Reel it past them.', kg: [0.4, 1.4], len: [28, 44], spawn: 20,
      power: 0.44, speed: 5.0, stamina: 0.5, jumpy: 0.15, thrash: 0.3, charge: 0.35, runLen: [0.5, 1.1], restLen: [0.5, 1.0],
      nibbles: [0, 1], window: 1.05, curiosity: 0.75, wary: 0.3, likesMotion: 1, senseR: 13, depth: 0.35, slackTol: 2.0,
      look: { back: '#1f5a6e', side: '#9fd6dc', belly: '#eef6f2', fin: '#4d8a96', mark: 'waves', h: 0.24, w: 0.16 } },
    { id: 'bass', name: 'Tidebass', blurb: 'Steady, stubborn runner. Keep the rod up.', kg: [1, 4.5], len: [35, 66], spawn: 22,
      power: 0.58, speed: 3.2, stamina: 0.85, jumpy: 0.12, thrash: 0.25, charge: 0.25, runLen: [1.4, 3.0], restLen: [1.0, 2.2],
      nibbles: [0, 2], window: 1.25, curiosity: 0.6, wary: 0.45, likesMotion: 0.4, senseR: 11, depth: 1.0, slackTol: 1.8,
      look: { back: '#2c3b2a', side: '#8d9c6a', belly: '#e6e2c4', fin: '#56603e', mark: 'stripes', h: 0.32, w: 0.19 } },
    { id: 'snapper', name: 'Ember Snapper', blurb: 'Shakes its head like it means it.', kg: [1.5, 6], len: [38, 70], spawn: 14,
      power: 0.68, speed: 3.0, stamina: 1.15, jumpy: 0.05, thrash: 0.7, charge: 0.1, runLen: [1.0, 2.2], restLen: [0.9, 1.8],
      nibbles: [1, 2], window: 1.2, curiosity: 0.55, wary: 0.4, likesMotion: 0.3, senseR: 10, depth: 1.2, slackTol: 1.6,
      look: { back: '#8a1f22', side: '#ef5b3f', belly: '#ffd0b0', fin: '#d8452e', mark: 'spots', h: 0.38, w: 0.18 } },
    { id: 'ray', name: 'Dusk Ray', blurb: 'Glides off the bottom and just keeps going.', kg: [4, 14], len: [60, 120], spawn: 7,
      power: 0.82, speed: 2.4, stamina: 1.3, jumpy: 0, thrash: 0.05, charge: 0, runLen: [2.5, 4.5], restLen: [1.5, 2.5],
      nibbles: [1, 2], window: 1.4, curiosity: 0.45, wary: 0.6, likesMotion: 0.1, senseR: 9, depth: 1.8, slackTol: 2.0, flat: true,
      look: { back: '#3d3550', side: '#6e5f86', belly: '#f2eaf2', fin: '#4a3f60', mark: 'speckle', h: 0.12, w: 0.9 } },
    { id: 'tarpon', name: 'Silver Tarpon', blurb: 'Leaps clean out. Bow the rod when it jumps.', kg: [6, 22], len: [80, 150], spawn: 5,
      power: 0.9, speed: 4.4, stamina: 1.3, jumpy: 0.65, thrash: 0.3, charge: 0.2, runLen: [1.4, 3.0], restLen: [1.0, 2.0],
      nibbles: [0, 1], window: 1.05, curiosity: 0.5, wary: 0.5, likesMotion: 0.6, senseR: 12, depth: 0.8, slackTol: 1.5,
      look: { back: '#4b5f6e', side: '#d6e2ea', belly: '#ffffff', fin: '#8aa1b0', mark: 'scales', h: 0.27, w: 0.15 } },
    { id: 'grouper', name: 'Gilded Grouper', blurb: 'Rises at sundown. Nobody has landed it twice.', kg: [25, 60], len: [120, 190], spawn: 0, legendary: true,
      power: 1.0, speed: 2.8, stamina: 1.8, jumpy: 0, thrash: 0.5, charge: 0.15, runLen: [1.8, 3.6], restLen: [1.0, 2.0],
      nibbles: [1, 2], window: 1.3, curiosity: 0.9, wary: 0.1, likesMotion: 0.3, senseR: 16, depth: 1.6, slackTol: 1.8,
      look: { back: '#5a3b10', side: '#e2a640', belly: '#fff0c2', fin: '#c07a1c', mark: 'spots', h: 0.4, w: 0.26 } },
  ];
  const byId = id => SPECIES.find(s => s.id === id);

  function pickSpecies(rng, legendary) {
    if (legendary) return byId('grouper');
    const pool = SPECIES.filter(s => s.spawn > 0);
    let r = rng() * pool.reduce((a, s) => a + s.spawn, 0);
    for (const s of pool) { r -= s.spawn; if (r < 0) return s; }
    return pool[0];
  }
  const BOUNDS = { x0: -28, x1: 28, z0: -5, z1: -50 };

  /** A new fish: size skews small (most catches are ordinary, trophies are rare). */
  function spawnFish(rng, opts) {
    opts = opts || {};
    const sp = opts.species ? byId(opts.species) : pickSpecies(rng, opts.legendary);
    const size = Math.pow(rng(), 1.7);
    const b = opts.bounds || BOUNDS;
    return {
      id: opts.id || 0, sp, size, kg: +(lerp(sp.kg[0], sp.kg[1], size)).toFixed(2), cm: Math.round(lerp(sp.len[0], sp.len[1], size)),
      x: opts.x !== undefined ? opts.x : lerp(b.x0, b.x1, rng()), z: opts.z !== undefined ? opts.z : lerp(b.z0, b.z1, rng()),
      h: rng() * TAU, v: 0.5, state: 'wander', t: 0, lure: -1, nibLeft: 0, nibT: 0, cool: 0, turnT: 0, phase: rng() * TAU,
    };
  }

  /** A splash at (x, z): fish right underneath may bolt. Returns true if it spooked. */
  function splashNear(f, x, z, rng, big) {
    const d = Math.hypot(f.x - x, f.z - z);
    const r = (big ? 2.2 : 1.4) + f.sp.wary * 2;
    if (d > r || f.state === 'flee') return false;
    if (rng() < f.sp.wary + (big ? 0.35 : 0.1)) { flee(f, x, z); return true; }
    return false;
  }
  function flee(f, x, z) {
    f.state = 'flee'; f.t = 2.2; f.lure = -1; f.cool = 6;
    f.h = Math.atan2(f.x - x, -(f.z - z));
  }

  /**
   * One step for a free fish. lures: [{id, x, z, inWater, age (s since splashdown), twitch (s since
   * last twitch), moving (m/s retrieve), claimed (fish id or -1)}]. Mutates lures[].claimed.
   * Returns events: {type: 'notice'|'nibble'|'strike'|'miss'|'lose', fish, lure}.
   */
  function stepFish(f, dt, lures, rng) {
    const ev = [];
    const sp = f.sp;
    const L = f.lure >= 0 ? lures.find(l => l.id === f.lure) : null;
    if (f.lure >= 0 && (!L || !L.inWater)) {           // the lure left the water
      if (L && L.claimed === f.id) L.claimed = -1;
      f.lure = -1; f.state = 'wander'; f.cool = 2;
      ev.push({ type: 'lose', fish: f });
    }
    f.cool = Math.max(0, f.cool - dt);
    f.phase += dt * (2 + f.v * 3);
    const steer = (tx, tz, spd, rate) => {
      const want = Math.atan2(tx - f.x, -(tz - f.z));
      f.h += clamp(wrap(want - f.h), -rate * dt, rate * dt);
      f.v += (spd - f.v) * Math.min(1, dt * 2.5);
    };
    if (f.state === 'wander') {
      f.turnT -= dt;
      if (f.turnT <= 0) { f.turnT = 1.5 + rng() * 3; f.h += (rng() - 0.5) * 1.6; f.vt = 0.35 + rng() * 0.5; }
      f.v += ((f.vt || 0.5) - f.v) * Math.min(1, dt);
      const b = BOUNDS;
      if (f.x < b.x0 || f.x > b.x1 || f.z > b.z0 || f.z < b.z1) steer((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, 0.7, 1.2);
      if (f.cool <= 0) {
        for (const l of lures) {
          if (!l.inWater || l.claimed >= 0) continue;
          const d = Math.hypot(l.x - f.x, l.z - f.z);
          if (d > sp.senseR) continue;
          const lure = 0.35 + 0.9 * Math.exp(-l.age / 3) + 0.8 * Math.exp(-l.twitch / 1.8) + sp.likesMotion * Math.min(1, l.moving) * 0.9;
          const near = 1.3 - d / sp.senseR;
          if (rng() < sp.curiosity * lure * near * 0.8 * dt) {
            l.claimed = f.id; f.lure = l.id; f.state = 'approach';
            ev.push({ type: 'notice', fish: f, lure: l });
            break;
          }
        }
      }
    } else if (f.state === 'approach' && L) {
      const d = Math.hypot(L.x - f.x, L.z - f.z);
      const shy = L.moving > 0.7 && sp.likesMotion < 0.5;   // a fast lure makes the cautious ones hang back
      steer(L.x, L.z, shy ? 0.5 : (d > 3 ? 1.6 : 1.0) + sp.likesMotion * 0.8, 2.4);
      if (d < 0.75) {
        if (L.moving > 0.25 && rng() < sp.likesMotion) { f.state = 'strike'; f.t = sp.window; ev.push({ type: 'strike', fish: f, lure: L }); }
        else { f.state = 'nibble'; f.nibLeft = sp.nibbles[0] + Math.floor(rng() * (sp.nibbles[1] - sp.nibbles[0] + 1)); f.nibT = 0.3 + rng() * 0.5; }
      }
    } else if (f.state === 'nibble' && L) {
      steer(L.x + Math.sin(f.phase * 0.3) * 0.5, L.z + Math.cos(f.phase * 0.3) * 0.5, 0.25, 1.5);
      if (L.moving > 0.6) {
        if (rng() < sp.likesMotion) { f.state = 'strike'; f.t = sp.window; ev.push({ type: 'strike', fish: f, lure: L }); }
        else if (rng() < 0.5 * dt * 10) { f.state = 'approach'; }
        return ev;
      }
      f.nibT -= dt;
      if (f.nibT <= 0) {
        if (f.nibLeft > 0) { f.nibLeft--; f.nibT = 0.4 + rng() * 0.6; ev.push({ type: 'nibble', fish: f, lure: L }); }
        else { f.state = 'strike'; f.t = sp.window; ev.push({ type: 'strike', fish: f, lure: L }); }
      }
    } else if (f.state === 'strike' && L) {
      steer(L.x, L.z, 0.6, 3);
      f.t -= dt;
      if (f.t <= 0) {
        L.claimed = -1; ev.push({ type: 'miss', fish: f, lure: L });
        flee(f, L.x, L.z); f.cool = 8;
      }
    } else if (f.state === 'flee') {
      f.v += (2.6 - f.v) * Math.min(1, dt * 3);
      f.t -= dt;
      if (f.t <= 0) { f.state = 'wander'; f.turnT = 0; }
    } else if (f.state !== 'hooked') { f.state = 'wander'; f.lure = -1; }
    if (f.state !== 'hooked') {
      f.x += Math.sin(f.h) * f.v * dt;
      f.z -= Math.cos(f.h) * f.v * dt;
    }
    return ev;
  }

  /**
   * Nobody biting? Send someone. The nearest free fish within reach is called to the float
   * (far enough off that its shadow is seen closing in); if the water nearby is empty, a fish
   * comes in from beyond the float. Returns { fish } (already sent) or { spawn: {x, z} }.
   */
  function directBite(fishes, lure, rng) {
    let best = null, bd = 1e9;
    for (const f of fishes) {
      if (f.state !== 'wander' || f.cool > 0 || f.lure >= 0 || f.sp.legendary) continue;
      const d = Math.hypot(f.x - lure.x, f.z - lure.z);
      if (d < 3 || d > 24) continue;
      if (d < bd) { bd = d; best = f; }
    }
    if (best) { sendToLure(best, lure); return { fish: best }; }
    const a = (rng() - 0.5) * 2.4, r = 7 + rng() * 3;
    return { spawn: { x: lure.x + Math.sin(a) * r, z: Math.min(-3, lure.z - Math.cos(a) * r) } };
  }
  function sendToLure(f, lure) { f.state = 'approach'; f.lure = lure.id; lure.claimed = f.id; f.cool = 0; }

  // ------------------------------------------------------------------ the fight
  const FIGHT = {
    LAND_D: 2.4,        // m: close enough to lift out
    LAND_S: 0.3,        // stamina below which it can be landed
    DRAG_T: 0.8,        // fish pull above this slips the drag
    SNAP_T: 0.95,       // tension above this strains the line
    WARN_T: 0.86,       // tension above this is the danger zone (sound, rumble, HUD)
    DRAG_LIMIT: 0.86,   // the reel's drag setting: load above it slips line off the spool
    SLACK_T: 0.08,
    MIN_LINE: 1.2,
  };

  /**
   * Leverage of the rod: pointing straight down the line gives no cushion (tension spikes),
   * a rod held at an angle to the line bends and absorbs it. delta = angle rod/line (rad).
   */
  function cushion(delta) {
    const d = clamp(delta, 0, Math.PI);
    if (d >= 1.2) return 0.75;
    return lerp(1.7, 0.75, Math.pow(d / 1.2, 0.8));
  }

  /** fish: {sp, kg, size}; d, phi: distance (m) and bearing (rad, + right) from the angler. */
  function createFight(fish, d, phi, hookQ, rng) {
    const fs = {
      sp: fish.sp, size: fish.size, d, phi, line: d, S: 1, T: 0.35, strain: 0, slackT: 0, risk: 0,
      hookQ: clamp(hookQ === undefined ? 0.6 : hookQ, 0, 1), phase: 'run', pt: 0, pDur: 1.2, u: 0, w: 0,
      air: 0, side: 0, delta: 1, t: 0, over: null, maxT: 0,
    };
    beginPhase(fs, 'run', rng);   // a hooked fish always bolts first
    return fs;
  }

  function beginPhase(fs, ph, rng) {
    const sp = fs.sp, sz = 0.75 + 0.5 * fs.size;
    fs.phase = ph; fs.pt = 0;
    const span = r => lerp(r[0], r[1], rng());
    if (ph === 'run' || ph === 'burst') {
      const lat = (rng() * 2 - 1) * 0.9;
      const v = sp.speed * (0.5 + 0.5 * fs.S) * sz * (ph === 'burst' ? 1.25 : 1);
      fs.u = v * Math.sqrt(1 - lat * lat); fs.w = v * lat;
      fs.pDur = ph === 'burst' ? 1.4 : span(sp.runLen);
    } else if (ph === 'charge') { fs.u = -Math.min(2.6, sp.speed * 0.6); fs.w = (rng() - 0.5) * 0.8; fs.pDur = 0.8 + rng() * 0.7; }
    else if (ph === 'thrash') { fs.u = 0; fs.w = 0; fs.pDur = 1 + rng() * 1.2; }
    else if (ph === 'jump') { fs.u = 0.5; fs.w = (rng() - 0.5) * 1.5; fs.pDur = 1.0; }
    else { fs.u = 0.12; fs.w = 0; fs.pDur = span(sp.restLen) * (1 + (1 - fs.S) * 0.8); }
  }

  function nextPhase(fs, rng) {
    const sp = fs.sp;
    if (fs.phase !== 'rest') return beginPhase(fs, 'rest', rng);
    const r = rng();
    if (r < sp.jumpy * (0.3 + 0.7 * fs.S) * 0.8) return beginPhase(fs, 'jump', rng);
    const r2 = rng();
    if (r2 < sp.charge * 0.6) return beginPhase(fs, 'charge', rng);
    if (r2 < sp.charge * 0.6 + sp.thrash * 0.6) return beginPhase(fs, 'thrash', rng);
    if (rng() < 0.35 + 0.6 * fs.S) return beginPhase(fs, 'run', rng);
    return beginPhase(fs, 'rest', rng);
  }

  /** How hard the fish itself pulls right now (before the rod's leverage). */
  function fishPull(fs) {
    const sp = fs.sp, sz = 0.7 + 0.6 * fs.size, P = sp.power * sz;
    switch (fs.phase) {
      case 'run': case 'burst': return P * (0.45 + 0.55 * fs.S);
      case 'thrash': return P * (0.3 + 0.55 * Math.abs(Math.sin(fs.pt * 13)));
      case 'charge': return 0.04;
      case 'jump': return fs.air > 0 ? P * 0.42 : P * 0.25;
      default: return P * 0.16 + 0.04;
    }
  }

  /**
   * One fight step. inp: { reel: m/s of line taken in, rodDir: unit world vector (the rod's mean
   * direction), pitch: rod pitch rad, pitchRate: rad/s (+ = lifting) }.
   * Returns events: 'phase:<name>', 'jump', 'splash', 'snap', 'thrown', 'landed', 'burst'.
   */
  function stepFight(fs, inp, dt, rng) {
    const ev = [];
    if (fs.over) return ev;
    const sp = fs.sp;
    fs.t += dt; fs.pt += dt;
    const lateralSign = Math.sign(fs.w);
    // where the line goes: from the angler toward the fish, a little down into the water
    const fishDir = norm({ x: Math.sin(fs.phi), y: -0.18 - 1.6 / Math.max(2, fs.d), z: -Math.cos(fs.phi) });
    const rod = inp.rodDir;
    fs.delta = Math.acos(clamp(dot(rod, fishDir), -1, 1));
    const rodYaw = Math.atan2(rod.x, -rod.z);
    // side pressure: the rod leaned to the side opposite the fish's sideways run
    fs.side = lateralSign === 0 ? 0 : clamp(-lateralSign * Math.sin(wrap(rodYaw - fs.phi)) * 1.6, -1, 1);
    const sideOn = Math.max(0, fs.side);

    // fish movement (side pressure turns a run and shortens it)
    let u = fs.u, w = fs.w;
    if (fs.phase === 'run' || fs.phase === 'burst') { w *= 1 - 0.6 * sideOn; fs.pt += dt * sideOn * 0.8; }
    if (fs.phase === 'jump') {
      fs.air = fs.pt > 0.15 && fs.pt < 0.85 ? 1 : 0;
      if (fs.pt - dt <= 0.15 && fs.pt > 0.15) ev.push('jump');
      if (fs.pt - dt <= 0.85 && fs.pt > 0.85) ev.push('splash');
    } else fs.air = 0;

    const reel = Math.max(0, inp.reel || 0);
    const want = fs.d + u * dt;
    fs.phi = clamp(fs.phi + w * dt / Math.max(3, fs.d), -1.15, 1.15);
    const P = fishPull(fs);
    const running = fs.phase === 'run' || fs.phase === 'burst';
    // pumping: swinging the rod away from the fish drags it toward you by the tip's travel;
    // swinging back toward it gives that line back as slack (pump, then reel down)
    const de = clamp(fs.delta, 0, 1.9), ddel = fs.prevDelta === undefined ? 0 : clamp(de - fs.prevDelta, -0.25, 0.25);
    fs.prevDelta = de;
    const lift = clamp(ddel / Math.max(dt, 1e-3), -4, 4) * 0.1;
    let Tt, slipping = false, reelIn = reel;
    if (want >= fs.line - 0.02) {
      if (running || fs.phase === 'jump') fs.line = Math.max(fs.line, want);
      fs.d = fs.line;
      const pulled = P < FIGHT.DRAG_T ? P : FIGHT.DRAG_T + (P - FIGHT.DRAG_T) * 0.3;
      // cranking against a running fish is what breaks lines
      const reelLoad = reel * (0.1 + 0.36 * P + (running ? 0.18 : 0));
      // in the air the rod's bend no longer matters: a high rod yanks the leaping fish, a bowed one gives it line
      if (fs.air) Tt = 0.75 * (pulled + reelLoad) + Math.max(0, (inp.pitch || 0) - 0.15) * 0.55 + lift;
      else Tt = cushion(fs.delta) * (pulled + reelLoad) + lift;
      // the reel's drag: above its setting the spool slips and sings instead of the line parting;
      // only a lot more load than that pushes the line itself toward breaking
      if (Tt > FIGHT.DRAG_LIMIT) {
        slipping = true;
        fs.line += (Tt - FIGHT.DRAG_LIMIT) * 5 * dt;
        reelIn = 0;
        Tt = FIGHT.DRAG_LIMIT + (Tt - FIGHT.DRAG_LIMIT) * 0.5;
      }
      if (ddel > 0 && !running) fs.line -= ROD_LEN * 0.65 * ddel;
    } else {
      fs.d = want;                        // the fish swims toward you faster than you reel: slack
      Tt = Math.max(0, 0.06 - (fs.line - fs.d) * 0.2);
    }
    if (ddel < 0) fs.line += ROD_LEN * 0.65 * -ddel;
    fs.slipping = slipping;
    fs.line = Math.max(FIGHT.MIN_LINE, fs.line - reelIn * dt);
    if (fs.d > fs.line) fs.d = fs.line;   // reeling drags a held fish in
    fs.T += (Math.max(0, Tt) - fs.T) * Math.min(1, dt / 0.07);
    fs.maxT = Math.max(fs.maxT, fs.T);

    // the line: strain builds above SNAP_T (a second or two of warning), slack runs out the hook
    if (fs.T > FIGHT.SNAP_T) fs.strain += ((fs.T - FIGHT.SNAP_T) * 3 + 0.36) * dt;
    else fs.strain = Math.max(0, fs.strain - 0.5 * dt);
    fs.danger = fs.T > FIGHT.WARN_T || fs.strain > 0;
    // a little sag holds the hook for a while; a loose loop of line loses it fast
    if (fs.T < FIGHT.SLACK_T) fs.slackT += dt * clamp((fs.line - fs.d) / 1.5, 0.4, 1.5);
    else fs.slackT = Math.max(0, fs.slackT - 2 * dt);
    if (fs.air && fs.T > 0.45) fs.risk += (fs.T - 0.45) * 3.2 * dt / (0.5 + fs.hookQ);
    if (fs.strain >= 1) { fs.over = 'snap'; ev.push('snap'); return ev; }
    if (fs.slackT >= sp.slackTol * (0.75 + 0.5 * fs.hookQ)) { fs.over = 'thrown'; ev.push('thrown'); return ev; }
    if (fs.risk >= 1) { fs.over = 'thrown'; ev.push('thrown'); return ev; }

    // stamina: pressure tires it, more so from the side and with the rod up; slack lets it recover
    const up = (inp.pitch || 0) > 0.35 ? 1.2 : 1;
    fs.S = Math.max(0, fs.S - dt * fs.T * 0.12 * (1 + 1.5 * sideOn) * up / sp.stamina);
    if (fs.T < 0.2) fs.S = Math.min(1, fs.S + dt * 0.035);

    if (fs.d <= FIGHT.LAND_D) {
      if (fs.S < FIGHT.LAND_S) { fs.over = 'landed'; ev.push('landed'); return ev; }
      if (fs.phase !== 'burst') { beginPhase(fs, 'burst', rng); fs.d = fs.line = FIGHT.LAND_D + 0.3; ev.push('burst'); }
    }
    if (fs.pt >= fs.pDur) { nextPhase(fs, rng); ev.push('phase:' + fs.phase); }
    return ev;
  }

  // ------------------------------------------------------------------ results
  /** Rank players: by heaviest fish ('big') or total weight ('total'); ties by catches. */
  function rank(players, rule) {
    const score = p => rule === 'total' ? p.catches.reduce((a, c) => a + c.kg, 0) : p.catches.reduce((a, c) => Math.max(a, c.kg), 0);
    return players.map((p, i) => ({ i, score: +score(p).toFixed(2), n: p.catches.length }))
      .sort((a, b) => b.score - a.score || b.n - a.n || a.i - b.i);
  }
  /** 1..3 stars for a fish of its species: trophy sizes are rare. */
  function stars(size) { return size >= 0.85 ? 3 : size >= 0.5 ? 2 : 1; }

  const api = {
    G, ROD_LEN, CAST, LINE_PER_TURN, A_REEL, CRANK, JERK, FIGHT, SPECIES, BOUNDS,
    rng32, clamp, lerp, wrap, cross, dot, norm,
    strokeSpeeds, findStroke, castFromStroke, createCaster, stepCaster, stepFlight, landing, castWord,
    createCrank, stepCrank, reelSpeed,
    pitchUpRate, detectJerk,
    byId, pickSpecies, spawnFish, splashNear, flee, stepFish, directBite, sendToLure,
    cushion, createFight, stepFight, fishPull, beginPhase,
    rank, stars,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TideLogic = api;
})(typeof window !== 'undefined' ? window : this);
