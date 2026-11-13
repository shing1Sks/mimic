/*
 * Willowlight - player attitude. Pure (node games/cricket/test/attitude.test.js).
 *
 * After a moment, who reacts and how: the fielding side's huddle and the bowler's send-off or
 * stare after a wicket, the batter's bat raise or glare after a six, an appeal, a shrug or a
 * facepalm after a mishap, and now and then a short chirp in a speech bubble. Playful and clean,
 * a couple of seconds, gone at the next ball. Players have no voice; Paaji reacts for them.
 */
(function (root) {
  'use strict';
  // chirps: the bowler at the batter, the batter back (short, PG, Hinglish)
  const BOWLER = ['Bas itna hi?', 'Agli baar, bhai', 'Chal, wapas ja!', 'Ball dekh ke khel!', 'Aaj nahi chalega', 'Seekh le thoda', 'Kahan dekh raha hai?', 'Bach gaya, bhai'];
  const BATTER = ['Yeh lo, sambhalo!', 'Aur daalo aisi!', 'Dum hai toh rok', 'Next ball bhi wahin', 'Gend gin ke rakh', 'Kya hua, bhai?'];
  const LINES_PG = BOWLER.concat(BATTER);
  const LINE_P = 0.12;    // a chirp on a quiet ball, never two balls running

  const context = () => ({ ball: 0, lastLine: -99 });
  const pick = (arr, rng) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
  function line(ctx, rng, from, p) {
    if (ctx.ball - ctx.lastLine < 2 || rng() >= p) return null;
    ctx.lastLine = ctx.ball;
    return pick(from, rng);
  }

  /**
   * event: 'wicket' | 'six' | 'four' | 'dot' | 'beaten' | 'drop' | 'mishap' | 'appeal'.
   * Returns null or { who: 'bowler'|'batter'|'fielder'|'fielders'|'keeper', gesture, huddle?, line, secs }.
   */
  function react(event, ctx, rng) {
    rng = rng || Math.random;
    switch (event) {
      case 'wicket': return { who: 'bowler', gesture: rng() < 0.45 ? 'sendoff' : 'stare', huddle: true, line: line(ctx, rng, BOWLER, 0.35), secs: 2.4 };
      case 'six': return rng() < 0.5 ? { who: 'batter', gesture: rng() < 0.6 ? 'batRaise' : 'glare', line: line(ctx, rng, BATTER, 0.3), secs: 2.0 } : null;
      case 'four': return rng() < 0.25 ? { who: 'batter', gesture: 'batRaise', line: null, secs: 1.4 } : null;
      case 'dot': case 'beaten': {
        const l = line(ctx, rng, BOWLER, LINE_P);
        if (l) return { who: 'bowler', gesture: 'stare', line: l, secs: 1.8 };
        return event === 'beaten' && rng() < 0.3 ? { who: 'bowler', gesture: 'stare', line: null, secs: 1.4 } : null;
      }
      case 'drop': case 'mishap': return { who: 'fielder', gesture: rng() < 0.5 ? 'facepalm' : 'shrug', line: null, secs: 1.8 };
      case 'appeal': return { who: 'bowler', gesture: 'appeal', line: null, secs: 1.4 };
      default: return null;
    }
  }

  const api = { react, context, LINES_PG, LINE_P };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.CK = root.CK || {}; root.CK.Attitude = api; }
})(typeof window !== 'undefined' ? window : null);
