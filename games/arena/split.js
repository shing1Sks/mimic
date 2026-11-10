/*
 * Duskwater - same-PC split screen: the pure parts (no three.js, no DOM).
 *
 * Lobby (who joined with which device, teams, ready), the team plan a match starts from, where
 * each player's viewport sits on the screen, the field of view a viewport gets, how a sound is
 * panned for a player's viewport, which player hears a sound, and the automatic quality steps.
 *
 * Classic script: window.ArenaSplit. Node: module.exports (tests in test/split.test.js).
 */
(function (root) {
  'use strict';

  const MAX_PLAYERS = 4;
  const TEAM_SIZE = 5;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // ---------------------------------------------------------------- lobby

  /**
   * Lobby state. mode: 'coop' (every player on the Wardens against Corsair bots) or 'versus'
   * (players pick Wardens or Corsairs). fill: bots fill both teams up to five.
   * slots: [{ dev, team, ready }] in join order; dev is 'kbm' or 'pad:<gamepad index>'.
   */
  function lobbyCreate(mode, fill) {
    return { mode: mode === 'versus' ? 'versus' : 'coop', fill: fill !== false, slots: [] };
  }

  const slotOf = (st, dev) => st.slots.findIndex(s => s.dev === dev);
  const humansOn = (st, team) => st.slots.filter(s => s.team === team).length;

  /** The team a new player lands on: co-op is always the Wardens, versus balances the teams. */
  function autoTeam(st) {
    if (st.mode === 'coop') return 0;
    return humansOn(st, 1) < humansOn(st, 0) ? 1 : 0;
  }

  /**
   * One lobby action from one device. Returns { st, ev } where ev is what happened, for sound and
   * screen changes: 'join' | 'leave' | 'ready' | 'unready' | 'team' | 'mode' | 'fill' | 'back' | 'full' | null.
   * Actions: 'join' (A or Enter), 'start' (Start), 'back' (B or Esc), 'left' / 'right' (team), 'mode', 'fill'.
   * The state is copied, never changed in place.
   */
  function lobbyInput(prev, dev, action) {
    const st = { mode: prev.mode, fill: prev.fill, slots: prev.slots.map(s => Object.assign({}, s)) };
    const i = slotOf(st, dev), me = i >= 0 ? st.slots[i] : null;
    if (!me) {
      if (action === 'join' || action === 'start') {
        if (st.slots.length >= MAX_PLAYERS) return { st, ev: 'full' };
        st.slots.push({ dev, team: autoTeam(st), ready: false });
        return { st, ev: 'join' };
      }
      // B from a device that has not joined leaves the lobby only when nobody is in it
      if (action === 'back' && !st.slots.length) return { st, ev: 'back' };
      return { st, ev: null };
    }
    if (action === 'join' || action === 'start') {
      if (me.ready) return { st, ev: null };
      me.ready = true; return { st, ev: 'ready' };
    }
    if (action === 'back') {
      if (me.ready) { me.ready = false; return { st, ev: 'unready' }; }
      st.slots.splice(i, 1);
      return { st, ev: 'leave' };
    }
    if ((action === 'left' || action === 'right') && st.mode === 'versus' && !me.ready) {
      me.team = action === 'left' ? 0 : 1;
      return { st, ev: 'team' };
    }
    if (action === 'mode') {
      st.mode = st.mode === 'coop' ? 'versus' : 'coop';
      st.slots.forEach((s, k) => { s.ready = false; s.team = st.mode === 'coop' ? 0 : k % 2; });
      return { st, ev: 'mode' };
    }
    if (action === 'fill') {
      st.fill = !st.fill;
      st.slots.forEach(s => { s.ready = false; });
      return { st, ev: 'fill' };
    }
    return { st, ev: null };
  }

  /** A device dropped out (pad unplugged): its slot goes. */
  function lobbyDrop(prev, dev) {
    return { mode: prev.mode, fill: prev.fill, slots: prev.slots.filter(s => s.dev !== dev).map(s => Object.assign({}, s)) };
  }

  /** Can the match start? { ok, reason } - everyone joined is ready and both sides have someone. */
  function lobbyCanStart(st) {
    if (!st.slots.length) return { ok: false, reason: 'Press A or START on a controller to join' };
    if (st.slots.some(s => !s.ready)) return { ok: false, reason: 'Waiting for everyone to press START' };
    if (st.mode === 'versus' && !st.fill && (!humansOn(st, 0) || !humansOn(st, 1))) {
      return { ok: false, reason: 'Versus without bots needs a player on each team' };
    }
    return { ok: true, reason: '' };
  }

  /** Who plays: humans with their teams in slot order, and how many bots each team gets. */
  function teamPlan(st) {
    const humans = st.slots.map((s, slot) => ({ slot, dev: s.dev, team: st.mode === 'coop' ? 0 : s.team }));
    const h = [0, 1].map(t => humans.filter(p => p.team === t).length);
    let bots;
    if (st.mode === 'coop') bots = [st.fill ? Math.max(0, TEAM_SIZE - h[0]) : 0, TEAM_SIZE];
    else bots = st.fill ? [Math.max(0, TEAM_SIZE - h[0]), Math.max(0, TEAM_SIZE - h[1])] : [0, 0];
    return { mode: st.mode, humans, bots };
  }

  // ---------------------------------------------------------------- screen layout

  /**
   * Viewport rectangles in CSS pixels, origin top-left, one per player in slot order.
   * Two players split top/bottom ('h', the console default for shooters) or side by side ('v').
   * Three players use a 2x2 grid with the bottom-right quarter left for the scoreboard.
   */
  function layoutViews(n, W, H, two) {
    const r = (x, y, w, h) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
    if (n <= 1) return [r(0, 0, W, H)];
    if (n === 2) return two === 'v' ? [r(0, 0, W / 2, H), r(W / 2, 0, W / 2, H)] : [r(0, 0, W, H / 2), r(0, H / 2, W, H / 2)];
    const q = [r(0, 0, W / 2, H / 2), r(W / 2, 0, W / 2, H / 2), r(0, H / 2, W / 2, H / 2), r(W / 2, H / 2, W / 2, H / 2)];
    return q.slice(0, Math.min(n, MAX_PLAYERS));
  }

  /** The spare quarter of a three-player grid (null otherwise). */
  function spareRect(n, W, H) {
    return n === 3 ? { x: Math.round(W / 2), y: Math.round(H / 2), w: Math.round(W / 2), h: Math.round(H / 2) } : null;
  }

  /** HUD scale for a viewport: full size from 1280x720 up, never below 0.7 so text stays readable. */
  function hudScale(rect) {
    return clamp(Math.min(rect.w / 1280, rect.h / 720), 0.7, 1);
  }

  /**
   * Vertical FOV (degrees) for a viewport from the player's horizontal FOV setting. A very wide
   * viewport (two players stacked) would get a letterbox-thin vertical view, so it keeps at least
   * what a 16:9 screen would show, as long as the horizontal view stays under `maxH` degrees.
   */
  function verticalFov(hFov, aspect, maxH = 115) {
    const v = (h, a) => 2 * Math.atan(Math.tan(h * Math.PI / 360) / a) * 180 / Math.PI;
    const fromH = v(hFov, aspect);
    if (aspect <= 16 / 9) return fromH;
    return Math.max(fromH, Math.min(v(hFov, 16 / 9), v(maxH, aspect)));
  }

  // ---------------------------------------------------------------- sound

  /** Horizontal centre of a viewport as a stereo position -1..1 (0 for a full-width view). */
  function viewPan(rect, W) {
    return clamp(((rect.x + rect.w / 2) / W - 0.5) * 2, -1, 1);
  }

  /**
   * Final pan of a sound heard by a player: the direction in that player's world view, leaning
   * toward the side of the screen that player's viewport sits on.
   */
  function mixPan(localPan, vPan) {
    const lean = 0.6 * vPan;
    return clamp(lean + localPan * (1 - Math.abs(lean)), -1, 1);
  }

  /** Index of the listener nearest to (x, z); listeners: [{ x, z }]. -1 when there are none. */
  function nearestListener(listeners, x, z) {
    let best = -1, bd = Infinity;
    listeners.forEach((l, i) => { const d = (l.x - x) * (l.x - x) + (l.z - z) * (l.z - z); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  // ---------------------------------------------------------------- quality

  /**
   * Starting quality for a player count. The views share the screen, so together they shade about
   * as many pixels as one full view: the extra cost is drawing the scene once per view, not fill.
   * Resolution only steps down a little; minScale is as far as automatic resolution may go, so
   * each view stays sharp enough to read a soldier at range. Solo starts at full resolution and
   * only gives some up when the frame rate cannot hold its target.
   */
  function qualityFor(n) {
    if (n <= 1) return { scale: 1, minScale: 0.8 };
    if (n === 2) return { scale: 1, minScale: 0.8 };
    return { scale: 0.9, minScale: 0.75 };
  }

  /** Frame-rate target for a player count. */
  function fpsTarget(n) { return n <= 1 ? 50 : n === 2 ? 45 : 30; }

  /**
   * Dynamic resolution: one step per measurement. Below target: drop 10%; well above it: give
   * 5% back, never past `max`. Returns the new scale.
   */
  function adaptScale(scale, fps, target, min, max) {
    if (fps < target - 1) return Math.max(min, +(scale - 0.1).toFixed(2));
    if (fps > target * 1.25 && scale < max) return Math.min(max, +(scale + 0.05).toFixed(2));
    return scale;
  }

  const api = {
    MAX_PLAYERS, TEAM_SIZE,
    lobbyCreate, lobbyInput, lobbyDrop, lobbyCanStart, teamPlan, autoTeam,
    layoutViews, spareRect, hudScale, verticalFov,
    viewPan, mixPan, nearestListener,
    qualityFor, fpsTarget, adaptScale,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArenaSplit = api;
})(typeof window !== 'undefined' ? window : this);
