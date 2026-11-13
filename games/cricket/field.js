/*
 * Willowlight - the fielding side. Pure maths, no browser (node games/cricket/test/field.test.js).
 *
 * Ten fielders (keeper included; the bowler fields from his follow-through). Given the ball's
 * flight off the bat (samples {t, x, y, z, air}), find what happens: a catch (every fielder who
 * can reach the ball in the air, earliest first, each with a chance to drop it), a boundary, or
 * the fielder who gets to it first along the ground and how many runs the batters can take
 * before the throw comes back. Runs are taken only when safe: no run-outs.
 */
(function (root) {
  'use strict';
  const Phys = root && root.CK ? root.CK.Phys : require('./phys.js');
  const deg = Math.PI / 180;

  const F = {
    REACT: 0.3,      // s before a fielder moves
    RUN: 6.8,        // m/s
    REACH: 1.0,      // m standing
    DIVE: 0.9,       // m more once a fielder has had time to set himself (> 0.6 s)
    CATCH_LO: 0.05, CATCH_HI: 2.6,
    STOP_HI: 1.2,    // a ball below this can be stopped on the ground run
    THROW: 20,       // m/s, the throw's average over its arc
    GATHER: 0.8,     // s to pick up, set and release
    RUN1: 2.7, RUNN: 2.4, SAFE: 0.1,    // batters: first run (calling + start), each further run
  };
  // Fielding mishaps, now and then (about one visible per two-over innings), decided here so the
  // animation only shows them. Shares: juggle of held catches (still out), fumble of ground stops
  // (+1 run), misfield4 of stops out beyond MISFIELD_R (through for four), leaveIt of catches two
  // fielders could reach (both leave it: put down). Rolled on the top of the rng's range, so a
  // forced rng of 0 (tests: "always held") never triggers one.
  const MISHAP = { juggle: 0.25, fumble: 0.16, misfield4: 0.15, leaveIt: 0.3 };   // tuned: ~1 visible per 12 hits, runs +4%
  const MISFIELD_R = 45;
  // [name, az (deg, right-handed frame: 0 = straight at the bowler, + = off side), r (m from the stumps)]
  const SETS = {
    pace: [['Keeper', 180, 13], ['Slip', 163, 15], ['Gully', 128, 17], ['Point', 92, 23], ['Cover', 52, 27], ['Mid-off', 14, 28],
      ['Mid-on', -14, 28], ['Midwicket', -56, 28], ['Deep square', -98, 55], ['Fine leg', -158, 52]],
    spin: [['Keeper', 180, 1.4], ['Slip', 148, 4.6], ['Short leg', -115, 5], ['Point', 95, 22], ['Cover', 54, 26], ['Mid-off', 14, 27],
      ['Mid-on', -14, 27], ['Midwicket', -55, 27], ['Deep square', -96, 55], ['Long-off', 24, 57]],
  };

  /** Field positions in the world for a batter side (+1 right-handed, -1 left). */
  function setField(kind, side) {
    return (SETS[kind] || SETS.pace).map(([name, az, r], i) => ({
      i, name, keeper: i === 0, x: Math.sin(az * deg) * r * (side || 1), z: -Math.cos(az * deg) * r,
    }));
  }

  const reach = t => F.REACH + F.RUN * Math.max(0, t - F.REACT) + (t > 0.6 ? F.DIVE : 0);
  /** Chance to hold a catch: m = how far the fielder had to go (0..1 of his reach), t = time he had. */
  function catchChance(m, t, keeper, run) {
    let p = (keeper ? 0.95 : 0.92) - 0.5 * m * m;
    if (run > 8) p -= 0.25 * Math.min(1, (run - 8) / 20);   // a long sprint is harder to finish
    if (t < 0.45) p -= 0.3 * (0.45 - t) / 0.45 * (keeper ? 0.4 : 1);
    return Math.max(0.15, Math.min(0.98, p));
  }

  /**
   * What happens to a hit. samples: flight from the bat [{t, x, y, z, air}] (air = not bounced yet).
   * fielders: setField(); o: { rng, bowler: {x, z} (fields too) }.
   * Returns { type: 'caught' | 'six' | 'four' | 'runs', runs, by (fielder index, -1 bowler, null),
   *   t (catch / pick-up time), at {x, z}, dropped: [names] }.
   */
  function resolve(samples, fielders, o) {
    o = o || {};
    const rng = o.rng || Math.random;
    const mishap = k => MISHAP[k] > 0 && rng() > 1 - MISHAP[k];
    const all = fielders.slice();
    if (o.bowler) all.push({ i: -1, name: 'Bowler', x: o.bowler.x, z: o.bowler.z });
    const dropped = [], tried = new Set();
    // 1. catches, earliest first
    for (const s of samples) {
      if (!s.air) break;
      if (Phys.fromCentre(s) > Phys.FIELD.R) break;   // over the rope: in the stands, nobody fields it
      if (s.t < 0.06 || s.y < F.CATCH_LO || s.y > F.CATCH_HI) continue;
      for (const f of all) {
        if (tried.has(f.i)) continue;
        const d = Math.hypot(s.x - f.x, s.z - f.z), R = reach(s.t);
        if (d > R) continue;
        tried.add(f.i);
        const other = all.find(g => g !== f && !g.keeper && !f.keeper && Math.hypot(s.x - g.x, s.z - g.z) <= R);
        if (other && mishap('leaveIt')) {
          // both go for it, both pull out: it drops between them
          dropped.push(f.name);
          return Object.assign(runsFrom({ t: s.t + 0.9, x: s.x, z: s.z }, f, dropped), { mishap: { kind: 'leaveIt', by: f.i, with: other.i } });
        }
        if (rng() < catchChance(d / R, s.t, f.keeper, d)) return { type: 'caught', runs: 0, by: f.i, name: f.name, t: s.t, at: { x: s.x, y: s.y, z: s.z }, dropped, mishap: mishap('juggle') ? { kind: 'juggle', by: f.i } : null };
        dropped.push(f.name);
        // put down: the ball dies at his feet, he picks it up
        return runsFrom({ t: s.t + 0.9, x: s.x, z: s.z }, f, dropped);
      }
    }
    // 2. boundary or a stop along the ground
    let tB = Infinity, six = false;
    for (const s of samples) {
      if (Phys.fromCentre(s) > Phys.FIELD.R) { tB = s.t; six = s.air; break; }
    }
    let best = null;
    for (const s of samples) {
      if (s.t >= tB) break;
      if (s.y > F.STOP_HI || s.t < 0.05) continue;
      for (const f of all) {
        const d = Math.hypot(s.x - f.x, s.z - f.z);
        if (d <= reach(s.t) && (!best || s.t < best.t)) best = { t: s.t, x: s.x, z: s.z, f };
      }
      if (best) break;
    }
    if (!best && tB < Infinity) return { type: six ? 'six' : 'four', runs: six ? 6 : 4, by: null, t: tB, dropped };
    if (!best) {
      // stopped inside the field before anyone was there: the nearest fielder walks to it
      const last = samples[samples.length - 1];
      let f0 = all[0], d0 = Infinity;
      for (const f of all) { const d = Math.hypot(last.x - f.x, last.z - f.z); if (d < d0) { d0 = d; f0 = f; } }
      best = { t: Math.max(last.t, F.REACT + Math.max(0, d0 - F.REACH) / F.RUN), x: last.x, z: last.z, f: f0 };
    }
    if (tB < Infinity && Phys.fromCentre(best) > MISFIELD_R && mishap('misfield4')) {
      // out near the rope it goes under his hand (missT) and on to the boundary (t)
      return { type: 'four', runs: 4, by: best.f.i, name: best.f.name, t: tB, at: { x: best.x, z: best.z }, dropped, mishap: { kind: 'misfield4', by: best.f.i, missT: best.t } };
    }
    const r = runsFrom(best, best.f, dropped);
    if (mishap('fumble')) { r.runs = Math.min(4, r.runs + 1); r.mishap = { kind: 'fumble', by: best.f.i }; }
    return r;
  }

  /** Runs the batters can safely take before the throw from `at` (picked up at at.t) arrives. */
  function runsFrom(at, f, dropped) {
    const toEnd = Math.min(Math.hypot(at.x, at.z), Math.hypot(at.x, at.z + Phys.PITCH.L));
    const back = at.t + F.GATHER + toEnd / F.THROW;
    let runs = 0;
    while (runs < 3 && F.RUN1 + runs * F.RUNN + F.SAFE <= back) runs++;
    return { type: 'runs', runs, by: f.i, name: f.name, t: at.t, at: { x: at.x, z: at.z }, back, dropped: dropped || [], mishap: null };
  }

  const api = { F, SETS, MISHAP, MISFIELD_R, setField, reach, catchChance, resolve, runsFrom };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.CK = root.CK || {}; root.CK.Field = api; }
})(typeof window !== 'undefined' ? window : null);
