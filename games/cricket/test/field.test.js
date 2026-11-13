// Catches, boundaries and runs. Run: node games/cricket/test/field.test.js
'use strict';
const path = require('path');
const F = require(path.join(__dirname, '..', 'field.js'));
const P = require(path.join(__dirname, '..', 'phys.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const deg = Math.PI / 180;
const always = () => 0, never = () => 0.999999;
/** A hit from the crease: speed (m/s), az (deg, + off side), loft (deg). */
function hit(speed, az, loft) {
  const a = az * deg, l = loft * deg;
  const b = P.ball({ x: 0, y: 0.5, z: -0.9 }, { x: speed * Math.cos(l) * Math.sin(a), y: speed * Math.sin(l), z: -speed * Math.cos(l) * Math.cos(a) });
  return P.run(b, { tMax: 12, every: 3 }).samples;
}
const field = F.setField('pace', 1);

check('ten fielders, the keeper behind the stumps', field.length === 10 && field[0].keeper && field[0].z > 10);
check('left-handed batter: the field is mirrored (slip on the other side)', F.setField('pace', -1)[1].x === -field[1].x && field[1].x > 0);

{
  const r = F.resolve(hit(36, 0, 32), field, { rng: always });
  check('a 36 m/s lofted straight hit clears everyone: six', r.type === 'six' && r.runs === 6, r);
  const g = F.resolve(hit(30, 75, -2), field, { rng: always });
  check('a hard ground hit through the gap between point and cover: four', g.type === 'four' && g.runs === 4, g);
  const at = F.resolve(hit(26, 52, 3), field, { rng: always });
  check('driven along the ground straight at cover: stopped, no run or one', at.type === 'runs' && at.runs <= 1 && field[at.by].name === 'Cover', [at.type, at.runs, at.name]);
  const pushed = F.resolve(hit(9, 30, 0), field, { rng: always });
  check('a soft push into the off side: a single is there or nothing', pushed.type === 'runs' && pushed.runs <= 1, pushed);
  const deep = F.resolve(hit(20, -125, 5), field, { rng: always });
  check('a firm glance between deep square and fine leg: 1-2 runs', deep.type === 'runs' && deep.runs >= 1 && deep.runs <= 2, deep);
}
{
  const edge = F.resolve(hit(25, 163, 8), field, { rng: always });
  check('an edge flying at slip: caught (when the hands hold)', edge.type === 'caught' && edge.name === 'Slip', edge);
  const put = F.resolve(hit(25, 163, 8), field, { rng: never });
  check('...or dropped: no wicket, the drop is reported', put.type !== 'caught' && put.dropped.length >= 1, put);
  const sky = F.resolve(hit(18, -40, 65), field, { rng: always });
  check('a skier to midwicket: someone gets under it', sky.type === 'caught', sky);
  check('catch chance: a ball straight at you beats a full-length dive', F.catchChance(0, 1, false) > F.catchChance(1, 1, false) + 0.3);
  check('...and a sharp chance (0.2 s) is harder than a lob', F.catchChance(0.3, 0.2, false) < F.catchChance(0.3, 1.5, false));
}
{
  const r = F.runsFrom({ t: 3, x: 0, z: -60 }, field[5]);
  check('picked up 60 m away after 3 s: two runs', r.runs === 2, r);
  check('picked up at the bat\'s feet: no run', F.runsFrom({ t: 0.6, x: 0.5, z: -2 }, field[5]).runs === 0);
}

{
  // from a recorded session: hooks and pulls that cleared the rope on the full were "caught" (and
  // "dropped" for runs) by a fielder standing in the stands, 81 and 91 m from the middle
  let n = 0;
  for (const [speed, az, loft] of [[31, -100, 47], [33, -98, 55], [30, -60, 45], [28, -150, 50], [34, -95, 40]]) {
    const fl = hit(speed, az, loft);
    const cross = fl.find(x => P.fromCentre(x) > P.FIELD.R);
    if (!cross || !cross.air) continue;
    n++;
    const held = F.resolve(fl, field, { rng: always }), put = F.resolve(fl, field, { rng: never });
    check(`over the rope on the full (${speed} m/s, az ${az}, loft ${loft}): six, or caught inside the rope`, held.type === 'six' || (held.type === 'caught' && P.fromCentre(held.at) <= P.FIELD.R), held.type === 'caught' ? P.fromCentre(held.at) : held.type);
    check('...and never dropped beyond it for runs', put.type === 'six' || (put.type === 'runs' && P.fromCentre(put.at) <= P.FIELD.R + 0.5), [put.type, put.at && P.fromCentre(put.at)]);
  }
  check('the rope cases above were exercised', n >= 3, n);
}
{
  // a long sprint is harder to finish than a step to the side at the same stretch of his reach
  check('a 28 m running catch is harder than a 4 m one (same stretch, same time)', F.catchChance(0.6, 3, false, 28) < F.catchChance(0.6, 3, false, 4) - 0.15, [F.catchChance(0.6, 3, false, 28), F.catchChance(0.6, 3, false, 4)]);
  check('...but still a real chance', F.catchChance(0.6, 3, false, 28) >= 0.3);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
