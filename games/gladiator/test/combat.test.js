// Iron Ludus combat rules. Run: node games/gladiator/test/combat.test.js
'use strict';
const path = require('path');
const C = require(path.join(__dirname, '..', 'combat.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const V = C.v3;
const seg = (h, t) => ({ h, t });

console.log('blade collision (swept, 3D)');
{
  const c = C.closestSegSeg(V(-1, 0, 0), V(1, 0, 0), V(0, -1, 0.3), V(0, 1, 0.3));
  check('closest points of two crossing segments', Math.abs(c.dist - 0.3) < 1e-9 && Math.abs(c.s - 0.5) < 1e-9 && Math.abs(c.t - 0.5) < 1e-9, c);
  // his blade held upright; yours sweeps straight through it in ONE frame (a 40 rad/s swing):
  // it is on one side before the frame and on the other after, never within reach at either end
  const his = seg(V(0, 1, -1), V(0, 1.8, -1));
  const A0 = seg(V(-0.4, 1.4, -0.2), V(-0.9, 1.4, -1.0)), A1 = seg(V(0.4, 1.4, -0.2), V(0.9, 1.4, -1.0));
  const ends = [A0, A1].map(a => C.closestSegSeg(a.h, a.t, his.h, his.t).dist);
  check('the fast blade is clear of his at both ends of the frame', ends.every(d => d > 0.1), ends);
  const hit = C.sweepSegSeg(A0, A1, his, his, 0.028);
  check('...and the sweep still finds the clash (no tunnelling)', !!hit && hit.f > 0.2 && hit.f < 0.8, hit);
  check('...at a point on his blade', hit && Math.abs(hit.point.x) < 0.05 && hit.point.y > 1.35 && hit.point.y < 1.45, hit && hit.point);
  const miss = C.sweepSegSeg(seg(V(-0.4, 2.2, -0.2), V(-0.9, 2.2, -1)), seg(V(0.4, 2.2, -0.2), V(0.9, 2.2, -1)), his, his, 0.028);
  check('a blade passing above his does not touch it', miss === null, miss);
  // both moving: his blow coming down, yours rising into it
  const H0 = seg(V(0, 2.0, -1), V(0.3, 2.3, -0.3)), H1 = seg(V(0, 1.3, -1), V(0.3, 1.1, -0.3));
  const Y0 = seg(V(0.25, 1.2, -0.4), V(-0.5, 1.3, -0.6)), Y1 = seg(V(0.25, 1.5, -0.4), V(-0.5, 1.8, -0.6));
  check('two moving blades meet mid-frame', !!C.sweepSegSeg(H0, H1, Y0, Y1, 0.028));
}
{
  const body = [{ zone: 'head', a: V(0, 1.55, -1.3), b: V(0, 1.7, -1.3), r: 0.11 }, { zone: 'torso', a: V(0, 0.95, -1.3), b: V(0, 1.42, -1.3), r: 0.18 },
    { zone: 'legs', a: V(0.1, 0.1, -1.3), b: V(0.1, 0.9, -1.3), r: 0.09 }];
  const A0 = seg(V(-0.3, 1.2, -0.5), V(-0.9, 1.25, -1.2)), A1 = seg(V(0.3, 1.2, -0.5), V(0.9, 1.25, -1.2));
  const h = C.sweepBody(A0, A1, body, body, 0.012);
  check('a level cut through the chest finds the torso', h && h.zone === 'torso', h);
  const hh = C.sweepBody(seg(V(-0.3, 1.62, -0.5), V(-0.9, 1.62, -1.25)), seg(V(0.3, 1.62, -0.5), V(0.9, 1.62, -1.25)), body, body, 0.012);
  check('a level cut at head height finds the head', hh && hh.zone === 'head', hh);
  const disc = { c: V(0, 1.2, -1), n: V(0, 0, 1), R: 0.3, th: 0.03 };
  check('a cut into a round shield meets the shield', !!C.sweepDisc(A0, seg(V(0.3, 1.2, -0.5), V(0.9, 1.25, -1.2)), disc, disc));
  check('a cut well beside the shield misses it', !C.sweepDisc(seg(V(1.2, 1.2, -0.5), V(1.4, 1.2, -1.2)), seg(V(1.3, 1.2, -0.5), V(1.5, 1.2, -1.2)), disc, disc));
}

console.log('what a contact is: edge, flat, thrust');
{
  const hilt = V(0, 1.3, -0.3), tip = V(0, 1.3, -1.1);       // blade pointing at him
  const edgeUp = V(0, 1, 0);
  let c = C.classifyContact({ hilt, tip, vel: V(0, -15, 0), u: 0.7, edge: edgeUp });
  check('a downward chop with the edge leading is an edge cut', c.kind === 'edge' && c.edge01 === 1, c);
  c = C.classifyContact({ hilt, tip, vel: V(15, 0, 0), u: 0.7, edge: edgeUp });
  check('the same blade swept sideways leads with the flat', c.kind === 'flat', c);
  c = C.classifyContact({ hilt, tip, vel: V(10, -10, 0), u: 0.7, edge: edgeUp });
  check('45 degrees off the edge still cuts', c.kind === 'edge', c);
  c = C.classifyContact({ hilt, tip, vel: V(0.5, 0, -5), u: 0.95, edge: edgeUp });
  check('the point driven along the blade is a thrust', c.kind === 'thrust' && c.axial > 4.5, c);
  c = C.classifyContact({ hilt, tip, vel: V(0.5, 0, -5), u: 0.4, edge: edgeUp });
  check('...but not when the contact is near the hilt', c.kind !== 'thrust', c);
  c = C.classifyContact({ hilt, tip, vel: V(0, 0.4, 6), u: 0.6, edge: edgeUp });
  check('pulling the blade back along itself is a draw cut', c.kind === 'draw', c);
}

console.log('damage maths');
{
  const d = o => C.strikeDamage(Object.assign({ kind: 'edge', edge01: 1, zone: 'torso', speed: 20 }, o));
  const full = d({}), half = d({ speed: 11.5 }), light = d({ speed: 5 });
  check('a full 20 m/s edge cut to the body is under a third of a recruit (100)', full.damage >= 26 && full.damage <= 32, full);
  check('harder swings do more: 20 > 11.5 > 5 m/s', full.damage > half.damage && half.damage > light.damage, [full.damage, half.damage, light.damage]);
  check('the recorded big swings (25-30 m/s) are rewarded, capped at 1.25x', d({ speed: 28 }).damage > full.damage && d({ speed: 60 }).damage === d({ speed: 24.25 }).damage);
  check('a 2 m/s touch does nothing', d({ speed: 2 }).result === 'touch' && d({ speed: 2 }).damage === 0);
  check('the head takes 1.45x', d({ zone: 'head' }).damage === Math.round((4 + 25) * 1.45), d({ zone: 'head' }));
  check('limbs take less than the body', d({ zone: 'swordArm' }).damage < full.damage && d({ zone: 'legs' }).damage < full.damage);
  check('the flat does about a third of the edge', d({ kind: 'flat' }).damage <= Math.round(full.damage * 0.4), d({ kind: 'flat' }));
  check('a hard flat slap still staggers', d({ kind: 'flat', speed: 16 }).stagger);
  const armWeak = d({ speed: 8, armor: 0.4 }), armHard = d({ speed: 20, armor: 0.4 });
  check('armour turns a weak cut', armWeak.result === 'armor' && armWeak.damage <= 2, armWeak);
  check('...a hard cut gets through, reduced', armHard.result === 'hit' && armHard.damage < full.damage, armHard);
  const th = C.strikeDamage({ kind: 'thrust', axial: 6, zone: 'torso', armor: 0.4 });
  const cutArm = C.strikeDamage({ kind: 'edge', speed: 20, edge01: 1, zone: 'torso', armor: 0.4 });
  check('a point finds the gaps in armour better than an edge', th.damage > cutArm.damage, [th.damage, cutArm.damage]);
  const ctr = d({ state: 'windup', speed: 12 });
  check('cutting into his wind-up is a counter and staggers', ctr.counter && ctr.stagger && ctr.damage > d({ speed: 12 }).damage, ctr);
  check('your cut arm weakens your cuts', d({ mul: C.woundMods({ armLevel: 2, legLevel: 0 }).cut }).damage < full.damage);
}

console.log('parry timing: your blade against his blow');
{
  // his overhead coming down at you this frame; your blade held across your head
  const his0 = seg(V(-0.1, 2.2, -0.9), V(0.0, 2.5, -0.2)), his1 = seg(V(-0.1, 1.6, -0.8), V(0.0, 1.35, -0.1));
  const guard = seg(V(0.3, 1.75, -0.35), V(-0.45, 1.85, -0.45));
  const dt = 1 / 60;
  const judge = (Y0, Y1) => {
    const h = C.sweepSegSeg(his0, his1, Y0, Y1, 0.028);
    if (!h) return 'hit';
    const myV = C.pointVel(Y0, Y1, h.w, dt), hisV = C.pointVel(his0, his1, h.u, dt);
    return C.judgeBlock({ into: -C.dot(myV, C.norm(hisV)), u: h.w, heavy: false });
  };
  check('blade held in his path (arrived early, still): block', judge(guard, guard) === 'block');
  const rising0 = seg(V(0.3, 1.55, -0.35), V(-0.45, 1.6, -0.45));
  check('blade rising into the blow as it lands: parry', judge(rising0, guard) === 'parry');
  const late = seg(V(0.6, 0.9, -0.2), V(0.9, 0.4, -0.5));
  check('blade nowhere near: the blow lands', judge(late, late) === 'hit');
  check('a heavy blow met still near the tip drives through', C.judgeBlock({ into: 0, u: 0.8, heavy: true }) === 'beaten');
  check('...met near the hilt it is held', C.judgeBlock({ into: 0, u: 0.35, heavy: true }) === 'block');
  check('...and beating into it hard parries even a heavy', C.judgeBlock({ into: 5, u: 0.5, heavy: true }) === 'parry');
  check('a blade going the same way as his blow is beaten', C.judgeBlock({ into: -4, u: 0.4 }) === 'beaten');
  check('off balance after a missed swing: no parry, only a block', C.judgeBlock({ into: 4, u: 0.5, offBalance: true }) === 'block');
  check('the parry needs the strong or middle of the blade', C.judgeBlock({ into: 4, u: 0.95 }) !== 'parry');
}
console.log('your cut against his guard');
{
  check('a hard cut beats a guard aside', C.judgeCut({ speed: 18, his: 'guard', strength: 9 }) === 'beat');
  check('a middling cut stops on it', C.judgeCut({ speed: 8, his: 'guard', strength: 9 }) === 'blocked');
  check('his active parry throws a normal cut away', C.judgeCut({ speed: 10, his: 'parrying', strength: 9 }) === 'parried');
  check('...unless it is far harder than his guard', C.judgeCut({ speed: 20, his: 'parrying', strength: 9 }) === 'beat');
  check('hitting his raised blade in the wind-up beats it if hard enough', C.judgeCut({ speed: 12, his: 'windup', strength: 12 }) === 'beat' && C.judgeCut({ speed: 6, his: 'windup', strength: 12 }) === 'blocked');
  check('a shield takes a lot more than a blade', C.judgeCut({ speed: 18, his: 'guard', strength: 22 }) === 'blocked');
}

console.log('swings: read, never penalised');
{
  const tr = C.swingTracker(), view = { x: V(1, 0, 0), y: V(0, 1, 0), z: V(0, 0, -1) };
  const evs = [];
  let t = 0;
  const feed = vel => { evs.push(C.swingStep(tr, { t, vel, ang: 20, view })); t += 16; };
  for (let i = 0; i < 8; i++) feed(V(-20, -2, 0));      // forehand right to left
  for (let i = 0; i < 8; i++) feed(V(22, 1, 0));        // straight back the other way
  for (let i = 0; i < 6; i++) feed(V(0, 0, 0));
  check('forehand then backhand are two swings', evs.filter(e => e === 'start').length === 2 && evs.filter(e => e === 'end').length === 2, evs);
  check('the second swing came from the left (moving right)', tr.line === 'left', tr.line);
  check('the tracker keeps the peak tip speed', tr.peak >= 22, tr.peak);
  check('there is no stamina or rushed penalty anywhere in the rules', C.effectivePower === undefined && C.STAMINA_MAX === undefined);
  check('lines on the defender screen: downward = high, rising = low, along the view = thrust',
    C.lineOf(V(0, -1, 0), view) === 'high' && C.lineOf(V(0.2, 1, 0), view) === 'low' && C.lineOf(V(0, 0.1, -1), view) === 'thrust' && C.lineOf(V(-0.7, -0.7, 0), view) === 'highRight');
}

console.log('his blows: telegraphed, aimed, in 3D');
{
  const cfg = { shoulder: V(-0.19, 1.43, 0.04), reach: 0.56, blade: [0.12, 0.85] };
  for (const line of ['left', 'right', 'high', 'highLeft', 'thrust']) {
    const atk = { line, heavy: false, target: C.aimPoint('torso', 1.22) };
    const f = line === 'thrust' ? 1 : C.impactAt(false);
    const p = C.attackPose(atk, 'strike', f, cfg);
    // closest point of the blade (grip+a .. grip+b) to the target
    const a = C.add(p.hilt, C.scale(p.dir, cfg.blade[0])), b = C.add(p.hilt, C.scale(p.dir, cfg.blade[1]));
    const c = C.closestSegSeg(a, b, atk.target, atk.target);
    check(`a ${line} blow passes through its target`, c.dist < 0.08, { d: c.dist });
  }
  const wl = C.attackPose({ line: 'left', target: C.aimPoint('torso', 1.2) }, 'windup', 1, cfg);
  const wr = C.attackPose({ line: 'right', target: C.aimPoint('torso', 1.2) }, 'windup', 1, cfg);
  check('the tell: a blow from your left winds up to your left, from your right to your right', wl.dir.x < -0.4 && wr.dir.x > 0.4, [wl.dir, wr.dir]);
  check('...and the blade is raised in the wind-up', wl.dir.y > 0.3 && wr.dir.y > 0.3);
}

console.log('wounds');
{
  const w = C.woundState();
  let fx = C.applyWound(w, 'swordArm', 12, { armed: true, rng: () => 0.99 });
  check('a sword-arm cut raises the arm wound level', w.armLevel === 1 && !fx.disarm, w);
  check('...which slows his wind-ups and weakens his blows', C.woundMods(w).windup > 1 && C.woundMods(w).damage < 1);
  fx = C.applyWound(w, 'swordArm', 15, { armed: true, rng: () => 0.1 });
  check('a hard cut on the sword arm can disarm', fx.disarm);
  fx = C.applyWound(C.woundState(), 'offArm', 10, { shield: true });
  check('a cut shield arm drops the shield', fx.shieldDrop);
  const lw = C.woundState();
  fx = C.applyWound(lw, 'legs', 13, {});
  check('a leg cut makes him limp and slows his feet', fx.limp && C.woundMods(lw).feet < 1 && !fx.kneel);
  fx = C.applyWound(lw, 'legs', 18, {});
  check('a hard leg cut drops him to a knee', fx.kneel);
  check('a heavy head blow dazes', C.applyWound(C.woundState(), 'head', 20, {}).daze);
}

console.log('the opponent');
{
  const prof = Object.assign({}, C.LADDER[0].foes[0], { gap: [300, 300], windup: [800, 800], feint: 0, heavy: 0 });
  const b = C.createBrain(prof, 7);
  let evs = [], t = 0;
  while (t < 5000 && !evs.find(e => e.type === 'strike')) { evs = evs.concat(C.brainStep(b, 16)); t += 16; }
  const tel = evs.find(e => e.type === 'telegraph'), st = evs.find(e => e.type === 'strike');
  check('he telegraphs, then strikes after the wind-up', tel && st && b.state === 'strike', evs.map(e => e.type));
  check('he steps in to strike distance during the wind-up', b.distGoal <= prof.range.strike + 0.01 && b.dist < prof.range.idle, [b.dist, b.distGoal]);
  C.endStrike(b, 'parried');
  check('a parried blow leaves him staggered (open)', b.state === 'stagger');
  const w = C.createBrain(Object.assign({}, prof), 3);
  const r1 = C.brainHit(w, { damage: 14, stagger: false, counter: false }, 'swordArm');
  check('cutting his sword arm slows his next wind-up', C.woundMods(w.wounds).windup > 1 || r1.disarm);
  // a feint, and the trap for a swinger
  const fp = Object.assign({}, prof, { feint: 1, gap: [100, 100] });
  const fb = C.createBrain(fp, 11);
  t = 0; while (fb.state !== 'windup' && t < 4000) { C.brainStep(fb, 16); t += 16; }
  const firstLine = fb.attack.line;
  const r = C.brainSwing(fb, { line: 'left', big: true });
  const ev2 = C.brainStep(fb, 16);
  check('swinging at his feint springs the trap: the real blow comes from another line, fast', r === 'trap' && fb.attack.line !== firstLine && fb.attack.windup < 400 && ev2.some(e => e.type === 'feint' && e.trap), [r, firstLine, fb.attack]);
  // reading an alternating swinger
  const rb = C.createBrain(Object.assign({}, prof, { read: 1 }), 5);
  for (const l of ['left', 'right', 'left']) C.brainSwing(rb, { line: l, big: true });
  check('cut left, right, left and he expects right', rb.read === 'right', rb.read);
  const pb = C.createBrain(Object.assign({}, prof, { punish: 1 }), 9);
  pb.state = 'idle';
  const pa = C.brainOpening(pb, 'left');
  check('a missed full swing gets punished, from a line your blade is not on', pa && pa.line !== 'left' && pa.kind === 'punish', pa);
  const pat = C.createBrain(Object.assign({}, prof, { patience: 2000, gap: [100, 100] }), 2);
  let began = false, tp = 0;
  while (tp < 1500) { if (tp % 300 === 0) C.brainSwing(pat, { line: 'left', big: true }); if (C.brainStep(pat, 20).some(e => e.type === 'telegraph')) began = true; tp += 20; }
  check('a patient fighter does not walk into a blade that keeps swinging', !began);
  while (tp < 2600 && !began) { if (C.brainStep(pat, 20).some(e => e.type === 'telegraph')) began = true; tp += 20; }
  check('...he comes in at the gap once it stops', began);
  const hb = C.createBrain(Object.assign({}, prof, { hyper: 22 }), 4);
  hb.state = 'windup'; hb.attack = { heavy: true, line: 'high', chain: 0 };
  C.brainHit(hb, { damage: 14, counter: true, stagger: true }, 'torso');
  check('a brute heavy wind-up shrugs off a light cut', hb.state === 'windup');
  C.brainHit(hb, { damage: 25, counter: true, stagger: true }, 'torso');
  check('...but not a hard one', hb.state === 'stagger');
  const kb = C.createBrain(Object.assign({}, prof), 1);
  C.brainHit(kb, { damage: 19, stagger: false }, 'legs');
  check('a hard leg cut puts him on one knee', kb.state === 'kneel');
  const db = C.createBrain(Object.assign({}, prof), 1);
  db.r = () => 0.01;
  C.brainHit(db, { damage: 16, stagger: false }, 'swordArm');
  check('...a hard sword-arm cut can disarm him', db.state === 'disarmed' && !db.armed);
}

console.log('tutorial');
{
  const t = C.tutorialStart();
  C.tutorialEvent(t, { type: 'aligned' });
  check('lining up finishes the first step', t.step === 1);
  let r = C.tutorialEvent(t, { type: 'hit', kind: 'flat', dmg: 3, speed: 9 });
  check('a flat hit does not count, and says why', t.count === 0 && /flat/.test(r.tip));
  r = C.tutorialEvent(t, { type: 'whiff' });
  check('a miss says the post is in reach', /reach/.test(r.tip));
  for (let i = 0; i < 3; i++) r = C.tutorialEvent(t, { type: 'hit', kind: 'edge', dmg: 20, speed: 18 });
  check('three clean cuts move on to blocking', t.step === 2 && r.advanced);
  r = C.tutorialEvent(t, { type: 'hurt' });
  check('getting hit while learning to block explains what to do', /across/.test(r.tip) && t.count === 0);
  C.tutorialEvent(t, { type: 'blocked' }); C.tutorialEvent(t, { type: 'parry' });
  check('two blocks (a parry counts) move on to parrying', t.step === 3);
  r = C.tutorialEvent(t, { type: 'blocked' });
  check('a block is not a parry, and says so', t.step === 3 && /into/.test(r.tip));
  C.tutorialEvent(t, { type: 'parry' });
  r = C.tutorialEvent(t, { type: 'hit', kind: 'edge', dmg: 20, speed: 18 });
  check('a cut does not finish the thrust step', t.step === 4 && /cut/.test(r.tip));
  C.tutorialEvent(t, { type: 'hit', kind: 'thrust', dmg: 25, speed: 5 });
  check('a thrust finishes the tutorial', t.done);
}

console.log('versus');
check('two blades: the one beating into the other wins', C.bladeMeet({ into: 8, u: 0.5 }, { into: 1, u: 0.5 }) === 'aBeats' && C.bladeMeet({ into: 3, u: 0.5 }, { into: 3, u: 0.5 }) === 'clash');
check('round winner by knockout, else health at the bell', C.pvpRoundWinner(50, 0, false) === 0 && C.pvpRoundWinner(40, 60, true) === 1 && C.pvpRoundWinner(40, 60, false) === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
