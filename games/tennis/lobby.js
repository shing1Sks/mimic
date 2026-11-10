/*
 * Sunvolley — the two-player join flow (shared Mimic contract): slots P1..Pn, a controller joins
 * by pressing A (Wand A / Grip Vol Down), B leaves (or, from a controller that has not joined,
 * goes back), and a joined player holding A starts once every slot is filled.
 * Pure logic, tested in Node: node games/tennis/test/lobby.test.js
 */
(function (root) {
  'use strict';
  const HOLD_TO_START = 0.8;   // s

  function createLobby(slots) { return { slots: new Array(slots || 2).fill(null), hold: 0 }; }

  /**
   * One frame. inputs: [{ id, kind, a (pressed this frame), b (pressed), aDown }] for every
   * controller that is present right now. Returns events: {type:'join'|'leave', slot, id},
   * {type:'back'} (B from someone not in the lobby), {type:'start'}.
   */
  function stepLobby(lb, inputs, dt) {
    const ev = [];
    const slotOf = id => lb.slots.findIndex(s => s && s.id === id);
    // a controller that went away leaves its slot
    lb.slots.forEach((s, i) => {
      if (s && !inputs.some(p => p.id === s.id)) { lb.slots[i] = null; ev.push({ type: 'leave', slot: i, id: s.id }); }
    });
    const fresh = new Set();
    for (const p of inputs) {
      const at = slotOf(p.id);
      if (at < 0 && p.a) {
        const free = lb.slots.indexOf(null);
        if (free >= 0) { lb.slots[free] = { id: p.id, kind: p.kind }; fresh.add(p.id); ev.push({ type: 'join', slot: free, id: p.id }); }
      } else if (at >= 0 && p.b) {
        lb.slots[at] = null; ev.push({ type: 'leave', slot: at, id: p.id });
      } else if (at < 0 && p.b) ev.push({ type: 'back' });
    }
    const full = lb.slots.every(Boolean);
    const holding = inputs.some(p => p.aDown && !fresh.has(p.id) && slotOf(p.id) >= 0);
    lb.hold = full && holding ? lb.hold + dt : 0;
    if (lb.hold >= HOLD_TO_START) { lb.hold = 0; ev.push({ type: 'start' }); }
    return ev;
  }

  const api = { createLobby, stepLobby, HOLD_TO_START };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.TN = root.TN || {}; root.TN.Lobby = api; }
})(typeof window !== 'undefined' ? window : null);
