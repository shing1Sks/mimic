/*
 * Willowlight - the scorebook: two innings, overs, wickets, extras, the chase.
 * Pure logic (node games/cricket/test/match.test.js).
 */
(function (root) {
  'use strict';

  /** o: { overs, wickets, names: ['P1', 'P2'], firstBat: 0 | 1 } */
  function create(o) {
    const fb = o.firstBat || 0;
    const inn = bat => ({ bat, bowl: 1 - bat, runs: 0, wkts: 0, balls: 0, extras: 0, fours: 0, sixes: 0, dots: 0, overs: [], cur: [] });
    return { overs: o.overs, wickets: o.wickets, names: o.names || ['P1', 'P2'], innings: [inn(fb), inn(1 - fb)], i: 0, target: null, done: false };
  }
  const oversText = balls => Math.floor(balls / 6) + '.' + (balls % 6);
  function current(m) { return m.innings[m.i]; }

  /**
   * Record one ball: { runs (off the bat, or byes), extra: null | 'wd' | 'nb', wicket: null | how }.
   * Returns { label, over (an over just finished), inningsOver, matchOver }.
   */
  function record(m, r) {
    const inn = current(m), ev = {};
    const extra = r.extra || null, runs = r.runs || 0;
    inn.runs += runs + (extra ? 1 : 0);
    if (extra) inn.extras += 1;
    if (!extra) inn.balls++;
    if (r.wicket) inn.wkts++;
    if (runs === 4 && r.boundary) inn.fours++;
    if (runs === 6) inn.sixes++;
    if (!extra && !runs && !r.wicket) inn.dots++;
    ev.label = r.wicket ? 'W' : extra ? (extra + (runs ? '+' + runs : '')) : runs ? String(runs) : '•';
    inn.cur.push(ev.label);
    if (!extra && inn.balls % 6 === 0) { inn.overs.push(inn.cur); inn.cur = []; ev.over = true; }
    const chased = m.i === 1 && inn.runs >= m.target;
    if (inn.balls >= m.overs * 6 || inn.wkts >= m.wickets || chased) {
      ev.inningsOver = true;
      if (inn.cur.length && !ev.over) { inn.overs.push(inn.cur); inn.cur = []; }
      if (m.i === 0) { m.target = inn.runs + 1; m.i = 1; }
      else { m.done = true; ev.matchOver = true; }
    }
    return ev;
  }

  /** { winner: player index | -1 tie, margin, by: 'runs' | 'wickets' | 'tie', text } */
  function result(m) {
    const a = m.innings[0], b = m.innings[1];
    if (b.runs >= m.target) {
      const w = m.wickets - b.wkts, ballsLeft = m.overs * 6 - b.balls;
      return { winner: b.bat, by: 'wickets', margin: w, text: `${m.names[b.bat]} wins by ${w} wicket${w === 1 ? '' : 's'}` + (ballsLeft ? ` (${ballsLeft} ball${ballsLeft === 1 ? '' : 's'} left)` : '') };
    }
    if (b.runs === a.runs) return { winner: -1, by: 'tie', margin: 0, text: 'Match tied' };
    const d = a.runs - b.runs;
    return { winner: a.bat, by: 'runs', margin: d, text: `${m.names[a.bat]} wins by ${d} run${d === 1 ? '' : 's'}` };
  }

  /** The chase in words: "need 12 from 7" (second innings only). */
  function need(m) {
    if (m.i !== 1 || m.done) return null;
    const inn = current(m), r = m.target - inn.runs, b = m.overs * 6 - inn.balls;
    return { runs: r, balls: b, text: `NEED ${r} FROM ${b}` };
  }
  function runRate(inn) { return inn.balls ? inn.runs / (inn.balls / 6) : 0; }

  const api = { create, record, result, need, current, oversText, runRate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.CK = root.CK || {}; root.CK.Match = api; }
})(typeof window !== 'undefined' ? window : null);
