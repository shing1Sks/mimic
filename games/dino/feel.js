// Ironfern feel: the game clock (hit-stop on kills, slow motion), ADRENALINE, and the phone's
// rumble. The top half is pure and runs in Node (test/feel.test.js).
//
// ADRENALINE: weak-spot hits, kills and clean dodges fill a meter. When it is full and an animal
// commits to an attack that will reach you (leap, charge, swoop, bite), time drops to a crawl for
// a few seconds: the animal hangs in the air, the jungle goes grey and quiet, the phone beats like a
// heart. The aim is untouched (still the phone, 1:1), only the world is slow, so a steady hand can
// put the round where it belongs. Kill the attacker inside it and the meter refills by half.
(function (root) {
  'use strict';

  // ================================================================== pure
  const HIT_STOP_SCALE = 0.03;   // the world during a hit-stop (not 0: sounds and particles keep a pulse)
  const ADREN = {
    scale: 0.28,                 // world speed while it runs
    maxReal: 3.2,                // s of real time at most
    easeIn: 0.12, easeOut: 0.35, // s (real) to drop into it / climb out of it
    cooldown: 4,                 // s (real) after one ends before the next can start
    gain: { weakHit: 0.1, kill: 0.18, weakKill: 0.34, dodge: 0.25, clutch: 0.5 },
    kinds: { leap: 1, charge: 1, swoop: 1, bite: 1 },
  };

  function createClock() {
    return { stop: 0, slow: null, meter: 0.5, cool: 0, adren: null, scale: 1, beatT: 0 };
  }

  /** Freeze the world for ms (real time); a longer stop wins. */
  function hitStop(c, ms) { c.stop = Math.max(c.stop, ms / 1000); return c; }

  /** Ease the world down to `k` for `dur` real seconds (a stronger/longer slow wins). */
  function slowMo(c, k, dur, easeIn, easeOut) {
    const s = c.slow;
    if (s && s.k <= k && s.dur - s.t >= dur) return c;
    c.slow = { k: Math.min(k, s ? s.k : 1), t: 0, dur, easeIn: easeIn == null ? 0.08 : easeIn, easeOut: easeOut == null ? 0.25 : easeOut };
    return c;
  }

  /** Ease envelope 0..1 of a slow: in over easeIn, hold, out over easeOut. */
  function envelope(s) {
    if (!s) return 0;
    const a = s.easeIn > 0 ? Math.min(1, s.t / s.easeIn) : 1;
    const b = s.easeOut > 0 ? Math.min(1, Math.max(0, (s.dur - s.t) / s.easeOut)) : (s.t < s.dur ? 1 : 0);
    const e = Math.min(a, b);
    return e * e * (3 - 2 * e);
  }

  /** Advance by real seconds; returns the world speed for this frame (0..1). */
  function step(c, rdt) {
    c.cool = Math.max(0, c.cool - rdt);
    let k = 1;
    if (c.slow) {
      c.slow.t += rdt;
      const e = envelope(c.slow);
      k = 1 + (c.slow.k - 1) * e;
      if (c.slow.t >= c.slow.dur) { c.slow = null; if (c.adren) { c.adren = null; c.cool = ADREN.cooldown; } }
    }
    if (c.stop > 0) { c.stop = Math.max(0, c.stop - rdt); k = Math.min(k, HIT_STOP_SCALE); }
    c.scale = k;
    return k;
  }

  function charge(c, amount) { c.meter = Math.max(0, Math.min(1, c.meter + amount)); return c.meter; }

  /** An attack started: does it set ADRENALINE off? a = { kind, dist (m), windowMs, playerTarget } */
  function wantsAdrenaline(c, a) {
    if (c.adren || c.cool > 0 || c.meter < 1 || !a || !ADREN.kinds[a.kind]) return false;
    if (a.playerTarget === false) return false;
    // close enough to be personal: a raptor's leap range, a charge's run-in, a dive
    return (a.dist == null || a.dist < 45) && (a.windowMs == null || a.windowMs > 350);
  }

  /** Start it: lasts until the strike would land (game time stretched by the scale), capped. */
  function startAdrenaline(c, a) {
    const real = Math.min(ADREN.maxReal, Math.max(1.2, ((a && a.windowMs) || 900) / 1000 / ADREN.scale * 0.85));
    c.meter = 0;
    c.adren = { attacker: a && a.id != null ? a.id : null, t0: 0 };
    c.slow = { k: ADREN.scale, t: 0, dur: real, easeIn: ADREN.easeIn, easeOut: ADREN.easeOut };
    c.beatT = 0;
    return real;
  }

  /** End it early (the attacker died, or the strike resolved): climb out over easeOut. */
  function endAdrenaline(c) {
    if (!c.adren || !c.slow) return;
    c.slow.dur = Math.min(c.slow.dur, c.slow.t + ADREN.easeOut);
  }

  /** How long the world stops for a kill (ms): bigger animals and weak spots land harder. */
  function killStopMs(species, zone) {
    const weak = zone === 'head' || zone === 'eye' || zone === 'mouth';
    const base = { raptor: 55, dilo: 60, ptero: 60, trike: 110, rex: 160, grazer: 40 }[species] || 50;
    return Math.round(base * (weak ? 1.6 : 1));
  }

  /** Phone kick for one shot: [strength 0..1, ms, pattern]. Every shot rumbles. */
  function shotRumble(weapon) {
    switch (weapon) {
      case 'marksman': return [1, 110, 0];
      case 'sidearm': return [0.6, 45, 0];
      default: return [0.48, 34, 0];
    }
  }

  const Pure = { ADREN, HIT_STOP_SCALE, createClock, hitStop, slowMo, envelope, step, charge, wantsAdrenaline, startAdrenaline, endAdrenaline, killStopMs, shotRumble };
  if (typeof module !== 'undefined' && module.exports) { module.exports = Pure; return; }

  // ================================================================== browser
  const DH = root.DH = root.DH || {};
  let ctx = null, clock = createClock(), meterEl = null, flashEl = null, lastRumble = 0, rumbleAsked = false;
  const isWeak = z => z === 'head' || z === 'eye' || z === 'mouth';

  function mc() { const p = DH.Input && DH.Input.phone; return p && p.connected ? p.mc : null; }
  /** Rumble the phone (best effort; Bluetooth takes ~30 reports a second, so bursts are thinned). */
  function rumble(strength, ms, pattern, force) {
    const m = mc(); if (!m || !m.rumble) return;
    const t = performance.now();
    if (!force && t - lastRumble < 28) return;
    lastRumble = t;
    try { const r = m.rumble(strength, ms, pattern || 0); if (r && r.catch) r.catch(() => {}); } catch (e) { /* no rumble */ }
  }
  // Chrome needs a click or key press before it shows the one-time phone chooser for vibration
  function askRumble() {
    if (rumbleAsked) return;
    const p = DH.Input && DH.Input.phone;
    if (!p || !p.mc || !p.mc.enableRumble) return;
    rumbleAsked = true;
    try { Promise.resolve(p.mc.enableRumble()).catch(() => {}); } catch (e) { /* no WebHID */ }
  }

  function buildUi() {
    const hud = document.getElementById('hud');
    if (!hud || meterEl) return;
    meterEl = document.createElement('div');
    meterEl.id = 'adrenal';
    meterEl.innerHTML = '<span class="ad-lbl">ADRENALINE</span><div class="ad-bar"><i></i></div>';
    hud.appendChild(meterEl);
    flashEl = document.createElement('div');
    flashEl.id = 'adflash';
    hud.appendChild(flashEl);
  }
  function paintMeter() {
    if (!meterEl) return;
    const w = (clock.adren ? 100 * (1 - Math.min(1, clock.slow ? clock.slow.t / clock.slow.dur : 1)) : clock.meter * 100).toFixed(1) + '%';
    const cls = clock.adren ? 'on' : clock.meter >= 1 ? 'full' : '';
    if (w !== paintMeter.w) { meterEl.firstChild.nextSibling.firstChild.style.width = w; paintMeter.w = w; }
    if (cls !== meterEl.className) meterEl.className = cls;
  }
  function flash(text) {
    if (!flashEl) return;
    flashEl.textContent = text;
    flashEl.className = ''; void flashEl.offsetWidth; flashEl.className = 'show';
  }

  /** Fill the meter; the first time it is full in a mission, say what it does. */
  function gain(a) {
    const was = clock.meter;
    charge(clock, a);
    if (was < 1 && clock.meter >= 1 && !clock.told) {
      clock.told = true;
      DH.bus.emit('mission:feed', { text: 'Adrenaline ready: the next lunge at you slows time', kind: 'info' });
    }
  }
  function onAttack(d) {
    if (!d || !d.dino || !ctx) return;
    const pp = ctx.view.pos, dino = d.dino;
    const dist = Math.hypot(dino.pos.x - pp.x, dino.pos.z - pp.z);
    // the big ones winding up: a rising buzz in the hand
    if (d.kind === 'charge') rumble(dino.species === 'rex' ? 0.9 : 0.7, 220, 2, true);
    if (wantsAdrenaline(clock, { kind: d.kind, dist, windowMs: d.windowMs, playerTarget: dino.playerTarget })) {
      startAdrenaline(clock, { kind: d.kind, windowMs: d.windowMs, id: dino.id });
      if (DH.Audio && DH.Audio.whoosh) DH.Audio.whoosh(true);
      flash('ADRENALINE');
      rumble(1, 160, 2, true);
      DH.bus.emit('feel:adrenaline', { on: true, dino });
    }
  }
  function onDead(d) {
    if (!d || d.byPlayer === false) return;
    const sp = d.species, weak = isWeak(d.zone);
    hitStop(clock, killStopMs(sp, d.zone));
    if (DH.Audio && DH.Audio.killThump) DH.Audio.killThump((sp === 'rex' ? 1.5 : sp === 'trike' ? 1.25 : 0.8) * (weak ? 1.2 : 1));
    gain(weak ? ADREN.gain.weakKill : ADREN.gain.kill);
    rumble(weak ? 1 : 0.85, weak ? 140 : 90, 3, true);
    if (clock.adren && d.dino && clock.adren.attacker === d.dino.id) {
      gain(ADREN.gain.clutch);
      endAdrenaline(clock);
      flash('CLUTCH');
    }
    // the big ones go down in slow motion
    if (sp === 'rex') slowMo(clock, 0.22, 2.4, 0.05, 0.8);
    else if (sp === 'trike') slowMo(clock, 0.35, 1.1, 0.05, 0.5);
  }

  DH.Feel = {
    clock: () => clock,
    get scale() { return clock.scale; },
    adrenaline: () => !!clock.adren,
    rumble, askRumble,
    init(c) {
      ctx = c; buildUi();
      addEventListener('mousedown', askRumble); addEventListener('keydown', askRumble);
      const on = (e, f) => DH.bus.on(e, f);
      on('shot:fired', d => { const r = shotRumble(d && d.weapon); rumble(r[0], r[1], r[2]); });
      on('shot:hit', d => {
        if (!d || d.killed) return;
        if (isWeak(d.zone)) gain(ADREN.gain.weakHit);
        if (d.weapon === 'marksman') hitStop(clock, 35);   // the rifle's round lands with a beat
      });
      on('dino:attack', onAttack);
      on('dino:dead', onDead);
      on('dino:roar', d => { if (d && d.dist < 70) rumble(Math.min(1, 1.1 - d.dist / 80), 255, 1, true); });
      on('dino:step', d => { if (d && d.near > 0) rumble(Math.min(1, 0.25 + d.near * 0.7), 60, 0); });
      on('player:hurt', d => { rumble(Math.min(1, 0.5 + ((d && d.damage) || 10) / 60), 200, 1, true); endAdrenaline(clock); });
      on('player:dodged', () => { gain(ADREN.gain.dodge); rumble(0.5, 70, 0, true); if (!clock.adren) slowMo(clock, 0.4, 0.45, 0.03, 0.25); endAdrenaline(clock); });
      on('mission:retry', () => { const told = clock.told; clock = createClock(); clock.told = told; });
      on('state', e => { if (e && e.state === 'briefing') clock = createClock(); if (e && e.state !== 'play' && e.state !== 'pause') { clock.slow = null; clock.stop = 0; clock.adren = null; } });
    },
    /** Called by core.js each frame with real seconds; returns the world speed. */
    step(rdt, c) {
      ctx = c || ctx;
      if (!ctx || ctx.state !== 'play') {
        clock.scale = 1; paintMeter();
        if (DH.Audio && DH.Audio.setSlow) DH.Audio.setSlow(0);   // menus and pause are never muffled
        return 1;
      }
      const k = step(clock, rdt);
      // heartbeat in the hand and the ears while it runs
      if (clock.adren) {
        clock.beatT -= rdt;
        if (clock.beatT <= 0) { clock.beatT = 0.62; rumble(0.75, 70, 3, true); if (DH.Audio && DH.Audio.heartbeat) DH.Audio.heartbeat(); }
      }
      // sounds go low and slow with the world (hit-stops are too short to hear)
      const env = clock.slow ? envelope(clock.slow) : 0;
      const slowFrac = clock.slow ? Math.min(1, (1 - clock.slow.k) * env / (1 - ADREN.scale)) : 0;
      if (DH.Audio && DH.Audio.setSlow) DH.Audio.setSlow(slowFrac);
      // colour grade for core.js: grey and dark at the edges while the world is slow
      const g = clock.adren ? env : env * 0.4;
      const gr = ctx.grade || (ctx.grade = { sat: 1, vig: 0 });
      gr.sat = 1 - 0.65 * g; gr.vig = g;
      paintMeter();
      return k;
    },
  };
})(typeof window !== 'undefined' ? window : this);
