/*
 * Willowlight - the two-seat lobby (the shared Mimic join flow, as Sunvolley): a phone joins by
 * pressing HOLD (Grip Vol Down / browser HOLD / Wand A), B leaves (or, from a phone that has not
 * joined, goes back), SWITCH (Vol Up double tap) from a seated player swaps who bats first, and
 * a seated player holding HOLD starts once both seats are filled.
 * Pure logic (node games/cricket/test/lobby.test.js).
 */
(function (root) {
  'use strict';
  const HOLD_TO_START = 0.8;   // s

  function createLobby(slots) { return { slots: new Array(slots || 2).fill(null), hold: 0, firstBat: 0 }; }

  /**
   * One frame. inputs: [{ id, kind, a (pressed this frame), b (pressed), one (pressed), aDown }]
   * for every controller present right now. Returns events: {type:'join'|'leave', slot, id},
   * {type:'back'}, {type:'swap', firstBat}, {type:'start'}.
   */
  function stepLobby(lb, inputs, dt) {
    const ev = [];
    const slotOf = id => lb.slots.findIndex(s => s && s.id === id);
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
      } else if (at >= 0 && p.one) {
        lb.firstBat = 1 - lb.firstBat; ev.push({ type: 'swap', firstBat: lb.firstBat });
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
  if (root) { root.CK = root.CK || {}; root.CK.Lobby = api; }
})(typeof window !== 'undefined' ? window : null);
