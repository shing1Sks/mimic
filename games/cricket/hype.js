/*
 * Willowlight - the stadium's reactions. Pure (node games/cricket/test/hype.test.js).
 *
 * A mixed IPL crowd with fans of both sides: each moment is cheered by the side it favours and
 * groaned at by the other. Placards go up, the stadium's cheerleaders dance on boundaries and
 * wickets, and the band plays a sting on the big ones.
 */
(function (root) {
  'use strict';
  /** event: 'six' | 'four' | 'wicket' | 'dot' | 'catch' | ...; ctx: { batting, bowling } (team ids). */
  function crowd(event, ctx) {
    const bat = { roar: ctx.batting, groan: ctx.bowling }, bowl = { roar: ctx.bowling, groan: ctx.batting };
    switch (event) {
      case 'six': return Object.assign({ placards: ['6', 'DHO DAALA', 'OYE HOYE', 'BALLE BALLE'], dance: true, band: true }, bat);
      case 'four': return Object.assign({ placards: ['4', 'CHAUKA'], dance: true, band: false }, bat);
      case 'wicket': return Object.assign({ placards: ['OUT!', 'WICKET'], dance: true, band: true }, bowl);
      case 'catch': case 'dot': return Object.assign({ placards: [], dance: false, band: false }, bowl);
      default: return { roar: null, groan: null, placards: [], dance: false, band: false };
    }
  }
  /** What the GRAPHICS setting allows. */
  function extras(gfx) {
    const low = gfx === 'LOW';
    return { cheerleaders: !low, placards: !low, fireworks: low ? 0.5 : 1 };
  }
  const api = { crowd, extras };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.CK = root.CK || {}; root.CK.Hype = api; }
})(typeof window !== 'undefined' ? window : null);
