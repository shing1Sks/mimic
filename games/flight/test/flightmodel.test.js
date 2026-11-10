// Plain Node tests for the flight model. Run: node games/flight/test/flightmodel.test.js
'use strict';
const path = require('path');
const FM = require(path.join(__dirname, '..', 'flightmodel.js'));

let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const env = FM.flatEnv(0);
const DT = 1 / 60;
function angDiff(a, b) { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; }

console.log('ground handling');
{
  const s = FM.groundState({ x: 0, z: 0, heading: 90, elevation: 0 });
  const c = FM.controls(); c.throttle = 0;
  for (let t = 0; t < 10; t += DT) FM.step(s, c, DT, env);
  check('at idle on the runway it settles on its wheels and stays put', s.onGround && !s.crashed && Math.abs(s.pos.x) < 1.5,
    { x: s.pos.x, y: s.pos.y, ground: s.onGround, crashed: s.crashed });
  check('  resting attitude is near level', Math.abs(FM.attitude(s).pitch) < 4 && Math.abs(FM.attitude(s).bank) < 1, FM.attitude(s));
}

console.log('takeoff');
{
  const s = FM.groundState({ x: 0, z: 0, heading: 90, elevation: 0 });
  const c = FM.controls(); c.throttle = 1; c.flaps = 1;
  let t = 0, liftoffX = null, speedAt10 = 0, maxLat = 0, climbed = false;
  while (t < 60) {
    c.elevator = s.airspeed > 28 ? 0.45 : 0;                       // rotate at ~55 kt
    c.rudder = clamp(angDiff(90, FM.attitude(s).heading) * 0.15, -1, 1); // pilot keeps it straight
    FM.step(s, c, DT, env); t += DT;
    if (Math.abs(t - 10) < DT / 2) speedAt10 = s.airspeed;
    maxLat = Math.max(maxLat, Math.abs(s.pos.z));
    if (liftoffX === null && !s.onGround && s.pos.y > 3) liftoffX = s.pos.x;
    if (s.pos.y > 30) { climbed = true; break; }
    if (s.crashed) break;
  }
  check('full throttle accelerates the aircraft (>15 m/s after 10 s)', speedAt10 > 15, { speedAt10 });
  check('it lifts off with back pressure', liftoffX !== null, { liftoffX, t, crashed: s.crashed, why: s.crashReason });
  check('  within a plausible ground roll (150..700 m)', liftoffX !== null && liftoffX > 150 && liftoffX < 700, { liftoffX });
  check('  and climbs through 30 m without crashing', climbed && !s.crashed, { y: s.pos.y, t, why: s.crashReason });
  check('  staying near the centreline (<8 m)', maxLat < 8, { maxLat });
}
{
  const s = FM.groundState({ x: 0, z: 0, heading: 90, elevation: 0 });
  const c = FM.controls(); c.throttle = 1;
  let flew = false;
  for (let t = 0; t < 14; t += DT) { c.rudder = clamp(angDiff(90, FM.attitude(s).heading) * 0.15, -1, 1); FM.step(s, c, DT, env); if (s.pos.y > 5) flew = true; }
  check('without back pressure it does not leap off early (14 s, neutral stick)', !flew, { y: s.pos.y, v: s.airspeed });
}

{
  // keyboard-style steering: full rudder on/off with a ramp, starting 1 deg off the centreline heading
  const s = FM.groundState({ x: 0, z: 0, heading: 91, elevation: 0 });
  const c = FM.controls(); c.throttle = 1; let kb = 0, maxErr = 0;
  for (let t = 0; t < 18; t += 1 / 33) {
    const err = angDiff(90, FM.attitude(s).heading);
    const tgt = err > 0.4 ? 1 : err < -0.4 ? -1 : 0, rate = tgt === 0 ? 4 : 1.6;
    kb += clamp(tgt - kb, -rate / 33, rate / 33); c.rudder = kb;
    FM.step(s, c, 1 / 33, env);
    if (t > 3) maxErr = Math.max(maxErr, Math.abs(err));
  }
  check('bang-bang (keyboard) steering on the takeoff roll stays controllable (< 5 deg)', maxErr < 5 && !s.crashed, { maxErr, crashed: s.crashed });
}

