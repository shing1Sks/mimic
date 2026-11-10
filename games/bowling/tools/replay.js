#!/usr/bin/env node
/*
 * Emberlane - replay a real phone recording through the game's own input path, headless.
 *
 *   node games/bowling/tools/replay.js <recording dir | input.ndjson> [--legacy] [--zero] [--grip] [--arm] [--keyup] [--aim=G|--pro] [--bumpers] [--json]
 *
 * Every recorded phone sample ({k:'ev', name:'m', st, ax, b, mode}) is put on a fake gamepad and
 * read by the real input.js (the same poll, de-duplication and HOLD edge detection as in the
 * browser); the grip and release go through the same kin.js calls game.js makes (gripRef at the
 * grip, throwFrom at the release); each ball is then rolled down the lane with physics.js.
 * The game's turn flow is followed from the recording itself: the first press starts the game
 * from the title; after that a press only grabs the ball when the recorded game was ready for it
 * (after the recorded 'cycle' / 'result' of the last shot).
 *
 * Per throw it prints the speed, heading (+ = left), loft, board at the release (boards counted
 * from the right gutter, 1..39, head pin = 20) and where the ball got to: the board at the
 * arrows (4.6 m) and at the head pin, gutter, bounces (floor impacts with a real rebound) and
 * pins down, next to what the game logged at the time ('was').
 *
 * --legacy  the old path, for comparison: the fixed align pose (no lane reference), the stance
 *           step from the arm's sideways offset at the grip, the body tracker, no swing plane.
 * --zero    the phone's own heading zero as the lane (the v4/v5 default), instead of the grip
 *           forearm + REF.HOLD (v6).
 * --grip    the raw forearm heading at the grip as straight (no HOLD offset), to see the offset.
 * --aim=G   aim gain (kin.js AIM): the heading relative to the reference times G (default
 *           AIM.NORMAL 0.4, the game's default); --pro = 1:1.
 * --keyup   always release at the key-up (v5/v6), no release at the swing's bottom (v7).
 * --bumpers roll the balls with the gutter bumpers up.
 * --arm     the ball's velocity from the rigid arm model (w x r) instead of the hand's measured
 *           velocity (kin.js handVelocity), for before / after. --legacy implies it.
 * Columns 'model' and 'src': the arm model's speed at the same release, and which velocity the
 * ball got ('hand' measured, 'arm' model: no accelerometer, a gap or a clipped reading).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------- a fake browser for input.js
let NOW = 0, PAD = null;
global.window = global;
global.performance = { now: () => NOW };
Object.defineProperty(global, 'navigator', { value: { getGamepads: () => [PAD] }, configurable: true, writable: true });
global.addEventListener = () => {};
global.setInterval = () => 0;
const K = require(path.join(ROOT, 'kin.js'));
const P = require(path.join(ROOT, 'physics.js'));
global.BW = window.BW || {};
BW.Kin = K;
require(path.join(ROOT, 'input.js'));

function load(arg) {
  const file = fs.statSync(arg).isDirectory() ? path.join(arg, 'input.ndjson') : arg;
  return fs.readFileSync(file, 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
}

// game.js geometry (BODY): right-handed, stance at the centre
const SHOULDER = { x: 0.17, y: 0.92, z: 0.42 + 0.35 };
const boardAt = x => (P.LANE.HALF - x) / (2 * P.LANE.HALF / 39) + 0.5;

/** Roll a released ball on a full rack; where did it go. */
function roll(rb, o) {
  const sim = P.createSim({ bumpers: !!(o && o.bumpers) });
  P.rack(sim);
  const b = P.launch(sim, { x: rb.pos.x, y: rb.pos.y, z: rb.pos.z, v: [rb.v.x, rb.v.y, rb.v.z], w: [rb.spin.x, rb.spin.y, rb.spin.z] });
  let t = 0, arrows = null, pins = null, bounces = 0, firstLand = null, maxUp = 0, inAir = b.x[1] > P.BALL.R + 0.005;
  while (t < 14) {
    const ev = P.advance(sim, P.DT);
    t += P.DT;
    for (const e of ev) if (e.a === b && e.kind === 'floor') { if (firstLand === null) firstLand = b.x[2]; }
    const air = b.x[1] > P.BALL.R + 0.004;
    if (air && !inAir && b.v[1] > 0.15) bounces++;
    inAir = air;
    if (b.x[2] < 0) maxUp = Math.max(maxUp, b.x[1] - P.BALL.R);
    if (arrows === null && b.x[2] < -4.57) arrows = boardAt(b.x[0]);
    if (pins === null && b.x[2] < P.LANE.HEAD_Z + 0.3) pins = boardAt(b.x[0]);
    if (b.gone === 'back') break;
    if (t > 3 && (b.gone || b.asleep) && P.settled(sim)) break;
  }
  return { arrows, pins, gutter: b.gutter, dropped: b.gone === 'back' || b.x[2] > -0.05, bounces, firstLand, down: sim.pins.filter(p => !P.standing(p)).length };
}

