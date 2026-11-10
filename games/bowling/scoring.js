/*
 * Emberlane — ten-pin scoring. Pure functions, no browser needed
 * (node games/bowling/test/scoring.test.js).
 *
 * A player's game is just the list of pins knocked down by each ball, in order: [10, 7, 3, ...].
 * Everything else (frames, marks, running totals, which ball comes next, whether the rack is
 * fresh) is derived from it, so hot-seat play only needs one rolls array per player.
 */
(function (root) {
  'use strict';

  /** Split rolls into frames: [{ rolls: [..], strike, spare, open }]. Frame 10 may hold 3 balls. */
  function frames(rolls) {
    const out = [];
    let i = 0;
    for (let f = 0; f < 10 && i < rolls.length; f++) {
      if (f < 9) {
        if (rolls[i] === 10) { out.push({ rolls: [10], strike: true, spare: false }); i += 1; continue; }
        const r = rolls.slice(i, i + 2);
        out.push({ rolls: r, strike: false, spare: r.length === 2 && r[0] + r[1] === 10 });
        i += 2;
      } else {
        const r = rolls.slice(i, i + 3);
        out.push({ rolls: r, strike: r[0] === 10, spare: r[0] !== 10 && r.length >= 2 && r[0] + r[1] === 10 });
        i += 3;
      }
    }
    return out;
  }

  /** Marks as shown on a sheet: 'X' strike, '/' spare, '-' a miss (0), else the count. */
  function marks(rolls) {
    return frames(rolls).map((fr, f) => {
      const r = fr.rolls, m = [];
      if (f < 9) {
        if (fr.strike) return ['', 'X'];
        m.push(r[0] === 0 ? '-' : String(r[0]));
        if (r.length > 1) m.push(r[0] + r[1] === 10 ? '/' : r[1] === 0 ? '-' : String(r[1]));
        return m;
      }
      // tenth frame: every fresh rack can be a strike, a ball after a non-strike can spare
      let standing = 10, fresh = true;
      for (let k = 0; k < r.length; k++) {
        if (fresh && r[k] === 10) { m.push('X'); continue; }
        if (!fresh && r[k] === standing) { m.push('/'); standing = 10; fresh = true; continue; }
        m.push(r[k] === 0 ? '-' : String(r[k]));
        if (fresh) { standing = 10 - r[k]; fresh = false; } else { standing = 10; fresh = true; }
      }
      return m;
    });
  }

  /**
   * Running totals per frame; null while a frame's bonus balls have not been bowled yet.
   * Returns { cumulative: [..10 entries, number|null], total (sum of decided frames) }.
   */
  function score(rolls) {
    const cum = [];
    let i = 0, total = 0, open = false;
    for (let f = 0; f < 10; f++) {
      if (i >= rolls.length) { cum.push(null); open = true; continue; }
      let val = null, step;
      if (f < 9) {
        if (rolls[i] === 10) {
          step = 1;
          if (rolls.length > i + 2) val = 10 + rolls[i + 1] + rolls[i + 2];
        } else {
          step = 2;
          if (rolls.length > i + 1) {
            if (rolls[i] + rolls[i + 1] === 10) { if (rolls.length > i + 2) val = 10 + rolls[i + 2]; }
            else val = rolls[i] + rolls[i + 1];
          }
        }
      } else {
        step = 3;
        const r = rolls.slice(i, i + 3);
        const needs = (r[0] === 10 || (r.length > 1 && r[0] + r[1] === 10)) ? 3 : 2;
        if (r.length >= needs) val = r.slice(0, needs).reduce((a, b) => a + b, 0);
      }
      if (val === null || open) { cum.push(null); open = true; }
      else { total += val; cum.push(total); }
      i += step;
    }
    return { cumulative: cum, total };
  }

  /**
   * What comes next for this player: { over, frame (0..9), ball (0..2), fresh (full rack),
   * standing (how many pins should be up before this ball) }.
   */
  function next(rolls) {
    let i = 0;
    for (let f = 0; f < 9; f++) {
      if (i >= rolls.length) return { over: false, frame: f, ball: 0, fresh: true, standing: 10 };
      if (rolls[i] === 10) { i += 1; continue; }
      if (i + 1 >= rolls.length) return { over: false, frame: f, ball: 1, fresh: false, standing: 10 - rolls[i] };
      i += 2;
    }
    const r = rolls.slice(i);
    if (r.length === 0) return { over: false, frame: 9, ball: 0, fresh: true, standing: 10 };
    if (r.length === 1) return r[0] === 10
      ? { over: false, frame: 9, ball: 1, fresh: true, standing: 10 }
      : { over: false, frame: 9, ball: 1, fresh: false, standing: 10 - r[0] };
    if (r.length === 2) {
      if (r[0] === 10) return r[1] === 10
        ? { over: false, frame: 9, ball: 2, fresh: true, standing: 10 }
        : { over: false, frame: 9, ball: 2, fresh: false, standing: 10 - r[1] };
      if (r[0] + r[1] === 10) return { over: false, frame: 9, ball: 2, fresh: true, standing: 10 };
    }
    return { over: true, frame: 9, ball: r.length, fresh: false, standing: 0 };
  }

  /** Did this player's frame just end with the ball they bowled? (hot-seat turn change) */
  function frameDone(rolls) {
    if (!rolls.length) return false;
    const before = next(rolls.slice(0, -1)), after = next(rolls);
    return after.over || after.frame !== before.frame;
  }

  /**
   * The recount at the sweep: a pin still standing at the count that falls before the sweep counts
   * for that ball. downNow = pins down off this ball's rack now. A count is only ever raised.
   * Returns { rolls (a copy when changed), changed }.
   */
  function sweepCount(rolls, downNow) {
    const n = rolls.length;
    if (!n || !(downNow > rolls[n - 1])) return { rolls, changed: false };
    const r = rolls.slice(); r[n - 1] = downNow;
    return { rolls: r, changed: true };
  }

  const api = { frames, marks, score, next, frameDone, sweepCount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.BW = root.BW || {}; root.BW.Score = api; }
})(typeof window !== 'undefined' ? window : null);
