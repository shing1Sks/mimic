// Run: node games/fishing/test/depths.test.js
// Tidecast: Depths - zones, steering the lure by tilt, the deep fish (bites, schools, predators that
// swallow your catch), snagging, the tackle-box economy and the save file.
'use strict';
const assert = require('assert');
const D = require('../depths.js');
const L = require('../logic.js');

const dir = (pitch, yaw) => ({ x: Math.cos(pitch) * Math.sin(yaw), y: Math.sin(pitch), z: -Math.cos(pitch) * Math.cos(yaw) });
/** Work a fresh lure for secs with a fixed rod pose (neutral = level, straight out). */
function steer(pitch, yaw, secs, o) {
  o = o || {};
  const l = D.createLure(0, -20, { dive: o.dive || 1.3, lineLen: o.lineLen || 400 });
  if (o.plane) l.plane = -20;
  D.setNeutral(l, dir(0, 0));
  let r;
  for (let t = 0; t < secs; t += 1 / 60) r = D.steerLure(l, { f: dir(pitch, yaw), reel: o.reel || 0, tip: o.tip }, 1 / 60);
  return Object.assign(l, { r });
}
const lure = o => Object.assign({ id: 1, x: 0, y: -10, z: -20, active: true, bait: { kind: 'worm', cls: 0 }, light: 0, twitch: 99, moving: 0, claimed: -1 }, o);

