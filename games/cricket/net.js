/*
 * Chak De Fatte Cricket - the online room, drawn by the friend's own laptop (state sync).
 *
 * The host runs the match. Its page sends, every frame, what the scene looks like (MimicSync:
 * every player's bones, the ball, bats, stumps, aim marker, dust, the friend's camera, a few
 * numbers) on an unreliable channel, and as ordered events what can't be read off the scene (every
 * sound, Paaji's lines, the big screen, fireworks, who wears which kit, the DRS tubes). The friend's
 * page is the same game page (?join=<room>): it builds the same stadium, never runs the match, and
 * draws the host's state as it was D ms ago (D = the network's floor delay + jitter, the lowest at
 * which frames still come out evenly), playing each event when the picture reaches its moment, so
 * sound and picture stay together. It tells the host D, and the host judges that player's swings
 * against the picture they saw.
 *
 * Host:  const net = CK.Net.host(ctx); each frame, after the scene is set: net.hostFrame(now)
 * Guest: const net = CK.Net.guest(ctx); each frame instead of the game: net.guestFrame(dt)
 * ctx: see game.js (scene objects, people, world, audio, hooks).
 */
(function () {
  'use strict';
  const CK = window.CK = window.CK || {};
  const MS = () => window.MimicSync, MR = () => window.MimicRoom;
  const BONE_T = ['Body', 'ShoulderL', 'ShoulderR', 'FootL', 'FootR'];

  /** The replicated scene, in the same order on both pages. */
  function buildSpec(c) {
    const ents = [];
    // 0: the friend's camera (position, rotation, field of view)
    ents.push({ obj: () => c.camProxy, extras: [{ get: () => c.camProxy.fov, set: v => { c.camProxy.fov = v; } }] });
    // 1: numbers the friend's page needs for what it animates itself (crowd, cheerleaders, DRS, trail)
    ents.push({ extras: c.params.map(p => ({ get: p.get, set: p.set })) });
    // the players: bones, opacity (faded out of a shot), blinking; a helmet where it is
    for (const A of c.actors()) {
      ents.push({
        obj: () => A.root,
        bones: () => { let sk = null; A.model.traverse(o => { if (!sk && o.isSkinnedMesh) sk = o.skeleton; }); return sk ? sk.bones : []; },
        boneT: () => { let sk = null; A.model.traverse(o => { if (!sk && o.isSkinnedMesh) sk = o.skeleton; }); return sk ? sk.bones.filter(b => BONE_T.includes(b.name)) : []; },
        opacity: { get: () => A.opacity, set: v => A.setOpacity(v) },
        bits: [{ get: () => !!(A.kit && A.mats.Eyes && A.mats.Eyes[0] && A.mats.Eyes[0].map === A.kit.shut), set: b => A.setBlink && A.setBlink(b) }],
      });
      if (A.helmet) ents.push({ obj: () => A.helmet, scale: true, parents: () => [A.helmetSeat.parent, A.B.arms.left.palm, A.B.arms.right.palm, A.root] });
    }
    for (const e of c.objects()) ents.push(e);
    return { entities: ents };
  }

  // ======================================================================== host
  function host(c) {
    const R = MS().createReplicator(buildSpec(c));
    R.bindBones();
    const on = () => MR() && MR().stateActive;
    const ev = (m, sticky) => { if (MR()) MR().sendEvent(m, sticky); };
    // every sound and crowd reaction, as it is made
    const wrap = (obj, name, make) => {
      const f = obj[name];
      if (typeof f !== 'function' || f.__net) return;
      const w = function (...a) { if (on()) { const m = make(a); if (m) ev(m.m, m.sticky); } return f.apply(this, a); };
      w.__net = true; obj[name] = w;
    };
    for (const k of Object.keys(c.audio.SFX)) wrap(c.audio.SFX, k, a => ({ m: { t: 'sfx', f: k, a } }));
    ['react', 'chant'].forEach(k => wrap(c.audio.Crowd, k, a => ({ m: { t: 'crowd', f: k, a } })));
    // the stadium: the big screen (the score sticks; a FOUR! flash doesn't), boards, fireworks, placards, flags
    wrap(c.world, 'screen', a => ({ m: { t: 'world', f: 'screen', a }, sticky: a[0] && !a[0].hot ? 'screen:' + Object.keys(a[0]).sort().join(',') : null }));
    wrap(c.world.boards, 'flash', a => ({ m: { t: 'world', f: 'boards.flash', a } }));
    wrap(c.world.fx, 'burst', a => ({ m: { t: 'world', f: 'fx.burst', a } }));
    wrap(c.world.placards, 'show', a => ({ m: { t: 'world', f: 'placards.show', a } }));
    wrap(c.world.flags, 'paint', a => ({ m: { t: 'world', f: 'flags.paint', a }, sticky: 'flags' }));
    // who is who: kits, faces, head gear, the helmet in hand (each one's latest goes to a late joiner)
    c.actors().forEach((A, i) => {
      const key = f => { const k = 'actor:' + i + ':' + f; return k; };
      const put = (f, args) => { const k = key(f); if (MR()) { MR().sendEvent({ t: 'actor', i, f, a: args }, k); } };
      ['paint', 'look', 'headwear', 'helmetTo'].forEach(f => {
        const g = A[f]; if (typeof g !== 'function') return;
        A[f] = function (...a) { put(f, a); return g.apply(this, a); };
      });
      const d = A.dress;
      if (typeof d === 'function') A.dress = function (p) { if (p) put('dress', [dressOut(p)]); return d.apply(this, arguments); };
    });
    if (c.trail) { const cl = c.trail.clear; c.trail.clear = function () { if (on()) ev({ t: 'trail', f: 'clear' }); return cl.apply(this, arguments); }; }
    let lastWave = null, encMs = 0, sendMs = 0;
    function hostFrame(now) {
      if (!on()) return;
      const w = c.world.crowd.wave;
      if (w && w !== lastWave) { lastWave = w; ev({ t: 'wave', a: w.a, tt: w.t }); }
      c.fillCam(c.camProxy);
      const t0 = performance.now(); const buf = R.encode(now); const t1 = performance.now();
      MR().sendState(buf);
      encMs += ((t1 - t0) - encMs) * 0.05; sendMs += ((performance.now() - t1) - sendMs) * 0.05;
      MR().flush();
    }
    return {
      hostFrame,
      line: (id, delay) => { if (on()) ev({ t: 'line', id, d: delay }); },
      paajiStop: () => { if (on()) ev({ t: 'pstop' }); },
      chant: (seat, k) => { if (on()) ev({ t: 'chant', a: [seat, k] }); },
      drs: data => { if (on()) ev({ t: 'drs', data }, 'drs'); },
      drsEnd: () => { if (on()) ev({ t: 'drs', data: null }, 'drs'); },
      settings: s => ev({ t: 'settings', s }, 'settings'),
      stats: () => ({ seq: R.seq, encodeMs: encMs, sendMs }),
    };
  }
  /** A dress order as plain data (the team by id). */
  function dressOut(p) {
    return { team: p.team && p.team.id, name: p.name, number: p.number, look: p.look, style: p.style, keeper: !!p.keeper, role: p.role };
  }
  function dressIn(d) {
    const tm = d.team && CK.Teams && CK.Teams.byId(d.team);
    return Object.assign({}, d, { team: tm && tm.id === d.team ? tm : { id: d.team } });
  }

  // ======================================================================== guest
  function guest(c) {
    const R = MS().createReplicator(buildSpec(c));
    let bound = false, link = null;
    const P = MS().createPlayout({ smooth: /[?&]smooth=1/.test(location.search) });
    const queue = [];          // events and HUD changes, played when the picture reaches their moment
    const ages = [];           // how old (host ms) each drawn frame was when drawn
    let lastSnap = null, ran = {}, applyMs = 0, shownT = -Infinity, mixBuf = null, lastReport = 0, frames = 0, packets = 0, bytes = 0;
    const ui = overlay(c);
    function bind() { if (!bound && c.ready()) { R.bindBones(); bound = true; } }
    function onState(buf, arrivalHost) {
      bind(); if (!bound) return;
      packets++; bytes += buf.byteLength;
      const d = R.decode(buf);
      if (d) P.push(d.t, arrivalHost, d.snap);
    }
    const push = m => { queue.push(m); };
    function run(m) {
      ran[m.t] = (ran[m.t] || 0) + 1;
      try {
        if (m.t === 'dom' || m.t === 'attrs') MR().applyDomMsg(m);
        else if (m.t === 'sfx') { const f = c.audio.SFX[m.f]; if (f) f.apply(c.audio.SFX, m.a || []); }
        else if (m.t === 'crowd') { const f = c.audio.Crowd[m.f]; if (f) f.apply(c.audio.Crowd, m.a || []); }
        else if (m.t === 'world') {
          const path = m.f.split('.'), fn = path.length > 1 ? c.world[path[0]][path[1]] : c.world[path[0]], self = path.length > 1 ? c.world[path[0]] : c.world;
          if (typeof fn === 'function') fn.apply(self, m.a || []);
        } else if (m.t === 'actor') {
          const A = c.actors()[m.i]; if (!A) return;
          if (m.f === 'dress') A.dress(dressIn(m.a[0]));
          else if (typeof A[m.f] === 'function') A[m.f].apply(A, m.a || []);
        } else if (m.t === 'wave') c.world.crowd.wave = { a: m.a, t: m.tt };
        else if (m.t === 'trail') { if (c.trail) c.trail.clear(); }
        else if (m.t === 'line') c.playLine(m.id, m.d || 0);
        else if (m.t === 'pstop') c.stopLines();
        else if (m.t === 'chant') c.chant.apply(null, m.a);
        else if (m.t === 'drs') c.drs(m.data);
        else if (m.t === 'settings') c.settings(m.s);
      } catch (e) { console.warn('[net] event', m.t, e); }
    }
    link = MR().joinState({
      name: 'Friend',
      onState,
      onEvent: push,
      onDom: push,
      onStatus: t => ui.status(t),
      onPhone: p => ui.phone(p),
    });
    function guestFrame(dt) {
      bind();
      const H = link && link.hostNow();
      if (H == null || !bound) return false;
      const p = P.pick(H);
      // events up to the moment on screen, in order (lasting ones that came before the first frame: at once)
      const upto = p ? p.t : -Infinity;
      if (queue.length) {
        queue.sort((x, y) => (x.at || 0) - (y.at || 0));
        while (queue.length && (queue[0].at === undefined || queue[0].at <= upto || !p)) {
          if (!p && queue[0].t !== 'dom' && queue[0].t !== 'attrs' && queue[0].t !== 'actor' && queue[0].t !== 'settings' && queue[0].t !== 'world') break;
          run(queue.shift());
        }
      }
      if (!p) return false;
      const snap = p.b ? (mixBuf = R.mix(p.a, p.b, p.k, mixBuf)) : p.a;
      // the same host frame as last time (this screen draws faster than the host sends): nothing to set
      if (snap !== lastSnap || p.b) { const a0 = performance.now(); R.apply(snap); applyMs += ((performance.now() - a0) - applyMs) * 0.05; lastSnap = snap; }
      shownT = p.t; frames++;
      ages.push(H - p.t); if (ages.length > 90) ages.shift();
      const now = performance.now();
      if (now - lastReport > 500 && ages.length > 10) {
        lastReport = now;
        const s = ages.slice().sort((a, b) => a - b), med = s[Math.floor(s.length / 2)];
        link.send({ t: 'delay', ms: Math.round(med * 10) / 10 });
        ui.lag(med);
      }
      return true;
    }
    return {
      guestFrame, link,
      get delay() { return P.delay; }, get shownT() { return shownT; },
      stats: () => ({ ran, applyMs, frames, packets, bytes, delay: P.delay, floor: P.floor, jitter: P.jitter, interval: P.interval, age: ages.length ? ages.slice().sort((a, b) => a - b)[Math.floor(ages.length / 2)] : null, rtt: link && link.rtt }),
      start: () => ui.start(),
    };
  }

  // ======================================================================== the friend's overlay
  /** The join card (a click lets the sound start), the phone QR, the picture delay. */
  function overlay(c) {
    const css = `
      #net-join { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; background: radial-gradient(120% 90% at 50% 0%, rgba(27,22,64,0.96) 0%, rgba(5,6,12,0.97) 70%); transition: opacity 0.35s; }
      body.net-started #net-join { opacity: 0; pointer-events: none; }
      .nj-card { width: min(460px, calc(100vw - 32px)); text-align: center; color: #e8eaee; }
      .nj-kick { font-size: 12px; letter-spacing: 0.32em; color: #5ee6d0; }
      .nj-card h1 { margin: 10px 0 8px; font-size: clamp(28px, 5vw, 40px); font-style: italic; }
      .nj-card p { margin: 0 0 22px; color: #a9afbd; line-height: 1.5; }
      #net-go { font: inherit; font-weight: 800; letter-spacing: 0.14em; font-size: 16px; padding: 14px 34px; border-radius: 99px; border: 0; background: #ffc24d; color: #120f24; cursor: pointer; }
      #net-status { margin-top: 16px; min-height: 20px; font-size: 13px; color: #8a909c; }
      #net-phone { position: fixed; left: 18px; top: 18px; z-index: 80; display: flex; gap: 14px; align-items: center; max-width: min(420px, calc(100vw - 36px)); padding: 12px 16px 12px 12px; border-radius: 14px; background: rgba(12,10,30,0.9); border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 14px 40px rgba(0,0,0,0.45); color: #e8eaee; }
      #net-phone:empty { display: none; }
      #net-phone .qr { width: 132px; height: 132px; flex: none; background: #fff; border-radius: 8px; padding: 4px; box-sizing: border-box; }
      #net-phone .qr svg { width: 100%; height: 100%; display: block; }
      #net-phone b { display: block; font-size: 15px; margin-bottom: 4px; }
      #net-phone span { font-size: 13px; color: #a9afbd; line-height: 1.45; }
      #net-phone.joined { padding: 7px 14px; opacity: 0.85; }
      #net-phone.joined b { color: #6fd39a; margin: 0; font-size: 13px; }
      #net-lag { position: fixed; right: 12px; bottom: 6px; z-index: 80; font-size: 11px; letter-spacing: 0.1em; color: rgba(255,255,255,0.5); pointer-events: none; }
      body.net-guest .s-join, body.net-guest #online, body.net-guest #bubble, body.net-guest #visor { display: none !important; }
      body.net-guest .screen, body.net-guest #hud { pointer-events: none !important; }`;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    document.body.classList.add('net-guest', 'room-guest');   // (room-guest: HUD bits tagged for the host hide here)
    const j = document.createElement('div'); j.id = 'net-join';
    j.innerHTML = `<div class="nj-card"><div class="nj-kick">CHAK DE FATTE · ONLINE</div><h1>Your friend's match</h1><p>You'll play from your own end, drawn right here on your laptop. Then scan the code with your phone.</p><button id="net-go">JOIN THE GAME</button><div id="net-status">Connecting to the game…</div></div>`;
    document.body.appendChild(j);
    const ph = document.createElement('div'); ph.id = 'net-phone'; document.body.appendChild(ph);
    const lag = document.createElement('div'); lag.id = 'net-lag'; document.body.appendChild(lag);
    const start = () => { document.body.classList.add('net-started'); if (c.onStart) c.onStart(); };
    document.getElementById('net-go').addEventListener('click', start);
    let shownUrl = '';
    return {
      start,
      status: t => { const s = document.getElementById('net-status'); if (s) s.textContent = t || 'Connected. Join when you are ready.'; },
      phone: p => {
        ph.classList.toggle('joined', !!p.joined);
        if (p.joined) { ph.innerHTML = `<b>Phone connected</b><span>${String(p.name || '').replace(/[&<>"]/g, '')}</span>`; shownUrl = ''; return; }
        if (!p.url || !window.MimicQR || p.url === shownUrl) return;
        shownUrl = p.url;
        ph.innerHTML = `<div class="qr">${MimicQR.svg(p.url, { ecc: 'M', border: 2 })}</div><div><b>Scan with your phone's camera</b><span>It opens in the browser (no app needed) and becomes your bat and ball. Then press HOLD on it to take your seat.</span></div>`;
      },
      lag: ms => { lag.textContent = 'DELAY ' + Math.round(ms) + ' MS'; },
    };
  }

  CK.Net = { host, guest, dressOut, dressIn };
})();
