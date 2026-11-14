/*
 * Willowlight - DRS ball tracking for an LBW review. Pure (node games/cricket/test/drs.test.js).
 *
 * The three questions on screen: where it pitched (outside leg is never out), where it hit the pad
 * (outside the line is not out), and whether it would have gone on to hit the stumps. A ball whose
 * centre would pass outside the stumps but still clip them (within a ball's radius) is UMPIRE'S
 * CALL: the on-field decision stands, as in the game (it gave OUT on anything that clipped).
 */
(function (root) {
  'use strict';
  const HALF = 0.1143, H = 0.711, R = 0.036;
  /** o: { pitch {x}, at {x} (impact on the pad), stumps {x, y} (the tracked ball at the stumps), side +1 right-handed }. */
  function verdict(o) {
    const side = o.side || 1, px = o.pitch ? o.pitch.x * side : 0;
    const pitching = !o.pitch ? 'IN LINE' : px < -(HALF + R) ? 'OUTSIDE LEG' : px > HALF + R ? 'OUTSIDE OFF' : 'IN LINE';
    const impact = Math.abs(o.at.x) <= HALF + R ? 'IN LINE' : 'OUTSIDE';
    const sx = Math.abs(o.stumps.x), sy = o.stumps.y;
    const clips = sx <= HALF + R && sy <= H + R && sy >= 0, centre = sx <= HALF && sy <= H;
    const wickets = !clips ? 'MISSING' : centre ? 'HITTING' : "UMPIRE'S CALL";
    const out = pitching !== 'OUTSIDE LEG' && impact === 'IN LINE' && clips;
    return { out, umpiresCall: out && !centre, rows: [{ k: 'PITCHING', v: pitching }, { k: 'IMPACT', v: impact }, { k: 'WICKETS', v: wickets }] };
  }
  const api = { verdict };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.CK = root.CK || {}; root.CK.DRS = api; }
})(typeof window !== 'undefined' ? window : null);
