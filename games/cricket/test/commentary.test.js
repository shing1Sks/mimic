// Paaji's call scheduler: one line at a time, big moments first, no repeats, nothing stale.
// Run: node games/cricket/test/commentary.test.js
'use strict';
const path = require('path');
const C = require(path.join(__dirname, '..', 'commentary.js'));
const LINES = require(path.join(__dirname, '..', 'commentary-lines.js')).LINES;
let pass = 0, fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const seed = n => { let s = n; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const clock = () => { const c = { t: 100000 }; c.now = () => c.t; return c; };

check('the bundled lines cover every moment the game calls', ['six', 'four', 'edgeFour', 'dot', 'beaten', 'appeal', 'bowled', 'caught', 'lbw', 'playedOn', 'dropped', 'misfield', 'sledge', 'lastOver', 'quick20', 'hatTrick', 'threeWickets', 'wide', 'noBall', 'won', 'lost', 'betweenOvers', 'start'].every(m => LINES.some(l => l.moment === m)));
check('every line has an id, a moment, a priority 1-4 and subtitle text', LINES.every(l => l.id && l.moment && [1, 2, 3, 4].includes(l.prio) && l.text.length > 3));
{
  const c = clock(), s = C.createScheduler({ lines: LINES, now: c.now, rng: seed(1) });
  const d = s.moment('dot', c.t);
  check('a dot ball gets a line', d && d.moment === 'dot');
  c.t += 300;
  const six = s.moment('six', c.t);
  check('a six interrupts a dot line still playing', six && six.moment === 'six');
  c.t += 300;
  check('a four does not interrupt the six', s.moment('four', c.t) === null);
  c.t += 5000;
  check('once the six is done, the four gets its turn', s.moment('four', c.t) !== null);
}
{
  const c = clock(), s = C.createScheduler({ lines: LINES, now: c.now, rng: seed(2), coolDownMs: 4000 });
  const a = s.moment('dot', c.t); s.done(a.id); c.t += 1500;
  check('quiet balls stay quiet: a second dot line inside the cool-down is skipped', s.moment('dot', c.t) === null);
  c.t += 4000;
  check('...and allowed after it', s.moment('dot', c.t) !== null);
}
{
  const c = clock(), s = C.createScheduler({ lines: LINES, now: c.now, rng: seed(2), sameQuietMs: 12000 });
  const a = s.moment('dot', c.t); s.done(a.id); c.t += 8000;
  check('sameQuietMs: no dot line on the very next dot ball...', s.moment('dot', c.t) === null);
  const b = s.moment('betweenOvers', c.t);
  check('...but other quiet chatter still comes', b !== null); s.done(b.id);
  c.t += 5000;
  check('...and the dot line after that', s.moment('dot', c.t) !== null);
}
{
  const c = clock(), s = C.createScheduler({ lines: LINES, now: c.now, rng: seed(3), noRepeat: 15 });
  const ids = [];
  for (let i = 0; i < 500; i++) { const l = s.moment(['six', 'four', 'caught', 'bowled', 'dropped'][i % 5], c.t); if (l) { ids.push(l.id); s.done(l.id); } c.t += 6000; }
  let rep = 0; ids.forEach((id, i) => { if (ids.slice(Math.max(0, i - 15), i).includes(id)) rep++; });
  check('no line repeats within the last 15 played (500 requests)', rep === 0 && ids.length > 400, [rep, ids.length]);
}
{
  const c = clock(), s = C.createScheduler({ lines: LINES, now: c.now, rng: seed(4) });
  check('a moment more than 1 s old is dropped (a hidden tab coming back)', s.moment('six', c.t - 1200) === null);
  check('an unknown moment gets nothing, no error', s.moment('nope', c.t) === null);
  const s2 = C.createScheduler({ lines: LINES, now: c.now, rng: seed(4), clips: null });
  check('without any audio clips, lines still come (subtitles only)', s2.moment('six', c.t) !== null);
}

{
  // review: the result call must never be lost behind a long six or wicket clip
  const c = clock(), s = C.createScheduler({ lines: LINES, now: c.now, rng: seed(5) });
  s.moment('six', c.t); c.t += 300;
  const won = s.moment('won', c.t);
  check('the match-winning call interrupts the six that won it', won && won.moment === 'won');
  c.t += 300;
  check('...and nothing interrupts the result call', s.moment('caught', c.t) === null);
  const c2 = clock(), s2 = C.createScheduler({ lines: LINES, now: c2.now, rng: seed(6) });
  const b1 = s2.moment('bowled', c2.t); c2.t += 1600;
  check('an equal big moment never cuts a line in progress (it waits its turn instead)', s2.moment('caught', c2.t) === null && s2.playing.id === b1.id);
  c2.t = s2.playing.until; s2.done(b1.id);
  const nx = s2.next();
  check('...and is said as soon as the line ends, if still fresh', nx && nx.moment === 'caught');
  check('milestones (quick 20, three wickets) and results outrank a wicket call', ['quick20', 'threeWickets'].every(m => LINES.find(l => l.moment === m).prio >= 3) && ['won', 'lost', 'hatTrick'].every(m => LINES.find(l => l.moment === m).prio === 4));
}
{
  // his own famous lines (w: 3) are picked three times as readily as each original one
  const L = [{ id: 'r1', moment: 'x', prio: 2, text: 'real one', w: 3 }, { id: 'o1', moment: 'x', prio: 2, text: 'orig one' }, { id: 'o2', moment: 'x', prio: 2, text: 'orig two' }, { id: 'o3', moment: 'x', prio: 2, text: 'orig six' }];
  const c = clock(), s = C.createScheduler({ lines: L, now: c.now, rng: seed(9), noRepeat: 1 });
  const n = {}; let prev = null, rep = 0;
  for (let i = 0; i < 3000; i++) { const l = s.moment('x', c.t); n[l.id] = (n[l.id] || 0) + 1; if (l.id === prev) rep++; prev = l.id; s.done(l.id); c.t += 6000; }
  const ratio = n.r1 / ((n.o1 + n.o2 + n.o3) / 3);
  // with no back-to-back repeats, w:3 among four lines settles at 3/5 of the time after another line: 1.8x each other one
  check('weighted lines: a w:3 line plays ~1.8x as often as each w:1 line here, never twice in a row', ratio > 1.6 && ratio < 2.0 && rep === 0, [n, ratio.toFixed(2)]);
}

// ---- a line once started plays to its end; waiting moments go stale fast; the ball waits for him ----
const L2 = [
  { id: 'd1', moment: 'dot', prio: 1, text: 'quiet one here' }, { id: 'd2', moment: 'dot', prio: 1, text: 'quiet two here' },
  { id: 'f1', moment: 'four', prio: 2, text: 'four one here' }, { id: 'f2', moment: 'four', prio: 2, text: 'four two here' },
  { id: 'a1', moment: 'appeal', prio: 2, text: 'appeal one' }, { id: 'q1', moment: 'quick20', prio: 3, text: 'quick twenty' },
  { id: 's1', moment: 'six', prio: 3, text: 'six one here' }, { id: 'w1', moment: 'won', prio: 4, text: 'won it here' },
];
const CLIPS = { d1: { ms: 5000 }, d2: { ms: 5000 }, f1: { ms: 5000 }, f2: { ms: 5000 }, a1: { ms: 4000 }, q1: { ms: 4000 }, s1: { ms: 7000 }, w1: { ms: 6000 } };
{
  const c = clock(), s = C.createScheduler({ lines: L2, now: c.now, rng: seed(11), clips: CLIPS });
  const f = s.moment('four', c.t); c.t += 3500;
  check('an equal moment does not cut in', s.moment('appeal', c.t) === null && s.playing.id === f.id);
  check('...it waits its turn (busy says so)', s.busy());
  check('a quiet moment during a line is skipped, not queued', s.moment('dot', c.t) === null);
  c.t += 1500; s.done(f.id);
  check('the waiting moment is said once the line ends (within its window)', (s.next() || {}).moment === 'appeal');
  c.t += 4000; s.done('a1');
  check('...and the skipped quiet one never comes back', s.next() === null && !s.busy());
}
{
  const c = clock(), s = C.createScheduler({ lines: L2, now: c.now, rng: seed(12), clips: CLIPS });
  const f = s.moment('four', c.t); c.t += 100;
  s.moment('appeal', c.t);
  c.t += 4900 + C.WAIT[2]; s.done(f.id);
  check('a moment that waited longer than WAIT[prio] is dropped, never said stale', s.next() === null && !s.busy());
}
{
  const c = clock(), s = C.createScheduler({ lines: L2, now: c.now, rng: seed(13), clips: CLIPS });
  const f = s.moment('four', c.t); c.t += 1000;
  check('opts.queue: a bigger follow-up (quick 20) does not cut the four that brought it', s.moment('quick20', c.t, { queue: 6000 }) === null && s.playing.id === f.id);
  s.moment('appeal', c.t);
  c.t += 4000; s.done(f.id);
  check('waiting moments: the biggest goes first', (s.next() || {}).moment === 'quick20');
  check('...one at a time', s.next() === null);
  const c2 = clock(), s2 = C.createScheduler({ lines: L2, now: c2.now, rng: seed(14), clips: CLIPS });
  const w = s2.moment('won', c2.t); c2.t += 500;
  s2.moment('four', c2.t, { queue: 12000 }); s2.moment('dot', c2.t, { queue: 25000 });
  c2.t += 5500; s2.done(w.id);
  const p1 = s2.next(); c2.t += 5000; s2.done(p1 && p1.id); const p2 = s2.next();
  check('the end-of-match chain (result, player of the match, sign-off) plays in turn, nothing cut', w && p1 && p1.moment === 'four' && p2 && p2.moment === 'dot');
}
{
  const c = clock(), s = C.createScheduler({ lines: L2, now: c.now, rng: seed(15), clips: CLIPS });
  s.moment('dot', c.t); c.t += 2000;
  check('a strictly bigger moment takes over (the player fades the old line at a pause)', (s.moment('four', c.t) || {}).moment === 'four');
  c.t += 300;
  check('the six takes over the four; the result takes over the six', (s.moment('six', c.t) || {}).moment === 'six' && (s.moment('won', c.t) || {}).moment === 'won');
}
{
  // ready: prefer a line whose clip is decoded; the pre-picked next line is the one used when ready
  const ready = new Set(['f2']);
  const c = clock(), s = C.createScheduler({ lines: L2, now: c.now, rng: seed(16), clips: CLIPS, ready: id => ready.has(id) });
  check('a line whose clip is ready is preferred over one still loading', s.moment('four', c.t).id === 'f2');
  ready.add('d1'); ready.add('d2');
  const up = s.upcoming('dot');
  c.t += 9000;
  check('upcoming() is the line the moment then uses', (s.moment('dot', c.t) || {}).id === up.id);
  const c2 = clock(), s2 = C.createScheduler({ lines: L2, now: c2.now, rng: seed(17), clips: CLIPS });
  const x = s2.moment('four', c2.t); s2.cancel(x.id);
  check('cancel(): a line never heard frees him at once', !s2.busy() && s2.playing === null);
}
{
  // the pacing rule game.js uses between balls: hold while he talks, never past PACE_CAP
  check('pacing: the ball waits while he is busy', C.holds(true, 0) && C.holds(true, C.PACE_CAP - 0.1));
  check('pacing: ...never past the cap, and not at all when he is quiet', !C.holds(true, C.PACE_CAP) && !C.holds(false, 0));
  // a simulated innings on the real lines: the moment, the ball's pause, then the next run-up once he is done
  const c = clock(), s = C.createScheduler({ lines: LINES, now: c.now, rng: seed(18), clips: Object.fromEntries(LINES.map(l => [l.id, { ms: 3000 + (l.text.length * 37) % 4000 }])) });
  const kinds = ['dot', 'four', 'dot', 'dot', 'six', 'beaten', 'caught', 'dot', 'appeal', 'four', 'dot', 'edgeFour'];
  let mid = 0, capped = 0, bad = 0, lines = 0;
  const step = ms => { for (let e = 0; e < ms; e += 100) { c.t += 100; if (s.playing && c.t >= s.playing.until) { s.done(s.playing.id); if (s.next()) lines++; } } };
  for (let ball = 0; ball < 120; ball++) {
    if (s.playing && c.t < s.playing.until) mid++;   // the run-up starts while he talks
    step(3000);                                      // run-up and flight
    const before = s.playing && c.t < s.playing.until ? s.playing : null;
    const l = s.moment(kinds[ball % kinds.length], c.t);
    if (l) { lines++; if (before && l.prio <= before.prio) bad++; }
    step(1000);                                      // the ball's own pause
    let over = 0;
    while (C.holds(s.busy(), over / 1000)) { step(100); over += 100; }
    if (over >= C.PACE_CAP * 1000) capped++;
  }
  check('simulated innings: no line is ever cut by an equal or smaller one', bad === 0, bad);
  check('simulated innings: a run-up starts mid-line only when the cap ran out', mid <= capped, [mid, capped]);
  check('simulated innings: still lively (a line on most balls)', lines >= 80, lines);
}
{
  // quietPoint: fade at the next gap between words, not mid-word
  const sr = 8000, d = new Float32Array(sr);
  for (let i = 0; i < sr; i++) { const t = i / sr; d[i] = (t >= 0.3 && t < 0.4) ? 0 : 0.5 * Math.sin(i * 0.3); }
  const q = C.quietPoint(d, sr, 0.1, 0.45);
  check('quietPoint finds the pause between words', q >= 0.19 && q <= 0.22, q);
  const loud = new Float32Array(sr).map((_, i) => 0.5 * Math.sin(i * 0.3) * (i > 2400 && i < 2560 ? 0.3 : 1));
  const q2 = C.quietPoint(loud, sr, 0.1, 0.45);
  check('...or the quietest moment when there is no pause', q2 >= 0.19 && q2 <= 0.22, q2);
}

// ---- the player, on a fake WebAudio and a fake clock ----
function fakeWorld() {
  const W = { t: 0, timers: [], log: [], fetches: [], srcs: [], decodeMs: 30, fetchDelay: () => 20 };
  W.now = () => W.t;
  W.setTimeout = (f, ms) => { const h = { at: W.t + (ms || 0), f }; W.timers.push(h); return h; };
  W.clearTimeout = h => { W.timers = W.timers.filter(x => x !== h); };
  const param = v => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime(x) { this.value = x; }, cancelScheduledValues() {}, setTargetAtTime(x) { this.value = x; } });
  W.ctx = {
    state: 'running', get currentTime() { return W.t / 1000; },
    createGain() { return { gain: param(1), connect() {}, disconnect() {} }; },
    createBufferSource() {
      const s = {
        buffer: null, onended: null, connect() {},
        start(at) { s.t0 = at * 1000; s.endAt = s.t0 + s.buffer.duration * 1000; W.srcs.push(s); W.log.push({ ev: 'start', id: s.buffer.id, at: s.t0 }); },
        stop(at) { const a = at === undefined ? W.t : at * 1000; s.endAt = Math.min(s.endAt, a); W.log.push({ ev: 'stop', id: s.buffer.id, at: a, played: a - s.t0 }); },
      };
      return s;
    },
    decodeAudioData(b) { return new Promise(res => W.setTimeout(() => res({ id: b.id, duration: b.ms / 1000, sampleRate: 1000, getChannelData: () => new Float32Array(b.ms).fill(0.3) }), W.decodeMs)); },
  };
  W.fetch = url => new Promise(res => {
    const id = url.split('/').pop().replace('.ogg', '');
    if (id === 'manifest.json') { W.setTimeout(() => res({ ok: true, json: async () => Object.fromEntries(L2.map(l => [l.id, { file: l.id + '.ogg', ms: CLIPS[l.id].ms }])) }), 5); return; }
    W.fetches.push(id);
    W.setTimeout(() => res({ ok: true, arrayBuffer: async () => { const b = { id, ms: CLIPS[id].ms, slice: () => b }; return b; } }), W.fetchDelay(id));
  });
  // advance the clock, firing timers and clip ends in time order
  W.run = async ms => {
    const end = W.t + ms;
    for (;;) {
      for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
      const nextT = W.timers.length ? Math.min(...W.timers.map(h => h.at)) : Infinity;
      const live = W.srcs.filter(s => !s.ended), nextS = live.length ? Math.min(...live.map(s => s.endAt)) : Infinity;
      if (Math.min(nextT, nextS) > end) { W.t = end; for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); return; }
      if (nextS <= nextT) { W.t = Math.max(W.t, nextS); const s = live.find(x => x.endAt === nextS); s.ended = true; W.log.push({ ev: 'ended', id: s.buffer.id, at: W.t }); if (s.onended) s.onended(); }
      else { W.t = Math.max(W.t, nextT); const h = W.timers.find(x => x.at === nextT); W.timers = W.timers.filter(x => x !== h); h.f(); }
    }
  };
  return W;
}
function fakePlayer(W) {
  const caps = [];
  const P = C.createPlayer({ lines: L2, base: 'c/', audio: () => ({ ctx: W.ctx, out: {}, duck: () => [] }), enabled: () => true, volume: () => 1,
    onLine: (l, secs) => caps.push({ id: l.id, at: W.t, secs }), now: W.now, setTimeout: W.setTimeout, clearTimeout: W.clearTimeout, fetch: W.fetch, rng: seed(21) });
  return { P, caps };
}
(async () => {
  {
    const W = fakeWorld(), { P, caps } = fakePlayer(W);
    P.load(); await W.run(2000);
    check('player: the clips load at once (no click needed), each moment\'s next line decoded', W.fetches.length === L2.length && P.decoded >= 6, [W.fetches.length, P.decoded]);
    const l = P.moment('four'); await W.run(10);
    const st = W.log.find(e => e.ev === 'start' && e.id === l.id);
    check('player: voice and subtitle start together', st && caps.length === 1 && caps[0].id === l.id && Math.abs(caps[0].at - st.at) < 5, [st, caps]);
    check('player: the subtitle stays up as long as the clip runs', caps[0] && Math.abs(caps[0].secs - (CLIPS[l.id].ms / 1000 + 0.3)) < 0.01, caps[0]);
    check('player: busy while he talks', P.busy);
    await W.run(3500); P.moment('appeal'); await W.run(10);
    check('player: an equal moment does not cut the line (no stop, no new subtitle)', !W.log.some(e => e.ev === 'stop') && caps.length === 1);
    await W.run(2000);
    const ap = W.log.find(e => e.ev === 'start' && e.id === 'a1');
    check('player: ...it follows once the line has ended, after a short breath', ap && ap.at - (st.at + CLIPS[l.id].ms) >= 200 && ap.at - (st.at + CLIPS[l.id].ms) < 400, ap);
    await W.run(5000);
    check('player: not busy once he is done', !P.busy);
    P.moment('dot'); await W.run(1500);
    const sx = P.moment('six'); await W.run(1000);
    const stop = W.log.find(e => e.ev === 'stop'), s6 = W.log.find(e => e.ev === 'start' && e.id === sx.id);
    check('player: a bigger moment fades the old line out, then starts (no hard chop, no overlap)', stop && s6 && s6.at >= stop.at - 30 && stop.at - (W.t - 1000) >= 100, [stop, s6]);
    const c6 = caps.find(c => c.id === sx.id);
    check('player: ...with its subtitle exactly when its voice starts', c6 && Math.abs(c6.at - s6.at) < 5, [c6, s6]);
  }
  {
    // a slow network: the clip for the moment is not here yet
    const W = fakeWorld(); W.fetchDelay = () => 3000;
    const { P, caps } = fakePlayer(W);
    P.load(); await W.run(100);
    P.moment('four'); await W.run(2000);
    check('player: clip not ready within the grace: no subtitle and no late voice', caps.length === 0 && !W.log.some(e => e.ev === 'start'), caps);
    check('player: ...and he is free again (the ball does not wait on nothing)', !P.busy);
    await W.run(5000);
    check('player: ...and that line never turns up later', !W.log.some(e => e.ev === 'start'));
    const W2 = fakeWorld(); W2.fetchDelay = () => 300;
    const R = fakePlayer(W2);
    R.P.load(); await W2.run(50);
    const l2 = R.P.moment('four'); await W2.run(1500);
    const st2 = W2.log.find(e => e.ev === 'start');
    check('player: clip arrives inside the grace: voice and subtitle start together, from the top', st2 && R.caps.length === 1 && R.caps[0].id === l2.id && Math.abs(R.caps[0].at - st2.at) < 5 && st2.at <= 50 + 600, [st2, R.caps]);
  }
  {
    // no running audio (no click yet, or it cannot play): subtitles alone
    const W = fakeWorld(); W.ctx.state = 'suspended';
    const { P, caps } = fakePlayer(W);
    P.load(); await W.run(500);
    P.moment('six'); await W.run(10);
    check('player: no running audio: the subtitle alone', caps.length === 1 && !W.log.some(e => e.ev === 'start'));
    W.ctx.state = 'running'; await W.run(10000);
    check('player: ...and no voice turns up late when the audio wakes', !W.log.some(e => e.ev === 'start'));
  }
  {
    // memory: only each moment's next line stays decoded, not the whole set
    const W = fakeWorld(), { P } = fakePlayer(W);
    P.load(); await W.run(2000);
    for (let i = 0; i < 12; i++) { P.moment(['four', 'six', 'dot', 'appeal'][i % 4]); await W.run(9000); }
    const kinds = new Set(L2.map(l => l.moment)).size;
    check('player: decoded clips stay bounded (one per moment, plus the one playing)', P.decoded <= kinds + 1, [P.decoded, kinds]);
    P.moment('four'); await W.run(500); P.stop(); await W.run(500);
    check('player: stop() (quit, a new match) fades him out and forgets what was waiting', !P.busy && W.log.filter(e => e.ev === 'stop').length >= 1);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
