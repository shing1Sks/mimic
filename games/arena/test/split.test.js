// Run: node games/arena/test/split.test.js
'use strict';
const assert = require('assert');
const S = require('../split.js');

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
function run(st, steps) { let ev = null; for (const [dev, act] of steps) ({ st, ev } = S.lobbyInput(st, dev, act)); return { st, ev }; }

const tests = {
  joinWithAOrStartUpToFour() {
    let { st, ev } = run(S.lobbyCreate('coop'), [['pad:0', 'join']]);
    assert.strictEqual(ev, 'join');
    ({ st } = run(st, [['pad:1', 'start'], ['kbm', 'join'], ['pad:2', 'join']]));
    assert.deepStrictEqual(st.slots.map(s => s.dev), ['pad:0', 'pad:1', 'kbm', 'pad:2']);
    const r = S.lobbyInput(st, 'pad:3', 'join');
    assert.strictEqual(r.ev, 'full');
    assert.strictEqual(r.st.slots.length, 4);
  },
  lobbyInputDoesNotMutate() {
    const st = S.lobbyCreate('coop');
    S.lobbyInput(st, 'pad:0', 'join');
    assert.strictEqual(st.slots.length, 0);
  },
  secondPressReadiesThenBUnreadiesThenLeaves() {
    let { st } = run(S.lobbyCreate('coop'), [['pad:0', 'join']]);
    let r = S.lobbyInput(st, 'pad:0', 'start'); assert.strictEqual(r.ev, 'ready'); assert.ok(r.st.slots[0].ready);
    r = S.lobbyInput(r.st, 'pad:0', 'back'); assert.strictEqual(r.ev, 'unready'); assert.ok(!r.st.slots[0].ready);
    r = S.lobbyInput(r.st, 'pad:0', 'back'); assert.strictEqual(r.ev, 'leave'); assert.strictEqual(r.st.slots.length, 0);
  },
  bFromStrangerLeavesLobbyOnlyWhenEmpty() {
    assert.strictEqual(S.lobbyInput(S.lobbyCreate('coop'), 'pad:3', 'back').ev, 'back');
    const { st } = run(S.lobbyCreate('coop'), [['pad:0', 'join']]);
    assert.strictEqual(S.lobbyInput(st, 'pad:3', 'back').ev, null);
  },
  versusBalancesTeamsAndLetsPlayersSwitch() {
    let { st } = run(S.lobbyCreate('versus'), [['pad:0', 'join'], ['pad:1', 'join'], ['pad:2', 'join']]);
    assert.deepStrictEqual(st.slots.map(s => s.team), [0, 1, 0]);
    ({ st } = run(st, [['pad:2', 'right']]));
    assert.strictEqual(st.slots[2].team, 1);
    // a ready player cannot switch
    ({ st } = run(st, [['pad:2', 'start'], ['pad:2', 'left']]));
    assert.strictEqual(st.slots[2].team, 1);
  },
  coopKeepsEveryoneOnWardens() {
    const { st } = run(S.lobbyCreate('coop'), [['pad:0', 'join'], ['pad:1', 'join'], ['pad:1', 'right']]);
    assert.deepStrictEqual(st.slots.map(s => s.team), [0, 0]);
  },
  modeSwitchResetsReadyAndSplitsTeams() {
    let { st } = run(S.lobbyCreate('coop'), [['pad:0', 'join'], ['pad:1', 'join'], ['pad:0', 'start']]);
    ({ st } = run(st, [['pad:1', 'mode']]));
    assert.strictEqual(st.mode, 'versus');
    assert.deepStrictEqual(st.slots.map(s => [s.team, s.ready]), [[0, false], [1, false]]);
  },
  startNeedsEveryoneReady() {
    let { st } = run(S.lobbyCreate('coop'), [['pad:0', 'join'], ['pad:1', 'join'], ['pad:0', 'start']]);
    assert.ok(!S.lobbyCanStart(st).ok);
    ({ st } = run(st, [['pad:1', 'join']]));
    assert.ok(S.lobbyCanStart(st).ok);
    assert.ok(!S.lobbyCanStart(S.lobbyCreate('coop')).ok);
  },
  versusWithoutBotsNeedsBothTeams() {
    let { st } = run(S.lobbyCreate('versus', false), [['pad:0', 'join'], ['pad:1', 'join'], ['pad:1', 'left'], ['pad:0', 'start'], ['pad:1', 'start']]);
    assert.ok(!S.lobbyCanStart(st).ok);
    ({ st } = run(st, [['pad:1', 'back'], ['pad:1', 'right'], ['pad:1', 'start']]));
    assert.ok(S.lobbyCanStart(st).ok);
  },
  teamPlanFillsToFive() {
    let { st } = run(S.lobbyCreate('coop'), [['pad:0', 'join'], ['pad:1', 'join']]);
    assert.deepStrictEqual(S.teamPlan(st).bots, [3, 5]);
    assert.deepStrictEqual(S.teamPlan(Object.assign({}, st, { fill: false })).bots, [0, 5]);
    ({ st } = run(S.lobbyCreate('versus'), [['pad:0', 'join'], ['pad:1', 'join'], ['pad:2', 'join']]));
    const p = S.teamPlan(st);
    assert.deepStrictEqual(p.bots, [3, 4]);
    assert.deepStrictEqual(p.humans.map(h => [h.slot, h.team]), [[0, 0], [1, 1], [2, 0]]);
    assert.deepStrictEqual(S.teamPlan(Object.assign({}, st, { fill: false })).bots, [0, 0]);
  },
  droppedPadLeavesItsSlot() {
    const { st } = run(S.lobbyCreate('coop'), [['pad:0', 'join'], ['pad:1', 'join']]);
    assert.deepStrictEqual(S.lobbyDrop(st, 'pad:0').slots.map(s => s.dev), ['pad:1']);
  },
  layoutsTileTheScreen() {
    for (const [n, two] of [[1], [2, 'h'], [2, 'v'], [3], [4]]) {
      const v = S.layoutViews(n, 1600, 900, two);
      assert.strictEqual(v.length, n);
      const area = v.reduce((s, r) => s + r.w * r.h, 0) + (S.spareRect(n, 1600, 900) ? 800 * 450 : 0);
      assert.strictEqual(area, 1600 * 900, `n=${n} ${two || ''}`);
    }
    assert.deepStrictEqual(S.layoutViews(2, 1600, 900, 'h')[1], { x: 0, y: 450, w: 1600, h: 450 });
    assert.deepStrictEqual(S.layoutViews(2, 1600, 900, 'v')[1], { x: 800, y: 0, w: 800, h: 900 });
    assert.deepStrictEqual(S.layoutViews(4, 1600, 900)[3], { x: 800, y: 450, w: 800, h: 450 });
  },
  hudScaleStaysReadable() {
    near(S.hudScale({ w: 1600, h: 900 }), 1);
    near(S.hudScale({ w: 800, h: 450 }), 0.7);
    near(S.hudScale({ w: 1600, h: 450 }), 0.7);
    near(S.hudScale({ w: 1920, h: 540 }), 0.75);
  },
  fovKeepsHorizontalOnNormalScreensAndWidensStackedViews() {
    // 16:9 at 90 horizontal is the usual 58.7 vertical
    near(S.verticalFov(90, 16 / 9), 58.72, 0.05);
    // a 32:9 strip would be 31.6 deg tall from 90 horizontal; it is opened up but held under 115 horizontal
    const v = S.verticalFov(90, 32 / 9);
    assert.ok(v > 40 && v < 58.72, String(v));
    const h = 2 * Math.atan(Math.tan(v * Math.PI / 360) * 32 / 9) * 180 / Math.PI;
    near(h, 115, 0.05);
    // narrower than 16:9 is untouched
    near(S.verticalFov(90, 1), 90, 0.05);
  },
  panLeansTowardTheViewport() {
    near(S.viewPan({ x: 0, w: 1600 }, 1600), 0);
    near(S.viewPan({ x: 0, w: 800 }, 1600), -0.5);
    near(S.viewPan({ x: 800, w: 800 }, 1600), 0.5);
    near(S.mixPan(0, 0), 0);
    near(S.mixPan(0.5, 0), 0.5);
    near(S.mixPan(0, -0.5), -0.3);
    assert.ok(S.mixPan(1, 0.5) <= 1 && S.mixPan(-1, -1) >= -1);
    assert.ok(S.mixPan(-1, 0.5) < 0, 'a sound hard left stays left even in the right-hand view');
  },
  nearestListenerPicksClosest() {
    assert.strictEqual(S.nearestListener([{ x: 0, z: 0 }, { x: 10, z: 0 }], 8, 1), 1);
    assert.strictEqual(S.nearestListener([], 0, 0), -1);
  },
  qualityStepsDownWithMorePlayers() {
    const q = [1, 2, 3, 4].map(S.qualityFor);
    assert.ok(q[0].scale >= q[1].scale && q[1].scale >= q[3].scale);
    assert.ok(q.every(x => x.minScale >= 0.75 && x.minScale <= x.scale), 'resolution never drops to a blur');
    assert.deepStrictEqual([1, 2, 4].map(S.fpsTarget), [50, 45, 30]);
  },
  adaptiveScaleDropsAndRecovers() {
    near(S.adaptScale(1, 30, 45, 0.5, 1), 0.9);
    near(S.adaptScale(0.5, 20, 45, 0.5, 1), 0.5);
    near(S.adaptScale(0.8, 70, 45, 0.5, 1), 0.85);
    near(S.adaptScale(1, 70, 45, 0.5, 1), 1);
    near(S.adaptScale(0.8, 48, 45, 0.5, 1), 0.8);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message); }
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
