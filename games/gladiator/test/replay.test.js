// Iron Ludus: the user's real session (recordings/gladiator-20261110-191039) replayed through the
// new blade against a training post standing in reach. Run: node games/gladiator/test/replay.test.js
//
// In that session the old game turned ~30 big swings (25-48 rad/s) into glances: its rushed /
// waggle / tired-arm multipliers cut their power to ~0.1 (see the report). Here the same phone
// samples drive the same arm model and blade the game draws; contacts are judged on the blade's
// own speed and edge at the moment it meets the body.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const C = require(path.join(__dirname, '..', 'combat.js'));
const RECS = path.join(__dirname, '..', '..', '..', 'recordings');
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}

// mimic.js (read-only) for the same phone frame change and arm model the game uses
const ctx = { performance: { now: () => 0 }, navigator: { getGamepads: () => [] }, addEventListener() {}, innerWidth: 1000, innerHeight: 1000, Math, Promise, Uint8Array, console };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'mimic.js'), 'utf8'), ctx);
const MM = ctx.MimicMath;
const S2 = Math.SQRT1_2, Cq = { x: -S2, y: 0, z: 0, w: S2 }, Ci = { x: S2, y: 0, z: 0, w: S2 };

// the first session (Wand, logged at ~30 Hz) and the second (Grip, at the full pad rate)
for (const [dir, label] of [['gladiator-20261110-191039', 'session 1'], ['gladiator-20261110-224952', 'session 2']]) {
  const REC = path.join(RECS, dir, 'input.ndjson');
  if (!fs.existsSync(REC)) { console.log('recording not found, skipped: ' + REC); continue; }
  replay(REC, label);
}
function replay(REC, label) {
  const pads = fs.readFileSync(REC, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(o => o.k === 'pad' && o.ax.length === 6);
  const frames = pads.map(p => {
    const [x, y, z] = p.ax, w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
    return { t: p.t, q: MM.mul(MM.mul(Cq, { x, y, z, w }), Ci) };
  });
  // CENTRE calibration stand-in: the grip's roll at rest (game.js calibrate)
  let rs = 0, rc = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i], dt = (b.t - a.t) / 1000;
    if (dt <= 0) continue;
    const ang = 2 * Math.acos(Math.min(1, Math.abs(a.q.x * b.q.x + a.q.y * b.q.y + a.q.z * b.q.z + a.q.w * b.q.w))) / dt;
    if (ang > 1.2) continue;
    const g = MM.rotate({ x: -b.q.x, y: -b.q.y, z: -b.q.z, w: b.q.w }, { x: 0, y: 1, z: 0 });
    if (Math.hypot(g.x, g.y) < 0.5) continue;
    const phi = Math.atan2(g.x, g.y); rs += Math.sin(phi); rc += Math.cos(phi);
  }
  const roll = Math.atan2(rs, rc);

  const B = C.BODY, O = B.rigOffset;
  // the sword: the phone with the grip's roll taken out (game.js), its hand placed by the drawn arm (combat.solveArm)
  const unroll = { x: 0, y: 0, z: Math.sin(-roll / 2), w: Math.cos(-roll / 2) };
  function blade(qPhone) {
    const q = MM.mul(qPhone, unroll), h = C.solveArm(q, MM.armPose(q, 'right'), 0, MM.rotate).hand;
    const base = { x: h.x + O[0], y: h.y + O[1] + B.eye, z: h.z + O[2] };
    return { h: C.add(base, MM.rotate(q, { x: 0, y: 0, z: B.guardZ })), t: C.add(base, MM.rotate(q, { x: 0, y: 0, z: B.guardZ - B.blade })),
      edge: MM.rotate(q, { x: 0, y: 1, z: 0 }) };
  }
  function slerp(a, b, t) {
    let d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w, s = 1;
    if (d < 0) { d = -d; s = -1; }
    let wa = 1 - t, wb = t * s;
    if (d < 0.9995) { const th = Math.acos(d), sn = Math.sin(th); wa = Math.sin((1 - t) * th) / sn; wb = s * Math.sin(t * th) / sn; }
    const o = { x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb, z: a.z * wa + b.z * wb, w: a.w * wa + b.w * wb }, l = Math.hypot(o.x, o.y, o.z, o.w);
    return { x: o.x / l, y: o.y / l, z: o.z / l, w: o.w / l };
  }
  // the training post at 1.3 m (its capsules as fighters.js Dummy builds them)
  const D = 1.3;
  const post = [{ zone: 'head', a: C.v3(0, 1.64, -D), b: C.v3(0, 1.75, -D), r: 0.12 }, { zone: 'torso', a: C.v3(0, 0.95, -D), b: C.v3(0, 1.5, -D), r: 0.18 },
    { zone: 'offArm', a: C.v3(0.33, 1.42, -D), b: C.v3(0.34, 1.03, -D + 0.24), r: 0.04 }, { zone: 'swordArm', a: C.v3(-0.33, 1.42, -D), b: C.v3(-0.3, 1.3, -D + 0.45), r: 0.04 },
    { zone: 'legs', a: C.v3(0, 0, -D), b: C.v3(0, 0.9, -D), r: 0.07 }];

  const tr = C.swingTracker(), view = { x: C.v3(1, 0, 0), y: C.v3(0, 1, 0), z: C.v3(0, 0, -1) };
  const swings = [];
  let cur = null, prev = null;
  for (const fr of frames) {
    const bl = blade(fr.q);
    if (prev) {
      const dt = (fr.t - prev.t) / 1000;
      if (dt <= 0) continue;
      const ang = 2 * Math.acos(Math.min(1, Math.abs(fr.q.x * prev.q.x + fr.q.y * prev.q.y + fr.q.z * prev.q.z + fr.q.w * prev.q.w)));
      const ev = C.swingStep(tr, { t: fr.t, vel: C.scale(C.sub(bl.t, prev.bl.t), 1 / dt), ang: ang / dt, view });
      if (ev === 'start') { cur = { t: fr.t, peakAng: 0, hit: null }; swings.push(cur); }
      if (cur) {
        cur.peakAng = Math.max(cur.peakAng, ang / dt);
        const K = Math.max(1, Math.min(12, Math.ceil(ang / 0.07)));
        let A0 = prev.bl;
        for (let k = 1; k <= K && !cur.hit; k++) {
          const A1 = blade(slerp(prev.q, fr.q, k / K));
          const h = C.sweepBody(A0, A1, post, post, 0.012);
          if (h) {
            const vel = C.pointVel(A0, A1, h.u, dt / K);
            const cls = C.classifyContact({ hilt: A1.h, tip: A1.t, vel, u: h.u, edge: A1.edge });
            const res = C.strikeDamage(Object.assign({ zone: h.zone }, cls));
            if (res.result !== 'touch') cur.hit = { zone: h.zone, kind: cls.kind, speed: cls.speed, dmg: res.damage };
          }
          A0 = A1;
        }
      }
      if (ev === 'end') { cur.peak = tr.peak; cur = null; }
    }
    prev = { t: fr.t, q: fr.q, bl };
  }
  const big = swings.filter(s => s.peakAng > 20);
  const hits = big.filter(s => s.hit);
  const dmg = hits.map(s => s.hit.dmg).sort((a, b) => a - b);
  const by = k => hits.reduce((m, s) => (m[s.hit[k]] = (m[s.hit[k]] || 0) + 1, m), {});
  console.log(`${label}: ${frames.length} phone samples over ${((frames[frames.length - 1].t - frames[0].t) / 1000).toFixed(0)} s, grip roll ${(roll * 180 / Math.PI).toFixed(0)} deg`);
  console.log(`swings: ${swings.length} detected, ${big.length} big (>20 rad/s); ${hits.length} of the big ones landed on the post`);
  console.log('  by zone', JSON.stringify(by('zone')), ' by kind', JSON.stringify(by('kind')));
  console.log('  damage per landed big swing: min', dmg[0], 'median', dmg[dmg.length >> 1], 'max', dmg[dmg.length - 1]);
  console.log('  ' + big.map(s => (s.t / 1000).toFixed(1) + 's ' + (s.hit ? `${s.hit.zone}/${s.hit.kind} ${s.hit.speed.toFixed(0)}m/s=${s.hit.dmg}` : 'miss')).join(' | '));

  check(label + ': its big swings are found as swings', big.length >= 25, big.length);
  check(label + ': at least 40% of them land real cuts on a post in reach', hits.length / big.length >= 0.4, hits.length / big.length);
  check(label + ': a landed big swing does real damage (median >= 15, a recruit has 100)', dmg[dmg.length >> 1] >= 15, dmg[dmg.length >> 1]);
  check(label + ': most land edge first once the grip is calibrated', (by('kind').edge || 0) >= hits.length * 0.75, by('kind'));
  const total = dmg.reduce((a, b) => a + b, 0);
  check(label + ': its big swings alone carry enough to fell the recruit three times over', total >= 300, total);
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