console.log('level flight');
{
  const s = FM.trimState({ speed: 50, gamma: 0, alt: 1000, heading: 0, gear: false });
  check('a cruise trim exists below full power', s.trim.throttle > 0.3 && s.trim.throttle < 1, s.trim);
  check('  with the elevator trim inside its range', Math.abs(s.trim.trim) < 1, s.trim);
  const c = FM.controls(); c.throttle = s.trim.throttle; c.trim = s.trim.trim; c.gear = false;
  const y0 = s.pos.y, v0 = s.airspeed;
  let maxDy = 0, maxDv = 0, maxBank = 0;
  for (let t = 0; t < 90; t += DT) {
    FM.step(s, c, DT, env);
    maxDy = Math.max(maxDy, Math.abs(s.pos.y - y0)); maxDv = Math.max(maxDv, Math.abs(s.airspeed - v0));
    maxBank = Math.max(maxBank, Math.abs(FM.attitude(s).bank));
  }
  check('hands-off at cruise power it holds altitude (+-40 m over 90 s)', maxDy < 40, { maxDy });
  check('  and airspeed (+-5 m/s)', maxDv < 5, { maxDv, v0 });
  check('  wings stay level', maxBank < 5, { maxBank });
}
{
  // A pilot holding altitude at 75% power: it must settle at a sensible cruise speed.
  const s = FM.trimState({ speed: 45, gamma: 0, alt: 800, heading: 0, gear: false });
  const c = FM.controls(); c.throttle = 0.75; c.gear = false;
  const y0 = s.pos.y; let maxDy = 0;
  for (let t = 0; t < 180; t += DT) {
    c.elevator = clamp((y0 - s.pos.y) * 0.02 - s.vel.y * 0.08 + s.trim.trim, -1, 1) - s.trim.trim; c.trim = s.trim.trim;
    FM.step(s, c, DT, env);
    if (t > 60) maxDy = Math.max(maxDy, Math.abs(s.pos.y - y0));
  }
  check('at 75% power level flight is sustainable (alt held within 25 m)', maxDy < 25 && !s.crashed, { maxDy });
  check('  settling at a cruise speed of 40..60 m/s', s.airspeed > 40 && s.airspeed < 60, { v: s.airspeed });
}

console.log('stall');
{
  const ac = FM.AIRCRAFT.alphaCrit;
  const cl = a => FM.liftCoefficient(a, 0);
  check('lift grows with angle of attack below the stall', cl(2 * DEG) < cl(8 * DEG) && cl(8 * DEG) < cl(ac - 0.5 * DEG));
  check('past the critical AoA lift falls (stall)', cl(ac + 4 * DEG) < 0.85 * cl(ac), { atCrit: cl(ac), past: cl(ac + 4 * DEG) });
  check('flaps raise lift at the same AoA', FM.liftCoefficient(5 * DEG, 1) > cl(5 * DEG) + 0.3);
}
{
  const s = FM.trimState({ speed: 40, throttle: 0, alt: 1500, heading: 0 });
  const c = FM.controls(); c.throttle = 0; c.trim = s.trim.trim; c.elevator = 1;
  let maxAlpha = 0, stalled = false, clPeak = 0, clDeep = Infinity;
  for (let t = 0; t < 12; t += DT) {
    FM.step(s, c, DT, env);
    maxAlpha = Math.max(maxAlpha, s.alpha);
    if (s.stalled) stalled = true;
    clPeak = Math.max(clPeak, s.CL);
    if (s.alpha > FM.AIRCRAFT.alphaCrit + 3 * DEG) clDeep = Math.min(clDeep, s.CL);
  }
  check('holding full back stick at idle drives the wing past the critical AoA', maxAlpha > FM.AIRCRAFT.alphaCrit, { maxAlphaDeg: maxAlpha / DEG });
  check('  the stall is flagged', stalled);
  check('  and the wing loses lift once deep in the stall', clDeep < clPeak * 0.9, { clPeak, clDeep });
}

