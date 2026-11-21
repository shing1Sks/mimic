/*
 * Willowlight - the fielding side. Pure maths, no browser (node games/cricket/test/field.test.js).
 *
 * Ten fielders (keeper included; the bowler fields from his follow-through). Given the ball's
 * flight off the bat (samples {t, x, y, z, air}), find what happens: a catch, a boundary, or the
 * fielder who gets to it along the ground, and how many runs the batters can take before the
 * throw comes back. Runs are taken only when safe: no run-outs.
 *
 * The ball and the fielder are one world (2026-11-22 rework: the old rule let anyone within a
 * generous radius "take" the ball, so on screen it was often well past him when he was given it).
 * Now one running model decides AND draws it: a fielder reacts (REACT), speeds up (ACC) to his
 * sprint (RUN), and only a ball his hands can actually meet counts: within REACH of his body
 * standing, a little higher with a leap he had time to set for, DIVE further with a dive. The plan
 * that wins (where he runs, when he gets there, how he takes it) is returned for the animation,
 * starting from where each fielder really stands (`cur`), and motionAt() replays it frame by frame.
 * Mishaps are physical too: a dropped catch or a fumble knocks the ball off his hands (a new
 * flight, `deflect`), and he gathers it where it ends up.
 */
(function (root) {
  'use strict';
  const Phys = root && root.CK ? root.CK.Phys : require('./phys.js');

  const F = {
    REACT: 0.25, KEEP_REACT: 0.12, BOWLER_REACT: 0.4,   // s before he moves
    ACC: 10, RUN: 8.5,      // m/s^2 to a sprint of m/s (a fit fielder: 0-8.5 in ~0.85 s)
    REACH: 1.0,             // m from his body his hands meet the ball standing
    HANDS: 0.55,            // m in front of his body the ball is taken (where he stands to it)
    CATCH_LO: 0.05, CATCH_HI: 2.4,
    LEAP_HI: 2.95, LEAP_SET: 0.2,   // a leap reaches this high, if he was there this long before
    DIVE: 2.1, DIVE_T: 0.35, DIVE_HI: 1.6,   // m further with a dive taking s, for a ball below m
    // (3000 random hits against the old any-fielder-within-a-radius rule: catches about the same,
    // ~10% more runs, as gaps are now real gaps)
    STOP_HI: 1.1,           // a ball below this can be stopped on the ground run
    JOG: 4,                 // m/s: fielders not in the play close in on it
    THROW: 20,              // m/s, the throw's average over its arc
    GATHER: 0.8,            // s to pick up, set and release
    RUN1: 2.7, RUNN: 2.4, SAFE: 0.1,    // batters: first run (calling + start), each further run
  };
  // Fielding mishaps, now and then (about one visible per two-over innings), decided here so the
  // animation only shows them. Shares: juggle of held catches (still out), fumble of ground stops
  // (+1 run), misfield4 of stops out beyond MISFIELD_R (through for four), leaveIt of catches two
  // fielders could reach (both leave it: put down). Rolled on the top of the rng's range, so a
  // forced rng of 0 (tests: "always held") never triggers one.
  const MISHAP = { juggle: 0.25, fumble: 0.16, misfield4: 0.15, leaveIt: 0.3 };
  const MISFIELD_R = 45;
  // [name, az (deg, right-handed frame: 0 = straight at the bowler, + = off side), r (m from the stumps)]
  const SETS = {
    pace: [['Keeper', 180, 13], ['Slip', 163, 15], ['Gully', 128, 17], ['Point', 92, 23], ['Cover', 52, 27], ['Mid-off', 14, 28],
      ['Mid-on', -14, 28], ['Midwicket', -56, 28], ['Deep square', -98, 55], ['Fine leg', -158, 52]],
    spin: [['Keeper', 180, 1.4], ['Slip', 148, 4.6], ['Short leg', -115, 5], ['Point', 95, 22], ['Cover', 54, 26], ['Mid-off', 14, 27],
      ['Mid-on', -14, 27], ['Midwicket', -55, 27], ['Deep square', -96, 55], ['Long-off', 24, 57]],
  };
  const deg = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /** Field positions in the world for a batter side (+1 right-handed, -1 left). */
  function setField(kind, side) {
    return (SETS[kind] || SETS.pace).map(([name, az, r], i) => ({
      i, name, keeper: i === 0, x: Math.sin(az * deg) * r * (side || 1), z: -Math.cos(az * deg) * r,
    }));
  }

  /** How far a fielder gets in tau s after he starts (speeding up at ACC to vmax). */
  function runDist(tau, vmax) {
    if (!(tau > 0)) return 0;
    const v = vmax || F.RUN, t1 = v / F.ACC;
    return tau < t1 ? 0.5 * F.ACC * tau * tau : v * (tau - t1 / 2);
  }
  /** ...and how long d m takes him. */
  function runTime(d, vmax) {
    if (!(d > 0)) return 0;
    const v = vmax || F.RUN, t1 = v / F.ACC, d1 = 0.5 * F.ACC * t1 * t1;
    return d < d1 ? Math.sqrt(2 * d / F.ACC) : t1 + (d - d1) / v;
  }
  /** The old question, "how far can a fielder be from a ball t s after the hit and still get it". */
  const reach = t => F.REACH + runDist(t - F.REACT) + (t > F.REACT + F.DIVE_T ? F.DIVE : 0);

  /** Chance to hold a catch: m = how stretched he was (0..1), t = time he had, run = m he ran. */
  function catchChance(m, t, keeper, run) {
    let p = (keeper ? 0.95 : 0.92) - 0.5 * m * m;
    if (run > 8) p -= 0.25 * Math.min(1, (run - 8) / 20);   // a long sprint is harder to finish
    if (t < 0.45) p -= 0.3 * (0.45 - t) / 0.45 * (keeper ? 0.4 : 1);
    return Math.max(0.15, Math.min(0.98, p));
  }

  /** A fielder as a mover: where he starts (his real spot) and when he can move (s after the hit). */
  function mover(f, react) {
    const at = f.cur || f;
    return { i: f.i, name: f.name, keeper: !!f.keeper, sx: at.x, sz: at.z, react: react != null ? react : f.keeper ? F.KEEP_REACT : F.REACT };
  }

  /**
   * Can fielder m get his hands to the ball at sample s? null, or { act: 'take' | 'high' | 'low' |
   * 'leap' | 'dive', D (m from his start), need (m to run), ta (s: there, or at the dive's launch),
   * m (0..1 how stretched) }.
   */
  function canReach(m, s, groundOnly) {
    const D = Math.hypot(s.x - m.sx, s.z - m.sz), tau = s.t - m.react;
    const need = Math.max(0, D - F.REACH), ran = runDist(tau);
    if (need <= ran) {
      const ta = m.react + runTime(Math.max(0, D - F.HANDS));
      const stretch = need / Math.max(need + 0.5, ran + 0.5);
      if (s.y > F.CATCH_HI) {
        if (groundOnly || s.y > F.LEAP_HI || s.t - ta < F.LEAP_SET) return null;
        return { act: 'leap', D, need, ta, m: 0.35 + 0.4 * stretch, lift: Math.min(0.6, s.y - 2.2) };
      }
      return { act: s.y > 1.6 ? 'high' : s.y < 0.55 ? 'low' : 'take', D, need, ta, m: stretch };
    }
    if (s.y <= F.DIVE_HI && tau > F.DIVE_T && need - F.DIVE <= runDist(tau - F.DIVE_T)) {
      const run = Math.max(0, D - F.HANDS - F.DIVE);
      return { act: 'dive', D, need, ta: m.react + runTime(run), m: 0.7 + 0.3 * clamp((need - runDist(tau - F.DIVE_T)) / F.DIVE, 0, 1) };
    }
    return null;
  }

  /** A face toward the batter (the incoming ball), from x, z. */
  const faceBatter = (x, z) => Math.atan2(-x, -0.5 - z);
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  /**
   * The motion plan for mover m taking (or meeting) the ball at sample s with reach result r.
   * short: stop this far before the ball (a fielder leaving it to his partner).
   */
  function makePlan(m, s, r, short) {
    const dx = s.x - m.sx, dz = s.z - m.sz, D = Math.hypot(dx, dz) || 1e-6, ux = dx / D, uz = dz / D;
    const p = { sx: m.sx, sz: m.sz, t0: m.react, vmax: F.RUN, face0: faceBatter(m.sx, m.sz), t: s.t, act: r.act, ball: { x: s.x, y: s.y, z: s.z } };
    // he faces the ball as it comes (its path back toward where it came from), or along his run
    const fb = faceBatter(s.x, s.z);
    if (r.act === 'dive') {
      const run = Math.max(0, D - F.HANDS - F.DIVE);
      p.tx = m.sx + ux * run; p.tz = m.sz + uz * run;
      p.ex = s.x - ux * F.HANDS; p.ez = s.z - uz * F.HANDS;
      p.launch = Math.max(r.ta, s.t - F.DIVE_T);
      // a sideways dive: his right (or left) along the dive, his front toward the batter as near as it goes
      const fR = Math.atan2(-uz, ux), fL = wrap(fR + Math.PI);   // rightOf(f) = +u, or -u
      const dR = Math.abs(wrap(fR - fb)), dL = Math.abs(wrap(fL - fb));
      p.face = dR <= dL ? fR : fL; p.side = dR <= dL ? 1 : -1;
    } else {
      const go = Math.max(0, D - F.HANDS - (short || 0));
      p.tx = m.sx + ux * go; p.tz = m.sz + uz * go;
      p.face = D > F.HANDS + 0.05 ? Math.atan2(ux, uz) : fb;
      // standing to a ball that comes to him: face it, not the way he ran
      if (r.ta < s.t - 0.25) p.face = Math.atan2(s.x - p.tx, s.z - p.tz);
      if (r.act === 'leap') p.lift = r.lift;
      const rgt = { x: -Math.cos(p.face), z: Math.sin(p.face) }, lat = (s.x - p.tx) * rgt.x + (s.z - p.tz) * rgt.z;
      p.side = Math.abs(lat) < 0.25 ? 0 : Math.sign(lat);
    }
    return p;
  }

  /**
   * Where a plan has the fielder at t (s after the hit): { x, z, run (0..1), facing, act, k (0..1
   * of the dive done) }. A plan may hand on to the next one (p.next, from its own t0).
   */
  function motionAt(p, t) {
    if (p.next && t >= p.next.t0) return motionAt(p.next, t);
    const dx = p.tx - p.sx, dz = p.tz - p.sz, L = Math.hypot(dx, dz), tau = t - p.t0;
    const d = tau > 0 ? Math.min(L, runDist(tau, p.vmax)) : 0;
    let x = L > 1e-6 ? p.sx + dx / L * d : p.sx, z = L > 1e-6 ? p.sz + dz / L * d : p.sz;
    const moving = tau > 0 && d < L - 1e-3;
    const v = moving ? Math.min(p.vmax || F.RUN, F.ACC * tau) : 0;
    let facing = tau <= 0 ? (p.face0 != null ? p.face0 : p.face) : moving && L > 0.3 ? Math.atan2(dx, dz) : p.face;
    let k = 0;
    if (p.act === 'dive' && p.launch != null && t >= p.launch) {
      k = clamp((t - p.launch) / Math.max(0.05, p.t - p.launch), 0, 1);
      const e = 1 - (1 - k) * (1 - k);
      x = p.tx + (p.ex - p.tx) * e; z = p.tz + (p.ez - p.tz) * e; facing = p.face;
    }
    return { x, z, run: v / F.RUN, facing, act: p.act, k };
  }

  /** A fresh flight from a point with velocity v, its clock starting at t0. */
  function flightFrom(p, v, t0) {
    return Phys.run(Phys.ball({ x: p.x, y: Math.max(0.05, p.y), z: p.z }, v, {}), { tMax: 8, every: 3 }).samples.map(s => Object.assign(s, { t: s.t + t0 }));
  }
  /** Off the hands: a dropped catch pops up and falls at his feet; a fumble squirts away. */
  function deflectV(s, prev, rng, kind) {
    const vx = (s.x - prev.x) / Math.max(1e-3, s.t - prev.t), vz = (s.z - prev.z) / Math.max(1e-3, s.t - prev.t);
    const a = rng() * Math.PI * 2;
    if (kind === 'drop') return { x: vx * 0.12 + Math.cos(a) * 0.8, y: 1.6 + rng() * 1.2, z: vz * 0.12 + Math.sin(a) * 0.8 };
    return { x: vx * 0.22 + Math.cos(a) * 1.6, y: 0.6 + rng() * 0.6, z: vz * 0.22 + Math.sin(a) * 1.6 };
  }

  /**
   * After the ball got away from him (dropped, fumbled, left), fielder m gathers it: from (x, z),
   * moving from t0. Returns { t, x, y, z, plan } with plan his run to it.
   */
  function gather(m, from, samples, t0) {
    const g = { i: m.i, name: m.name, keeper: m.keeper, sx: from.x, sz: from.z, react: t0 };
    for (const s of samples) {
      if (s.t < t0 || s.y > F.STOP_HI) continue;
      const r = canReach(g, s, true);
      if (r && r.act !== 'dive') return { t: s.t, x: s.x, y: s.y, z: s.z, plan: Object.assign(makePlan(g, s, r), { act: 'low' }) };
    }
    const last = samples[samples.length - 1];
    const D = Math.hypot(last.x - from.x, last.z - from.z), t = Math.max(last.t, t0 + runTime(Math.max(0, D - F.HANDS)));
    const s = { t, x: last.x, y: last.y, z: last.z };
    return { t, x: s.x, y: s.y, z: s.z, plan: Object.assign(makePlan(g, s, { act: 'low', ta: t0 + runTime(Math.max(0, D - F.HANDS)) }), { act: 'low' }) };
  }
  const endOf = p => (p.act === 'dive' ? { x: p.ex, z: p.ez } : { x: p.tx, z: p.tz });

  /**
   * What happens to a hit. samples: flight from the bat [{t, x, y, z, air}] (air = not bounced yet).
   * fielders: setField() (each may carry cur {x, z}: where he really stands now); o: { rng,
   * bowler: {x, z} (fields too) }.
   * Returns { type: 'caught' | 'six' | 'four' | 'runs', runs, by (fielder index, -1 bowler, null),
   *   t (catch / pick-up / boundary time), at {x, y, z}, dropped: [names], mishap,
   *   plans [per fielder], bowlerPlan, contact { t, at, kind } (hands on it, when that is before t),
   *   deflect { t, p, v } (the ball's new flight off his hands) }.
   */
  function resolve(samples, fielders, o) {
    o = o || {};
    const rng = o.rng || Math.random;
    const mishap = k => MISHAP[k] > 0 && rng() > 1 - MISHAP[k];
    const all = fielders.map(f => mover(f));
    if (o.bowler) all.push(mover({ i: -1, name: 'Bowler', x: o.bowler.x, z: o.bowler.z }, F.BOWLER_REACT));
    const dropped = [], tried = new Set();
    const finish = (out, plans) => {
      out.dropped = out.dropped || dropped;
      out.plans = fielders.map((f, i) => (plans && plans[i]) || drift(all[i], samples, out));
      out.bowlerPlan = (plans && plans[-1]) || (o.bowler ? drift(all[all.length - 1], samples, out, true) : null);
      return out;
    };
    // 1. catches, earliest first
    for (let j = 0; j < samples.length; j++) {
      const s = samples[j];
      if (!s.air) break;
      if (Phys.fromCentre(s) > Phys.FIELD.R) break;   // over the rope: in the stands, nobody fields it
      if (s.t < 0.06 || s.y < F.CATCH_LO || s.y > F.LEAP_HI) continue;
      for (const m of all) {
        if (tried.has(m.i)) continue;
        const r = canReach(m, s);
        if (!r) continue;
        tried.add(m.i);
        const at = { x: s.x, y: s.y, z: s.z };
        const other = m.i >= 0 && !m.keeper && all.find(g => g !== m && g.i >= 0 && !g.keeper && canReach(g, s));
        if (other && mishap('leaveIt')) {
          // both go for it, both pull up short: it drops between them and he gathers it
          dropped.push(m.name);
          const p1 = makePlan(m, s, r, 1.1), p2 = makePlan(other, s, canReach(other, s), 1.0);
          p1.act = p2.act = 'leave';
          const g = gather(m, endOf(p1), samples.slice(j), s.t + 0.5);
          p1.next = g.plan;
          return finish(Object.assign(runsFrom(g, m, dropped), { contact: { t: s.t, at, kind: 'leave' }, mishap: { kind: 'leaveIt', by: m.i, with: other.i } }), { [m.i]: p1, [other.i]: p2 });
        }
        const plan = makePlan(m, s, r);
        if (rng() < catchChance(r.m, s.t, m.keeper, r.D)) {
          return finish({ type: 'caught', runs: 0, by: m.i, name: m.name, t: s.t, at, contact: { t: s.t, at, kind: 'catch' }, mishap: mishap('juggle') ? { kind: 'juggle', by: m.i } : null }, { [m.i]: plan });
        }
        // put down: off his hands, up and down at his feet, and he gathers it
        dropped.push(m.name);
        const v = deflectV(s, samples[Math.max(0, j - 1)], rng, 'drop'), after = flightFrom(at, v, s.t);
        const g = gather(m, endOf(plan), after, s.t + (r.act === 'dive' ? 0.9 : 0.35));
        plan.next = g.plan;
        return finish(Object.assign(runsFrom(g, m, dropped), { contact: { t: s.t, at, kind: 'drop' }, deflect: { t: s.t, p: at, v } }), { [m.i]: plan });
      }
    }
    // 2. boundary or a stop along the ground
    let tB = Infinity, six = false;
    for (const s of samples) {
      if (Phys.fromCentre(s) > Phys.FIELD.R) { tB = s.t; six = s.air; break; }
    }
    let best = null;
    for (let j = 0; j < samples.length; j++) {
      const s = samples[j];
      if (s.t >= tB) break;
      if (s.y > F.STOP_HI || s.t < 0.05) continue;
      for (const m of all) {
        const r = canReach(m, s, true);
        if (r && (!best || r.ta < best.r.ta)) best = { s, j, m, r };
      }
      if (best) break;
    }
    if (!best && tB < Infinity) {
      // nobody gets there: the nearest outfielder chases it to the rope
      const end = samples.find(s => Phys.fromCentre(s) > Phys.FIELD.R) || samples[samples.length - 1];
      return finish({ type: six ? 'six' : 'four', runs: six ? 6 : 4, by: null, t: tB, dropped }, chase(all, fielders, end));
    }
    if (!best) {
      // it stopped inside the field before anyone was there: the quickest fielder runs to it
      const last = samples[samples.length - 1];
      let pick = null;
      for (const m of all) {
        const D = Math.hypot(last.x - m.sx, last.z - m.sz), ta = m.react + runTime(Math.max(0, D - F.HANDS));
        if (!pick || ta < pick.ta) pick = { m, ta };
      }
      const s = { t: Math.max(last.t, pick.ta), x: last.x, y: last.y, z: last.z };
      best = { s, j: samples.length - 1, m: pick.m, r: { act: 'low', ta: pick.ta, D: 0 } };
    }
    const { s, m, r } = best, at = { x: s.x, y: s.y, z: s.z };
    const plan = makePlan(m, s, r);
    if (r.act !== 'dive' && r.act !== 'take' && r.act !== 'high') plan.act = 'low';
    if (tB < Infinity && Phys.fromCentre(s) > MISFIELD_R && mishap('misfield4')) {
      // out near the rope it goes under his hand and on to the boundary; he turns and chases it
      const end = samples.find(x => Phys.fromCentre(x) > Phys.FIELD.R);
      const from = endOf(plan), t0 = s.t + (r.act === 'dive' ? 0.9 : 0.35);
      plan.next = { sx: from.x, sz: from.z, t0, vmax: F.RUN, tx: end.x * 0.96, tz: Phys.FIELD.CZ + (end.z - Phys.FIELD.CZ) * 0.96, face: Math.atan2(end.x - from.x, end.z - from.z), act: 'chase' };
      return finish({ type: 'four', runs: 4, by: m.i, name: m.name, t: tB, at, dropped, contact: { t: s.t, at, kind: 'miss' }, mishap: { kind: 'misfield4', by: m.i, missT: s.t } }, { [m.i]: plan });
    }
    if (mishap('fumble')) {
      // it squirts off his hands; he gathers it again (one run more than it would have been)
      const base = runsFrom(s, m, dropped);
      const v = deflectV(s, samples[Math.max(0, best.j - 1)], rng, 'fumble'), after = flightFrom(at, v, s.t);
      const g = gather(m, endOf(plan), after, s.t + 0.3);
      plan.next = g.plan;
      const out = runsFrom(g, m, dropped);
      out.runs = Math.min(4, base.runs + 1);
      return finish(Object.assign(out, { contact: { t: s.t, at, kind: 'fumble' }, deflect: { t: s.t, p: at, v }, mishap: { kind: 'fumble', by: m.i } }), { [m.i]: plan });
    }
    return finish(Object.assign(runsFrom(s, m, dropped), { at, contact: { t: s.t, at, kind: 'stop' } }), { [m.i]: plan });
  }

  /** The nearest outfielder runs for the rope where the ball crosses it (he never gets there first). */
  function chase(all, fielders, end) {
    let bi = -2, bd = Infinity;
    all.forEach(m => { if (m.i < 0 || m.keeper) return; const d = Math.hypot(end.x - m.sx, end.z - m.sz); if (d < bd) { bd = d; bi = m.i; } });
    if (bi < 0) return {};
    const m = all[bi], tx = end.x * 0.95, tz = Phys.FIELD.CZ + (end.z - Phys.FIELD.CZ) * 0.95;
    return { [bi]: { sx: m.sx, sz: m.sz, t0: m.react, vmax: F.RUN, tx, tz, face0: faceBatter(m.sx, m.sz), face: Math.atan2(tx - m.sx, tz - m.sz), act: 'chase' } };
  }
  /** Everyone else: a few steps in toward the ball, at a jog (or nothing, if it is far away). */
  function drift(m, samples, out, isBowler) {
    const p = { sx: m.sx, sz: m.sz, t0: m.react, vmax: F.JOG, tx: m.sx, tz: m.sz, face0: faceBatter(m.sx, m.sz), face: faceBatter(m.sx, m.sz), act: 'drift' };
    const s = samples.length > 4 ? samples[Math.min(samples.length - 1, 120)] : null;   // where it is ~0.6 s on
    if (!s || m.keeper) return p;
    const d = Math.hypot(s.x - m.sx, s.z - m.sz);
    if (d < 30 && !isBowler) { p.tx = m.sx + (s.x - m.sx) * 0.35; p.tz = m.sz + (s.z - m.sz) * 0.35; p.face = Math.atan2(s.x - m.sx, s.z - m.sz); }
    return p;
  }

  /** Runs the batters can safely take before the throw from `at` (picked up at at.t) arrives. */
  function runsFrom(at, f, dropped) {
    const toEnd = Math.min(Math.hypot(at.x, at.z), Math.hypot(at.x, at.z + Phys.PITCH.L));
    const back = at.t + F.GATHER + toEnd / F.THROW;
    let runs = 0;
    while (runs < 3 && F.RUN1 + runs * F.RUNN + F.SAFE <= back) runs++;
    return { type: 'runs', runs, by: f.i, name: f.name, t: at.t, at: { x: at.x, y: at.y, z: at.z }, back, dropped: dropped || [], mishap: null };
  }

  const api = { F, SETS, MISHAP, MISFIELD_R, setField, runDist, runTime, reach, catchChance, canReach, motionAt, resolve, runsFrom };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.CK = root.CK || {}; root.CK.Field = api; }
})(typeof window !== 'undefined' ? window : null);
