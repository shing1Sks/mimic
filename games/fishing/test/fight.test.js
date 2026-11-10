// Run: node games/fishing/test/fight.test.js
// The fight on the line: tension from the fish, the reel and the rod's angle; snapping, slack,
// jumps, side pressure, and landing.
'use strict';
const assert = require('assert');
const L = require('../logic.js');

const rodAt = (pitch, yaw) => ({ x: Math.cos(pitch) * Math.sin(yaw), y: Math.sin(pitch), z: -Math.cos(pitch) * Math.cos(yaw) });
function hooked(id, seed, size) {
  const rng = L.rng32(seed || 1);
  const f = L.spawnFish(rng, { species: id });
  if (size !== undefined) f.size = size;
  return { fs: L.createFight(f, 25, 0, 0.7, rng), rng };
}
/** Run a fight with a policy (fs -> {reel, pitch, yaw, pitchRate}) until it ends or `secs` pass. */
function run(h, policy, secs) {
  let t = 0;
  const evs = [];
  while (!h.fs.over && t < (secs || 200)) {
    const p = policy(h.fs);
    const ev = L.stepFight(h.fs, { reel: p.reel, rodDir: rodAt(p.pitch, p.yaw), pitch: p.pitch, pitchRate: p.pitchRate || 0 }, 1 / 60, h.rng);
    evs.push(...ev); t += 1 / 60;
  }
  return { over: h.fs.over, t, evs };
}
const running = fs => fs.phase === 'run' || fs.phase === 'burst';
/** A sensible angler: rod up and leaned against sideways runs, reel when it is not running, bow on jumps. */
const good = fs => ({ reel: running(fs) || fs.T > 0.85 ? 0 : fs.phase === 'charge' ? 2.6 : 1.7,
  pitch: fs.phase === 'jump' ? -0.2 : 0.6, yaw: fs.phi - Math.sign(fs.w) * 0.6 });
const tally = (id, policy, n) => {
  const out = { landed: 0, snap: 0, thrown: 0 };
  for (let s = 1; s <= (n || 40); s++) { const r = run(hooked(id, s), policy); if (r.over) out[r.over]++; }
  return out;
};

