/*
 * Cadence Cut - original procedural songs and chart generation.
 * Every song and chart here is generated from code: nothing is sampled or copied.
 * Charts are derived from each song's own section map (intensity per section), so the
 * densest patterns land in the drops and the breaks breathe.
 */
(function (global) {
  'use strict';
  const A = global.CadenceAudio;
  const MINOR = [0, 2, 3, 5, 7, 8, 10];

  // layer letters: k kick, h offbeat hats, H 16th hats, c clap, b bass, a arp, p pad, l lead,
  //                r riser (snare roll + sweep), d down-sweep, x crash on section start
  const SONGS = [
    {
      id: 'lantern', title: 'Lantern Drift', mood: 'Dusky, floating, half-lit', accent: '#ffb35c',
      bpm: 96, keyRoot: A.midi('D4'), scale: MINOR,
      prog: ['D3:m7', 'A#2:M7', 'F3:M', 'C3:sus2'],
      progB: ['G2:m7', 'A#2:M7', 'D3:m7', 'A2:m'],
      kick: [0, 7, 10], kickHot: [14], clap: [4, 12], openHats: false,
      bassSteps: [0, 3, 6, 10, 12], bassNotes: [0, 0, 12, 0, 7], bassLen: 2, bassCut: 520, bassWave: 'sawtooth',
      arpRate: 2, arpPattern: [0, 1, 2, 3, 4, 3, 2, 1], arpOct: 12, arpWave: 'triangle',
      leadWave: 'triangle', leadOct: 0,
      sections: [
        { name: 'Intro', bars: 4, layers: 'pa', intensity: 0 },
        { name: 'Verse', bars: 8, layers: 'khpab', intensity: 1 },
        { name: 'Rise', bars: 4, layers: 'khabr', intensity: 1 },
        { name: 'Glow', bars: 12, layers: 'xkhHcbapl', intensity: 2 },
        { name: 'Hush', bars: 4, layers: 'dpal', intensity: 0, alt: true },
        { name: 'Rise', bars: 4, layers: 'khabr', intensity: 1 },
        { name: 'Bloom', bars: 8, layers: 'xkhHcbapl', intensity: 3 },
        { name: 'Fade', bars: 4, layers: 'pa', intensity: 0 },
      ],
    },
    {
      id: 'copper', title: 'Copper Tide', mood: 'Warm, groovy, rolling', accent: '#ff7a59',
      bpm: 116, keyRoot: A.midi('E4'), scale: MINOR,
      prog: ['E3:m7', 'C3:M7', 'G3:M', 'D3:sus4'],
      progB: ['A2:m7', 'C3:M7', 'E3:m', 'D3:M'],
      kick: [0, 4, 8, 12], kickHot: [], clap: [4, 12], openHats: true,
      bassSteps: [2, 6, 10, 14], bassNotes: [0, 0, 0, 12], bassLen: 2, bassCut: 650, bassWave: 'sawtooth',
      arpRate: 1, arpPattern: [0, 2, 1, 3, 2, 4, 3, 5], arpOct: 12, arpWave: 'square',
      leadWave: 'sawtooth', leadOct: 0,
      sections: [
        { name: 'Intro', bars: 4, layers: 'ha', intensity: 0 },
        { name: 'Verse', bars: 8, layers: 'khbap', intensity: 1 },
        { name: 'Rise', bars: 4, layers: 'khbar', intensity: 1 },
        { name: 'Swell', bars: 16, layers: 'xkhHcbapl', intensity: 2 },
        { name: 'Shore', bars: 8, layers: 'dpal', intensity: 0, alt: true },
        { name: 'Rise', bars: 4, layers: 'kbar', intensity: 1 },
        { name: 'Undertow', bars: 12, layers: 'xkhHcbapl', intensity: 3 },
        { name: 'Ebb', bars: 2, layers: 'pa', intensity: 0 },
      ],
    },
    {
      id: 'ion', title: 'Ion Runner', mood: 'Fast, bright, relentless', accent: '#7cf7d4',
      bpm: 140, keyRoot: A.midi('A4'), scale: MINOR,
      prog: ['A2:m', 'F2:M', 'C3:M', 'G2:M'],
      progB: ['F2:M7', 'G2:M', 'A2:m7', 'A2:m'],
      kick: [0, 4, 8, 12], kickHot: [], clap: [4, 12], openHats: false,
      bassSteps: [2, 3, 6, 7, 10, 11, 14, 15], bassNotes: [0, 0, 0, 12, 0, 0, 0, 12], bassLen: 1, bassCut: 800, bassWave: 'sawtooth',
      arpRate: 1, arpPattern: [0, 1, 2, 4, 2, 1, 3, 5], arpOct: 12, arpWave: 'sawtooth',
      leadWave: 'square', leadOct: -12,
      sections: [
        { name: 'Ignition', bars: 8, layers: 'ka', intensity: 0 },
        { name: 'Cruise', bars: 8, layers: 'khHba', intensity: 1 },
        { name: 'Charge', bars: 8, layers: 'khbar', intensity: 1 },
        { name: 'Overdrive', bars: 16, layers: 'xkhHcbapl', intensity: 2 },
        { name: 'Coast', bars: 8, layers: 'dpal', intensity: 0, alt: true },
        { name: 'Charge', bars: 4, layers: 'khbar', intensity: 1 },
        { name: 'Redline', bars: 16, layers: 'xkhHcbapl', intensity: 3 },
        { name: 'Cooldown', bars: 2, layers: 'p', intensity: 0 },
      ],
    },
  ];
  SONGS.forEach(A.prepareSong);
  SONGS.forEach(s => s.sections.forEach(sec => { sec.rest = /^(Fade|Ebb|Cooldown)$/.test(sec.name); }));

  // ---------- real music: sections and beat grid come from tools/analyze.py (tracks.js) ----------
  const FILE_SONGS = [
    { id: 'rush', file: 'the-rush.ogg', title: 'The Rush', artist: 'tebruno99', license: 'CC0', mood: 'Driving, bright, big hooks', accent: '#ffd166' },
    { id: 'evasion', file: 'evasion.ogg', title: 'Evasion', artist: 'Matthew Pablo', license: 'CC-BY 3.0', mood: 'A long fuse, then two huge drops', accent: '#5cc8ff' },
    { id: 'thrust', file: 'thrust-sequence.ogg', title: 'Thrust Sequence', artist: 'Matthew Pablo', license: 'CC-BY 3.0', mood: 'Cinematic, pounding', accent: '#ff5c8a' },
    { id: 'race', file: 'winning-the-race.ogg', title: 'Winning the Race', artist: 'section31', license: 'CC0', mood: 'Fast and non-stop', accent: '#9dff6a' },
    { id: 'waves', file: 'darker-waves.ogg', title: 'Darker Waves', artist: 'Zander Noriega', license: 'CC-BY 3.0', mood: 'Dark, heavy, relentless', accent: '#b07cff' },
  ];
  const SEC_NAMES = ['Breather', 'Groove', 'Lift', 'Drop'];
  // a flat track (no loud/quiet contrast) still gets a shape: warm up, climb, peak, breathe
  const FLAT_SHAPE = [1, 1, 2, 2, 3, 3, 0, 2, 3, 3, 1, 3];

  function fileSong(def, data) {
    const s = Object.assign({}, def, { bpm: data.bpm, offset: data.offset, onsets: data.onsets, file: 'assets/music/' + def.file });
    const loud = data.bars;
    let last = loud.length - 1;
    while (last > 0 && loud[last] < 0.15) last--;
    const bars = last + 1;
    // 4-bar phrases scored by loudness and onset density
    const P = [];
    for (let b = 0; b < bars; b += 4) {
      const n = Math.min(4, bars - b);
      let l = 0, d = 0;
      for (let i = b; i < b + n; i++) { l += loud[i]; for (let k = 0; k < 16; k++) d += +data.onsets[i][k] >= 4 ? 1 : 0; }
      P.push({ start: b, bars: n, loud: l / n, dens: d / n });
    }
    const rel = (arr, key) => {
      const v = arr.map(p => p[key]), lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
      return { lo, hi, f: x => hi - lo < 1e-6 ? 0.5 : (x - lo) / (hi - lo) };
    };
    const RL = rel(P, 'loud'), RD = rel(P, 'dens');
    const flat = RL.hi - RL.lo < 0.25;
    P.forEach((p, i) => {
      const v = 0.7 * RL.f(p.loud) + 0.3 * RD.f(p.dens);
      p.intensity = flat ? FLAT_SHAPE[i % FLAT_SHAPE.length] : v < 0.3 ? 0 : v < 0.58 ? 1 : v < 0.82 ? 2 : 3;
    });
    P[0].intensity = Math.min(P[0].intensity, 1);
    if (P.length > 1 && P[P.length - 1].bars < 4) P[P.length - 1].intensity = Math.min(P[P.length - 1].intensity, 1);
    // merge equal neighbours into sections
    const sections = [];
    P.forEach(p => {
      const prev = sections[sections.length - 1];
      if (prev && prev.intensity === p.intensity) prev.bars += p.bars;
      else sections.push({ name: SEC_NAMES[p.intensity], bars: p.bars, intensity: p.intensity });
    });
    if (sections[0].intensity <= 1) sections[0].name = 'Intro';
    const tail = loud.length - bars;
    if (tail > 0) sections.push({ name: 'Outro', bars: tail, intensity: 0, rest: true });
    const barSections = [];
    sections.forEach(sec => {
      sec.start = barSections.length;
      sec.layerSet = { k: sec.intensity >= 1 && !sec.rest };
      for (let i = 0; i < sec.bars; i++) barSections.push(sec);
    });
    s.sections = sections; s.barSections = barSections; s.totalBars = barSections.length;
    s.beatDur = 60 / s.bpm; s.stepDur = s.beatDur / 4;
    s.duration = Math.min(data.duration - data.offset, s.totalBars * 4 * s.beatDur);
    s._prepared = true;
    return s;
  }
  const TR = global.CadenceTracks;
  if (TR) {
    const procedural = SONGS.splice(0);
    const files = FILE_SONGS.filter(d => TR[d.file]).map(d => fileSong(d, TR[d.file]));
    // order roughly by tempo/energy so the list reads as a climb
    const byId = {}; procedural.concat(files).forEach(s => { byId[s.id] = s; });
    ['lantern', 'rush', 'copper', 'evasion', 'thrust', 'ion', 'race', 'waves'].forEach(id => { if (byId[id]) SONGS.push(byId[id]); });
  }

  // ---------- cut directions ----------
  const S = Math.SQRT1_2;
  const DIRS = [
    { x: 0, y: 1, name: 'up' }, { x: 0, y: -1, name: 'down' }, { x: -1, y: 0, name: 'left' }, { x: 1, y: 0, name: 'right' },
    { x: -S, y: S, name: 'up-left' }, { x: S, y: S, name: 'up-right' }, { x: -S, y: -S, name: 'down-left' }, { x: S, y: -S, name: 'down-right' },
  ];
  const OPP = [1, 0, 3, 2, 7, 6, 5, 4];
  const FAMILY = ['up', 'down', 'left', 'right', 'up', 'up', 'down', 'down'];

  const DIFFS = {
    easy: {
      label: 'Easy', speed: 8.5, minGap: 0.8, diag: 0.12, dot: 0.35, horiz: 0, chainLen: 3,
      rhythms: [[[], [0]], [[0], [0, 2]], [[0, 2]], [[0, 2], [0, 1, 2]]],
    },
    normal: {
      label: 'Normal', speed: 10.5, minGap: 0.38, diag: 0.3, dot: 0.12, horiz: 0.12, chainLen: 4,
      rhythms: [[[0], [0, 2]], [[0, 2], [0, 1, 2]], [[0, 1, 2, 3], [0, 1, 2]], [[0, 1, 2, 3], [0, 1, 2, 2.5, 3]]],
    },
    hard: {
      label: 'Hard', speed: 12.5, minGap: 0.2, diag: 0.45, dot: 0.04, horiz: 0.18, chainLen: 5,
      rhythms: [[[0, 2], [0, 1, 2]], [[0, 1, 2, 3], [0, 1, 2, 2.5, 3]],
        [[0, 1, 1.5, 2, 3], [0, 1, 2, 3, 3.5], [0, 0.5, 1, 2, 3]],
        [[0, 0.5, 1, 1.5, 2, 3], [0, 1, 1.5, 2, 2.5, 3], [0, 0.5, 1, 2, 2.5, 3]]],
    },
  };
  const FEATURES_ALL = { heavy: true, bombs: true, arcs: true, walls: true, chains: true };
  const defaultFeatures = d => d === 'easy' ? { heavy: true, bombs: false, arcs: true, walls: false, chains: false } : FEATURES_ALL;

  function weighted(r, pairs) {
    let x = r(), acc = 0;
    for (let i = 0; i < pairs.length; i++) { acc += pairs[i][1]; if (x < acc) return pairs[i][0]; }
    return pairs[pairs.length - 1][0];
  }

  // Phrase flavours: what a 4-bar phrase is "about". Weighted per intensity, filtered by features.
  const FLAVOURS = {
    0: [['sparse', 1], ['arcs', 2]],
    1: [['flow', 2], ['chains', 1.4], ['walls', 1.2], ['heavy', 1], ['arcs', 1]],
    2: [['flow', 1.5], ['chains', 1.2], ['walls', 1.2], ['mines', 1.4], ['heavy', 1], ['stream', 1]],
    3: [['stream', 1.6], ['mines', 1.3], ['heavy', 1.3], ['chains', 1], ['walls', 1], ['flow', 0.8]],
  };
  const NEEDS = { arcs: 'arcs', chains: 'chains', walls: 'walls', heavy: 'heavy', mines: 'bombs' };

  function pickFlavour(r, intensity, feats, prev, diffKey) {
    let opts = FLAVOURS[intensity].filter(o => !NEEDS[o[0]] || feats[NEEDS[o[0]]]);
    if (diffKey === 'easy') opts = opts.filter(o => o[0] !== 'stream');
    const fresh = opts.filter(o => o[0] !== prev);
    if (fresh.length) opts = fresh;
    if (!opts.length) return intensity === 0 ? 'sparse' : 'flow';
    const tot = opts.reduce((a, o) => a + o[1], 0);
    return weighted(r, opts.map(o => [o[0], o[1] / tot]));
  }

  /** Mean onset strength (0..9) of a rhythm pattern within a bar, for file songs. */
  function onsetFit(song, bar, pattern) {
    if (!song.onsets || !pattern.length) return 0;
    const row = song.onsets[bar];
    if (!row) return 0;
    return pattern.reduce((a, p) => a + +row[Math.round(p * 4) % 16], 0) / pattern.length;
  }

  /**
   * Chart for (song, difficulty). opts.features picks the mechanics (default: by difficulty).
   * Returns { notes (blocks to cut, sorted), extras (mines, walls, arcs, chain links), phrases, ... }.
   */
  function buildChart(song, diffKey, opts) {
    opts = opts || {};
    const feats = Object.assign({}, opts.features || defaultFeatures(diffKey));
    const D = DIFFS[diffKey];
    const r = A.rng(A.hash(song.id + ':' + diffKey + ':chart'));
    const rx = A.rng(A.hash(song.id + ':' + diffKey + ':extras:' + Object.keys(feats).filter(k => feats[k]).join('')));
    const notes = [], extras = [], phrases = [];
    const st = { family: null, dir: -1, lane: 1, row: 1, t: -99, allowed: null };
    const barDur = 4 * song.beatDur;
    let prevFlavour = null, wallSide = rx() < 0.5 ? 0 : 2, enter = 0;
    let wall = null;

    for (let bar = 0; bar < song.totalBars; bar++) {
      const sec = song.barSections[bar];
      const inSec = bar - sec.start;
      if (inSec % 4 === 0) {
        // new phrase
        const flavour = sec.rest ? 'rest' : pickFlavour(rx, sec.intensity, feats, prevFlavour, diffKey);
        if (!sec.rest) prevFlavour = flavour;
        enter = flavour === 'rest' ? 0 : (enter + 1 + Math.floor(rx() * 3)) % 4;
        phrases.push({ bar, flavour, intensity: sec.intensity, enter });
        wall = null;
        const left = Math.min(4, sec.bars - inSec);
        if (flavour === 'walls' && left >= 3) {
          const nb = 2 * barDur <= 4.2 ? 2 : 1;
          wall = { type: 'wall', t0: (bar + 1) * barDur, t1: (bar + 1 + nb) * barDur, lanes: wallSide === 0 ? [0, 1] : [2, 3] };
          if (wall.t0 >= 3.5) extras.push(wall); else wall = null;
          wallSide = 2 - wallSide;
        }
      }
      const ph = phrases[phrases.length - 1];
      if (sec.rest) continue;
      const next = song.barSections[sec.start + sec.bars];
      const buildUp = next && !next.rest && next.intensity > sec.intensity && inSec >= sec.bars - 2;
      let level = sec.intensity;
      const phraseEnd = inSec === sec.bars - 1 || inSec % 8 === 7;
      if (buildUp) level = Math.min(3, level + (inSec === sec.bars - 1 ? 1 : 0));
      else if (phraseEnd) level = Math.max(0, level - 1);
      if (ph.flavour === 'stream') level = Math.min(3, level + 1);
      if (ph.flavour === 'sparse' || ph.flavour === 'arcs') level = 0;
      if (ph.flavour === 'heavy' || ph.flavour === 'chains') level = Math.max(0, level - 1);
      const optsR = D.rhythms[level];
      let pattern;
      if (song.onsets && !(phraseEnd && !buildUp)) {
        // real track: prefer the rhythm that lands on what the music is doing in this bar
        const scored = optsR.map(p => [p, onsetFit(song, bar, p) + r() * 0.5]);
        scored.sort((a, b) => b[1] - a[1]);
        pattern = scored[0][0];
      } else pattern = phraseEnd && !buildUp ? optsR[0] : optsR[Math.floor(r() * optsR.length)];
      const drop = inSec === 0 && sec.intensity >= 2 && bar > 0 && song.barSections[bar - 1].intensity < sec.intensity;

      for (let i = 0; i < pattern.length; i++) {
        let beat = bar * 4 + pattern[i];
        // real track: slide a hit half a beat onto a clearly stronger onset (never the downbeat)
        if (song.onsets && pattern[i] !== 0) {
          const row = song.onsets[bar], at = p => +row[Math.round(p * 4)] || 0;
          let best = pattern[i], bv = at(best);
          [pattern[i] - 0.5, pattern[i] + 0.5].forEach(p => {
            if (p <= 0 || p >= 4 || pattern.indexOf(p) >= 0) return;
            if (p < (pattern[i - 1] || 0) || (i + 1 < pattern.length && p > pattern[i + 1])) return;
            if (at(p) >= bv + 2) { best = p; bv = at(p); }
          });
          beat = bar * 4 + best;
        }
        const time = beat * song.beatDur;
        if (beat < 4 || time < 3.0) continue;
        const gap = time - st.t;
        if (gap < D.minGap - 1e-6) continue;
        st.allowed = wall && time > wall.t0 - 0.3 && time < wall.t1 + 0.3 ? (wall.lanes[0] === 0 ? [2, 3] : [0, 1]) : null;
        const n = place(r, D, diffKey, gap, st, beat, time);
        n.enter = ph.enter;
        n._flavour = ph.flavour;
        n._downbeat = pattern[i] === 0;
        n._drop = drop && i === 0;
        notes.push(n);
      }
    }

    // ---- decorate: heavy blocks, chains, arcs, mines ----
    for (let i = 0; i < notes.length; i++) {
      const q = notes[i], prev = notes[i - 1], next = notes[i + 1];
      const gapIn = prev ? q.time - prev.time : 99, gapOut = next ? next.time - q.time : 99;
      const fl = q._flavour;
      if (feats.heavy && gapIn >= 0.45 && (q._drop || (fl === 'heavy' && q._downbeat))) q.kind = 'heavy';
      else if (feats.chains && fl === 'chains' && q.dir >= 0 && gapOut >= 0.55 && rx() < 0.6) {
        const d = DIRS[q.dir], k = Math.min(D.chainLen, Math.max(2, Math.floor((Math.min(gapOut, 0.6) - 0.2) / 0.07)));
        q.chain = k;
        for (let j = 1; j <= k; j++) {
          extras.push({
            type: 'link', head: q.time, time: q.time + j * 0.06,
            lane: Math.max(-0.4, Math.min(3.4, q.lane + d.x * 0.42 * j)), row: Math.max(-0.4, Math.min(2.4, q.row + d.y * 0.42 * j)),
          });
        }
      }
    }
    for (let i = 0; i < notes.length - 1; i++) {
      const a = notes[i], b = notes[i + 1], gap = b.time - a.time;
      const fl = a._flavour;
      if (feats.arcs && (fl === 'arcs' || fl === 'sparse') && !a.chain && gap >= 0.6 && gap <= 3.2 && rx() < 0.75) {
        extras.push({ type: 'arc', t0: a.time, t1: b.time, from: { lane: a.lane, row: a.row, dir: a.dir }, to: { lane: b.lane, row: b.row } });
        a.arc = true;
      }
      if (feats.bombs && (fl === 'mines' || (fl === 'stream' && rx() < 0.25)) && !a.chain && gap >= 0.5) {
        const mid = a.time + gap / 2;
        const free = [0, 1, 2, 3].filter(l => Math.abs(l - a.lane) >= 2 && Math.abs(l - b.lane) >= 2 &&
          notes.every(q => Math.abs(q.time - mid) >= 0.4 || Math.abs(q.lane - l) >= 2));
        if (!free.length) continue;
        const lane = free[Math.floor(rx() * free.length)];
        const rowA = Math.floor(rx() * 3);
        extras.push({ type: 'bomb', time: mid, lane, row: rowA });
        if (rx() < 0.45) extras.push({ type: 'bomb', time: mid, lane, row: (rowA + 1 + Math.floor(rx() * 2)) % 3 });
      }
    }
    notes.forEach(q => { delete q._flavour; delete q._downbeat; delete q._drop; });
    extras.sort((a, b) => (a.t0 !== undefined ? a.t0 : a.time) - (b.t0 !== undefined ? b.t0 : b.time));
    return { notes, extras, phrases, features: feats, speed: D.speed, diff: diffKey, label: D.label };
  }

  function place(r, D, diffKey, gap, st, beat, time) {
    const fast = gap < 0.3;
    const reset = st.family === null || gap > 2.4;
    let family;
    if (reset) {
      family = diffKey === 'easy' ? (r() < 0.75 ? 'down' : 'up') : weighted(r, [['down', 0.6], ['up', 0.2], ['left', 0.1], ['right', 0.1]]);
    } else if (!fast && D.horiz && r() < D.horiz) {
      const vertical = st.family === 'up' || st.family === 'down';
      family = vertical ? (r() < 0.5 ? 'left' : 'right') : (r() < 0.6 ? 'down' : 'up');
    } else {
      family = { up: 'down', down: 'up', left: 'right', right: 'left' }[st.family];
    }

    let dir;
    if (!reset && st.dir >= 4 && OPP[st.dir] !== undefined && FAMILY[OPP[st.dir]] === family && r() < 0.7) {
      dir = OPP[st.dir]; // mirror the previous diagonal so the swing simply reverses
    } else if (family === 'down') {
      dir = (!fast && r() < D.diag) ? (r() < 0.5 ? 6 : 7) : 1;
    } else if (family === 'up') {
      dir = (!fast && r() < D.diag) ? (r() < 0.5 ? 4 : 5) : 0;
    } else {
      dir = family === 'left' ? 2 : 3;
    }

    // Position: the blade travels the whole grid in phrases. A walker heads for a target lane
    // (outer lanes favoured), stepping one lane per note, sometimes two on slower notes; when it
    // arrives (or now and then) it picks a new target. Rows follow the swing so each cut starts
    // where the last one ended: a down cut sits high (the blade ends low), an up cut sits low.
    // While a wall covers one side, only the lanes on the open side are allowed.
    const allowed = st.allowed || [0, 1, 2, 3];
    const lo = allowed[0], hi = allowed[allowed.length - 1];
    if (st.target === undefined || st.lane === st.target || allowed.indexOf(st.target) < 0 || r() < 0.12) {
      let opts = [[0, 0.32], [1, 0.18], [2, 0.18], [3, 0.32]].filter(o => o[0] !== st.lane && allowed.indexOf(o[0]) >= 0);
      if (!opts.length) opts = allowed.map(l => [l, 1]);
      const tot = opts.reduce((a, o) => a + o[1], 0);
      st.target = weighted(r, opts.map(o => [o[0], o[1] / tot]));
    }
    let lane = Math.max(lo, Math.min(hi, st.lane)), row;
    const toward = Math.sign(st.target - lane), dist = Math.abs(st.target - lane);
    if (fast) { if (r() < 0.75) lane += toward; }
    else lane += toward * (dist >= 2 && r() < 0.55 ? 2 : 1);
    // side and diagonal cuts need room to follow through. A diagonal at an edge flips sideways
    // instead (down-left <-> down-right keeps the flow); pure side cuts step back in.
    lane = Math.max(lo, Math.min(hi, lane));
    const MIRROR = { 4: 5, 5: 4, 6: 7, 7: 6 };
    if (lane === 0 && (dir === 4 || dir === 6)) dir = MIRROR[dir];
    if (lane === 3 && (dir === 5 || dir === 7)) dir = MIRROR[dir];
    const leftward = dir === 2 || dir === 4 || dir === 6, rightward = dir === 3 || dir === 5 || dir === 7;
    if (leftward && lane < 1) lane = 1;
    if (rightward && lane > 2) lane = 2;
    lane = Math.max(lo, Math.min(hi, lane));

    if (family === 'down') row = diffKey === 'easy' ? weighted(r, [[2, 0.5], [1, 0.5]]) : weighted(r, [[2, 0.6], [1, 0.4]]);
    else if (family === 'up') row = diffKey === 'easy' ? weighted(r, [[0, 0.5], [1, 0.5]]) : weighted(r, [[0, 0.6], [1, 0.4]]);
    else row = weighted(r, [[1, 0.5], [0, 0.25], [2, 0.25]]);

    // don't park the next block exactly where the last one was (streams excepted)
    if (!fast && lane === st.lane && row === st.row) {
      if (lane !== st.target) lane += toward;
      else row = row === 1 ? (family === 'up' ? 0 : 2) : 1;
      if (leftward && lane < 1) lane = 1;
      if (rightward && lane > 2) lane = 2;
      lane = Math.max(lo, Math.min(hi, lane));
    }

    const isDot = r() < D.dot;
    st.family = family; st.dir = dir; st.lane = lane; st.row = row; st.t = time;
    return { beat, time, lane, row, dir: isDot ? -1 : dir };
  }

  global.CadenceSongs = { SONGS, DIFFS, DIRS, buildChart, defaultFeatures, FEATURES_ALL };
})(window);
