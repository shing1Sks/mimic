/*
 * Willowlight - the match story. Pure (node games/cricket/test/story.test.js).
 *
 * What the commentator remembers about the players this match: each batter's runs and balls,
 * each bowler's spells, and which of those stories he has already told.
 */
(function (root) {
  'use strict';
  const create = () => ({ bat: {}, bowl: {}, said: {}, part: {} });
  const bk = o => o.inn + ':' + o.wk, wk = o => o.inn + ':' + o.bowler;
  function batter(st, o) { return st.bat[bk(o)] || (st.bat[bk(o)] = { runs: 0, balls: 0 }); }
  function bowler(st, o) { return st.bowl[wk(o)] || (st.bowl[wk(o)] = { runs: 0, balls: 0, wkts: 0, overs: 0 }); }
  /** One ball: { inn, wk (wickets down = which batter), bowler (name), runs, extra ('wd'|'nb'|null), wicket }. */
  function ball(st, o) {
    const b = batter(st, o), w = bowler(st, o);
    if (o.batName) b.name = o.batName;
    const pt = st.part[o.inn] || (st.part[o.inn] = { runs: 0, balls: 0 });
    pt.runs += (o.runs || 0) + (o.extra ? 1 : 0); if (o.extra !== 'wd') pt.balls++;
    if (o.wicket) st.part[o.inn] = { runs: 0, balls: 0 };
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
  /** 'fifty' | 'hundred' when a batter's score goes from `before` to `after` past it. */
  function milestone(before, after) { return before < 100 && after >= 100 ? 'hundred' : before < 50 && after >= 50 ? 'fifty' : null; }
  /** The current partnership in an innings: { runs, balls } since the last wicket. */
  function partnership(st, inn) { return st.part[inn] || { runs: 0, balls: 0 }; }
  /**
   * Player of the match: the biggest impact, a run worth 1 and a wicket 22, with a little for quick
   * scoring and tight bowling. { name, inn, line ("54 (31)" or "3-18 (4)") } or null.
   */
  function potm(st) {
    let best = null;
    for (const [k, b] of Object.entries(st.bat)) {
      if (!b.name) continue;
      const sc = b.runs + Math.max(0, b.runs - b.balls) * 0.3;
      if (!best || sc > best.sc) best = { sc, name: b.name, inn: +k.split(':')[0], kind: 'bat', line: b.runs + ' (' + b.balls + ')' };
    }
    for (const [k, w] of Object.entries(st.bowl)) {
      const [inn, name] = [+k.split(':')[0], k.slice(k.indexOf(':') + 1)];
      const sc = w.wkts * 22 + Math.max(0, w.balls * 1.2 - w.runs) * 0.5;
      if (!best || sc > best.sc) best = { sc, name, inn, kind: 'bowl', line: figures(st, { inn, bowler: name }) };
    }
    if (best) delete best.sc;
    return best;
  }
  const api = { create, ball, batter, bowler, overStart, batterNote, figures, milestone, partnership, potm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.CK = root.CK || {}; root.CK.Story = api; }
})(typeof window !== 'undefined' ? window : null);
