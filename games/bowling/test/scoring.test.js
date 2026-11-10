// Ten-pin scoring. Run: node games/bowling/test/scoring.test.js
'use strict';
const path = require('path');
const S = require(path.join(__dirname, '..', 'scoring.js'));
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const rep = (n, v) => Array(n).fill(v);
const total = r => S.score(r).total;

check('gutter game is 0', total(rep(20, 0)) === 0);
check('all ones is 20', total(rep(20, 1)) === 20);
check('perfect game is 300', total(rep(12, 10)) === 300, total(rep(12, 10)));
check('all 5-spares with a 5 fill is 150', total(rep(21, 5)) === 150, total(rep(21, 5)));
check('all 9-0 is 90', total([].concat(...rep(10, [9, 0]))) === 90);
check('one spare then 3', total([7, 3, 3].concat(rep(17, 0))) === 16);
check('one strike then 3,4', total([10, 3, 4].concat(rep(16, 0))) === 24);
check('turkey then gutters = 60', total([10, 10, 10].concat(rep(14, 0))) === 60);
check('tenth frame spare + fill', total(rep(18, 0).concat([7, 3, 10])) === 20);
check('tenth frame X X X', total(rep(18, 0).concat([10, 10, 10])) === 30);
check('tenth frame open has no fill ball', S.next(rep(18, 0).concat([4, 4])).over === true);
check('tenth frame strike gives two more balls', !S.next(rep(18, 0).concat([10, 3])).over && S.next(rep(18, 0).concat([10, 3, 5])).over);
check('known game: 9 strikes then 9/ + X... (a classic 279-ish sheet)', total([10, 10, 10, 10, 10, 10, 10, 10, 10, 9, 1, 10]) === 279, total([10, 10, 10, 10, 10, 10, 10, 10, 10, 9, 1, 10]));
// a mixed real sheet: X 7/ 9- X -8 8/ -6 X X X81 = 167
const mixed = [10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1];
check('mixed sheet totals 167', total(mixed) === 167, S.score(mixed));
check('mixed sheet marks', JSON.stringify(S.marks(mixed)) === JSON.stringify([['', 'X'], ['7', '/'], ['9', '-'], ['', 'X'], ['-', '8'], ['8', '/'], ['-', '6'], ['', 'X'], ['', 'X'], ['X', '8', '1']]), S.marks(mixed));
check('pending strike shows no total yet', S.score([10, 3]).cumulative[0] === null);
check('pending spare shows no total yet', S.score([6, 4]).cumulative[0] === null && S.score([6, 4, 2]).cumulative[0] === 12);
check('open frame totals right away', S.score([3, 4]).cumulative[0] === 7);
// next(): which ball, fresh rack
let n = S.next([]);
check('first ball of the game', n.frame === 0 && n.ball === 0 && n.fresh && !n.over);
n = S.next([7]);
check('second ball sees 3 standing', n.frame === 0 && n.ball === 1 && !n.fresh && n.standing === 3);
n = S.next([10]);
check('after a strike: next frame, fresh rack', n.frame === 1 && n.ball === 0 && n.fresh);
n = S.next(rep(18, 0).concat([10]));
check('tenth: after a strike the rack is fresh again', n.frame === 9 && n.ball === 1 && n.fresh);
n = S.next(rep(18, 0).concat([10, 4]));
check('tenth: X then 4 leaves 6 for the third ball', n.ball === 2 && !n.fresh && n.standing === 6);
n = S.next(rep(18, 0).concat([6, 4]));
check('tenth: spare gives a fresh rack for the fill', n.ball === 2 && n.fresh);
check('frameDone after strike', S.frameDone([10]) && !S.frameDone([7]) && S.frameDone([7, 2]));
check('frameDone in the tenth waits for fill balls', !S.frameDone(rep(18, 0).concat([10])) && S.frameDone(rep(18, 0).concat([3, 4])));
check('tenth marks: X 4 /', JSON.stringify(S.marks(rep(18, 0).concat([10, 4, 6]))[9]) === JSON.stringify(['X', '4', '/']));
check('tenth marks: 0 / X', JSON.stringify(S.marks(rep(18, 0).concat([0, 10, 10]))[9]) === JSON.stringify(['-', '/', 'X']));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
