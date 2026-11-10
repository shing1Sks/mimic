/*
 * Cadence Cut - pure game rules: cut scoring, grades, stars, campaign unlocks, modifiers.
 * No DOM, no three.js. Classic script (window.CadenceLogic) and Node module.
 */
(function (root) {
  'use strict';
  const clamp01 = v => Math.max(0, Math.min(1, v));

  const MIN_SPEED = 2.0;     // blade-tip screen speed needed to cut at all
  const FAST_SPEED = 9.0;    // full speed points from here
  const HEAVY_SPEED = 5.5;   // a heavy block needs at least this

  /**
   * One cut's raw score, 0..100.
   *   dirErr  0..1  angle error as a fraction of the allowed tolerance
   *   centre  0..1+ how far off the block's centre the cut plane passed (1 = edge)
   *   arc     radians of continuous swing leading into the cut (fullness)
   *   speed   blade-tip speed at contact
   */
  function scoreCut(c) {
    const dir = 35 * (1 - 0.45 * clamp01(c.dirErr));
    const centre = 25 * clamp01(1 - c.centre);
    const full = 20 * clamp01((c.arc - 0.12) / 0.6);
    const speed = 20 * clamp01((c.speed - MIN_SPEED) / (FAST_SPEED - MIN_SPEED));
    return { raw: Math.round(dir + centre + full + speed), dir, centre, full, speed };
  }
  const heavyOk = speed => speed >= HEAVY_SPEED;
  const cutWord = raw => raw >= 92 ? 'FLAWLESS' : raw >= 80 ? 'SHARP' : raw >= 62 ? 'CLEAN' : 'OK';

  function grade(acc, failed) {
    if (failed) return 'FAILED';
    return acc >= 0.9 ? 'S' : acc >= 0.8 ? 'A' : acc >= 0.65 ? 'B' : acc >= 0.5 ? 'C' : 'D';
  }
  function stars(acc, failed, mods) {
    if (failed) return 0;
    if (mods && mods.indexOf('nofail') >= 0) return 1;
    return acc >= 0.92 ? 3 : acc >= 0.8 ? 2 : 1;
  }

  const MULT_STEPS = [6, 12, 20];
  function multStep(m, good) {
    if (!good) return { mult: 1, prog: 0 };
    let mult = m.mult, prog = m.prog + 1;
    if (mult < 4 && prog >= MULT_STEPS[mult - 1]) { mult++; prog = 0; }
    return { mult, prog };
  }
  const surgeGain = raw => raw >= 90 ? 0.09 : raw >= 80 ? 0.06 : raw >= 70 ? 0.03 : 0;
  const SURGE_TIME = 10;

  const MODS = {
    swift: { label: 'Swift', desc: 'Blocks fly 30% faster', speed: 1.3, score: 1.15, needStars: 4 },
    vanish: { label: 'Vanish', desc: 'Blocks fade out before they reach you', score: 1.1, needStars: 9 },
    nofail: { label: 'No Fail', desc: 'Charge never runs out (half score)', score: 0.5, needStars: 0 },
  };
  const modMultiplier = list => (list || []).reduce((a, k) => a * (MODS[k] ? MODS[k].score : 1), 1);
  const modUnlocked = (key, total) => !!MODS[key] && total >= MODS[key].needStars;

  const F = (o) => Object.assign({ heavy: false, bombs: false, arcs: false, walls: false, chains: false }, o || {});
  const ALLF = F({ heavy: true, bombs: true, arcs: true, walls: true, chains: true });
  /** Each early stage brings in one new thing; later stages mix everything on harder charts. */
  const CAMPAIGN = [
    { id: 's1', title: 'First Light', song: 'lantern', diff: 'easy', features: F(), intro: 'Cut each block the way its arrow points. A dot cuts any way.' },
    { id: 's2', title: 'Heavy Hands', song: 'rush', diff: 'easy', features: F({ heavy: true }), intro: 'New: crystal blocks. Swing hard and fast or the blade bounces off.' },
    { id: 's3', title: 'Minefield', song: 'copper', diff: 'normal', features: F({ heavy: true, bombs: true }), intro: 'New: red mines. Do not touch them with the blade.' },
    { id: 's4', title: 'Tracer', song: 'evasion', diff: 'normal', features: F({ heavy: true, bombs: true, arcs: true }), intro: 'New: arcs. After the cut, keep the blade tip on the glowing bead.' },
    { id: 's5', title: 'Glass Walls', song: 'thrust', diff: 'normal', features: F({ heavy: true, bombs: true, arcs: true, walls: true }), intro: 'New: walls. Lean and aim the blade away from the glass.' },
    { id: 's6', title: 'Chain Reaction', song: 'ion', diff: 'normal', features: ALLF, intro: 'New: chains. One long sweep through the head and every link.' },
    { id: 's7', title: 'Finish Line', song: 'race', diff: 'normal', features: ALLF, intro: 'Everything at once. Keep the combo for a Surge.' },
    { id: 's8', title: 'Undercurrent', song: 'waves', diff: 'normal', features: ALLF, intro: 'Fast and dark. Breathe on the quiet bars.' },
    { id: 's9', title: 'Full Rush', song: 'rush', diff: 'hard', features: ALLF, intro: 'Hard charts from here on.' },
    { id: 's10', title: 'Escape Velocity', song: 'evasion', diff: 'hard', features: ALLF, intro: 'Two drops. Save your swing for them.' },
    { id: 's11', title: 'Afterburner', song: 'thrust', diff: 'hard', features: ALLF, intro: 'Walls and streams.' },
    { id: 's12', title: 'Redline', song: 'waves', diff: 'hard', features: ALLF, intro: 'The last stage. Go fast.' },
  ];
  const totalStars = map => Object.keys(map || {}).reduce((a, k) => a + (map[k] | 0), 0);
  const stageUnlocked = (i, map) => i === 0 || ((map || {})[CAMPAIGN[i - 1].id] | 0) >= 1;
  /** Free-play feature set by difficulty. */
  const freeFeatures = diff => diff === 'easy' ? F({ heavy: true, arcs: true }) : ALLF;

  const api = {
    MIN_SPEED, FAST_SPEED, HEAVY_SPEED, MULT_STEPS, SURGE_TIME, MODS, CAMPAIGN,
    scoreCut, heavyOk, cutWord, grade, stars, multStep, surgeGain, modMultiplier, modUnlocked,
    totalStars, stageUnlocked, freeFeatures,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CadenceLogic = api;
})(typeof window !== 'undefined' ? window : this);