const tests = {
  pointingTheRodAtTheFishHasNoCushion() {
    assert(L.cushion(0) > 1.5 && L.cushion(1.5) < 0.8 && L.cushion(0.3) > L.cushion(0.9));
  },
  aGoodAnglerLandsEverySpecies() {
    for (const sp of L.SPECIES) {
      const t = tally(sp.id, good, 30);
      assert(t.landed >= 27, sp.id + ' ' + JSON.stringify(t));
    }
  },
  crankingThroughEveryRunSnapsTheBigOnes() {
    for (const id of ['ray', 'tarpon']) {
      const t = tally(id, () => ({ reel: 2, pitch: 0.6, yaw: 0 }), 20);
      assert(t.snap >= 16, id + ' ' + JSON.stringify(t));
    }
    for (const id of ['bass', 'snapper', 'grouper']) {
      const t = tally(id, () => ({ reel: 2, pitch: 0.6, yaw: 0 }), 20);
      assert(t.snap >= 7, id + ' often: ' + JSON.stringify(t));
    }
  },
  aSnapAlwaysComesAfterAWarning() {
    // the old fight snapped a 3 kg snapper with no felt warning: now the danger zone lasts first
    let snaps = 0;
    for (const id of ['bass', 'snapper', 'ray', 'tarpon', 'grouper']) {
      for (let s = 1; s <= 10; s++) {
        const h = hooked(id, s);
        let dangerFor = 0;
        while (!h.fs.over) {
          L.stepFight(h.fs, { reel: 2, rodDir: rodAt(0.6, 0), pitch: 0.6 }, 1 / 60, h.rng);
          dangerFor = h.fs.danger ? dangerFor + 1 / 60 : 0;
          if (h.fs.t > 200) break;
        }
        if (h.fs.over === 'snap') { snaps++; assert(dangerFor >= 0.9, id + ' snapped after only ' + dangerFor.toFixed(2) + ' s of warning'); }
      }
    }
    assert(snaps > 10, 'snaps ' + snaps);
  },
  anOverloadSlipsTheDragFirst() {
    const h = hooked('tarpon', 2);
    const l0 = h.fs.line;
    for (let i = 0; i < 30; i++) L.stepFight(h.fs, { reel: 1.8, rodDir: rodAt(0.6, 0), pitch: 0.6 }, 1 / 60, h.rng);
    assert(h.fs.slipping && h.fs.line > l0 && !h.fs.over, JSON.stringify({ slip: h.fs.slipping, l0, l: h.fs.line }));
  },
  pumpingTheRodDragsTheFishIn() {
    const h = hooked('bass', 6);
    L.beginPhase(h.fs, 'rest', h.rng); h.fs.pDur = 99;
    for (let i = 0; i < 10; i++) L.stepFight(h.fs, { reel: 0, rodDir: rodAt(0.1, 0), pitch: 0.1 }, 1 / 60, h.rng);
    const d0 = h.fs.d;
    for (let i = 0; i <= 30; i++) { const p = 0.1 + 1.1 * i / 30; L.stepFight(h.fs, { reel: 0, rodDir: rodAt(p, 0), pitch: p }, 1 / 60, h.rng); }
    assert(h.fs.d < d0 - 1.2, 'pump gained ' + (d0 - h.fs.d).toFixed(2) + ' m');
    // dropping the rod back gives that as slack, which you reel down
    const slack0 = h.fs.line - h.fs.d;
    for (let i = 0; i <= 20; i++) { const p = 1.2 - 1.1 * i / 20; L.stepFight(h.fs, { reel: 0, rodDir: rodAt(p, 0), pitch: p }, 1 / 60, h.rng); }
    assert(h.fs.line - h.fs.d > slack0 + 1, 'lowering gives slack');
  },
  smallFishCanJustBeCrankedIn() {
    const t = tally('perch', () => ({ reel: 2, pitch: 0.6, yaw: 0 }), 20);
    assert(t.landed >= 19, JSON.stringify(t));
  },
  reelingDuringARunRaisesTension() {
    const a = hooked('bass', 3), b = hooked('bass', 3);
    for (let i = 0; i < 20; i++) {
      L.stepFight(a.fs, { reel: 0, rodDir: rodAt(0.6, 0), pitch: 0.6 }, 1 / 60, a.rng);
      L.stepFight(b.fs, { reel: 2, rodDir: rodAt(0.6, 0), pitch: 0.6 }, 1 / 60, b.rng);
    }
    assert(b.fs.T > a.fs.T + 0.25, a.fs.T.toFixed(2) + ' vs ' + b.fs.T.toFixed(2));
  },
  aRunningFishTakesLine() {
    const h = hooked('tarpon', 2);
    const d0 = h.fs.line;
    for (let i = 0; i < 60; i++) L.stepFight(h.fs, { reel: 0, rodDir: rodAt(0.6, 0), pitch: 0.6 }, 1 / 60, h.rng);
    assert(h.fs.line > d0 + 1.5, 'line ' + d0 + ' -> ' + h.fs.line.toFixed(2));
  },
  pointingTheRodAtABigFishIsDangerous() {
    // no cushion: the line sits in the danger zone through the runs and tires the fish slower
    const dz = pol => { let t = 0; for (let s = 1; s <= 10; s++) { const h = hooked('grouper', s); for (let i = 0; i < 1200 && !h.fs.over; i++) { const p = pol(h.fs); L.stepFight(h.fs, { reel: p.reel, rodDir: rodAt(p.pitch, p.yaw), pitch: p.pitch }, 1 / 60, h.rng); if (h.fs.danger) t += 1 / 60; } } return t; };
    const point = dz(fs => ({ reel: running(fs) ? 0 : 1.6, pitch: -0.15, yaw: fs.phi }));
    const up = dz(fs => ({ reel: running(fs) ? 0 : 1.6, pitch: 0.7, yaw: fs.phi - Math.sign(fs.w) * 0.6 }));
    assert(point > up * 3 + 5, 'danger seconds pointing ' + point.toFixed(1) + ' vs rod up ' + up.toFixed(1));
  },
  slackAfterAChargeThrowsTheHook() {
    const h = hooked('mackerel', 4);
    L.beginPhase(h.fs, 'charge', h.rng);
    h.fs.pDur = 3;
    const r = run(h, () => ({ reel: 0, pitch: 0.6, yaw: 0 }), 6);
    assert.strictEqual(r.over, 'thrown');
  },
  reelingThroughTheChargeKeepsItOn() {
    const h = hooked('mackerel', 4);
    L.beginPhase(h.fs, 'charge', h.rng);
    for (let i = 0; i < 90; i++) L.stepFight(h.fs, { reel: 2.8, rodDir: rodAt(0.6, 0), pitch: 0.6 }, 1 / 60, h.rng);
    assert(!h.fs.over && h.fs.slackT < 0.5, 'slack ' + h.fs.slackT.toFixed(2));
  },
  aHighRodOnAJumpThrowsTheHook() {
    const hi = tally('tarpon', fs => ({ reel: running(fs) ? 0 : 1.6, pitch: 0.85, yaw: fs.phi - Math.sign(fs.w) * 0.6 }), 30);
    const bow = tally('tarpon', good, 30);
    assert(hi.thrown >= 20 && bow.thrown <= 3, 'high ' + JSON.stringify(hi) + ' bow ' + JSON.stringify(bow));
  },
  sidePressureTiresItFaster() {
    const S = side => {
      const h = hooked('bass', 9);
      L.beginPhase(h.fs, 'run', h.rng);
      h.fs.w = 2; h.fs.u = 1; h.fs.pDur = 99;
      for (let i = 0; i < 120; i++) L.stepFight(h.fs, { reel: 0, rodDir: rodAt(0.5, h.fs.phi + side), pitch: 0.5 }, 1 / 60, h.rng);
      return h.fs.S;
    };
    // fish running right (w > 0): leaning the rod left (negative yaw offset) is side pressure
    assert(S(-0.7) < S(0.7) - 0.01, S(-0.7).toFixed(3) + ' vs ' + S(0.7).toFixed(3));
  },
  aFreshFishCannotBeLiftedOut() {
    const h = hooked('bass', 5);
    h.fs.d = h.fs.line = 2.6; h.fs.S = 0.9; L.beginPhase(h.fs, 'rest', h.rng);
    const ev = [];
    for (let i = 0; i < 30 && !h.fs.over; i++) ev.push(...L.stepFight(h.fs, { reel: 2, rodDir: rodAt(0.6, 0), pitch: 0.6 }, 1 / 60, h.rng));
    assert(ev.includes('burst') && !h.fs.over, ev.join(','));
  },
  aTiredFishAtTheDockIsLanded() {
    const h = hooked('bass', 5);
    h.fs.d = h.fs.line = 2.6; h.fs.S = 0.1; L.beginPhase(h.fs, 'rest', h.rng);
    for (let i = 0; i < 60 && !h.fs.over; i++) L.stepFight(h.fs, { reel: 1.5, rodDir: rodAt(0.6, 0), pitch: 0.6 }, 1 / 60, h.rng);
    assert.strictEqual(h.fs.over, 'landed');
  },
  biggerFishFightLonger() {
    const time = id => { let s = 0; for (let k = 1; k <= 20; k++) s += run(hooked(id, k), good).t; return s / 20; };
    assert(time('perch') < time('bass') && time('bass') < time('ray'), [time('perch'), time('bass'), time('ray')].map(x => x.toFixed(1)).join(' '));
  },
  rankingByHeaviestOrTotal() {
    const ps = [{ catches: [{ kg: 3 }, { kg: 3 }] }, { catches: [{ kg: 5 }] }, { catches: [] }];
    assert.deepStrictEqual(L.rank(ps, 'big').map(r => r.i), [1, 0, 2]);
    assert.deepStrictEqual(L.rank(ps, 'total').map(r => r.i), [0, 1, 2]);
  },
};

let fail = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); }
}
console.log(fail ? fail + ' failed' : 'all ' + Object.keys(tests).length + ' passed');
process.exit(fail ? 1 : 0);
