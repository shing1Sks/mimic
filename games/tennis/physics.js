/*
 * Sunvolley — ball physics, court geometry and the shot solver.
 * Units: metres, seconds. World: x right, y up, z toward the player (player half is z > 0).
 */
(function () {
  'use strict';
  const TN = window.TN = window.TN || {};

  const COURT = {
    HL: 11.885,        // half length (baseline z)
    HW: 4.115,         // singles half width
    HDW: 5.485,        // doubles half width
    SERVICE: 6.40,     // service line distance from net
    NET_C: 0.914,      // net height at centre
    NET_P: 1.07,       // net height at posts
    POST_X: 6.40,      // post distance from centre
    R: 0.033,          // real ball radius (physics + line calls)
  };
  TN.COURT = COURT;

  const G = 9.81;
  const KD = 0.0185;   // drag: a = -KD |v| v
  const KM = 0.0095;   // magnus: a = KM |v| (w x v), |w| <= ~1 (dimensionless spin)
  const DT = 1 / 240;
  TN.PHYS_DT = DT;

  function netHeight(x) {
    const t = Math.min(1, Math.abs(x) / COURT.POST_X);
    return COURT.NET_C + (COURT.NET_P - COURT.NET_C) * t * t;
  }
  TN.netHeight = netHeight;

  /** Topspin component of a spin vector relative to horizontal travel direction. */
  function topspinOf(v, w) {
    const h = Math.hypot(v.x, v.z) || 1;
    // cross(up, dir) = (-dir.z, 0, dir.x)
    return (w.x * (-v.z / h) + w.z * (v.x / h));
  }
  TN.topspinOf = topspinOf;

  /** Spin vector for a given topspin amount and travel direction (dx, dz normalised). */
  function spinVector(dx, dz, top, side) {
    return { x: -dz * top, y: side || 0, z: dx * top };
  }
  TN.spinVector = spinVector;

  /**
   * Advance a ball state {p, v, w} by dt. Mutates. Returns an event string or null:
   * 'bounce' | 'net' | 'tape'
   */
  function step(b, dt) {
    const p = b.p, v = b.v, w = b.w;
    const sp = Math.hypot(v.x, v.y, v.z);
    let ax = -KD * sp * v.x, ay = -G - KD * sp * v.y, az = -KD * sp * v.z;
    if (b.rolling) { ax = -v.x * 1.2; az = -v.z * 1.2; ay = 0; }
    else {
      const cx = w.y * v.z - w.z * v.y, cy = w.z * v.x - w.x * v.z, cz = w.x * v.y - w.y * v.x;
      ax += KM * sp * cx; ay += KM * sp * cy; az += KM * sp * cz;
    }
    v.x += ax * dt; v.y += ay * dt; v.z += az * dt;
    const pz = p.z;
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
    let ev = null;

    // net: plane z = 0 between the posts
    if ((pz > 0) !== (p.z > 0) && Math.abs(p.x) < COURT.POST_X) {
      const h = netHeight(p.x);
      if (p.y < h - COURT.R * 0.3) {
        // into the net body: dies, drops on hitter's side
        const s = pz > 0 ? 1 : -1;
        p.z = s * 0.06;
        v.z = -v.z * 0.08; v.x *= 0.35; v.y = Math.min(v.y, 0) * 0.3;
        w.x *= 0.1; w.y *= 0.1; w.z *= 0.1;
        ev = 'net';
      } else if (p.y < h + COURT.R) {
        // clipped the tape: loses pace, pops up, keeps going over
        v.z *= 0.45; v.x *= 0.7; v.y = Math.abs(v.y) * 0.35 + 0.9;
        ev = 'tape';
      }
    }

    // ground
    if (p.y < COURT.R && v.y < 0 && !b.rolling) {
      p.y = COURT.R;
      const top = topspinOf(v, w);
      let e = 0.74 * (1 + 0.10 * Math.max(0, top) - 0.20 * Math.max(0, -top));
      let f = 0.73 - 0.04 * Math.max(0, top) + 0.06 * Math.max(0, -top);
      const vy = -v.y * e;
      v.x *= f; v.z *= f;
      // topspin kicks forward a little on landing
      const h = Math.hypot(v.x, v.z) || 1;
      v.x += (v.x / h) * Math.max(0, top) * 1.2;
      v.z += (v.z / h) * Math.max(0, top) * 1.2;
      v.y = vy;
      w.x *= 0.35; w.y *= 0.35; w.z *= 0.35;
      if (vy < 0.35) { v.y = 0; b.rolling = true; }
      ev = 'bounce';
    }
    if (b.rolling) p.y = COURT.R;
    return ev;
  }
  TN.stepBall = step;

  function clone(b) {
    return { p: { x: b.p.x, y: b.p.y, z: b.p.z }, v: { x: b.v.x, y: b.v.y, z: b.v.z },
      w: { x: b.w.x, y: b.w.y, z: b.w.z }, rolling: !!b.rolling };
  }
  TN.cloneBall = clone;

  /**
   * Predict a trajectory. Returns samples every `every` steps:
   * {t, x, y, z, vy, bounces, events}
   */
  function predict(b, maxT, every) {
    const s = clone(b);
    every = every || 2;
    const out = [];
    let t = 0, bounces = 0, i = 0;
    const firstBounce = { at: null };
    let netHit = false;
    while (t < maxT) {
      const ev = step(s, DT);
      t += DT; i++;
      if (ev === 'bounce') {
        bounces++;
        if (!firstBounce.at) firstBounce.at = { x: s.p.x, z: s.p.z, t };
      }
      if (ev === 'net') netHit = true;
      if (i % every === 0 || ev) out.push({ t, x: s.p.x, y: s.p.y, z: s.p.z, vy: s.v.y, vz: s.v.z, bounces });
      if (bounces >= 2 || s.rolling) break;
    }
    out.firstBounce = firstBounce.at;
    out.netHit = netHit;
    return out;
  }
  TN.predict = predict;

  /** Simulate a launch until the first ground contact. */
  function flight(from, vel, w) {
    const s = { p: { x: from.x, y: from.y, z: from.z }, v: { x: vel.x, y: vel.y, z: vel.z }, w: { x: w.x, y: w.y, z: w.z } };
    let t = 0, netY = null, netX = 0, hitNet = false;
    while (t < 4) {
      const pz = s.p.z;
      const ev = step(s, DT);
      t += DT;
      if ((pz > 0) !== (s.p.z > 0) && netY === null) { netY = s.p.y; netX = s.p.x; }
      if (ev === 'net') { hitNet = true; }
      if (ev === 'bounce') break;
    }
    return { x: s.p.x, z: s.p.z, t, netY, netX, hitNet };
  }

  /**
   * Find a launch velocity that lands the ball at target {x, z} with horizontal speed `hs`
   * and topspin `top` (-1 slice .. 1 heavy topspin). If `clearNet`, reduce pace until the
   * ball clears the net with margin. Returns {v, w, t, netClear}.
   */
  function solveShot(from, target, hs, top, opts) {
    opts = opts || {};
    const margin = opts.margin != null ? opts.margin : 0.15;
    const side = opts.side || 0;
    let speed = hs;
    let best = null;
    for (let iter = 0; iter < 9; iter++) {
      const dx = target.x - from.x, dz = target.z - from.z;
      const D = Math.hypot(dx, dz);
      const ux = dx / D, uz = dz / D;
      const w = spinVector(ux, uz, top, side);
      let lo = -speed * 0.6, hi = speed * 0.9, res = null, vy = 0;
      for (let k = 0; k < 24; k++) {
        vy = (lo + hi) / 2;
        res = flight(from, { x: ux * speed, y: vy, z: uz * speed }, w);
        const d = (res.x - from.x) * ux + (res.z - from.z) * uz;
        if (d < D) lo = vy; else hi = vy;
      }
      vy = (lo + hi) / 2;
      res = flight(from, { x: ux * speed, y: vy, z: uz * speed }, w);
      const crosses = (from.z > 0) !== (target.z > 0);
      const clear = !crosses || (res.netY !== null && res.netY > netHeight(res.netX) + margin && !res.hitNet);
      best = { v: { x: ux * speed, y: vy, z: uz * speed }, w, t: res.t, netClear: clear, speed };
      if (clear || !opts.clearNet) break;
      speed *= 0.9;
    }
    return best;
  }
  TN.solveShot = solveShot;

  // Court regions --------------------------------------------------------------
  /** Is (x,z) inside the singles court half on side s (+1 player, -1 opponent)? */
  TN.inCourt = function (x, z, s) {
    const r = COURT.R;
    return Math.abs(x) <= COURT.HW + r && z * s >= -r && z * s <= COURT.HL + r;
  };
  /**
   * Service box on side s (+1 player half, -1 opponent half). `deuce` from the receiver's
   * point of view: the receiver's right-hand box.
   */
  TN.serviceBox = function (s, deuce) {
    // receiver on +z faces -z: right = +x. Receiver on -z faces +z: right = -x.
    const right = s > 0 ? 1 : -1;
    const sign = deuce ? right : -right;
    const x0 = sign > 0 ? 0 : -COURT.HW, x1 = sign > 0 ? COURT.HW : 0;
    const z0 = s > 0 ? 0 : -COURT.SERVICE, z1 = s > 0 ? COURT.SERVICE : 0;
    return { x0, x1, z0, z1 };
  };
  TN.inBox = function (x, z, box) {
    const r = COURT.R;
    return x >= box.x0 - r && x <= box.x1 + r && z >= box.z0 - r && z <= box.z1 + r;
  };
})();
