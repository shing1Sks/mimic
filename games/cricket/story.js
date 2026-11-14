/*
 * Willowlight - the match story. Pure (node games/cricket/test/story.test.js).
 *
 * What the commentator remembers about the players this match: each batter's runs and balls,
 * each bowler's spells, and which of those stories he has already told.
 */
(function (root) {
  'use strict';
  const create = () => ({ bat: {}, bowl: {}, said: {} });
  const bk = o => o.inn + ':' + o.wk, wk = o => o.inn + ':' + o.bowler;
  function batter(st, o) { return st.bat[bk(o)] || (st.bat[bk(o)] = { runs: 0, balls: 0 }); }
  function bowler(st, o) { return st.bowl[wk(o)] || (st.bowl[wk(o)] = { runs: 0, balls: 0, wkts: 0, overs: 0 }); }
  /** One ball: { inn, wk (wickets down = which batter), bowler (name), runs, extra ('wd'|'nb'|null), wicket }. */
  function ball(st, o) {
    const b = batter(st, o), w = bowler(st, o);
    if (o.extra !== 'wd') b.balls++;
    if (!o.extra) { b.runs += o.runs || 0; w.balls++; }
    w.runs += (o.runs || 0) + (o.extra ? 1 : 0);
    if (o.wicket) w.wkts++;
    w.overs = Math.floor(w.balls / 6);
  }
  /** A new over: what to say about the man with the ball. */
  function overStart(st, o) {
    const w = st.bowl[wk(o)];
    if (!w || !w.balls) return 'newBowler';
    if (w.wkts >= 2) return 'bowlerOnFire';
    if (w.runs / Math.max(1, w.balls / 6) >= 12) return 'bowlerExpensive';
    return 'bowlerBack';
  }
  /** Before a ball: a story about the striker, told once (set past 30, or stuck on 7+ balls for 2 or fewer). */
  function batterNote(st, o) {
    const b = st.bat[bk(o)];
    if (!b) return null;
    const tell = k => { if (st.said[bk(o) + k]) return null; st.said[bk(o) + k] = 1; return k; };
    if (b.runs >= 30) return tell('batterSet');
    if (b.balls >= 7 && b.runs <= 2) return tell('batterStruggling');
    return null;
  }
  /** "wickets-runs (overs)" for the scorebug and the new-bowler banner. */
  function figures(st, o) { const w = bowler(st, o); return w.wkts + '-' + w.runs + ' (' + w.overs + (w.balls % 6 ? '.' + (w.balls % 6) : '') + ')'; }
  const api = { create, ball, batter, bowler, overStart, batterNote, figures };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.CK = root.CK || {}; root.CK.Story = api; }
})(typeof window !== 'undefined' ? window : null);