console.log('glide stability');
{
  const s = FM.trimState({ speed: 36, throttle: 0, alt: 1500, heading: 45 });
  check('an idle glide trim exists (descending)', s.trim.gamma < 0 && s.trim.gamma > -10 * DEG, { gammaDeg: s.trim.gamma / DEG });
  const c = FM.controls(); c.throttle = 0; c.trim = s.trim.trim;
  let maxBank = 0, minV = 1e9, maxV = 0, maxPitchRate = 0;
  const h0 = FM.attitude(s).heading;
  for (let t = 0; t < 60; t += DT) {
    FM.step(s, c, DT, env);
    const a = FM.attitude(s);
    maxBank = Math.max(maxBank, Math.abs(a.bank));
    minV = Math.min(minV, s.airspeed); maxV = Math.max(maxV, s.airspeed);
    maxPitchRate = Math.max(maxPitchRate, Math.abs(s.omega.y));
  }
  check('neutral controls in a trimmed glide do not diverge (bank < 10 deg)', maxBank < 10, { maxBank });
  check('  airspeed stays 30..42 m/s', minV > 30 && maxV < 42, { minV, maxV });
  check('  pitch rate stays small', maxPitchRate < 0.1, { maxPitchRate });
  check('  heading stays put (< 10 deg drift)', Math.abs(angDiff(FM.attitude(s).heading, h0)) < 10, { h: FM.attitude(s).heading, h0 });
}

console.log('assists');
for (const autoRudder of [false, true]) {
  // a sideslip kick in cruise, aileron pumped like a nervous pilot for 6 s, then hands off
  const s = FM.trimState({ speed: 38, gamma: -3, flaps: 1, alt: 800, heading: 90 });
  const c = FM.controls(); c.throttle = s.trim.throttle; c.trim = s.trim.trim; c.flaps = 1;
  s.omega.z = 0.3;
  let lateMax = 0;
  for (let t = 0; t < 40; t += 1 / 60) {
    c.aileron = t < 6 ? 0.5 * Math.sign(Math.sin(t * 1.6)) : 0;
    const ctl = FM.applyAssists(s, c, { autoRudder, assist: false });
    FM.step(s, ctl, 1 / 60, env);
    if (t > 25) lateMax = Math.max(lateMax, Math.abs(s.beta) / DEG);
  }
  check(`sideslip settles after a disturbance (auto-rudder ${autoRudder ? 'on' : 'off'}): late |beta| < 1.5 deg`, lateMax < 1.5 && !s.crashed, { lateMax });
}
{
  // auto-rudder coordinates a steady 25 deg banked turn (small sideslip)
  const s = FM.trimState({ speed: 45, gamma: 0, alt: 800, heading: 0, gear: false });
  const c = FM.controls(); c.throttle = s.trim.throttle + 0.1; c.trim = s.trim.trim; c.gear = false;
  let betaAbs = 0, n = 0;
  for (let t = 0; t < 30; t += 1 / 60) {
    const a = FM.attitude(s);
    c.aileron = clamp((25 - a.bank) * 0.03 - s.omega.x * 0.2, -1, 1);
    c.elevator = clamp((0 - s.vel.y) * 0.05, -0.3, 0.3);
    const ctl = FM.applyAssists(s, c, { autoRudder: true, assist: false });
    FM.step(s, ctl, 1 / 60, env);
    if (t > 10) { betaAbs += Math.abs(s.beta) / DEG; n++; }
  }
  check('auto-rudder keeps a 25 deg turn coordinated (mean |beta| < 1 deg)', betaAbs / n < 1, { meanBeta: betaAbs / n });
}

