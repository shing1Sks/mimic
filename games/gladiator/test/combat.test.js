// Iron Ludus combat rules. Run: node games/gladiator/test/combat.test.js
'use strict';
const path = require('path');
const C = require(path.join(__dirname, '..', 'combat.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

console.log('swing power and tracking');
check('slow rotation has no power', C.swingPower(4) === 0);
check('13 rad/s is a full swing (tuned to the recorded phone swings: median 8, p90 14 rad/s)', near(C.swingPower(13), 1));
check('a wild swing over-hits but is capped at 1.25', C.swingPower(60) === 1.25);
{
  const tr = C.swingTracker();
  let ev = C.swingStep(tr, { t: 0, speed: 1, tip: { x: 0.8, y: 0.2 } });
  check('no swing below the start speed', ev === null && !tr.active);
  ev = C.swingStep(tr, { t: 16, speed: 7, tip: { x: 0.6, y: 0.2 } });
  check('swing starts above 5 rad/s', ev === 'start' && tr.active);
  C.swingStep(tr, { t: 32, speed: 14, tip: { x: 0.1, y: 0.15 } });
  C.swingStep(tr, { t: 48, speed: 12, tip: { x: -0.4, y: 0.1 } });
  check('direction follows the tip on screen: right-to-left cut moves left', tr.dir === 'left' && tr.from === 'right', tr);
  check('power comes from the peak speed', near(tr.power, C.swingPower(14)));
  C.swingStep(tr, { t: 64, speed: 2, tip: { x: -0.5, y: 0.1 } });
  ev = C.swingStep(tr, { t: 120, speed: 1, tip: { x: -0.5, y: 0.1 } });
  check('swing ends once rotation stays slow', ev === 'end' && !tr.active);
}
{
  const tr = C.swingTracker();
  C.swingStep(tr, { t: 0, speed: 9, tip: { x: 0, y: 0.8 } });
  C.swingStep(tr, { t: 16, speed: 13, tip: { x: 0.05, y: 0.1 } });
  C.swingStep(tr, { t: 32, speed: 13, tip: { x: 0.08, y: -0.6 } });
  check('a downward cut comes from high', tr.dir === 'down' && tr.from === 'high');
}
check('cut sides: moving right comes from the left, up comes from low',
  C.cutFrom('right') === 'left' && C.cutFrom('left') === 'right' && C.cutFrom('up') === 'low' && C.cutFrom('down') === 'high');

console.log('cut resolution');
const idleGuardLeft = { guard: 'left', state: 'idle' };
let r = C.resolveCut({ power: 0.03, from: 'right', zone: 'body', enemy: idleGuardLeft });
check('a feeble cut only glances', r.result === 'glance' && r.damage <= 1, r);
r = C.resolveCut({ power: 0.8, from: 'left', zone: 'body', enemy: idleGuardLeft });
check('a cut from the guarded side is blocked and wears poise', r.result === 'blocked' && r.damage === 0 && r.poise > 0, r);
r = C.resolveCut({ power: 0.8, from: 'right', zone: 'body', enemy: idleGuardLeft });
check('a cut from the open side hits (a clean cut is ~a fifth of a recruit)', r.result === 'hit' && r.damage >= 15 && r.damage <= 22, r);
const weak = C.resolveCut({ power: 0.3, from: 'right', zone: 'body', enemy: idleGuardLeft });
check('harder swings do more damage', weak.damage < r.damage, [weak.damage, r.damage]);
const head = C.resolveCut({ power: 0.8, from: 'right', zone: 'head', enemy: idleGuardLeft });
check('head hits do more', head.damage > r.damage);
r = C.resolveCut({ power: 0.7, from: 'left', zone: 'body', enemy: { guard: null, state: 'windup' } });
check('a strong cut into a wind-up is a counter that staggers', r.result === 'hit' && r.counter && r.stagger, r);
const st = C.resolveCut({ power: 0.5, from: 'left', zone: 'body', enemy: { guard: null, state: 'stagger' } });
const open = C.resolveCut({ power: 0.5, from: 'left', zone: 'body', enemy: { guard: null, state: 'recover' } });
check('staggered opponents take bonus damage', st.damage > open.damage, [st.damage, open.damage]);
r = C.resolveCut({ power: 0.4, from: 'thrust', zone: 'body', enemy: idleGuardLeft });
check('a thrust goes through a side guard', r.result === 'hit', r);
r = C.resolveCut({ power: 0.9, from: 'right', zone: 'body', enemy: { guard: 'all', state: 'idle' } });
check('a full guard (turtle) blocks cuts', r.result === 'blocked', r);
r = C.resolveCut({ power: 0.3, from: 'right', zone: 'body', enemy: { guard: null, state: 'idle', armor: 0.55 } });
const r2 = C.resolveCut({ power: 0.9, from: 'right', zone: 'body', enemy: { guard: null, state: 'idle', armor: 0.55 } });
check('thick hide: weak cuts barely hurt, strong ones do', r.damage < 5 && r2.damage > 15, [r.damage, r2.damage]);
r = C.resolveCut({ power: 0.6, from: 'right', zone: 'body', enemy: { guard: null, state: 'idle', evade: 1 }, rng: () => 0 });
check('an agile beast can leap away from a cut while idle', r.result === 'evaded', r);
r = C.resolveCut({ power: 1, from: 'right', zone: 'body', enemy: idleGuardLeft, exhausted: true });
check('exhausted cuts are feeble', r.damage < 16, r);

console.log('guard zones (drawn blade, view units)');
const steepLeft = { h: { x: 0.2, y: -1.3 }, t: { x: -0.7, y: 0.4 } };
check('a blade raised to the left covers the left zone', C.guardCovers(steepLeft, 'left'));
check('...but not the right zone', !C.guardCovers(steepLeft, 'right'));
const steepRight = { h: { x: 0.5, y: -1.3 }, t: { x: 0.75, y: 0.4 } };
check('a blade up on the right covers the right zone', C.guardCovers(steepRight, 'right'));
const flatLeft = { h: { x: -0.2, y: -0.1 }, t: { x: -1.2, y: -0.05 } };
check('a flat blade does not stop a side strike', !C.guardCovers(flatLeft, 'left'));
const overhead = { h: { x: 0.6, y: 0.2 }, t: { x: -0.6, y: 0.55 } };
check('a blade held across above covers high', C.guardCovers(overhead, 'high'));
const vertical = { h: { x: 0.05, y: -1.4 }, t: { x: 0.0, y: 0.9 } };
check('a straight-up blade does not cover high', !C.guardCovers(vertical, 'high'));
const low = { h: { x: 0.3, y: -1.2 }, t: { x: -0.3, y: -0.5 } };
check('a lowered blade covers low', C.guardCovers(low, 'low'));
const centre = { h: { x: 0.3, y: -1.2 }, t: { x: 0.0, y: 0.1 } };
check('a blade pointing at the opponent covers a thrust', C.guardCovers(centre, 'thrust'));
check('a blade off to the side does not cover a thrust', !C.guardCovers(steepRight, 'thrust'));

console.log('blade sweep on screen');
{
  const rect = { cx: 0, cy: 0.2, hw: 0.15, hh: 0.4 };
  // blade swept from the right of the body to the left of it in one frame: must not tunnel through
  const s = C.screenSweepHits({ x: 0.6, y: -0.5 }, { x: 0.9, y: 0.6 }, { x: -0.6, y: -0.5 }, { x: -0.9, y: 0.6 }, rect);
  check('a fast sweep across the body connects', s.hit && s.f > 0 && s.f < 1, s);
  check('the contact point is on the body', s.hit && Math.abs(s.point.x) <= 0.2, s);
  const m = C.screenSweepHits({ x: 0.6, y: -0.5 }, { x: 0.9, y: 0.6 }, { x: 0.5, y: -0.5 }, { x: 0.8, y: 0.6 }, rect);
  check('a blade moving beside the body misses', !m.hit);
}

const rest = { h: { x: 0.58, y: -0.8 }, t: { x: 0.23, y: 0.18 } };
check('the resting en-garde blade guards no side and not high', !C.guardCovers(rest, 'left') && !C.guardCovers(rest, 'right') && !C.guardCovers(rest, 'high'));

console.log('defence resolution');
const atk = { dir: 'left', heavy: false, damage: 12 };
let d = C.resolveDefense({ attack: atk, coverFor: 120, stamina: 100, parryWindow: 220 });
check('arriving in the zone just before impact parries', d.result === 'parry' && d.damage === 0, d);
d = C.resolveDefense({ attack: atk, coverFor: 900, stamina: 100, parryWindow: 220 });
check('holding the guard early blocks, costing stamina', d.result === 'block' && d.damage === 0 && d.staminaCost > 0, d);
d = C.resolveDefense({ attack: atk, coverFor: 900, swingInto: true, stamina: 100, parryWindow: 220 });
check('swinging into the strike also parries', d.result === 'parry', d);
d = C.resolveDefense({ attack: atk, coverFor: -1, stamina: 100, parryWindow: 220 });
check('no guard: hit for full damage', d.result === 'hit' && d.damage === 12, d);
d = C.resolveDefense({ attack: { dir: 'high', heavy: true, damage: 24 }, coverFor: 900, stamina: 100, parryWindow: 220 });
check('a heavy strike breaks a held block', d.result === 'guardbreak' && d.damage > 0 && d.damage < 24, d);
d = C.resolveDefense({ attack: { dir: 'high', heavy: true, damage: 24 }, coverFor: 100, stamina: 100, parryWindow: 220 });
check('...but a heavy can be parried', d.result === 'parry', d);
d = C.resolveDefense({ attack: atk, coverFor: 900, stamina: 3, parryWindow: 220 });
check('blocking with no stamina breaks the guard', d.result === 'guardbreak', d);
d = C.resolveDefense({ attack: { dir: 'thrust', heavy: false, damage: 10 }, coverFor: -1, shieldFor: 800, stamina: 100, parryWindow: 220 });
check('the shield blocks a thrust', d.result === 'block' && d.damage === 0, d);
d = C.resolveDefense({ attack: atk, coverFor: -1, shieldFor: 90, stamina: 100, parryWindow: 220 });
check('raising the shield just in time parries', d.result === 'parry', d);
d = C.resolveDefense({ attack: { dir: 'high', heavy: true, damage: 24 }, coverFor: -1, shieldFor: 800, stamina: 100, parryWindow: 220 });
check('a heavy breaks a raised shield', d.result === 'guardbreak', d);
d = C.resolveDefense({ attack: { dir: 'high', heavy: true, damage: 24 }, coverFor: -1, dodging: true, stamina: 0, parryWindow: 220 });
check('a sidestep avoids anything', d.result === 'dodged' && d.damage === 0, d);

console.log('stamina');
let s = C.staminaStep(50, 1, { sinceSpend: 0.1 });
check('no regen right after spending', s === 50);
s = C.staminaStep(50, 1, { sinceSpend: 2 });
check('regen when resting', s > 70 && s <= C.STAMINA_MAX);
check('regen caps at max', C.staminaStep(99, 5, { sinceSpend: 9 }) === C.STAMINA_MAX);
s = C.staminaStep(50, 1, { sinceSpend: 9, shieldUp: true });
check('holding the shield drains', s < 50);
check('harder swings cost more', C.swingCost(1) > C.swingCost(0.2));
check('a block costs more for harder strikes', C.blockCost(24) > C.blockCost(8));

console.log('enemy brain');
const prof = C.LADDER[0].foes[0];
let b = C.createBrain(prof, 7);
let evs = [], t = 0;
function run(ms) { const out = []; for (let i = 0; i < ms; i += 10) { t += 10; for (const e of C.brainStep(b, 10)) out.push(Object.assign({ at: t }, e)); } return out; }
evs = run(6000);
const tel = evs.find(e => e.type === 'telegraph'), imp = evs.find(e => e.type === 'impact');
check('the brain telegraphs before it strikes', tel && imp && tel.at < imp.at, evs.slice(0, 4));
check('impact comes exactly one wind-up after the telegraph', tel && imp && Math.abs((imp.at - tel.at) - tel.attack.windup) <= 10, [tel && tel.attack.windup, imp && imp.at - tel.at]);
check('wind-up is within the profile range', tel.attack.windup >= prof.windup[0] && tel.attack.windup <= prof.windup[1]);
check('attack directions come from the profile', Object.keys(prof.dirs).includes(tel.attack.dir));
check('guard is open during a wind-up', (() => { const bb = C.createBrain(prof, 3); for (let i = 0; i < 1000; i++) { C.brainStep(bb, 10); if (bb.state === 'windup') return bb.guard === null; } return false; })());
b = C.createBrain(prof, 7); t = 0;
run(1); while (b.state !== 'windup') run(10);
C.brainHit(b, { stagger: true });
check('a stagger interrupts the wind-up', b.state === 'stagger');
const evStag = run(300);
check('no impact while staggered', !evStag.some(e => e.type === 'impact'));
b = C.createBrain(prof, 7); C.brainParried(b);
check('a parry staggers the opponent for longer', b.state === 'stagger' && b.timer >= prof.staggerMs);
// combos
const combo = Object.assign({}, prof, { combo: [3, 3], gap: [100, 100], feint: 0 });
b = C.createBrain(combo, 1); t = 0;
const ce = run(8000).filter(e => e.type === 'impact');
check('a 3-hit combo strikes three times in a row', ce.length >= 3 && ce[0].attack.chain === 0 && ce[1].attack.chain === 1 && ce[2].attack.chain === 2, ce.map(e => e.attack.chain));
// feints
const feinter = Object.assign({}, prof, { feint: 1, combo: [1, 1] });
b = C.createBrain(feinter, 5); t = 0;
const fe = run(6000);
const f1 = fe.find(e => e.type === 'feint');
check('a feint switches the strike direction mid wind-up', f1 && f1.attack.dir !== f1.from, f1);
// poise
b = C.createBrain(prof, 2);
C.brainPoise(b, prof.poise + 1);
check('breaking poise staggers', b.state === 'stagger');
check('dead brains stay dead', (() => { const bb = C.createBrain(prof, 1); C.brainKill(bb); return C.brainStep(bb, 5000).length === 0 && bb.state === 'dead'; })());
// guard follows your blade, after a human reaction time (replaces the old random guard timer)
{
  const p = Object.assign({}, prof, { gap: [9000, 9000], react: [300, 300], guardSkill: 1, read: 0 });
  b = C.createBrain(p, 4);
  C.brainStep(b, 10);
  C.brainSee(b, { threat: 'right' });
  C.brainStep(b, 200);
  check('the guard does not jump before the reaction time', b.guard !== 'right', b.guard);
  C.brainStep(b, 150);
  check('...then moves to the side your blade threatens', b.guard === 'right', b.guard);
  C.brainSee(b, { threat: 'left' }); C.brainStep(b, 150); C.brainSee(b, { threat: 'high' }); C.brainStep(b, 200);
  check('a quick feint with the blade: the slow guard never covered the first side', b.guard !== 'left', b.guard);
  C.brainStep(b, 200);
  check('...and it ends up on the side you finally show', b.guard === 'high', b.guard);
  const fast = C.createBrain(Object.assign({}, p, { react: [150, 150] }), 4), slow = C.createBrain(Object.assign({}, p, { react: [450, 450] }), 4);
  for (const x of [fast, slow]) { C.brainStep(x, 10); C.brainSee(x, { threat: 'left' }); C.brainStep(x, 250); }
  check('a sharper opponent reacts faster', fast.guard === 'left' && slow.guard !== 'left', [fast.guard, slow.guard]);
}
{
  const p = Object.assign({}, prof, { gap: [9000, 9000], react: [300, 300], guardSkill: 1, read: 1 });
  b = C.createBrain(p, 9); C.brainStep(b, 10);
  C.brainNoteCut(b, 'left'); C.brainNoteCut(b, 'left');
  check('two cuts from the same side get read', b.read === 'left', b.read);
  C.brainSee(b, { threat: 'right' }); C.brainStep(b, 20); C.brainSee(b, { threat: 'thrust' }); C.brainStep(b, 200);
  check('a reading opponent sits on the side you keep using', b.guard === 'left', b.guard);
  C.brainNoteCut(b, 'right'); C.brainNoteCut(b, 'high');
  check('mixing your cuts clears the read', b.read === null, b.read);
}

console.log('enemy defence and punishment');
{
  const p = Object.assign({}, prof, { gap: [9000, 9000], parry: 0, riposte: 0 });
  b = C.createBrain(p, 3); C.brainStep(b, 10);
  let res = C.brainBlocked(b, { from: 'left', power: 0.8 });
  check('a cut into his blade is blocked', res.result === 'block' && !res.riposte, res);
  const pp = Object.assign({}, p, { parry: 0.5, riposte: 1 });
  let parries = 0, predictable = 0;
  for (let s = 1; s <= 200; s++) {
    const x = C.createBrain(pp, s); C.brainStep(x, 10);
    if (C.brainBlocked(x, { from: 'left', power: 0.8 }).result === 'parry') parries++;
    const y = C.createBrain(pp, s); C.brainStep(y, 10); y.read = 'left';
    if (C.brainBlocked(y, { from: 'left', power: 0.3 }).result === 'parry') predictable++;
  }
  check('predictable, weak cuts get parried far more often', predictable > parries * 1.4, [parries, predictable]);
  const x = C.createBrain(pp, 11); C.brainStep(x, 10);
  res = C.brainBlocked(x, { from: 'left', power: 0.8 });
  check('after blocking your cut a riposting opponent strikes straight back', res.riposte && x.state === 'windup' && x.attack.windup <= pp.punishWindup[1], [res, x.state]);
}
{
  const p = Object.assign({}, prof, { gap: [9000, 9000], punish: 1 });
  b = C.createBrain(p, 5); C.brainStep(b, 10);
  const atk = C.brainOpening(b, 'whiff');
  check('a whiffed swing gets punished with a fast strike', atk && b.state === 'windup' && atk.windup <= p.punishWindup[1] && atk.windup < p.windup[0], atk);
  const lazy = C.createBrain(Object.assign({}, p, { punish: 0 }), 5); C.brainStep(lazy, 10);
  check('an opponent with no killer instinct lets it go', !C.brainOpening(lazy, 'whiff') && lazy.state === 'idle');
  const busy = C.createBrain(p, 5); C.brainParried(busy);
  check('a staggered opponent cannot punish', !C.brainOpening(busy, 'whiff'));
}
{
  const p = Object.assign({}, prof, { aim: 1, gap: [100, 100], dirs: { left: 1, right: 1 }, feint: 0 });
  let away = 0;
  for (let s = 1; s <= 40; s++) {
    const x = C.createBrain(p, s); C.brainSee(x, { threat: 'left' });
    for (let i = 0; i < 300 && x.state !== 'windup'; i++) C.brainStep(x, 10);
    if (x.attack && x.attack.dir === 'right') away++;
  }
  check('a smart opponent attacks the side your blade is not on', away >= 36, away);
}
{
  const p = Object.assign({}, prof, { gap: [9000, 9000], beatPower: 0.55 });
  b = C.createBrain(Object.assign({}, p, { gap: [50, 50] }), 2);
  while (b.state !== 'windup') C.brainStep(b, 10);
  check('a weak clash on his raised blade does not stop him', !C.brainBeat(b, 0.3) && b.state === 'windup');
  check('a hard clash on his raised blade beats it aside: he staggers', C.brainBeat(b, 0.8) && b.state === 'stagger');
}
{
  const p = Object.assign({}, prof, { gap: [9000, 9000], footwork: 1, stepOut: 0.9 });
  b = C.createBrain(p, 6);
  for (let i = 0; i < 600 && C.brainInReach(b); i++) C.brainStep(b, 10);
  check('footwork: he steps out of your reach', !C.brainInReach(b) && b.dist > 0.4, b.dist);
  check('...but a thrust still reaches', C.brainInReach(b, 'thrust'));
  const q = Object.assign({}, p, { gap: [50, 50] }); const x = C.createBrain(q, 6); x.dist = x.distGoal = 0.9;
  for (let i = 0; i < 400 && x.state !== 'windup'; i++) C.brainStep(x, 10);
  check('an attack from outside your reach lunges in', x.attack && x.attack.lunge && x.distGoal === 0, x.attack);
}
{
  const p = Object.assign({}, prof, { gap: [9000, 9000], followUp: 1, combo: [1, 1] });
  b = C.createBrain(Object.assign({}, p, { gap: [50, 50] }), 8);
  let imp = null; for (let i = 0; i < 400 && !imp; i++) imp = C.brainStep(b, 10).find(e => e.type === 'impact');
  C.brainStruck(b, 'block');
  const nxt = []; for (let i = 0; i < 100; i++) nxt.push(...C.brainStep(b, 10));
  const t2 = nxt.find(e => e.type === 'telegraph');
  check('after you block, a pressing opponent follows up from another side', t2 && t2.attack.dir !== imp.attack.dir, [imp && imp.attack.dir, t2 && t2.attack.dir]);
}

console.log('the player: no free swings');
check('a cut too weak to matter only scratches', C.resolveCut({ power: 0.15, from: 'left', zone: 'torso', enemy: { guard: null, state: 'idle' } }).result === 'glance');
{
  const p = Object.assign({}, prof, { gap: [9000, 9000], punish: 1 });
  const x = C.createBrain(p, 3); C.brainStep(x, 10);
  C.brainSee(x, { threat: 'left' }); C.brainStep(x, 600);
  C.brainHit(x, { stagger: false });
  check('a weak hit does not knock his guard off', x.guard === 'left' && x.state === 'idle', [x.guard, x.state]);
  check('flailing is an opening: he attacks straight into it', !!C.brainOpening(x, 'flail') && x.state === 'windup');
}
{
  check('a fresh, rested swing keeps its power', near(C.effectivePower(1, { sinceLastMs: 2000, stamina: 100 }), 1));
  check('a rushed swing (no chamber) is weaker', C.effectivePower(1, { sinceLastMs: 80, stamina: 100 }) < 0.65);
  check('a tired swing is weaker', C.effectivePower(1, { sinceLastMs: 2000, stamina: 8 }) < 0.55);
  let st = 100, n = 0;
  while (st > 15 && n < 50) { st -= C.swingCost(1.1); n++; }
  check('flailing at full speed empties your stamina in a handful of swings', n <= 6, n);
  check('a missed swing costs extra', C.WHIFF_COST > 0);
  const tr = C.swingTracker();
  C.swingStep(tr, { t: 0, speed: 9, tip: { x: 0.6, y: 0.2 } });
  C.swingStep(tr, { t: 16, speed: 12, tip: { x: 0.2, y: 0.2 } });
  C.swingStep(tr, { t: 32, speed: 12, tip: { x: -0.2, y: 0.2 } });
  C.swingStep(tr, { t: 48, speed: 12, tip: { x: -0.5, y: 0.2 } });
  C.swingStep(tr, { t: 64, speed: 12, tip: { x: -0.6, y: 0.2 } });
  const ev = C.swingStep(tr, { t: 80, speed: 12, tip: { x: -0.2, y: 0.2 } });
  check('reversing the blade ends the cut (a waggle is not one long swing)', ev === 'end' && !tr.active, [ev, tr.active]);
}

console.log('where the blade lands');
{
  const base = { power: 0.8, from: 'right', enemy: { guard: null, state: 'idle' } };
  const torso = C.resolveCut(Object.assign({ zone: 'torso' }, base)).damage;
  const arm = C.resolveCut(Object.assign({ zone: 'arm' }, base)).damage;
  const legs = C.resolveCut(Object.assign({ zone: 'legs' }, base)).damage;
  const hd = C.resolveCut(Object.assign({ zone: 'head' }, base)).damage;
  check('head > torso > legs > arm', hd > torso && torso > legs && legs > arm, [hd, torso, legs, arm]);
  check('"body" still means the torso', C.resolveCut(Object.assign({ zone: 'body' }, base)).damage === torso);
  const flat = C.resolveCut(Object.assign({ zone: 'torso', align: 0.4 }, base));
  check('a blade dragged along its length cuts less than a clean edge', flat.result === 'hit' && flat.damage < torso, [flat.damage, torso]);
  const drag = C.resolveCut(Object.assign({ zone: 'torso', align: 0.1 }, base));
  check('a blade sliding lengthwise only glances', drag.result === 'glance', drag);
  const helm = { guard: null, state: 'idle', zoneArmor: { head: 0.5 } };
  const g = C.resolveCut({ power: 0.4, from: 'right', zone: 'head', enemy: helm });
  check('a weak cut glances off armour', g.result === 'armor' && g.damage < 6, g);
  const g2 = C.resolveCut({ power: 1, from: 'right', zone: 'head', enemy: helm });
  check('a full cut still bites through armour, reduced', g2.result === 'hit' && g2.damage < C.resolveCut({ power: 1, from: 'right', zone: 'head', enemy: { guard: null, state: 'idle' } }).damage, g2);
}
{
  const body = { cx: 0, cy: 0.1, hw: 0.2, hh: 0.4 };
  check('blade raised on your left threatens a cut from the left', C.threatFrom({ h: { x: 0.3, y: -1 }, t: { x: -0.8, y: 0.3 } }, body) === 'left');
  check('blade raised high threatens an overhead', C.threatFrom({ h: { x: 0.3, y: -0.6 }, t: { x: 0.05, y: 0.9 } }, body) === 'high');
  check('point in line threatens a thrust', C.threatFrom({ h: { x: 0.4, y: -0.8 }, t: { x: 0.05, y: 0.1 } }, body) === 'thrust');
  check('a swing in progress is its own threat', C.threatFrom({ h: { x: 0.3, y: -1 }, t: { x: 0.1, y: 0.1 } }, body, 'right') === 'right');
}
{
  // blades crossing on screen: your sweep vs his blade
  const mine0 = [{ x: 0.6, y: -0.2 }, { x: 0.9, y: 0.4 }], mine1 = [{ x: -0.5, y: -0.2 }, { x: -0.8, y: 0.4 }];
  const his = [{ x: 0, y: -0.3 }, { x: 0.05, y: 0.6 }];
  const c = C.bladesCross(mine0[0], mine0[1], mine1[0], mine1[1], his[0], his[1], his[0], his[1]);
  check('sweeping across his blade meets it', c.hit && c.f > 0 && c.f < 1 && Math.abs(c.point.x) < 0.2, c);
  const m = C.bladesCross(mine0[0], mine0[1], { x: 0.4, y: -0.2 }, { x: 0.7, y: 0.4 }, his[0], his[1], his[0], his[1]);
  check('stopping short of his blade does not touch it', !m.hit, m);
  const hisMoving = C.bladesCross({ x: -0.5, y: 0 }, { x: -0.5, y: 0.6 }, { x: -0.5, y: 0 }, { x: -0.5, y: 0.6 }, { x: 0.3, y: 0 }, { x: 0.3, y: 0.6 }, { x: -0.7, y: 0 }, { x: -0.7, y: 0.6 });
  check('his blade sweeping into yours meets it too', hisMoving.hit, hisMoving);
}

console.log('ladder');
check('six bouts', C.LADDER.length === 6);
const w = C.LADDER.map(L => L.foes[0].windup[0]);
check('the first opponent is the slowest to strike', w[0] === Math.max(...w), w);
const pw = C.LADDER.map(L => L.foes[0].parryWindow);
check('parry windows tighten toward the final', pw[0] > pw[5], pw);
check('the wolves come as a pack', C.LADDER[1].foes.length === 2);
check('the troll has thick hide, the champion feints', C.LADDER[4].foes[0].armor > 0 && C.LADDER[5].foes[0].feint > 0);
const F = C.LADDER.map(L => L.foes[0]);
check('every bout has a lesson line', C.LADDER.every(L => typeof L.lesson === 'string' && L.lesson.length > 10));
check('reactions sharpen up the ladder: the champion reacts fastest', F[5].react[1] < F[0].react[0] && F[5].react[1] < F[2].react[0], F.map(f => f.react));
check('the champion reads, parries, ripostes and punishes far more than the recruit',
  F[5].read > F[0].read && F[5].parry > F[0].parry && F[5].riposte > F[0].riposte && F[5].punish > F[0].punish);
check('the champion strikes much faster than the recruit, but stays readable (>= 400 ms)', F[5].windup[1] < F[0].windup[0] * 0.65 && F[5].windup[0] >= 400 && F[5].punishWindup[0] >= 400, [F[0].windup, F[5].windup, F[5].punishWindup]);
check('the axe reaches from outside your range, the wolves hunt in a pair', F[3].footwork > 0 && C.LADDER[1].foes[0].pack);

console.log('waggle spam with a phone (full rotation speed)');
{
  // Recorded from the pad-driven spam bot vs Cassia: every swing peaked at the 1.25 cap, swings started
  // 17-133 ms after the last ended; rushed alone left 0.2-0.27 effective power, enough to land hits.
  const tr = C.swingTracker();
  let t = 0; const eff = [];
  const swing = (gap, ms) => {
    t += gap;
    C.swingStep(tr, { t, speed: 20, tip: { x: 0.6, y: 0 } });
    C.swingStep(tr, { t: t + ms / 2, speed: 25, tip: { x: 0, y: 0 } });
    eff.push(C.effectivePower(tr.power, { sinceLastMs: tr.startT - tr.prevEndT, chain: tr.chain, stamina: 80 }));
    C.swingStep(tr, { t: t + ms, speed: 1, tip: { x: -0.6, y: 0 } });
    C.swingStep(tr, { t: t + ms + 50, speed: 1, tip: { x: -0.6, y: 0 } });
    t += ms + 50;
  };
  swing(2000, 120); for (const g of [117, 54, 83, 133, 33, 100]) swing(g, 140);
  check('the first, chambered cut carries full power', eff[0] > 1.2, eff);
  check('a quick second cut (forehand-backhand) is only rushed', eff[1] > C.GLANCE_POWER, eff);
  check('from the third unchambered swing on, a phone waggle only scratches', eff.slice(2).every(e => e < C.GLANCE_POWER), eff);
  swing(450, 120);
  check('pausing to chamber restores the cut', eff[eff.length - 1] > 1.2 && tr.chain === 0, eff);
}

console.log('versus (two players, same rules)');
{
  const idle = { arrivedMs: 2000, swinging: false, swingPower: 0, shieldMs: -1, stamina: 100, overextended: false, stunned: false };
  const def = o => Object.assign({}, idle, o);
  const ex = (o, d) => C.pvpExchange(Object.assign({ power: 0.7, from: 'left', zone: 'torso', align: 1, contact: 'body', def: def(d) }, o));
  const hit = ex({});
  check('a clean cut on the body hits', hit.result === 'hit' && hit.damage > 10, hit);
  check('the head is worth more than the legs', ex({ zone: 'head' }).damage > ex({ zone: 'legs' }).damage);
  check('cutting someone mid-swing is a counter', ex({}, { swinging: true, swingPower: 0.8 }).counter);
  check('cutting someone stunned bites deeper', ex({}, { stunned: true }).damage > hit.damage);
  check('a lazy cut only scratches', ex({ power: 0.1 }).result === 'glance');
  const block = ex({ contact: 'blade' });
  check('a blade held across the cut blocks it, paid in stamina', block.result === 'block' && block.damage === 0 && block.defCost > 8, block);
  const parry = ex({ contact: 'blade' }, { arrivedMs: 90 });
  check('a blade that arrives just in time parries and stuns the attacker', parry.result === 'parry' && parry.stunAtk > 0, parry);
  check('just after a miss you can block but not parry', ex({ contact: 'blade' }, { arrivedMs: 90, overextended: true }).result === 'block');
  const heavy = ex({ contact: 'blade', power: 1.1 });
  check('a full-power cut breaks a held guard: half damage and a stun', heavy.result === 'guardbreak' && heavy.damage > 0 && heavy.stunDef > 0, heavy);
  check('a heavy cut is still parried by a blade that meets it in time', ex({ contact: 'blade', power: 1.1 }, { arrivedMs: 60 }).result === 'parry');
  check('a tired guard crumbles', ex({ contact: 'blade' }, { stamina: 5 }).result === 'guardbreak');
  check('two cuts of similar weight clash', ex({ contact: 'blade', power: 0.7 }, { swinging: true, swingPower: 0.6 }).result === 'clash');
  const beat = ex({ contact: 'blade', power: 1.1 }, { swinging: true, swingPower: 0.4 });
  check('the much harder cut beats the other aside', beat.result === 'beat' && beat.stunDef > 0, beat);
  check('...and the softer cut is the one beaten', ex({ contact: 'blade', power: 0.4 }, { swinging: true, swingPower: 1.0 }).result === 'beaten');
  const sh = ex({ contact: 'shield' }, { shieldMs: 1000 });
  const bl = ex({ contact: 'blade' });
  check('a shield blocks more cheaply than the blade', sh.result === 'block' && sh.defCost < bl.defCost, [sh, bl]);
  check('a shield raised just in time parries', ex({ contact: 'shield' }, { shieldMs: 100 }).result === 'parry');
  check('a heavy cut breaks the shield too', ex({ contact: 'shield', power: 1.1 }, { shieldMs: 1000 }).result === 'guardbreak');
  check('round: knockout wins, the bell goes to the healthier, a tie is a draw',
    C.pvpRoundWinner(30, 0, false) === 0 && C.pvpRoundWinner(0, 30, false) === 1 && C.pvpRoundWinner(50, 40, false) === null &&
    C.pvpRoundWinner(50, 40, true) === 0 && C.pvpRoundWinner(40, 40, true) === -1);
}

console.log('fame and rank');
check('rank grows with fame', C.rankFor(500, 1) !== C.rankFor(9000, 6));
check('winning it all is the top rank', C.rankFor(9000, 6) === 'Champion of the Circus');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