function replay(lines, o) {
  o = o || {};
  const mc = { slot: 0, mode: 'grip' };
  const IN = BW.Input.create(mc);
  const M = lines.filter(e => e.k === 'ev' && e.name === 'm');
  // recorder time -> sample time (st - t is the same for every sample, up to jitter)
  const offs = M.slice(0, 50).map(e => e.st - e.t).sort((a, b) => a - b);
  const off = offs[offs.length >> 1] || 0;
  const thrown = lines.filter(e => e.name === 'throw');
  // when the recorded game was ready for the next ball after each throw
  const readyAt = thrown.map((th, i) => {
    const next = lines.find(e => e.t > th.t && (e.name === 'cycle' || (e.name === 'result' && e.dropped)));
    if (!next) return Infinity;
    return (next.name === 'cycle' ? next.t : next.t + 1100) + off;
  });
  // the recorded session starts on the title screen: the first press starts the game (as in
  // game.js, the ball then needs a fresh press)
  let aligned = false, mode = 'title', waitPress = false, grip = null, pending = null, ti = 0, base = 0, stance = 0;
  const out = [];
  for (const e of M) {
    const bits = e.b | 0;
    PAD = { id: 'Mimic (replay)', connected: true, timestamp: e.st, axes: e.ax.slice(0, 6),
      buttons: Array.from({ length: 12 }, (_, i) => ({ pressed: !!(bits & (1 << i)) })) };
    NOW = e.st;
    mc.mode = e.mode === 'grip' || e.mode === 'wand' ? e.mode : 'grip';
    IN.frame(NOW);
    if (bits & 2048) { base = K.armHeading(IN.S.q).yaw; aligned = true; }   // CENTRE: re-zero (tilt check in game.js)
    if (mode === 'rolling' && NOW >= (readyAt[ti - 1] || 0)) { mode = 'ready'; waitPress = IN.S.a; }
    for (const ev of IN.drain()) {
      if (ev.kind === 'press' && mode === 'title') { mode = 'ready'; waitPress = true; continue; }
      if (ev.kind === 'press' && mode === 'ready') {
        if (waitPress) { waitPress = false; continue; }
        const s = IN.track.samples.find(x => x.t === ev.t) || IN.track.samples[IN.track.samples.length - 1];
        mode = 'held';
        if (o.legacy) {
          grip = { ref: K.DEFAULT_Q0, src: 'legacy' };
          const r = K.armVec(K.handRot(s.q, K.DEFAULT_Q0));
          stance = Math.abs(r.x) > 0.06 ? Math.max(-0.63, Math.min(0.29, stance + r.x)) : stance;
          K.bodyStart(IN.body, ev.t);
        } else {
          grip = K.gripRef(s.q, base, { aligned });
          if (o.zero) grip = Object.assign({}, grip, { ref: K.laneRef(aligned ? base : 0), yaw: aligned ? base : 0, src: 'zero*' });
          if (o.grip) grip = Object.assign(K.gripRef(s.q, base, { aligned, hold: 0 }), { src: 'grip*' });
        }
      }
      if (ev.kind === 'release' && mode === 'ready') waitPress = false;
      if (ev.kind === 'release' && mode === 'held') { mode = 'released'; pending = ev.t; }
    }
    if (waitPress && !IN.S.a) waitPress = false;
    if (o.legacy && (mode === 'held' || mode === 'released')) IN.updateBody(K.DEFAULT_Q0);
    if (mode === 'released' && IN.lastT() >= pending + 40) {
      const sh = { x: SHOULDER.x + stance, y: SHOULDER.y, z: SHOULDER.z };
      const clampP = p => ({ x: p.x, y: p.y, z: Math.max(0.14 - SHOULDER.z, p.z) });
      const T = o.legacy
        ? K.throwFrom(IN.track.samples, pending, grip.ref, sh, { body: IN.body, useBody: true, clampP, plane: false, hand: false, bottom: false, aimGain: 1 })
        : K.throwFrom(IN.track.samples, pending, grip.ref, sh, { hand: !o.arm, aimGain: o.aim != null ? o.aim : K.AIM.NORMAL, bottom: !o.keyup });
      if (o.legacy) K.bodyStop(IN.body);
      const was = thrown[ti] && Math.abs(thrown[ti].tRel - pending) < 2 ? thrown[ti] : null;
      if (T) {
        const rb = T.rb;
        out.push({ n: out.length + 1, tRel: pending, src: grip.src, yaw: grip.yaw, armYaw: grip.armYaw, tilt: grip.tilt,
          kmh: rb.speed * 3.6, heading: rb.heading * 180 / Math.PI, loft: rb.loft * 180 / Math.PI, board: boardAt(rb.pos.x),
          pos: rb.pos, rb, roll: roll(rb, o), was, rel: T.release, bodyV: rb.bodyV, vSrc: rb.vSrc, modelKmh: K.len(rb.armModelV) * 3.6,
          anchorMs: T.hv ? T.hv.t0 - pending : null });
      }
      ti++;
      mode = 'rolling';
    }
  }
  return out;
}