console.log('landing');
{
  // stabilised approach (33 m/s, 3 deg, flaps 20) from 25 m, flare near the ground, then brake
  const s = FM.trimState({ speed: 33, gamma: -3, flaps: 2, alt: 25, heading: 90 });
  const c = FM.controls(); c.throttle = s.trim.throttle; c.trim = s.trim.trim; c.flaps = 2;
  let touch = null;
  for (let t = 0; t < 40; t += DT) {
    const agl = s.pos.y - 1.25;
    if (agl < 6 && !touch) { c.throttle = 0; c.elevator = clamp((-0.6 - s.vel.y) * 0.25 + 0.05, -0.2, 0.6); }
    FM.step(s, c, DT, env);
    for (const e of s.events) if (e.type === 'touchdown' && !touch) touch = e;
    s.events.length = 0;
    if (touch) { c.elevator = 0; c.brake = 1; }
  }
  check('a flared landing touches down gently (< 2 m/s sink)', touch && touch.sink < 2, touch);
  check('  is not a crash and brakes bring it to a stop', !s.crashed && s.airspeed < 1, { crashed: s.crashed, why: s.crashReason, v: s.airspeed });
}
{
  const s = FM.groundState({ x: 0, z: 0, heading: 90, elevation: 0 });
  s.pos.y += 6; s.vel = { x: 35, y: -6, z: 0 };
  const c = FM.controls();
  for (let t = 0; t < 4 && !s.crashed; t += DT) FM.step(s, c, DT, env);
  check('slamming in at 6 m/s sink is a crash', s.crashed, { y: s.pos.y });
}
{
  const s = FM.groundState({ x: 0, z: 0, heading: 90, elevation: 0 });
  s.pos.y += 3; s.vel = { x: 32, y: -1, z: 0 };
  const c = FM.controls(); c.gear = false; s.gear = 0; s.gearCmd = false;
  for (let t = 0; t < 5 && !s.crashed; t += DT) FM.step(s, c, DT, env);
  check('landing with the gear up is a crash', s.crashed, { why: s.crashReason });
}
{
  const s = FM.trimState({ speed: 40, gamma: 0, alt: 1000, heading: 0 });
  const c = FM.controls(); c.throttle = s.trim.throttle; c.trim = s.trim.trim; c.gear = false;
  let moved = false;
  for (let t = 0; t < 10; t += DT) { FM.step(s, c, DT, env); for (const e of s.events) if (e.type === 'gear') moved = true; s.events.length = 0; }
  check('gear retracts in flight and reports it', s.gear < 0.01 && moved, { gear: s.gear });
}

console.log('ground effect, wind, turbulence');
{
  const far = FM.groundEffect(100), mid = FM.groundEffect(3), low = FM.groundEffect(0.8);
  check('ground effect fades away above a wingspan', Math.abs(far.lift - 1) < 0.01 && far.induced > 0.98, far);
  check("  near the ground it cuts induced drag", low.induced < 0.65 && mid.induced < far.induced, { low, mid });
  check('  and adds lift (the float in the flare)', low.lift > 1.05 && low.lift < 1.2 && mid.lift > 1 && mid.lift < low.lift, { low, mid });
}
{
  const p2 = FM.windProfile(2), p10 = FM.windProfile(10), p300 = FM.windProfile(300);
  check('wind shear: wind is weaker near the ground', p2 < p10 && p10 < p300 && p2 > 0.3, { p2, p10, p300 });
  check('  and reaches the full value aloft', p300 > 0.97 && p300 <= 1.0001, { p300 });
}
{
  // hands-off cruise in gusty air: the wings get bumped (roll rate) but it does not depart
  const run = turb => {
    const s = FM.trimState({ speed: 50, gamma: 0, alt: 300, heading: 90, gear: false, seed: 7 });
    const c = FM.controls(); c.throttle = s.trim.throttle; c.trim = s.trim.trim; c.gear = false;
    const e = Object.assign(FM.flatEnv(0), { turbulence: turb, wind: { x: -7, y: 0, z: 0 } });
    let maxP = 0, maxBank = 0;
    for (let t = 0; t < 20; t += DT) {
      c.aileron = clamp(-FM.attitude(s).bank * 0.02 - s.omega.x * 0.15, -1, 1); // a lazy wing-leveller pilot
      FM.step(s, c, DT, e); maxP = Math.max(maxP, Math.abs(s.omega.x)); maxBank = Math.max(maxBank, Math.abs(FM.attitude(s).bank));
    }
    return { maxP, maxBank, crashed: s.crashed };
  };
  const calm = run(0), rough = run(0.5);
  check('turbulence rolls the wings (roll rate well above calm air)', rough.maxP > 0.04 && rough.maxP > calm.maxP * 3, { calm, rough });
  check('  but a pilot keeps it upright (bank < 30 deg)', rough.maxBank < 30 && !rough.crashed, rough);
}

