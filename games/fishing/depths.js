/*
 * Tidecast: Depths - the rules under the surface. Zones by depth, the deep species (who lives
 * where, who eats whom, what they are worth), steering the lure with the rod's tilt, fish that
 * school / hunt / take the bait / eat what you have hooked, snagging in cover, the tackle-box
 * economy and the save file. Pure functions, tested in Node: node games/fishing/test/depths.test.js
 * World frame = three.js (x right, y up, z toward the dock); depth = -y.
 */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrap = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

  // ------------------------------------------------------------------ zones
  const ZONES = [
    { id: 'reef', name: 'Sunlit Reef', top: 0, bottom: 20, fog: '#3aaaba', deep: '#17668c', density: 0.022, light: 1.0 },
    { id: 'kelp', name: 'Kelp Forest', top: 20, bottom: 60, fog: '#1f5e52', deep: '#0f3a3c', density: 0.034, light: 0.5 },
    { id: 'twilight', name: 'Twilight', top: 60, bottom: 200, fog: '#0c1d38', deep: '#060e22', density: 0.05, light: 0.12 },
    { id: 'abyss', name: 'The Abyss', top: 200, bottom: 400, fog: '#03050c', deep: '#010206', density: 0.07, light: 0.0 },
  ];
  const FLOOR = 395;
  function zoneAt(depth) { for (const z of ZONES) if (depth < z.bottom) return z; return ZONES[ZONES.length - 1]; }
  /** Smooth zone values for the visuals: light 0..1, density, and which two zones blend. */
  function zoneMix(depth) {
    const d = clamp(depth, 0, FLOOR);
    let i = ZONES.findIndex(z => d < z.bottom); if (i < 0) i = ZONES.length - 1;
    const z = ZONES[i], n = ZONES[Math.min(ZONES.length - 1, i + 1)];
    const k = clamp((d - (z.bottom - 6)) / 12, 0, 1);   // blend over the last 6 m and the first 6 of the next
    return { a: z, b: n, k: i === ZONES.length - 1 ? 0 : k, light: lerp(z.light, n.light, i === ZONES.length - 1 ? 0 : k) * Math.exp(-d / 140), density: lerp(z.density, n.density, k) };
  }

  // ------------------------------------------------------------------ species
  /*
   * cls: size class 1 (bait fish) .. 5 (monster); eats: classes it preys on; dmin/dmax: depth m;
   * price: coins per kg; school: group size (0 = loner); ambush: hides in cover and lunges;
   * glow: lights itself in the dark. Fight fields (power, speed, stamina, ...) as in logic.js.
   */
  const F = (o) => Object.assign({ jumpy: 0, thrash: 0.2, charge: 0.1, runLen: [1, 2], restLen: [1, 2], nibbles: [0, 2], window: 1.2, slackTol: 1.8,
    curiosity: 0.7, wary: 0.3, likesMotion: 0.4, senseR: 10, eats: [], school: 0, ambush: false, glow: false, cruise: 1, legendary: false, depth: 0 }, o);
  const SPECIES = [
    F({ id: 'perch', name: 'Copper Perch', blurb: 'Nosy, nibbly, never far from the reef.', cls: 1, dmin: 1, dmax: 18, kg: [0.2, 0.9], len: [18, 32], price: 9, school: 7,
      power: 0.34, speed: 2.4, stamina: 0.42, jumpy: 0.12, thrash: 0.45, nibbles: [1, 3], window: 1.4, curiosity: 1, wary: 0.15, cruise: 1.1,
      shape: 'fish', look: { back: '#5a3d1c', side: '#d9893a', belly: '#f7dfb4', fin: '#e8763a', mark: 'bars', h: 0.42, w: 0.2 } }),
    F({ id: 'mackerel', name: 'Glass Mackerel', blurb: 'A flashing school. Twitch the lure and they pounce.', cls: 1, dmin: 0, dmax: 24, kg: [0.4, 1.4], len: [28, 44], price: 10, school: 9,
      power: 0.44, speed: 5, stamina: 0.5, jumpy: 0.15, thrash: 0.3, charge: 0.35, runLen: [0.5, 1.1], restLen: [0.5, 1], nibbles: [0, 1], window: 1.05, likesMotion: 1, senseR: 13, cruise: 2,
      shape: 'fish', look: { back: '#1f5a6e', side: '#9fd6dc', belly: '#eef6f2', fin: '#4d8a96', mark: 'waves', h: 0.24, w: 0.16 } }),
    F({ id: 'puffer', name: 'Parrot Puff', blurb: 'Blows up like a balloon when hooked. Spiky, offended, delicious.', cls: 2, dmin: 4, dmax: 20, kg: [0.5, 2.2], len: [20, 40], price: 18,
      power: 0.4, speed: 1.8, stamina: 0.6, thrash: 0.7, nibbles: [1, 3], window: 1.4, curiosity: 0.9, cruise: 0.6,
      shape: 'puffer', look: { back: '#3d7a3a', side: '#f2c94a', belly: '#fff3c4', fin: '#e8763a', mark: 'spots', h: 0.6, w: 0.55 } }),
    F({ id: 'snapper', name: 'Ember Snapper', blurb: 'Shakes its head like it means it.', cls: 2, dmin: 8, dmax: 34, kg: [1.5, 6], len: [38, 70], price: 12, eats: [1],
      power: 0.68, speed: 3, stamina: 1.15, jumpy: 0.05, thrash: 0.7, nibbles: [1, 2], window: 1.2, curiosity: 0.6,
      shape: 'fish', look: { back: '#8a1f22', side: '#ef5b3f', belly: '#ffd0b0', fin: '#d8452e', mark: 'spots', h: 0.38, w: 0.18 } }),
    F({ id: 'eel', name: 'Ribbon Eel', blurb: 'Lives in the reef cracks. Bolts for its hole the moment it feels the hook.', cls: 2, dmin: 8, dmax: 26, kg: [0.8, 3], len: [70, 130], price: 16, eats: [1], ambush: true,
      power: 0.55, speed: 3.4, stamina: 0.9, thrash: 0.6, runLen: [1.4, 2.6], nibbles: [0, 1], window: 1.1, wary: 0.5, cruise: 0.8,
      shape: 'eel', look: { back: '#1d2a52', side: '#3a6ad0', belly: '#f0e05a', fin: '#f0e05a', mark: 'stripes', h: 0.09, w: 0.07 } }),
    F({ id: 'tarpon', name: 'Silver Tarpon', blurb: 'Hunts the reef edge. Leaps clean out; bow the rod.', cls: 4, dmin: 3, dmax: 40, kg: [6, 22], len: [80, 150], price: 9, eats: [1, 2],
      power: 0.9, speed: 4.4, stamina: 1.3, jumpy: 0.65, thrash: 0.3, charge: 0.2, runLen: [1.4, 3], nibbles: [0, 1], window: 1.05, wary: 0.5, likesMotion: 0.6, senseR: 14, cruise: 1.6,
      shape: 'fish', look: { back: '#4b5f6e', side: '#d6e2ea', belly: '#ffffff', fin: '#8aa1b0', mark: 'scales', h: 0.27, w: 0.15 } }),
    F({ id: 'bass', name: 'Tidebass', blurb: 'Steady, stubborn, cruises the kelp edge.', cls: 2, dmin: 16, dmax: 50, kg: [1, 4.5], len: [35, 66], price: 11, eats: [1],
      power: 0.58, speed: 3.2, stamina: 0.85, jumpy: 0.12, thrash: 0.25, charge: 0.25, runLen: [1.4, 3], nibbles: [0, 2], window: 1.25, curiosity: 0.6, wary: 0.45,
      shape: 'fish', look: { back: '#2c3b2a', side: '#8d9c6a', belly: '#e6e2c4', fin: '#56603e', mark: 'stripes', h: 0.32, w: 0.19 } }),
    F({ id: 'pike', name: 'Kelp Pike', blurb: 'An ambusher: waits in the fronds, then takes whatever you have hooked.', cls: 3, dmin: 20, dmax: 60, kg: [3, 11], len: [70, 120], price: 11, eats: [1, 2], ambush: true,
      power: 0.75, speed: 4.6, stamina: 1.0, thrash: 0.5, runLen: [1, 2.2], nibbles: [0, 0], window: 1.0, wary: 0.4, senseR: 12, cruise: 0.9,
      shape: 'pike', look: { back: '#2e4a22', side: '#8fae4a', belly: '#e8eac0', fin: '#a8642a', mark: 'spots', h: 0.17, w: 0.13 } }),
    F({ id: 'scorpion', name: 'Bramble Scorpionfish', blurb: 'A lump of weed with spines. Sits on rocks; hard to see, harder to hold.', cls: 2, dmin: 28, dmax: 60, kg: [1, 4], len: [30, 50], price: 16, eats: [1], ambush: true,
      power: 0.62, speed: 2.2, stamina: 0.9, thrash: 0.8, nibbles: [0, 1], window: 1.2, wary: 0.3, cruise: 0.4,
      shape: 'scorpion', look: { back: '#5a2a1e', side: '#c0563a', belly: '#f0c0a0', fin: '#d8783a', mark: 'speckle', h: 0.42, w: 0.3 } }),
    F({ id: 'ray', name: 'Dusk Ray', blurb: 'Glides off the kelp floor and just keeps going.', cls: 4, dmin: 34, dmax: 75, kg: [4, 14], len: [60, 120], price: 7, eats: [1],
      power: 0.82, speed: 2.4, stamina: 1.3, thrash: 0.05, charge: 0, runLen: [2.5, 4.5], nibbles: [1, 2], window: 1.4, wary: 0.6, cruise: 0.8, flat: true,
      shape: 'ray', look: { back: '#3d3550', side: '#6e5f86', belly: '#f2eaf2', fin: '#4a3f60', mark: 'speckle', h: 0.12, w: 0.9 } }),
    F({ id: 'lantern', name: 'Lantern Minnow', blurb: 'Tiny lights in the dark. Everything down here eats them.', cls: 1, dmin: 58, dmax: 190, kg: [0.1, 0.4], len: [8, 16], price: 22, school: 12, glow: true,
      power: 0.3, speed: 3, stamina: 0.35, thrash: 0.5, nibbles: [0, 1], window: 1.3, likesMotion: 0.9, senseR: 9, cruise: 1.4,
      shape: 'lantern', look: { back: '#10203a', side: '#3a5a8a', belly: '#9ac0e8', fin: '#5a8ac0', mark: 'scales', h: 0.28, w: 0.14 } }),
    F({ id: 'squid', name: 'Glass Squid', blurb: 'See-through, quick, inks when it panics.', cls: 2, dmin: 65, dmax: 200, kg: [0.6, 3], len: [30, 70], price: 20, eats: [1], glow: true,
      power: 0.55, speed: 4.2, stamina: 0.8, thrash: 0.4, charge: 0.4, runLen: [0.6, 1.4], nibbles: [0, 1], window: 1.1, likesMotion: 0.8, cruise: 1.2,
      shape: 'squid', look: { back: '#a8c8e0', side: '#d0e4f0', belly: '#f4fbff', fin: '#c0d8ec', mark: 'speckle', h: 0.2, w: 0.2 } }),
    F({ id: 'gulper', name: 'Fangtooth Gulper', blurb: 'Mostly mouth. Will swallow a fish half its size, then your line.', cls: 3, dmin: 85, dmax: 230, kg: [2, 9], len: [40, 80], price: 26, eats: [1, 2],
      power: 0.72, speed: 2.8, stamina: 1.0, thrash: 0.6, nibbles: [0, 0], window: 1.2, curiosity: 0.8, senseR: 12, cruise: 0.7,
      shape: 'gulper', look: { back: '#24182c', side: '#4a3456', belly: '#7a5a78', fin: '#3a2a44', mark: 'speckle', h: 0.5, w: 0.36 } }),
    F({ id: 'grouper', name: 'Gilded Grouper', blurb: 'The legend of the drop-off. Swallows hooked fish whole.', cls: 5, dmin: 40, dmax: 160, kg: [25, 60], len: [120, 190], price: 18, eats: [1, 2, 3], legendary: true,
      power: 1.0, speed: 2.8, stamina: 1.8, thrash: 0.5, charge: 0.15, runLen: [1.8, 3.6], nibbles: [1, 2], window: 1.3, curiosity: 0.9, wary: 0.1, senseR: 18, cruise: 0.8,
      shape: 'grouper', look: { back: '#5a3b10', side: '#e2a640', belly: '#fff0c2', fin: '#c07a1c', mark: 'spots', h: 0.42, w: 0.28 } }),
    F({ id: 'angler', name: 'Lampjaw Angler', blurb: 'A lamp, a jaw, and nothing else. Only the abyss has these.', cls: 3, dmin: 200, dmax: 395, kg: [3, 14], len: [40, 90], price: 45, eats: [1, 2], glow: true,
      power: 0.8, speed: 2, stamina: 1.2, thrash: 0.7, nibbles: [0, 1], window: 1.3, curiosity: 0.9, senseR: 14, cruise: 0.5,
      shape: 'angler', look: { back: '#2a1a24', side: '#5a3a44', belly: '#8a6066', fin: '#3a2630', mark: 'speckle', h: 0.62, w: 0.5 } }),
  ];
  const byId = id => SPECIES.find(s => s.id === id);

  /** How much a fish wants this bait: worm suits small fish; a fish bait suits whoever eats its class. */
  function baitAppeal(sp, bait) {
    if (!bait || bait.kind === 'worm') return sp.cls <= 2 ? 1 : sp.eats.length ? 0.35 : 0.15;
    const c = bait.cls;
    if (sp.eats.includes(c)) return 1.6 + (c - 1) * 0.3;
    return sp.cls <= c ? 0 : 0.2;   // a bait as big as you is not food, it is a threat
  }

  /** Who lives at this depth (and what the bait brings): spawn weights. luck lifts rare fish. */
  function pickSpecies(depth, rng, opts) {
    opts = opts || {};
    const pool = SPECIES.filter(s => depth >= s.dmin - 4 && depth <= s.dmax + 4 && (!s.legendary || opts.legendary));
    if (!pool.length) return null;
    const w = s => {
      const mid = (s.dmin + s.dmax) / 2, span = (s.dmax - s.dmin) / 2 + 4;
      const fit = Math.max(0.15, 1 - Math.abs(depth - mid) / span);
      const rare = s.cls >= 4 ? 0.35 + (opts.luck || 0) * 0.15 : s.school ? 1.4 : 1;
      return fit * rare * (opts.bait ? 0.4 + baitAppeal(s, opts.bait) : 1);
    };
    let r = rng() * pool.reduce((a, s) => a + w(s), 0);
    for (const s of pool) { r -= w(s); if (r < 0) return s; }
    return pool[0];
  }

  let nextId = 1;
  function spawnFish(sp, x, y, z, rng, o) {
    o = o || {};
    const size = o.size !== undefined ? o.size : Math.pow(rng(), 1.7);
    return {
      id: o.id || nextId++, sp, size, kg: +lerp(sp.kg[0], sp.kg[1], size).toFixed(2), cm: Math.round(lerp(sp.len[0], sp.len[1], size)),
      x, y, z, vx: 0, vy: 0, vz: 0, h: rng() * TAU, state: 'swim', t: 0, turnT: 0, lure: -1, nibLeft: 0, nibT: 0, cool: 0,
      leader: o.leader || null, off: o.off || null, home: o.home !== undefined ? o.home : -y, cover: o.cover || null, phase: rng() * TAU, speed: 0,
    };
  }

  // ------------------------------------------------------------------ the lure on its line
  /*
   * A weighted lure on a real line. It sinks on its own: weight against quadratic water drag sets
   * its terminal sink speed (the tackle-box "lure weight"). The line pays out off an open spool as
   * it falls, up to what is on the reel, and is simulated as a rope (a chain of nodes with water
   * drag) that arcs and lags behind the lure and pulls it back toward the rod when it is taut or
   * reeled. The rod is how you work it, the way anglers do: lift the tip and the lure climbs (let
   * it fall back and it flutters down), turn the tip and it glides that way, sweep the rod sharply
   * and it darts (a jig). Reeling takes line in. Neutral is the rod pose when the lure hits the
   * water (re-centre any time). Everything is the phone's raw motion; nothing steers for you.
   */
  const LURE = {
    DRAG: 1.1,          // 1/m quadratic drag
    LIN: 0.35,          // 1/s linear drag
    LIFT: 7,            // m/s^2 at a full lift of the rod tip
    GLIDE: 3.2,         // m/s^2 at a full turn of the tip
    FULL_P: 0.5, FULL_Y: 0.6, DEAD: 0.04,
    TURN: 1.6,          // rad/s the glide heading follows the tip
    DART: 0.9,         // share of the rod tip's speed passed to the lure in a sweep
    SPOOL: 0.12,        // the open spool's friction slows the fall a little
    NODES: 14,          // rope nodes
    ROPE_SINK: 0.25,    // m/s the line itself settles
  };
  function createLure(x, z, gear) {
    const sink = (gear && gear.dive) || 1.4, len = (gear && gear.lineLen) || 30;
    const l = { x, y: -0.3, z, vx: 0, vy: -0.5, vz: 0, heading: 0, np: null, ny: null, ox: x, oz: z, taut: false, depth: 0.3, maxDepth: 0.3,
      sink, maxLine: len, lineOut: 0.4, plane: null, rope: [], phase: 0, flutter: 0, glide: 0 };
    for (let i = 0; i <= LURE.NODES; i++) { const k = i / LURE.NODES; l.rope.push({ x, y: -0.3 * k, z, px: x, py: -0.3 * k, pz: z }); }
    return l;
  }
  function setNeutral(lure, f) { lure.np = Math.asin(clamp(f.y, -1, 1)); lure.ny = Math.atan2(f.x, -f.z); if (!lure.headSet) { lure.heading = lure.ny; lure.headSet = true; } }
  const dz = (v, d) => Math.abs(v) < d ? 0 : v - Math.sign(v) * d;
  /** Terminal sink speed of a lure of this weight setting, for the HUD and tests. */
  function terminalSink(sink) { return sink; }
  /**
   * inp: { f: rod direction, tip: rod tip velocity (world m/s, optional), reel: m/s of line taken
   * in (0 = spool open), lift: optional override }. Returns { taut, surfaced, payout }.
   */
  function steerLure(lure, inp, dt) {
    if (lure.np === null) setNeutral(lure, inp.f);
    const pitch = Math.asin(clamp(inp.f.y, -1, 1)), yaw = Math.atan2(inp.f.x, -inp.f.z);
    const dp = clamp(dz(pitch - lure.np, LURE.DEAD) / LURE.FULL_P, -1, 1);
    const dy = clamp(dz(wrap(yaw - lure.ny), LURE.DEAD) / LURE.FULL_Y, -1, 1);
    const sp = Math.hypot(lure.vx, lure.vy, lure.vz);
    // weight: g_eff balances quadratic drag at the terminal sink speed
    let ax = 0, ay = -(LURE.DRAG * lure.sink + LURE.LIN) * lure.sink, az = 0;
    // the rod: lifting the tip pulls it up, dipping it lets it fall faster
    ay += dp > 0 ? dp * LURE.LIFT : dp * LURE.LIFT * 0.35;
    if (lure.plane) ax += dy * LURE.GLIDE;
    else {
      lure.heading += dy * LURE.TURN * dt;
      const g = Math.abs(dy) * LURE.GLIDE + Math.max(0, dp) * LURE.GLIDE * 0.4;   // a lifted lure swims forward too
      ax += Math.sin(lure.heading) * g; az -= Math.cos(lure.heading) * g;
    }
    ax -= (LURE.DRAG * sp + LURE.LIN) * lure.vx; ay -= (LURE.DRAG * sp + LURE.LIN) * lure.vy; az -= (LURE.DRAG * sp + LURE.LIN) * lure.vz;
    lure.vx += ax * dt; lure.vy += ay * dt; lure.vz += az * dt;
    // a sharp sweep of the rod darts the lure along the tip's motion (the tip's raw velocity)
    if (inp.tip) {
      const ts = Math.hypot(inp.tip.x, inp.tip.y, inp.tip.z);
      if (ts > 2.5) { const k = LURE.DART * dt * 12 * (1 - 2.5 / ts); lure.vx += inp.tip.x * k; lure.vy += inp.tip.y * k; if (!lure.plane) lure.vz += inp.tip.z * k; }
    }
    lure.x += lure.vx * dt; lure.y += lure.vy * dt; lure.z += lure.vz * dt;
    if (lure.plane) { lure.z = lure.plane; lure.vz = 0; }
    // the line: pays out freely while the lure pulls on it (open spool), comes in when reeled
    const ex = lure.x - lure.ox, ez = lure.z - lure.oz, d = Math.hypot(ex, lure.y, ez);
    let payout = 0;
    const reel = inp.reel > 0.15 ? inp.reel : 0;
    if (reel) lure.lineOut = Math.max(0.6, lure.lineOut - reel * dt);
    else if (d > lure.lineOut && lure.lineOut < lure.maxLine) { payout = Math.min(d, lure.maxLine) - lure.lineOut; lure.lineOut += payout; lure.vy *= 1 - LURE.SPOOL * dt * Math.min(1, payout * 10); }
    lure.taut = d >= lure.lineOut - 0.02 && (reel > 0 || lure.lineOut >= lure.maxLine - 0.01);
    if (d > lure.lineOut) {
      // held by the line: back onto its reach, the outward part of the motion taken out
      const s = lure.lineOut / d, nx = ex / d, ny = lure.y / d, nz = ez / d;
      lure.x = lure.ox + ex * s; lure.y *= s; lure.z = lure.oz + ez * s;
      const out = lure.vx * nx + lure.vy * ny + lure.vz * nz;
      if (out > 0) { lure.vx -= nx * out; lure.vy -= ny * out; lure.vz -= nz * out; }
      if (reel) { lure.vx -= nx * reel * 0.5; lure.vy -= ny * reel * 0.5; lure.vz -= nz * reel * 0.5; }
    }
    if (lure.y < -FLOOR) { lure.y = -FLOOR; lure.vy = Math.max(0, lure.vy); }
    const surfaced = lure.y > -0.3 && reel > 0 && lure.lineOut < 1.5;
    if (lure.y > -0.2) { lure.y = -0.2; lure.vy = Math.min(0, lure.vy); }
    lure.depth = -lure.y; lure.maxDepth = Math.max(lure.maxDepth, lure.depth);
    // its action: a flutter on the drop, a glide when it swims, a wobble that speeds with it
    const v = Math.hypot(lure.vx, lure.vy, lure.vz);
    lure.phase += dt * (6 + v * 9);
    lure.flutter += ((lure.vy < -0.3 ? 1 : 0) - lure.flutter) * Math.min(1, dt * 3);
    lure.glide = Math.hypot(lure.vx, lure.vz);
    stepRope(lure, dt);
    return { taut: lure.taut, surfaced, payout };
  }
  /** The line as a rope in water: verlet nodes from where it enters the sea to the lure. */
  function stepRope(lure, dt) {
    const R = lure.rope, n = R.length - 1, seg = Math.max(0.05, lure.lineOut / n), damp = Math.exp(-dt * 2.5);
    for (let i = 1; i < n; i++) {
      const p = R[i], vx = (p.x - p.px) * damp, vy = (p.y - p.py) * damp, vz = (p.z - p.pz) * damp;
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.x += vx; p.y += vy - LURE.ROPE_SINK * dt * 0.1; p.z += vz;
      if (p.y > -0.05) p.y = -0.05;
    }
    R[0].x = lure.ox; R[0].y = 0; R[0].z = lure.oz;
    R[n].x = lure.x; R[n].y = lure.y; R[n].z = lure.z;
    for (let it = 0; it < 6; it++) {
      for (let i = 0; i < n; i++) {
        const a = R[i], b = R[i + 1], dx = b.x - a.x, dy = b.y - a.y, dzz = b.z - a.z, d = Math.hypot(dx, dy, dzz) || 1e-6;
        if (d <= seg) continue;   // a rope does not push, it only pulls
        const k = (d - seg) / d, aFix = i === 0, bFix = i + 1 === n;
        if (aFix && bFix) continue;
        if (aFix) { b.x -= dx * k; b.y -= dy * k; b.z -= dzz * k; }
        else if (bFix) { a.x += dx * k; a.y += dy * k; a.z += dzz * k; }
        else { a.x += dx * k / 2; a.y += dy * k / 2; a.z += dzz * k / 2; b.x -= dx * k / 2; b.y -= dy * k / 2; b.z -= dzz * k / 2; }
      }
    }
  }

  // ------------------------------------------------------------------ fish life
  /**
   * One step for a free fish. world: { lures: [{id, x, y, z, active, bait, light, twitch (s since),
   * moving (m/s), claimed}], fish (all), hooked: [{lure, fish, x, y, z}] }. Mutates claims.
   * Events: notice, nibble, strike, miss, lose, chase, eat (predator takes a hooked fish).
   */
  function stepFish(f, dt, world, rng) {
    const ev = [], sp = f.sp;
    f.cool = Math.max(0, f.cool - dt); f.t -= dt; f.phase += dt * (3 + f.speed * 3);
    const L = f.lure >= 0 ? world.lures.find(l => l.id === f.lure) : null;
    if (f.lure >= 0 && (!L || !L.active) && f.state !== 'chase') {
      if (L && L.claimed === f.id) L.claimed = -1;
      f.lure = -1; f.state = 'swim'; f.cool = 3; ev.push({ type: 'lose', fish: f });
    }
    let tx = null, ty = null, tz = null, spd = sp.cruise * 0.7;
    const go = (x, y, z, s) => { tx = x; ty = y; tz = z; spd = s; };
    if (f.state === 'swim' && sp.school && world.fish) {
      f.scanT = (f.scanT || rng() * 0.3) - dt;
      if (f.scanT <= 0) {
        f.scanT = 0.3;
        const pr = world.fish.find(o => o !== f && o.sp.eats && o.sp.eats.includes(sp.cls) && o.sp.cls > sp.cls && Math.hypot(o.x - f.x, o.y - f.y, o.z - f.z) < 6);
        if (pr) { f.state = 'scatter'; f.t = 1 + rng() * 1; f.h = Math.atan2(f.x - pr.x, -(f.z - pr.z)) + (rng() - 0.5) * 1.4; f.speed = sp.speed * 1.4 + 1; f.vy = (rng() - 0.5) * 2; ev.push({ type: 'scatter', fish: f }); }
      }
    }
    if (f.state === 'scatter') {
      go(f.x + Math.sin(f.h) * 6, f.y + f.vy, f.z - Math.cos(f.h) * 6, sp.speed * 1.4 + 1);
      if (f.t <= 0) f.state = 'swim';   // and drift back into formation round the leader
    } else if (f.state === 'swim') {
      if (f.leader && f.leader.state !== 'gone') {   // school: hold a place beside the leader
        const ld = f.leader;
        const gap = Math.hypot(ld.x + f.off.x - f.x, ld.z + f.off.z - f.z);   // stragglers hurry back into place
        go(ld.x + f.off.x, ld.y + f.off.y, ld.z + f.off.z, Math.max(0.5, ld.speed * 1.15 + 0.3 + Math.min(2.5, gap * 0.3)));
      } else if (sp.ambush && f.cover) {
        go(f.cover.x + Math.sin(f.phase * 0.1) * 0.6, f.cover.y, f.cover.z + Math.cos(f.phase * 0.1) * 0.6, 0.3);
      } else {
        if (f.t <= 0) {
          f.t = 2 + rng() * 3; f.h += (rng() - 0.5) * 1.8; f.wantDepth = clamp(f.home + (rng() - 0.5) * 6, sp.dmin, sp.dmax);
          // life gathers where the action is: drift back toward the lure when far from it
          const fo = world.focus;
          if (fo && Math.hypot(fo.x - f.x, fo.z - f.z) > 9) { f.h = Math.atan2(fo.x - f.x, -(fo.z - f.z)) + (rng() - 0.5) * 1.2; f.wantDepth = clamp(-fo.y + (rng() - 0.5) * 6, sp.dmin, sp.dmax); }
        }
        go(f.x + Math.sin(f.h) * 5, -(f.wantDepth || f.home), f.z - Math.cos(f.h) * 5, sp.cruise * 0.7);
      }
      // notice a lure: its bait, its movement, and in the dark its light
      if (f.cool <= 0 && !f.leader) {
        for (const l of world.lures) {
          if (!l.active || l.claimed >= 0) continue;
          const d = Math.hypot(l.x - f.x, l.y - f.y, l.z - f.z);
          const zl = zoneMix(-l.y).light, see = sp.senseR * (sp.glow ? 1 : clamp(0.45 + zl + (l.light || 0) * 0.08, 0.3, 1.2));
          if (d > see) continue;
          const appeal = baitAppeal(sp, l.bait);
          if (appeal <= 0) { if (d < 4 && rng() < dt * 2) { f.state = 'flee'; f.t = 2; f.h = Math.atan2(f.x - l.x, -(f.z - l.z)); } continue; }
          const lure = 0.35 + 0.8 * Math.exp(-l.twitch / 1.8) + sp.likesMotion * Math.min(1, l.moving) * 0.6;
          // the shallows are thin pickings; the bigger appetites are down where the light fades
          const deepen = clamp(-l.y / 10, 0.12, 1);
          if (rng() < sp.curiosity * appeal * lure * (1.3 - d / see) * 0.8 * deepen * dt) {
            l.claimed = f.id; f.lure = l.id; f.state = 'approach'; ev.push({ type: 'notice', fish: f, lure: l }); break;
          }
        }
      }
      // predators: a hooked fish is a struggling, easy meal
      if (sp.eats.length && f.cool <= 0) {
        for (const h of world.hooked || []) {
          if (h.fish === f || !sp.eats.includes(h.fish.sp.cls) || sp.cls <= h.fish.sp.cls) continue;
          const d = Math.hypot(h.x - f.x, h.y - f.y, h.z - f.z);
          if (d < sp.senseR * 1.6 && -h.y >= sp.dmin - 6 && -h.y <= sp.dmax + 10 && rng() < dt * (0.25 + (h.struggle || 0) * 0.5)) {
            f.state = 'chase'; f.preyFish = h.fish; f.t = 7; f.circle = undefined; ev.push({ type: 'chase', fish: f, prey: h.fish, lure: h.lure }); break;
          }
        }
      }
    } else if ((f.state === 'approach' || f.state === 'nibble' || f.state === 'hover' || f.state === 'lunge') && L && L.claimed !== f.id) {
      f.state = 'swim'; f.lure = -1; f.cool = 4;   // another fish got there first
    } else if (f.state === 'approach' && L && sp.ambush && Math.hypot(L.x - f.x, L.y - f.y, L.z - f.z) < 3.2) {
      f.state = 'hover'; f.t = 0.9 + rng() * 1.3;   // an ambusher stops dead and eyes it
    } else if (f.state === 'hover' && L) {
      // hanging still, nose on the lure, edging closer...
      go(L.x, L.y, L.z, 0.06); f.speed *= Math.max(0, 1 - dt * 4);
      if (f.t <= 0) { f.state = 'lunge'; f.t = 1.5; f.speed = sp.speed * 2 + 2; f.h = Math.atan2(L.x - f.x, -(L.z - f.z)); }
    } else if (f.state === 'lunge' && L) {
      // ...then it goes, all at once
      const d = Math.hypot(L.x - f.x, L.y - f.y, L.z - f.z);
      go(L.x, L.y, L.z, sp.speed * 2 + 2); f.speed = Math.max(f.speed, sp.speed * 1.6 + 1.5);
      if (d < 0.9) { f.state = 'strike'; f.t = sp.window; ev.push({ type: 'strike', fish: f, lure: L }); }
      else if (f.t <= 0) { f.state = 'swim'; f.lure = -1; L.claimed = -1; f.cool = 5; ev.push({ type: 'lose', fish: f }); }
    } else if (f.state === 'approach' && L) {
      const d = Math.hypot(L.x - f.x, L.y - f.y, L.z - f.z);
      go(L.x, L.y, L.z, d > 3 ? Math.max(sp.cruise * 1.3 + 0.6, (L.moving || 0) + 1.2) : Math.max(0.9, (L.moving || 0) + 0.4));
      if (d < 0.8) {
        if (L.moving > 0.4 && rng() < sp.likesMotion) { f.state = 'strike'; f.t = sp.window; ev.push({ type: 'strike', fish: f, lure: L }); }
        else { f.state = 'nibble'; f.nibLeft = sp.nibbles[0] + Math.floor(rng() * (sp.nibbles[1] - sp.nibbles[0] + 1)); f.nibT = 0.3 + rng() * 0.5; }
      }
    } else if (f.state === 'nibble' && L) {
      go(L.x + Math.sin(f.phase * 0.4) * 0.5, L.y, L.z + Math.cos(f.phase * 0.4) * 0.5, 0.3 + (L.moving || 0));
      f.nibT -= dt;
      if (f.nibT <= 0) {
        if (f.nibLeft > 0) { f.nibLeft--; f.nibT = 0.4 + rng() * 0.6; ev.push({ type: 'nibble', fish: f, lure: L }); }
        else { f.state = 'strike'; f.t = sp.window; ev.push({ type: 'strike', fish: f, lure: L }); }
      }
    } else if (f.state === 'strike' && L) {
      go(L.x, L.y, L.z, 0.6);
      if (f.t <= 0) { L.claimed = -1; ev.push({ type: 'miss', fish: f, lure: L }); f.state = 'flee'; f.t = 2.2; f.cool = 8; f.lure = -1; }
    } else if (f.state === 'chase') {
      const h = (world.hooked || []).find(x => x.fish === f.preyFish);
      if (!h || f.t <= 0) { f.state = 'swim'; f.preyFish = null; f.cool = 6; f.circle = undefined; }
      else {
        const d = Math.hypot(h.x - f.x, h.y - f.y, h.z - f.z);
        if (f.circle === undefined) { f.circle = 1.6 + rng() * 1.6; f.orb = Math.atan2(f.z - h.z, f.x - h.x); }
        if (f.circle > 0) {
          // it sizes the struggling fish up: a wide slow circle, closing
          f.circle -= dt; f.orb += dt * (1.1 + 2 / (3 + f.cm / 60));
          const R = 2.2 + f.cm / 90 + f.circle * 0.6;
          go(h.x + Math.cos(f.orb) * R, h.y + 0.4, h.z + Math.sin(f.orb) * R, sp.speed * 0.7 + 0.8);
        } else {
          go(h.x, h.y, h.z, sp.speed * 1.7 + 2); f.speed = Math.max(f.speed, sp.speed * 1.4 + 1.5);
          if (d < 1 + f.cm / 200) { ev.push({ type: 'eat', fish: f, prey: h.fish, lure: h.lure }); f.state = 'gone'; }
        }
      }
    } else if (f.state === 'flee') {
      go(f.x + Math.sin(f.h) * 6, f.y, f.z - Math.cos(f.h) * 6, sp.speed * 0.8);
      if (f.t <= 0) f.state = 'swim';
    } else if (f.state !== 'hooked' && f.state !== 'gone') { f.state = 'swim'; f.lure = -1; }
    if (tx !== null) {
      // swim: turn toward the target, ease the speed; depth changes are gentler than turns
      const want = Math.atan2(tx - f.x, -(tz - f.z));
      f.h += clamp(wrap(want - f.h), -2.6 * dt, 2.6 * dt);
      f.speed += (spd - f.speed) * Math.min(1, dt * 2);
      const vmax = Math.max(1.2, spd), hd = Math.hypot(tx - f.x, tz - f.z), sv = clamp((ty - f.y) * 1.2, -vmax, vmax) * (hd < 0.5 ? 1.5 : 1);
      f.vx = Math.sin(f.h) * f.speed * Math.min(1, hd + 0.2); f.vz = -Math.cos(f.h) * f.speed * Math.min(1, hd + 0.2); f.vy += (sv - f.vy) * Math.min(1, dt * 2);
      f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
      f.y = clamp(f.y, -FLOOR, -0.6);
    }
    return ev;
  }

  /** A school: a leader and followers holding offsets around it. */
  function spawnSchool(sp, x, y, z, rng) {
    const lead = spawnFish(sp, x, y, z, rng), out = [lead];
    for (let i = 1; i < sp.school; i++) {
      const off = { x: (rng() - 0.5) * 3, y: (rng() - 0.5) * 1.6, z: (rng() - 0.5) * 3 };
      out.push(spawnFish(sp, x + off.x, y + off.y, z + off.z, rng, { leader: lead, off, size: clamp(lead.size + (rng() - 0.5) * 0.3, 0, 1) }));
    }
    return out;
  }

  /** Nobody biting? Call the nearest willing fish to the lure, or say where to bring one in. */
  function directBite(fishes, lure, rng) {
    let best = null, bd = 1e9;
    for (const f of fishes) {
      if (f.state !== 'swim' || f.cool > 0 || f.lure >= 0 || f.sp.legendary || baitAppeal(f.sp, lure.bait) <= 0) continue;
      const d = Math.hypot(f.x - lure.x, f.y - lure.y, f.z - lure.z);
      if (d < 3 || d > 22) continue;
      if (d < bd) { bd = d; best = f; }
    }
    if (best) { best.leader = null; best.state = 'approach'; best.lure = lure.id; lure.claimed = best.id; return { fish: best }; }
    const a = rng() * TAU, r = 8 + rng() * 3;
    return { spawn: { x: lure.x + Math.sin(a) * r, y: lure.y + (rng() - 0.5) * 3, z: lure.z - Math.cos(a) * r } };
  }

  // ------------------------------------------------------------------ fight extras: cover and the swallow
  /**
   * Snagging: a running fish that reaches cover (kelp, rocks, the wreck) wraps the line round it.
   * The meter fills while it is within reach of cover and running, empties under side pressure.
   */
  function stepSnag(st, fishPos, covers, fs, dt) {
    let near = null, nd = 1e9;
    for (const c of covers) { const d = Math.hypot(c.x - fishPos.x, c.y - fishPos.y, c.z - fishPos.z); if (d < nd) { nd = d; near = c; } }
    st.cover = near; st.dist = nd;
    const running = fs.phase === 'run' || fs.phase === 'burst';
    if (near && nd < (near.r || 2) + 2.5 && running) st.meter += dt * (0.55 - Math.max(0, fs.side) * 0.9);
    else st.meter -= dt * 0.35;
    st.meter = clamp(st.meter, 0, 1.2);
    return st.meter >= 1;
  }
  /** A predator swallowed the hooked fish: the fight goes on with the predator, deep-hooked and angry. */
  function swallow(fs, pred, rng, createFight) {
    const nf = createFight(pred, fs.d + 1.5, fs.phi, 0.95, rng);
    nf.T = Math.min(1.05, fs.T + 0.35); nf.chain = (fs.chain || 0) + 1;
    return nf;
  }

  // ------------------------------------------------------------------ the tackle box
  const UPGRADES = {
    line: { name: 'Line length', unit: 'm', vals: [30, 60, 120, 220, 350], cost: [0, 60, 220, 650, 1600], blurb: 'How deep you can go.' },
    strength: { name: 'Line strength', unit: '', vals: [0, 0.08, 0.16, 0.26], cost: [0, 90, 280, 760], blurb: 'More drag before it screams.' },
    reel: { name: 'Reel', unit: 'x', vals: [1, 1.2, 1.45, 1.75], cost: [0, 80, 240, 640], blurb: 'Faster up from the deep.' },
    weight: { name: 'Lure weight', unit: 'm/s', vals: [1.3, 1.9, 2.6, 3.5], cost: [0, 50, 190, 520], blurb: 'Sinks faster: deeper, sooner.' },
    light: { name: 'Lure lamp', unit: 'm', vals: [0, 8, 15, 24], cost: [0, 120, 420, 1100], blurb: 'Lights the dark. Deep fish come to light.' },
  };
  function newSave() {
    return { v: 2, coins: 0, gear: { line: 0, strength: 0, reel: 0, weight: 0, light: 0 }, baits: [], bait: 'worm', journal: {}, luck: 0, settings: null, lobby: { rule: 'big', time: 180 }, deepest: 0 };
  }
  function gearStats(save) {
    const g = save.gear, v = k => UPGRADES[k].vals[clamp(g[k] | 0, 0, UPGRADES[k].vals.length - 1)];
    return { lineLen: v('line'), strength: v('strength'), reel: v('reel'), dive: v('weight'), light: v('light') };
  }
  function upgradeCost(save, k) { const u = UPGRADES[k], l = save.gear[k] | 0; return l + 1 < u.cost.length ? u.cost[l + 1] : null; }
  function buy(save, k) {
    const c = upgradeCost(save, k);
    if (c === null || save.coins < c) return false;
    save.coins -= c; save.gear[k] = (save.gear[k] | 0) + 1;
    return true;
  }
  /** What a fish fetches at the market: weight x species price, a premium for trophies. */
  function price(fish, stars) { return Math.max(1, Math.round(fish.kg * fish.sp.price * (1 + ((stars || 1) - 1) * 0.25))); }
  function keepAsBait(save, fish) {
    save.baits.push({ id: fish.sp.id, cls: fish.sp.cls, kg: fish.kg, name: fish.sp.name });
    if (save.baits.length > 12) save.baits.shift();
  }
  /** The bait on the hook: 'worm' (always) or the index of a kept fish. Using a fish uses it up. */
  function currentBait(save) {
    if (save.bait === 'worm' || !save.baits.length) return { kind: 'worm', cls: 0, name: 'Worm' };
    const b = save.baits[clamp(save.bait | 0, 0, save.baits.length - 1)];
    return { kind: 'fish', cls: b.cls, name: b.name, id: b.id };
  }
  function cycleBait(save) {
    if (!save.baits.length) { save.bait = 'worm'; return; }
    save.bait = save.bait === 'worm' ? 0 : (save.bait + 1 >= save.baits.length ? 'worm' : save.bait + 1);
  }
  function useBait(save) {
    if (save.bait === 'worm') return;
    save.baits.splice(clamp(save.bait | 0, 0, save.baits.length - 1), 1);
    save.bait = 'worm';
  }
  function logCatch(save, fish, depth, bait) {
    const j = save.journal[fish.sp.id] = save.journal[fish.sp.id] || { n: 0, best: 0, cm: 0, minD: 999, maxD: 0, baits: {} };
    const record = fish.kg > j.best;
    j.n++; if (record) { j.best = fish.kg; j.cm = fish.cm; }
    j.minD = Math.min(j.minD, Math.round(depth)); j.maxD = Math.max(j.maxD, Math.round(depth));
    const bk = bait && bait.kind === 'fish' ? bait.id : 'worm';
    j.baits[bk] = (j.baits[bk] || 0) + 1;
    return { record, first: j.n === 1 };
  }
  function bestBait(j) { let b = null, n = 0; for (const k of Object.keys(j.baits || {})) if (j.baits[k] > n) { n = j.baits[k]; b = k; } return b; }
  /** Load and repair a save: unknown or broken fields fall back to defaults, never throw. */
  function loadSave(json) {
    const s = newSave();
    let o = null;
    try { o = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { o = null; }
    if (!o || typeof o !== 'object') return s;
    if (Number.isFinite(o.coins)) s.coins = Math.max(0, Math.floor(o.coins));
    for (const k of Object.keys(UPGRADES)) if (o.gear && Number.isFinite(o.gear[k])) s.gear[k] = clamp(o.gear[k] | 0, 0, UPGRADES[k].vals.length - 1);
    if (Array.isArray(o.baits)) s.baits = o.baits.filter(b => b && byId(b.id)).slice(-12).map(b => ({ id: b.id, cls: byId(b.id).cls, kg: +b.kg || 0, name: byId(b.id).name }));
    s.bait = o.bait === 'worm' || !Number.isFinite(o.bait) || o.bait >= s.baits.length ? 'worm' : o.bait | 0;
    if (o.journal && typeof o.journal === 'object') for (const k of Object.keys(o.journal)) if (byId(k)) s.journal[k] = Object.assign({ n: 0, best: 0, cm: 0, minD: 999, maxD: 0, baits: {} }, o.journal[k]);
    if (Number.isFinite(o.luck)) s.luck = clamp(o.luck, 0, 5);
    if (Number.isFinite(o.deepest)) s.deepest = Math.max(0, o.deepest);
    if (o.settings && typeof o.settings === 'object') s.settings = o.settings;
    if (o.lobby && typeof o.lobby === 'object') s.lobby = Object.assign(s.lobby, o.lobby);
    return s;
  }

  const api = {
    ZONES, FLOOR, zoneAt, zoneMix, SPECIES, byId, baitAppeal, pickSpecies, spawnFish, spawnSchool, directBite,
    LURE, createLure, setNeutral, steerLure, stepRope, terminalSink, stepFish, stepSnag, swallow,
    UPGRADES, newSave, gearStats, upgradeCost, buy, price, keepAsBait, currentBait, cycleBait, useBait, logCatch, bestBait, loadSave,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TideDepths = api;
})(typeof window !== 'undefined' ? window : this);