const tests = {
  zonesFollowDepth() {
    assert.strictEqual(D.zoneAt(5).id, 'reef'); assert.strictEqual(D.zoneAt(30).id, 'kelp');
    assert.strictEqual(D.zoneAt(120).id, 'twilight'); assert.strictEqual(D.zoneAt(300).id, 'abyss');
    assert(D.zoneMix(5).light > D.zoneMix(40).light && D.zoneMix(40).light > D.zoneMix(150).light && D.zoneMix(300).light < 0.01);
  },
  theLureSinksOnItsOwnToItsTerminalSpeed() {
    // a held rod lets it drop: the fall settles at the weight's terminal speed (spool friction aside)
    const l = steer(0, 0, 8, { dive: 1.3 });
    assert(-l.vy > 1.3 * 0.85 && -l.vy < 1.3 * 1.05, 'vy ' + l.vy.toFixed(2));
    assert(l.depth > 7, 'depth ' + l.depth.toFixed(1));
    assert(Math.hypot(l.x, l.z + 20) < 0.05, 'falls straight down');
  },
  aHeavierLureSinksFaster() {
    assert(steer(0, 0, 6, { dive: 3.5 }).depth > steer(0, 0, 6, { dive: 1.3 }).depth + 8);
  },
  itTakesTimeToGetGoing() {
    const l = steer(0, 0, 0.05, { dive: 3.5 });
    assert(-l.vy < 2.2, 'water resists a fast start: ' + l.vy.toFixed(2));
  },
  liftingTheRodClimbsLettingGoFallsBack() {
    const l = steer(0, 0, 4, { dive: 1.3 });
    const d0 = l.depth;
    for (let t = 0; t < 2; t += 1 / 60) D.steerLure(l, { f: dir(0.5, 0), reel: 0 }, 1 / 60);
    assert(l.depth < d0 - 1, 'lift climbs: ' + d0.toFixed(1) + ' -> ' + l.depth.toFixed(1));
    const d1 = l.depth;
    for (let t = 0; t < 3; t += 1 / 60) D.steerLure(l, { f: dir(0, 0), reel: 0 }, 1 / 60);
    assert(l.depth > d1 + 1, 'and it falls back when the tip drops');
  },
  turningTheTipGlidesThatWay() {
    const r = steer(0, 0.5, 3), lf = steer(0, -0.5, 3);
    assert(r.heading > 0.5 && lf.heading < -0.5, r.heading + ' ' + lf.heading);
    assert(r.x > 1 && lf.x < -1, 'glides along its heading: ' + r.x.toFixed(2) + ' ' + lf.x.toFixed(2));
  },
  aSharpSweepDartsTheLure() {
    const l = steer(0, 0, 2);
    const vy0 = l.vy;
    for (let k = 0; k < 4; k++) D.steerLure(l, { f: dir(0, 0), reel: 0, tip: { x: 0, y: 8, z: 0 } }, 1 / 60);
    assert(l.vy > vy0 + 1.5, 'darted up: ' + vy0.toFixed(2) + ' -> ' + l.vy.toFixed(2));
  },
  theLinePaysOutAsItSinksUpToTheReel() {
    const l = steer(0, 0, 30, { dive: 3.5, lineLen: 30 });
    const d = Math.hypot(l.x - l.ox, l.y, l.z - l.oz);
    assert(l.r.taut && Math.abs(d - 30) < 0.05 && Math.abs(l.lineOut - 30) < 0.01, 'line ' + d.toFixed(2));
  },
  reelingTakesLineInAndBringsItHome() {
    const l = steer(0, 0, 5);
    const out0 = l.lineOut;
    let r;
    for (let t = 0; t < 30 && !(r && r.surfaced); t += 1 / 60) r = D.steerLure(l, { f: dir(0, 0), reel: 2.4 }, 1 / 60);
    assert(r.surfaced && out0 > 5, 'surfaced from ' + out0.toFixed(1) + ' m of line');
  },
  theRopeArcsBehindAMovingLure() {
    const l = steer(0, 0, 6);
    for (let t = 0; t < 0.8; t += 1 / 60) D.steerLure(l, { f: dir(0, 0.6), reel: 0 }, 1 / 60);
    const n = l.rope.length - 1, mid = l.rope[n >> 1];
    const straightX = l.ox + (l.x - l.ox) * 0.5;
    assert(Math.abs(mid.x - straightX) > 0.05, 'the line lags in the water, it is not a straight stick');
    for (let i = 0; i < n; i++) {
      const a = l.rope[i], b = l.rope[i + 1];
      assert(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) <= l.lineOut / n * 1.08, 'segments keep their length');
    }
  },
  aquariumLuresStayOnTheGlass() {
    const l = steer(0, 0.4, 3, { plane: true });
    assert(l.z === -20 && l.x > 1 && l.depth > 2, JSON.stringify({ x: l.x, z: l.z, d: l.depth }));
  },
  speciesLiveAtTheirDepths() {
    const rng = L.rng32(4);
    for (let i = 0; i < 200; i++) { const s = D.pickSpecies(10, rng); assert(s.dmin - 4 <= 10 && 10 <= s.dmax + 4, s.id); }
    const deep = new Set(); for (let i = 0; i < 300; i++) deep.add(D.pickSpecies(140, rng).id);
    assert(deep.has('lantern') && deep.has('squid') && !deep.has('perch'), [...deep].join(','));
    assert.strictEqual(D.SPECIES.length, 15);
  },
  bigBaitBringsBigFishAndScaresSmall() {
    const bait = { kind: 'fish', cls: 2 };
    assert(D.baitAppeal(D.byId('tarpon'), bait) > 1 && D.baitAppeal(D.byId('perch'), bait) === 0);
    assert(D.baitAppeal(D.byId('perch'), { kind: 'worm' }) === 1);
  },
  aFishFindsTheLureNibblesAndStrikes() {
    let struck = 0;
    for (let s = 1; s <= 10; s++) {
      const rng = L.rng32(s), f = D.spawnFish(D.byId('perch'), 2, -10, -21, rng), l = lure();
      for (let t = 0; t < 20; t += 1 / 60) if (D.stepFish(f, 1 / 60, { lures: [l], fish: [f] }, rng).some(e => e.type === 'strike')) { struck++; break; }
    }
    assert(struck >= 6, struck + '/10');
  },
  schoolsHoldTogether() {
    const rng = L.rng32(2), sch = D.spawnSchool(D.byId('mackerel'), 0, -8, -20, rng);
    for (let t = 0; t < 10; t += 1 / 60) for (const f of sch) D.stepFish(f, 1 / 60, { lures: [], fish: sch }, rng);
    const lead = sch[0], spread = Math.max(...sch.map(f => Math.hypot(f.x - lead.x, f.y - lead.y, f.z - lead.z)));
    assert(sch.length === D.byId('mackerel').school && spread < 8, 'spread ' + spread.toFixed(1));
  },
  aPredatorSwallowsTheHookedFish() {
    let ate = 0;
    for (let s = 1; s <= 10; s++) {
      const rng = L.rng32(s), pike = D.spawnFish(D.byId('pike'), 6, -30, -20, rng), small = D.spawnFish(D.byId('perch'), 0, -30, -20, rng);
      const hooked = [{ lure: 1, fish: small, x: 0, y: -30, z: -20, struggle: 1 }];
      for (let t = 0; t < 25; t += 1 / 60) if (D.stepFish(pike, 1 / 60, { lures: [], fish: [pike], hooked }, rng).some(e => e.type === 'eat' && e.prey === small)) { ate++; break; }
    }
    assert(ate >= 6, ate + '/10');
  },
  smallFishNeverEatBigOnes() {
    const rng = L.rng32(3), perch = D.spawnFish(D.byId('perch'), 1, -10, -20, rng), pike = D.spawnFish(D.byId('pike'), 0, -10, -20, rng);
    const hooked = [{ lure: 1, fish: pike, x: 0, y: -10, z: -20, struggle: 1 }];
    for (let t = 0; t < 20; t += 1 / 60) assert(!D.stepFish(perch, 1 / 60, { lures: [], fish: [perch], hooked }, rng).some(e => e.type === 'chase' || e.type === 'eat'));
  },
  theSwallowCarriesTheFightOn() {
    const rng = L.rng32(1), perch = D.spawnFish(D.byId('perch'), 0, -20, -20, rng), pike = D.spawnFish(D.byId('pike'), 0, -20, -20, rng);
    const fs = L.createFight(perch, 20, 0.2, 0.6, rng);
    const nf = D.swallow(fs, pike, rng, L.createFight);
    assert(nf.sp.id === 'pike' && nf.chain === 1 && nf.T > fs.T && Math.abs(nf.d - 21.5) < 1e-9);
    assert.strictEqual(D.swallow(nf, D.spawnFish(D.byId('grouper'), 0, -20, -20, rng), rng, L.createFight).chain, 2);
  },
  runningIntoCoverSnagsUnlessYouLeanAway() {
    const covers = [{ x: 0, y: -30, z: -20, r: 1.5 }];
    const run = side => { const st = { meter: 0 }; const fs = { phase: 'run', side }; let snag = false; for (let t = 0; t < 3 && !snag; t += 1 / 60) snag = D.stepSnag(st, { x: 1, y: -30, z: -20 }, covers, fs, 1 / 60); return snag; };
    assert(run(0) && !run(0.8));
  },
  marketPricesAndUpgrades() {
    const sp = D.byId('angler'), f = { sp, kg: 10 };
    assert(D.price(f, 1) === 450 && D.price(f, 3) > D.price(f, 1));
    const s = D.newSave(); s.coins = 100;
    assert(D.buy(s, 'line') && s.coins === 40 && D.gearStats(s).lineLen === 60);
    assert(!D.buy(s, 'line'), 'cannot afford');
    s.coins = 1e6; while (D.buy(s, 'line')); assert(D.gearStats(s).lineLen === 350 && D.upgradeCost(s, 'line') === null);
  },
  baitIsKeptCycledAndUsedUp() {
    const s = D.newSave(), rng = L.rng32(1);
    D.keepAsBait(s, D.spawnFish(D.byId('mackerel'), 0, 0, 0, rng));
    assert.strictEqual(D.currentBait(s).kind, 'worm');
    D.cycleBait(s); assert.strictEqual(D.currentBait(s).id, 'mackerel');
    D.useBait(s); assert(s.baits.length === 0 && D.currentBait(s).kind === 'worm');
  },
  theJournalRemembers() {
    const s = D.newSave(), rng = L.rng32(1), f = D.spawnFish(D.byId('squid'), 0, -90, 0, rng);
    const r = D.logCatch(s, f, 92, { kind: 'worm' });
    assert(r.first && r.record && s.journal.squid.minD === 92 && D.bestBait(s.journal.squid) === 'worm');
  },
  savesRoundTripAndSurviveJunk() {
    const s = D.newSave(); s.coins = 321; s.gear.light = 2; D.keepAsBait(s, D.spawnFish(D.byId('perch'), 0, 0, 0, L.rng32(1))); s.bait = 0;
    const back = D.loadSave(JSON.stringify(s));
    assert(back.coins === 321 && back.gear.light === 2 && back.baits.length === 1 && back.bait === 0);
    for (const junk of ['', '{', 'null', '[]', JSON.stringify({ coins: -5, gear: { line: 99 }, baits: [{ id: 'nope' }], bait: 7 })]) {
      const t = D.loadSave(junk);
      assert(t.coins >= 0 && t.gear.line <= 4 && Array.isArray(t.baits) && t.bait === 'worm', junk);
    }
  },
  theDirectorBringsAFish() {
    const rng = L.rng32(5), f = D.spawnFish(D.byId('bass'), 8, -25, -20, rng), l = lure({ y: -25 });
    assert(D.directBite([f], l, rng).fish === f && f.state === 'approach' && l.claimed === f.id);
    assert(D.directBite([], lure(), rng).spawn);
  },
};

let fail = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); }
}
console.log(fail ? fail + ' failed' : 'all ' + Object.keys(tests).length + ' passed');
process.exit(fail ? 1 : 0);
