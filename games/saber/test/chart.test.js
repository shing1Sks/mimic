// Run: node games/saber/test/chart.test.js
// Charts must use the whole grid and flow from one cut into the next.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

const ctx = { Math, console, Float32Array, Uint8Array, Array, Object, JSON, performance: { now: () => 0 } };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['audio.js', 'tracks.js', 'songs.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
const S = ctx.CadenceSongs;
const FAMILY = d => d === 1 || d === 6 || d === 7 ? 'down' : d === 0 || d === 4 || d === 5 ? 'up' : d === 2 ? 'left' : d === 3 ? 'right' : 'dot';

let fail = 0, n = 0;
function check(name, cond, info) { n++; if (cond) return; fail++; console.log('FAIL ' + name + (info ? ' ' + info : '')); }

for (const song of S.SONGS) for (const diff of Object.keys(S.DIFFS)) {
  const id = (song.title || song.id) + '/' + diff;
  const notes = S.buildChart(song, diff).notes;
  const N = notes.length, L = [0, 0, 0, 0], R = [0, 0, 0];
  let same = 0, wide = 0, flowBad = 0, sideBad = 0;
  notes.forEach((x, i) => {
    L[x.lane]++; R[x.row]++;
    if (x.dir === 2 && x.lane === 0) sideBad++;          // a left cut needs room to its left
    if (x.dir === 3 && x.lane === 3) sideBad++;
    if (!i) return;
    const p = notes[i - 1], gap = x.time - p.time;
    if (p.lane === x.lane && p.row === x.row && gap > 0.35) same++;
    if (Math.abs(p.lane - x.lane) >= 2) wide++;
    // quick consecutive cuts must reverse (down then up), never repeat the same way
    const fp = FAMILY(p.dir), fx = FAMILY(x.dir);
    if (gap < 0.5 && fp !== 'dot' && fx !== 'dot' && fp === fx) flowBad++;
  });
  const pct = v => Math.round(100 * v / N);
  check(id + ': every lane used >= 12%', L.every(v => pct(v) >= 12), 'lanes ' + L.map(pct).join('/'));
  check(id + ': outer lanes together >= 30%', pct(L[0] + L[3]) >= 30, 'outer ' + pct(L[0] + L[3]));
  check(id + ': top + bottom rows >= 35%', pct(R[0] + R[2]) >= 35, 'rows ' + R.map(pct).join('/'));
  check(id + ': same spot repeated (non-stream) <= 12%', pct(same) <= 12, 'same ' + pct(same));
  if (diff !== 'easy') check(id + ': some wide moves (>= 8%)', pct(wide) >= 8, 'wide ' + pct(wide));
  check(id + ': quick cuts always reverse', flowBad === 0, 'bad ' + flowBad);
  check(id + ': side cuts have room to follow through', sideBad === 0, 'bad ' + sideBad);
  // a down cut starts high, an up cut starts low, so each cut flows into the next
  const downTop = notes.filter(x => FAMILY(x.dir) === 'down' && x.row >= 1).length, downs = notes.filter(x => FAMILY(x.dir) === 'down').length;
  const upLow = notes.filter(x => FAMILY(x.dir) === 'up' && x.row <= 1).length, ups = notes.filter(x => FAMILY(x.dir) === 'up').length;
  check(id + ': down cuts sit in the upper rows', !downs || downTop / downs >= 0.8, Math.round(100 * downTop / downs) + '%');
  check(id + ': up cuts sit in the lower rows', !ups || upLow / ups >= 0.8, Math.round(100 * upLow / ups) + '%');
}
console.log(fail ? `${fail} of ${n} failed` : `all ${n} passed`);
process.exit(fail ? 1 : 0);
