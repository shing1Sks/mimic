// Plain Node test for the physical racket/ball contact. Run: node games/tennis/test/contact.test.js
'use strict';
const path = require('path');
const { sweptContact, shotFromContact } = require(path.join(__dirname, '..', 'contact.js'));

const R_BALL = 0.033, R = R_BALL + 0.06;
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info ? '  ' + JSON.stringify(info) : '')); }
}
const v = (x, y, z) => ({ x, y, z });

console.log('sweptContact');
{
  // racket head sweeps right-to-left straight through a ball that is flying toward the player
  const r = sweptContact(v(0.3, 1, 0), v(-0.3, 1, 0), v(0, 1, -0.2), v(0, 1, 0.2), R);
  check('head passing straight through the ball is a hit', r.hit === true, r);
  check('  t is in 0..1', r.t >= 0 && r.t <= 1, r);
  check('  point is near the ball path', r.point && Math.abs(r.point.x) < 1e-6 && Math.abs(r.point.y - 1) < 1e-6, r);
}
{
  const r = sweptContact(v(0.3, 1.2, 0), v(-0.3, 1.2, 0), v(0, 1, -0.2), v(0, 1, 0.2), R);
  check('a pass 20 cm beside (above) the ball is a miss', r.hit === false, r);
}
{
  const r = sweptContact(v(0.3, 1, 0.2), v(-0.3, 1, 0.2), v(0, 1, -0.2), v(0, 1, 0.0), R);
  check('a pass 20 cm in front of where the ball ends the frame is a miss', r.hit === false, r);
}
{
  // fast head: fully on one side of a slow ball last frame, fully on the other side now
  const ball0 = v(0, 1, 0), ball1 = v(0, 1, 0.01);
  const head0 = v(0.6, 1, 0.005), head1 = v(-0.6, 1, 0.005);
  const d0 = Math.hypot(head0.x - ball0.x, head0.y - ball0.y, head0.z - ball0.z);
  const d1 = Math.hypot(head1.x - ball1.x, head1.y - ball1.y, head1.z - ball1.z);
  const r = sweptContact(head0, head1, ball0, ball1, R);
  check('tunnelling: endpoints both far (' + d0.toFixed(2) + ', ' + d1.toFixed(2) + ' m) but the sweep crosses -> hit', d0 > R && d1 > R && r.hit === true, r);
  check('  contact found mid-sweep', r.t > 0.4 && r.t < 0.6, r);
}
{
  const head = v(0, 1, 11);
  const r = sweptContact(head, head, v(0.02, 1.01, 10.6), v(0.02, 1.01, 11.4), R);
  check('a ball moving through a stationary racket head is a hit', r.hit === true, r);
}
{
  const r = sweptContact(v(0, 1, 0), v(0, 1, 1), v(0.2, 1, 0), v(0.2, 1, 1), R);
  check('parallel segments 20 cm apart are a miss', r.hit === false, r);
}
{
  const r = sweptContact(v(0, 1, 0), v(0, 1, 1), v(0.05, 1, 0.5), v(0.05, 1, 1.5), R);
  check('parallel overlapping segments 5 cm apart are a hit', r.hit === true, r);
}
{
  const r = sweptContact(v(0, 1, 0), v(0, 1, 0), v(0, 1, 0.5), v(0, 1, 0.5), R);
  check('both points still and apart is a miss (degenerate segments)', r.hit === false, r);
}