function fmt(rows, o) {
  const f = (v, d, w) => (v == null || !isFinite(v) ? '-' : v.toFixed(d)).padStart(w);
  const lines = [];
  const tag = (o.legacy ? 'LEGACY (old path)' : o.zero ? 'PHONE ZERO' : o.grip ? 'GRIP HEADING (raw)' : o.arm ? 'ARM MODEL' : 'NEW') + (o.legacy ? '' : ` aim x${o.aim != null ? o.aim : K.AIM.NORMAL}`) + (o.keyup ? ' keyup' : '') + (o.bumpers ? ' bumpers' : '');
  lines.push(`${tag}  ` +
    ' #   km/h  head  loft  board | arrows  pins  bounces  result        | ref        | src  model | release     | was: km/h  head  loft  board');
  for (const r of rows) {
    const R = r.roll;
    const res = R.dropped ? 'dropped' : R.gutter ? `gutter ${R.down}` : `${R.down} down`;
    const ref = r.src === 'legacy' ? 'fixed q0' : `${r.src} ${f(r.yaw * 180 / Math.PI, 0, 4)}`;
    const w = r.was;
    lines.push(`${''.padStart(tag.length)}  ${String(r.n).padStart(2)} ${f(r.kmh, 1, 6)} ${f(r.heading, 1, 5)} ${f(r.loft, 0, 5)} ${f(r.board, 1, 6)} |` +
      ` ${f(R.arrows, 1, 6)} ${f(R.pins, 1, 5)} ${String(R.bounces).padStart(8)}  ${res.padEnd(13)} | ${ref.padEnd(10)} | ${r.vSrc} ${f(r.modelKmh, 1, 5)} | ${(r.rel ? r.rel.mode + ' ' + (r.rel.lag == null ? '-' : Math.round(r.rel.lag)) : '').padEnd(11)} |` +
      (w ? ` ${f(w.kmh, 1, 9)} ${f(w.heading_deg, 1, 5)} ${f(w.loft_deg, 0, 5)} ${f(w.board, 1, 6)}` : ''));
  }
  return lines.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const src = args.find(a => !a.startsWith('--'));
  if (!src) { console.error('usage: node tools/replay.js <recording dir | input.ndjson> [--legacy] [--zero] [--grip] [--arm] [--keyup] [--aim=G|--pro] [--bumpers] [--json]'); process.exit(2); }
  const aim = args.find(a => a.startsWith('--aim='));
  if (args.includes('--noapproach')) K.APPROACH.V = 0;
  const o = { legacy: args.includes('--legacy'), zero: args.includes('--zero'), grip: args.includes('--grip'), arm: args.includes('--arm'), keyup: args.includes('--keyup'), bumpers: args.includes('--bumpers'),
    aim: args.includes('--pro') ? 1 : aim ? +aim.slice(6) : undefined };
  const rows = replay(load(src), o);
  if (args.includes('--json')) console.log(JSON.stringify(rows.map(r => ({ n: r.n, kmh: r.kmh, heading: r.heading, loft: r.loft, board: r.board, src: r.src, vSrc: r.vSrc, modelKmh: r.modelKmh, anchorMs: r.anchorMs, release: r.rel, roll: r.roll })), null, 1));
  else console.log(fmt(rows, o));
}

module.exports = { replay, load, roll, fmt };
