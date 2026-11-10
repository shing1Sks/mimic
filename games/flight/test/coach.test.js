// Run: node games/flight/test/coach.test.js  -- the flight coach says the one next thing to do
'use strict';
const assert = require('assert');
const C = require('../coach.js');

const base = { mode: 'runway', device: 'phone', ias: 0, aglFt: 0, onGround: true, gearDown: true, throttle: 0, vsFpm: 0, t: 0 };
const at = o => C.coach(Object.assign({}, base, o));
const t = {
  takeoffStartsWithFullThrottle() {
    const c = at({});
    assert.strictEqual(c.id, 'throttle');
    assert.ok(/D-pad/.test(c.text) && /up/i.test(c.text), c.text);
    assert.ok(/Shift/.test(at({ device: 'kbm' }).text), 'keyboard names its key');
  },
  thenRollsToRotationSpeed() {
    const c = at({ throttle: 1, ias: 30 });
    assert.strictEqual(c.id, 'roll');
    assert.ok(/55/.test(c.text) && /30/.test(c.text), 'says target and current speed: ' + c.text);
  },
  thenLiftTheNose() {
    const c = at({ throttle: 1, ias: 56 });
    assert.strictEqual(c.id, 'rotate');
    assert.ok(/nose up/i.test(c.text) && /tilt/i.test(c.text), c.text);
  },
  airborneGearUpThenClimb() {
    assert.strictEqual(at({ throttle: 1, ias: 65, onGround: false, aglFt: 60 }).id, 'gear');
    assert.ok(/\b2\b/.test(at({ throttle: 1, ias: 65, onGround: false, aglFt: 60 }).text));
    assert.strictEqual(at({ throttle: 1, ias: 70, onGround: false, aglFt: 400, gearDown: false }).id, 'climb');
    assert.strictEqual(at({ throttle: 1, ias: 80, onGround: false, aglFt: 1200, gearDown: false }).id, 'free');
  },
  flapsUpForTheClimb() {
    // from the user's recording: full power, stick back, flaps 20 all the way up the climb
    const c = at({ throttle: 1, ias: 55, onGround: false, aglFt: 400, gearDown: false, flaps: 2 });
    assert.strictEqual(c.id, 'flapsUp');
    assert.ok(/hold A/.test(c.text), c.text);
    assert.ok(/press V/.test(at({ device: 'kbm', throttle: 1, ias: 55, onGround: false, aglFt: 400, gearDown: false, flaps: 2 }).text));
    assert.notStrictEqual(at({ throttle: 1, ias: 55, onGround: false, aglFt: 400, gearDown: false, flaps: 1 }).id, 'flapsUp', 'flaps 10 is fine');
  },
  freeFlightInTheRealWorldNamesTheNearestRunway() {
    const c = at({ mode: 'free', onGround: false, aglFt: 2000, ias: 95, gearDown: false, throttle: 0.7, nearest: { name: 'HAL', rwy: '27', distKm: 12.4, dir: 'south-east' } });
    assert.strictEqual(c.id, 'free');
    assert.ok(/HAL/.test(c.text) && /12 km/.test(c.text) && /south-east/.test(c.text), c.text);
    assert.ok(!/09/.test(c.text), 'no island runway in the real world');
  },
  lowPassSaysGetDownThenKeepTheChain() {
    const lp = o => at(Object.assign({ mode: 'lowpass', onGround: false, gearDown: false, throttle: 0.8, ias: 100, aglFt: 600 }, o));
    assert.strictEqual(lp({}).id, 'lpDown');
    assert.ok(/600 ft/.test(lp({}).text), lp({}).text);
    assert.strictEqual(lp({ ias: 60 }).id, 'lpSlow');
    assert.strictEqual(lp({ aglFt: 120, skim: { active: true, mult: 1 } }).id, 'lpLow');
    assert.ok(/x4/.test(lp({ aglFt: 80, skim: { active: true, mult: 4 } }).text));
  },
  freeFlightTipsTheStuntsLater() {
    const f = t => at({ mode: 'free', device: 'kbm', onGround: false, aglFt: 2000, ias: 95, gearDown: false, throttle: 0.7, t });
    assert.ok(!/roll/i.test(f(10).text), 'not straight away');
    assert.ok(/press 1/.test(f(42).text) && /125 kt/.test(f(42).text), f(42).text);
    assert.ok(/twice/.test(at({ mode: 'free', device: 'pad', onGround: false, aglFt: 2000, ias: 95, gearDown: false, throttle: 0.7, t: 42 }).text), 'pads flick');
  },
  stallWarningBeatsEverything() {
    const c = at({ throttle: 1, ias: 35, onGround: false, aglFt: 500, gearDown: false, stall: true });
    assert.strictEqual(c.id, 'stall');
    assert.ok(/nose down/i.test(c.text));
  },
  landingCoaching() {
    const L = o => C.coach(Object.assign({}, base, { mode: 'landing', onGround: false, aglFt: 800, ias: 72, throttle: 0.4, gearDown: true }, o));
    assert.strictEqual(L({ ias: 90 }).id, 'slow');
    assert.strictEqual(L({ vsFpm: -1200 }).id, 'sinking');
    assert.strictEqual(L({}).id, 'approach');
    assert.strictEqual(L({ aglFt: 30 }).id, 'flare');
    assert.strictEqual(L({ onGround: true, aglFt: 0 }).id, 'brake');
  },
  airStartExplainsThenFreeFlight() {
    const A = o => C.coach(Object.assign({}, base, { mode: 'air', onGround: false, aglFt: 2000, ias: 100, gearDown: false, throttle: 0.6 }, o));
    assert.strictEqual(A({ t: 2 }).id, 'basics');
    assert.strictEqual(A({ t: 30 }).id, 'free');
  },
  steepBankSaysRollLevelTheRightWay() {
    const c = at({ onGround: false, aglFt: 300, ias: 70, throttle: 1, gearDown: false, bank: -72 });
    assert.strictEqual(c.id, 'level');
    assert.ok(/right/.test(c.text) && /72/.test(c.text), c.text);
    assert.notStrictEqual(at({ onGround: false, aglFt: 300, ias: 70, throttle: 1, gearDown: false, bank: -58 }).id, 'level', 'a 60 deg sport turn is fine');
    assert.notStrictEqual(at({ onGround: false, aglFt: 3000, ias: 90, throttle: 1, gearDown: false, bank: 150, stunt: true }).id, 'level', 'not mid-roll');
  },
  // ---- missions: the coach turns the objective into the next control input
  missionTakeoffUsesTheRunwayCoaching() {
    const c = at({ mode: 'mission', mission: { kind: 'takeoff', name: 'Take off' } });
    assert.strictEqual(c.id, 'throttle');
  },
  missionGearUpAfterTakeoff() {
    const c = at({ mode: 'mission', onGround: false, aglFt: 300, ias: 70, throttle: 1, gearDown: true, mission: { kind: 'waypoint', name: 'the lake', distM: 5000, relBearing: 0 } });
    assert.strictEqual(c.id, 'gear');
  },
  ringTurnSaysWhichWayInTheDevicesWords() {
    const m = { kind: 'ring', name: 'Ring 3', idx: 3, total: 10, distM: 1200, relBearing: -40, dyM: 0 };
    const c = at({ mode: 'mission', onGround: false, aglFt: 500, ias: 100, throttle: 0.8, gearDown: false, mission: m });
    assert.strictEqual(c.id, 'turn');
    assert.ok(/left/i.test(c.text) && /bank the phone/i.test(c.text) && /3/.test(c.text), c.text);
    const k = at({ device: 'kbm', mode: 'mission', onGround: false, aglFt: 500, ias: 100, throttle: 0.8, gearDown: false, mission: Object.assign({}, m, { relBearing: 50 }) });
    assert.ok(/right/i.test(k.text) && /\bD\b/.test(k.text), k.text);
  },
  ringClimbAndThrough() {
    const air = { mode: 'mission', onGround: false, aglFt: 500, ias: 100, throttle: 0.8, gearDown: false };
    assert.strictEqual(at(Object.assign({}, air, { mission: { kind: 'ring', idx: 2, total: 10, distM: 600, relBearing: 3, dyM: 45 } })).id, 'climb');
    assert.strictEqual(at(Object.assign({}, air, { mission: { kind: 'ring', idx: 2, total: 10, distM: 600, relBearing: 3, dyM: -45 } })).id, 'descend');
    assert.strictEqual(at(Object.assign({}, air, { mission: { kind: 'ring', idx: 2, total: 10, distM: 600, relBearing: 3, dyM: 5 } })).id, 'ring');
  },
  waypointCruiseNamesTheTargetAndDistance() {
    const c = at({ mode: 'mission', onGround: false, aglFt: 1500, ias: 100, throttle: 0.7, gearDown: false, mission: { kind: 'waypoint', name: 'the lake', distM: 4200, relBearing: 4, altFt: 1500 } });
    assert.strictEqual(c.id, 'cruise');
    assert.ok(/the lake/.test(c.text) && /4\.2 km/.test(c.text), c.text);
  },
  missionLandingFarThenCrosswind() {
    const air = { mode: 'mission', onGround: false, aglFt: 800, ias: 72, throttle: 0.4, gearDown: true };
    assert.strictEqual(at(Object.assign({}, air, { mission: { kind: 'land', name: 'Land at Brookfield', distM: 9000, relBearing: 30 } })).id, 'navigate');
    const cw = { kind: 'land', name: 'Land on runway 09', distM: 2000, relBearing: 0, crosswind: 'left' };
    const c = at(Object.assign({}, air, { mission: cw }));
    assert.strictEqual(c.id, 'crab'); assert.ok(/left/.test(c.text) && /into the wind/.test(c.text), c.text);
    const f = at(Object.assign({}, air, { aglFt: 25, mission: cw }));
    assert.strictEqual(f.id, 'flare'); assert.ok(/straighten/i.test(f.text), f.text);
    assert.strictEqual(at(Object.assign({}, air, { gearDown: false, aglFt: 600, mission: cw })).id, 'gearDown');
  },
};
let fail = 0;
for (const [n, f] of Object.entries(t)) { try { f(); console.log('ok  ', n); } catch (e) { fail++; console.log('FAIL', n, e.message); } }
console.log(fail ? fail + ' failed' : 'all passed'); process.exit(fail ? 1 : 0);