console.log('shotFromContact');
{
  // forehand: head moving -z (toward the opponent) at 20 m/s, face normal pointing back at the player
  const s = shotFromContact({ normal: v(0, 0, 1), headVel: v(0, 0, -20), ballVel: v(0, -2, 18) });
  const inSpeed = Math.hypot(0, -2, 18);
  check('face normal is flipped to face the swing', s.dir.z < -0.99, s);
  check('pace = head speed x 0.9 + incoming speed x 0.3', Math.abs(s.pace - (20 * 0.9 + inSpeed * 0.3)) < 1e-9, s);
  check('level swing has ~no spin', Math.abs(s.top) < 1e-9, s);
}
{
  const up = shotFromContact({ normal: v(0, 0, -1), headVel: v(0, 6, -18), ballVel: v(0, 0, 15) });
  const down = shotFromContact({ normal: v(0, 0, -1), headVel: v(0, -6, -18), ballVel: v(0, 0, 15) });
  check('upward head velocity gives topspin', up.top > 0.3, up);
  check('downward head velocity gives slice', down.top < -0.3, down);
}
{
  const open = shotFromContact({ normal: v(0.5, 0, -0.866), headVel: v(0, 0, -20), ballVel: v(0, 0, 15) });
  check('a face turned to the side sends the ball that way', open.dir.x > 0.2, open);
  const sky = shotFromContact({ normal: v(0, 0.7, -0.714), headVel: v(0, 0, -20), ballVel: v(0, 0, 15) });
  check('an open (upturned) face launches upward', sky.elevDeg > 20, sky);
}
{
  // ball hits a racket that is not moving: the face sends it back the way it came
  const s = shotFromContact({ normal: v(0, 0, 1), headVel: v(0, 0, 0), ballVel: v(0, 0, 15) });
  check('stationary racket: face oriented against the ball', s.dir.z < -0.99 && Math.abs(s.pace - 4.5) < 1e-9, s);
}

console.log('zoneContact (forgiving in height and depth: the phone has no position tracking)');
{
  const { zoneContact, ZONES, missLabel } = require(path.join(__dirname, '..', 'contact.js'));
  const swingAt = (y, z) => [v(0.4, y, z), v(-0.4, y, z)];     // level swing right-to-left
  const ballPath = [v(0, 1, -0.2), v(0, 1, 0.2)];               // ball flying toward the player at 1 m
  const hit = (zone, y, z) => zoneContact(...swingAt(y, z), ...ballPath, ZONES[zone]).hit;
  check('REAL zone keeps the strict 9 cm test: 30 cm high misses', hit('REAL', 1.3, 0) === false);
  check('NORMAL zone: 30 cm high still connects', hit('NORMAL', 1.3, 0) === true);
  check('NORMAL zone: 35 cm early/late in depth still connects', hit('NORMAL', 1.0, 0.55) === true);
  check('NORMAL zone: 1 m high is a miss', hit('NORMAL', 2.0, 0) === false);
  check('EASY zone: 60 cm high connects', hit('EASY', 1.6, 0) === true);
  check('EASY zone: 1.5 m high is still a miss', hit('EASY', 2.5, 0) === false);
  const r = zoneContact(...swingAt(1.3, 0), ...ballPath, ZONES.NORMAL);
  check('contact point is the real ball position, not the scaled one', Math.abs(r.point.y - 1) < 1e-9, r);
  check('missLabel says too high', /HIGH/.test(missLabel(v(0, 0.3, 0.05))));
  check('missLabel says too low', /LOW/.test(missLabel(v(0, -0.4, 0.1))));
  // the ball flies toward +z (toward the player). d = head - ball at closest approach.
  // d.z > 0: the ball had not reached the racket yet -> the swing came EARLY.
  // d.z < 0: the ball had already passed the racket -> LATE.
  check('missLabel: ball not yet at the racket = EARLY', /EARLY/.test(missLabel(v(0, 0.05, 0.5))));
  check('missLabel: ball already past the racket = LATE', /LATE/.test(missLabel(v(0, 0.05, -0.5))));
  check('NORMAL zone: swinging as the ball reaches you (racket plane 80 cm ahead) still connects', hit('NORMAL', 1.0, -0.8) === true);
  check('NORMAL zone: 2.5 m off in depth is a miss (no free hits)', hit('NORMAL', 1.0, -2.7) === false);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
