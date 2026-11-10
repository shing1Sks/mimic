/*
 * GYROWING skim: the low-flying score. Fly low and fast over the ground and a chain builds; the
 * longer it runs the higher its multiplier. Cresting a ridge close above it, flying a valley with
 * ground above you on both sides, and rolls, loops and inverted flight pay bonuses into the chain.
 * Climb away for a moment and the chain banks into the run total; hit something and it is lost.
 * Pure: no DOM or three.js, loads in Node for tests.
 *
 * update(st, f, dt) with f: { agl m, kt, onGround, crashed, walls (0..2: sides with ground above the
 * aircraft within ~250 m), p, q (body roll and pitch rate, rad/s), bank, pitch deg } -> events.
 */
(function (root) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const R2D = 180 / Math.PI;
  const CFG = {
    lowAgl: 60,       // m: under this a chain runs
    floorAgl: 8,      // m: full credit from here down
    minKt: 70,        // slower than this is not a skim
    grace: 2.2,       // s above lowAgl before the chain banks
    multEvery: 4,     // s of skimming per multiplier step
    maxMult: 8,
    ridgeAgl: 30,     // m: a crest passed under this is a ridge skim
  };

  function create() {
    return { total: 0, chain: 0, mult: 1, chainT: 0, outT: 0, active: false, low: 0, best: 0, ridges: 0, threads: 0, stunts: 0,
      armed: false, aglHist: [], histT: 0, rollAcc: 0, pitchAcc: 0, invT: 0, invPaid: false, threadT: 0, maxMult: 1 };
  }

  /** How low (0..1) at this height and speed: 0 above lowAgl or too slow, 1 at the floor. */
  function lowness(agl, kt) {
    if (kt < CFG.minKt) return 0;
    return clamp((CFG.lowAgl - agl) / (CFG.lowAgl - CFG.floorAgl), 0, 1);
  }

  function bonus(st, ev, kind, pts, label) {
    const v = Math.round(pts * st.mult);
    if (st.active) st.chain += v; else st.total += v;
    ev.push({ type: 'bonus', kind, pts: v, label });
  }

  function bank(st, ev) {
    if (!st.active) return;
    const v = Math.round(st.chain);
    st.total += v; st.best = Math.max(st.best, v);
    ev.push({ type: 'banked', pts: v, mult: st.mult });
    st.active = false; st.chain = 0; st.mult = 1; st.chainT = 0; st.outT = 0;
  }

  function update(st, f, dt) {
    const ev = [];
    if (f.crashed) {
      if (st.active) ev.push({ type: 'lost', pts: Math.round(st.chain) });
      st.active = false; st.chain = 0; st.mult = 1; st.chainT = 0; st.low = 0;
      return ev;
    }
    if (f.onGround) { bank(st, ev); st.low = 0; st.armed = false; st.aglHist.length = 0; st.rollAcc = st.pitchAcc = 0; return ev; }
    // a takeoff's climb-out is low and fast too: chains count once you have been up above lowAgl
    if (f.agl > CFG.lowAgl) st.armed = true;
    const L = st.armed ? lowness(f.agl, f.kt) : 0;
    st.low = L;
    if (L > 0) {
      if (!st.active) { st.active = true; st.chain = 0; st.mult = 1; st.chainT = 0; ev.push({ type: 'start' }); }
      st.outT = 0;
      st.chainT += dt;
      const m = Math.min(CFG.maxMult, 1 + Math.floor(st.chainT / CFG.multEvery));
      if (m > st.mult) { st.mult = m; st.maxMult = Math.max(st.maxMult, m); ev.push({ type: 'mult', mult: m }); }
      // points: 25 a second at the floor and 100 kt, scaled by lowness, speed and the multiplier
      st.chain += 25 * L * (f.kt / 100) * st.mult * dt;
    } else if (st.active) {
      st.outT += dt;
      if (st.outT > CFG.grace) bank(st, ev);
    }
    // ridge: the ground under us rose to a crest and is falling away, and we passed it close
    // (sampled every 0.1 s over the last 1.6 s, so it does not depend on the frame rate)
    const h = st.aglHist; st.histT += dt;
    if (st.histT >= 0.1) { st.histT = 0; h.push(f.agl); if (h.length > 16) h.shift(); }
    if (h.length === 16) {
      let mi = 0; for (let i = 1; i < 16; i++) if (h[i] < h[mi]) mi = i;
      if (mi > 3 && mi < 12 && h[mi] < CFG.ridgeAgl && h[0] - h[mi] > 12 && h[15] - h[mi] > 12 && f.kt >= CFG.minKt) {
        st.ridges++; bonus(st, ev, 'ridge', 300 * (1.5 - h[mi] / CFG.ridgeAgl), 'Ridge skim'); h.length = 0;
      }
    }
    // threading a valley: ground above us on both sides while low
    if ((f.walls || 0) >= 2 && L > 0) {
      st.threadT += dt;
      if (st.threadT >= 3) { st.threadT = 0; st.threads++; bonus(st, ev, 'thread', 350, 'Threading the valley'); }
    } else st.threadT = Math.max(0, st.threadT - dt * 2);
    // stunts: a full roll or loop accumulated from the body rates, inverted flight held
    if (Math.abs(f.p) > 0.2) st.rollAcc += f.p * dt; else st.rollAcc *= Math.exp(-dt * 0.6);
    if (Math.abs(st.rollAcc) * R2D >= 330) { st.rollAcc = 0; st.stunts++; bonus(st, ev, 'roll', 1000, 'Barrel roll'); }
    // a loop must take the nose through the vertical: a long steep turn pitches the body round too
    if (Math.abs(f.q) > 0.2) st.pitchAcc += f.q * dt; else st.pitchAcc *= Math.exp(-dt * 1.0);
    if (Math.abs(st.pitchAcc) < 0.3) st.vert = false; else if (Math.abs(f.pitch || 0) > 70) st.vert = true;
    if (Math.abs(st.pitchAcc) * R2D >= 330) { st.pitchAcc = 0; if (st.vert) { st.stunts++; bonus(st, ev, 'loop', 1500, 'Loop'); } st.vert = false; }
    if (Math.abs(f.bank || 0) > 150) {
      st.invT += dt;
      if (st.invT > 1.5 && !st.invPaid) { st.invPaid = true; st.stunts++; bonus(st, ev, 'inverted', 600, 'Inverted'); }
    } else { st.invT = 0; st.invPaid = false; }
    return ev;
  }

  /** End of a run: bank whatever is running; returns the final total. */
  function finish(st) { const ev = []; bank(st, ev); return st.total; }

  /** Result card rows and a 0..100 grade against a par total. */
  function result(st, par) {
    const score = clamp(Math.round(100 * Math.sqrt(st.total / (par || 10000))), 0, 100);
    const title = score >= 90 ? 'Terrain hugger' : score >= 70 ? 'Low and fast' : score >= 45 ? 'Getting down there' : score >= 20 ? 'Cautious' : 'Too high to count';
    return { score, title, rows: [
      ['Skim points', st.total.toLocaleString('en-US'), ''],
      ['Best chain', st.best.toLocaleString('en-US'), 'x' + st.maxMult + ' peak'],
      ['Ridge skims', String(st.ridges), ''],
      ['Valleys threaded', String(st.threads), ''],
      ['Stunts', String(st.stunts), ''],
    ] };
  }

  const api = { CFG, create, lowness, update, finish, result };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Skim = api;
})(typeof window !== 'undefined' ? window : null);
