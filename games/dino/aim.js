// Light-gun aim for a fixed stand. The phone (Mimic Grip or Wand) or a mouse turns an aim direction; the
// crosshair shows it on screen, and once it passes EDGE the view pans so the crosshair stays near
// the edge. The aim is tracked as the TOTAL turn since the last align (u, in half-screen units), so
// pointing the phone back to the same angle always puts the crosshair back on the same spot: going
// past the edge can never leave the phone and the crosshair out of step. Align (CENTRE on the phone,
// hold Vol Up, or V) makes the current pose straight ahead. Scoped: the view looks along the aim,
// crosshair centred, mouse turning slowed for precision. The phone's turn is applied 1:1 in angle
// (times phoneSens), scoped or not: no assist, no smoothing. Pure: Node tests in test/aim.test.js.
(function (root) {
  'use strict';
  const K = 0.0022;        // half-screens of aim per mouse count at sens 1
  const EDGE = 0.7;        // crosshair travel before the view starts to pan
  const SCOPE_K = 0.00045; // rad of aim per count while scoped
  const MARGIN = 0.3;      // half-screens of turn past the stand's limit still remembered exactly
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /** stand: { yaw, pitch, arc (rad either side), pitchMin, pitchMax } */
  function create(stand) { return { ux: 0, uy: 0, cx: 0, cy: 0, yaw: stand.yaw || 0, pitch: stand.pitch || 0 }; }

  /** One axis: u (aim, half-screens), hf (half field of view, rad), view offset limits (rad, +
   * = right / down). Returns { u (clamped), v (view offset), c (crosshair) }. */
  function axis(u, hf, vmin, vmax, scoped) {
    u = clamp(u, vmin / hf - 1 - MARGIN, vmax / hf + 1 + MARGIN);
    let v;
    if (scoped) v = clamp(u * hf, vmin, vmax);
    else v = clamp(Math.abs(u) <= EDGE ? 0 : Math.sign(u) * (Math.abs(u) - EDGE) * hf, vmin, vmax);
    const c = scoped ? 0 : clamp(u - v / hf, -1, 1);
    return { u, v, c };
  }

  /** The phone's turn (rad; x + = right, y + = down) in aim units (half-screens). */
  function turnU(turn, hfx, hfy, phoneSens) {
    const k = phoneSens == null ? 1 : phoneSens;
    return { x: (turn ? turn.x : 0) * k / (hfx || 0.9), y: (turn ? turn.y : 0) * k / (hfy || 0.6) };
  }

  /** o: { sens, scoped, hfx, hfy (half fields of view in rad, unzoomed), turn: { x, y } rad of
   * phone turn this frame (right / down +), phoneSens (1 = the crosshair turns as far as the phone) } */
  function step(s, dx, dy, dt, stand, o) {
    const sens = o.sens || 1, hfx = o.hfx || 0.9, hfy = o.hfy || 0.6;
    let ux = s.ux, uy = s.uy;
    if (o.scoped) { ux += dx * SCOPE_K * sens / hfx; uy += dy * SCOPE_K * sens / hfy; }
    else { ux += dx * K * sens; uy += dy * K * sens; }
    if (o.turn) { const t = turnU(o.turn, hfx, hfy, o.phoneSens); ux += t.x; uy += t.y; }
    const y0 = stand.yaw || 0, p0 = stand.pitch || 0, arc = stand.arc == null ? Math.PI : stand.arc;
    const pMin = stand.pitchMin == null ? -0.6 : stand.pitchMin, pMax = stand.pitchMax == null ? 0.5 : stand.pitchMax;
    const X = axis(ux, hfx, -arc, arc, o.scoped);
    const Y = axis(uy, hfy, p0 - pMax, p0 - pMin, o.scoped);
    return { ux: X.u, uy: Y.u, cx: X.c, cy: Y.c, yaw: y0 - X.v, pitch: p0 - Y.v };
  }

  /** This pose is straight ahead: crosshair centred, view on the stand's centre. */
  function align(s, stand) { return create(stand); }

  /** Normalised device coords of the crosshair (three.js: y up). */
  function ndc(s) { return { x: s.cx, y: -s.cy }; }

  const api = { create, step, align, ndc, turnU, EDGE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.DH = root.DH || {}; root.DH.Aim = api; }
})(typeof window !== 'undefined' ? window : this);