console.log('hands-off stability (the mid-flight "push")');
{
  // a phone held still = controls neutral. The trainer must not wander into a spiral dive.
  const fly = (o) => {
    const s = FM.trimState({ speed: 52, gamma: 0, alt: 700, heading: 65, gear: false, seed: o.seed || 3 });
    const e = Object.assign(FM.flatEnv(0), { wind: o.wind || { x: 0, y: 0, z: 0 }, turbulence: o.turb || 0 });
    FM.matchWind(s, e.wind);
    const c = FM.controls(); c.throttle = s.trim.throttle; c.trim = s.trim.trim; c.gear = false;
    const y0 = s.pos.y, dt = o.dt || 1 / 60;
    let maxBank = 0, maxDy = 0, maxVs = 0;
    for (let t = 0; t < (o.T || 180); t += dt) {
      FM.step(s, FM.applyAssists(s, c, { autoRudder: true, level: o.level || 'off', dt }), dt, e);
      maxBank = Math.max(maxBank, Math.abs(FM.attitude(s).bank)); maxDy = Math.max(maxDy, Math.abs(s.pos.y - y0)); maxVs = Math.max(maxVs, Math.abs(s.vel.y));
    }
    return { maxBank: +maxBank.toFixed(1), maxDyFt: Math.round(maxDy * 3.281), maxVsFpm: Math.round(maxVs * 196.85), crashed: s.crashed };
  };
  const breeze = fly({ wind: { x: -3, y: 0, z: 0 } });
  check('a steady breeze changes nothing once the aircraft moves with the air (wings level, < 30 ft)', breeze.maxBank < 1 && breeze.maxDyFt < 30, breeze);
  for (const seed of [3, 9, 21]) {
    const r = fly({ wind: { x: -3, y: 0, z: 0 }, turb: 0.15, seed });
    check(`  light chop, auto-rudder on, no assist, seed ${seed}: no spiral dive (bank < 20, < 400 ft)`, r.maxBank < 20 && r.maxDyFt < 400 && !r.crashed, r);
  }
  for (const seed of [3, 9]) {
    const r = fly({ wind: { x: -7, y: 0, z: 0 }, turb: 0.5, seed, level: 'steady' });
    check(`  gusty air with the Steady assist, seed ${seed}: holds attitude (bank < 8, < 120 ft)`, r.maxBank < 8 && r.maxDyFt < 120, r);
  }
  const calmSteady = fly({ level: 'steady', T: 60 });
  check('  calm air with the Steady assist: rock solid (bank < 0.5, < 10 ft)', calmSteady.maxBank < 0.5 && calmSteady.maxDyFt < 10, calmSteady);
}
{
  // turbulence must not depend on the frame rate (it used to: a fixed blend per frame)
  const rms = dt => {
    const s = FM.trimState({ speed: 50, gamma: 0, alt: 800, heading: 90, gear: false, seed: 5 });
    const e = Object.assign(FM.flatEnv(0), { turbulence: 0.5 });
    let a = 0, n = 0;
    for (let t = 0; t < 400; t += dt) { FM.step(s, FM.controls(), dt, e); s.pos.y = 800; if (t > 5) { a += s.gust.y * s.gust.y; n++; } }
    return Math.sqrt(a / n);
  };
  const r30 = rms(1 / 30), r144 = rms(1 / 144);
  check('turbulence strength is the same at 30 and 144 fps (within 25%)', Math.abs(r30 / r144 - 1) < 0.25, { r30, r144 });
  check('  gusty air is gentle: vertical gust rms 0.3..1.2 m/s', r144 > 0.3 && r144 < 1.2, { r144 });
  const s = FM.trimState({ speed: 50, gamma: 0, alt: 800, heading: 90, gear: false });
  FM.step(s, FM.controls(), 1 / 60, Object.assign(FM.flatEnv(0), { turbulence: 0.5 }));
  check('  the state reports the turbulence the pilot is in (for the HUD)', s.turb > 0.3, { turb: s.turb });
}
{
  // Steady assist: the stick (or phone tilt) commands an attitude; neutral holds level flight
  const s = FM.trimState({ speed: 52, gamma: 0, alt: 700, heading: 0, gear: false });
  const e = FM.flatEnv(0);
  const c = FM.controls(); c.throttle = s.trim.throttle + 0.15; c.trim = s.trim.trim; c.gear = false;
  const y0 = s.pos.y;
  let bankSum = 0, n = 0;
  for (let t = 0; t < 40; t += DT) {
    c.aileron = 0.5;
    FM.step(s, FM.applyAssists(s, c, { autoRudder: true, level: 'steady', dt: DT }), DT, e);
    if (t > 15) { bankSum += FM.attitude(s).bank; n++; }
  }
  const bank = bankSum / n;
  check('Steady: half right tilt gives a steady right bank of 13..20 deg (full tilt = 33)', bank > 13 && bank < 20, { bank });
  check('  and the turn holds its altitude (< 150 ft)', Math.abs(s.pos.y - y0) * 3.281 < 150, { dyFt: (s.pos.y - y0) * 3.281 });
  for (let t = 0; t < 15; t += DT) { c.aileron = 0; FM.step(s, FM.applyAssists(s, c, { autoRudder: true, level: 'steady', dt: DT }), DT, e); }
  check('  letting go rolls the wings level', Math.abs(FM.attitude(s).bank) < 3, FM.attitude(s));
  const yA = s.pos.y;
  for (let t = 0; t < 20; t += DT) { c.elevator = 0.5; FM.step(s, FM.applyAssists(s, c, { autoRudder: true, level: 'steady', dt: DT }), DT, e); }
  check('  nose-up tilt climbs', s.pos.y - yA > 40 && s.vel.y > 1, { dy: s.pos.y - yA, vs: s.vel.y });
  let maxAlpha = 0;
  c.throttle = 0;
  for (let t = 0; t < 40; t += DT) { c.elevator = 1; FM.step(s, FM.applyAssists(s, c, { autoRudder: true, level: 'steady', dt: DT }), DT, e); maxAlpha = Math.max(maxAlpha, s.alpha / DEG); }
  check('  full back stick at idle cannot stall it', maxAlpha < FM.alphaCritFor(0) / DEG && !s.crashed, { maxAlpha });
}

{
  // Steady near the ground: a full roll command just after takeoff must not dig a wingtip in
  // (a playtest at Leh caught a wingtip at 68 ft in a 38 deg bank)
  const s = FM.trimState({ speed: 34, gamma: 4, alt: 20, heading: 90, gear: true, flaps: 1 });
  const c = FM.controls(); c.throttle = 1; c.trim = s.trim.trim; c.flaps = 1;
  let maxBank = 0;
  for (let t = 0; t < 8; t += DT) {
    c.aileron = -1;
    FM.step(s, FM.applyAssists(s, c, { autoRudder: true, level: 'steady', dt: DT }), DT, FM.flatEnv(0));
    if (s.agl < 30) maxBank = Math.max(maxBank, Math.abs(FM.attitude(s).bank));
  }
  check('Steady: full roll at 60 ft stays a shallow bank (< 17 deg) and does not crash', maxBank < 17 && !s.crashed, { maxBank, crashed: s.crashReason });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
