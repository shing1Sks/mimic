// The contract between world.js (builds these places) and missions.js (uses them). Every name
// here must exist in the object DH.World.build() returns for that mission. Distances are guides.
// Species ids used by missions and dinos.js: raptor, dilo, trike, ptero, rex, grazer.
(function (root) {
  'use strict';
  const LAYOUT = {
    gate3: {
      title: 'Gate 3', blurb: 'The visitor gate. Get your eye in.',
      stands: [{ name: 'gate', desc: 'on the gatehouse platform, 2.5 m up, looking down a jungle road that runs ~90 m into the trees', arc: 1.1 }],
      rails: [],
      spawns: {
        road: 'far end of the road, 70-90 m out, a path running toward the gate',
        leftBrush: 'dense ferns 15-35 m out on the left, a short path to the gate',
        rightBrush: 'dense ferns 15-35 m out on the right, a short path to the gate',
        targets: '6 spots 15-60 m out along the road edges for practice targets (posts, signs)',
      },
      points: {},
    },
    overwatch: {
      title: 'Overwatch', blurb: 'A ranger tower over the valley. One shot each.',
      stands: [{ name: 'tower', desc: 'top of a ranger watchtower, ~14 m up, overlooking an open valley', arc: 0.9 }],
      rails: [],
      spawns: {
        herd: 'a grazing area 110-170 m out in the valley floor (8-12 grazers wander here)',
        stalkA: 'a path from the left tree line, through tall grass, toward the survivors',
        stalkB: 'a path from the far tree line through the herd toward the survivors',
        stalkC: 'a path from the right rocks toward the survivors',
      },
      points: { survivors: 'a crashed jeep with a flare, ~70 m out, left of centre, where the stalk paths end' },
    },
    pens: {
      title: 'The Pens', blurb: 'Jeep run through the raptor paddocks.',
      stands: [
        { name: 'pens1', desc: 'jeep stopped at a broken paddock gate', arc: 1.4 },
        { name: 'pens2', desc: 'jeep stopped on a bridge over a river (pterosaurs come over the water)', arc: 1.5 },
        { name: 'pens3', desc: 'jeep stopped at the feeding station, buildings on both sides', arc: 1.5 },
      ],
      rails: [
        { name: 'drive1', from: 'pens1', to: 'pens2', desc: 'dirt road through paddocks, ~120 m' },
        { name: 'drive2', from: 'pens2', to: 'pens3', desc: 'road climbing from the river, ~110 m' },
      ],
      spawns: {
        pens1Left: 'paddock interior left, 20-40 m', pens1Right: 'paddock interior right, 20-40 m', pens1Front: 'road ahead, 40-60 m',
        river: 'flight paths high over the river, upstream and downstream (pterosaurs)', pens2Banks: 'river banks 20-40 m either side',
        pens3Left: 'between buildings on the left', pens3Right: 'between buildings on the right', pens3Roof: 'a roof edge 15 m out (leap attack)',
      },
      points: {},
    },
    horn: {
      title: 'Horn and Plate', blurb: 'Open ground. Something big is coming.',
      stands: [{ name: 'field', desc: 'behind a waist-high concrete barrier on a gentle rise, open field ahead', arc: 1.2 }],
      rails: [],
      spawns: {
        laneA: 'charge lane from 120 m out straight at the stand', laneB: 'charge lane from 110 m out, left, angling in',
        laneC: 'charge lane from 110 m out, right, angling in', flankLeft: 'scrub 30-50 m left', flankRight: 'scrub 30-50 m right',
      },
      points: {},
    },
    apex: {
      title: 'Apex', blurb: 'The visitor centre. It knows you are here.',
      stands: [{ name: 'plaza', desc: 'top of the visitor centre steps at dusk, the plaza and main gate below', arc: 1.3 }],
      rails: [],
      spawns: {
        rexEntry: 'through the smashed main gate, 70 m out', rexCircle: 'a loop around the plaza 30-50 m from the stand',
        rexCharge: 'a straight line from the plaza centre to the steps', balcony: 'a broken balcony on the right, 20 m (raptors)',
      },
      points: {},
    },
  };
  const ORDER = ['gate3', 'overwatch', 'pens', 'horn', 'apex'];
  const api = { LAYOUT, ORDER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.DH = root.DH || {}; root.DH.Layout = api; }
})(typeof window !== 'undefined' ? window : this);
