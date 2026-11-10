/*
 * Tidecast - party join flow (shared Mimic contract): slots P1..P4, a controller joins by pressing
 * A (Wand A / Grip Vol Down), B leaves (or, from a controller that has not joined, goes back),
 * and any joined player holding A starts once at least `min` slots are filled. The press that
 * joins never counts toward the start: A has to be let go once after joining.
 * Pure logic, tested in Node: node games/fishing/test/lobby.test.js
 */
(function (root) {
  'use strict';
  const HOLD_TO_START = 0.8;   // s

  function createLobby(slots, min) { return { slots: new Array(slots || 4).fill(null), hold: 0, min: min || 1 }; }

  /**
   * One frame. inputs: [{ id, kind, a (pressed this frame), b (pressed), aDown }] for every
   * controller present now. Returns events: {type:'join'|'leave', slot, id}, {type:'back'}, {type:'start'}.
   */
  function stepLobby(lb, inputs, dt) {
    const ev = [];
    const slotOf = id => lb.slots.findIndex(s => s && s.id === id);
    lb.slots.forEach((s, i) => {
      if (s && !inputs.some(p => p.id === s.id)) { lb.slots[i] = null; ev.push({ type: 'leave', slot: i, id: s.id }); }
    });
    for (const p of inputs) {
      const at = slotOf(p.id);
      if (at < 0 && p.a) {
        const free = lb.slots.indexOf(null);
        if (free >= 0) { lb.slots[free] = { id: p.id, kind: p.kind, armed: false }; ev.push({ type: 'join', slot: free, id: p.id }); }
      } else if (at >= 0 && p.b) {
        lb.slots[at] = null; ev.push({ type: 'leave', slot: at, id: p.id });
      } else if (at < 0 && p.b) ev.push({ type: 'back' });
    }
    let holding = false;
    for (const p of inputs) {
      const s = lb.slots[slotOf(p.id)];
      if (!s) continue;
      if (!p.aDown) s.armed = true;
      else if (s.armed) holding = true;
    }
    const n = lb.slots.filter(Boolean).length;
    lb.hold = n >= lb.min && holding ? lb.hold + dt : 0;
    if (lb.hold >= HOLD_TO_START) { lb.hold = 0; ev.push({ type: 'start' }); }
    return ev;
  }

  const api = { createLobby, stepLobby, HOLD_TO_START };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TideLobby = api;
})(typeof window !== 'undefined' ? window : this);
