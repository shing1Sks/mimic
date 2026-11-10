// Ironfern dinosaurs, pure logic (Stage B): species data, damage zones, the per-animal state
// machine, pack flank offsets, telegraph timing, charge stopping and ray/capsule maths.
// No THREE, no DOM: runs in Node (test/dinos.test.js) and in the browser as DH.DinoLogic.
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- species
  // Sizes are real-world-ish (metres). Speeds in m/s. Damage values are per landed strike on the
  // player (100 hp). Zone multipliers follow the design doc; anything not listed is x1.
  const SPECIES = {
    raptor: {
      hp: 100, length: 3.4, walk: 2.2, run: 9.5, turnRate: 5,
      zones: { head: 3, eye: 3, mouth: 3, body: 1, flank: 1, armor: 1, wing: 1 },
      // stalks along a ring well out in the ferns, then rushes in from there and leaps the last metres:
      // the whole run is in front of you and two hits stop it (it tumbles and slinks back out)
      attack: { kind: 'leap', range: [12, 32], telegraphMs: 650, rushSpeed: 12.5, damage: 22, dodgeable: true, duckable: false, reach: 5, cooldown: [2.8, 4.5] },
      hold: [21, 27], firstWait: [1.2, 2.6], stopDamage: 50, staggerDamage: 70, fleeAt: 0, pack: true, hesitate: [0.8, 1.6],
    },
    dilo: {
      hp: 110, length: 5.2, walk: 1.9, run: 7.5, turnRate: 4,
      zones: { head: 3, eye: 3, mouth: 3, body: 1, flank: 1, armor: 1, wing: 1 },
      attack: { kind: 'spit', stop: [24, 34], telegraphMs: 900, spitSpeed: 13, damage: 16, dodgeable: true, duckable: false, reach: 34, cooldown: [2.6, 4.2] },
      staggerDamage: 80, fleeAt: 0.25, fleeTime: 5, pack: true, hesitate: [0.6, 1.2],
    },
    trike: {
      hp: 600, length: 8, walk: 1.7, run: 12, turnRate: 1.6,
      zones: { eye: 4, flank: 1.5, armor: 0.3, head: 0.3, body: 1, mouth: 0.3, wing: 1 },
      attack: { kind: 'charge', range: [28, 44], telegraphMs: 900, damage: 55, dodgeable: true, duckable: false, reach: 5, minSpeed: 9, maxSpeed: 16, cooldown: [2.5, 4.5] },
      stopDamage: 130, staggerDamage: Infinity, fleeAt: 0,
    },
    ptero: {
      hp: 55, length: 3.2, wingspan: 7, fly: 9.5, turnRate: 2,
      zones: { body: 1.5, head: 2, eye: 2, mouth: 2, wing: 0.6, flank: 1.5, armor: 1 },
      attack: { kind: 'swoop', telegraphMs: 800, diveMs: 1500, damage: 18, dodgeable: true, duckable: false, reach: 6, cooldown: [3, 6] },
      staggerDamage: 60, fleeAt: 0, fleeTime: 4, circleTime: [3, 5.5],
    },
    rex: {
      hp: 3600, length: 12.5, walk: 2.6, run: 9, turnRate: 1.3,
      zones: { eye: 2.5, mouth: 3, head: 1.5, body: 1, flank: 1, armor: 1, wing: 1 },
      attack: { kind: 'charge', range: [20, 46], telegraphMs: 900, damage: 60, dodgeable: true, duckable: false, reach: 7, minSpeed: 8, maxSpeed: 14, cooldown: [2, 4] },
      bite: { kind: 'bite', range: 9, telegraphMs: 700, damage: 45, dodgeable: true, duckable: false, reach: 10 },
      hold: [28, 34], roarMs: 2600, roarEvery: [7, 11], staggerAt: [0.75, 0.5, 0.25], staggerTime: 1.6, staggerDamage: Infinity, rageAt: 0.5, fleeAt: 0,
    },
    grazer: {
      hp: 250, length: 9, walk: 1.5, run: 6.5, turnRate: 1.5,
      zones: { head: 2, eye: 2, mouth: 2, body: 1, flank: 1, armor: 1, wing: 1 },
      attack: null, staggerDamage: 120, fleeAt: 1, wander: 22,
    },
  };
  const WEAK = { head: 1, eye: 1, mouth: 1 };

  // ---------------------------------------------------------------- zones
  /** Damage multiplier for a zone. opts.roaring: the rex's mouth is only soft while it roars. */
  function zoneMultiplier(species, zone, opts) {
    const sp = SPECIES[species]; if (!sp) return 1;
    if (zone === 'mouth' && species === 'rex' && !(opts && opts.roaring)) return sp.zones.head;
    const m = sp.zones[zone];
    return m == null ? 1 : m;
  }

  /** Map a hit hitbox part ('head'|'neck'|'body'|'tail'|'leg'|'eye'|'mouth'|'wing') plus the hit
   * normal in the animal's own frame (x right, y up, z forward) to a design-doc zone. */
  function classifyZone(species, part, n, opts) {
    n = n || { x: 0, y: 0, z: 0 };
    const roaring = !!(opts && opts.roaring);
    if (part === 'wing') return species === 'ptero' ? 'wing' : 'body';
    if (part === 'eye') return (species === 'trike' || species === 'rex') ? 'eye' : 'head';
    if (part === 'mouth') return species === 'rex' ? (roaring ? 'mouth' : 'head') : (species === 'trike' ? 'armor' : 'head');
    if (part === 'head') return species === 'trike' ? 'armor' : 'head';
    if (species === 'trike') {
      if (part === 'neck') return n.z > 0.2 ? 'armor' : 'body';
      if (part === 'body') return n.z > 0.6 ? 'armor' : Math.abs(n.x) > 0.5 ? 'flank' : 'body';
      return 'body';
    }
    return 'body';
  }
  const isWeak = z => !!WEAK[z];

  // ---------------------------------------------------------------- packs
  /** Lateral offset (m) of pack member i: 0, +s, -s, +2s, -2s ... so a pack fans out. */
  function flankOffset(i, spread) {
    spread = spread == null ? 7 : spread;
    if (i <= 0) return 0;
    const k = Math.ceil(i / 2);
    return (i % 2 ? 1 : -1) * k * spread;
  }
  /** The offset fades in the last stretch so the pack converges from the sides. */
  function flankAt(offset, dist, near, far) {
    near = near == null ? 9 : near; far = far == null ? 34 : far;
    const t = Math.max(0, Math.min(1, (dist - near) / (far - near)));
    return offset * t * t * (3 - 2 * t);
  }

  // ---------------------------------------------------------------- timing
  /** Charge speed (m/s) for a run-in of dist metres. */
  function chargeSpeed(spec, dist) {
    const a = spec.attack; return Math.max(a.minSpeed, Math.min(a.maxSpeed, dist / 2.2));
  }
  /** Milliseconds from the start of the telegraph until the strike lands. */
  function attackWindowMs(species, kind, dist) {
    const sp = SPECIES[species]; if (!sp) return 0;
    if (kind === 'bite') return sp.bite.telegraphMs;
    const a = sp.attack;
    switch (kind) {
      case 'leap': return Math.round(a.telegraphMs + 1000 * Math.max(0, dist - a.reach * 0.6) / a.rushSpeed);
      case 'spit': return Math.round(a.telegraphMs + 1000 * Math.max(0, dist) / a.spitSpeed);
      case 'charge': return Math.round(a.telegraphMs + 1000 * Math.max(0, dist - a.reach * 0.6) / chargeSpeed(sp, dist));
      case 'swoop': return a.telegraphMs + a.diveMs;
      default: return a.telegraphMs || 600;
    }
  }
  /** Where on its stalking ring an animal should be: its bearing from the stand (heading convention,
   * 0 = +z) kept inside the stand's view cone (centre +- lim), so the threat stays in front. */
  function holdBearing(ang, centre, lim) {
    const d = Math.atan2(Math.sin(ang - centre), Math.cos(ang - centre));
    return centre + Math.max(-lim, Math.min(lim, d));
  }
  /** Did the damage taken during this charge stop it? */
  function chargeStopped(species, chargeDamage) {
    const sp = SPECIES[species];
    return !!(sp && sp.stopDamage && chargeDamage >= sp.stopDamage);
  }
  /** Rex stagger thresholds crossed going from hp0 to hp1 (fractions of maxHp). */
  function thresholdsCrossed(thresholds, hp0, hp1, maxHp) {
    return (thresholds || []).filter(f => hp0 > f * maxHp && hp1 <= f * maxHp).length;
  }

  // ---------------------------------------------------------------- state machine
  const rr = (rnd, a) => a[0] + (a[1] - a[0]) * rnd();

  /** A fresh brain. o: { aggro, delay, playerTarget, rnd } */
  function createBrain(species, o) {
    o = o || {};
    const sp = SPECIES[species], rnd = o.rnd || Math.random;
    const b = {
      species, state: o.delay > 0 ? 'wait' : (species === 'grazer' ? 'graze' : species === 'ptero' ? 'circle' : 'approach'),
      t: 0, delay: o.delay || 0, hp: sp.hp, maxHp: sp.hp, aggro: o.aggro == null ? 0.7 : o.aggro,
      playerTarget: o.playerTarget !== false, cooldown: 0, kind: null, windowMs: 0, dur: 0, struck: false,
      chargeDmg: 0, roarIn: sp.roarEvery ? rr(rnd, sp.roarEvery) : 0, roarsLeftBeforeCharge: 0,
      stopDist: sp.attack && sp.attack.stop ? rr(rnd, sp.attack.stop) : 0,
      chargeDist: sp.attack && sp.attack.kind === 'charge' ? rr(rnd, sp.attack.range) : 0,
      holdR: sp.hold ? rr(rnd, sp.hold) : 0,
      circleFor: sp.circleTime ? rr(rnd, sp.circleTime) : 0, rage: false, reached: false,
      after: null,
    };
    if (species === 'grazer') { b.dur = rr(rnd, [1, 6]); b.playerTarget = false; }
    if (sp.firstWait) b.cooldown = rr(rnd, sp.firstWait);   // shows itself out there before it commits
    return b;
  }

  function enter(b, state, dur) { b.state = state; b.t = 0; b.dur = dur || 0; }

  /** Start an attack telegraph; returns the 'attack' action. */
  function startAttack(b, kind, dist) {
    const sp = SPECIES[b.species], a = kind === 'bite' ? sp.bite : sp.attack;
    b.kind = kind; b.windowMs = attackWindowMs(b.species, kind, dist); b.struck = false; b.chargeDmg = 0;
    enter(b, 'telegraph', b.windowMs / 1000);
    return { type: 'attack', kind, windowMs: b.windowMs, dodgeable: !!a.dodgeable, duckable: !!a.duckable, damage: a.damage };
  }

  /** One AI tick. s (senses): { dist (to target, horizontal m), pathDone, alarmed, packLoss, front
   * (false while it is outside the stand's view: it never attacks from behind or the side) }.
   * Returns actions: { type: 'appear'|'attack'|'strike'|'spit'|'reached'|'roar'|'roarEnd'|'state' ... }. */
  function step(b, s, dt, rnd) {
    rnd = rnd || Math.random;
    const sp = SPECIES[b.species], out = [], prev = b.state;
    b.t += dt; b.cooldown = Math.max(0, b.cooldown - dt);
    const dist = s.dist == null ? Infinity : s.dist;
    const cool = () => rr(rnd, sp.attack.cooldown) * (1.25 - 0.5 * b.aggro) * (b.rage ? 0.6 : 1);
    switch (b.state) {
      case 'wait':
        if (b.t >= b.delay) { enter(b, b.species === 'grazer' ? 'graze' : b.species === 'ptero' ? 'circle' : 'approach'); out.push({ type: 'appear' }); }
        break;
      case 'dead': break;
      case 'graze': case 'wander':
        if (s.alarmed) { enter(b, 'flee', rr(rnd, [6, 10])); out.push({ type: 'alarm' }); break; }
        if (b.t >= b.dur) {
          if (b.state === 'graze') enter(b, 'wander', rr(rnd, [5, 12])); else enter(b, 'graze', rr(rnd, [4, 11]));
        }
        break;
      case 'flee':
        if (b.t >= b.dur) {
          if (b.species === 'grazer') enter(b, 'graze', rr(rnd, [3, 7]));
          else if (b.species === 'ptero') { enter(b, 'circle'); b.circleFor = rr(rnd, sp.circleTime); }
          else { enter(b, 'approach'); b.cooldown = 1.5; }
        }
        break;
      case 'hesitate':
        if (b.t >= b.dur) enter(b, 'approach');
        break;
      case 'stagger':
        if (b.t >= b.dur) { enter(b, b.species === 'ptero' ? 'circle' : 'approach'); b.cooldown = Math.max(b.cooldown, 0.8); }
        break;
      case 'stumble':
        if (b.t >= b.dur) { enter(b, 'recover', 1.2); b.cooldown = cool(); }
        break;
      case 'recover':
        if (b.t >= b.dur) enter(b, b.species === 'ptero' ? 'circle' : 'approach');
        break;
      case 'reached': break;
      case 'circle':
        if (b.t >= b.circleFor && b.cooldown <= 0 && b.playerTarget) out.push(startAttack(b, 'swoop', dist));
        break;
      case 'roar':
        if (b.t >= b.dur) {
          out.push({ type: 'roarEnd' });
          b.roarIn = rr(rnd, sp.roarEvery) * (b.rage ? 0.65 : 1);
          if (b.playerTarget && dist <= sp.bite.range) out.push(startAttack(b, 'bite', dist));
          else if (b.playerTarget && s.front !== false && dist >= sp.attack.range[0] && dist <= sp.attack.range[1]) out.push(startAttack(b, 'charge', dist));
          else enter(b, 'approach');
        }
        break;
      case 'approach': {
        if (s.packLoss && sp.hesitate) { enter(b, 'hesitate', rr(rnd, sp.hesitate)); break; }
        if (!b.playerTarget) {
          if (s.pathDone && dist < 3.5 && !b.reached) { b.reached = true; enter(b, 'reached'); out.push({ type: 'reached' }); }
          break;
        }
        if (b.species === 'rex') {
          b.roarIn -= dt;
          if (dist <= sp.bite.range && b.cooldown <= 0) { out.push(startAttack(b, 'bite', dist)); break; }
          if (b.roarIn <= 0 && dist < 70 && s.front !== false) { enter(b, 'roar', sp.roarMs / 1000); out.push({ type: 'roar' }); break; }
          break;
        }
        if (!sp.attack || b.cooldown > 0 || s.front === false) break;
        const a = sp.attack;
        // a rush only starts from out on its ring: one that got close first backs off (dinos.js)
        if (a.kind === 'leap' && dist <= a.range[1] && dist >= Math.max(a.range[0], (b.holdR || 0) - 2)) out.push(startAttack(b, 'leap', dist));
        else if (a.kind === 'spit' && dist <= b.stopDist) out.push(startAttack(b, 'spit', dist));
        else if (a.kind === 'charge' && dist <= b.chargeDist) out.push(startAttack(b, 'charge', dist));
        break;
      }
      case 'telegraph': {
        const a = b.kind === 'bite' ? sp.bite : sp.attack;
        if (b.kind === 'spit' && !b.spat && b.t * 1000 >= a.telegraphMs) { b.spat = true; out.push({ type: 'spit' }); }
        if (b.t * 1000 >= b.windowMs) {
          b.spat = false;
          // the projectile / leap / charge / jaws arrive now: only lands if still in reach
          out.push({ type: 'strike', kind: b.kind, damage: a.damage, dodgeable: !!a.dodgeable, duckable: !!a.duckable, inReach: dist <= a.reach });
          b.struck = true; b.cooldown = cool();
          // after contact it gets out again: a hit and gone, never a brawl at the barrel
          enter(b, 'recover', b.kind === 'charge' ? 2.2 : b.kind === 'swoop' ? 2.4 : b.kind === 'spit' ? 1.4 : 2.6);
          if (b.species === 'trike' || (b.species === 'rex' && b.kind === 'charge')) b.chargeDist = rr(rnd, sp.attack.range);
        }
        break;
      }
    }
    if (b.state !== prev) out.push({ type: 'state', from: prev, to: b.state });
    return out;
  }

  /** Apply a hit. Returns { damage, killed, stagger, stumble, flee, rage, flinch (0..1) }. */
  function applyDamage(b, amount, zone, opts) {
    const sp = SPECIES[b.species];
    if (b.state === 'dead') return { damage: 0, killed: false };
    const mult = zoneMultiplier(b.species, zone, { roaring: b.state === 'roar' });
    const dmg = Math.max(0, amount * mult);
    const hp0 = b.hp; b.hp = Math.max(0, b.hp - dmg);
    const r = { damage: dmg, killed: false, stagger: false, stumble: false, flee: false, rage: false, flinch: Math.min(1, dmg / (sp.hp * 0.25) + 0.25) };
    if (b.hp <= 0) { r.killed = true; enter(b, 'dead'); return r; }
    // a charge that soaks enough damage collapses
    if (b.state === 'telegraph' && (b.kind === 'charge' || b.kind === 'leap') && b.t * 1000 >= sp.attack.telegraphMs * (b.kind === 'leap' ? 0.5 : 1)) {
      b.chargeDmg += dmg;
      if (chargeStopped(b.species, b.chargeDmg) || (b.species === 'rex' && b.chargeDmg >= 600)) { r.stumble = true; enter(b, 'stumble', b.kind === 'leap' ? 1.1 : 1.8); return r; }
    }
    if (sp.staggerAt) {
      const n = thresholdsCrossed(sp.staggerAt, hp0, b.hp, b.maxHp);
      if (n > 0) { r.stagger = true; enter(b, 'stagger', sp.staggerTime); }
      if (!b.rage && b.hp <= sp.rageAt * b.maxHp) { b.rage = true; r.rage = true; }
      return r;
    }
    if (b.species === 'grazer') { if (b.state !== 'flee') enter(b, 'flee', 8 + Math.random() * 4); r.flee = true; return r; }
    if (sp.fleeAt && b.hp <= sp.fleeAt * b.maxHp && !b.fled) { b.fled = true; r.flee = true; enter(b, 'flee', sp.fleeTime); return r; }
    if (dmg >= sp.staggerDamage && b.state !== 'stagger') { r.stagger = true; enter(b, 'stagger', 0.7); }
    return r;
  }

  // ---------------------------------------------------------------- geometry
  /** Ray (o, unit d) vs capsule (a, b, r): distance t or -1. Plain {x,y,z} objects. */
  function rayCapsule(o, d, a, b, r) {
    const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
    const oax = o.x - a.x, oay = o.y - a.y, oaz = o.z - a.z;
    const baba = bax * bax + bay * bay + baz * baz, bard = bax * d.x + bay * d.y + baz * d.z;
    const baoa = bax * oax + bay * oay + baz * oaz, rdoa = d.x * oax + d.y * oay + d.z * oaz;
    const oaoa = oax * oax + oay * oay + oaz * oaz;
    const A = baba - bard * bard, B = baba * rdoa - baoa * bard, C = baba * oaoa - baoa * baoa - r * r * baba;
    if (A > 1e-12) {
      const h = B * B - A * C;
      if (h >= 0) {
        const t = (-B - Math.sqrt(h)) / A, y = baoa + t * bard;
        if (y > 0 && y < baba && t >= 0) return t;
      }
    }
    // caps
    let best = -1;
    for (const c of [a, b]) {
      const t = raySphere(o, d, c, r);
      if (t >= 0 && (best < 0 || t < best)) best = t;
    }
    return best;
  }
  function raySphere(o, d, c, r) {
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
    const h = b * b - cc; if (h < 0) return -1;
    const s = Math.sqrt(h), t = -b - s;
    if (t >= 0) return t;
    return cc < 0 ? 0 : -1; // inside
  }
  /** Closest point on segment ab to p, as a parameter 0..1. */
  function segParam(p, a, b) {
    const bx = b.x - a.x, by = b.y - a.y, bz = b.z - a.z, l = bx * bx + by * by + bz * bz;
    if (l < 1e-12) return 0;
    return Math.max(0, Math.min(1, ((p.x - a.x) * bx + (p.y - a.y) * by + (p.z - a.z) * bz) / l));
  }

  const api = { SPECIES, zoneMultiplier, classifyZone, isWeak, flankOffset, flankAt, chargeSpeed, attackWindowMs, chargeStopped, holdBearing, thresholdsCrossed, createBrain, step, applyDamage, rayCapsule, raySphere, segParam };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.DH = root.DH || {}; root.DH.DinoLogic = api; }
})(typeof window !== 'undefined' ? window : this);
