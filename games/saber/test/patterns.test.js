// Run: node games/saber/test/patterns.test.js
// Mines, walls, arcs, chains and heavy blocks are charted fairly, and songs have a shape.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ctx = { Math, console, Float32Array, Uint8Array, Array, Object, JSON, performance: { now: () => 0 } };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['audio.js', 'tracks.js', 'songs.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
const S = ctx.CadenceSongs;
const ALL = { heavy: true, bombs: true, arcs: true, walls: true, chains: true };
const NONE = { heavy: false, bombs: false, arcs: false, walls: false, chains: false };

let fail = 0, n = 0;
function check(name, cond, info) { n++; if (cond) return; fail++; console.log('FAIL ' + name + (info ? ' ' + info : '')); }

check('real music tracks are loaded', S.SONGS.filter(s => s.file).length >= 4, S.SONGS.filter(s => s.file).length + ' file songs');

const tally = { bombs: 0, walls: 0, arcs: 0, chains: 0, heavy: 0 };
for (const song of S.SONGS) for (const diff of ['normal', 'hard']) {
  const id = song.title + '/' + diff;
  const ch = S.buildChart(song, diff, { features: ALL });
  const notes = ch.notes, x = ch.extras;
  const bombs = x.filter(e => e.type === 'bomb'), walls = x.filter(e => e.type === 'wall');
  const arcs = x.filter(e => e.type === 'arc'), links = x.filter(e => e.type === 'link');
  tally.bombs += bombs.length; tally.walls += walls.length; tally.arcs += arcs.length; tally.chains += links.length;
  tally.heavy += notes.filter(q => q.kind === 'heavy').length;

  // a mine never sits in the path of a nearby cut
  let badBomb = 0;
  bombs.forEach(b => notes.forEach(q => { if (Math.abs(q.time - b.time) < 0.4 && Math.abs(q.lane - b.lane) < 2) badBomb++; }));
  check(id + ': mines keep clear of cuts', badBomb === 0, 'bad ' + badBomb);
  check(id + ': mines are on the grid', bombs.every(b => b.lane >= 0 && b.lane <= 3 && b.row >= 0 && b.row <= 2));

  // nothing to cut behind a wall, and walls give the player time to see them
  let badWall = 0;
  walls.forEach(w => notes.forEach(q => {
    if (q.time > w.t0 - 0.3 && q.time < w.t1 + 0.3 && w.lanes.indexOf(q.lane) >= 0) badWall++;
  }));
  check(id + ': no blocks behind walls', badWall === 0, 'bad ' + badWall);
  check(id + ': walls last 1-4 s on one side', walls.every(w => w.t1 - w.t0 >= 0.9 && w.t1 - w.t0 <= 4.2 && w.lanes.length === 2 && (w.lanes[0] === 0 || w.lanes[0] === 2)));
  let wallOverlap = 0;
  for (let i = 1; i < walls.length; i++) if (walls[i].t0 < walls[i - 1].t1 + 1.0) wallOverlap++;
  check(id + ': walls do not overlap', wallOverlap === 0);

  // arcs join two consecutive blocks across a gap
  const times = new Map(notes.map((q, i) => [q.time, i]));
  let badArc = 0;
  arcs.forEach(a => {
    const i0 = times.get(a.t0), i1 = times.get(a.t1);
    if (i0 === undefined || i1 !== i0 + 1 || a.t1 - a.t0 < 0.45) badArc++;
  });
  check(id + ': arcs join consecutive blocks', badArc === 0, 'bad ' + badArc);

  // chain links follow their head, before the next block, along its direction
  let badLink = 0;
  links.forEach(l => {
    const hi = notes.findIndex(q => q.time === l.head);
    const nx = notes[hi + 1];
    if (hi < 0 || notes[hi].dir < 0 || l.time <= l.head || l.time - l.head > 0.35 || (nx && l.time >= nx.time - 0.15)) badLink++;
  });
  check(id + ': chain links follow a head', badLink === 0, 'bad ' + badLink);

  // heavy blocks need wind-up time
  let badHeavy = 0;
  notes.forEach((q, i) => { if (q.kind === 'heavy' && i && q.time - notes[i - 1].time < 0.45) badHeavy++; });
  check(id + ': heavy blocks have room to wind up', badHeavy === 0, 'bad ' + badHeavy);

  // the song has a shape: drops are denser than breathers
  const dens = [0, 0, 0, 0], bars = [0, 0, 0, 0];
  for (let b = 0; b < song.totalBars; b++) { const sec = song.barSections[b]; if (!sec.rest) bars[sec.intensity]++; }
  notes.forEach(q => { const sec = song.barSections[Math.floor(q.beat / 4)]; if (sec && !sec.rest) dens[sec.intensity]++; });
  const per = dens.map((d, i) => bars[i] ? d / bars[i] : null).filter(v => v !== null);
  check(id + ': hottest sections densest', per[per.length - 1] > per[0] * 1.4, per.map(v => v.toFixed(1)).join('/'));

  // phrases vary
  const fl = ch.phrases.map(p => p.flavour);
  let repeats = 0;
  for (let i = 1; i < fl.length; i++) if (fl[i] === fl[i - 1] && fl[i] !== 'rest') repeats++;
  check(id + ': phrase flavours vary', new Set(fl).size >= 4 && repeats <= Math.floor(fl.length / 6), fl.join(','));

  // file tracks: blocks land where the music hits
  if (song.file) {
    const on = q => +song.onsets[Math.floor(q.beat / 4)][Math.round((q.beat % 4) * 4) % 16];
    const avgAt = notes.reduce((a, q) => a + on(q), 0) / notes.length;
    let all = 0, cnt = 0;
    song.onsets.forEach(r => { for (let i = 0; i < 16; i += 2) { all += +r[i]; cnt++; } });
    check(id + ': blocks sit on onsets', avgAt > all / cnt * 1.15, avgAt.toFixed(2) + ' vs ' + (all / cnt).toFixed(2));
  }
}
Object.keys(tally).forEach(k => check('some ' + k + ' charted', tally[k] > 10, k + ' ' + tally[k]));

// features off: the plain game
for (const song of S.SONGS) {
  const ch = S.buildChart(song, 'easy', { features: NONE });
  check(song.title + ': no extras when features are off', ch.extras.length === 0 && ch.notes.every(q => !q.kind));
}
// deterministic
const a = JSON.stringify(S.buildChart(S.SONGS[0], 'hard', { features: ALL })), b = JSON.stringify(S.buildChart(S.SONGS[0], 'hard', { features: ALL }));
check('charts are deterministic', a === b);

console.log(fail ? `${fail} of ${n} failed` : `all ${n} passed`);
process.exit(fail ? 1 : 0);
