/*
 * GYROWING first flight: a two-minute interactive lesson that waits for you to actually do each
 * thing (power, climb, dive, turn both ways, let go, ease off, a low pass), in the words of the
 * device in your hand. Pure: game.js feeds it the aircraft and the inputs, guide.js draws it.
 *
 * update(st, f, dt) with f: { device 'pad'|'kbm'|'gamepad', thr 0..1, sx, sy (stick: + right,
 * + back), vsFpm, bank deg (+ right wing down), hdg deg, aglFt, skim (chain active) } -> events
 * ({ type: 'step', step } when a step completes, { type: 'done' } at the end).
 */
(function (root) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrap = d => ((d + 540) % 360) - 180;
  const WORDS = {
    pad: { more: 'hold R2 (or A)', less: 'hold L2 (or B)', stick: 'the left stick', back: 'pull the left stick back', fwd: 'push the left stick forward', left: 'push the left stick left', right: 'push the left stick right' },
    gamepad: { more: 'hold RT / R2 (or A)', less: 'hold LT / L2 (or B)', stick: 'the left stick', back: 'pull the left stick back', fwd: 'push the left stick forward', left: 'push the left stick left', right: 'push the left stick right' },
    kbm: { more: 'hold Shift', less: 'hold Ctrl', stick: 'the arrow keys (or W A S D)', back: 'hold S (or the down arrow)', fwd: 'hold W (or the up arrow)', left: 'hold A (or the left arrow)', right: 'hold D (or the right arrow)' },
  };
  // id, what it teaches, which controls light up on the diagram, how long it must be held (s)
  const STEPS = [
    { id: 'power', title: 'Full power', text: w => `More power: ${w.more} until the throttle reads 100%.`, show: ['more'], hold: 0.4 },
    { id: 'climb', title: 'Climb', text: w => `Nose up: ${w.back} and keep it there. You climb.`, show: ['stickBack'], hold: 2 },
    { id: 'dive', title: 'Descend', text: w => `Nose down: ${w.fwd}. You descend and speed up.`, show: ['stickFwd'], hold: 1.5 },
    { id: 'left', title: 'Turn left', text: w => `Bank left: ${w.left} and hold it. The plane leans and turns.`, show: ['stickLeft'], turn: -40 },
    { id: 'right', title: 'Turn right', text: w => `Now the other way: ${w.right} and hold it.`, show: ['stickRight'], turn: 40 },
    { id: 'release', title: 'Let go', text: () => 'Let go of the stick. The Steady assist levels the wings and holds your height.', show: ['stickCentre'], hold: 2 },
    { id: 'ease', title: 'Cruise power', text: w => `Ease off: ${w.less} to bring the throttle to about 60%.`, show: ['less'], hold: 1 },
    { id: 'low', title: 'Low pass', text: w => `The fun part: dive under 200 ft over the ground and stay low and fast. Power up (${w.more}) and watch the SKIM meter.`, show: ['more', 'stickFwd'], hold: 3, timeout: 75 },
  ];

  function create(device) { return { device: WORDS[device] ? device : 'pad', i: 0, t: 0, held: 0, hdg0: null, turned: 0, done: false, finishedT: 0 }; }
  function words(st) { return WORDS[st.device]; }
  function current(st) { return STEPS[Math.min(st.i, STEPS.length - 1)]; }
  /** The step's instruction, its progress 0..1, and the diagram highlights. */
  function view(st) {
    if (st.done) return { title: 'You can fly', text: 'That is all it takes. More to try: X gear, D-pad flaps, Y camera, flick the stick twice for a barrel roll.', progress: 1, show: [], index: STEPS.length, total: STEPS.length };
    const s = current(st);
    const p = s.turn ? clamp(Math.abs(st.turned) / Math.abs(s.turn), 0, 1) : s.hold ? clamp(st.held / s.hold, 0, 1) : 0;
    return { id: s.id, title: s.title, text: s.text(words(st)), progress: p, show: s.show, index: st.i, total: STEPS.length };
  }
  /** Is the step's condition met this frame? */
  function meets(s, f, st) {
    switch (s.id) {
      case 'power': return f.thr >= 0.95;
      case 'climb': return f.sy > 0.25 && f.vsFpm > 250;
      case 'dive': return f.sy < -0.25 && f.vsFpm < -250;
      case 'release': return Math.abs(f.sx) < 0.12 && Math.abs(f.sy) < 0.12 && Math.abs(f.bank) < 7;
      case 'ease': return f.thr >= 0.4 && f.thr <= 0.75;
      case 'low': return !!f.skim;
    }
    return false;
  }
  function update(st, f, dt) {
    const ev = [];
    if (st.done) return ev;
    const s = current(st);
    st.t += dt;
    if (s.turn) {
      const wantSign = Math.sign(s.turn), banked = Math.sign(f.bank) === wantSign && Math.abs(f.bank) > 12;
      // count from the moment the wings bank the right way (the last turn may still be unwinding)
      if (st.hdg0 === null || (!st.started && !banked)) st.hdg0 = f.hdg;
      if (banked) st.started = true;
      const d = wrap(f.hdg - st.hdg0);
      st.turned = Math.sign(d) === wantSign ? d : 0;
      if (Math.sign(st.turned) === wantSign && Math.abs(st.turned) >= Math.abs(s.turn)) next(st, ev);
    } else {
      if (meets(s, f, st)) st.held += dt; else st.held = Math.max(0, st.held - dt * 2);
      if (st.held >= s.hold || (s.timeout && st.t > s.timeout)) next(st, ev);
    }
    return ev;
  }
  function next(st, ev) {
    ev.push({ type: 'step', step: current(st).id, index: st.i });
    st.i++; st.t = 0; st.held = 0; st.hdg0 = null; st.turned = 0; st.started = false;
    if (st.i >= STEPS.length) { st.done = true; ev.push({ type: 'done' }); }
  }

  const api = { STEPS, WORDS, create, update, view };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Tutorial = api;
})(typeof window !== 'undefined' ? window : null);
