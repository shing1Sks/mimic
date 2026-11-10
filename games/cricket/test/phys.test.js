// Ball flight, bounce, swing and spin. Run: node games/cricket/test/phys.test.js
'use strict';
const path = require('path');
const P = require(path.join(__dirname, '..', 'phys.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const kmh = v => v / 3.6;
const deg = r => r * 180 / Math.PI;
const FROM = { x: 0.3, y: 2.15, z: -18.5 };

/** The ball's state where it reaches the batter's stumps (z = 0) or stops. */
function atStumps(b0) {
  const r = P.run(b0, { until: b => b.p.z >= 0, samples: false });
  return r;
}

// --- solving a delivery
{
  const s = P.solveRelease({ from: FROM, speed: kmh(140), target: { x: 0.1, z: -6 } });
  check('140 km/h solved to pitch at good length (6 m) within 1 cm', s.err < 0.01, s.err);
  const r = atStumps(P.ball(FROM, s.v));
  check('...pitches exactly there', Math.abs(r.pitch.z + 6) < 0.02 && Math.abs(r.pitch.x - 0.1) < 0.02, r.pitch);
  check('...and reaches the stumps between knee and bail height (0.3-0.95 m)', r.end.p.y > 0.3 && r.end.p.y < 0.95, r.end.p.y);
  check('...released slightly downward (-2..-9 deg)', deg(s.elev) < -2 && deg(s.elev) > -9, deg(s.elev));
  const sp = P.len(r.end.v);
  check('drag + bounce: a 140 km/h ball arrives at 110-130 km/h', sp * 3.6 > 110 && sp * 3.6 < 130, sp * 3.6);
  const t = r.end.t;
  check('...about 0.5-0.6 s from release to the stumps', t > 0.45 && t < 0.62, t);
  const short = atStumps(P.ball(FROM, P.solveRelease({ from: FROM, speed: kmh(140), target: { x: 0, z: -11 } }).v));
  check('a short ball (11 m) gets up past the bails (> 1.0 m at the stumps)', short.end.p.y > 1.0, short.end.p.y);
  const yorker = P.solveRelease({ from: FROM, speed: kmh(140), target: { x: 0, z: -1.0 } });
  check('a yorker (1 m) solves too', yorker.err < 0.01, yorker.err);
  const toss = P.solveRelease({ from: FROM, speed: kmh(120), target: { x: 0, z: 2 } });
  const tr = atStumps(P.ball(FROM, toss.v));
  check('a full toss reaches the stumps without bouncing', tr.end.bounces === 0 && tr.end.p.y > 0.1, tr.end);
}

// --- bounce
{
  const b = P.ball({ x: 0, y: P.BALL.R, z: -5 }, { x: 0, y: -6, z: 30 });
  P.bounce(b);
  check('pitch bounce: vertical out = 0.58 x in', Math.abs(b.v.y - 0.58 * 6) < 1e-9, b.v.y);
  check('...friction takes some pace off a ball without spin', b.v.z < 30 && b.v.z > 25, b.v.z);
  const top = P.ball({ x: 0, y: P.BALL.R, z: -5 }, { x: 0, y: -6, z: 30 }, { w: { x: 800, y: 0, z: 0 } });
  const back = P.ball({ x: 0, y: P.BALL.R, z: -5 }, { x: 0, y: -6, z: 30 }, { w: { x: -800, y: 0, z: 0 } });
  P.bounce(top); P.bounce(back);
  check('a ball rolling off topspin skids on, backspin never gains pace', top.v.z > b.v.z + 2 && back.v.z <= b.v.z, [top.v.z, b.v.z, back.v.z]);
}

// --- spin turns the ball off the pitch
{
  const sp = kmh(85);
  const from = { x: 0.3, y: 2.0, z: -18.5 };
  const mk = w => {
    const s = P.solveRelease({ from, speed: sp, target: { x: 0, z: -4 }, w });
    return atStumps(P.ball(from, s.v, { w }));
  };
  const plain = mk({ x: 0, y: 0, z: 0 });
  // sidespin about the direction of travel plus overspin, like a finger spinner
  const right = mk({ x: 250, y: 0, z: -200 }), left = mk({ x: 250, y: 0, z: 200 });
  const turn = (r) => r.end.p.x - plain.end.p.x;
  check('sidespin one way turns it right (+x) at the stumps', turn(right) > 0.12, turn(right));
  check('the other way turns it left by about as much', turn(left) < -0.12 && Math.abs(turn(left) + turn(right)) < 0.08, [turn(left), turn(right)]);
  const ang = deg(Math.atan2(right.end.v.x, right.end.v.z));
  check('a big finger spinner turns 2-9 degrees off the pitch', ang > 2 && ang < 9, ang);
}

// --- swing in the air
{
  const raw = (speed, swing) => {
    const v = { x: 0, y: -0.6, z: speed };
    return P.run(P.ball(FROM, v, { swing }), { until: b => b.bounces > 0 || b.p.z > 0, samples: false }).end.p;
  };
  const sw = raw(kmh(135), 1).x - raw(kmh(135), 0).x;
  check('full conventional swing at 135 km/h bends the ball 0.3-1.2 m before it pitches', sw > 0.3 && sw < 1.2, sw);
  const neg = raw(kmh(135), -1).x - raw(kmh(135), 0).x;
  check('the seam the other way swings it the other way', neg < -0.3, neg);
  const slow = raw(kmh(70), 1).x - raw(kmh(70), 0).x;
  check('no swing at 70 km/h', Math.abs(slow) < 0.01, slow);
  const s = P.solveRelease({ from: FROM, speed: kmh(135), target: { x: 0, z: -5 }, swing: 0.8 });
  check('the solver still lands a swinging ball on its spot', s.err < 0.01, s.err);
}

// --- stumps
{
  check('a ball at middle stump, knee height, hits', !!P.hitsStumps({ x: 0, y: 0.4, z: -0.1 }, { x: 0, y: 0.4, z: 0.1 }));
  check('one just past the off stump (+ ball radius) misses', !P.hitsStumps({ x: 0.16, y: 0.4, z: -0.1 }, { x: 0.16, y: 0.4, z: 0.1 }));
  check('one over the bails misses', !P.hitsStumps({ x: 0, y: 0.8, z: -0.1 }, { x: 0, y: 0.8, z: 0.1 }));
  check('a ball rolling back onto them from in front hits too', !!P.hitsStumps({ x: 0.02, y: 0.036, z: -0.05 }, { x: 0.02, y: 0.036, z: 0.02 }));
}

// --- the outfield
{
  const roll = sp => P.run(P.ball({ x: 0, y: P.BALL.R, z: -1 }, { x: 0, y: 0, z: -sp }, {}), { samples: false, tMax: 30 }).end;
  const a = roll(15), b = roll(25);
  check('a 15 m/s ground ball rolls 25-60 m and stops', a.stopped && -a.p.z - 1 > 25 && -a.p.z - 1 < 60, a.p.z);
  check('a 25 m/s one would carry past a 62 m boundary', P.fromCentre(b.p) > P.FIELD.R, P.fromCentre(b.p));
  const lofted = P.run(P.ball({ x: 0, y: 0.6, z: -1 }, { x: 0, y: 32 * Math.sin(0.6), z: -32 * Math.cos(0.6) }), { until: x => x.bounces > 0, samples: false }).end;
  check('a 32 m/s hit at 34 deg carries 65-95 m (a six)', -lofted.p.z > 65 && -lofted.p.z < 95, lofted.p.z);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
